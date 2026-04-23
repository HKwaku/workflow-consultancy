-- =============================================================================
-- Schema fixes migration
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Safe to run incrementally - all statements use IF NOT EXISTS / IF EXISTS.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. INDEXES
--    Missing indexes on the columns used for every ownership lookup.
--    diagnostic_reports is queried by contact_email (ilike) and user_id.
--    Use lower(contact_email) index to make ilike queries index-able.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_diagnostic_reports_email
  ON public.diagnostic_reports (lower(contact_email));

CREATE INDEX IF NOT EXISTS idx_diagnostic_reports_user_id
  ON public.diagnostic_reports (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_diagnostic_reports_created_at
  ON public.diagnostic_reports (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_report_redesigns_report_id
  ON public.report_redesigns (report_id);

-- Partial index: followup cron only ever queries pending+due rows
CREATE INDEX IF NOT EXISTS idx_followup_events_pending_due
  ON public.followup_events (scheduled_for ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_process_instances_user_id
  ON public.process_instances (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_process_instances_report_id
  ON public.process_instances (report_id)
  WHERE report_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_team_diagnostics_email
  ON public.team_diagnostics (lower(created_by_email));


-- ---------------------------------------------------------------------------
-- 2. LINK diagnostic_progress → diagnostic_reports
--    Allows funnel tracking: which progress sessions became reports.
--    ON DELETE SET NULL: deleting a report doesn't orphan the progress row.
-- ---------------------------------------------------------------------------

ALTER TABLE public.diagnostic_progress
  ADD COLUMN IF NOT EXISTS report_id text
  REFERENCES public.diagnostic_reports(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_diagnostic_progress_report_id
  ON public.diagnostic_progress (report_id)
  WHERE report_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- 3. LINK team_diagnostics → diagnostic_reports
--    When a team session produces a report, record it here.
-- ---------------------------------------------------------------------------

ALTER TABLE public.team_diagnostics
  ADD COLUMN IF NOT EXISTS report_id text
  REFERENCES public.diagnostic_reports(id) ON DELETE SET NULL;


-- ---------------------------------------------------------------------------
-- 4. CHECK CONSTRAINTS on status columns
--    NOT VALID adds the constraint without a full table scan (no lock).
--    VALIDATE CONSTRAINT checks existing rows separately - run during low
--    traffic if you have many rows.
-- ---------------------------------------------------------------------------

-- followup_events
ALTER TABLE public.followup_events
  DROP CONSTRAINT IF EXISTS chk_followup_status;
ALTER TABLE public.followup_events
  ADD CONSTRAINT chk_followup_status
  CHECK (status IN ('pending', 'sent', 'cancelled')) NOT VALID;
ALTER TABLE public.followup_events
  VALIDATE CONSTRAINT chk_followup_status;

-- report_redesigns
ALTER TABLE public.report_redesigns
  DROP CONSTRAINT IF EXISTS chk_redesign_status;
ALTER TABLE public.report_redesigns
  ADD CONSTRAINT chk_redesign_status
  CHECK (status IN ('pending', 'accepted', 'rejected')) NOT VALID;
ALTER TABLE public.report_redesigns
  VALIDATE CONSTRAINT chk_redesign_status;

-- process_instances
ALTER TABLE public.process_instances
  DROP CONSTRAINT IF EXISTS chk_instance_status;
ALTER TABLE public.process_instances
  ADD CONSTRAINT chk_instance_status
  CHECK (status IN ('started', 'in-progress', 'waiting', 'stuck', 'completed', 'cancelled')) NOT VALID;
ALTER TABLE public.process_instances
  VALIDATE CONSTRAINT chk_instance_status;

-- team_diagnostics
ALTER TABLE public.team_diagnostics
  DROP CONSTRAINT IF EXISTS chk_team_status;
ALTER TABLE public.team_diagnostics
  ADD CONSTRAINT chk_team_status
  CHECK (status IN ('open', 'closed')) NOT VALID;
ALTER TABLE public.team_diagnostics
  VALIDATE CONSTRAINT chk_team_status;


-- ---------------------------------------------------------------------------
-- 5. PARTIAL UNIQUE INDEX: only one accepted redesign per report
--    Multiple pending/rejected redesigns are fine (versioning).
--    Only one may be accepted at a time.
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS idx_unique_accepted_redesign;
CREATE UNIQUE INDEX idx_unique_accepted_redesign
  ON public.report_redesigns (report_id)
  WHERE status = 'accepted';


-- ---------------------------------------------------------------------------
-- 6. REMOVE CONTACT DUPLICATION from followup_events
--    contact_name and company are now fetched via FK join on diagnostic_reports.
--    Deploy the application code change BEFORE running these drops.
--    Verify the GET /api/get-followups endpoint works correctly first.
-- ---------------------------------------------------------------------------

-- Step 6a: confirm the app code is deployed and followup emails are working,
-- then uncomment and run:

-- ALTER TABLE public.followup_events DROP COLUMN IF EXISTS contact_name;
-- ALTER TABLE public.followup_events DROP COLUMN IF EXISTS company;


-- ---------------------------------------------------------------------------
-- 7. UPDATED_AT trigger for tables that are missing it
--    followup_events, process_instances, team_diagnostics, team_responses
--    have no updated_at column. Add where useful.
-- ---------------------------------------------------------------------------

-- process_instances: add updated_at for tracking status changes
ALTER TABLE public.process_instances
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Create a reusable trigger function (idempotent)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_process_instances_updated_at ON public.process_instances;
CREATE TRIGGER trg_process_instances_updated_at
  BEFORE UPDATE ON public.process_instances
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
