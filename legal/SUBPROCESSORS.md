# Sub-processors

> **Last updated:** 2026-04-26 — please verify before relying on this for compliance use.
>
> This is a living document. We will give 30 days notice before adding a new sub-processor — see [DPA Section 5](./DPA.md#5-sub-processors).

These are the third parties that process customer data on our behalf to provide the Vesno platform. Each is contractually bound to confidentiality, security, and GDPR obligations consistent with our [DPA](./DPA.md).

| Sub-processor | Purpose | Data processed | Region | Transfer mechanism |
|---------------|---------|----------------|--------|-------------------|
| **Supabase** | Authentication, database, storage, Vault | Account data + all customer data | TODO (your selected region) | SCCs / UK IDTA |
| **Vercel** | Hosting + edge network | All request/response data in transit; logs (without bodies) | US (edge global) | SCCs / UK IDTA |
| **Anthropic** | Claude LLM API for chat, analysis, recommendations, redesign | Prompts + responses (chat content, process descriptions, deal document chunks). API traffic is not used for training. | US | SCCs / UK IDTA |
| **Voyage AI** | Document chunk embeddings | Document chunk text. Embeddings only; not used for training. | US | SCCs / UK IDTA |
| **Inngest** | Asynchronous worker pipeline (document parsing + chunking + embedding) | Event payloads referencing document IDs (not the document bytes themselves) | US | SCCs / UK IDTA |
| **Sentry** | Error monitoring | Error stack traces + request metadata. We scrub bodies. | US (or self-hosted EU on request) | SCCs / UK IDTA |
| **Upstash** | Distributed rate limiting | IP-derived rate-limit keys (no PII) | US / EU (multi-region) | SCCs |
| **n8n** | Outbound transactional email + webhooks | Email recipient + report URL | TODO (self-hosted region) | N/A if self-hosted |

## Optional / future

| Sub-processor | Purpose | Status |
|---------------|---------|--------|
| **OpenAI** | Alternate LLM provider | Listed in catalogue but not yet wired into the runtime. Will require notice before activation. |
| **Stripe** | Payment processing | Not yet integrated. Will be added before paid plans launch. |

## How we vet sub-processors

Before engaging any sub-processor that processes Personal Data, we verify:

1. They publish a Data Processing Agreement (or equivalent) consistent with GDPR Art. 28.
2. They support Standard Contractual Clauses for international transfers where needed.
3. They have a documented security posture (SOC 2 / ISO 27001 or equivalent) — exceptions noted.
4. They offer breach notification within a timeframe compatible with our 72-hour commitment.

## Notification of changes

When we add a new sub-processor, we will:
- Update this document
- Email the security/compliance contact for each customer organisation 30 days before the change takes effect
- Surface a banner in the admin UI for the first 14 days (TODO when banner system exists)

You may object to a new sub-processor on reasonable grounds. If we cannot accommodate, you may terminate the affected services per [DPA Section 5](./DPA.md#5-sub-processors).

## Removed sub-processors

(None yet.)
