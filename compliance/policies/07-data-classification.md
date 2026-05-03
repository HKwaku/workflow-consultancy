# Data Classification Policy

| Field | Value |
|---|---|
| Policy owner | [POLICY OWNER — typically Security Officer] |
| Approved by | [APPROVER NAME, TITLE] |
| Approval date | [YYYY-MM-DD] |
| Last reviewed | [YYYY-MM-DD] |
| Review cadence | Annual |
| SOC 2 mapping | C1.1, CC6.1, CC6.7 |

> **NOT LEGAL ADVICE.** Template — have your counsel and auditor review before adoption.

## 1. Purpose

To classify data by sensitivity so that appropriate handling, storage, transmission, and retention controls can be applied.

## 2. Classes

| Class | Definition | Examples in this product |
|---|---|---|
| **Public** | Intentionally published; no harm if disclosed | Marketing site copy, documentation |
| **Internal** | For workforce only; mild reputational harm if leaked | Internal runbooks, deploy logs without secrets |
| **Confidential** | Customer or company sensitive; material harm if leaked | Customer documents, deal findings, audit logs, customer email addresses |
| **Restricted** | Highest sensitivity; existential harm if leaked | Auth tokens, BYO API keys, Vault secrets, root credentials, customer M&A targets |

## 3. Handling controls

| Control | Public | Internal | Confidential | Restricted |
|---|---|---|---|---|
| Encryption at rest | Optional | Required | Required | Required (Vault) |
| Encryption in transit | Required | Required | Required | Required |
| Access basis | Anyone | Workforce | Need-to-know | Need-to-know + privileged approval |
| MFA required to access | No | Yes | Yes | Yes |
| Logging of access | No | Optional | Required (audit_logs) | Required |
| Permitted storage | Anywhere | Workforce systems | Sanctioned platforms only | Vault / 1Password / sealed envelope |
| Permitted transmission | Anywhere | Internal channels | Sanctioned channels only | Sealed transport only; never in plaintext email/Slack |
| Retention default | Indefinite | 3 years | Per customer DPA | Per customer DPA |

## 4. Examples in this codebase

| Asset | Class | Where stored |
|---|---|---|
| Customer-uploaded deal documents | Confidential | Supabase Storage (RLS-protected bucket) |
| Customer document text chunks | Confidential | `deal_document_chunks` table (RLS) |
| Customer auth tokens | Restricted | Supabase Auth (managed) |
| Customer BYO API keys | Restricted | Supabase Vault (`vault.create_secret`) |
| Audit logs | Confidential | `audit_logs` table |
| Token-usage ledger | Confidential | `token_usage_ledger` table |
| Sentry events | Confidential | Sentry (PII filtered via `lib/logger.js`) |
| Application source code | Internal | GitHub (private repo) |
| Build/runtime secrets | Restricted | Vercel environment variables |

## 5. Data residency

5.1. Customer data residency requirements are documented per customer in the contract.
5.2. Default residency: Supabase region [REGION], Vercel functions in [REGION].
5.3. LLM provider data residency is governed by the vendor's DPA (Anthropic Zero Data Retention applies where contracted; see `lib/customerKey.js`).

## 6. Retention

6.1. Customer data is retained for the contract term plus the period required by the DPA.
6.2. GDPR Article 17 erasure requests are processed within 30 days via the deletion flow (`app/api/account/`, `app/api/cron/expunge-deleted-accounts/`).
6.3. Audit logs are retained for at least 12 months for SOC 2 sampling.
6.4. Backups are retained per the [Backup & Recovery Policy](12-backup-recovery.md).

## 7. Disposal

7.1. Soft-delete then hard-delete (cron-based) for customer data; see GDPR migration `supabase/migration-gdpr-account-deletion.sql`.
7.2. Hardware: workforce devices are wiped (full disk encryption + factory reset) before reassignment or disposal.
7.3. Cloud-managed media disposal is the cloud provider's responsibility (covered under their SOC 2).

## 8. Markings

8.1. Confidential and Restricted assets must be clearly labelled where the platform supports labelling (Google Drive labels, document headers).
8.2. Code paths handling Restricted data should be flagged in code comments (e.g., `// Restricted: BYO API key — Vault round-trip required`).
