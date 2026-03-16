# Runbook: Common Failures & Recovery

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

## Logs

- Structured JSON logs via `lib/logger.js`
- Set `LOG_LEVEL=debug` for verbose
- Vercel: Project → Logs → filter by route, status, or search
