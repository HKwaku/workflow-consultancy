-- migration-deal-connectors.sql
--
-- Adapter layer for external document sources. The diligence platform we
-- compete with on AI quality stops competing with us on storage by
-- letting customers keep their documents in SharePoint / Google Drive /
-- Datasite / Box. Connectors are *adapters* that fan out into the
-- existing `deal-document.uploaded` Inngest event, so everything
-- downstream (parse → chunk → embed → categorise → findings) works
-- unchanged.
--
-- Two new tables:
--
--   1. org_integrations         — per-org OAuth connection (one row per
--                                 (org, provider). Re-OAuthing replaces
--                                 the row.)
--   2. deal_connector_bindings  — per-deal "pull from THIS folder on
--                                 THIS integration" pointer. One deal
--                                 can have many.
--
-- Plus two columns on deal_documents to track provenance + a new
-- `archived` status for files deleted at the source.

-- ──────────────────────────────────────────────────────────────────────
-- 1. org_integrations
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_integrations (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider           text        NOT NULL
                       CHECK (provider IN ('sharepoint','google_drive','datasite','box')),
  status             text        NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','revoked','expired','error')),
  display_name       text,
  account_email      text,
  -- Encrypted via pgcrypto pgp_sym_encrypt + the same Vault secret used by
  -- customer_api_keys (`model_key_encryption_secret`). Never SELECTed
  -- through PostgREST — only via SECURITY DEFINER RPCs.
  access_token_enc   text,
  refresh_token_enc  text,
  token_expires_at   timestamptz,
  scopes             text[]      DEFAULT '{}',
  -- Provider-specific data: SharePoint tenant id + drive id; Drive about/me id; Datasite project id; etc.
  metadata           jsonb       DEFAULT '{}'::jsonb,
  last_sync_at       timestamptz,
  last_sync_error    text,
  created_by_email   text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_org_integrations_org
  ON public.org_integrations (org_id, status);

COMMENT ON TABLE public.org_integrations IS
  'Per-org OAuth connections to external document sources. One row per (org, provider). Tokens are pgcrypto-encrypted; never SELECT through PostgREST.';

-- ──────────────────────────────────────────────────────────────────────
-- 2. deal_connector_bindings
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.deal_connector_bindings (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id            uuid        NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  integration_id     uuid        NOT NULL REFERENCES public.org_integrations(id) ON DELETE CASCADE,
  -- Provider-specific source pointer. Examples:
  --   SharePoint:    { drive_id, item_id, site_id }
  --   Google Drive:  { folder_id }
  --   Datasite:      { project_id, folder_id }
  source_ref         jsonb       NOT NULL,
  display_path       text,
  -- Maps onto deal_documents.source_party for ingested files (so the
  -- diligence prompt + visibility filtering still work).
  source_party       text,
  visibility         text        DEFAULT 'all_editors',
  sync_status        text        NOT NULL DEFAULT 'pending'
                       CHECK (sync_status IN ('pending','syncing','active','paused','error')),
  last_sync_at       timestamptz,
  last_sync_error    text,
  next_sync_after    timestamptz,
  -- Provider's delta token / change cursor — only fetch what's new since
  -- last sync. SharePoint: Graph delta link. Drive: changes.startPageToken.
  delta_cursor       text,
  created_by_email   text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deal_connector_bindings_deal
  ON public.deal_connector_bindings (deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_connector_bindings_due
  ON public.deal_connector_bindings (next_sync_after)
  WHERE sync_status = 'active';
CREATE INDEX IF NOT EXISTS idx_deal_connector_bindings_integration
  ON public.deal_connector_bindings (integration_id);

COMMENT ON TABLE public.deal_connector_bindings IS
  'Per-deal "sync this folder from this integration" pointer. The sync worker walks bindings whose next_sync_after has elapsed.';

-- ──────────────────────────────────────────────────────────────────────
-- 3. Provenance + archived status on deal_documents
-- ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.deal_documents
  ADD COLUMN IF NOT EXISTS connector_binding_id uuid
    REFERENCES public.deal_connector_bindings(id) ON DELETE SET NULL;

ALTER TABLE public.deal_documents
  ADD COLUMN IF NOT EXISTS source_external_id text;

CREATE INDEX IF NOT EXISTS idx_deal_documents_external
  ON public.deal_documents (connector_binding_id, source_external_id);

-- Add `archived` to the status enum — used when a file is deleted at the
-- source. Soft-delete preserves existing finding citations rather than
-- breaking them. Reviewers can purge explicitly via the Delete button.
ALTER TABLE public.deal_documents
  DROP CONSTRAINT IF EXISTS deal_documents_status_check;
ALTER TABLE public.deal_documents
  ADD CONSTRAINT deal_documents_status_check
  CHECK (status IN ('pending','parsing','embedding','ready','stored','failed','archived'));

COMMENT ON COLUMN public.deal_documents.connector_binding_id IS
  'Set when this document was ingested via a connector binding. NULL for direct uploads. Used by the sync worker to dedupe by source_external_id.';
COMMENT ON COLUMN public.deal_documents.source_external_id IS
  'Provider-stable file id (SharePoint driveItem id, Drive file id, etc.). Unique per binding so re-syncs update the existing row instead of creating duplicates.';
