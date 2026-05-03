-- migration-deal-connectors-rpcs.sql  (apply AFTER migration-deal-connectors.sql)
--
-- SECURITY DEFINER RPCs for storing + retrieving the encrypted OAuth
-- tokens on org_integrations. Same pattern + same Vault secret as
-- customer_api_keys: tokens are pgcrypto-encrypted with the secret
-- pulled from `vault.decrypted_secrets.model_key_encryption_secret`,
-- and never SELECTed raw through PostgREST.
--
-- The wrapper RPCs accept rotated values atomically — on re-OAuth, the
-- existing row is updated rather than insert-or-conflicted client-side
-- to avoid a brief window with no valid token.

CREATE OR REPLACE FUNCTION public.set_org_integration_tokens(
  p_org_id            uuid,
  p_provider          text,
  p_account_email     text,
  p_display_name      text,
  p_access_token      text,
  p_refresh_token     text,
  p_token_expires_at  timestamptz,
  p_scopes            text[],
  p_metadata          jsonb,
  p_actor_email       text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret text;
  v_id     uuid;
BEGIN
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'model_key_encryption_secret';
  IF v_secret IS NULL OR length(v_secret) < 16 THEN
    RAISE EXCEPTION 'Vault secret "model_key_encryption_secret" is not set (run scripts/set-model-key-encryption-secret.sql)';
  END IF;

  INSERT INTO public.org_integrations (
    org_id, provider, status, account_email, display_name,
    access_token_enc, refresh_token_enc, token_expires_at, scopes, metadata,
    created_by_email
  )
  VALUES (
    p_org_id, p_provider, 'active', p_account_email, p_display_name,
    pgp_sym_encrypt(p_access_token, v_secret),
    CASE WHEN p_refresh_token IS NULL THEN NULL ELSE pgp_sym_encrypt(p_refresh_token, v_secret) END,
    p_token_expires_at, COALESCE(p_scopes, '{}'::text[]), COALESCE(p_metadata, '{}'::jsonb),
    p_actor_email
  )
  ON CONFLICT (org_id, provider) DO UPDATE SET
    status            = 'active',
    account_email     = EXCLUDED.account_email,
    display_name      = EXCLUDED.display_name,
    access_token_enc  = EXCLUDED.access_token_enc,
    refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, public.org_integrations.refresh_token_enc),
    token_expires_at  = EXCLUDED.token_expires_at,
    scopes            = EXCLUDED.scopes,
    metadata          = EXCLUDED.metadata,
    last_sync_error   = NULL,
    updated_at        = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION public.set_org_integration_tokens(uuid,text,text,text,text,text,timestamptz,text[],jsonb,text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_org_integration_tokens(uuid,text,text,text,text,text,timestamptz,text[],jsonb,text) TO service_role;

-- Read the decrypted access token (used by the connector adapter to
-- make API calls). Refresh token is returned alongside so the adapter
-- can rotate when expired.
CREATE OR REPLACE FUNCTION public.get_org_integration_tokens(
  p_org_id   uuid,
  p_provider text
) RETURNS TABLE (
  integration_id    uuid,
  access_token      text,
  refresh_token     text,
  token_expires_at  timestamptz,
  scopes            text[],
  metadata          jsonb,
  status            text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'model_key_encryption_secret';
  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'Vault secret missing';
  END IF;

  RETURN QUERY
    SELECT i.id,
           pgp_sym_decrypt(i.access_token_enc::bytea, v_secret)::text,
           CASE WHEN i.refresh_token_enc IS NULL THEN NULL
                ELSE pgp_sym_decrypt(i.refresh_token_enc::bytea, v_secret)::text END,
           i.token_expires_at,
           i.scopes,
           i.metadata,
           i.status
      FROM public.org_integrations i
     WHERE i.org_id = p_org_id AND i.provider = p_provider
     LIMIT 1;
END
$$;

REVOKE ALL ON FUNCTION public.get_org_integration_tokens(uuid,text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_org_integration_tokens(uuid,text) TO service_role;

-- Rotate just the access token (after a successful refresh) without
-- touching the refresh token. Cheap path used by the sync worker.
CREATE OR REPLACE FUNCTION public.rotate_org_integration_access_token(
  p_integration_id   uuid,
  p_access_token     text,
  p_token_expires_at timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'model_key_encryption_secret';
  IF v_secret IS NULL THEN RAISE EXCEPTION 'Vault secret missing'; END IF;

  UPDATE public.org_integrations
     SET access_token_enc = pgp_sym_encrypt(p_access_token, v_secret),
         token_expires_at = p_token_expires_at,
         updated_at = now()
   WHERE id = p_integration_id;
END
$$;

REVOKE ALL ON FUNCTION public.rotate_org_integration_access_token(uuid,text,timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.rotate_org_integration_access_token(uuid,text,timestamptz) TO service_role;

COMMENT ON FUNCTION public.set_org_integration_tokens(uuid,text,text,text,text,text,timestamptz,text[],jsonb,text) IS
  'Insert-or-rotate OAuth tokens for an (org, provider). pgcrypto-encrypts via the Vault model_key_encryption_secret. Service-role only.';
