-- ============================================================
-- Dedupe diagnostic_reports per (operating_model_id, process_name)
--
-- Earlier seeds wrote process names under both `processes` and
-- `rawProcesses` JSONB keys, and the seed's idempotency check used only
-- `rawProcesses`. Re-runs therefore duplicated every legacy row. This
-- script collapses each (operating_model_id, process_name) pair down to
-- one row — keeping the most recently updated copy.
--
-- COALESCE handles either JSONB shape so older rows under `processes`
-- are matched alongside newer ones under `rawProcesses`.
--
-- Run once in the Supabase SQL Editor before re-running the seed.
-- ============================================================

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY operating_model_id,
                        COALESCE(diagnostic_data->'rawProcesses'->0->>'name',
                                 diagnostic_data->'processes'->0->>'name')
           ORDER BY updated_at DESC
         ) AS rn
    FROM public.diagnostic_reports
   WHERE operating_model_id IS NOT NULL
)
DELETE FROM public.diagnostic_reports dr
 USING ranked
 WHERE dr.id = ranked.id AND ranked.rn > 1;
