---
title: Finding shape
group: Reference
order: 3
summary: The fields every analysis finding carries, and what they mean.
---

Every finding produced by `/api/deals/[id]/analyse` (in any mode) follows the same canonical shape. This is what you're looking at in the diligence memo, the synergy view, and what gets exported to PowerPoint.

## The fields

| Field | Type | Notes |
|-------|------|-------|
| `key` | string | Stable 12-char hash of `category + title`. Survives re-runs so reviewer decisions persist. |
| `title` | string | Short headline (a sentence or less). |
| `body` | string | 1-3 sentence explanation. |
| `category` | string | Free-form bucket — `systems`, `headcount`, `contracts`, etc. Used internally for grouping. |
| `severity` | enum | One of `low`, `medium`, `high`, `critical`. Drives the colour band on the card. |
| `confidence` | number | 0–1. The model's self-reported confidence. Auto-downgraded by 0.2 if any evidence pointer fails validation. |
| `impact` | enum[] | Subset of `day_one`, `tsa`, `separation`, `long_term`. Drives the Transition Lens cross-cut. |
| `evidence` | object[] | Source pointers. See [How citations work](/docs/tutorials/citations). |
| `recommendations` | string[] | Action items, 1–3 short strings. |

## Reviewer-applied fields

When a reviewer approves, rejects, or edits a finding, the following are stored separately in `deal_finding_reviews`:

- `status` — `pending`, `approved`, `rejected`, `needs_revision`
- `edited_title`, `edited_body` — overrides shown in the rendered view
- `reviewer_note` — internal note explaining the decision
- `decided_by_email`, `decided_at`

The original AI output is preserved; what you see is your edit.

## Visibility rules in the rendered view

| Status | Public viewer | Editor |
|--------|---------------|--------|
| `approved` | shown | shown |
| `pending` | hidden | shown with "Pending review" pill |
| `needs_revision` | hidden | shown with "Needs revision" pill |
| `rejected` | hidden | hidden |

Findings that originally had no evidence stay visible (with a `⚠ No source evidence cited.` warning) so you can see what the model thought even when it couldn't ground the claim.

## Why the key is stable

`findingKey` is a sha1 of `category + title` (lowercased, whitespace-normalised). When you re-run an analysis and the model produces a finding with the same category + title — even though the JSONB row is a new one — the `key` matches an existing `deal_finding_reviews` row, so your previous approve/reject sticks.

The fragility: if the model rephrases the title materially, you lose the linkage and have to re-review. Plan to track this once you have data on real-world stability — mostly fine for short-term re-runs.

## Why confidence isn't a hard gate

We don't auto-hide low-confidence findings because that hides the model's uncertainty. Better to show "confidence 35%" with the citation row and let the reviewer decide. Hide-by-default would silently delete useful flags.
