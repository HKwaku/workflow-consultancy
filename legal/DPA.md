# Data Processing Addendum (DPA) — DRAFT

> ⚠️ **NOT LEGAL ADVICE — REVIEW REQUIRED.** This is a starter draft. A qualified lawyer must review before publication.

This Data Processing Addendum ("DPA") supplements the [Terms of Service](./TERMS_OF_SERVICE.md) between **TODO Company Name** ("Processor", "Vesno") and the customer ("Controller") who uses the Vesno platform.

It applies to any processing of Personal Data (as defined under UK GDPR / EU GDPR) by Vesno on behalf of the Controller in connection with the Service.

## 1. Definitions

- **Personal Data, processing, controller, processor, sub-processor, data subject** — as defined in UK GDPR / EU GDPR.
- **Customer Data** — Personal Data the Controller uploads or generates through the Service.
- **Standard Contractual Clauses (SCCs)** — the European Commission's SCCs for international transfers (Module Two: Controller to Processor).

## 2. Roles

- The Controller is the controller of Customer Data.
- Vesno is the processor of Customer Data.
- Vesno is the controller of account data + usage data; that processing is governed by the [Privacy Policy](./PRIVACY_POLICY.md), not this DPA.

## 3. Processor obligations

Vesno will:

a. Process Customer Data only on the Controller's documented instructions, including the configurations the Controller makes through the Service (which models to use, who can see which documents, etc.).

b. Ensure persons processing Customer Data are bound by confidentiality.

c. Implement appropriate technical and organisational measures (see Annex II).

d. Engage sub-processors only as set out in Section 5.

e. Assist the Controller with:
   - Data subject requests (access, deletion, portability) — see Privacy Policy Section 7
   - Data Protection Impact Assessments (on reasonable request)
   - Breach notification (Section 6)
   - Demonstrating compliance with UK GDPR / EU GDPR Article 28

f. At termination, delete or return Customer Data within 30 days, unless retention is required by law. The Controller may export their data via `/portal/settings` at any time.

## 4. Categories of data + data subjects

**Categories of personal data processed:**
- Names, work emails, job titles (account data)
- Customer data uploaded to the Service: process descriptions, deal documents, chat content
- Usage telemetry (IP, device type, page views)

**Categories of data subjects:**
- Authorised users of the Controller's organisation
- Third parties whose data appears in uploaded documents (e.g. employees mentioned in process maps, counterparties in deal documents)

**Special-category data:**
- Not permitted under [Terms of Service Section 3](./TERMS_OF_SERVICE.md). Controller represents that they will not upload special-category data without first executing a separate addendum.

## 5. Sub-processors

Vesno engages the sub-processors listed in [SUBPROCESSORS.md](./SUBPROCESSORS.md). The Controller authorises this engagement.

Vesno will give the Controller **30 days notice** before adding a new sub-processor. The Controller may object on reasonable grounds; if Vesno cannot accommodate, the Controller may terminate the affected services.

Each sub-processor is contractually bound to obligations no less protective than this DPA.

## 6. Personal data breaches

Vesno will notify the Controller without undue delay and in any event within **72 hours** of confirming a Personal Data breach affecting Customer Data. Notification will include:
- Nature of the breach (categories + approximate volume of data subjects + records affected)
- Likely consequences
- Measures taken or proposed
- DPO / contact for further information

## 7. International transfers

For transfers from the UK / EEA to non-adequacy countries:
- Vesno relies on the **EU SCCs (Module Two)** + the **UK International Data Transfer Addendum**, incorporated by reference into this DPA.
- A copy of executed SCCs is available on request.

## 8. Audit

The Controller may, on **30 days notice** and no more than once per year (more often if reasonably required by an authority), audit Vesno's compliance with this DPA. Audits will be performed in working hours, will not unreasonably interfere with operations, and will be subject to confidentiality.

## 9. Liability

Liability under this DPA is subject to the limitation of liability provisions in the Terms of Service.

---

## Annex I — Description of processing

| Item | Description |
|------|-------------|
| Subject matter | Provision of the Vesno platform |
| Duration | For the term of the Terms of Service |
| Nature + purpose | Process automation audit, redesign, M&A diligence using AI |
| Type of personal data | See Section 4 |
| Categories of data subjects | See Section 4 |

## Annex II — Technical + organisational measures

| Measure | Implementation |
|---------|----------------|
| Encryption at rest | AES-256 (Supabase) |
| Encryption in transit | TLS 1.3 |
| Customer API keys | Encrypted with `pgcrypto` keyed on a per-deployment Vault secret separate from infrastructure credentials |
| Multi-tenant isolation | PostgreSQL Row-Level Security on every customer-data table |
| Per-party document visibility | Enforced at RLS + API layers for M&A deal documents |
| Authentication | Supabase Auth; JWT in HTTP-only cookies |
| Access control | Role-based (organisation member / admin) + per-deal access tiers (owner / collaborator / participant) |
| Audit logging | Customer-key lifecycle, member changes, finding reviews |
| Backups | Daily Supabase backups; 7-30 day retention depending on tier |
| Backup restore drill | Quarterly (see [`RUNBOOK_BACKUP_RESTORE.md`](../RUNBOOK_BACKUP_RESTORE.md)) |
| Vulnerability management | Sentry error monitoring; responsible disclosure (see [`SECURITY.md`](../SECURITY.md)) |
| Personnel | All staff bound by confidentiality. Background checks (TODO). |

## Annex III — Sub-processors

See [SUBPROCESSORS.md](./SUBPROCESSORS.md).

---

*This document is a starter template and does not constitute legal advice.*
