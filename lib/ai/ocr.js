/**
 * Optional OCR fallback for image-only PDFs and image uploads.
 *
 * Diligence dumps often include scanned signed contracts, photographs of
 * documents, or screenshots — files where the embedded text layer is empty
 * (`pdf_no_text_layer`) or absent entirely (image MIME types). Without OCR,
 * those files are stored-only: visible in the data room but invisible to
 * search and citations. With OCR, we extract page-level text, chunk it like
 * any other PDF, and the document becomes first-class.
 *
 * Provider: Mistral Document OCR (https://docs.mistral.ai/capabilities/document/).
 * Picked because (a) it accepts PDFs natively (no rasterisation step on our
 * side), (b) returns per-page text with high accuracy on financial / legal
 * docs, (c) bills per-page so cost is predictable on large dumps.
 *
 * Key resolution: `resolveActiveKey({ orgId, vendor: 'mistral' })`. This
 * means org admins set the OCR key in the BYO API-keys panel of org admin —
 * same plumbing as Anthropic / Voyage / OpenAI — and the platform env var
 * (`MISTRAL_API_KEY`) is just the fallback. No org-specific code path; the
 * customerKey helper handles the precedence.
 */

import { logger } from '../logger.js';
import { resolveActiveKey } from '../customerKey.js';

const MISTRAL_OCR_URL = 'https://api.mistral.ai/v1/ocr';
const MISTRAL_OCR_MODEL = 'mistral-ocr-latest';

/**
 * Synchronous "is OCR likely available" check. The worker uses this before
 * downloading the bytes for an OCR pass. Without an orgId we can only check
 * the platform fallback; with one, the customer key wins. The actual call
 * site re-resolves at request time so a fresh customer key is picked up
 * even if this returned false a moment earlier.
 */
export async function ocrConfigured({ orgId } = {}) {
  const { key } = await resolveActiveKey({ orgId, vendor: 'mistral' });
  return Boolean(key);
}

/**
 * OCR a PDF or image buffer. Returns segments shaped like extractText.js so
 * the worker can pipe them straight into the chunker.
 *
 * @param {Buffer} buf
 * @param {{ mimeType?: string, filename?: string, orgId?: string }} meta
 * @returns {Promise<{ segments: Array, pageCount: number|null, tokens: number, source: 'mistral_ocr' }|null>}
 */
export async function ocrExtractFromBuffer(buf, { mimeType, filename, orgId } = {}) {
  if (!buf || !buf.length) return null;
  const { key } = await resolveActiveKey({ orgId, vendor: 'mistral' });
  if (!key) return null;

  const mt = (mimeType || 'application/pdf').toLowerCase();
  const dataUrl = `data:${mt};base64,${buf.toString('base64')}`;

  // Mistral's OCR endpoint accepts either a hosted URL or a base64 data URL
  // via the `document_url` field. Documented under the Document AI section.
  const body = {
    model: MISTRAL_OCR_MODEL,
    document: { type: 'document_url', document_url: dataUrl },
    include_image_base64: false,
  };

  let resp;
  try {
    resp = await fetch(MISTRAL_OCR_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    logger.warn('OCR request failed', { error: e.message, filename });
    return null;
  }

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    logger.warn('OCR non-2xx', { status: resp.status, body: txt.slice(0, 200), filename });
    return null;
  }

  let data;
  try {
    data = await resp.json();
  } catch (e) {
    logger.warn('OCR returned non-JSON', { error: e.message, filename });
    return null;
  }

  // Response shape: { pages: [{ index, markdown, ... }], usage_info: { pages_processed } }
  // Be defensive: Mistral has been known to evolve the wrapper shape.
  // Try the documented `data.pages`, then `data.document.pages`, then a
  // last-ditch `data.data` array. If none yield page objects, log + return
  // null so the worker falls through to `stored` rather than indexing
  // empty content.
  const pages = Array.isArray(data?.pages) ? data.pages
              : Array.isArray(data?.document?.pages) ? data.document.pages
              : Array.isArray(data?.data) ? data.data
              : [];
  if (pages.length === 0) {
    logger.warn('OCR returned no recognisable pages array', {
      keys: data && typeof data === 'object' ? Object.keys(data).slice(0, 10) : null,
      filename,
    });
  }
  const segments = pages
    .map((p, i) => ({
      content: String(p?.markdown || p?.text || p?.content || '').trim(),
      page_number: Number.isInteger(p?.index) ? p.index + 1 : (i + 1),
    }))
    .filter((s) => s.content.length > 0);

  if (segments.length === 0) return null;

  return {
    segments,
    pageCount: pages.length || null,
    tokens: Number(data?.usage_info?.pages_processed || 0),
    source: 'mistral_ocr',
  };
}
