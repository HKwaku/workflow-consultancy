# Terms of Service — DRAFT

> ⚠️ **NOT LEGAL ADVICE — REVIEW REQUIRED.** This is a starter draft. A qualified lawyer must review and customise before publication.

**Effective date:** TODO
**Last updated:** TODO

These Terms of Service ("Terms") govern your use of the Vesno platform ("Service"), operated by **TODO Company Name** ("Vesno", "we", "us"). By creating an account or using the Service, you agree to these Terms.

If you are using the Service on behalf of an organisation, you represent that you have authority to bind that organisation to these Terms.

## 1. The Service

Vesno is a software platform for operational process audit, redesign, and M&A diligence. It uses third-party AI models (Anthropic Claude, optionally OpenAI) and embedding services (Voyage AI) to generate findings, recommendations, and structured reports based on user-supplied data.

You acknowledge that AI-generated output:
- May contain inaccuracies or hallucinations
- Should not be relied upon as professional advice (legal, financial, medical, etc.)
- Requires human review before being acted upon

Findings produced by the Service include source citations where possible, but you are responsible for verifying conclusions before use.

## 2. Accounts

You must provide accurate registration information and keep it current. You are responsible for all activity under your account. Notify us at `security@vesno.io` of any suspected unauthorised access.

Organisation administrators may invite, manage, and remove members of their organisation. They may also configure organisation-level settings, including AI model allowlists and customer-managed API keys.

## 3. Acceptable use

You may not use the Service to:
- Violate any law or third-party right
- Infringe intellectual property
- Upload or process content you do not have the right to use
- Probe, scan, or test the vulnerability of the Service without prior written authorisation (see [SECURITY.md](../SECURITY.md))
- Interfere with or disrupt the Service for other users
- Use the Service to develop a competing product
- Process special-category personal data (health, biometric, etc.) without first executing a DPA with us that specifically addresses such data

We may suspend or terminate accounts that violate these rules.

## 4. Customer data + intellectual property

**Your data is yours.** You retain all rights to data you upload (process descriptions, deal documents, etc.). You grant us a limited licence to process that data solely to provide the Service.

**Output is yours.** Findings, reports, and exports generated for your account are licensed to you for use within your organisation. We may aggregate anonymised, non-identifying usage statistics for service improvement.

**Our IP is ours.** The Service software, design, prompts, model configurations, and documentation are our intellectual property. You may not reverse-engineer, scrape, or republish them.

## 5. Customer-managed API keys (BYO)

If you set your own AI provider API key (e.g. Anthropic), the corresponding LLM calls bill to your provider account, not ours. We do not act as an intermediary for those charges.

We store your API keys encrypted at rest using a per-deployment encryption key. We will not access, share, or use your keys except to make calls on your behalf as part of the Service. See [Privacy Policy](./PRIVACY_POLICY.md) for details.

You are responsible for:
- Ensuring your API key complies with the provider's terms
- Monitoring spend against your provider account
- Rotating the key per the provider's recommended cadence

## 6. Fees + billing

(TODO when payment integration ships. Until then, the Service is provided gratis to invited users at our discretion.)

## 7. Confidentiality

Customer data uploaded to the Service may include material non-public information ("MNPI") in the context of M&A diligence. We treat all customer data as confidential.

We will not disclose customer data to third parties except:
- To the sub-processors listed in [SUBPROCESSORS.md](./SUBPROCESSORS.md), strictly to provide the Service
- As required by law, on receipt of a valid legal process
- With your express written consent

We will notify you within 72 hours of any actual or suspected unauthorised access to your data.

## 8. Term + termination

These Terms remain in effect until terminated. Either party may terminate for convenience on **30 days written notice**. Either party may terminate immediately for material breach not cured within 30 days of written notice.

On termination:
- We will retain your data for 30 days to allow export. Use the [Settings popover](../DIAGNOSTICS_CAPABILITIES.md#gdpr) (gear icon on the chat rail in `/workspace/map`) to download your data.
- After 30 days, your data will be anonymised or deleted in line with our [Privacy Policy](./PRIVACY_POLICY.md).
- Outstanding fees remain payable.

## 9. Warranty + disclaimer

The Service is provided **"as is"** and **"as available"**. To the maximum extent permitted by law, we disclaim all implied warranties, including merchantability, fitness for a particular purpose, and non-infringement.

We do not warrant that the Service will be uninterrupted, error-free, or that AI-generated output will be accurate.

## 10. Limitation of liability

To the maximum extent permitted by law, neither party will be liable for indirect, incidental, consequential, special, or punitive damages.

Our aggregate liability under these Terms is capped at **the greater of (a) the fees you paid in the 12 months preceding the claim, or (b) USD 100**.

This cap does not apply to (i) breaches of confidentiality, (ii) indemnification obligations, (iii) gross negligence or wilful misconduct, or (iv) liability that cannot be limited by law.

## 11. Indemnification

Each party will defend the other against third-party claims arising from the indemnifying party's IP infringement, subject to standard procedures (prompt notice, defence control, reasonable cooperation).

## 12. Changes to the Terms

We may update these Terms with **30 days notice** by email or in-product notification. Continued use after the effective date constitutes acceptance.

## 13. Governing law

These Terms are governed by the laws of **England and Wales** (TODO change if appropriate). Disputes will be resolved in the courts of England and Wales.

## 14. Contact

Legal: `legal@vesno.io`
Security: `security@vesno.io`
Support: `support@vesno.io`

---

*This document is a starter template and does not constitute legal advice.*
