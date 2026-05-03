-- migration-deal-analysis-auto-trigger.sql
--
-- Adds `auto_triggered` to deal_analyses so we can distinguish runs
-- the worker queued automatically (after a doc landed in the data room)
-- from runs the user kicked off explicitly. The workspace modal uses
-- this flag to badge "N new findings since last run" without conflating
-- delta-run noise with intentional re-analyses.

ALTER TABLE public.deal_analyses
  ADD COLUMN IF NOT EXISTS auto_triggered boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_deal_analyses_deal_status_created
  ON public.deal_analyses (deal_id, status, created_at DESC);

COMMENT ON COLUMN public.deal_analyses.auto_triggered IS
  'true when the run was queued by processDealDocument after a new doc finished processing; false when a user explicitly hit Analyse.';
