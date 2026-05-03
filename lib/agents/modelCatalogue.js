/**
 * AI model catalogue — Anthropic + OpenAI.
 *
 * Single source of truth for "which models can org admins offer to their
 * users?" Used by:
 *   - The org-admin "Allowed models" UI (list of toggleable models, grouped by vendor).
 *   - The user's chat model picker (filtered to org's allowlist; unsupported hidden).
 *   - lib/orgModels.js validation (refuses non-catalogue ids).
 *
 * Adding a model = appending one row here. Mark deprecated when the vendor
 * announces sunset; mark unsupported when we list a model in the UI but the
 * runtime doesn't actually call that vendor yet.
 *
 * IMPORTANT: `unsupported: true` means our chat surface won't route to this
 * vendor (no client wiring). Today this applies to ALL OpenAI entries — the
 * chat agent only knows @anthropic-ai/sdk. Admins can toggle these in the
 * allowlist UI to signal future intent, but the user-facing picker hides
 * them. Wiring an OpenAI client into runStreamingLoop is a separate piece
 * of work; remove unsupported on each entry as that ships.
 *
 * Tier hint (Anthropic-style, used by the picker badge + phase resolver):
 *   'fast' = quick + cheap (Haiku, GPT-5 Nano/Mini, GPT-4.1 Nano)
 *   'chat' = balanced (Sonnet, GPT-5, GPT-5.4, GPT-5.4-mini, GPT-4.1)
 *   'deep' = deepest reasoning (Opus, GPT-5.5, GPT-5.4-pro, o-series)
 *
 * Sourcing notes (April 2026):
 *   - Anthropic: docs.claude.com → models/overview
 *     https://platform.claude.com/docs/en/about-claude/models/overview
 *   - OpenAI: developers.openai.com/api/docs/pricing + openai.com/api/pricing
 *     Context windows from OpenAI pricing page are partial — values flagged
 *     with TODO are best-estimates from secondary sources, replace once the
 *     official docs publish full specs.
 */

export const KNOWN_MODELS = [
  /* ──────────────────────────────────────────────────────────────────
   * ANTHROPIC — current generation (April 2026)
   * ────────────────────────────────────────────────────────────────── */
  {
    id: 'claude-opus-4-7',
    vendor: 'anthropic',
    label: 'Claude Opus 4.7',
    tier: 'deep',
    contextWindow: 1_000_000,
    inputCostPer1M:  5,
    outputCostPer1M: 25,
    deprecated: false,
    unsupported: false,
    blurb: 'Anthropic\'s most capable model. Best for complex reasoning, multi-step analysis, agentic coding.',
  },
  {
    id: 'claude-sonnet-4-6',
    vendor: 'anthropic',
    label: 'Claude Sonnet 4.6',
    tier: 'chat',
    contextWindow: 1_000_000,
    inputCostPer1M:  3,
    outputCostPer1M: 15,
    deprecated: false,
    unsupported: false,
    blurb: 'Best balance of speed and intelligence. Default for chat and deal analysis.',
  },
  {
    id: 'claude-haiku-4-5-20251001',
    vendor: 'anthropic',
    label: 'Claude Haiku 4.5',
    tier: 'fast',
    contextWindow: 200_000,
    inputCostPer1M:  1,
    outputCostPer1M: 5,
    deprecated: false,
    unsupported: false,
    blurb: 'Fastest with near-frontier intelligence. Best for extractions, summaries, simple Q&A.',
  },

  /* ──────────────────────────────────────────────────────────────────
   * ANTHROPIC — legacy still-callable (consider migrating)
   * ────────────────────────────────────────────────────────────────── */
  {
    id: 'claude-opus-4-6',
    vendor: 'anthropic',
    label: 'Claude Opus 4.6',
    tier: 'deep',
    contextWindow: 1_000_000,
    inputCostPer1M:  5,
    outputCostPer1M: 25,
    deprecated: true,
    unsupported: false,
    blurb: 'Previous Opus generation. Migrate to Opus 4.7 for stronger agentic coding.',
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    vendor: 'anthropic',
    label: 'Claude Sonnet 4.5',
    tier: 'chat',
    contextWindow: 200_000,
    inputCostPer1M:  3,
    outputCostPer1M: 15,
    deprecated: true,
    unsupported: false,
    blurb: 'Previous Sonnet generation. Migrate to Sonnet 4.6 for improved performance.',
  },
  {
    id: 'claude-opus-4-5-20251101',
    vendor: 'anthropic',
    label: 'Claude Opus 4.5',
    tier: 'deep',
    contextWindow: 200_000,
    inputCostPer1M:  5,
    outputCostPer1M: 25,
    deprecated: true,
    unsupported: false,
    blurb: 'Earlier Opus 4.5. Migrate to Opus 4.7.',
  },
  {
    id: 'claude-opus-4-1-20250805',
    vendor: 'anthropic',
    label: 'Claude Opus 4.1',
    tier: 'deep',
    contextWindow: 200_000,
    inputCostPer1M:  15,
    outputCostPer1M: 75,
    deprecated: true,
    unsupported: false,
    blurb: 'Older Opus generation, premium pricing. Migrate to Opus 4.7 for the same quality at 1/3 the cost.',
  },

  /* ──────────────────────────────────────────────────────────────────
   * OPENAI — GPT-5.5 family (latest flagship)
   * NOTE: All OpenAI models are currently `unsupported: true` — the chat
   * agent only knows @anthropic-ai/sdk. Admins can toggle them in the
   * allowlist UI as a roadmap signal, but the user-facing picker hides
   * unsupported models so users never get a runtime error from picking one.
   * Remove unsupported on each entry as the OpenAI client wiring ships.
   * ────────────────────────────────────────────────────────────────── */
  {
    id: 'gpt-5.5',
    vendor: 'openai',
    label: 'GPT-5.5',
    tier: 'deep',
    contextWindow: 400_000,                  // TODO verify against official docs
    inputCostPer1M:  5,
    outputCostPer1M: 30,
    deprecated: false,
    unsupported: true,
    blurb: 'OpenAI\'s flagship. Highest-quality reasoning, multimodal, long context.',
  },
  {
    id: 'gpt-5.5-pro',
    vendor: 'openai',
    label: 'GPT-5.5 Pro',
    tier: 'deep',
    contextWindow: 400_000,                  // TODO verify
    inputCostPer1M:  30,
    outputCostPer1M: 180,
    deprecated: false,
    unsupported: true,
    blurb: 'Pro-tier reasoning. Deeper deliberation; reserve for hard problems.',
  },

  /* GPT-5.4 family */
  {
    id: 'gpt-5.4',
    vendor: 'openai',
    label: 'GPT-5.4',
    tier: 'chat',
    contextWindow: 270_000,
    inputCostPer1M:  2.5,
    outputCostPer1M: 15,
    deprecated: false,
    unsupported: true,
    blurb: 'Unified model from the GPT-5.4 generation. Strong default for general chat.',
  },
  {
    id: 'gpt-5.4-mini',
    vendor: 'openai',
    label: 'GPT-5.4 Mini',
    tier: 'chat',
    contextWindow: 270_000,                  // TODO verify
    inputCostPer1M:  0.75,
    outputCostPer1M: 4.5,
    deprecated: false,
    unsupported: true,
    blurb: 'Mid-tier GPT-5.4. Good cost/quality balance for routine tasks.',
  },
  {
    id: 'gpt-5.4-nano',
    vendor: 'openai',
    label: 'GPT-5.4 Nano',
    tier: 'fast',
    contextWindow: 270_000,                  // TODO verify
    inputCostPer1M:  0.2,
    outputCostPer1M: 1.25,
    deprecated: false,
    unsupported: true,
    blurb: 'Cheapest GPT-5.4 variant. Fast extractions and classification.',
  },
  {
    id: 'gpt-5.4-pro',
    vendor: 'openai',
    label: 'GPT-5.4 Pro',
    tier: 'deep',
    contextWindow: 270_000,                  // TODO verify
    inputCostPer1M:  30,
    outputCostPer1M: 180,
    deprecated: false,
    unsupported: true,
    blurb: 'Pro-tier GPT-5.4 with extended deliberation. Premium pricing.',
  },

  /* GPT-5.3 specialised */
  {
    id: 'gpt-5.3-chat-latest',
    vendor: 'openai',
    label: 'GPT-5.3 Chat',
    tier: 'chat',
    contextWindow: 200_000,                  // TODO verify
    inputCostPer1M:  1.75,
    outputCostPer1M: 14,
    deprecated: false,
    unsupported: true,
    blurb: 'GPT-5.3 chat variant. Conversational tone optimised.',
  },
  {
    id: 'gpt-5.3-codex',
    vendor: 'openai',
    label: 'GPT-5.3 Codex',
    tier: 'chat',
    contextWindow: 200_000,                  // TODO verify
    inputCostPer1M:  1.75,
    outputCostPer1M: 14,
    deprecated: false,
    unsupported: true,
    blurb: 'GPT-5.3 tuned for code. Specialised for engineering tasks.',
  },

  /* Reasoning */
  {
    id: 'o4-mini-2025-04-16',
    vendor: 'openai',
    label: 'o4-mini',
    tier: 'deep',
    contextWindow: 200_000,                  // TODO verify
    inputCostPer1M:  4,
    outputCostPer1M: 16,
    deprecated: false,
    unsupported: true,
    blurb: 'Cost-effective reasoning model. Good for step-by-step problem solving.',
  },

  // Add new models here. Mark older ones deprecated rather than removing —
  // orgs may still have them in their allowlist.
];

/** Default fixed allowlist for orgs WITHOUT a customer key (platform-key path). */
/**
 * Default platform allowlist offered to a signed-in user whose org has no
 * explicit `allowed_models[]` configured. We expose the three current-gen
 * Anthropic models so the chat picker has a real choice (fast / chat / deep)
 * — picking just one collapses the picker to a static pill, which the user
 * couldn't change. Cost ceilings still apply via the org token budget.
 */
export const PLATFORM_ALLOWED_MODEL_IDS = [
  'claude-haiku-4-5-20251001', // fast
  'claude-sonnet-4-6',         // chat (default)
  'claude-opus-4-7',           // deep
];

/** Default model when no allowlist or default is configured. */
export const SAFE_FALLBACK_MODEL_ID = 'claude-sonnet-4-6';

/* ── Helpers ─────────────────────────────────────────────────── */

export function getModelById(id) {
  if (!id) return null;
  return KNOWN_MODELS.find((m) => m.id === id) || null;
}

export function isKnownModel(id) {
  return !!getModelById(id);
}

/** Filter ids to only those in the catalogue (regardless of deprecated/unsupported). */
export function filterKnownModelIds(ids) {
  if (!Array.isArray(ids)) return [];
  return ids.filter(isKnownModel);
}

/**
 * Public catalogue for the admin UI. Includes vendor + unsupported flags so
 * the UI can group + label correctly.
 */
export function publicCatalogue() {
  return KNOWN_MODELS.map((m) => ({
    id: m.id,
    vendor: m.vendor,
    label: m.label,
    tier: m.tier,
    contextWindow: m.contextWindow,
    inputCostPer1M: m.inputCostPer1M,
    outputCostPer1M: m.outputCostPer1M,
    deprecated: m.deprecated,
    unsupported: m.unsupported,
    blurb: m.blurb,
  }));
}

/**
 * The set of models a USER is allowed to select in the chat picker.
 * Drops `unsupported` (no runtime path) regardless of allowlist membership —
 * an admin can put GPT-5.5 in their allowlist as a roadmap signal, but
 * users will never actually see it until the OpenAI client ships.
 */
export function userPickableIds(allowlist) {
  const ids = Array.isArray(allowlist) ? allowlist : [];
  return ids.filter((id) => {
    const m = getModelById(id);
    return m && !m.unsupported;
  });
}

/**
 * Suggested model for a given chat phase. Returns the best id from `allowed`
 * for the phase — closest tier match, ties broken by ordering in the catalogue
 * (which is curated newest-first within each vendor).
 *
 * Phase mapping:
 *   intake       → fast tier (path/template selection, simple Q&A)
 *   map          → chat tier (step CRUD, tool-heavy)
 *   details      → chat tier
 *   cost         → chat tier
 *   complete     → chat tier
 *   editingRedesign override → deep tier (reasoning-heavy)
 *   processing attachment override → fast tier (one-shot extraction)
 *
 * Returns null if `allowed` is empty.
 */
export function suggestedModelIdForPhase({ allowed, phase, editingRedesign, hasAttachments }) {
  if (!Array.isArray(allowed) || allowed.length === 0) return null;
  const tier = pickTierForContext({ phase, editingRedesign, hasAttachments });

  // Prefer same-tier models in catalogue order
  for (const id of allowed) {
    const m = getModelById(id);
    if (m && m.tier === tier && !m.deprecated) return id;
  }
  // Fallback: any same-tier (including deprecated)
  for (const id of allowed) {
    const m = getModelById(id);
    if (m && m.tier === tier) return id;
  }
  // Fallback: first non-deprecated
  for (const id of allowed) {
    const m = getModelById(id);
    if (m && !m.deprecated) return id;
  }
  return allowed[0];
}

function pickTierForContext({ phase, editingRedesign, hasAttachments }) {
  if (editingRedesign) return 'deep';
  if (hasAttachments)  return 'fast';
  if (phase === 'intake') return 'fast';
  return 'chat';
}
