-- ============================================================
-- Per-user active operating model (multi-model-per-org switcher)
--
-- Depends on: migration-org-rbac.sql (organization_members),
--             migration-operating-model.sql (operating_models).
--
-- Until now an org had exactly one model (organizations.
-- default_operating_model_id) and every resolution path returned it,
-- so a signed-in user could never start/switch to another model.
-- This adds a per-member "active model" pointer. Resolution prefers
-- it (when set and still pointing at a model in the same org), else
-- falls back to the org default. ON DELETE SET NULL means deleting a
-- model cleanly drops anyone's preference back to the default.
--
-- Idempotent.
-- ============================================================

ALTER TABLE public.organization_members
  ADD COLUMN IF NOT EXISTS preferred_operating_model_id uuid
    REFERENCES public.operating_models(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.organization_members.preferred_operating_model_id IS
  'The member''s active operating model (multi-model switcher). NULL = use the org default. Auto-nulled if the model is deleted.';
