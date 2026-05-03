# Runbook: Common Failures & Recovery

## "Everything feels slow"

**First, eliminate the obvious:** are you on `next dev`? Dev mode compiles each route on first hit, runs without minification, includes React's strict-mode double-invocation, and serves modules un-bundled. **Real perf bar is `npm run build && npm start`** — typically 2-5× faster on the same hardware. If perf only matters for a specific route, hit that route once with `next dev` to warm the compile, then test.

**If still slow on production builds:**
- Check the Network tab. Slow API responses = backend issue. Slow JS parse = bundle size issue.
- Confirm `SUPABASE_JWT_SECRET` is set (saves ~200ms of `auth.getUser` round-trip per first-of-key authenticated request — see `lib/auth.js:verifyJwtLocal`).
- Confirm `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are reachable. The 800 ms allow-cache in `lib/rate-limit.js` masks Upstash latency for the second-and-onwards request from a key, but the first call still pays the full Upstash round-trip if Upstash is in a different region.
- Apply `supabase/migration-perf-indexes.sql` if not already applied.
- Run a real production build (`npm run build`) and watch the bundle-size warnings — anything > 250 kB gzip on a route is a problem.

## Supabase Unavailable

**Symptoms:** 502, "Failed to fetch report", "Storage not configured"

**Checks:**
- Verify `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in env
- Check [Supabase status](https://status.supabase.com)
- Check [Vercel dashboard](https://vercel.com) → Project → Logs for errors

**Recovery:**
- If Supabase is down: wait for recovery; no code change needed
- If credentials expired: rotate keys in Supabase dashboard, update env vars in Vercel

---

## Anthropic AI Failures

**Symptoms:** "AI not configured", "Analysis failed", 503

**Checks:**
- Verify `ANTHROPIC_API_KEY` is set and valid
- Check Anthropic rate limits / quota
- App falls back to rule-based analysis when AI fails; user still gets results

**Recovery:**
- Rotate API key if compromised
- Check Anthropic dashboard for usage

---

## Webhook / n8n Failures

**Symptoms:** Emails not sent, "webhook-status-XXX"

**Checks:**
- `N8N_SAVE_PROGRESS_WEBHOOK_URL`, `N8N_HANDOVER_WEBHOOK_URL`, `N8N_DIAGNOSTIC_COMPLETE_WEBHOOK_URL`, `N8N_TEAM_WEBHOOK_URL` correct
- n8n workflow is active and reachable
- Check logs for "Webhook error" in structured logs

**Recovery:**
- Restart n8n workflow if stuck
- Verify webhook URL in n8n matches env

---

## Follow-up API (get-followups)

**Symptoms:** 401 "Invalid or missing API key"

**Checks:**
- `FOLLOWUP_API_KEY` set in env
- n8n cron passes `X-API-Key` or `Authorization: Bearer <key>` header

**Recovery:**
- Add `FOLLOWUP_API_KEY` to Vercel env
- Update n8n HTTP request node to include header

---

## Rate Limiting

**Symptoms:** 429 "Too many requests"

**Behavior:** In-memory store; resets on cold start. Per-IP: 100 req/60s.

**Recovery:**
- User waits for retry-after (typically 60s)
- For shared rate limiting: add Upstash Redis, set `KV_REST_API_URL` and `KV_REST_API_TOKEN`

---

## Origin / CSRF Rejection

**Symptoms:** 403 "Invalid origin" on POST to process-diagnostic, survey-submit, send-diagnostic-report

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
- Inngest dashboard → `process-deal-document` function → recent runs. Failures are visible there with stack traces.
- Storage: `deal_documents.storage_path` populated? If null, upload-to-storage failed; row should already be `failed` with `processing_error`.
- Voyage rate limit / quota: if `VOYAGE_API_KEY` set but Voyage is rate-limiting, the embed step retries up to 3× and then the whole step fails.

**Recovery:**
- Run `POST /api/deals/[id]/documents/[docId]/reprocess` (with `?wipe=1` if previous chunks should be cleared first). This eagerly stales any findings citing the doc.
- If the pipeline is genuinely broken, mark the row `stored` manually so the file remains downloadable while the user investigates.

---

## OCR not running

**Symptoms:** Scanned PDFs and images land as `stored` with `processing_error: "Scanned PDF — no text layer detected. Enable OCR (MISTRAL_API_KEY) to index this document."`

**Checks:**
- Org admin path: **Org admin → API keys → Mistral (OCR)**. Active key set?
- Platform fallback: `MISTRAL_API_KEY` env set in Vercel?
- The `process-deal-document` step `extract-text` calls `ocrConfigured({ orgId })` first; if it returns false, OCR is skipped silently.

**Recovery:**
- Paste a Mistral key in org admin (preferred — billed to the org, audit-logged) or set `MISTRAL_API_KEY` env (platform fallback).
- Reprocess the affected docs.

---

## Auto-trigger analysis fired unexpectedly / not at all

**Behaviour:** `lib/deal-analysis/autoTrigger.js` queues a delta diligence run from `processDealDocument` when ALL of:
1. There is at least one prior `complete` analysis on this deal
2. No analysis is currently `pending` / `running`
3. The most recent completed analysis finished ≥ 1 hour ago (`MIN_GAP_MS`)
4. An Anthropic key resolves for the deal owner's org

**Checks:**
- `deal_analyses.auto_triggered = true` for the suspect row
- `progress_message` starts with "Auto-queued — new document landed in the data room."

**Tuning:**
- Tighter throttle: lower `MIN_GAP_MS` in `autoTrigger.js` (defaults to 60min)
- Disable entirely: comment out the `maybe-auto-trigger-analysis` step in `lib/inngest/functions/processDealDocument.js`

---

## Auth-cache staleness

**Symptoms:** A user signs out / rotates a token but the server still accepts the old JWT for up to 60 seconds.

**Behaviour:** `requireAuth` caches verifications in a per-instance Map for `min(60s, JWT exp)`. This is intentional — eliminates per-request Supabase Auth round-trips. Cache is in-memory, evicts after the TTL, and respects the JWT's own `exp` claim.

**Recovery:**
- Wait up to 60s for the cache to expire
- Or call `_clearAuthCacheForTesting()` from a test harness — not exposed in production
- For genuine emergency rotation, deploy a new function instance (every Vercel deploy is a fresh process)

---

## Logs

- Structured JSON logs via `lib/logger.js`
- Set `LOG_LEVEL=debug` for verbose
- Vercel: Project → Logs → filter by route, status, or search
