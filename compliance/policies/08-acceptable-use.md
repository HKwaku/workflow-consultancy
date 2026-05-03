# Acceptable Use Policy

| Field | Value |
|---|---|
| Policy owner | [POLICY OWNER — typically People Ops] |
| Approved by | [APPROVER NAME, TITLE] |
| Approval date | [YYYY-MM-DD] |
| Last reviewed | [YYYY-MM-DD] |
| Review cadence | Annual |
| SOC 2 mapping | CC1.1, CC6.8 |

> **NOT LEGAL ADVICE.** Template — have your counsel and auditor review before adoption.

## 1. Purpose

To define how workforce members may use [COMPANY NAME] systems and data.

## 2. Scope

All workforce members. All systems used for company work, whether company-owned or personal devices used to access company resources (BYOD).

## 3. General principles

3.1. Use systems for legitimate business purposes.
3.2. Treat customer data as if it were your own most sensitive data.
3.3. Follow the [Information Security Policy](01-information-security.md) and supporting policies.
3.4. Report anything suspicious to security@[COMPANY DOMAIN].

## 4. Workstation requirements

4.1. Full disk encryption enabled.
4.2. Screen lock after 5 minutes of inactivity.
4.3. Operating system and browser auto-updates enabled.
4.4. Endpoint security software (per [COMPANY] standard) installed and running.
4.5. Personal accounts and company accounts should not share credentials.

## 5. Credentials

5.1. Use a password manager (1Password / Bitwarden) for all company credentials.
5.2. Never share credentials. Use system-native sharing (e.g., 1Password vault sharing) when access must be delegated temporarily.
5.3. Never commit credentials to source code. CI scans (e.g., GitHub secret scanning) help but do not absolve the author.

## 6. Customer data

6.1. Access customer data only when needed for a legitimate task (support, debugging, audit).
6.2. Document such access (ticket reference, customer consent for support cases).
6.3. Never copy customer data to personal devices, personal cloud storage, or external SaaS not on the sanctioned vendor list.
6.4. Do not paste customer data into public LLMs or other public tools. Use the sanctioned LLM tooling within this product, which is governed by vendor DPAs.

## 7. AI tools

7.1. Use of public AI tools (ChatGPT, Claude.ai, Gemini, etc.) for company work is permitted **only with non-confidential inputs**. Treat the chat box as if you were posting publicly.
7.2. Coding assistants (Claude Code, GitHub Copilot, Cursor, etc.) are permitted; review output for correctness and never accept changes that introduce credentials, weaken auth, or bypass RLS.
7.3. For confidential or restricted data, use only tooling within this product or otherwise covered by an approved DPA.

## 8. Email and communication

8.1. Use company email and Slack for company communications.
8.2. Be alert to phishing. When in doubt, forward to security@[COMPANY DOMAIN].
8.3. Do not auto-forward company email to personal accounts.

## 9. Software installation

9.1. Workforce members may install productivity tools needed for their role.
9.2. Tools that handle customer or restricted data must come from the sanctioned vendor list.
9.3. Browser extensions: install only from official stores, prefer extensions from reputable publishers, and review their permissions.

## 10. Travel

10.1. Use a VPN on untrusted networks.
10.2. Take only the data you need for the trip; ideally none.
10.3. Be aware of border-crossing requirements (some jurisdictions allow inspection of devices).

## 11. Prohibited

The following are prohibited on company systems or with company data:
- Cryptocurrency mining
- Illegal content
- Adult content unrelated to a documented business purpose
- Circumventing security controls (disabling EDR, MFA bypass, RLS escape)
- Reverse-engineering or scanning third parties without authorisation
- Unauthorised data exfiltration of any kind

## 12. Reporting

Report violations and suspected violations to security@[COMPANY DOMAIN] or your manager. Reports are treated confidentially. Retaliation against good-faith reporters is prohibited.

## 13. Acknowledgement

Workforce members acknowledge this policy at onboarding and at each annual update. Acknowledgement is recorded by People Ops.
