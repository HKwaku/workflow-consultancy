-- migration-diagnostic-mode-pillars.sql
--
-- Widens the CHECK constraint on diagnostic_reports.diagnostic_mode to cover
-- the values the application actually uses today.
--
-- Background: scripts/migration-schema-fixes-2.sql added
--     CHECK (diagnostic_mode IN ('comprehensive', 'quick', 'team')) NOT VALID
-- before the four-pillar refactor. After that refactor the application can
-- emit any of:
--     comprehensive   -- legacy long-form audit
--     map-only        -- legacy quick map (ships in current production data)
--     team            -- legacy team-alignment flow
--     quick           -- legacy fast intake (kept for back-compat)
--     pe              -- private-equity roll-up pillar
--     ma              -- M&A pillar
--     scaling         -- high-growth single-company pillar
--     high-risk-ops   -- regulated-workflow pillar
--
-- The old constraint silently blocks `pe` / `ma` / `scaling` / `high-risk-ops`
-- inserts (PGRST 23514). New rows that should be tagged with their pillar
-- (deal-bound diagnostics, seeded test data) all hit it. Drop and re-create
-- with the full set.
--
-- Idempotent: drops the constraint if it exists by name, then re-adds with
-- the full enum. Existing rows are accepted (every one matches the new set).

ALTER TABLE public.diagnostic_reports
  DROP CONSTRAINT IF EXISTS chk_diagnostic_mode;

ALTER TABLE public.diagnostic_reports
  ADD CONSTRAINT chk_diagnostic_mode
  CHECK (diagnostic_mode IN (
    'comprehensive',
    'map-only',
    'team',
    'quick',
    'pe',
    'ma',
    'scaling',
    'high-risk-ops'
  ));

COMMENT ON CONSTRAINT chk_diagnostic_mode ON public.diagnostic_reports IS
  'Allowed diagnostic_mode values. Pillar values (pe / ma / scaling / high-risk-ops) match lib/modules/index.js; legacy values (comprehensive / map-only / team / quick) are kept for back-compat with rows created pre-refactor.';
