---
title: How findings work
group: Tutorials
order: 3
summary: How Reina generates diligence findings on a deal and how reviewers approve / reject them.
---

Findings are claims about a deal - things you've discovered in the data room, on a participant's process map, or via the AI's analysis of either. They live on `deal_findings (deal_id, finding_key)` directly: no per-analysis-run snapshot. You ask, Reina answers with citations; the claims land as findings; reviewers approve, edit, or reject; the approved set is the diligence position.

## How findings are generated

When you chat with Reina on a deal-bound session, she has retrieval tools that pull from the data room (semantic + keyword via `search_deal_chunks`) and from each participant's process maps. When she states a substantive claim - "the target's churn is 24% concentrated in one product line" - she also stages a finding with:

- A short title + 1-3 sentence body
- A category (`systems`, `headcount`, `contracts`, etc.)
- Severity (`low / medium / high / critical`)
- One or more **evidence pointers** to specific document chunks (cited inline in chat)
- An impact axis (`day_one`, `tsa`, `separation`, `long_term`)

Citations go through an evidence-verifier: every pointer's snippet must actually appear in the cited chunk. Pointers that don't pass are dropped; findings whose all-pointers fail are dropped entirely.

## Reviewing findings

The deal page surfaces every finding with the reviewer controls inline:

- **Approve** - the finding stays visible to all viewers of the deal.
- **Needs revision** - hidden from public viewers; editors see a "Needs revision" pill.
- **Reject** - hidden from everyone except editors.
- **Edit title / body** - your override is what gets rendered. The model's original phrasing is preserved in the audit log.

Reviewer state is stored in `deal_finding_reviews` separately from the finding itself. The finding shape carries the AI's output; the review row carries the human decision.

## Stable keys across re-runs

Each finding has a `key` = sha1 of `category + title` (lowercased, whitespace-normalised). When Reina re-asserts the same finding in a later session, the `key` matches an existing `deal_finding_reviews` row, so your previous approve / reject persists. If she rephrases materially, you'll see the new claim un-reviewed - which is the right behaviour (it's a different claim).

## Visibility rules in the rendered view

| Status | Public viewer | Editor |
|--------|---------------|--------|
| `approved` | shown | shown |
| `pending` | hidden | shown with "Pending review" pill |
| `needs_revision` | hidden | shown with "Needs revision" pill |
| `rejected` | hidden | hidden |

Findings with no evidence at all stay visible (with a `Warning: no source evidence cited` tag) so reviewers can see what the model thought, even when it couldn't ground the claim.

## Common questions

**How do I trigger a "full diligence pass"?** Ask Reina directly: "go through the data room and flag risks", "what should I worry about on this deal", etc. The findings land as she discovers things. There's no batch "run analysis" button - the model surfaces claims continuously as you chat.

**Can I ask Reina to focus on one section?** Yes - "tell me only about technology risks", "what are the org-chart risks", "are there any contract concentration risks". She'll scope her retrieval accordingly.

**Why are some findings missing the citation badge?** Either the model didn't cite (rare - she's prompted to), or the validator dropped the citation as not actually present in the chunk. The second case is intentional: better to flag "no evidence" than fake evidence.

**Can I edit a finding's wording?** Yes - the reviewer panel lets you edit title and body. The AI's original phrasing is preserved in the audit log.
