-- ============================================================
-- Per-org model allowlist + default
--
-- Lets an org admin pick which Anthropic models their users can select
-- from in the chat picker. Two columns on `organizations`:
--
--   allowed_models text[]   - subset of catalogue ids, NULL = inherit
--                              the platform's default (only sonnet-4-6 for
--                              platform-key orgs; the full catalogue for
--                              BYO-key orgs that haven't customised).
--   default_model  text     - which one the picker pre-selects. NULL =
--                              first item in allowed_models, else
--                              SAFE_FALLBACK_MODEL_ID at the app layer.
--
-- No CHECK constraint on the array values: the catalogue lives in code
-- (lib/agents/modelCatalogue.js) and changes more often than schema; the
-- API layer validates against the catalogue and refuses unknown ids before
-- the row is written.
-- ============================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS allowed_models text[],
  ADD COLUMN IF NOT EXISTS default_model  text;

COMMENT ON COLUMN public.organizations.allowed_models IS
  'Optional subset of model ids (from lib/agents/modelCatalogue.js) the org allows. NULL = use platform-tier default.';
COMMENT ON COLUMN public.organizations.default_model IS
  'Optional pre-selected model for the chat picker. Must be a member of allowed_models if both are set.';
