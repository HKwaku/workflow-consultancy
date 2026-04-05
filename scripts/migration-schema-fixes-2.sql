-- =============================================================================
-- Schema additions migration (part 2)
-- Run in Supabase SQL Editor after migration-schema-fixes.sql has been applied.
-- All statements use IF NOT EXISTS / DROP IF EXISTS for idempotency.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. PROMOTED COLUMNS on diagnostic_reports
--    Move frequently-queried values out of the diagnostic_data JSONB blob
--    so they can be indexed and queried efficiently.
-- ---------------------------------------------------------------------------

ALTER TABLE public.diagnostic_reports
  ADD COLUMN IF NOT EXISTS cost_analysis_status text DEFAULT 'pending';

ALTER TABLE public.diagnostic_reports
  ADD COLUMN IF NOT EXISTS cost_analysis_token text;

ALTER TABLE public.diagnostic_reports
  ADD COLUMN IF NOT EXISTS total_annual_cost numeric;

ALTER TABLE public.diagnostic_reports
  ADD COLUMN IF NOT EXISTS potential_savings numeric;

ALTER TABLE public.diagnostic_reports
  ADD COLUMN IF NOT EXISTS automation_percentage numeric;

-- Separate JSONB column for cost analysis settings (labour rates, non-labour,
-- implementation cost etc.) — keeps diagnostic_data focused on process data.
ALTER TABLE public.diagnostic_reports
  ADD COLUMN IF NOT EXISTS cost_analysis jsonb;


-- Token expiry: 30-day validity for cost analysis links
ALTER TABLE public.diagnostic_reports
  ADD COLUMN IF NOT EXISTS cost_analysis_token_expires_at timestamptz;

-- Promoted automation grade (companion to automation_percentage)
ALTER TABLE public.diagnostic_reports
  ADD COLUMN IF NOT EXISTS automation_grade text;


-- ---------------------------------------------------------------------------
-- 2. INDEXES on promoted columns
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_diagnostic_reports_cost_status
  ON public.diagnostic_reports (cost_analysis_status);

-- Partial index: only rows that are awaiting cost analysis completion
CREATE INDEX IF NOT EXISTS idx_diagnostic_reports_cost_pending
  ON public.diagnostic_reports (created_at DESC)
  WHERE cost_analysis_status = 'pending';


-- diagnostic_progress: email lookup (progress GET queries by email)
CREATE INDEX IF NOT EXISTS idx_diagnostic_progress_email
  ON public.diagnostic_progress (lower(email))
  WHERE email IS NOT NULL;


-- ---------------------------------------------------------------------------
-- 3. CHECK CONSTRAINT on cost_analysis_status
-- ---------------------------------------------------------------------------

ALTER TABLE public.diagnostic_reports
  DROP CONSTRAINT IF EXISTS chk_cost_analysis_status;
ALTER TABLE public.diagnostic_reports
  ADD CONSTRAINT chk_cost_analysis_status
  CHECK (cost_analysis_status IN ('pending', 'complete')) NOT VALID;
ALTER TABLE public.diagnostic_reports
  VALIDATE CONSTRAINT chk_cost_analysis_status;


-- ---------------------------------------------------------------------------
-- 4. UNIQUE CONSTRAINT on display_code
--    display_code is a short human-readable code assigned at report creation.
--    Use a partial unique index so NULLs (legacy rows) are not compared.
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS idx_diagnostic_reports_display_code;
CREATE UNIQUE INDEX idx_diagnostic_reports_display_code
  ON public.diagnostic_reports (display_code)
  WHERE display_code IS NOT NULL;


-- ---------------------------------------------------------------------------
-- 5. CHECK CONSTRAINT on diagnostic_mode
--    NOT VALID: adds constraint without scanning existing rows (safe for
--    tables that already have data). Run VALIDATE separately once confirmed.
-- ---------------------------------------------------------------------------

ALTER TABLE public.diagnostic_reports
  DROP CONSTRAINT IF EXISTS chk_diagnostic_mode;
ALTER TABLE public.diagnostic_reports
  ADD CONSTRAINT chk_diagnostic_mode
  CHECK (diagnostic_mode IN ('comprehensive', 'quick', 'team')) NOT VALID;

-- Uncomment after confirming all existing rows conform:
-- ALTER TABLE public.diagnostic_reports VALIDATE CONSTRAINT chk_diagnostic_mode;


-- ---------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY
--    The current application uses the service-role key which bypasses RLS.
--    Enable RLS and define policies now so that if/when you switch to the
--    anon key + JWT flow, data is protected at the database layer too.
--
--    Steps to activate:
--      a) Switch API calls to use the anon key + pass the user JWT in the
--         Authorization header (Supabase JS client handles this automatically).
--      b) Remove SUPABASE_KEY (service key) from server-side routes that
--         should be user-scoped (keep it only for admin/cron routes).
-- ---------------------------------------------------------------------------

ALTER TABLE public.diagnostic_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_redesigns    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.followup_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.process_instances   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnostic_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_diagnostics    ENABLE ROW LEVEL SECURITY;

-- diagnostic_reports: owner reads their own rows (email match)
DROP POLICY IF EXISTS pol_reports_select ON public.diagnostic_reports;
CREATE POLICY pol_reports_select
  ON public.diagnostic_reports FOR SELECT
  USING (lower(contact_email) = lower(auth.email()));

DROP POLICY IF EXISTS pol_reports_insert ON public.diagnostic_reports;
CREATE POLICY pol_reports_insert
  ON public.diagnostic_reports FOR INSERT
  WITH CHECK (lower(contact_email) = lower(auth.email()));

DROP POLICY IF EXISTS pol_reports_update ON public.diagnostic_reports;
CREATE POLICY pol_reports_update
  ON public.diagnostic_reports FOR UPDATE
  USING (lower(contact_email) = lower(auth.email()));

DROP POLICY IF EXISTS pol_reports_delete ON public.diagnostic_reports;
CREATE POLICY pol_reports_delete
  ON public.diagnostic_reports FOR DELETE
  USING (lower(contact_email) = lower(auth.email()));

-- report_redesigns: access via parent report ownership (FK join)
DROP POLICY IF EXISTS pol_redesigns_select ON public.report_redesigns;
CREATE POLICY pol_redesigns_select
  ON public.report_redesigns FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.diagnostic_reports dr
      WHERE dr.id = report_redesigns.report_id
        AND lower(dr.contact_email) = lower(auth.email())
    )
  );

DROP POLICY IF EXISTS pol_redesigns_insert ON public.report_redesigns;
CREATE POLICY pol_redesigns_insert
  ON public.report_redesigns FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.diagnostic_reports dr
      WHERE dr.id = report_redesigns.report_id
        AND lower(dr.contact_email) = lower(auth.email())
    )
  );

DROP POLICY IF EXISTS pol_redesigns_update ON public.report_redesigns;
CREATE POLICY pol_redesigns_update
  ON public.report_redesigns FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.diagnostic_reports dr
      WHERE dr.id = report_redesigns.report_id
        AND lower(dr.contact_email) = lower(auth.email())
    )
  );

-- followup_events: service-role only (cron job) — deny anon access
DROP POLICY IF EXISTS pol_followups_deny ON public.followup_events;
CREATE POLICY pol_followups_deny
  ON public.followup_events FOR ALL
  USING (false);

-- process_instances: user sees their own rows
DROP POLICY IF EXISTS pol_instances_select ON public.process_instances;
CREATE POLICY pol_instances_select
  ON public.process_instances FOR SELECT
  USING (lower(email) = lower(auth.email()));

DROP POLICY IF EXISTS pol_instances_insert ON public.process_instances;
CREATE POLICY pol_instances_insert
  ON public.process_instances FOR INSERT
  WITH CHECK (lower(email) = lower(auth.email()));

-- diagnostic_progress: user sees their own rows
DROP POLICY IF EXISTS pol_progress_select ON public.diagnostic_progress;
CREATE POLICY pol_progress_select
  ON public.diagnostic_progress FOR SELECT
  USING (lower(email) = lower(auth.email()));

DROP POLICY IF EXISTS pol_progress_insert ON public.diagnostic_progress;
CREATE POLICY pol_progress_insert
  ON public.diagnostic_progress FOR INSERT
  WITH CHECK (lower(email) = lower(auth.email()));

DROP POLICY IF EXISTS pol_progress_update ON public.diagnostic_progress;
CREATE POLICY pol_progress_update
  ON public.diagnostic_progress FOR UPDATE
  USING (lower(email) = lower(auth.email()));

-- team_diagnostics: creator sees their own sessions
DROP POLICY IF EXISTS pol_teams_select ON public.team_diagnostics;
CREATE POLICY pol_teams_select
  ON public.team_diagnostics FOR SELECT
  USING (lower(created_by_email) = lower(auth.email()));

DROP POLICY IF EXISTS pol_teams_insert ON public.team_diagnostics;
CREATE POLICY pol_teams_insert
  ON public.team_diagnostics FOR INSERT
  WITH CHECK (lower(created_by_email) = lower(auth.email()));

DROP POLICY IF EXISTS pol_teams_update ON public.team_diagnostics;
CREATE POLICY pol_teams_update
  ON public.team_diagnostics FOR UPDATE
  USING (lower(created_by_email) = lower(auth.email()));
