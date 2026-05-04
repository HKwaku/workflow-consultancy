# M&A deal-context end-to-end test scenario

A focused test scenario for the **map-target → map-acquirer → redesign merged flow** path. Pick one process universal enough that both companies have it, but different enough that the redesign has interesting trade-offs.

## Process under test

**Customer onboarding** (sales-qualified lead → first invoice paid)

## Deal setup

- **Acquirer:** Meridian Freight (1,200 staff, established ERP-driven ops)
- **Target:** Atlas Logistics (180 staff, scrappy, lots of personal relationships)

Create the deal via the M&A pillar in the chat opener; both party names should land in the right participant roles (acquirer / target).

---

## Round 1 — Map the Acquirer's process

Switch to the Acquirer participant and paste this:

> Walk me through Meridian Freight's customer onboarding. A sales rep flags a deal as won in Salesforce. That triggers a Slack notification to onboarding ops. The onboarding coordinator pulls the contract from DocuSign, opens a new account in NetSuite, and assigns a 4-digit customer code. They run a Creditsafe check on the new customer; if the limit comes back below £25k, the account is flagged for finance review and parked. Above £25k it goes through automatically. The coordinator then schedules a kickoff call with the customer success manager, who walks the customer through their dashboard access, set up SSO if they're enterprise tier, and assigns a dedicated account manager. The CSM enters the agreed SLA and billing cadence into NetSuite. Once that's done, the first invoice is auto-generated on the next billing cycle. We average 11 days from won-deal to first invoice. Onboarding completion target is 7 days but we hit that maybe 50% of the time — usually the kickoff call gets rescheduled twice.

---

## Round 2 — Map the Target's process

Switch to the Target participant (Atlas Logistics) and paste this:

> Atlas does customer onboarding very differently. It starts when the salesperson — who's usually one of the two co-founders — shakes hands with the customer. They write up a one-page summary in Word and email it to the office manager. She enters the customer details into D365 Business Central by hand, requests a Companies House check from the bookkeeper for any new ltd company, and sets up a customer record manually. Credit limits are set by Tom the co-founder based on his judgement — there's no formal scoring. He emails the office manager a number, she enters it. The salesperson does the kickoff personally, usually in person at the customer's site, and sets the customer's expectations on service levels. There's no formal SLA document — agreements are verbal or written into the email thread. The office manager generates the first invoice manually in D365 BC after the first job is delivered. The full cycle takes anywhere from 3 days to 3 weeks depending on whether Tom is travelling. About 15% of customers come back later asking what their credit terms actually are because nothing was written down.

---

## Round 3 — Generate the redesigned merged flow

Once both flows are mapped, scope the chat to the deal and prompt:

> Both companies' customer onboarding processes are mapped. Meridian's is structured but slow on the kickoff. Atlas's is fast and personal but has no formal SLA, no credit scoring, and 15% of customers don't know their terms.
>
> Design the unified onboarding process for the combined company. We want to keep Atlas's relationship-led feel but pull in Meridian's structure where it actually adds value (formal SLAs, written credit terms, automated first-invoice trigger). The merged company will run on NetSuite — D365 BC will be retired in 6 months. Customer code formats need to align. Credit limits should follow Meridian's tiered policy. Expected savings, who owns each step in the new world (combined teams), and where the bottlenecks are likely to land in the redesigned flow.

---

## What this scenario exercises end-to-end

1. **Two participants on one deal**, each with their own process map → exercises `deal_participants.report_id` linkage, the `deal_flows` table, the workspace's "Participants — Complete" badges, and the artefacts panel grouping by company.
2. **Side-by-side comparison view** → the workspace should show both flows under the same process name ("Customer onboarding") with a comparison surface.
3. **Synergy / redesign analysis** → exercises `deal_analyses` with `mode='redesign'` (or `mode='synergy'` for the comparison-first variant), `source_flow_ids` referencing both flows, and the AI redesign agent drawing from both inputs.

### Specific things to verify in the redesigned flow

- **Trigger captured** as `startsWhen: "Sales rep marks deal as won in Salesforce"` on the boundary, **not** as Step 1.
- **No random connectors** during the build.
- **One legitimate decision with merge** — the credit-tier branch (`≥£25k auto-approve` / `<£25k finance review`) with both paths rejoining at "Schedule kickoff call" (a real merge with 2 incoming paths).
- **No orphan merges** — every `isMerge:true` step has 2+ inputs.
- **Department field populated** for every step (Sales / Onboarding ops / Finance / CSM / IT).
- **Systems field populated** with NetSuite (since D365 BC is sunsetting).
- **Bottleneck flagged** — kickoff scheduling (50% of time exceeds 7-day target on Meridian; 15% of customers unclear on terms on Atlas).
- **Owner field populated** with real roles, not "your team".
- **Estimated impact** — Atlas's 3-week worst case dropped to 7 days, Meridian's 11-day average dropped to 7 days.
- **changeOverview metric cards** populated correctly (kept / merged / new / removed / total).
- **Phasing block** — the redesign output's phasing array should be non-trivial:
  - Phase 1 — NetSuite migration of Atlas customer master
  - Phase 2 — SLA template adoption
  - Phase 3 — Unified credit policy rollout
- **Risks block** — D365 BC sunset risk, key-person dependency on Tom's credit judgement, change-management for Atlas team losing personal relationships.

### Decision cards review

In the redesigned analysis, decision cards should be reviewable (✓ / ✗ verdicts). The chat should let you accept or reject specific changes individually, then re-run.

### Database population check

After the redesign completes, run:

```sql
SELECT mode, status, jsonb_array_length(result->'redesignedProcess'->'steps') AS step_count
FROM deal_analyses
WHERE deal_id = '<your-deal-id>'
ORDER BY created_at DESC;
```

Expect: `redesign | complete | <reasonable step count>`.

### Chat artefacts panel

Should show three artefacts under the deal's grouping:

1. The acquirer's flow snapshot
2. The target's flow snapshot
3. The deal_analysis result

---

## Why this scenario

This single test validates the whole M&A workflow end-to-end without confusing the agent with too many concurrent processes. If anything breaks at any step, the failure mode tells you which layer is at fault:

- Deal-setup form
- Participant scoping
- Single-flow mapping
- Comparison view
- Redesign agent
- Rendering layer

Pass this test and the M&A path is demo-ready. Fail any specific verification above and the failing item names the regression precisely.
