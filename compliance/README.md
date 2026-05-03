# Compliance — SOC 2 Readiness Baseline

**Status: Type I-ready (policies + controls documented). NOT audit-passed.**

---

## What this folder is — and isn't

This folder contains the *policy set, controls matrix, and evidence-collection tooling* that a SOC 2 auditor will want to see during a Type I or Type II engagement. Shipping these files **does not** make the company SOC 2 compliant. It puts you in a position to **start** the audit process.

There are three distinct milestones:

| Milestone | What it means | What it requires |
|---|---|---|
| **Readiness (this folder)** | Policies exist, controls are documented, evidence is collectable | The work in this directory |
| **Type I report** | An auditor confirms the controls *exist* and are *designed correctly* on a single date | Readiness + a CPA firm + ~2-4 weeks |
| **Type II report** | An auditor confirms the controls *operated effectively* over a period (typically 3-12 months) | Type I + 3-12 months of evidence + a CPA firm + ~$15k-$60k |

Most enterprise procurement teams want a Type II report. Plan for **6-12 months minimum** from "we have policies" to "we have a Type II report." There is no shortcut.

---

## What you should do next

1. **Pick a compliance-automation vendor.** Doing SOC 2 manually is possible but painful. The major vendors are:
   - [Drata](https://drata.com) — most polished, ~$10k-$20k/yr starter, integrates with AWS/GCP/Supabase/GitHub/Sentry
   - [Vanta](https://vanta.com) — comparable to Drata, slightly cheaper at the low end
   - [Secureframe](https://secureframe.com) — similar feature set, sometimes wins on price

   These tools auto-collect evidence (cloud configs, MFA status, vulnerability scans, etc.) and feed it to your auditor. They cut the manual evidence-collection burden by ~80%. The policy templates in `policies/` map cleanly onto their checklists.

2. **Pick an auditor.** Compliance vendors usually have a referral list. Independent CPA firms that specialise in SOC 2 include A-LIGN, Prescient Assurance, Johanson Group, BARR Advisory. Get 2-3 quotes; readiness assessment + Type I + Type II runs $25k-$80k.

3. **Stand up the controls operationally.** Policies on paper aren't enough — the auditor will sample evidence over the audit window. Practical short-list:
   - MFA enforced for every workforce account (Supabase, GitHub, Vercel, Sentry, Anthropic console, AWS/GCP, Google Workspace, etc.)
   - Quarterly access reviews with a documented sign-off
   - Background checks for new hires (Checkr is the standard)
   - Annual security training (KnowBe4, Curricula)
   - Documented incident response runbook + at least one tabletop exercise per year
   - Vulnerability scanning in CI (Snyk, Dependabot, Trivy)
   - Penetration test — at least annually (Cobalt, HackerOne, Bishop Fox)

4. **Run the evidence-collection script monthly.** `scripts/collect-soc2-evidence.mjs` snapshots configurations the auditor will sample (Supabase RLS state, cron-job execution logs, Sentry alert rules, audit-log row counts, etc.). Store snapshots in a folder your auditor can read.

5. **Schedule a quarterly review.** Walk through `CONTROLS_MATRIX.md`, mark anything that has drifted, fix it, re-snapshot evidence.

---

## Files in this folder

```
compliance/
├── README.md                       # This file
├── CONTROLS_MATRIX.md              # SOC 2 TSC → our controls, with status flags
└── policies/
    ├── 01-information-security.md
    ├── 02-access-control.md
    ├── 03-change-management.md
    ├── 04-incident-response.md
    ├── 05-vendor-management.md
    ├── 06-business-continuity.md
    ├── 07-data-classification.md
    ├── 08-acceptable-use.md
    ├── 09-risk-management.md
    ├── 10-onboarding-offboarding.md
    ├── 11-vulnerability-management.md
    └── 12-backup-recovery.md
```

Every policy is a **template**. Each one has a `[COMPANY NAME]`, `[POLICY OWNER]`, and `[REVIEW DATE]` field that needs to be filled in before it's adopted. Every policy has an explicit `Last reviewed: YYYY-MM-DD` line — auditors will reject policies older than 12 months without a documented review.

---

## NOT LEGAL ADVICE

These templates are starting points written by a software engineer, not a lawyer or licensed compliance professional. **Have your counsel and your auditor review each policy before adoption.** Policies are adopted by management sign-off (typically the CEO or CISO), not by checking them into git.

---

## Honest gap analysis (what's missing from "readiness" to "audit-ready")

| Gap | What it would take | Owner |
|---|---|---|
| Policies signed by management | Each policy needs a dated approval (PDF with wet/digital signature) | CEO/CISO |
| Background checks | Adopt a vendor (Checkr/Certn) and run for new hires | HR |
| Annual security training | Adopt a vendor (KnowBe4/Curricula) and require completion | People Ops |
| MFA enforcement *evidence* | We have a helper (`lib/mfaCheck.js`) but need a recurring report | Engineering |
| Vendor risk reviews | Documented review of every sub-processor + their SOC 2 / ISO 27001 reports | Security |
| Penetration test | Engage a vendor; results + remediation plan are required for Type II | Security |
| Vulnerability management | Snyk/Dependabot already partial; need formal SLA + tracking | Engineering |
| Incident response tabletop | At least one practiced incident response exercise per year | Security |
| Logical-access review | Quarterly review of every prod system's user list, with sign-off | Engineering manager |
| Customer-facing trust page | A `/trust` page describing controls helps procurement; not required for audit | Marketing/Eng |

---

## Where this baseline came from

The capability map in `CONTROLS_MATRIX.md` is generated from the actual codebase — Sentry integration in `lib/logger.js`, RLS in `supabase/migrations/`, BYO key encryption in `lib/customerKey.js`, GDPR cron in `app/api/cron/gdpr-erasure/`, etc. The matrix is therefore *honest about what we have today* — not aspirational. If a control says "GAP" it means the code/process does not yet exist.
