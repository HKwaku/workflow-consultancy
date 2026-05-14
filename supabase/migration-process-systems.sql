-- ============================================================
-- Process ↔ Systems join (cross-process system inventory)
--
-- Today the systems a process touches live in JSONB at
-- diagnostic_reports.diagnostic_data.rawProcesses[].steps[].systems[] —
-- a free-text array. That makes cross-process queries ("every process
-- that touches Salesforce") expensive: callers have to walk the JSONB
-- of every report.
--
-- This migration introduces process_systems as a normalised join row,
-- one per (process, step, system-mention). Each row optionally links
-- to a model_systems row (when the raw name matches the inventory) so
-- cross-process aggregates can count by canonical system. Capability
-- and operating_model are denormalised on the row for fast filtering
-- without joining diagnostic_reports.
--
-- Auto-population: the route /api/update-diagnostic now mirrors the
-- canvas's step.systems[] into process_systems on save (DELETE + bulk
-- INSERT scoped to the report). The backfill at the bottom of this
-- migration seeds existing reports.
--
-- match_key is generated to keep ad-hoc lookups by name (case-folded)
-- cheap — same trick we used on model_systems.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.process_systems (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The process this row belongs to. diagnostic_reports.id is text.
  report_id           text        NOT NULL REFERENCES public.diagnostic_reports(id) ON DELETE CASCADE,
  -- For multi-process reports (rawProcesses[]); 0 for single-process.
  process_index       integer     NOT NULL DEFAULT 0,

  -- Optional: which step uses the system. Keep both index and name so
  -- the join survives reorders / renames (best-effort).
  step_index          integer,
  step_name           text,

  -- Optional canonical link. NULL when no model_systems row exists yet
  -- for this name; the workspace's "promote to inventory" affordance
  -- (next phase) creates the model_systems row + backfills the FK.
  system_id           uuid        REFERENCES public.model_systems(id) ON DELETE SET NULL,

  -- Always populated — the raw string from step.systems[].
  system_name_raw     text        NOT NULL,

  -- Denormalised from the parent report so cross-process queries don't
  -- need to join diagnostic_reports. Updated by the save path.
  operating_model_id  uuid        REFERENCES public.operating_models(id) ON DELETE CASCADE,
  capability_id       uuid        REFERENCES public.capabilities(id)     ON DELETE SET NULL,

  -- Lower-cased name for matching against model_systems.match_key and
  -- for grouping ad-hoc by canonical name when system_id is null.
  match_key           text        GENERATED ALWAYS AS (lower(system_name_raw)) STORED,

  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proc_sys_report      ON public.process_systems (report_id, process_index);
CREATE INDEX IF NOT EXISTS idx_proc_sys_system      ON public.process_systems (system_id) WHERE system_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_proc_sys_match       ON public.process_systems (operating_model_id, match_key) WHERE operating_model_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_proc_sys_capability  ON public.process_systems (capability_id) WHERE capability_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_proc_sys_op_model    ON public.process_systems (operating_model_id) WHERE operating_model_id IS NOT NULL;

COMMENT ON TABLE public.process_systems IS
  'Normalised join: one row per (process, step, system mention). Powers cross-process queries like "every process touching Salesforce" without walking JSONB.';


-- ---------- RLS ----------
-- Mirror the parent process: visible to anyone who can see the
-- diagnostic_reports row. The simplest safe policy joins through
-- diagnostic_reports.contact_email.
ALTER TABLE public.process_systems ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS process_systems_owner_read ON public.process_systems;
CREATE POLICY process_systems_owner_read
  ON public.process_systems
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.diagnostic_reports r
       WHERE r.id = process_systems.report_id
         AND lower(r.contact_email) = lower(auth.jwt() ->> 'email')
    )
    -- Also visible to org members of the parent operating model — needed
    -- so the workspace's cross-process queries land for non-owner members.
    OR (process_systems.operating_model_id IS NOT NULL AND EXISTS (
      SELECT 1
        FROM public.operating_models m
        JOIN public.organization_members om ON om.organization_id = m.organization_id
       WHERE m.id = process_systems.operating_model_id
         AND lower(om.email) = lower(auth.jwt() ->> 'email')
    ))
  );

DROP POLICY IF EXISTS process_systems_owner_write ON public.process_systems;
CREATE POLICY process_systems_owner_write
  ON public.process_systems
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.diagnostic_reports r
       WHERE r.id = process_systems.report_id
         AND lower(r.contact_email) = lower(auth.jwt() ->> 'email')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.diagnostic_reports r
       WHERE r.id = process_systems.report_id
         AND lower(r.contact_email) = lower(auth.jwt() ->> 'email')
    )
  );


-- ---------- Backfill from existing diagnostic_reports ----------
-- Walk every report's rawProcesses[].steps[].systems[] and seed
-- process_systems rows. Skip reports that already have rows so re-running
-- this migration doesn't dupe.
--
-- system_id is left NULL — the next migration (or the workspace's
-- "promote to inventory" affordance) will link rows to canonical
-- model_systems where names match.
DO $$
DECLARE
  v_report     record;
  v_proc       jsonb;
  v_step       jsonb;
  v_sys        jsonb;
  v_p_idx      integer;
  v_s_idx      integer;
  v_sys_name   text;
  v_op_model   uuid;
  v_cap        uuid;
  v_inserted   integer := 0;
  v_skipped    integer := 0;
BEGIN
  FOR v_report IN
    SELECT id, operating_model_id, capability_id, diagnostic_data
      FROM public.diagnostic_reports
     WHERE diagnostic_data IS NOT NULL
       AND jsonb_typeof(diagnostic_data -> 'rawProcesses') = 'array'
  LOOP
    -- Skip if already backfilled (idempotency guard).
    IF EXISTS (SELECT 1 FROM public.process_systems WHERE report_id = v_report.id) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_op_model := v_report.operating_model_id;
    v_cap      := v_report.capability_id;
    v_p_idx    := 0;

    FOR v_proc IN SELECT * FROM jsonb_array_elements(v_report.diagnostic_data -> 'rawProcesses') LOOP
      IF jsonb_typeof(v_proc -> 'steps') = 'array' THEN
        v_s_idx := 0;
        FOR v_step IN SELECT * FROM jsonb_array_elements(v_proc -> 'steps') LOOP
          IF jsonb_typeof(v_step -> 'systems') = 'array' THEN
            FOR v_sys IN SELECT * FROM jsonb_array_elements(v_step -> 'systems') LOOP
              -- jsonb_array_elements yields jsonb scalars — extract text.
              v_sys_name := trim(both '"' from v_sys::text);
              IF v_sys_name IS NOT NULL AND v_sys_name <> '' AND v_sys_name <> 'null' THEN
                INSERT INTO public.process_systems
                  (report_id, process_index, step_index, step_name,
                   system_name_raw, operating_model_id, capability_id)
                VALUES
                  (v_report.id, v_p_idx, v_s_idx,
                   coalesce(v_step ->> 'name', NULL),
                   v_sys_name, v_op_model, v_cap);
                v_inserted := v_inserted + 1;
              END IF;
            END LOOP;
          END IF;
          v_s_idx := v_s_idx + 1;
        END LOOP;
      END IF;
      v_p_idx := v_p_idx + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'process_systems backfill done: % rows inserted, % reports skipped (already had rows).', v_inserted, v_skipped;
END $$;

-- Best-effort link to model_systems where the canonical name matches.
-- Updates rows where system_id is NULL but a same-org model_systems row
-- exists with the same match_key. Idempotent.
UPDATE public.process_systems ps
   SET system_id = ms.id
  FROM public.model_systems ms
 WHERE ps.system_id IS NULL
   AND ps.operating_model_id IS NOT NULL
   AND ms.operating_model_id = ps.operating_model_id
   AND ms.match_key = ps.match_key;
