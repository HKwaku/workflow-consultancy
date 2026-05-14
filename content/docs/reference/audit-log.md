---
title: Audit log
group: Reference
order: 5
summary: What Vesno records about who did what — and what we don't.
---

Vesno keeps audit trails for the things compliance auditors and dispute resolvers ask about. This page lists what's recorded and where to find it.

## What we record

### Customer API key lifecycle (`customer_api_key_audit`)

Every set / rotate / revoke / first-use / rotation-reminder event for a BYO key:
- Actor email + user ID
- Action (`set`, `rotated`, `revoked`, `validated`, `used_first_time`, `rotation_reminder_sent`)
- Masked fingerprint (e.g. `sk-ant-...XYZW`) — never the raw key
- Request ID for correlation
- Timestamp

**Append-only**: nothing updates or deletes an existing row. Org admins can read; nobody can mutate.

View it in `/org-admin → API keys → Show audit log`.

### Finding reviews (`deal_finding_reviews`)

Per-finding approval state:
- Status (`pending`, `approved`, `rejected`, `needs_revision`)
- Reviewer note
- Edited title + body (preserves the AI's original; what you see is your edit)
- Decided-by email + timestamp

Re-running the analysis preserves these because `finding_key` is content-stable (sha1 of category+title).

**Limitation**: only the latest edit is stored. Edit history (who changed what when, multiple times) is on the deferred register — see DIAGNOSTICS_CAPABILITIES.md.

### Token usage (`token_usage_ledger`)

Every LLM call:
- Vendor + model + surface (chat / deal_analysis / embedding / etc.)
- Input + output tokens, total
- User email
- Org ID
- Reference (deal ID, report ID, document ID — whatever's relevant)
- Timestamp

Append-only. Used by:
- Org-admin Usage panel for analytics
- Cost-guard for budget enforcement
- Future per-customer billing reconciliation

### Account deletion (`user_deletion_requests`)

GDPR Article 17 lifecycle:
- Email at request time (snapshot, in case auth.users is later renamed)
- Status (`pending`, `cancelled`, `completed`, `failed`)
- Expunge-after timestamp (= request time + 30 days)
- Decided-by + timestamps

A user can read only their own row (RLS). The cron processes pending requests after the grace window.

## What we DON'T record

By design — to keep the audit surface focused on accountability rather than surveillance:

- **Chat message-level edits** — chat is conversational; we don't track per-message reads or rewrites.
- **Process map per-step edits** — the canvas auto-saves; if you need step-level history, ask in chat (Reina maintains an undo stack at the chat level).
- **Read-tracking** — we don't know if someone opened a report or read a finding. Rely on access control, not surveillance.
- **Failed login attempts** — handled by Supabase Auth's built-in protections (rate limiting, optional MFA). Surfacing this would be useful and is on the deferred register.

## Retention

| Table | Retention |
|-------|-----------|
| `customer_api_key_audit` | Indefinite (small table) |
| `deal_finding_reviews` | Indefinite (linked to deal lifecycle) |
| `token_usage_ledger` | 13 months (rolls off month-by-month for billing) |
| `user_deletion_requests` | Indefinite — proves the deletion happened |

After GDPR account deletion + 30-day grace, the actor's email is redacted from these tables but the audit row itself is preserved (for forensic purposes). The redacted email becomes `[redacted-deleted-account]`.

## Common questions

**Can I export the audit log?** Yes, for your own org. `/org-admin → API keys → Show audit log` paginates the customer-key audit. The other tables are queryable via the GDPR data export (Settings popover on the chat rail → Download my data) for rows you own.

**Can I get notified when an admin event fires?** Not yet (no notifications pipeline). On the deferred register — pair with the SOC 2 baseline work.

**A reviewer accidentally approved a finding. Is there an undo?** Yes — they can change the status (approve → reject) at any time. The audit log shows both events.
