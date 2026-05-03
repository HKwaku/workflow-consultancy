---
title: The diligence memo deep-dive
group: Tutorials
order: 3
summary: How the AI builds your memo, what the sections mean, and how to drive it.
---

The diligence memo is Vesno's polished M&A deliverable. It maps to the slide template most M&A teams already use: Tech Landscape, Operational Footprint, Organisation, Red Flags, Day-1 / TSA / Separation, Key Takeaways.

## How it builds

When you click **Run diligence**, the system:

1. **Resolves the data room.** Up to 30 of the most relevant document chunks are pulled (semantic + keyword search, fused by reciprocal-rank).
2. **Sends them to Claude** along with any participant process maps and the prompt template that defines the section schema.
3. **Validates every citation.** For each `evidence` pointer the model emits, we look up the chunk it claims to cite and verify the snippet actually appears in the chunk. Pointers that fail are dropped; findings whose all-pointers fail are dropped entirely. Findings with partial-failure get their confidence downgraded by 0.2.
4. **Stores the result** plus a stable `findingKey` per finding, so reviewer decisions survive re-runs.

You see the result rendered as a memo in the deal page.

## Section by section

**Executive Summary** — single finding, the partner-facing 2-3 sentence top line. Confidence + severity + impact axes apply.

**Technology Landscape** — core systems, integrations, technical debt, system of record, key dependencies. Severity skews medium-high.

**Operational Footprint** — sites, customer concentration, supplier concentration, capacity constraints, key processes.

**Organisation** — org-chart shape, key-person dependency, headcount distribution, leadership gaps.

**Red Flags** — things that would change the bid or kill the deal. Severity skews high/critical. Read these first.

**Transition Lens** (cross-cut) — the same findings re-cut by **when they bite**:
- **Day 1** — must be solved before close
- **TSA** — covered by transition services agreement
- **Separation** — only relevant if the target separates from a parent
- **Long-term** — strategic but not pre-close

**Key Takeaways** — top 3-5 across all sections, ranked.

## How to drive it

**Tip 1: Upload the right files first.** The retrieval pulls top-30 chunks. If your CIM, financial model, and contracts are all in, you'll get findings backed by them. If they're missing, you'll get findings backed by whatever you did upload (which might be marketing decks).

**Tip 2: Tag source party.** When uploading, set "Source party" to acquirer / target / seller. The analysis prompt weights perspective by source.

**Tip 3: Use visibility for confidentiality.** "Acquirer only" means the target's owner won't see your annotations. See [Per-party visibility](/docs/reference/per-party-visibility).

**Tip 4: Re-run to refine.** Approve the findings you trust, reject the ones you don't, click Run again. The next pass tends to converge on the kept set + better evidence.

**Tip 5: Watch for "⚠ No source evidence cited".** That tag appears on findings where the model didn't ground the claim in any chunk. Treat them as the AI's prior, not as a citation.

## Exporting

Click **Export to PowerPoint** once at least one finding is approved. The deck mirrors the on-screen layout exactly so reviewers see what they signed off.

Approved-only — pending and rejected findings never leave the platform.

## Common questions

**Why are some findings missing the citation badge?** Either: the model didn't cite (rare; we prompt for it), OR the validator dropped the citation as hallucinated. The second case is intentional — better to show "no evidence" than fake evidence.

**Can I edit a finding's wording?** Yes. The reviewer panel lets you edit title and body. The AI's original phrasing is preserved in the audit log.

**A whole section is empty in my memo.** The model genuinely had nothing to say there. This is the "drop, don't fabricate" rule in action. Upload more relevant documents and re-run if the section matters.
