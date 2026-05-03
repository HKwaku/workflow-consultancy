---
title: Running an M&A deal
group: Tutorials
order: 2
summary: From "create a deal" to a PowerPoint diligence memo, with both sides involved — chat-first.
---

A **deal** is Vesno's container for multi-party diligence work. PE, M&A, and scaling deals all use the same shape: participants map their processes, you upload a data room, AI generates evidence-cited findings, reviewers approve them, and you export to PowerPoint.

This guide walks the M&A flow because it's the most complex. PE roll-ups and scaling deals are simpler subsets.

> **The chat is the surface.** The legacy `/deals/[id]` page has been retired. Everything below happens inside the diagnostic chat at `/process-audit` — the rail icons on the left scope you in and out of deals, and the workspace modal does the heavy lifting.

## Step 1 — Create the deal

Click the **briefcase** rail icon → **+ New deal** in the slide-in panel.

Choose:
- **Type**: M&A (acquirer + target)
- **Name**: anything; shows on every screen and in the deals rail panel
- **Process** (optional): "Invoice approval", "Customer onboarding" — the operational area you're diligencing
- **Participants**: at minimum acquirer + target — add company names

You'll get an 8-character `deal_code` (e.g. `ATLAS-7K`) — use it to refer to the deal in conversations.

## Step 2 — Invite participants

Each participant maps their own version of the process. From the deal workspace modal:

- Open the **Participants** section, click **Invite** on a participant card, enter their email
- They get an email with a magic link — they don't need a Vesno account
- Their map is linked back to the deal automatically when they submit

You can also collaborate with a colleague at your firm without making them a participant. **Add collaborator** lets them see and edit the deal but their data isn't part of the analysis.

## Step 3 — Upload the data room

Pick the deal in the rail, then click **Open workspace**. Drag any files into the **Data room** panel — it accepts every format. For each upload, you can set:

- **Visibility** — who can see the file. Defaults to "All editors" (anyone with deal access). Use "Acquirer only" or "Target only" to keep one side's notes confidential. See [Per-party visibility](/docs/reference/per-party-visibility).
- **Source party** — which side provided this. Used by the analysis prompt to weight perspective.
- **Label** — e.g. "CIM", "Q3 financials", "Customer contracts".
- **Category** — auto-suggested by the AI (Financial / Legal / HR / IP / Tech / Commercial / Operational / Other). You can override.

What happens by format:

| Format | Outcome |
|---|---|
| pdf, docx, xlsx, pptx, csv, txt, md, json, xml, code | Native text extraction → chunked → embedded → status `ready`. Searchable + citable. |
| Scanned PDF or image | OCR fallback via Mistral Document OCR (if configured under Org admin → API keys → Mistral). On success → `ready`. Otherwise → `stored`. |
| Image, audio, video, archive, executable | `status='stored'` — file is in the data room and downloadable, just not text-indexed. |

A small **Expected documents (3 / 12 received)** panel inside the data-room section tracks what a typical M&A bundle looks like (articles, cap table, audited accounts, customer contracts, IP register, etc.) and shows what you've received vs. what's still missing.

**Upload deduplication**: if you upload the same file twice (or a colleague did already), Vesno detects the content hash and reuses the existing row. No double-billing.

## Step 4 — Run an analysis

Once both participants have submitted (and at least some documents are `ready`), tell Reina **"run a diligence analysis"** or use the in-chat scope picker. Modes:

| Mode | What it does | When to use |
|------|--------------|-------------|
| **Comparison** | Side-by-side map differences + a proposed standard process | First pass — understand what's the same, what's different |
| **Synergy** | Quantified consolidation savings, FTE overlap, systems rationalisation | Investment-committee numbers |
| **Redesign** | One unified target operating model with per-step lineage | Post-merger integration planning |
| **Diligence memo** | Document-primary memo with Day-1 / TSA / Separation framing — exportable to PowerPoint | The polished deliverable for your IC |

Each finding the AI generates carries:
- A **severity** (low / medium / high / critical)
- A **confidence score** (0–1)
- An **impact list** (Day-1 / TSA / Separation / Long-term)
- An **evidence list** — chunk citations into the documents OR step references into the maps

After the first run completes, **subsequent uploads automatically queue a delta analysis** (throttled to once per hour). Findings new since the previous run get a small **NEW** pill in the workspace.

## Step 5 — Review findings

In the workspace modal's Findings section, every finding shows reviewer controls:

- **Approve** ✓ — finding ships in the public report and the PowerPoint export
- **Reject** ✕ — finding hidden from everyone
- **Needs revision** ✎ — visible to editors, hidden from the public report

You can edit the title and body in place. The AI's original wording is preserved in the audit log; what you see is your edit.

**Don't skip evidence.** Expand a finding and click **Inspect** on any evidence row — the cited chunk plus one neighbour either side opens inline with the target highlighted. Click **Open** to fetch a signed URL for the source document. If a citation doesn't back the finding, drop it.

**Discuss inline.** Each finding has a **Discussion** thread (use `@email` to mention someone) and a row of **Tags** for triage: *Deal-breaker · Re-trade · Disclose · Mitigate · Monitor*. Editors can clear a yellow **STALE** badge with **Mark verified** after re-checking a finding whose underlying document was reprocessed.

**Use the Q&A queue.** A dedicated section between Documents and Findings lets you log questions for the seller, assign them to a participant, and track who answered.

## Step 6 — Generate the scorecard

Click **Scorecard** in the modal header bar. This produces a one-page IC summary auto-filled from the latest analysis:

- Thesis (from executive summary)
- Top-5 risks ranked by severity × confidence
- Mitigants (recommendations across the top findings)
- Severity counts + risk score
- Doc coverage by category
- A rule-based recommended action: *Re-trade or walk · Negotiate price · Proceed with conditions · Proceed; address in 100-day plan · Proceed with confidence*

Top-risk rows deep-link back to their finding in the workspace.

## Step 7 — Export to PowerPoint

When at least one finding is approved, the **Export to PowerPoint** button activates from the chat (Reina can also propose it). The deck includes:

- Cover slide
- Executive summary
- Per-section finding slides (Tech Landscape, Operational Footprint, Organisation, Red Flags)
- Day-1 / TSA / Separation cross-cut
- Key takeaways

Approved findings only — pending and rejected ones never leave the platform.

## Common questions

**A finding's evidence doesn't open.** The signed URL expired (5 min TTL). Click **Inspect** again — a fresh URL is requested per click.

**The analysis says "Not all companies have completed their process map".** Each participant must submit their map first. Diligence mode is the exception — it can run from the data room alone.

**A scanned PDF landed as `stored` instead of `ready`.** OCR isn't configured. Org admins can paste a Mistral key under **Org admin → API keys → Mistral (OCR)** to enable it for the whole org. Then click **Reprocess** on the document.

**I uploaded a new version of a document — are findings updated?** When you reprocess, every finding citing that document is flagged **STALE** in yellow so reviewers know to re-verify. Click **Mark verified** to clear once you've checked.

**I want to re-run the analysis.** Just tell Reina "re-run the analysis" or use the scope picker. Reviewer decisions persist by content key — if a finding's title doesn't change between runs, your previous approve/reject sticks. New uploads automatically queue a delta run after one hour.
