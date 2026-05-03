-- ============================================================
-- One-time setup: model-key encryption secret (Supabase Vault)
--
-- Run this ONCE per Supabase project, BEFORE applying
-- migration-customer-api-keys.sql.
--
-- We use Supabase Vault (https://supabase.com/docs/guides/database/vault)
-- because Supabase doesn't grant non-superusers permission to run
-- `ALTER DATABASE … SET app.something = …`. Vault is the platform-supported
-- equivalent: an encrypted secrets table that any role with the right grant
-- can read via the `vault.decrypted_secrets` view.
--
-- HOW TO USE
--
-- 1. Generate a 48-byte random secret on YOUR LAPTOP, in a terminal. Don't
--    use an online tool, an LLM, or paste through any web surface other
--    than the Supabase SQL editor itself. Pick one:
--      openssl rand -base64 48
--      python3 -c "import secrets; print(secrets.token_urlsafe(48))"
--      node    -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
--
-- 2. Find the line below that reads:   v_secret_value text := 'PASTE_YOUR_GENERATED_SECRET_HERE';
--    Replace ONLY the placeholder text PASTE_YOUR_GENERATED_SECRET_HERE
--    with the value from step 1. Leave the surrounding single-quotes in
--    place. Do NOT touch the IF check on the next line — it must still
--    refer to the literal placeholder string so it can detect a forgotten
--    replacement.
--
-- 3. Copy the WHOLE FILE into the Supabase SQL editor (Dashboard → SQL
--    editor → New query) and run.
--
-- 4. Verify with:
--      SELECT name, length(decrypted_secret) AS chars
--        FROM vault.decrypted_secrets
--       WHERE name = 'model_key_encryption_secret';
--    Should return one row with chars >= 16.
--
-- 5. Then apply migration-customer-api-keys.sql.
--
-- 6. REVERT YOUR LOCAL EDIT so the file goes back to the placeholder
--    (`git checkout scripts/set-model-key-encryption-secret.sql`). Never
--    commit a file containing the actual secret.
--
-- COMMON MISTAKES
--
-- - "You forgot to replace the placeholder" error fires when the variable
--   still equals the literal placeholder string. Causes: (a) you replaced
--   the check string by mistake — only edit the `v_secret_value text :=`
--   line; (b) the SQL editor cached an old paste — clear the editor,
--   re-paste the whole file; (c) you accidentally left the `'PASTE_…'`
--   surrounding single-quotes off the new value.
--
-- - "Secret too short" — your replacement is < 16 chars. Re-generate.
--
-- ROTATING THE SECRET
--
-- Re-running this script (with vault.update_secret) WILL break decryption of
-- every existing customer key. Plan: (a) revoke all customer keys via the
-- admin UI, (b) rotate the secret, (c) ask org admins to re-paste their keys.
-- There is no automated re-encryption path; that's intentional — a rotation
-- is rare enough that manual is safer than wrong-key cipher.
-- ============================================================

-- Vault is enabled by default on hosted Supabase; the CREATE EXTENSION below
-- is a no-op there but keeps the script portable to self-hosted setups.
CREATE EXTENSION IF NOT EXISTS supabase_vault;

DO $$
DECLARE
  -- ───────────────── EDIT THIS LINE ONLY ─────────────────
  v_secret_value text := 'PASTE_YOUR_GENERATED_SECRET_HERE';
  -- ───────────────────────────────────────────────────────
  v_existing_id  uuid;
BEGIN
  -- Defence: catch a forgotten-or-mistyped replacement. Both placeholder
  -- spellings are checked so the error is helpful even if you swapped the
  -- old name for the new one and back again.
  IF v_secret_value IN ('PASTE_YOUR_GENERATED_SECRET_HERE', 'REPLACE_ME_WITH_RANDOM_SECRET', '', 'YOUR_SECRET_HERE') THEN
    RAISE EXCEPTION
      'Placeholder still in place. Edit the v_secret_value line above '
      'and replace PASTE_YOUR_GENERATED_SECRET_HERE with the secret you '
      'generated locally. Do NOT change the IF check — only the assignment.';
  END IF;

  IF length(v_secret_value) < 16 THEN
    RAISE EXCEPTION 'Secret too short (% chars). Use at least 16; aim for 48 random bytes (base64).', length(v_secret_value);
  END IF;

  -- Idempotent set: insert if absent, update if present. Vault enforces a
  -- unique name index, so we look up first.
  SELECT id INTO v_existing_id FROM vault.secrets WHERE name = 'model_key_encryption_secret';

  IF v_existing_id IS NULL THEN
    PERFORM vault.create_secret(
      v_secret_value,
      'model_key_encryption_secret',
      'Symmetric key for pgp_sym_encrypt of customer-managed AI API keys. Rotation breaks every existing key — see scripts/set-model-key-encryption-secret.sql header.'
    );
    RAISE NOTICE 'Vault secret model_key_encryption_secret created (% chars).', length(v_secret_value);
  ELSE
    PERFORM vault.update_secret(v_existing_id, v_secret_value);
    RAISE NOTICE 'Vault secret model_key_encryption_secret ROTATED (% chars). EVERY EXISTING CUSTOMER KEY IS NOW UNDECRYPTABLE — see runbook.', length(v_secret_value);
  END IF;
END $$;

-- Verification (run in a fresh session if you can't see the row immediately):
--   SELECT name, length(decrypted_secret) AS chars, created_at, updated_at
--     FROM vault.decrypted_secrets
--    WHERE name = 'model_key_encryption_secret';
