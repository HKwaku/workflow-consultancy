# Vendor Management Policy

| Field | Value |
|---|---|
| Policy owner | [POLICY OWNER — typically Security Officer] |
| Approved by | [APPROVER NAME, TITLE] |
| Approval date | [YYYY-MM-DD] |
| Last reviewed | [YYYY-MM-DD] |
| Review cadence | Annual |
| SOC 2 mapping | CC9.2 |

> **NOT LEGAL ADVICE.** Template — have your counsel and auditor review before adoption.

## 1. Purpose

To assess, monitor, and manage the security risk introduced by third-party service providers (sub-processors).

## 2. Scope

All vendors that store, process, or have logical access to company or customer data. Examples in current use:

| Vendor | Service | Data exposure |
|---|---|---|
| Supabase | Postgres, Auth, Storage, Vault | Customer documents, customer PII, auth tokens |
| Vercel | Application hosting | Application logs, environment variables |
| Anthropic | LLM (Claude) | Customer prompts (per BAA / DPA) |
| OpenAI | LLM (optional) | Customer prompts (per DPA) |
| Voyage AI | Embeddings | Document chunks |
| Sentry | Error monitoring | Stack traces, request payloads (filtered) |
| Inngest | Async job execution | Event payloads |
| Upstash | Rate-limit Redis | Rate-limit counters |
| GitHub | Source code, CI | Source code, deploy keys |
| Google Workspace | Email, docs | Internal communications |

## 3. New vendor onboarding

Before procuring any new vendor that meets the scope:

3.1. Submit a vendor-review request to the Security Officer.
3.2. Provide: vendor name, service description, data types involved, data residency, data volume.
3.3. Collect and review:
   - Vendor's most recent SOC 2 Type II report (or ISO 27001 certificate).
   - Vendor's data processing agreement (DPA).
   - Vendor's sub-processor list.
   - Vendor's incident notification SLA.
3.4. Risk-tier the vendor: **Critical** (handles customer data), **High** (handles internal credentials/code), **Standard** (other).
3.5. The Security Officer approves Critical and High vendors. Standard vendors can be approved by the Engineering Manager.
3.6. Add the vendor to the inventory in §6.

## 4. Ongoing monitoring

4.1. **Annual review** of every Critical and High vendor:
   - Confirm SOC 2 / ISO certification is still current.
   - Review any incidents the vendor has disclosed.
   - Confirm DPA is still in force and reflects current sub-processors.
4.2. **Subscribe to status pages** of every Critical vendor; subscribe to security advisories.
4.3. **Sub-processor changes** by Critical vendors are reviewed within 30 days; if disqualifying, an exit plan is initiated.

## 5. Termination

When a vendor relationship ends:
5.1. Confirm in writing that customer data has been deleted (per the vendor's DPA).
5.2. Revoke all credentials and API keys.
5.3. Update the inventory.
5.4. Notify customers if the change is material (e.g., new sub-processor list).

## 6. Vendor inventory

The current vendor inventory is maintained in **[LINK TO INTERNAL DOC OR SHEET]**. The inventory includes: vendor name, service, risk tier, data types, last review date, contract renewal date, contact.

The script `scripts/collect-soc2-evidence.mjs` extracts a snapshot of vendor identifiers from `package.json` and environment variables to assist this review.

## 7. Customer-facing sub-processor list

A public sub-processor list is published at **[COMPANY URL]/sub-processors** (or in the customer DPA). Customers are notified at least 30 days before adding a new sub-processor that processes their data.

## 8. Exceptions

Engaging a vendor without prior review is permitted only in genuine emergencies, with retrospective review within 5 business days.
