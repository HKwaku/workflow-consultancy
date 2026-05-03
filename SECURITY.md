# Security Policy

We take security seriously. This document explains how to report vulnerabilities and what you can expect from us in return.

## Reporting a vulnerability

**Please email `security@vesno.io` with details. Do not file a public GitHub issue.** Encrypt sensitive details with our PGP key (fingerprint published at the same address) if the issue includes credentials, customer data, or chained exploits.

Include:
- A clear description of the vulnerability
- Steps to reproduce (a proof-of-concept is helpful but not required)
- The impact you believe it has
- Your name + how you'd like to be credited (optional)

## What you can expect

| Stage | Target |
|-------|--------|
| Initial acknowledgement | Within **2 business days** |
| Triage + severity assessment | Within **5 business days** |
| Fix or mitigation timeline | Critical: 7 days · High: 30 days · Medium: 90 days |
| Credit on disclosure (if desired) | Once the fix is rolled out |

Non-trivial reports that surface a real exploitable issue may be eligible for a thank-you payment at our discretion. We don't run a formal bug bounty.

## Disclosure window

We follow **90-day coordinated disclosure** by default. We'll work with you on extensions if a fix legitimately needs more time, and we expect you to wait until the fix has rolled out before publishing.

## Safe harbour

We will not pursue legal action against researchers who:
- Make a good-faith effort to avoid privacy violations, destruction of data, and disruption of service
- Only interact with accounts they own or have explicit permission to test
- Don't access, modify, or delete other users' data
- Stop and report immediately if they encounter sensitive data
- Don't exploit a vulnerability beyond what's necessary to confirm and document it

## In scope

- The production Vesno application at `https://vesno.io` (and `*.vesno.io`)
- The Vesno API surfaces under `/api/*`
- The diagnostic chat / deal portal / data room (open-format uploads, OCR pipeline, chunk + embedding store)
- Authentication + session management (including the `requireAuth` 60-second verification cache and concurrent-request coalescing in `lib/auth.js`)
- Multi-tenant isolation (a user shouldn't be able to read another org's deals, documents, chats, Q&A items, finding comments, or scorecards)
- Per-document visibility enforcement (`canSeeDocument` + the editor/participant role split — applies to evidence drawer, signed URLs, and the chunk preview endpoint)
- Customer-managed BYO API key encryption + leakage paths (Anthropic / Voyage / OpenAI / Mistral, set under `/portal/org-admin → API keys`)
- The Mistral OCR fallback path — payload contents (document base64) flow to a third-party API only when the org or platform key is configured

## Out of scope

- Findings that require physical access to a user's device
- Social-engineering attacks against Vesno staff
- Denial-of-service that simply exhausts a free-tier rate limit
- Vulnerabilities in third-party services we depend on (Supabase, Vercel, Anthropic, Voyage, Inngest, n8n, Upstash) — please report those to the vendor directly, then let us know so we can mitigate
- Missing security headers without a demonstrated impact
- Spam / phishing / abuse via user-generated content
- "Best-practice" recommendations without a concrete vulnerability

## Known issues

We maintain a [deferred-work register](./DIAGNOSTICS_CAPABILITIES.md#deferred-work--decision-register) covering security-relevant items we've consciously chosen to ship later (e.g. CSP headers, SOC 2 readiness, dependency scanning). Reports against items already in that register are appreciated but won't change the timeline unless they demonstrate active exploitability.

### Documented residual exposures

These are accepted trade-offs we've shipped knowingly:

- **Auth cache + multi-instance Vercel** — `lib/auth.js` caches successful JWT verifications per serverless instance for `min(60s, JWT exp)`. The client signOut flow calls `POST /api/auth/cache-bust` before revoking at Supabase, but that only evicts the cache on the instance that handled the request. Other Vercel Lambdas may still hold the entry until their TTL elapses. A genuinely-revoked token is therefore valid for up to 60s after sign-out on instances the user hasn't recently hit. We accept this for the perf win (eliminates ~100-300ms of network round-trip on every API call). Mitigations available if needed: drop the TTL to 10-20s, or move the cache to Upstash Redis with cross-instance invalidation.
- **Connector token cache** — same shape, same window: per-instance, 60s TTL. Refresh failures eagerly evict, signOut does not (we'd need to enumerate the user's integrations to know what to bust).

## Hall of fame

We'll list researchers who've helped here once we have any to thank.

---

This policy is published under [securitytxt.org](https://securitytxt.org/) at `/.well-known/security.txt` (TODO: serve the file).
