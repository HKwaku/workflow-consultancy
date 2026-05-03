---
title: The deal workspace
group: Tutorials
order: 5
summary: Q&A queue, finding comments, tags, evidence drawer, scorecard — the place collaborators actually do diligence.
---

The **deal workspace** is the chat-side surface that replaced the legacy `/deals/[id]` page. Open it from the chat by picking a deal in the briefcase rail icon, then clicking **Open workspace** on the deal context chip.

It's organised top-to-bottom into:

1. **Participants** — invite, edit roles, track completion
2. **Data room** — uploads, expected-docs checklist (see [The data room](/docs/tutorials/data-room))
3. **Q&A queue** — questions to seller + answers
4. **Findings** — model output with reviewer controls, evidence drawer, comments, tags, staleness
5. **Scorecard** (toggle) — one-page IC summary

The first paint shows deal + participants + documents + Q&A as soon as they arrive; findings stream in separately so the rest of the modal isn't blocked. Re-opening the same deal renders instantly from a small in-memory cache.

## Q&A queue

Diligence is fundamentally a question list. The Q&A section sits between Documents and Findings.

**Ask a question:**

1. Type the question in the composer
2. Optionally pick a participant from the assignee dropdown — they'll answer it
3. Click **Ask**

Each item carries: question, asker, optional assigned participant, status (`open / answered / skipped / obsolete`), the answer when one lands, and optional supporting evidence (chunk IDs from the data room). The header counter — *3 open · 5 answered* — gives at-a-glance state.

**Answer a question:**

- Editors can answer any question
- Assigned participants can answer their own (the server enforces the role check)

A submitted answer flips status to `answered` and stamps `answered_at` + `answered_by_email`. Editors can also **Skip** a question or **Reopen** an answered one.

**Why use Q&A instead of just chat?** Chat is free-form and ephemeral. Q&A is structured and traceable: you can tell a partner "we've got 14 open questions on Project Atlas, half assigned to Beta Co" or generate a request email from the open list later. It also pairs with finding evidence (an answer can carry chunk IDs) so the audit trail leads from question → answer → cited document.

## Finding evidence drawer

Every finding ships with one or more evidence pointers — page references in source documents that justify the claim. In the workspace, expand a finding to see them.

Each evidence row offers two buttons:

- **Inspect** — lazy-loads the cited chunk plus 1 neighbour either side. The target chunk is highlighted teal in the drawer. No tab switch.
- **Open** — fetches a 5-minute signed URL for the source document and opens it in a new tab.

Use Inspect when you're verifying — the surrounding chunks confirm the citation is contextually right (vs. a fragment cherry-picked out of context). Use Open when you need the full document for downstream work.

Both endpoints respect per-document visibility, so participants only see chunks from documents their role is allowed to see.

## Finding tags

Below the expanded finding, a row of toggle chips lets you tag the finding for triage:

| Tag | Meaning |
|---|---|
| **Deal-breaker** | Kills the deal unless resolved. Walking-away severity. |
| **Re-trade** | Opens a price renegotiation. Affects the LOI. |
| **Disclose** | Buyer can live with it but must be told. SPA disclosure schedule. |
| **Mitigate** | Actionable inside the 100-day plan. Costs effort, not money. |
| **Monitor** | Track but no action required pre-close. |

Tags are free-form at the database layer, so you can add custom buckets — but the chip toggles surface the recommended five because they map cleanly to how IC actually triages findings. Tagging is editor-only.

## Finding comments

Each finding has a **Discussion** thread distinct from the reviewer note (which is one-per-reviewer and tied to status). Anyone with deal access can comment — including participants, so the seller side can defend or clarify.

Use `@email@example.com` in the body to mention someone. Mentions are parsed from the text and stored alongside the comment for a future webhook send.

The thread lazy-loads on expand so the modal doesn't pay for comments on every finding upfront.

## Finding staleness

When a cited document is reprocessed (or replaced), every finding referencing it gets a yellow **STALE** pill in the workspace. The reasoning: the underlying chunk IDs are now invalidated, so the partner needs to re-verify the finding against the new chunks before relying on it.

Editors clear stale via the in-row stale bar's **Mark verified** button. The finding itself is never deleted automatically — staleness is purely a hint to the reviewer.

## Auto-rerun on new uploads

After your first completed analysis, subsequent uploads automatically queue a delta diligence run — throttled to once per hour and only when no analysis is currently in flight. The workspace badges findings new since the previous run with a small **NEW** pill, and the analysis header shows " · auto" to distinguish auto-queued runs from user-initiated ones.

This means: drop a fresh contract into the data room, walk away, come back in an hour, and the workspace already reflects what changed. No need to remember to hit Analyse.

## Scorecard

The header **Scorecard** button toggles the one-page IC summary view. It's auto-filled from the latest completed analysis:

- **Risk score** — Σ(severity × confidence) across the latest analysis. Surfaced as the big number top-right.
- **Severity counts** — `critical / high / medium / low` chip strip
- **Recommended action** — rule-based: *Re-trade or walk · Negotiate price · Proceed with conditions · Proceed; address in 100-day plan · Proceed with confidence*
- **Thesis + key takeaways** — pulled from the executive summary section
- **Top 5 risks** — ranked by severity × confidence; click any to deep-link back to the finding row
- **Mitigants** — recommendations across the top findings, each tagged with the parent finding
- **Doc coverage** — total docs by category bucket

The scorecard regenerates fresh on every open, so it always reflects current findings + reviewer overrides. It's read-only — edit the underlying findings (or their reviewer notes/edits) to change what shows up.

## Severity-weighted deal sorting

The briefcase rail panel (the list of all your deals) is sorted by `riskScore` descending. Each deal name carries a coloured pill — `critical`, `high`, `medium`, `low` — with the critical-finding count when > 0. Tie-breaks fall back to recency.

So when you open Vesno, the deals that need attention float to the top of the panel. Click any to scope chat to that deal and open its workspace.

## Common questions

**Who can see what?** Same access tiers as the rest of the deal: owner + collaborators write everything; participants see and answer their own assigned Q&A items, can read and comment on findings whose evidence they have access to. Per-document visibility cascades down — if you can't see a doc, you can't open its evidence drawer either.

**Can I export Q&A or comments?** Not yet. PPTX and CSV export of findings exists today; Q&A export is on the roadmap.

**A finding's evidence shows a STALE pill but the doc looks fine.** That document was reprocessed (you, a colleague, or the worker via reprocess). The chunk IDs the finding cites are stale — re-verify against the current text and click **Mark verified**.

**I want to disable auto-rerun.** Tell ops to comment out the `maybe-auto-trigger-analysis` step in `lib/inngest/functions/processDealDocument.js`, or tighten the `MIN_GAP_MS` throttle in `lib/deal-analysis/autoTrigger.js`.
