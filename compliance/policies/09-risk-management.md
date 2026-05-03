# Risk Management Policy

| Field | Value |
|---|---|
| Policy owner | [POLICY OWNER — typically Security Officer] |
| Approved by | [APPROVER NAME, TITLE] |
| Approval date | [YYYY-MM-DD] |
| Last reviewed | [YYYY-MM-DD] |
| Review cadence | Annual + quarterly risk-register review |
| SOC 2 mapping | CC3.1, CC3.2, CC3.3, CC9.1 |

> **NOT LEGAL ADVICE.** Template — have your counsel and auditor review before adoption.

## 1. Purpose

To identify, assess, and treat risks to the confidentiality, integrity, and availability of company and customer data.

## 2. Risk universe

The risk register considers at minimum:
- Cyber-security risks (intrusion, data exfiltration, ransomware, supply-chain attack)
- Operational risks (vendor outage, key-person dependency, deployment failure)
- Regulatory risks (GDPR, CCPA, sector-specific)
- LLM-specific risks (prompt injection, model drift, hallucinated outputs in customer-facing artefacts)
- Financial risks (LLM cost runaway, fraud)
- Fraud risk (insider threat, account takeover)

## 3. Assessment methodology

3.1. Each risk is rated on **Likelihood** (1-5) × **Impact** (1-5).
3.2. Inherent risk = Likelihood × Impact (before controls).
3.3. Residual risk = re-rated after current controls.
3.4. **Risk appetite:** residual ≤ 6 is accepted; 7-12 requires active treatment plan; ≥ 13 requires immediate escalation to [CEO/CISO].

## 4. Annual risk assessment

4.1. The Security Officer convenes a workshop with Engineering, Product, and People Ops.
4.2. The risk register is reviewed top-to-bottom; new risks are added; closed risks are archived.
4.3. The output is approved by the [CEO/CISO] and shared with the workforce in summary form.

## 5. Quarterly risk review

5.1. Each quarter, the Security Officer reviews:
   - Open risk-treatment plans (on-track / slipping / blocked)
   - Newly disclosed industry vulnerabilities (CVEs, vendor advisories) and whether they apply
   - Incident postmortems for new risks surfaced
5.2. The review is documented in the risk register.

## 6. Risk treatment

For each risk in the register, one of:
- **Mitigate** — add or strengthen a control (update [CONTROLS_MATRIX.md](../CONTROLS_MATRIX.md))
- **Accept** — sign-off by [CEO/CISO] required for residual ≥ 7
- **Transfer** — insurance or contractual transfer
- **Avoid** — discontinue the risky activity

## 7. Risk register

The risk register is maintained at **[LINK TO INTERNAL REGISTER]**. Each entry contains: ID, description, owner, inherent rating, controls, residual rating, treatment plan, due date, status.

## 8. Specific top risks (starter set)

These should be expanded based on the company's actual risk assessment:

| Risk | Likely impact area | Initial controls (already in place) |
|---|---|---|
| RLS bypass exposes customer data across tenants | Confidentiality | RLS on every tenant table; integration tests on dealAuth; quarterly access review |
| BYO API key exposure | Confidentiality | Vault encryption (`lib/customerKey.js`); never logged; rotation reminders cron |
| LLM hallucinates a finding presented to customer as evidence-backed | Integrity / customer trust | Evidence-verification step in `runDealAnalysis`; findings include source quotes; user review/approval flow |
| LLM cost runaway | Financial | Per-org budget (`lib/costGuard.js`); preflight + post-call recording; rate limiting |
| Vendor outage (Supabase / Vercel / Anthropic) | Availability | Status page; documented runbook; multi-vendor LLM support |
| Compromise of GitHub or deploy pipeline | Confidentiality, integrity | MFA; branch protection; signed commits (where supported); audit log |
| Insider threat (legitimate workforce member exfiltrates data) | Confidentiality | Access reviews; audit_logs; principle of least privilege; deferred: DLP |
| Phishing leading to workforce credential compromise | All | MFA on every system; security training; phishing-reporting channel |
| Supabase Vault key compromise | Confidentiality | Vault is provider-managed; key rotation per Supabase guidance; secondary mitigation via per-org BYO keys |

## 9. Escalation

Risks rated residual ≥ 13 are escalated immediately to the [CEO/CISO] and added to the next executive meeting agenda.
