-- Living-workspace migration — Phase 1: schema reshape
--
-- Renames diagnostic_reports → processes, drops snapshot/deliverable
-- tables, reparents findings to deals, renames report_id columns to
-- process_id, and creates compatibility views so the existing app code
-- keeps reading from the old names until Phase 2 swaps the callsites.
--
-- Reversible up to DROP TABLE / DROP COLUMN — read carefully, run in
-- a transaction, take a backup first.

BEGIN;

-- ──────────────────────────────────────────────────────────────────
-- 1. Rename the primary table
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE public.diagnostic_reports RENAME TO processes;
ALTER INDEX IF EXISTS diagnostic_reports_pkey RENAME TO processes_pkey;

-- The flow data column was named for the "diagnostic" intake; rename
-- to flow_data so it stops implying a one-shot intake artefact.
ALTER TABLE public.processes RENAME COLUMN diagnostic_data TO flow_data;

-- ──────────────────────────────────────────────────────────────────
-- 2. Drop snapshot-only / lead-gen columns from processes
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE public.processes
  DROP COLUMN IF EXISTS cost_analysis,
  DROP COLUMN IF EXISTS cost_analysis_status,
  DROP COLUMN IF EXISTS cost_analysis_token,
  DROP COLUMN IF EXISTS cost_analysis_token_expires_at,
  DROP COLUMN IF EXISTS target_data,
  DROP COLUMN IF EXISTS state_kind,
  DROP COLUMN IF EXISTS lead_score,
  DROP COLUMN IF EXISTS lead_grade,
  DROP COLUMN IF EXISTS display_code,
  DROP COLUMN IF EXISTS automation_grade,
  DROP COLUMN IF EXISTS automation_percentage,
  DROP COLUMN IF EXISTS total_annual_cost,
  DROP COLUMN IF EXISTS potential_savings,
  DROP COLUMN IF EXISTS contributor_emails,
  DROP COLUMN IF EXISTS deal_role,
  DROP COLUMN IF EXISTS diagnostic_mode,
  DROP COLUMN IF EXISTS design_owner_email;

-- ──────────────────────────────────────────────────────────────────
-- 3. Drop snapshot / deliverable tables
-- ──────────────────────────────────────────────────────────────────

-- Reparent findings to deal_id BEFORE dropping deal_analyses.
-- Findings are now live editable rows attached to the deal, not
-- frozen outputs of an analysis run.
ALTER TABLE public.deal_findings
  DROP CONSTRAINT IF EXISTS deal_findings_analysis_id_fkey,
  DROP COLUMN IF EXISTS analysis_id;
ALTER TABLE public.deal_finding_reviews
  DROP CONSTRAINT IF EXISTS deal_finding_reviews_analysis_id_fkey,
  DROP COLUMN IF EXISTS analysis_id;
ALTER TABLE public.deal_finding_comments
  DROP CONSTRAINT IF EXISTS deal_finding_comments_analysis_id_fkey,
  DROP COLUMN IF EXISTS analysis_id;

DROP TABLE IF EXISTS public.deal_analyses CASCADE;
DROP TABLE IF EXISTS public.report_redesigns CASCADE;
DROP TABLE IF EXISTS public.chat_artefacts CASCADE;
DROP TABLE IF EXISTS public.team_responses CASCADE;
DROP TABLE IF EXISTS public.team_diagnostics CASCADE;
DROP TABLE IF EXISTS public.diagnostic_progress CASCADE;
DROP TABLE IF EXISTS public.followup_events CASCADE;

-- ──────────────────────────────────────────────────────────────────
-- 4. Strip snapshot framing from chat tables
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE public.chat_messages
  DROP COLUMN IF EXISTS artefact_id;

ALTER TABLE public.chat_sessions
  DROP COLUMN IF EXISTS process_snapshot;

-- chat_sessions.kind used to include 'redesign', 'cost', 'report' —
-- all snapshot-flavoured. Restrict to the live modes.
ALTER TABLE public.chat_sessions
  DROP CONSTRAINT IF EXISTS chat_sessions_kind_check;
UPDATE public.chat_sessions
  SET kind = 'map'
  WHERE kind NOT IN ('map', 'copilot');
ALTER TABLE public.chat_sessions
  ADD CONSTRAINT chat_sessions_kind_check
  CHECK (kind = ANY (ARRAY['map'::text, 'copilot'::text]));

-- ──────────────────────────────────────────────────────────────────
-- 5. Drop redesign concept from changes
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE public.changes
  DROP CONSTRAINT IF EXISTS changes_redesign_id_fkey,
  DROP COLUMN IF EXISTS redesign_id;

ALTER TABLE public.changes
  DROP CONSTRAINT IF EXISTS changes_subject_type_check;
UPDATE public.changes
  SET subject_type = 'process'
  WHERE subject_type = 'redesign';
ALTER TABLE public.changes
  ADD CONSTRAINT changes_subject_type_check
  CHECK (subject_type = ANY (ARRAY[
    'process'::text, 'process_step'::text, 'handoff'::text,
    'cost_input'::text, 'deal_finding'::text,
    'participant'::text, 'document'::text
  ]));

-- ──────────────────────────────────────────────────────────────────
-- 6. Rename report_id → process_id everywhere
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE public.process_systems     RENAME COLUMN report_id TO process_id;
ALTER TABLE public.process_instances   RENAME COLUMN report_id TO process_id;
ALTER TABLE public.discovery_sessions  RENAME COLUMN report_id TO process_id;
ALTER TABLE public.changes             RENAME COLUMN report_id TO process_id;
ALTER TABLE public.chat_sessions       RENAME COLUMN report_id TO process_id;
ALTER TABLE public.deal_flows          RENAME COLUMN report_id TO process_id;
ALTER TABLE public.deal_participants   RENAME COLUMN report_id TO process_id;

-- ──────────────────────────────────────────────────────────────────
-- 7. Compatibility view — old code keeps reading `diagnostic_reports`
-- ──────────────────────────────────────────────────────────────────
-- Lets Phase 2 (code swap) run incrementally. Drop the view in
-- Phase 3 once every callsite is migrated.
CREATE OR REPLACE VIEW public.diagnostic_reports AS
  SELECT
    id,
    contact_email,
    contact_name,
    company,
    flow_data AS diagnostic_data,
    created_at,
    updated_at,
    user_id,
    deal_id,
    organization_id,
    operating_model_id,
    function_id
  FROM public.processes;

COMMIT;
