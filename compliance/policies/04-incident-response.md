# Incident Response Policy

| Field | Value |
|---|---|
| Policy owner | [POLICY OWNER — typically Security Officer] |
| Approved by | [APPROVER NAME, TITLE] |
| Approval date | [YYYY-MM-DD] |
| Last reviewed | [YYYY-MM-DD] |
| Review cadence | Annual + after every Sev1/Sev2 incident |
| SOC 2 mapping | CC7.3, CC7.4, CC7.5 |

> **NOT LEGAL ADVICE.** Template — have your counsel and auditor review before adoption.

## 1. Purpose

To detect, contain, eradicate, and recover from security incidents quickly while preserving evidence and meeting regulatory notification obligations.

## 2. Definitions

- **Event** — Any observable occurrence in a system (login, request, error).
- **Incident** — An event that compromises (or threatens to compromise) confidentiality, integrity, or availability of company or customer data.
- **Breach** — An incident in which personal data is accessed, disclosed, or destroyed without authorisation.

## 3. Severity

| Severity | Definition | Response time |
|---|---|---|
| **Sev1** | Active customer-data exposure or full production outage | 15 min ack, 24/7 response |
| **Sev2** | Suspected exposure, partial outage, RLS bypass found in code | 1 hr ack, business-hours response |
| **Sev3** | Single-customer issue, security finding without active exploitation | 1 business day ack |
| **Sev4** | Informational: phishing email observed, vulnerability disclosed via responsible-disclosure | 5 business days |

## 4. Response phases

### 4.1 Detect
Sources include: Sentry alerts, customer reports, automated scans, external researchers (security@[COMPANY DOMAIN]).

### 4.2 Triage
The first responder assigns severity and pages the Incident Commander (rotation maintained by Engineering).

### 4.3 Contain
- Revoke the suspected attacker's credentials.
- Disable the compromised feature flag or endpoint.
- For data exposure: remove the leaked artefact and confirm cache eviction.
- Document every action taken with timestamps in the incident channel.

### 4.4 Eradicate
- Patch the vulnerability.
- Rotate any credentials that may have been exposed.
- Verify that the attack vector is closed.

### 4.5 Recover
- Restore service.
- Verify customer data integrity (e.g., compare against backups; run row-count checks).
- Communicate restoration to affected customers.

### 4.6 Lessons learned
- Within 5 business days of resolution, the Incident Commander writes a postmortem covering: timeline, root cause, contributing factors, impact, remediation, follow-up actions.
- Postmortems are blameless. Action items are assigned with due dates and tracked to closure.

## 5. Evidence preservation

5.1. Do not delete logs or affected data until the Security Officer authorises.
5.2. Preserve Sentry events, application logs, audit_logs rows, and any forensic artefacts.
5.3. For potential law-enforcement involvement, contact counsel before further investigation.

## 6. Communications

6.1. **Internal:** dedicated #inc-[date] Slack channel; status updates every 30 min for Sev1, every 2 hrs for Sev2.
6.2. **Customers:** affected customers notified per contractual SLA (typically within 24-72 hrs for breaches).
6.3. **Regulators:** GDPR-covered breaches notified to the relevant DPA within **72 hours** of becoming aware. Other jurisdictions per applicable law.
6.4. **Public:** Status-page updates for any customer-impacting incident. See `RUNBOOK_STATUS_PAGE.md`.

## 7. Roles

| Role | Responsibility |
|---|---|
| **Incident Commander (IC)** | Drives the response; makes all final decisions during incident |
| **Communications Lead** | Owns customer/regulator/internal comms |
| **Subject-Matter Expert(s)** | Technical investigation under the IC |
| **Scribe** | Maintains the timeline |
| **Security Officer** | Final escalation; postmortem review |

## 8. Annual exercise

At least one tabletop exercise is conducted annually. Scenarios should rotate between: (a) customer-data exfiltration, (b) ransomware on workforce devices, (c) supplier breach, (d) insider threat. Outcomes are documented and feed into policy revisions.

## 9. Escalation contacts

- Security Officer: [NAME, EMAIL, PHONE]
- CEO: [NAME, EMAIL, PHONE]
- External counsel: [FIRM, CONTACT]
- Cyber-insurance broker: [FIRM, CONTACT, POLICY NUMBER]

## 10. Customer-reporting channel

Security issues are reported to **security@[COMPANY DOMAIN]**. The Security Officer monitors this inbox and acknowledges within one business day.
