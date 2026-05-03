-- ============================================================
-- Customer-managed AI API keys (BYO key)
--
-- Lets an org admin paste their own Anthropic key (later: Voyage / OpenAI).
-- When set, all LLM calls billable to that org's deal/chat surfaces use the
-- customer key — Anthropic charges them directly. Our token_usage_ledger
-- still records the spend for the customer's own observability, but our
-- monthly_token_budget cap is bypassed (it's their bill, not ours).
--
-- Storage: pgcrypto symmetric encryption keyed on a Supabase Vault secret
-- (`model_key_encryption_secret`, set via scripts/set-model-key-encryption-secret.sql).
-- Vault is used because Supabase doesn't grant non-superusers permission to
-- run `ALTER DATABASE … SET …`. The secret is intentionally separate from
-- the service-role key so a service-role leak doesn't auto-leak customer keys.
--
-- Audit: every set / rotate / delete is appended to customer_api_key_audit
-- with actor email, IP-ish identifier (request id), and the action. This
-- table is append-only; readers must be org admins.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- ---------- Pre-flight: encryption secret must be configured ----------
-- This migration's RPCs are useless without the encryption secret. Fail
-- loudly here rather than letting set_customer_api_key crash on first call
-- weeks after deploy.
--
-- If you see this error, run scripts/set-model-key-encryption-secret.sql
-- first (replacing the placeholder), then re-apply this migration.
DO $$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'model_key_encryption_secret';

  IF v_secret IS NULL OR length(v_secret) < 16 THEN
    RAISE EXCEPTION
      'Vault secret "model_key_encryption_secret" is not set (or is shorter than 16 chars). '
      'Run scripts/set-model-key-encryption-secret.sql before applying this migration. '
      'See migration header + script comments for the procedure.';
  END IF;
END $$;

-- ---------- The vault ----------
CREATE TABLE IF NOT EXISTS public.customer_api_keys (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor          text        NOT NULL CHECK (vendor IN ('anthropic', 'voyage', 'openai')),

  -- pgp_sym_encrypt output. NEVER selected raw to the API; the helper RPCs
  -- are the only sanctioned read path.
  encrypted_key   bytea       NOT NULL,

  -- Display-only fingerprint: first 7 + last 4 chars of the original.
  -- Stored separately so the admin UI can show "sk-ant-...XYZW" without a
  -- decrypt round-trip on every page load.
  key_fingerprint text        NOT NULL,

  -- Operational metadata
  status          text        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'revoked')),
  last_validated_at timestamptz,
  last_used_at      timestamptz,
  rotation_due_at   timestamptz,                          -- soft warning at 90d default

  set_by_email    text        NOT NULL,
  set_by_user_id  uuid,
  set_at          timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, vendor, status)               -- only one active key per (org, vendor)
);

CREATE INDEX IF NOT EXISTS idx_customer_keys_org ON public.customer_api_keys (organization_id, vendor);
CREATE INDEX IF NOT EXISTS idx_customer_keys_rotation ON public.customer_api_keys (rotation_due_at) WHERE status = 'active';

COMMENT ON TABLE public.customer_api_keys IS
  'Encrypted BYO API keys per organisation per vendor. Decryption uses MODEL_KEY_ENCRYPTION_SECRET; never SELECT encrypted_key from the API.';
COMMENT ON COLUMN public.customer_api_keys.key_fingerprint IS
  'Display-only: first 7 + last 4 chars (e.g. sk-ant-...XYZW). Safe to ship to the browser.';

-- ---------- The audit log ----------
CREATE TABLE IF NOT EXISTS public.customer_api_key_audit (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor          text        NOT NULL,
  action          text        NOT NULL CHECK (action IN ('set', 'rotated', 'revoked', 'validated', 'used_first_time', 'rotation_reminder_sent')),
  key_fingerprint text,                                   -- snapshot at time of action
  actor_email     text,
  actor_user_id   uuid,
  request_id      text,                                   -- correlation for debugging
  details         jsonb       DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_key_audit_org ON public.customer_api_key_audit (organization_id, created_at DESC);

COMMENT ON TABLE public.customer_api_key_audit IS
  'Append-only audit of every customer-key lifecycle event. Org admins can read; nobody can update or delete.';

-- ---------- RLS ----------
-- Only org admins can read the metadata columns (NEVER encrypted_key — that's
-- enforced at the API layer because PostgREST exposes column-level grants
-- separately and this is a defence-in-depth signal). Audit is read-only by
-- org admins.

ALTER TABLE public.customer_api_keys      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_api_key_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_keys_admin ON public.customer_api_keys;
CREATE POLICY customer_keys_admin
  ON public.customer_api_keys
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members m
       WHERE m.organization_id = customer_api_keys.organization_id
         AND m.is_org_admin = true
         AND (m.user_id = auth.uid()
              OR lower(m.email) = lower(auth.jwt() ->> 'email'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_members m
       WHERE m.organization_id = customer_api_keys.organization_id
         AND m.is_org_admin = true
         AND (m.user_id = auth.uid()
              OR lower(m.email) = lower(auth.jwt() ->> 'email'))
    )
  );

DROP POLICY IF EXISTS key_audit_admin_read ON public.customer_api_key_audit;
CREATE POLICY key_audit_admin_read
  ON public.customer_api_key_audit
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members m
       WHERE m.organization_id = customer_api_key_audit.organization_id
         AND m.is_org_admin = true
         AND (m.user_id = auth.uid()
              OR lower(m.email) = lower(auth.jwt() ->> 'email'))
    )
  );

-- Audit is append-only via the RPCs below (no direct INSERT policy).

-- ---------- Server-side helpers (called via RPC by the service-role key) ----------
-- All RPCs are SECURITY DEFINER so they can read the encryption secret from
-- Supabase Vault. The Vault row is created by
-- scripts/set-model-key-encryption-secret.sql (one-time setup).

-- Encrypt + insert (or rotate) a key, write audit row atomically.
CREATE OR REPLACE FUNCTION public.set_customer_api_key(
  p_org_id      uuid,
  p_vendor      text,
  p_raw_key     text,
  p_fingerprint text,
  p_actor_email text,
  p_actor_user_id uuid,
  p_request_id  text,
  p_rotate_in_days integer DEFAULT 90
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_secret text;
  v_existing_id uuid;
  v_new_id uuid := gen_random_uuid();
  v_action text := 'set';
BEGIN
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'model_key_encryption_secret';

  IF v_secret IS NULL OR length(v_secret) < 16 THEN
    RAISE EXCEPTION 'Vault secret "model_key_encryption_secret" is not set (run scripts/set-model-key-encryption-secret.sql)';
  END IF;

  -- Revoke any existing active key for this (org, vendor); audit it as rotated.
  SELECT id INTO v_existing_id
    FROM public.customer_api_keys
   WHERE organization_id = p_org_id AND vendor = p_vendor AND status = 'active';

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.customer_api_keys
       SET status = 'revoked', updated_at = now()
     WHERE id = v_existing_id;
    v_action := 'rotated';
  END IF;

  INSERT INTO public.customer_api_keys (
    id, organization_id, vendor, encrypted_key, key_fingerprint,
    status, set_by_email, set_by_user_id, rotation_due_at
  ) VALUES (
    v_new_id, p_org_id, p_vendor,
    pgp_sym_encrypt(p_raw_key, v_secret),
    p_fingerprint,
    'active', p_actor_email, p_actor_user_id,
    now() + make_interval(days => p_rotate_in_days)
  );

  INSERT INTO public.customer_api_key_audit (
    organization_id, vendor, action, key_fingerprint,
    actor_email, actor_user_id, request_id
  ) VALUES (
    p_org_id, p_vendor, v_action, p_fingerprint,
    p_actor_email, p_actor_user_id, p_request_id
  );

  RETURN v_new_id;
END;
$$;

-- Decrypt + return the active key for an (org, vendor). Returns NULL if no
-- active key. Updates last_used_at as a side effect — cheap, no audit row
-- (would dominate the audit table); first-use is audited via mark_key_first_used.
CREATE OR REPLACE FUNCTION public.get_active_customer_api_key(
  p_org_id uuid,
  p_vendor text
)
RETURNS TABLE (raw_key text, fingerprint text, key_id uuid, set_at timestamptz, rotation_due_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'model_key_encryption_secret';

  IF v_secret IS NULL THEN RETURN; END IF;

  RETURN QUERY
    UPDATE public.customer_api_keys k
       SET last_used_at = now()
     WHERE k.organization_id = p_org_id
       AND k.vendor = p_vendor
       AND k.status = 'active'
    RETURNING
      pgp_sym_decrypt(k.encrypted_key, v_secret)::text,
      k.key_fingerprint,
      k.id,
      k.set_at,
      k.rotation_due_at;
END;
$$;

-- Audit a successful first-use (called from the helper after the first
-- successful API response per session). Lightly debounced — caller is
-- expected to only call once per process boot.
CREATE OR REPLACE FUNCTION public.audit_customer_key_event(
  p_org_id      uuid,
  p_vendor      text,
  p_action      text,
  p_actor_email text,
  p_actor_user_id uuid,
  p_request_id  text,
  p_details     jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.customer_api_key_audit (
    organization_id, vendor, action, actor_email, actor_user_id, request_id, details
  ) VALUES (
    p_org_id, p_vendor, p_action, p_actor_email, p_actor_user_id, p_request_id, p_details
  );
END;
$$;

-- Revoke (soft-delete; the row stays for audit reasons).
CREATE OR REPLACE FUNCTION public.revoke_customer_api_key(
  p_org_id      uuid,
  p_vendor      text,
  p_actor_email text,
  p_actor_user_id uuid,
  p_request_id  text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_fingerprint text;
BEGIN
  UPDATE public.customer_api_keys
     SET status = 'revoked', updated_at = now()
   WHERE organization_id = p_org_id AND vendor = p_vendor AND status = 'active'
   RETURNING key_fingerprint INTO v_fingerprint;

  IF v_fingerprint IS NULL THEN RETURN false; END IF;

  INSERT INTO public.customer_api_key_audit (
    organization_id, vendor, action, key_fingerprint,
    actor_email, actor_user_id, request_id
  ) VALUES (
    p_org_id, p_vendor, 'revoked', v_fingerprint,
    p_actor_email, p_actor_user_id, p_request_id
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.set_customer_api_key       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_active_customer_api_key FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_customer_key_event    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_customer_api_key     FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_customer_api_key       TO service_role;
GRANT EXECUTE ON FUNCTION public.get_active_customer_api_key TO service_role;
GRANT EXECUTE ON FUNCTION public.audit_customer_key_event    TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_customer_api_key     TO service_role;
