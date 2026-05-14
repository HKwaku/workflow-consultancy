# Runbook: Common Failures & Recovery

> Living-workspace model (2026-05). Removed surfaces (deal-analyses, redesigns, report exports, follow-ups, team surveys) have been physically deleted - if a request lands on one of those paths it 404s. See [`docs/ARCHITECTURE.html`](./docs/ARCHITECTURE.html) for the current shape.

## "Everything feels slow"

**First, eliminate the obvious:** are you on `next dev`? Dev mode compiles each route on first hit, runs without minification, includes React's strict-mode double-invocation, and serves modules un-bundled. **Real perf bar is `npm run build && npm start`** - typically 2-5x faster on the same hardware. If perf only matters for a specific route, hit that route once with `next dev` to warm the compile, then test.

**If still slow on production builds:**
- Check the Network tab. Slow API responses = backend issue. Slow JS parse = bundle size issue.
- Confirm `SUPABASE_JWT_SECRET` is set (saves ~200ms of `auth.getUser` round-trip per first-of-key authenticated request - see `lib/auth.js:verifyJwtLocal`).
- Confirm `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are reachable. The 800 ms allow-cache in `lib/rate-limit.js` masks Upstash latency for the second-and-onwards request from a key, but the first call still pays the full Upstash round-trip if Upstash is in a different region.
- Apply `supabase/migration-perf-indexes.sql` if not already applied.
- Run a real production build (`npm run build`) and watch the bundle-size warnings - anything > 250 kB gzip on a route is a problem.

## Supabase Unavailable

**Symptoms:** 502, "Failed to fetch", "Storage not configured"

**Checks:**
- Verify `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in env
- Check [Supabase status](https://status.supabase.com)
- Check [Vercel dashboard](https://vercel.com) -> Project -> Logs for errors

**Recovery:**
- If Supabase is down: wait for recovery; no code change needed
- If credentials expired: rotate keys in Supabase dashboard, update env vars in Vercel

---

## Anthropic AI Failures

**Symptoms:** "AI not configured", chat agent errors, 503 from `/api/diagnostic-chat`

**Checks:**
- Verify `ANTHROPIC_API_KEY` is set and valid (platform fallback)
- Per-org BYO: check `customer_api_keys` for the active row; consider rotating
- Check Anthropic rate limits / quota in their dashboard
- Chat-side errors surface in the SSE stream as an `error` event; the UI renders an inline retry button

**Recovery:**
- Rotate API key if compromised
- For BYO key issues: org admin re-pastes the key at **Org admin -> API keys -> Anthropic**

---

## Webhook / n8n Failures

**Symptoms:** Outbound webhooks not firing, "webhook-status-XXX" in logs

**Checks:**
- n8n webhook URLs set in Vercel env (see `.env.local.example` for the active set)
- n8n workflow is active and reachable
- Check structured logs for "Webhook error"
- Webhooks soft-fail: a missing URL or 5xx never blocks the user-facing request

**Recovery:**
- Restart n8n workflow if stuck
- Verify webhook URL matches the env var

---

## Rate Limiting

**Symptoms:** 429 "Too many requests"

**Behaviour:** Per-IP and per-user buckets. In-memory store (resets on cold start) unless Upstash Redis is configured.

**Recovery:**
- User waits for retry-after (typically 60s)
- For shared rate limiting across instances: set `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`

---

## Origin / CSRF Rejection

**Symptoms:** 403 "Invalid origin" on a POST/PUT request

**Checks:**
- `NEXT_PUBLIC_APP_URL` matches the domain users are on
- Request includes `Origin` header (browsers send this for cross-origin)

**Recovery:**
- Set `NEXT_PUBLIC_APP_URL` for production (e.g. `https://your-app.vercel.app`)
- If using custom domain, update to match

---

## Deal-document worker stuck

**Symptoms:** A deal document sits at `pending` / `parsing` / `embedding` indefinitely; workspace polling never resolves; user clicks reprocess and nothing changes.

**Checks:**
- `INNGEST_EVENT_KEY` set? Without it the upload route can't enqueue work and the row stays at `pending`.
- Inngest dashboard -> `process-deal-document` function -> recent runs. Failures are visible there with stack traces.
- Storage: `deal_documents.storage_path` populated? If null, upload-to-storage failed; row should already be `failed` with `processing_error`.
- Voyage rate limit / quota: if `VOYAGE_API_KEY` set but Voyage is rate-limiting, the embed step retries up to 3x and then the whole step fails.

**Recovery:**
- Run `POST /api/deals/[id]/documents/[docId]/reprocess` (with `?wipe=1` if previous chunks should be cleared first).
- If the pipeline is genuinely broken, mark the row `stored` manually so the file remains downloadable while the user investigates.

---

## OCR not running

**Symptoms:** Scanned PDFs and images land as `stored` with `processing_error: "Scanned PDF - no text layer detected. Enable OCR (MISTRAL_API_KEY) to index this document."`

**Checks:**
- Org admin path: **Org admin -> API keys -> Mistral (OCR)**. Active key set?
- Platform fallback: `MISTRAL_API_KEY` env set in Vercel?
- The `process-deal-document` step `extract-text` calls `ocrConfigured({ orgId })` first; if it returns false, OCR is skipped silently.

**Recovery:**
- Paste a Mistral key in org admin (preferred - billed to the org, audit-logged) or set `MISTRAL_API_KEY` env (platform fallback).
- Reprocess the affected docs.

---

## SharePoint / OneDrive connector - "Failed to persist tokens"

**Symptoms:** OAuth callback redirects with `?integration_error=Failed%20to%20persist%20tokens%3A%20<cause>`.

**Causes (the actual cause is now appended to the error message):**
- `function pgp_sym_encrypt(text, text) does not exist` -> pgcrypto not on the RPC's search_path. Run:
  ```sql
  ALTER FUNCTION public.set_org_integration_tokens(uuid,text,text,text,text,text,timestamptz,text[],jsonb,text)
    SET search_path = public, extensions, vault;
  ALTER FUNCTION public.get_org_integration_tokens(uuid,text)
    SET search_path = public, extensions, vault;
  ALTER FUNCTION public.rotate_org_integration_access_token(uuid,text,timestamptz)
    SET search_path = public, extensions, vault;
  ```
  The migration `supabase/migration-deal-connectors-rpcs.sql` now sets this up correctly for fresh deployments.
- `Could not find the function public.set_org_integration_tokens` -> migration #33 not applied. Run `supabase/migration-deal-connectors.sql` then `migration-deal-connectors-rpcs.sql`.
- `Vault secret "model_key_encryption_secret" is not set` -> `SELECT vault.create_secret('<32-byte-base64>', 'model_key_encryption_secret');`

---

## SharePoint connector - "Tenant does not have a SPO license"

**Symptoms:** OAuth completes, but the folder picker fails with `Graph /sites/root failed (400): Tenant does not have a SPO license`.

**Likely causes (in order):**
1. **The connecting account has no SPO licence** - verify by signing into `https://<tenant>.sharepoint.com` in a browser with the same account. If it 404s or shows an upsell, the account genuinely lacks SPO.
2. **Multi-tenant Entra app not consented to in the customer's tenant** - by Microsoft policy, multi-tenant apps without a Verified Publisher require admin consent before end users can use them. Without consent, OAuth succeeds but the token has no real Graph scope binding -> every Graph call returns the SPO message.
3. **Wrong account picked at the OAuth picker** - the user has multiple Microsoft accounts cached and Microsoft picked one without SPO. The OAuth flow now uses `/organizations` (work/school only), but if the user has multiple work tenants they can still pick the wrong one.

**Recovery (depending on cause):**
- For #1: M365 admin assigns a SharePoint plan to the user, or pick a different account.
- For #2: customer admin opens this URL (replace placeholders):
  `https://login.microsoftonline.com/<customer-tenant-id>/adminconsent?client_id=<vesno-app-id>` - grants org-wide consent. After that any user in that tenant can connect.
- For #2 long-term fix: register Vesno's Entra app for **Verified Publisher** (Branding & properties -> Add MPN ID). After Microsoft auto-verifies, end users in any tenant can self-consent without admin involvement.
- For #3: disconnect, reconnect, pick the correct work account at the picker. The OAuth flow forces account selection via `prompt=select_account`.

The picker also falls back to `/me/drives` and `/me/drive` (OneDrive) when SharePoint sites are unreachable, so users without SPO but with OneDrive for Business can still bind a folder.

---

## Chat agent says "no deal context" / 401 on a deal-bound chat

**Symptoms:** Reina refuses to use deal tools, saying "no deal context on this chat session", even though the user IS on a deal page.

**Checks:**
- The chat session row in `chat_sessions` has `deal_id` set
- `lib/dealAuth.js` verifies the requester is owner, collaborator, or participant on the deal. RLS will also gate the underlying read.
- `chat-deal-binding` migration applied (see `supabase/migration-chat-deal-binding.sql`)

**Recovery:**
- If the user genuinely has access, the session may have been started outside the deal scope; the workspace banner should offer "Re-anchor to this deal" - that PATCHes `chat_sessions.deal_id`.

---

## Auth-cache staleness

**Symptoms:** A user signs out / rotates a token but the server still accepts the old JWT for up to 60 seconds.

**Behaviour:** `requireAuth` caches verifications in a per-instance Map for `min(60s, JWT exp)`. This is intentional - eliminates per-request Supabase Auth round-trips. Cache is in-memory, evicts after the TTL, and respects the JWT's own `exp` claim.

**Recovery:**
- Wait up to 60s for the cache to expire
- For genuine emergency rotation, deploy a new function instance (every Vercel deploy is a fresh process)

---

## Logs

- Structured JSON logs via `lib/logger.js`
- Set `LOG_LEVEL=debug` for verbose
- Vercel: Project -> Logs -> filter by route, status, or search
