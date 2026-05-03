---
title: Model picker
group: Reference
order: 2
summary: How the chat picks which Anthropic model to use, and when to override.
---

The pill above the chat input shows the active model. Click it to change.

## Resolution order

When you open a chat, Vesno picks a model in this order:

1. **Whatever you picked last** in this session — sticks until you reload.
2. **Phase-aware suggestion** — based on what you're doing:
   - `intake` phase or processing an attachment → Haiku (fast, cheap)
   - editing a redesign → Opus (deepest reasoning)
   - everything else → Sonnet (balanced)
3. **Org default** — set in the admin panel; falls back to Sonnet 4.6 if unset.

The popover marks the suggested model with `· suggested`.

## What's available

Depends on your org's allowlist:

- **No customer key, no allowlist set** — Sonnet 4.6 only (platform fallback).
- **Customer Anthropic key, no allowlist** — full active Anthropic catalogue (Opus 4.7, Sonnet 4.6, Haiku 4.5).
- **Custom allowlist** — exactly what the admin ticked.

Org admins manage the list at `/portal/org-admin → API keys → Allowed models`. They can include legacy models (Sonnet 4.5, Opus 4.6) for backward-compat use cases.

OpenAI models appear in the admin catalogue but are tagged "Coming soon" and hidden from your picker — the runtime can't actually call OpenAI yet.

## When to override

Most users should leave the pill alone. The phase-aware default is usually right.

Override when:

- **You're hitting a context-window limit on Sonnet** (rare; 1M tokens) → switch to Opus 4.7 (also 1M)
- **You want maximum reasoning quality** for a hard problem → Opus
- **You want to test something cheap** → Haiku

Each model's tier label tells you what to expect:
- **Opus** — deepest reasoning, most expensive (~5× chat cost)
- **Sonnet** — balanced
- **Haiku** — fast and cheap, near-frontier intelligence

## Cost transparency

Every chat call records its actual model in the usage ledger. Org admins see per-model spend in the **Usage** panel under "By model". If your team is hammering Opus on simple questions, that view will surface it.

## Common questions

**The picker doesn't show — am I missing it?** It hides when only one model is available (no choice to make). This is the case for new orgs without a customer key.

**My selection didn't stick.** It sticks for the session; reloading the page resets to the org default. We don't persist as a user preference.

**A model I picked stopped working.** The org admin probably removed it from the allowlist. The picker re-resolves on the next load to the new default.
