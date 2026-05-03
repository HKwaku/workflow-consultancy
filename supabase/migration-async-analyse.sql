-- ============================================================
-- Async deal analysis — schema additions
--
-- The analyse route used to be a 60-120s SSE stream. We've moved the heavy
-- lift into an Inngest function (`runDealAnalysis`). The route now inserts
-- a `pending` row into deal_analyses, fires an Inngest event, and returns
-- immediately. The client polls a new status endpoint until status flips
-- to 'complete' or 'failed'.
--
-- Adds:
--   deal_analyses.progress_message text — worker writes the current step
--     here; the polling endpoint surfaces it so the user sees what's
--     happening. Examples:
--       "Loading deal context…"
--       "Grounding in 12 document excerpts…"
--       "Drafting the diligence memo…"
--       "Validating citations…"
--       "Saving findings…"
--
--   deal_analyses.estimated_tokens integer — captured at preflight, lets
--     the polling UI show "this should take roughly X minutes."
--
-- The existing `status` enum already supports the lifecycle:
--   pending → running → complete | failed
-- We just start writing 'pending' instead of 'complete' on insert.
-- ============================================================

ALTER TABLE public.deal_analyses
  ADD COLUMN IF NOT EXISTS progress_message text,
  ADD COLUMN IF NOT EXISTS estimated_tokens integer;

COMMENT ON COLUMN public.deal_analyses.progress_message IS
  'Latest step description set by the runDealAnalysis Inngest worker. Surfaced to the polling client. Cleared on completion.';
COMMENT ON COLUMN public.deal_analyses.estimated_tokens IS
  'Token estimate captured at preflight. Used by the polling UI to size the progress bar.';

-- Index supports the polling endpoint: GET .../analyses/{id}/status — a PK
-- lookup that's already fast, but we add (id, status) covering for the
-- common case where we read both columns in one fetch.
CREATE INDEX IF NOT EXISTS idx_deal_analyses_status_lookup
  ON public.deal_analyses (id, status);
