/**
 * AI auto-categorization for deal documents.
 *
 * Picks one of a fixed taxonomy used by the dataroom UI to group documents:
 *   Financial · Legal · HR · IP · Tech · Commercial · Operational · Other
 *
 * Called from the post-extract step of processDealDocument when at least one
 * text segment is available. We send the filename + a small text sample (the
 * first 1-2 segments) to Haiku — the cheapest model that's accurate enough
 * for an 8-way classification — and persist `category` on the row.
 *
 * Best-effort: any failure (missing API key, model error, parse error) just
 * leaves `category` null. The user can still set it manually in the UI.
 */

import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger.js';
import { FAST_MODEL_ID } from '../agents/models.js';

export const DOC_CATEGORIES = [
  'Financial',     // P&L, BS, cash flow, budgets, forecasts, mgmt accounts, audit reports
  'Legal',         // Contracts, NDAs, articles, board minutes, litigation, regulatory
  'HR',            // Employment contracts, org charts, comp & benefits, policies
  'IP',            // Patents, trademarks, copyright, IP register, licences
  'Tech',          // Architecture, code, security audits, infra, system docs
  'Commercial',    // Sales pipeline, customers, pricing, marketing, market sizing
  'Operational',   // Process docs, SOPs, supplier contracts, logistics, facilities
  'Other',         // Anything that doesn't fit
];

const SYSTEM = `You categorize a single business document into exactly one of these buckets:
${DOC_CATEGORIES.map((c) => `- ${c}`).join('\n')}

Respond with ONLY the category name, no punctuation, no explanation. If unsure, use "Other".`;

export async function categorizeDocument({ filename, sampleText, mimeType, apiKey }) {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  if (!filename && !sampleText) return null;

  const client = new Anthropic({ apiKey: key });
  const sample = String(sampleText || '').slice(0, 1500);

  const userMsg = [
    `Filename: ${filename || '(unknown)'}`,
    mimeType ? `MIME type: ${mimeType}` : null,
    sample ? `\nDocument sample:\n${sample}` : null,
  ].filter(Boolean).join('\n');

  try {
    const resp = await client.messages.create({
      model: FAST_MODEL_ID,
      max_tokens: 16,
      system: SYSTEM,
      messages: [{ role: 'user', content: userMsg }],
    });
    const raw = (resp?.content?.[0]?.text || '').trim();
    const match = DOC_CATEGORIES.find((c) => raw.toLowerCase().includes(c.toLowerCase()));
    // Tolerate variations like "Category: Financial" or trailing punctuation.
    return {
      category: match || 'Other',
      // Surface usage so callers can record cost. Cache reads count too —
      // anything that bills against the API key needs to be metered.
      usage: {
        inputTokens: Number(resp?.usage?.input_tokens || 0)
                   + Number(resp?.usage?.cache_read_input_tokens || 0)
                   + Number(resp?.usage?.cache_creation_input_tokens || 0),
        outputTokens: Number(resp?.usage?.output_tokens || 0),
      },
    };
  } catch (e) {
    logger.warn('categorizeDocument failed', { error: e.message, filename });
    return null;
  }
}
