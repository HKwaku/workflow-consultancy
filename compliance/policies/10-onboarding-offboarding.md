# Onboarding & Offboarding Policy

| Field | Value |
|---|---|
| Policy owner | [POLICY OWNER — typically People Ops] |
| Approved by | [APPROVER NAME, TITLE] |
| Approval date | [YYYY-MM-DD] |
| Last reviewed | [YYYY-MM-DD] |
| Review cadence | Annual |
| SOC 2 mapping | CC1.4, CC6.2, CC6.3 |

> **NOT LEGAL ADVICE.** Template — have your counsel and auditor review before adoption.

## 1. Purpose

To ensure that workforce members are vetted before being granted access, equipped to work securely, and that all access is revoked promptly upon departure.

## 2. Onboarding

### 2.1 Pre-start

- **Background check** completed via [VENDOR — e.g., Checkr]. Required for all roles with access to customer data. Adverse findings are reviewed by [CEO/CISO + counsel] before extending access.
- Signed offer letter and employment / contractor agreement, including confidentiality obligations.
- Identity verification (right-to-work documentation, government-issued ID).

### 2.2 Day 1

- Workforce member receives:
  - [COMPANY] laptop (or BYOD attestation if applicable) configured per [Acceptable Use Policy](08-acceptable-use.md)
  - 1Password / Bitwarden license
  - Google Workspace / Slack accounts
  - Hardware security key (or TOTP enrolment) for MFA
- Workforce member signs:
  - Acknowledgement of policies in `compliance/policies/`
  - NDA (if not already signed at offer)
- People Ops creates the onboarding ticket; Engineering Manager creates technical-onboarding ticket.

### 2.3 First 30 days

- Security awareness training completed.
- Role-specific access provisioned per the [Access Control Policy](02-access-control.md), least privilege.
- Pairing session with manager covering: security expectations, on-call rotation (if applicable), incident-response process.

### 2.4 First 90 days

- Probation review.
- Confirmation that all required policies have been read and acknowledged.

## 3. Role changes

When a workforce member changes role:
- Their manager submits an access-change request.
- Old access not relevant to the new role is revoked within 7 days.
- New access is provisioned per least privilege.
- The next quarterly access review verifies the change.

## 4. Offboarding

### 4.1 Voluntary departure

- People Ops notifies Engineering, Security, IT immediately upon resignation.
- Departure date and access-revocation timing agreed.
- On the last working day:
  - All workforce credentials revoked within **24 hours** of end-of-business
  - SSO accounts disabled
  - 2FA tokens deactivated
  - Session tokens invalidated where supported
  - Hardware returned (laptop, security keys); receipt documented
  - 1Password access removed; any shared vaults audited for ownership transfer
  - Forwarding email rule set per company policy (typically 30 days to manager)

### 4.2 Involuntary departure

- Access revocation occurs **before** the workforce member is notified.
- Hardware is collected at the termination meeting where possible.
- Security Officer reviews `audit_logs` for the last 30 days for unusual activity.

### 4.3 Contractor end-of-engagement

Same as voluntary departure unless contract specifies otherwise.

## 5. Confidentiality after departure

5.1. Confidentiality obligations survive employment per the workforce member's agreement.
5.2. Departing workforce members are reminded of their continuing obligations in the exit interview.

## 6. Documentation

Each onboarding and offboarding event is documented in [HR SYSTEM] with the access-revocation checklist signed off by IT/Engineering and People Ops. Auditors will sample these records.

## 7. Annual control test

At least once per year, the Security Officer audits a sample of recent departures by attempting to use revoked credentials (against systems where this can be safely tested). Any failure is treated as a Sev2 incident.
