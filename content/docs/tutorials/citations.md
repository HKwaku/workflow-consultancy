---
title: How citations work
group: Tutorials
order: 5
summary: What evidence pointers mean, how Vesno verifies them, and why some findings show "no source evidence cited".
---

Vesno's diligence findings carry **evidence pointers** — claims about which document chunk, process step, chat turn, or metric backs each statement. This page explains what they mean and how we keep the model honest.

## The four kinds

Every finding's evidence list is an array of pointers. Each one has:

- **Kind** — one of:
  - `document_chunk` — points at a specific chunk of an uploaded document
  - `process_step` — points at a specific step in a participant's process map
  - `chat_turn` — points at a chat message
  - `metric` — points at a computed metric (cost, frequency, etc.)
- **Ref** — vendor-specific reference data (chunk_id + page_number for document_chunk; step_index for process_step; etc.)
- **Snippet** — verbatim text from the source, ≤400 characters

Click any evidence row to open it. For document_chunks, you'll see the cited passage plus one chunk either side for context, or you can flip to the source file itself.

## How we verify them

Two layers of defence:

### Layer 1 — prompt enforcement
Every analysis prompt includes a `FINDINGS_SHAPE_PROMPT_BLOCK` that tells the model what shape to emit and explicitly says: "Findings without evidence will be filtered out of the rendered report. Prefer fewer, well-supported findings over many speculative ones."

### Layer 2 — server-side validator
After the model returns, we run `verifyEvidence(bundle, chunkIndex)`:

1. For every `document_chunk` evidence pointer, look up its `chunk_id` in the database. If missing → drop the pointer, downgrade finding confidence by 0.2.
2. If the model emitted a `snippet`, compare against the real chunk content via case-insensitive longest-substring + 5-gram overlap. If overlap < 60% → drop the pointer, downgrade confidence.
3. If a finding originally claimed evidence and ALL its pointers were invalidated → drop the entire finding.

You'll see findings with `⚠ No source evidence cited.` — those are the "drop, don't fabricate" rule in action. The model didn't have grounding for the claim and we didn't fabricate one.

## Reading the citation pill

Each evidence pointer renders as a clickable row:

```
DOCUMENT  CIM.pdf · p.42
"Total revenue grew from £12M to £18M between FY24 and FY25."
                                                      [Open ↗]
```

- **Kind** in the upper-left, type-coded by colour
- **Locator** (filename, page, slide, sheet, range, section path)
- **Snippet** in italic — what the model lifted verbatim
- **Open ↗** — opens the modal with cited passage + one chunk either side, OR the source file itself

## Reviewer responsibility

Citations let you verify in seconds, not minutes. A good review:

1. Read the finding title.
2. Click the first evidence row.
3. Read the cited chunk in context. Does it support what the finding claims?
4. If yes → approve. If no → reject with a note explaining why. If partly → mark "Needs revision" and edit the title/body.

The audit log records who approved/rejected each finding. After the deal closes, you can show this trail to anyone who asks.

## Common questions

**Why doesn't process_step evidence open?** We haven't wired the click-through for process_step pointers yet — only document_chunk. The pointer is still recorded; you can verify by opening the participant's report directly.

**An evidence row shows the right page but the snippet is paraphrased.** That's allowed (5-gram overlap > 60%). Pure paraphrase that fails the overlap check would have been dropped. If you think the paraphrase misrepresents the source, reject and note why.

**Can the model "cite" a document I haven't uploaded?** No. The validator checks every chunk_id against the database; a hallucinated chunk_id is dropped. If you think you're seeing a citation to something that doesn't exist, email support@vesno.io with the analysis ID — that's a bug.
