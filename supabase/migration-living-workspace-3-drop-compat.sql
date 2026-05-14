-- Living-workspace migration — Phase 3: drop the compatibility view
--
-- Only run this AFTER every application callsite has been updated to
-- read from `processes` directly. While the view exists, old code
-- using `from('diagnostic_reports')` keeps working (read-only — the
-- view doesn't expose writes). Drop it once the last reference is
-- gone.
--
-- Quick check before running this:
--
--   grep -RIn "diagnostic_reports" app/ lib/ components/ --exclude-dir=node_modules
--
-- Should return zero results outside of migration SQL files and old
-- markdown notes.

BEGIN;

DROP VIEW IF EXISTS public.diagnostic_reports;

COMMIT;
