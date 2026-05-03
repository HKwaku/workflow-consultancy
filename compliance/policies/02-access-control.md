# Access Control Policy

| Field | Value |
|---|---|
| Policy owner | [POLICY OWNER] |
| Approved by | [APPROVER NAME, TITLE] |
| Approval date | [YYYY-MM-DD] |
| Last reviewed | [YYYY-MM-DD] |
| Review cadence | Annual |
| SOC 2 mapping | CC6.1, CC6.2, CC6.3, CC6.6 |

> **NOT LEGAL ADVICE.** Template — have your counsel and auditor review before adoption.

## 1. Purpose

To ensure that access to company systems and data is granted on a least-privilege basis, authenticated strongly, and reviewed regularly.

## 2. Scope

All systems containing company or customer data, including but not limited to:
- Production infrastructure (Vercel, Supabase, AWS/GCP)
- Source code repositories (GitHub)
- Observability platforms (Sentry)
- Communications (Google Workspace, Slack)
- LLM provider consoles (Anthropic, OpenAI, Voyage)
- Payment / billing systems

## 3. Account provisioning

3.1. Workforce accounts are provisioned only after the [Onboarding policy](10-onboarding-offboarding.md) is complete.
3.2. Account requests are submitted via [TICKETING SYSTEM] and approved by the requesting workforce member's manager.
3.3. Privileged access (production database, billing, root cloud accounts) requires additional approval from the Security Officer.

## 4. Authentication

4.1. **Multi-factor authentication (MFA) is mandatory** for every workforce account on every system in scope.
4.2. Acceptable second factors: hardware security key (preferred), TOTP authenticator app. SMS is permitted only when no other option exists and must be replaced within 90 days.
4.3. Passwords must be at least 14 characters and unique per system. Password managers (1Password / Bitwarden) are required.
4.4. Shared accounts are prohibited except for break-glass accounts (see §7).

## 5. Authorisation

5.1. Access is granted on a **least-privilege** basis. Default access is read-only where supported.
5.2. Production write access is limited to Engineering staff actively responsible for the relevant system.
5.3. Customer-data access by workforce members is logged via the application's audit_logs table.
5.4. Role definitions are maintained in the application RBAC tables (`org_members`, `deal_collaborators`).

## 6. Access reviews

6.1. The Engineering Manager performs a **quarterly access review** of every system in scope.
6.2. Each review checks: who has an account, what role they hold, whether the role is still appropriate, whether MFA is active.
6.3. Reviews are documented in [TICKETING SYSTEM] and signed off by the Engineering Manager and the Security Officer.
6.4. Findings are remediated within 14 days.

## 7. Break-glass accounts

7.1. Break-glass accounts may be maintained for true emergencies (e.g., locked out of cloud root account).
7.2. Credentials are stored in a sealed envelope in [SECURE LOCATION] or in a 2-of-N split secret.
7.3. Use of a break-glass account is logged and reviewed within 24 hours by the Security Officer.

## 8. Termination

Per the [Onboarding & Offboarding Policy](10-onboarding-offboarding.md), all access is revoked within **24 hours** of an employee's departure. For involuntary terminations, access is revoked **before** notification.

## 9. Customer access

9.1. Customer access to the platform is governed by the application's RLS policies and RBAC roles (see `lib/dealAuth.js`, `lib/orgAdmin.js`).
9.2. MFA enforcement for customer accounts is offered as an org-level setting (see `lib/mfaCheck.js`).
9.3. Customer access reviews are the customer's responsibility, supported by export tooling.

## 10. Enforcement

Violations of this policy are reported to the Security Officer and addressed under the [Information Security Policy §9](01-information-security.md).
