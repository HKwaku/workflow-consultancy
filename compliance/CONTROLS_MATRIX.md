# SOC 2 Controls Matrix

Maps the **Trust Services Criteria (TSC 2017, revised 2022)** to the actual capabilities present in this codebase. Status flags:

- **COVERED** — control is implemented and evidence is collectable today
- **PARTIAL** — control is partially implemented; gap noted in the row
- **GAP** — control is not implemented; would block a Type II audit

Re-evaluate this matrix every quarter. Last updated: **2026-04-25**.

---

## CC1 — Control Environment

| Ref | Criterion | Status | Implementation / Evidence |
|---|---|---|---|
| CC1.1 | Demonstrates commitment to integrity and ethical values | GAP | Code of Conduct policy not yet adopted. See `policies/08-acceptable-use.md`. |
| CC1.2 | Board oversees internal control | GAP | Requires board minutes referencing security oversight. |
| CC1.3 | Management establishes structures, reporting lines | PARTIAL | RBAC implemented (`lib/orgAdmin.js`, `supabase/migration-org-rbac.sql`). HR reporting structure outside scope of this codebase. |
| CC1.4 | Demonstrates commitment to attract competent individuals | GAP | Background-check vendor (Checkr/Certn) not yet adopted. |
| CC1.5 | Holds individuals accountable | GAP | Performance review process documented elsewhere. |

## CC2 — Communication and Information

| Ref | Criterion | Status | Implementation / Evidence |
|---|---|---|---|
| CC2.1 | Obtains/uses relevant quality information | COVERED | Sentry hook in `lib/logger.js`; structured logs throughout. `audit_logs` table (migration 26) + `audit_log_event()` RPC + `lib/auditLog.js` wrapper. Wired across deal access (`lib/dealAuth.js`), member mutations (`orgAdmin.js` + members PATCH), customer key set/revoke (`customerKey.js`), GDPR request/cancel (`/api/me/account`), and the expunge cron. |
| CC2.2 | Internal communication of objectives | PARTIAL | Build/diagnostic docs exist (`BUILD_GUIDE.md`, `DIAGNOSTICS_CAPABILITIES.md`); no formal employee comms cadence. |
| CC2.3 | External communication | PARTIAL | Customer docs at `app/docs/[...slug]`; status page runbook at `RUNBOOK_STATUS_PAGE.md`. Public status page deferred. |

## CC3 — Risk Assessment

| Ref | Criterion | Status | Implementation / Evidence |
|---|---|---|---|
| CC3.1 | Specifies suitable objectives | PARTIAL | Documented in `BUILD_GUIDE.md`; no formal annual risk assessment. |
| CC3.2 | Identifies and analyses risk | GAP | See `policies/09-risk-management.md`. Risk register not yet maintained. |
| CC3.3 | Considers fraud potential | GAP | No documented fraud-risk review. |
| CC3.4 | Identifies and assesses change | COVERED | Change-management policy (`policies/03-change-management.md`); git-based PR review process. |

## CC4 — Monitoring Activities

| Ref | Criterion | Status | Implementation / Evidence |
|---|---|---|---|
| CC4.1 | Selects, develops, performs ongoing evaluations | COVERED | Sentry alerting; `cron_run_log` table (migration 27) + `cron_run_open()` / `cron_run_close()` RPCs + 30-day rollup view. `lib/cronWrapper.js` opens a row on cron entry and closes it on exit (success/failed) — every cron using `withCron(...)` writes automatically. |
| CC4.2 | Communicates internal control deficiencies | PARTIAL | `audit_logs` table records denied/error outcomes. Formal deficiency-tracking process (ticketed, owner-assigned, SLA'd) still needs to be documented. |

## CC5 — Control Activities

| Ref | Criterion | Status | Implementation / Evidence |
|---|---|---|---|
| CC5.1 | Selects/develops control activities | COVERED | RLS policies, cron-job wrappers, rate limiting, cost guardrails — all in code. |
| CC5.2 | Selects/develops technology controls | COVERED | Encryption (Vault for BYO keys), MFA helper (`lib/mfaCheck.js`), RBAC (`lib/orgAdmin.js`). |
| CC5.3 | Deploys via policies and procedures | PARTIAL | Policies in `compliance/policies/`; procedures need adoption + sign-off. |

## CC6 — Logical and Physical Access Controls

| Ref | Criterion | Status | Implementation / Evidence |
|---|---|---|---|
| CC6.1 | Implements logical access security software, infrastructure, architectures | COVERED | Supabase RLS on every tenant table (`supabase/migration-*.sql`); auth via `lib/auth.js`; deal access via `lib/dealAuth.js`. |
| CC6.2 | Restricts access via authentication | COVERED | Supabase Auth + JWT verification (`lib/auth.js`). |
| CC6.3 | Authorisation based on role | COVERED | `lib/orgAdmin.js`, `lib/dealDocumentVisibility.js`, RBAC migration. |
| CC6.4 | Restricts physical access | N/A | Cloud-only; relies on Supabase / Vercel / inherited SOC 2 reports. |
| CC6.5 | Disposes of data containing confidential info | COVERED | GDPR erasure cron at `app/api/cron/expunge-deleted-accounts/`; migration `supabase/migration-gdpr-account-deletion.sql`. |
| CC6.6 | Restricts external access (firewall, encrypted transit) | COVERED | TLS via Vercel; secrets in env / Supabase Vault. |
| CC6.7 | Restricts data movement | PARTIAL | `lib/dealDocumentVisibility.js` enforces per-party document access; no DLP scanning. |
| CC6.8 | Prevents/detects unauthorised software | GAP | No EDR / endpoint management. Workforce-device policy needed. |

## CC7 — System Operations

| Ref | Criterion | Status | Implementation / Evidence |
|---|---|---|---|
| CC7.1 | Detects vulnerabilities | PARTIAL | GitHub Dependabot (assumed enabled); no formal Snyk/Trivy in CI. See `policies/11-vulnerability-management.md`. |
| CC7.2 | Monitors for anomalies | COVERED | Sentry; rate-limit anomaly logging in `lib/rate-limit.js`. |
| CC7.3 | Evaluates security events | PARTIAL | Sentry alerts triaged ad-hoc; no documented SLA. |
| CC7.4 | Responds to security incidents | PARTIAL | `policies/04-incident-response.md` provides template; no tabletop exercise yet. |
| CC7.5 | Recovers from incidents | COVERED | `RUNBOOK_BACKUP_RESTORE.md`; Supabase point-in-time recovery; cron to reap stuck documents. |

## CC8 — Change Management

| Ref | Criterion | Status | Implementation / Evidence |
|---|---|---|---|
| CC8.1 | Authorises, designs, develops, configures, documents, tests, approves, implements changes | COVERED | Git PR review; tests in `tests/`; migration log in `supabase/MIGRATIONS.md`; `policies/03-change-management.md`. |

## CC9 — Risk Mitigation

| Ref | Criterion | Status | Implementation / Evidence |
|---|---|---|---|
| CC9.1 | Identifies, selects, develops risk mitigation activities | PARTIAL | Cost guardrails (`lib/costGuard.js`), rate limiting (`lib/rate-limit.js`), per-org budgets — operational. Risk register not yet maintained. |
| CC9.2 | Assesses, manages vendor risks | PARTIAL | `policies/05-vendor-management.md` template; no live vendor inventory yet. |

---

## Additional Trust Services Criteria

The following only apply if you commit to them in your audit scope. Most B2B SaaS products audit **Security only** for the first cycle, then add **Confidentiality** and **Availability** later. **Privacy** and **Processing Integrity** are usually added only when contractually required.

### A — Availability

| Ref | Criterion | Status | Implementation / Evidence |
|---|---|---|---|
| A1.1 | Capacity planning | PARTIAL | No formal capacity reviews; Vercel/Supabase auto-scale partially mitigates. |
| A1.2 | Environmental protections, backups, recovery | COVERED | Supabase managed backups + PITR; `RUNBOOK_BACKUP_RESTORE.md`; cron job recovery. |
| A1.3 | Tests recovery plans | GAP | No documented restore drill yet. Quarterly drill required for Type II. |

### C — Confidentiality

| Ref | Criterion | Status | Implementation / Evidence |
|---|---|---|---|
| C1.1 | Identifies, maintains confidential info | COVERED | Data classification policy (`policies/07-data-classification.md`); RLS on every tenant table. |
| C1.2 | Disposes of confidential info | COVERED | GDPR erasure flow; soft-delete + hard-delete cron. |

### PI — Processing Integrity

| Ref | Criterion | Status | Implementation / Evidence |
|---|---|---|---|
| PI1.1 | Specifies processing requirements | PARTIAL | LLM output schemas in `lib/ai-schemas.js`; evidence-verification step in `runDealAnalysis`. |
| PI1.2 | Inputs are complete, accurate, validated | COVERED | Zod-style validation in API routes; preflight checks in analyse route. |
| PI1.3 | Processing is complete, accurate, timely, authorised | COVERED | Inngest `step.run()` resumability; `deal_analyses.status` state machine. |
| PI1.4 | Outputs are complete, accurate, distributed only to intended | COVERED | RLS + dealAuth enforcement on every read. |
| PI1.5 | Stored data is complete, accurate, timely | PARTIAL | Findings dual-stored (JSONB + relational table); no formal data-quality monitoring. |

### P — Privacy (only if you offer it)

| Ref | Criterion | Status | Implementation / Evidence |
|---|---|---|---|
| P1-P8 | Notice, choice, collection, use, retention, disclosure, quality, monitoring | PARTIAL | GDPR Article 17 (erasure) and Article 20 (portability) covered by `app/api/account/export` and `expunge-deleted-accounts` cron. Privacy notice + DPA templates in `legal/`. Full P-series compliance requires a Privacy Officer role. |

---

## Evidence-collection mapping

The script `scripts/collect-soc2-evidence.mjs` (Item 5 / Task #95) snapshots the following on a monthly cadence. Each snapshot maps to the matrix rows above:

| Evidence artefact | Maps to |
|---|---|
| Supabase RLS policy dump | CC6.1, CC6.3, C1.1 |
| Cron-job execution log (last 30 days) | CC4.1, CC7.2, A1.2 |
| Sentry alert-rule export | CC2.1, CC7.2, CC7.3 |
| `audit_logs` row count + sample | CC2.1, CC4.2 |
| MFA-status report (per-org) | CC6.2 |
| Token-usage ledger summary | CC9.1 |
| Migration history (`supabase/MIGRATIONS.md` + git log) | CC8.1 |
| Vendor inventory (env vars, package.json) | CC9.2 |
| Backup test result | A1.2, A1.3 |
| GDPR erasure cron run history | CC6.5, P-series |

Store snapshots in a folder your auditor can access (auditors typically use Drata/Vanta/Secureframe portals; if you go manual, a private S3 bucket with versioning enabled works).
