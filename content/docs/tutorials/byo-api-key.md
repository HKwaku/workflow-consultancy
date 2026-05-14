---
title: Set your own AI provider API key
group: Tutorials
order: 4
summary: Bill LLM usage to your own Anthropic account, bypass our monthly token budget, keep audit-grade controls.
---

By default, all LLM calls bill against our platform Anthropic key. That works for early use; at scale most customers prefer to bring their own key (BYO).

Two reasons to BYO:

1. **You bypass our monthly token budget.** When your key is in use, our budget enforcement is skipped — Anthropic charges you directly via your own account.
2. **You keep audit ownership.** Every BYO key set / rotate / revoke event writes an audit row that org admins can view.

## Step 1 — Get an Anthropic key

If you don't have one, sign up at [console.anthropic.com](https://console.anthropic.com), generate a key under **Settings → API Keys**. The key starts `sk-ant-api03-...`.

You'll also want to set a spend limit on your Anthropic account (Console → Settings → Billing → Limits) so a runaway prompt can't drain you.

## Step 2 — Paste it into Vesno

You need to be an organisation admin to do this.

1. Open **/org-admin → API keys**.
2. In the **Anthropic** card, paste the key into "Paste new API key".
3. Click **Save key**.

Vesno makes a 1-token test call to verify the key works (cost ~$0.000003). On success, the key is encrypted via `pgcrypto` with a per-deployment encryption secret stored in Supabase Vault — distinct from any other infrastructure credential. We never log the raw key.

The card now shows:
- A masked fingerprint (e.g. `sk-ant-...XYZW`)
- Who set it + when
- Last used timestamp
- Rotation due date (90 days from set)

## Step 3 — Verify it's actually being used

Send a chat message in `/process-audit`. Then:

- Check the **Usage** tab in `/org-admin` — your call should appear.
- Check your Anthropic console (console.anthropic.com → Settings → Usage) — the same call should appear within ~1 minute.

If Vesno's Usage panel shows the call but Anthropic's console doesn't, your BYO key isn't being used (membership lookup probably failed). Email support@vesno.io.

## Rotation

After 90 days, the API key panel marks the key with an amber "Rotate in 7d" badge. Generate a new key in the Anthropic console, paste it in, click **Rotate key**. The old key is auto-revoked.

You can rotate sooner — anytime, no penalty.

## Revocation

Click **Revoke** on the key card. Confirms with a dialog. Once revoked:
- Future calls fall back to our platform key
- Our monthly token budget starts applying again (set a budget if you don't want surprises — see [Token budgets](/docs/reference/token-budgets))
- The revoke event is in the audit log

## Multi-vendor

Voyage (embeddings) and OpenAI keys appear in the admin UI but are currently **not wired into the runtime**. Setting them stores the value but has no effect — the chat / analysis surfaces always use Anthropic. This is intentional: we ship multi-vendor schema first, then wire vendors one at a time.

## Common questions

**Where is the encryption secret stored?** In Supabase Vault, set via a one-time SQL script. Not in any environment variable. A leaked Vercel env doesn't auto-leak BYO keys. See `RUNBOOK_BACKUP_RESTORE.md` for the cross-project recovery procedure.

**What happens to the BYO key if my account is deleted?** The key is associated with the organisation, not the user. If you (the admin who set it) delete your account, the key stays — another admin can manage it.

**Can I see exactly which calls used my key vs. yours?** Yes. The Usage panel's per-model and per-feature breakdowns include all calls; your Anthropic console shows only the BYO ones. The difference is what's still billing against our platform key (if any).
