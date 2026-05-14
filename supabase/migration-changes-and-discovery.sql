-- ============================================================
-- Change as a first-class object + discovery sessions
--
-- Today "change" is implicit and scattered:
--   * lib/agents/redesign/tools.js record_change → emitted, summarised,
--     persisted only inside report_redesigns.redesign_data JSONB.
--   * Deal propose_* chat tools → SSE proposal cards + ad-hoc writes to
--     deal_finding_reviews / deal_analyses / deal_participants. No common row.
--   * deal_findings.stale → the only place change-over-time is reasoned about,
--     and only for evidence drift.
--
-- Result: "what changed in this process / deal, and what came of it" is not
-- queryable. This migration introduces three relational tables so it is.
--
--   discovery_sessions  one per learning loop (chat conversation scoped to a
--                       report or deal). Holds the questions asked and the
--                       observations harvested from answers.
--
--   changes             one per proposed/applied/measured change. Subject can
--                       be a step, process, finding, cost input, participant,
--                       redesign, or document. State machine:
--                       proposed → accepted → applied → live → measured
--                                ↘ rejected      ↘ reverted
--
--   change_outcomes     measured deltas attached to a change. Closes the loop
--                       between "we recommended X" and "metric Y moved by Z".
--
-- Same pattern as migration-deal-findings-table.sql:
--   * relational table is the canonical read source going forward
--   * legacy JSONB blobs (report_redesigns.redesign_data.changes,
--     deal_analyses.result.*) stay as raw audit archive
--   * backfill at the bottom seeds rows so the read view isn't blank
-- ============================================================

-- ---------- discovery_sessions ----------
CREATE TABLE IF NOT EXISTS public.discovery_sessions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Anchor. At least one of these must be set; CHECK enforces below.
  -- chat_session_id is the conversation that drove the discovery (optional —
  -- an analyst can record observations outside chat).
  chat_session_id   uuid        REFERENCES public.chat_sessions(id)       ON DELETE SET NULL,
  report_id         text        REFERENCES public.diagnostic_reports(id)  ON DELETE CASCADE,
  deal_id           uuid        REFERENCES public.deals(id)               ON DELETE CASCADE,

  -- Lower-cased email so the existing JWT-email RLS pattern works directly.
  user_email        text,

  -- Free-form intent ("understand why month-end takes 12 days") and post-hoc
  -- summary ("waiting on legal sign-off accounts for 7 of the 12 days").
  goal              text,
  summary           text,

  -- Stream of observations. Each item: {question, answer_excerpt, message_id,
  -- observed_at, confidence?}. Inserted by the chat agent's ask_discovery tool
  -- and by the analyst manually. Kept as JSONB rather than a child table —
  -- observations are read in bulk per session, never queried independently.
  observations      jsonb       NOT NULL DEFAULT '[]'::jsonb,

  started_at        timestamptz NOT NULL DEFAULT now(),
  ended_at          timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT discovery_sessions_anchor_chk CHECK (
    report_id IS NOT NULL OR deal_id IS NOT NULL OR chat_session_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_discovery_sessions_report
  ON public.discovery_sessions (report_id, started_at DESC) WHERE report_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_discovery_sessions_deal
  ON public.discovery_sessions (deal_id,   started_at DESC) WHERE deal_id   IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_discovery_sessions_chat
  ON public.discovery_sessions (chat_session_id) WHERE chat_session_id IS NOT NULL;

COMMENT ON TABLE public.discovery_sessions IS
  'A single learning loop: questions asked, answers observed, and the changes those answers produced.';


-- ---------- changes ----------
CREATE TABLE IF NOT EXISTS public.changes (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- WHAT was changed.
  -- subject_ref is a small JSONB locator (e.g. {process: "Onboarding", step: "Send NDA"}
  -- or {finding_key: "abc123…"}). We keep it free-form rather than hard FKs
  -- because subjects span multiple tables and shapes.
  subject_type          text        NOT NULL CHECK (subject_type IN (
                          'process', 'process_step', 'handoff', 'cost_input',
                          'redesign', 'deal_finding', 'participant', 'document'
                        )),
  subject_ref           jsonb       NOT NULL,

  -- HOW it changed (extends the redesign agent's enum).
  kind                  text        NOT NULL CHECK (kind IN (
                          'added', 'removed', 'modified', 'merged',
                          'reordered', 'automated', 'reverted'
                        )),

  -- LIFECYCLE state.
  -- proposed  → agent or user has suggested it; not applied
  -- accepted  → reviewer approved; not yet applied to the canvas / world
  -- rejected  → reviewer rejected; terminal
  -- applied   → applied to the canvas / record (e.g. step removed in processData)
  -- live      → in production at the customer (manually flipped)
  -- measured  → has at least one row in change_outcomes
  -- reverted  → undone; terminal
  state                 text        NOT NULL DEFAULT 'proposed' CHECK (state IN (
                          'proposed', 'accepted', 'rejected',
                          'applied', 'live', 'measured', 'reverted'
                        )),

  -- Snapshots. Keep small — pointer + a few fields, not the full process tree.
  before_state          jsonb,
  after_state           jsonb,

  -- WHY.
  rationale             text,
  -- Redesign principle from lib/agents/redesign/tools.js (consolidate,
  -- automate-handoffs, …) when applicable. Free-form for non-redesign sources.
  principle             text,
  -- Pointers to the evidence behind the change.
  -- Each item: {kind: 'chunk'|'finding'|'message'|'observation', id, snippet?}.
  evidence_refs         jsonb       NOT NULL DEFAULT '[]'::jsonb,

  -- LINKAGE. report_id OR deal_id required (CHECK below).
  discovery_session_id  uuid        REFERENCES public.discovery_sessions(id)  ON DELETE SET NULL,
  parent_change_id      uuid        REFERENCES public.changes(id)             ON DELETE SET NULL,
  report_id             text        REFERENCES public.diagnostic_reports(id)  ON DELETE CASCADE,
  deal_id               uuid        REFERENCES public.deals(id)               ON DELETE CASCADE,
  -- report_redesigns.id is `text` (gen_random_uuid()::text) — see supabase/migration.sql:94.
  -- Match the parent type or the FK won't validate.
  redesign_id           text        REFERENCES public.report_redesigns(id)    ON DELETE CASCADE,

  -- WHO.
  actor_kind            text        NOT NULL CHECK (actor_kind IN ('agent', 'user', 'system')),
  actor_email           text,
  agent_name            text,                       -- 'redesign' | 'chat' | 'cost' | 'staleness'

  -- PREDICTED impact (what the proposer claimed). Actual deltas live in
  -- change_outcomes so we can compare predicted vs observed.
  confidence            real        CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  expected_impact       jsonb,                      -- {time_minutes?, cost_pct?, fte?, error_rate_pct?, free-form…}

  -- LIFECYCLE timestamps. Filled as state advances.
  proposed_at           timestamptz NOT NULL DEFAULT now(),
  decided_at            timestamptz,
  applied_at            timestamptz,
  live_at               timestamptz,
  measured_at           timestamptz,
  reverted_at           timestamptz,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT changes_scope_chk CHECK (report_id IS NOT NULL OR deal_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_changes_report
  ON public.changes (report_id, created_at DESC) WHERE report_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_changes_deal
  ON public.changes (deal_id,   created_at DESC) WHERE deal_id   IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_changes_redesign
  ON public.changes (redesign_id) WHERE redesign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_changes_state
  ON public.changes (state, kind);
CREATE INDEX IF NOT EXISTS idx_changes_discovery
  ON public.changes (discovery_session_id) WHERE discovery_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_changes_parent
  ON public.changes (parent_change_id)     WHERE parent_change_id     IS NOT NULL;

COMMENT ON TABLE public.changes IS
  'Every proposed, accepted, applied, or measured change to a process / deal / finding. The longitudinal record behind the discovery loop.';


-- ---------- change_outcomes ----------
CREATE TABLE IF NOT EXISTS public.change_outcomes (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  change_id     uuid        NOT NULL REFERENCES public.changes(id) ON DELETE CASCADE,

  -- Free-form metric name. Recommended vocabulary documented in
  -- lib/changes/repo.js (cycle_time_minutes, cost_per_run, automation_pct, …).
  metric        text        NOT NULL,
  unit          text,                                                   -- 'minutes' | 'usd' | 'pct' | 'count' | …

  value_before  numeric,
  value_after   numeric,
  -- Generated column so "biggest realised wins" sorts cheaply.
  delta         numeric     GENERATED ALWAYS AS (value_after - value_before) STORED,

  source        text        NOT NULL CHECK (source IN (
                  'process_instance', 'report_rerun', 'manual', 'inferred_from_doc', 'agent'
                )),
  source_ref    jsonb,                                                  -- {process_instance_id} | {analysis_id} | …

  measured_at   timestamptz NOT NULL DEFAULT now(),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_change_outcomes_change
  ON public.change_outcomes (change_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_change_outcomes_metric
  ON public.change_outcomes (metric, measured_at DESC);

COMMENT ON TABLE public.change_outcomes IS
  'Measured deltas attached to a change. One change can accumulate many outcomes over time as new measurements come in.';


-- ---------- updated_at triggers (helper from earlier migrations) ----------
DROP TRIGGER IF EXISTS discovery_sessions_updated_at ON public.discovery_sessions;
CREATE TRIGGER discovery_sessions_updated_at
  BEFORE UPDATE ON public.discovery_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();

DROP TRIGGER IF EXISTS changes_updated_at ON public.changes;
CREATE TRIGGER changes_updated_at
  BEFORE UPDATE ON public.changes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();


-- ---------- RLS ----------
-- Mirror the access model of the parent row:
--   * If report_id is set → reader/writer must own the diagnostic_reports row
--     (contact_email = JWT email), same as existing diagnostic_reports policies.
--   * If deal_id is set → owner_email or collaborator_emails on deals,
--     mirroring deal_findings / deal_analyses.
-- Defence in depth — API routes also enforce this.
ALTER TABLE public.discovery_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.changes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_outcomes    ENABLE ROW LEVEL SECURITY;

-- Helper: shared scope predicate for changes + discovery_sessions.
-- Inlined in each policy because Postgres requires the predicate to reference
-- the row being checked.

DROP POLICY IF EXISTS discovery_sessions_scope ON public.discovery_sessions;
CREATE POLICY discovery_sessions_scope
  ON public.discovery_sessions
  FOR ALL
  TO authenticated
  USING (
    (report_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.diagnostic_reports r
       WHERE r.id = discovery_sessions.report_id
         AND lower(r.contact_email) = lower(auth.jwt() ->> 'email')
    ))
    OR (deal_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.deals d
       WHERE d.id = discovery_sessions.deal_id
         AND (
           lower(d.owner_email) = lower(auth.jwt() ->> 'email')
           OR (auth.jwt() ->> 'email') = ANY (
             SELECT lower(e) FROM unnest(coalesce(d.collaborator_emails, ARRAY[]::text[])) AS e
           )
         )
    ))
  )
  WITH CHECK (
    (report_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.diagnostic_reports r
       WHERE r.id = discovery_sessions.report_id
         AND lower(r.contact_email) = lower(auth.jwt() ->> 'email')
    ))
    OR (deal_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.deals d
       WHERE d.id = discovery_sessions.deal_id
         AND (
           lower(d.owner_email) = lower(auth.jwt() ->> 'email')
           OR (auth.jwt() ->> 'email') = ANY (
             SELECT lower(e) FROM unnest(coalesce(d.collaborator_emails, ARRAY[]::text[])) AS e
           )
         )
    ))
  );

DROP POLICY IF EXISTS changes_scope ON public.changes;
CREATE POLICY changes_scope
  ON public.changes
  FOR ALL
  TO authenticated
  USING (
    (report_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.diagnostic_reports r
       WHERE r.id = changes.report_id
         AND lower(r.contact_email) = lower(auth.jwt() ->> 'email')
    ))
    OR (deal_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.deals d
       WHERE d.id = changes.deal_id
         AND (
           lower(d.owner_email) = lower(auth.jwt() ->> 'email')
           OR (auth.jwt() ->> 'email') = ANY (
             SELECT lower(e) FROM unnest(coalesce(d.collaborator_emails, ARRAY[]::text[])) AS e
           )
         )
    ))
  )
  WITH CHECK (
    (report_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.diagnostic_reports r
       WHERE r.id = changes.report_id
         AND lower(r.contact_email) = lower(auth.jwt() ->> 'email')
    ))
    OR (deal_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.deals d
       WHERE d.id = changes.deal_id
         AND (
           lower(d.owner_email) = lower(auth.jwt() ->> 'email')
           OR (auth.jwt() ->> 'email') = ANY (
             SELECT lower(e) FROM unnest(coalesce(d.collaborator_emails, ARRAY[]::text[])) AS e
           )
         )
    ))
  );

DROP POLICY IF EXISTS change_outcomes_scope ON public.change_outcomes;
CREATE POLICY change_outcomes_scope
  ON public.change_outcomes
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.changes c
       WHERE c.id = change_outcomes.change_id
         AND (
           (c.report_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.diagnostic_reports r
              WHERE r.id = c.report_id
                AND lower(r.contact_email) = lower(auth.jwt() ->> 'email')
           ))
           OR (c.deal_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.deals d
              WHERE d.id = c.deal_id
                AND (
                  lower(d.owner_email) = lower(auth.jwt() ->> 'email')
                  OR (auth.jwt() ->> 'email') = ANY (
                    SELECT lower(e) FROM unnest(coalesce(d.collaborator_emails, ARRAY[]::text[])) AS e
                  )
                )
           ))
         )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.changes c
       WHERE c.id = change_outcomes.change_id
         AND (
           (c.report_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.diagnostic_reports r
              WHERE r.id = c.report_id
                AND lower(r.contact_email) = lower(auth.jwt() ->> 'email')
           ))
           OR (c.deal_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.deals d
              WHERE d.id = c.deal_id
                AND (
                  lower(d.owner_email) = lower(auth.jwt() ->> 'email')
                  OR (auth.jwt() ->> 'email') = ANY (
                    SELECT lower(e) FROM unnest(coalesce(d.collaborator_emails, ARRAY[]::text[])) AS e
                  )
                )
           ))
         )
    )
  );


-- ---------- Backfill from report_redesigns.redesign_data.changes ----------
-- Walk every existing redesign and seed `changes` rows from the JSONB array
-- the redesign agent has been writing. Each row lands as state='applied' if
-- the redesign was accepted, else 'proposed'.
--
-- Idempotent guard: skip if a row already exists with the same redesign_id +
-- subject_ref + kind (we don't have a stable key in the legacy JSONB).
DO $$
DECLARE
  v_rd        record;
  v_change    jsonb;
  v_state     text;
  v_subject   jsonb;
  v_actor     text;
BEGIN
  FOR v_rd IN
    SELECT id, report_id, status, accepted_at, redesign_data
      FROM public.report_redesigns
     WHERE redesign_data IS NOT NULL
       AND jsonb_typeof(redesign_data -> 'changes') = 'array'
  LOOP
    v_state := CASE
      WHEN v_rd.status = 'accepted' THEN 'applied'
      WHEN v_rd.status = 'rejected' THEN 'rejected'
      ELSE 'proposed'
    END;

    FOR v_change IN
      SELECT * FROM jsonb_array_elements(v_rd.redesign_data -> 'changes')
    LOOP
      v_subject := jsonb_build_object(
        'process',  v_change ->> 'process',
        'stepName', v_change ->> 'stepName'
      );

      -- Skip if we've already backfilled this row.
      IF EXISTS (
        SELECT 1 FROM public.changes
         WHERE redesign_id = v_rd.id
           AND subject_ref = v_subject
           AND kind = COALESCE(v_change ->> 'type', 'modified')
      ) THEN
        CONTINUE;
      END IF;

      INSERT INTO public.changes (
        subject_type, subject_ref,
        kind, state,
        rationale, principle,
        report_id, redesign_id,
        actor_kind, agent_name,
        expected_impact,
        proposed_at, applied_at
      ) VALUES (
        'process_step', v_subject,
        COALESCE(v_change ->> 'type', 'modified'),
        v_state,
        v_change ->> 'description',
        v_change ->> 'principle',
        v_rd.report_id, v_rd.id,
        'agent', 'redesign',
        jsonb_strip_nulls(jsonb_build_object(
          'time_minutes', NULLIF((v_change ->> 'estimatedTimeSavedMinutes'), '')::numeric,
          'cost_pct',     NULLIF((v_change ->> 'estimatedCostSavedPercent'), '')::numeric
        )),
        COALESCE((v_rd.redesign_data ->> 'created_at')::timestamptz, now()),
        CASE WHEN v_state = 'applied' THEN COALESCE(v_rd.accepted_at, now()) ELSE NULL END
      );
    END LOOP;
  END LOOP;
END $$;

-- Sanity report.
DO $$
DECLARE
  v_changes_count   integer;
  v_redesign_count  integer;
BEGIN
  SELECT count(*) INTO v_changes_count  FROM public.changes WHERE redesign_id IS NOT NULL;
  SELECT count(*) INTO v_redesign_count FROM public.report_redesigns
   WHERE redesign_data IS NOT NULL AND jsonb_typeof(redesign_data -> 'changes') = 'array';
  RAISE NOTICE 'Backfill done: % change rows seeded from % redesigns.', v_changes_count, v_redesign_count;
END $$;
