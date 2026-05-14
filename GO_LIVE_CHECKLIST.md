# Go-live checklist

> **Living document.** Tick boxes as you complete each step. The order is roughly the order you'd do them in; some can run in parallel (legal review, vendor signups).
>
> Last updated: 2026-05-13 - reflects living-workspace model. The architecture overview is in [`docs/ARCHITECTURE.html`](./docs/ARCHITECTURE.html).

This is the **single source of truth** for everything that needs to happen between "engineering done" and "real customer paying us." Engineering is mostly complete; what's left is procedural, vendor signups, legal, and people-process.

If you're a developer adding a new dependency or capability that requires a manual step in production: add it here in the right section.

---

## 🟢 Phase 0 — Prerequisites (must be done first)

These block everything else. Do them now.

### Database setup

- [ ] **Apply all migrations in order.** Open `supabase/MIGRATIONS.md`; run every file in the `supabase/` folder via the Supabase SQL editor, in the documented order. Stop and shout if any fails. **Migration 24 (`migration-deal-findings-table.sql`) includes a backfill block** — for an existing project with historical analyses, the SQL editor will print `Backfill done: X of Y analyses have findings in deal_findings.` Verify the X equals or matches Y; gaps are usually pre-shape-normalisation rows.
- [ ] **Set the model encryption secret in Supabase Vault.** Open `scripts/set-model-key-encryption-secret.sql`, replace the placeholder with `openssl rand -base64 48` output, run via SQL editor, **revert the file edit** (`git checkout`) so the secret never hits git. Verify with: `SELECT name, length(decrypted_secret) FROM vault.decrypted_secrets WHERE name = 'model_key_encryption_secret';`
- [ ] **Create the `deal-documents` storage bucket.** Supabase → Storage → New bucket → name `deal-documents`, **Public: off**. Migration tries to do this via SQL but is skipped on some Supabase tiers.
- [ ] **Create your platform-admin user.** Sign up via the app, then in SQL: insert an `organizations` row + `organization_members` row with `is_org_admin = true` and full entitlements.

### Required env vars in Vercel (Production scope)

- [ ] `ANTHROPIC_API_KEY`
- [ ] `NEXT_PUBLIC_SUPABASE_URL`
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `WEBHOOK_SIGNING_SECRET` (`openssl rand -base64 32`) - HMAC signs any outbound n8n webhooks
- [ ] `PLATFORM_ADMIN_TRANSFER_EMAIL` - required for the GDPR cron; if unset, the cron silently skips deal ownership transfer
- [ ] `NEXT_PUBLIC_SITE_URL` - your production URL

See `.env.example` for the full set with descriptions.

### Optional env vars (degrade gracefully when missing)

- [ ] `VOYAGE_API_KEY` — without it, semantic search collapses to keyword-only
- [ ] `MISTRAL_API_KEY` — platform fallback for the dataroom OCR pass on scanned PDFs / images. Preferred path is per-org under **Org admin → API keys → Mistral (OCR)** instead. Without any Mistral key, scanned PDFs land as `stored` (downloadable but not text-indexed).
- [ ] `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` — without these, document uploads stay at `pending` forever (the reaper cron retries but Inngest never fires)
- [ ] `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` — without these, errors only land in console
- [ ] `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` — without these, rate limiting is per-Lambda only
- [ ] `CRON_SECRET` — Vercel auto-injects this on cron invocations; only set manually if you want to call crons via curl
- [ ] `MODEL_KEY_ENCRYPTION_SECRET` — required for any per-org BYO API keys (Anthropic / Voyage / OpenAI / Mistral) — pgcrypto encryption secret

---

## 🔵 Phase 1 — Vendor signups + integrations

Each is a paid-or-free signup outside the codebase.

### Inngest (async worker)

- [ ] Sign up at https://app.inngest.com (free tier covers ≤50k function runs / 25k step runs per month + concurrency cap of 5 per function)
- [ ] Create an app named `workflow-consultancy-prod`
- [ ] Settings → Event Keys → copy production key → set `INNGEST_EVENT_KEY` in Vercel
- [ ] Settings → Signing Keys → copy production key → set `INNGEST_SIGNING_KEY` in Vercel
- [ ] Re-deploy
- [ ] Inngest dashboard -> Apps -> **Sync new app** -> URL: `https://<your-host>/api/inngest`
- [ ] Verify the two registered functions appear in the Functions tab: `process-deal-document`, `sync-connector-binding`
- [ ] Upload a small PDF in a deal as a smoke test; watch the document run appear under Runs (steps: download -> extract -> chunk -> embed -> mark-ready)

Inngest free tier caps function concurrency at 5. `syncConnectorBinding` declares `concurrency: { limit: 5 }`. On a paid Inngest plan you can bump higher but document throughput rarely needs it at small/mid scale.

After any code change to a function, **re-sync the app in Inngest** (Apps -> click app -> Sync) so the dashboard picks up the new function definition.

### Voyage AI (embeddings)

- [ ] Sign up at https://voyageai.com (200M tokens free, then $0.18/1M)
- [ ] Generate API key → set `VOYAGE_API_KEY` in Vercel
- [ ] Re-deploy
- [ ] Upload a document; verify in SQL: `SELECT count(*) FROM deal_document_chunks WHERE embedding IS NOT NULL;` should be > 0 within ~30s

### Mistral (dataroom OCR — optional but recommended for diligence)

- [ ] Sign up at https://console.mistral.ai (pay-per-page; cheap)
- [ ] Generate an API key
- [ ] **Preferred path:** sign in as an org admin, open `/org-admin` → API keys → Mistral (OCR), paste the key. Audit-logged + per-org billing.
- [ ] **Or platform fallback:** set `MISTRAL_API_KEY` in Vercel.
- [ ] Smoke test: upload a scanned PDF (or any image-based document). Watch the worker run — `extract-text` step should produce non-zero chunks via OCR. Verify with: `SELECT status, processing_error FROM deal_documents ORDER BY created_at DESC LIMIT 1;` — status should land at `ready`, not `stored`.

### Dataroom open-format smoke tests

- [ ] Upload an MP4, ZIP, or unknown binary — should land at `status='stored'`, downloadable from the workspace, badge visible in UI.
- [ ] Upload a PDF named like a contract — wait for processing → check `SELECT category FROM deal_documents WHERE filename ILIKE '%.pdf' ORDER BY created_at DESC LIMIT 1;` — category should be set (Legal, Financial, etc.) if `ANTHROPIC_API_KEY` (or org-level Anthropic) is configured.
- [ ] Open the workspace modal → expand a finding → click **Inspect** on an evidence row — chunk text + neighbours should render inline.
- [ ] Reprocess a document with a finding citing it — that finding should immediately get a yellow STALE pill in the workspace.

### Sentry (error monitoring)

- [ ] Sign up at https://sentry.io (free tier: 5k errors/month)
- [ ] Create a Next.js project named `vesno-prod`
- [ ] Copy the DSN → set both `SENTRY_DSN` (server) and `NEXT_PUBLIC_SENTRY_DSN` (browser) in Vercel
- [ ] Re-deploy
- [ ] Trigger a test error: visit a deliberately-bad URL; verify it appears in Sentry within 30s
- [ ] Configure alerts → Slack/email channel for severity ≥ Error

### Upstash Redis (distributed rate limiting)

- [ ] Sign up at https://upstash.com (free tier covers most use cases)
- [ ] Create a Redis database in your nearest region
- [ ] Copy `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` → Vercel
- [ ] Re-deploy
- [ ] Verify rate limiting works: hit any rate-limited endpoint repeatedly; should 429 cleanly

### Status page (Better Stack recommended)

- [ ] Sign up at https://betterstack.com (free tier: 10 monitors + 1 status page)
- [ ] See `RUNBOOK_STATUS_PAGE.md` for the 4 monitors to configure
- [ ] Set custom domain: `status.yourdomain.com`
- [ ] Set `STATUS_PAGE_URL` env var in Vercel pointing at the public status URL
- [ ] Re-deploy; verify `/status` switches to vendor link-out mode
- [ ] Configure notification channels (Slack / PagerDuty / email)
- [ ] Test: trigger a fake incident from the vendor's UI; verify notifications arrive

### External data-room connectors (SharePoint / Google Drive — optional)

For customers who want Vesno to pull documents from their existing SharePoint or Google Drive instead of uploading manually. Each provider needs an OAuth app registered in their console with Vesno as the verified redirect target.

#### Microsoft 365 / SharePoint
- [ ] Microsoft Entra (entra.microsoft.com) → **App registrations** → **New registration** → name `Vesno – Production`
- [ ] **Supported account types:** "Accounts in any organizational directory (Multitenant)". Single-tenant only if Vesno is for one customer.
- [ ] **Redirect URI:** `https://<your-prod-host>/api/integrations/sharepoint/oauth/callback` (exact match, https in prod)
- [ ] Copy the Application (client) ID → `SHAREPOINT_CLIENT_ID` in Vercel
- [ ] **Certificates & secrets** → New client secret → copy the **Value** (not the Secret ID) → `SHAREPOINT_CLIENT_SECRET` in Vercel
- [ ] **API permissions** → Add **Microsoft Graph → Delegated** → `Files.Read.All`, `Sites.Read.All`, `User.Read`, `offline_access` → click **Grant admin consent for <your-tenant>**
- [ ] **Branding & properties** → **Add MPN ID to verify publisher** — without Verified Publisher status, end users in customer tenants cannot self-consent (their admin must consent first via `https://login.microsoftonline.com/<tenant-id>/adminconsent?client_id=<vesno-client-id>`). Free Microsoft Partner Network signup at https://partner.microsoft.com.
- [ ] Re-deploy. Test: Org admin → Integrations → SharePoint → Connect → pick a work account on a tenant with SPO licence → consent → folder picker should show your sites + OneDrive drives.
- [ ] If picker errors with "Tenant does not have a SPO license", see RUNBOOK § "SharePoint connector — Tenant does not have a SPO license".

#### Google Drive
- [ ] Google Cloud Console → **APIs & Services** → **Library** → enable **Google Drive API**
- [ ] **OAuth consent screen** → External (or Internal if Workspace) → fill app name, support email, dev contact → add scopes `.../auth/drive.readonly` + `.../auth/userinfo.email` → add yourself as a Test user (or publish for production)
- [ ] **Credentials** → Create Credentials → **OAuth client ID** → type Web application
- [ ] **Authorized redirect URIs:** `https://<your-prod-host>/api/integrations/google_drive/oauth/callback`
- [ ] Copy the Client ID → `GOOGLE_DRIVE_CLIENT_ID` in Vercel
- [ ] Copy the Client secret → `GOOGLE_DRIVE_CLIENT_SECRET` in Vercel
- [ ] Re-deploy. Test: Org admin → Integrations → Google Drive → Connect → consent → folder picker should list your Drive folders.
- [ ] Production checklist: switch the OAuth consent screen from "Testing" to "In production" (otherwise only listed test users complete the flow).

#### Database prerequisites for both
- [ ] Run `supabase/migration-deal-connectors.sql` then `supabase/migration-deal-connectors-rpcs.sql` (creates `org_integrations` table + the SECURITY DEFINER RPCs that pgcrypto-encrypt tokens with the same Vault secret as `customer_api_keys`)
- [ ] Verify pgcrypto is installed and on the RPC search_path: `SELECT n.nspname, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.proname = 'pgp_sym_encrypt';` should return rows under `extensions`

---

### n8n (outbound transactional webhooks - optional)

The living-workspace model dropped the "email the report" + "follow-up nurture" flows along with their tables. n8n is only needed if you wire up an outbound transactional flow (invite emails, password reset). Optional.

- [ ] Provision an n8n instance (self-hosted or n8n.cloud) if you want outbound webhooks
- [ ] HMAC-sign requests with `WEBHOOK_SIGNING_SECRET` via `lib/triggerWebhook.js`
- [ ] Configure SPF + DKIM + DMARC on your sending domain

---

## 🟣 Phase 2 — Operational drills

Things you only know work because you've actually done them.

- [ ] **Backup-restore drill #1.** Block 90 minutes. Follow `RUNBOOK_BACKUP_RESTORE.md` end-to-end against a fresh staging Supabase project. Update the "Last drill" date in that file.
- [ ] **GDPR account-deletion test.** Create a throwaway test account, schedule deletion via the Settings popover on the chat rail (gear icon in `/workspace/map`), manually trigger `/api/cron/expunge-deleted-accounts` via curl, verify the user can no longer sign in and their data is anonymised.
- [ ] **BYO key end-to-end.** Set a customer Anthropic key for your test org, send a chat, verify the call appears in your Anthropic console (not the platform's).
- [ ] **Customer key revocation.** Revoke the BYO key, send another chat, verify it falls back to the platform key cleanly.
- [ ] **Cron failure visibility.** Force a cron to fail (e.g. break the Supabase URL temporarily), verify the failure shows up in Sentry tagged `cron:<name>`.
- [ ] **Vault rotation drill.** Schedule the first one for 90 days from go-live. Calendar it now.

---

## 🟡 Phase 3 — Compliance + legal

Cannot launch to enterprise without these. Most can run in parallel with vendor signups.

### Engineering-side (you can do)

- [ ] `SECURITY.md` published — replace `vesno.io` with your real domain ✅ already drafted
- [ ] `public/.well-known/security.txt` — same domain replacement ✅ already drafted
- [ ] `legal/SUBPROCESSORS.md` — verify every vendor listed; add any you signed up for in Phase 1 ✅ template ready
- [ ] Set up a real `security@yourdomain.com` mailbox that routes to humans
- [ ] Set up a real `privacy@yourdomain.com` mailbox
- [ ] Set up a real `support@yourdomain.com` mailbox
- [ ] Set up a real `legal@yourdomain.com` mailbox

### Lawyer-side (handoff to your lawyer)

- [ ] Send `legal/TERMS_OF_SERVICE.md` for review
- [ ] Send `legal/PRIVACY_POLICY.md` for review
- [ ] Send `legal/DPA.md` for review
- [ ] Walk through the 8 open questions in `legal/README.md` with the lawyer
- [ ] Replace `TODO Company Name` and `TODO Company Address` placeholders with the registered entity's details
- [ ] Get final signed-off versions
- [ ] Publish at `/legal/terms`, `/legal/privacy`, `/legal/dpa`, `/legal/subprocessors` (TODO: ship the marketing routes)

### GDPR readiness

- [ ] DPO appointment decision (legally required only above certain thresholds — confirm with lawyer)
- [ ] Cookie consent banner if shipping analytics cookies (TODO when analytics added)
- [ ] Data residency commitments documented (which Supabase region your data lives in; surface in Privacy Policy)

### SOC 2 readiness baseline

✅ **Code, policies, controls matrix, and evidence-collection script all shipped.** This puts you in position to engage a CPA firm (Type I in 2-4 weeks; Type II requires 3-12 months of evidence then audit). It does NOT make you SOC 2 compliant.

Before procurement review on a deal above ~$50k ARR:

- [ ] Read `compliance/README.md` end-to-end
- [ ] Adopt all 12 policies in `compliance/policies/` — fill in `[COMPANY NAME]` / `[POLICY OWNER]` / `Approved by` / `Approval date` / `Last reviewed`
- [ ] Get each policy signed (PDF with digital or wet signature) by [CEO/CISO]
- [ ] Walk `compliance/CONTROLS_MATRIX.md` and turn every PARTIAL into COVERED where reasonable
- [ ] Pick a compliance-automation vendor (Drata / Vanta / Secureframe) — recommended unless the team has compliance experience
- [ ] Pick an auditor (referrals from your compliance vendor; A-LIGN / Prescient / Johanson / BARR are common)
- [ ] Background-check vendor adopted (Checkr / Certn) for new hires going forward
- [ ] Security-training vendor adopted (KnowBe4 / Curricula); all workforce members complete within 30 days
- [ ] Engineering Manager schedules first quarterly access review
- [ ] First annual incident-response tabletop exercise scheduled
- [ ] Penetration test scheduled (Cobalt / HackerOne / Bishop Fox)
- [ ] Customer-facing trust page drafted (helps procurement; not required for audit)

Run monthly:

- [ ] `node scripts/collect-soc2-evidence.mjs` → upload snapshot to compliance vendor / private object store
- [ ] Verify `compliance/evidence/` is in `.gitignore` (snapshots contain customer identifiers — never commit)

Run quarterly:

- [ ] Engineering Manager performs access review on every system in scope; sign-off documented
- [ ] Security Officer reviews open risks in the risk register; updates `compliance/CONTROLS_MATRIX.md`
- [ ] Backup partial-restore drill (from `RUNBOOK_BACKUP_RESTORE.md`)

Run annually:

- [ ] Re-approve every policy in `compliance/policies/`; update `Last reviewed:` line
- [ ] Full BC/DR exercise
- [ ] Risk assessment workshop
- [ ] Penetration test
- [ ] Incident-response tabletop

---

## 🟠 Phase 4 — Customer-facing surface

What a paying customer sees and uses.

- [ ] Custom domain configured on Vercel (e.g. `app.vesno.io`)
- [ ] Marketing footer link to `/status`
- [ ] Marketing footer link to `/SECURITY.md`
- [ ] Marketing footer links to `/legal/terms` etc. (after lawyer sign-off)
- [ ] `<StatusBadge />` component dropped into the marketing footer
- [ ] Customer-facing docs site live at `/docs` ✅ shipped
- [ ] Onboarding email when a new user signs up (TODO — n8n flow not built)
- [ ] First-run product tour (TODO — UX work)
- [ ] Help widget / chat → support@yourdomain.com (TODO — pick Intercom / Crisp / etc.)

---

## 🔴 Phase 5 — Pre-paid-customer engineering polish

Items from the deferred register that move from "deferred" to "must" once you have someone paying you. Pick up as triggers fire.

- [ ] **Stripe / payment integration** — entire engineering arc; start when business has plan tiers defined
- [x] ~~**Findings out of JSONB -> relational table**~~ - closed (`deal_findings` shipped + backfill in migration 24)
- [x] ~~**SSE -> enqueue+poll for analyse route**~~ - closed in original migration; the whole analyse pipeline was subsequently retired in the living-workspace migration (deal_analyses table dropped). Findings hang on `(deal_id, finding_key)` directly.
- [x] ~~**JWT decode local instead of `auth.getUser()` round-trip**~~ - closed (`lib/auth.js:verifyJwtLocal`; gated on `SUPABASE_JWT_SECRET` env var being set, falls through to network path otherwise)
- [ ] **49 chat tools → consolidate to ~15** — when adding new tools makes the model pick wrong ones
- [ ] **Per-process `_cache` → Upstash Redis cache** — at ~10+ concurrent paid users
- [ ] **Audit-trail history on findings + reviews** — first compliance-driven customer
- [ ] **Email deliverability monitoring** (Postmark-style analytics) — first "I never got the report" complaint
- [ ] **Accessibility audit (WCAG 2.1 AA)** — first RFP that requires it
- [ ] **CSP + security headers** — quarter 1 regardless
- [ ] **Internal admin dashboard** — at customer #5
- [ ] **Archive legacy / ambiguous portal-era code** — currently 1 orphan (`DiagnosticEdit`), 3 single-import files (`PortalDashboard`, `DealsPanel`, `FirstRunOnboarding`), and a misnamed-but-active `PortalAuth.jsx`. Risk: failures silently fall back to legacy UI (recent sign-out crash + AuditGate flash were both edge cases of this). See `DIAGNOSTICS_CAPABILITIES.md → Legacy archive — pending decision` for the full inventory and the four open questions to settle. Trigger: next time the surface is touched, OR a regression is traced to legacy fallback rendering, OR quarterly cleanup pass.
- [x] ~~**SOC 2 readiness baseline**~~ — closed (`compliance/` directory + MFA helper + evidence script shipped). Audit engagement (Type I → Type II) reopens here when first procurement review hits

See `DIAGNOSTICS_CAPABILITIES.md → Deferred work — decision register` for the full list with triggers.

---

## ⚪ Final smoke tests before announcing GA

Run all of these end-to-end on production. Block 2-3 hours.

- [ ] Sign up via the marketing site landing page
- [ ] Map a process on `/workspace/map`; verify the canvas saves and the process appears in the Reports popover (chat rail)
- [ ] Re-open the same process via `/workspace/map?view=<id>` and confirm the canvas hydrates with the saved steps
- [ ] In the chat, ask Reina to "add a step after step 3" - verify the proposal renders an Apply button and the change lands on the canvas
- [ ] Create an organisation; invite a second user; verify they can join
- [ ] As an admin, set a customer Anthropic key
- [ ] Create a deal; invite a target participant via email
- [ ] Both participants complete their maps
- [ ] Upload a small data room (3-5 documents); wait for `Ready` status on each
- [ ] Ask Reina to "summarise the financials" - verify she calls `search_deal_documents` and renders citations
- [ ] Open the workspace modal; expand a finding; click **Inspect** on an evidence row - chunk text should render inline
- [ ] Open `/status` - should be green
- [ ] Open `/org-admin -> Usage` - should show all the calls just made
- [ ] Schedule account deletion via the Settings popover (chat rail, gear icon); cancel it; verify both events appear in audit
- [ ] Hit `/api/health` - should return 200 with all checks green

---

## How to use this file

- **Tick boxes as you go.** Markdown checkboxes work in GitHub, most editors, and `/docs` if you push it there.
- **Add new items in the right phase** when something becomes a blocker. Keep the format (checkbox + sentence + optional sub-bullets).
- **When an item is permanently no-longer-relevant** (vendor changed, decision reversed), strike it through with `~~text~~` and add a comment explaining when + why.
- **Quarterly review.** Re-read the whole thing every 90 days. Items that are "deferred forever" should move to the deferred register; items that are "blocking actively" should get done.
