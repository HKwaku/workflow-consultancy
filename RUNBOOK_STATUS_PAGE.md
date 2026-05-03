# Status page + uptime monitoring runbook

> **Owner:** TODO assign
> **Status:** Code in place; vendor not yet signed up. App falls back to self-reported `/status` until you do.

This runbook covers picking a status-page vendor, signing up, configuring synthetic monitors against `/api/health`, and wiring incident communications.

## Decision: which vendor?

Three options that I'd actually recommend in 2026:

| Vendor | Price (year 1) | Strengths | Watch-outs |
|--------|----------------|-----------|------------|
| **Better Stack** (Heartbeats + Status Pages) | Free for 10 monitors / 1 status page; ~$24/mo for the next tier | Most polished UX. Tight integration between uptime monitoring and incident posting. Slack/PagerDuty/email/SMS notifications. | Free tier limits notification frequency. |
| **Statuspage** (Atlassian) | $29/mo → $99/mo | Industry standard. Customers may already trust the URL pattern. Good for enterprise. | Pricier. UX dated. No bundled monitoring — you need a separate uptime tool. |
| **Instatus** | Free for 1 status page; $20/mo for advanced | Cheapest "good" option. Beautiful pages. Public subscribe. | Smaller community; fewer integrations than Better Stack. |

**Recommendation: Better Stack.** Bundles uptime + status in one product, free tier covers your needs through ~10 customers. Sign up at https://betterstack.com.

If you prefer Atlassian's ecosystem (Jira / Opsgenie already in use), pick Statuspage.

## What to monitor

Configure synthetic checks against four endpoints. Cadence: 1 minute for `/api/health`, 5 minutes for the others.

| URL | Expectation | Why |
|-----|-------------|-----|
| `https://<your-host>/api/health` | HTTP 200 + `ok: true` in body | Primary signal. DB-backed; tells you the database is reachable. |
| `https://<your-host>/` | HTTP 200 | Marketing landing — front door. |
| `https://<your-host>/portal` | HTTP 200 (will redirect to login if anon — that's fine) | Portal availability. |
| `https://<your-host>/api/inngest` | HTTP 200 (Inngest serve handler responds to GET with introspection JSON) | Worker connectivity. |

**Better Stack JSON-response check** (recommended for `/api/health`):
- Method: GET
- Expected status: `200`
- Body must contain JSON: `"ok": true`
- Region: pick at least 2 (e.g. EU + US East)
- Frequency: 1 min
- Timeout: 10 sec
- Failures before alert: 2 consecutive (avoids flapping on transient network hiccups)

## Configure the app to surface the vendor page

After sign-up:

1. Get the public URL of your status page (e.g. `https://status.vesno.io` if you set up a custom domain, or `https://vesno.betterstack.com` by default).
2. Add to Vercel env (Production scope):
   ```
   STATUS_PAGE_URL=https://status.vesno.io
   ```
3. Re-deploy. The `/status` route in the app will switch from self-reported mode to vendor link-out mode automatically.

Optional but recommended: set up a custom domain (`status.vesno.io`) on the vendor side so customers see a Vesno-branded URL.

## Embed the footer badge (optional)

`components/StatusBadge.jsx` is a small pill that polls `/api/health` every 60s and shows green/red. Drop it into the marketing footer:

```jsx
import StatusBadge from '@/components/StatusBadge';

// in the footer
<StatusBadge />
```

It always works (uses `/api/health` directly), regardless of whether the vendor is wired.

## Incident response procedure

When the synthetic monitor fires:

### 1. Acknowledge within 15 minutes
- Better Stack / PagerDuty pages on-call. Acknowledge in the alert tool.
- Open Sentry — there will likely be a related error. If not, the monitor caught something Sentry didn't (network / DNS / DB).

### 2. Triage
- Check `/api/health` directly. Which component failed?
- Check Vercel deployments — did a recent deploy break it?
- Check Supabase status (https://status.supabase.com).
- Check Anthropic status (https://status.anthropic.com).

### 3. Communicate
On the status page, post an **investigating** incident immediately. Even one line ("Investigating elevated error rates on the diligence pipeline") buys you customer goodwill.

Update at minimum every 30 minutes during an active incident. After resolution, post a **resolved** message with a one-paragraph summary.

### 4. Post-mortem (within 48 hours)
For any incident lasting >15 min or affecting >1 customer:
- What happened
- Timeline (detection → mitigation → resolution)
- Root cause
- What we'll change

Post-mortems live in `incidents/YYYY-MM-DD-slug.md` (TODO create directory on first incident).

## Severity definitions

For the vendor's incident-severity dropdown:

| Severity | Definition | Example |
|----------|------------|---------|
| **Critical (major outage)** | Service unavailable for all users | Database down, auth provider down |
| **High (major degradation)** | A core feature is broken for all users | Diligence analysis returns 500s, BYO key validation always fails |
| **Medium (minor degradation)** | A feature is slow or partially broken | Document upload takes 60s instead of 5s; embeddings backed up |
| **Low (cosmetic)** | Functionality unaffected | Status badge stuck on "loading" |
| **Maintenance** | Planned downtime | Database migration |

## What we explicitly don't include

- **Anthropic / Voyage / Inngest health** as a primary signal — their uptime is their problem. We monitor their reachability for our own diagnostics but don't show them on the customer-facing page (avoids "Vesno is down" reports for things that aren't us). When THEIR outage materially affects US, post an incident referencing it.
- **Per-customer status** — out of scope. If a single customer's deal is broken, that's a support ticket, not a status incident.

## Going further (deferred)

- Email subscribers list — vendor handles this once configured
- SMS notifications for critical only — vendor charges per SMS; budget accordingly
- RSS / Atom / webhook feeds for status changes — most vendors support this out of the box
- SLA tracking against committed uptime (when you have an SLA in your MSA)

## First-week checklist

- [ ] Sign up for Better Stack (or chosen vendor)
- [ ] Configure 4 monitors against the URLs above
- [ ] Configure notification channel (Slack / email / PagerDuty)
- [ ] Set custom domain for status page
- [ ] Set `STATUS_PAGE_URL` in Vercel
- [ ] Re-deploy, verify `/status` shows the vendor link-out
- [ ] Add `<StatusBadge />` to the marketing footer
- [ ] Trigger a test incident from the vendor's UI, verify notifications arrive
- [ ] Update [`SECURITY.md`](./SECURITY.md) and [`legal/SUBPROCESSORS.md`](./legal/SUBPROCESSORS.md) to list the vendor
