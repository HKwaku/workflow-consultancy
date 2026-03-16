-- ============================================================
-- Sharpin Schema Migration
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- ── 1. Drop unused columns ─────────────────────────────────
ALTER TABLE public.diagnostic_reports
  DROP COLUMN IF EXISTS pdf_base64,
  DROP COLUMN IF EXISTS followup_day3_sent,
  DROP COLUMN IF EXISTS followup_day14_sent,
  DROP COLUMN IF EXISTS followup_day30_sent;


-- ── 2. Add updated_at to diagnostic_reports ────────────────
ALTER TABLE public.diagnostic_reports
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Backfill existing rows
UPDATE public.diagnostic_reports
  SET updated_at = created_at
  WHERE updated_at IS NULL;


-- ── 3. Add user_id columns (nullable — anonymous diagnostics won't have one)
ALTER TABLE public.diagnostic_reports
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.diagnostic_progress
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.process_instances
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Backfill user_id from auth.users where emails match
UPDATE public.diagnostic_reports dr
  SET user_id = au.id
  FROM auth.users au
  WHERE lower(dr.contact_email) = lower(au.email)
    AND dr.user_id IS NULL;

UPDATE public.diagnostic_progress dp
  SET user_id = au.id
  FROM auth.users au
  WHERE lower(dp.email) = lower(au.email)
    AND dp.user_id IS NULL;

UPDATE public.process_instances pi
  SET user_id = au.id
  FROM auth.users au
  WHERE lower(pi.email) = lower(au.email)
    AND pi.user_id IS NULL;


-- ── 4. Add indexes for common query patterns ───────────────
CREATE INDEX IF NOT EXISTS idx_reports_email     ON public.diagnostic_reports (contact_email);
CREATE INDEX IF NOT EXISTS idx_reports_user      ON public.diagnostic_reports (user_id);
CREATE INDEX IF NOT EXISTS idx_progress_email    ON public.diagnostic_progress (email);
CREATE INDEX IF NOT EXISTS idx_progress_user     ON public.diagnostic_progress (user_id);
CREATE INDEX IF NOT EXISTS idx_instances_email   ON public.process_instances (email);
CREATE INDEX IF NOT EXISTS idx_instances_report  ON public.process_instances (report_id);
CREATE INDEX IF NOT EXISTS idx_instances_user    ON public.process_instances (user_id);
CREATE INDEX IF NOT EXISTS idx_team_resp_team    ON public.team_responses (team_id);


-- ── 5. Add FK: process_instances → diagnostic_reports ──────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'process_instances_report_id_fkey'
  ) THEN
    ALTER TABLE public.process_instances
      ADD CONSTRAINT process_instances_report_id_fkey
      FOREIGN KEY (report_id) REFERENCES public.diagnostic_reports(id)
      ON DELETE SET NULL;
  END IF;
END $$;


-- ── 6. Add diagnostic_mode column ──────────────────────────
ALTER TABLE public.diagnostic_reports
  ADD COLUMN IF NOT EXISTS diagnostic_mode text DEFAULT 'comprehensive';

-- Backfill from diagnostic_data JSONB
UPDATE public.diagnostic_reports
  SET diagnostic_mode = COALESCE(diagnostic_data->>'diagnosticMode', 'comprehensive')
  WHERE diagnostic_mode = 'comprehensive'
    AND diagnostic_data->>'diagnosticMode' IS NOT NULL
    AND diagnostic_data->>'diagnosticMode' != 'comprehensive';


-- ── 7. Create report_redesigns table ───────────────────────
CREATE TABLE IF NOT EXISTS public.report_redesigns (
  id text NOT NULL DEFAULT gen_random_uuid()::text,
  report_id text NOT NULL REFERENCES public.diagnostic_reports(id) ON DELETE CASCADE,
  redesign_data jsonb NOT NULL DEFAULT '{}',
  decisions jsonb DEFAULT '{}',
  status text DEFAULT 'pending',
  accepted_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT report_redesigns_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_redesigns_report ON public.report_redesigns (report_id);

-- Migrate existing redesign data from diagnostic_data JSONB
INSERT INTO public.report_redesigns (id, report_id, redesign_data, decisions, status, accepted_at, created_at, updated_at)
SELECT
  gen_random_uuid()::text,
  dr.id,
  CASE
    WHEN dr.diagnostic_data->'redesign' IS NOT NULL THEN
      (dr.diagnostic_data->'redesign') - 'decisions' - 'acceptedAt' - 'acceptedProcesses'
    ELSE '{}'::jsonb
  END,
  COALESCE(dr.diagnostic_data->'redesign'->'decisions', '{}'::jsonb),
  CASE
    WHEN dr.diagnostic_data->'redesign'->>'acceptedAt' IS NOT NULL THEN 'accepted'
    ELSE 'pending'
  END,
  (dr.diagnostic_data->'redesign'->>'acceptedAt')::timestamptz,
  COALESCE(dr.created_at, now()),
  now()
FROM public.diagnostic_reports dr
WHERE dr.diagnostic_data->'redesign' IS NOT NULL
  AND jsonb_typeof(dr.diagnostic_data->'redesign') = 'object'
  AND NOT EXISTS (
    SELECT 1 FROM public.report_redesigns rr WHERE rr.report_id = dr.id
  );


-- ── 8. Add closed_at to team_diagnostics ───────────────────
ALTER TABLE public.team_diagnostics
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;


-- ── 9. Remove team_code from team_responses ────────────────
-- (team_id FK is the correct join key; team_code was redundant)
ALTER TABLE public.team_responses
  DROP COLUMN IF EXISTS team_code;


-- ── 10. Enable Row Level Security ──────────────────────────
-- All API routes use the service role key which bypasses RLS.
-- These policies protect against direct client access with the anon key.

ALTER TABLE public.diagnostic_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnostic_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.process_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_redesigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_diagnostics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_responses ENABLE ROW LEVEL SECURITY;

-- Service role always has full access (bypasses RLS automatically).
-- Authenticated users can read their own data via anon key:

DROP POLICY IF EXISTS "Users read own reports" ON public.diagnostic_reports;
CREATE POLICY "Users read own reports" ON public.diagnostic_reports
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR lower(contact_email) = lower(auth.jwt()->>'email'));

DROP POLICY IF EXISTS "Users read own progress" ON public.diagnostic_progress;
CREATE POLICY "Users read own progress" ON public.diagnostic_progress
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR lower(email) = lower(auth.jwt()->>'email'));

DROP POLICY IF EXISTS "Users read own instances" ON public.process_instances;
CREATE POLICY "Users read own instances" ON public.process_instances
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR lower(email) = lower(auth.jwt()->>'email'));

DROP POLICY IF EXISTS "Users read own redesigns" ON public.report_redesigns;
CREATE POLICY "Users read own redesigns" ON public.report_redesigns
  FOR SELECT TO authenticated
  USING (
    report_id IN (
      SELECT id FROM public.diagnostic_reports
      WHERE user_id = auth.uid() OR lower(contact_email) = lower(auth.jwt()->>'email')
    )
  );

DROP POLICY IF EXISTS "Team info is readable" ON public.team_diagnostics;
CREATE POLICY "Team info is readable" ON public.team_diagnostics
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Team responses are readable by team creator" ON public.team_responses;
CREATE POLICY "Team responses are readable by team creator" ON public.team_responses
  FOR SELECT TO authenticated
  USING (
    team_id IN (
      SELECT id FROM public.team_diagnostics
      WHERE lower(created_by_email) = lower(auth.jwt()->>'email')
    )
  );

-- Allow anon (unauthenticated) users to read team info (for join page):
DROP POLICY IF EXISTS "Anon can read open teams" ON public.team_diagnostics;
CREATE POLICY "Anon can read open teams" ON public.team_diagnostics
  FOR SELECT TO anon
  USING (status = 'open');


-- ── 11. Create followup_events table ─────────────────────────
CREATE TABLE IF NOT EXISTS public.followup_events (
  id text NOT NULL DEFAULT gen_random_uuid()::text,
  report_id text NOT NULL REFERENCES public.diagnostic_reports(id) ON DELETE CASCADE,
  contact_email text NOT NULL,
  contact_name text,
  company text,
  followup_type text NOT NULL,
  scheduled_for timestamptz NOT NULL,
  sent_at timestamptz,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  CONSTRAINT followup_events_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_followup_due
  ON public.followup_events (status, scheduled_for)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_followup_report
  ON public.followup_events (report_id);

ALTER TABLE public.followup_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own followups" ON public.followup_events;
CREATE POLICY "Users read own followups" ON public.followup_events
  FOR SELECT TO authenticated
  USING (
    report_id IN (
      SELECT id FROM public.diagnostic_reports
      WHERE user_id = auth.uid() OR lower(contact_email) = lower(auth.jwt()->>'email')
    )
  );


-- ============================================================
-- Done. Verify with: SELECT tablename FROM pg_tables WHERE schemaname = 'public';
-- ============================================================
