# Backup + restore runbook

> **Last drill:** never (TODO date the first one)
> **Cadence:** quarterly
> **Owner:** TODO assign

This is the procedure for verifying that Vesno can be restored from a Supabase backup. Until you've actually run it once, your backups are theoretical.

## Why we do this

A restore runbook only works if it's been tested. The first time you discover your backups are broken should not be the day production data is gone. Quarterly drills against a fresh Supabase project catch:

- Missing or rotated env vars
- Vault state that won't decrypt cross-project
- Storage bucket contents that didn't get backed up
- Migrations that drift from prod schema
- The ten things you assumed but never wrote down

## Pre-requisites

### Things you need on hand BEFORE starting

| Item | Where it lives | Notes |
|------|----------------|-------|
| Supabase Pro plan or higher | Existing project | Daily backups + PITR require Pro |
| Original `model_key_encryption_secret` | Your password manager + the team runbook | **Vault state in pg_dump can't be decrypted without this** when restoring to a different project |
| Supabase service-role key for the restore project | Will be generated on creation | |
| Anthropic API key | Existing or test key | Required to verify the chat works post-restore |
| `CRON_SECRET` for the restore env | Generate fresh | |
| Access to Vercel project settings | Restore env vars | |

### Things you should NOT need

- Customer Anthropic keys — the test will be against your platform key
- Voyage / Inngest keys — restore proves DB integrity, not the worker pipeline. Test those separately.

## The drill — first time

Block out 90 minutes. Put a calendar invite on it.

### Phase 1 — Set up the staging restore project (15 min)

1. In the Supabase dashboard, create a new project named `vesno-restore-drill-YYYY-MM-DD`. Pick the smallest plan that supports Vault (Pro). Different region from prod is fine.
2. Note the new project URL + service-role key. Save in 1Password under "Vesno DR drill".
3. Enable extensions: `vector`, `pg_trgm`, `pgcrypto`, `supabase_vault`. Database → Extensions.
4. Create the `deal-documents` storage bucket via Storage UI (private).

### Phase 2 — Restore the backup (15 min)

Two paths depending on Supabase tier:

**Same-project restore (Pro PITR):**
1. Project → Database → Backups.
2. Pick yesterday's snapshot, click Restore.
3. Wait. This is destructive in-place — DON'T do this on production. The drill version is to spin up a clone first.

**Cross-project restore (downloaded snapshot):**
1. Download yesterday's backup (`.dump.gz`) from the prod project.
2. In the staging project: `psql $STAGING_URL -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"` to start clean.
3. `pg_restore --dbname=$STAGING_URL --no-owner --no-acl prod-backup-2026-XX-XX.dump`.
4. Expect a few errors about extensions / role grants — those are usually fine. Real errors will be obvious (FK violations, missing tables).

### Phase 3 — Restore the Vault secret (10 min — the gotcha)

`pg_dump` includes the `vault.secrets` table, but the per-project encryption key it relies on is project-scoped on hosted Supabase. **A restore into a different project leaves you with encrypted Vault rows you can't decrypt.**

To fix:

1. In the staging project, re-run `scripts/set-model-key-encryption-secret.sql` with the **original** secret value from your password manager. The script's `vault.update_secret` path will replace the encrypted-at-rest copy with one the staging project can decrypt.

2. Verify:
   ```sql
   SELECT name, length(decrypted_secret) AS chars
     FROM vault.decrypted_secrets
    WHERE name = 'model_key_encryption_secret';
   ```
   Should return one row with `chars >= 16`.

3. Test that an existing customer key decrypts:
   ```sql
   SELECT raw_key IS NOT NULL AS decryptable
     FROM get_active_customer_api_key('<some-known-org-id>'::uuid, 'anthropic');
   ```
   `decryptable` should be `true`. If it's `false` or NULL, your restored Vault secret doesn't match what was used to encrypt the customer keys → you've discovered your backups are broken (or the secret in your password manager is wrong).

### Phase 4 — Smoke-test the application against the restored DB (30 min)

1. Spin up a Vercel preview deployment pointed at the staging Supabase project. Set:
   - `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY` (staging project)
   - `ANTHROPIC_API_KEY` (test key)
   - `CRON_SECRET` (fresh)
   - All the optional vars from `.env.example` you want to test
2. Hit the deployed URL.
3. **Sign in as a known user.** Their `auth.users` row should exist; sign-in should work; their email should match.
4. **Open a deal you know exists.** Documents list should populate. Visibility filtering should still work (try as different roles if you can).
5. **Send a chat message.** Confirm the model picker still shows the org's allowlist. Confirm the message goes through.
6. **Trigger a cron manually:**
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" https://staging-url/api/cron/reset-budgets
   ```
   Should return `{ ok: true, ... }`.

### Phase 5 — Document + clean up (10 min)

1. Update the "Last drill" date at the top of this file.
2. Note any findings — schema drift, missing setup steps, broken assumptions.
3. **Delete the staging Supabase project** to avoid the bill. Confirm via Project → Settings → General → Delete project.
4. Calendar the next drill (90 days out).

## Things that have broken in past drills

(Add findings here as drills happen. Empty until the first run.)

## What we explicitly do NOT test in the standard drill

- **Storage bytes restoration** — the `deal-documents` bucket isn't included in pg_dump. Supabase Storage has its own backup mechanism (PITR) but we don't use it here. If you need to test storage restore, use Supabase's Storage backup feature separately.
- **Customer Anthropic key decryption end-to-end** — Phase 3 step 3 verifies the keys decrypt; we don't actually call Anthropic with one. The customer key check is a sufficient proxy.
- **Inngest function replay** — Inngest cloud holds its own state. Restoring DB doesn't restore in-flight events.
- **n8n workflow state** — separate vendor.

If any of those become production-critical, add a phase here.

## Failure modes to watch for

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Phase 3 step 3 returns `false` | Vault secret mismatch | Find the right historical secret. If you can't, every customer must re-paste their key. |
| Phase 4 step 3 fails with "User not found" | auth.users table not restored | Check pg_restore output for errors on `auth.*` tables. Supabase sometimes excludes auth from public-schema dumps. |
| Phase 4 step 4 shows no documents | Wrong Storage bucket. RLS misconfigured. Storage rows separate from DB rows. | Verify bucket exists + check RLS policies via Database → Authentication → Policies. |
| Cron returns 401 | `CRON_SECRET` mismatch with the curl call. | Check the env var actually deployed; redeploy if needed. |

## Disaster recovery (real, not drill)

If production DB is genuinely lost:

1. **Communicate first.** Even before fixing — post on the status page (TODO: build status page), email customers via n8n. Estimate downtime.
2. **Decide RPO vs RTO trade-off.** PITR can restore to any point in the last 7 days. Pick the most recent point before the corruption / loss event.
3. **Restore in-place** if possible (Phase 2 same-project path). It's faster than cross-project.
4. **Don't skip Phase 3.** Even an in-place restore can leave Vault state in an inconsistent state if the backup was mid-write.
5. **Run the smoke test** before re-opening to customers.
6. **Post-mortem within 48 hours.** What broke, what we'd do differently.
