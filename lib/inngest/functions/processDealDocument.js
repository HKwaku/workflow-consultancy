/**
 * processDealDocument
 *
 * Triggered by `deal-document.uploaded` from the upload route. Steps:
 *   1. Download bytes from Supabase Storage
 *   2. Extract text (mammoth for DOCX, officeparser for PPTX/PDF, xlsx for spreadsheets)
 *   3. Chunk into ~800-token segments respecting natural boundaries
 *   4. Insert deal_document_chunks rows (without embeddings yet)
 *   5. Embed chunks in batches via Voyage AI (skipped if VOYAGE_API_KEY unset)
 *   6. Patch embeddings + flip deal_documents.status to 'ready'
 *
 * Each step is wrapped in `step.run()` so Inngest persists progress and
 * retries on failure without redoing the work that already succeeded.
 */

import { inngest } from '../client';
import { embedDocuments, embeddingsConfigured } from '@/lib/ai/embeddings';
import { ocrExtractFromBuffer, ocrConfigured } from '@/lib/ai/ocr';
import { categorizeDocument } from '@/lib/ai/categorizeDoc';
import { resolveActiveKey } from '@/lib/customerKey';
import { logger } from '@/lib/logger';
import {
  getSupabaseHeaders, getSupabaseWriteHeaders, requireSupabase, fetchWithTimeout,
} from '@/lib/api-helpers';
import { recordTokenUsage, getOrgIdForUser } from '@/lib/costGuard';
import { extractTextFromBuffer } from './extractText';
import { chunkText } from './chunker';

const MAX_CHUNKS_PER_DOC = 1500;
const EMBED_BATCH = 32;

export const processDealDocument = inngest.createFunction(
  {
    id: 'process-deal-document',
    name: 'Parse + chunk + embed deal document',
    retries: 3,
    concurrency: { limit: 4 },
  },
  { event: 'deal-document.uploaded' },
  async ({ event, step }) => {
    const { deal_id, document_id, storage_path, mime_type } = event.data || {};
    if (!deal_id || !document_id || !storage_path) {
      throw new Error('Missing deal_id / document_id / storage_path on event payload');
    }
    const sb = requireSupabase();
    if (!sb) throw new Error('Supabase not configured');

    // Resolve the deal's owning org once. Used downstream for OCR + AI
    // categorization (so org-level BYO keys win over the platform env) and
    // for cost-metering when the platform key is in use. Best-effort —
    // both downstream paths degrade cleanly if orgId is null.
    const { orgId, ownerEmail } = await step.run('resolve-org', async () => {
      try {
        const dealResp = await fetchWithTimeout(
          `${sb.url}/rest/v1/deals?id=eq.${deal_id}&select=owner_email,owner_user_id`,
          { method: 'GET', headers: getSupabaseHeaders(sb.key) },
        );
        const [dealRow] = dealResp.ok ? await dealResp.json() : [];
        if (!dealRow) return { orgId: null, ownerEmail: null };
        const oid = await getOrgIdForUser({ email: dealRow.owner_email, userId: dealRow.owner_user_id });
        return { orgId: oid, ownerEmail: dealRow.owner_email };
      } catch (e) {
        logger.warn('Failed to resolve org for deal document', { error: e.message, deal_id });
        return { orgId: null, ownerEmail: null };
      }
    });

    // 1. Mark parsing
    await step.run('mark-parsing', async () => {
      await fetchWithTimeout(
        `${sb.url}/rest/v1/deal_documents?id=eq.${document_id}`,
        {
          method: 'PATCH',
          headers: getSupabaseWriteHeaders(sb.key),
          body: JSON.stringify({ status: 'parsing', processing_error: null }),
        },
      );
    });

    // 2. Download + extract. OCR runs in the same step when the native
    //    extractor returns nothing useful (scanned PDF, image upload). We
    //    download once and reuse the buffer for both passes.
    //
    //    The whole step is wrapped in try/catch so a thrown extractor
    //    doesn't leave the row stuck in `parsing`. We distinguish three
    //    terminal failure modes:
    //      - downloadFailed       → mark `failed` with a clear message
    //      - extractorThrew       → mark `failed`; the worker can be retried
    //      - ocrThrew (after empty native) → fall through to `stored` with
    //                                a hint, since the file IS in the data
    //                                room and the user might just need to
    //                                configure OCR or wait for it.
    const extracted = await step.run('extract-text', async () => {
      let buf;
      try {
        const dlResp = await fetchWithTimeout(
          `${sb.url}/storage/v1/object/deal-documents/${storage_path}`,
          { method: 'GET', headers: getSupabaseHeaders(sb.key) },
          45000,
        );
        if (!dlResp.ok) throw new Error(`Storage download failed: ${dlResp.status}`);
        buf = Buffer.from(await dlResp.arrayBuffer());
      } catch (e) {
        // Surface a terminal failure instead of leaving status='parsing'.
        await markFailed(sb, document_id, `Storage download failed: ${e.message}`.slice(0, 500));
        throw e; // let Inngest record the failure for ops visibility
      }

      let native;
      try {
        native = await extractTextFromBuffer(buf, { mimeType: mime_type, filename: storage_path });
      } catch (e) {
        await markFailed(sb, document_id, `Text extraction failed: ${e.message}`.slice(0, 500));
        throw e;
      }

      // OCR fallback — fires when (a) native extractor produced nothing AND
      // (b) the file is one OCR can usefully process (image-based PDFs and
      // image MIME types). Skipped silently when no Mistral key is set for
      // the org (or the platform fallback). Org admins set the OCR key in
      // the BYO API-keys panel of org admin.
      const isImageMime = (mime_type || '').toLowerCase().startsWith('image/');
      const isPdfWithoutText = native.reason === 'pdf_no_text_layer';
      const eligibleForOcr = native.segments.length === 0 && (isImageMime || isPdfWithoutText);
      if (eligibleForOcr && (await ocrConfigured({ orgId }))) {
        try {
          const ocr = await ocrExtractFromBuffer(buf, {
            mimeType: mime_type, filename: storage_path, orgId,
          });
          if (ocr && ocr.segments.length > 0) {
            return { ...ocr, source: 'ocr' };
          }
        } catch (e) {
          // OCR failure isn't terminal — the file is still in the data
          // room. Fall through with a tagged native result so the
          // mark-stored path surfaces a useful processing_error.
          logger.warn('OCR threw after empty native extract', {
            error: e.message, document_id, deal_id,
          });
          return { segments: [], pageCount: null, reason: 'ocr_failed' };
        }
      }
      return native;
    });

    // 3. Chunk
    const chunks = await step.run('chunk', async () => {
      const out = chunkText(extracted.segments).slice(0, MAX_CHUNKS_PER_DOC);
      return out.map((c, i) => ({ ...c, chunk_index: i }));
    });

    // No chunks doesn't mean the upload failed — for images, audio, video,
    // archives and scanned PDFs without OCR we accept the file as `stored`:
    // visible in the data room, downloadable, just not text-indexed. Only
    // surface a "failed" state for actual extractor errors.
    if (!chunks.length) {
      await markStored(sb, document_id, extracted.reason || 'no_text_extracted');
      return { document_id, chunks: 0, stored: true };
    }

    // 4. Insert chunks (no embedding yet)
    await step.run('insert-chunks', async () => {
      // PostgREST handles arrays natively. Send in batches of 100 to keep
      // request size sane.
      for (let i = 0; i < chunks.length; i += 100) {
        const slice = chunks.slice(i, i + 100).map((c) => ({
          document_id,
          deal_id,
          chunk_index: c.chunk_index,
          page_number:  c.page_number  ?? null,
          slide_number: c.slide_number ?? null,
          sheet_name:   c.sheet_name   ?? null,
          cell_range:   c.cell_range   ?? null,
          section_path: c.section_path ?? null,
          content: c.content,
          token_count: c.token_count ?? null,
        }));
        const resp = await fetchWithTimeout(
          `${sb.url}/rest/v1/deal_document_chunks`,
          {
            method: 'POST',
            headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=minimal' },
            body: JSON.stringify(slice),
          },
        );
        if (!resp.ok) {
          const txt = await resp.text().catch(() => '');
          throw new Error(`chunk insert failed (${resp.status}): ${txt.slice(0, 200)}`);
        }
      }
      // Update page_count on the document if extractor surfaced one.
      if (extracted.pageCount) {
        await fetchWithTimeout(
          `${sb.url}/rest/v1/deal_documents?id=eq.${document_id}`,
          {
            method: 'PATCH',
            headers: getSupabaseWriteHeaders(sb.key),
            body: JSON.stringify({ page_count: extracted.pageCount, status: 'embedding' }),
          },
        );
      } else {
        await fetchWithTimeout(
          `${sb.url}/rest/v1/deal_documents?id=eq.${document_id}`,
          {
            method: 'PATCH',
            headers: getSupabaseWriteHeaders(sb.key),
            body: JSON.stringify({ status: 'embedding' }),
          },
        );
      }
    });

    // 5. Embed (skipped cleanly if VOYAGE_API_KEY missing - search degrades to FTS-only)
    if (embeddingsConfigured()) {
      // Re-fetch chunk ids in stable order so we can patch by id.
      const idsResp = await fetchWithTimeout(
        `${sb.url}/rest/v1/deal_document_chunks?document_id=eq.${document_id}&select=id,chunk_index,content&order=chunk_index.asc`,
        { method: 'GET', headers: getSupabaseHeaders(sb.key) },
      );
      const rows = idsResp.ok ? await idsResp.json() : [];

      for (let i = 0; i < rows.length; i += EMBED_BATCH) {
        const batch = rows.slice(i, i + EMBED_BATCH);
        await step.run(`embed-${i}`, async () => {
          const vectors = await embedDocuments(batch.map((b) => b.content));
          for (let j = 0; j < batch.length; j++) {
            const vec = vectors[j];
            if (!vec) continue;
            await fetchWithTimeout(
              `${sb.url}/rest/v1/deal_document_chunks?id=eq.${batch[j].id}`,
              {
                method: 'PATCH',
                headers: getSupabaseWriteHeaders(sb.key),
                body: JSON.stringify({ embedding: vec, embedded_at: new Date().toISOString() }),
              },
            );
          }
          // Record per-batch token usage. Voyage charges by token; the total
          // for the whole batch is on vectors.__tokens.
          const batchTokens = vectors.__tokens || 0;
          if (batchTokens > 0) {
            await recordTokenUsage({
              orgId,
              vendor: 'voyage',
              model: 'voyage-3-large',
              surface: 'embedding',
              refId: document_id,
              inputTokens: batchTokens,
              outputTokens: 0,
              userEmail: ownerEmail,
            });
          }
        });
      }
    } else {
      logger.info('VOYAGE_API_KEY not set; skipping embeddings - search will be keyword-only');
    }

    // 6. Categorize — best-effort. Uses the filename + first chunk's text so
    //    the model has both the title and a representative slice. Resolves
    //    the Anthropic key via customerKey so an org-level BYO key (set in
    //    org admin) wins over the platform fallback. Token usage is metered
    //    on every successful call so categorisation doesn't bypass the
    //    cost ledger (parity with embed + analyse).
    await step.run('categorize', async () => {
      const filename = (storage_path || '').split('/').pop() || null;
      const sampleText = chunks.slice(0, 2).map((c) => c.content).join('\n\n');
      const { key: anthropicKey } = await resolveActiveKey({ orgId, vendor: 'anthropic' });
      const result = await categorizeDocument({
        filename, sampleText, mimeType: mime_type, apiKey: anthropicKey,
      });
      if (!result) return;
      const { category, usage } = result;
      await fetchWithTimeout(
        `${sb.url}/rest/v1/deal_documents?id=eq.${document_id}`,
        {
          method: 'PATCH',
          headers: getSupabaseWriteHeaders(sb.key),
          body: JSON.stringify({ category }),
        },
      );
      if (usage && (usage.inputTokens > 0 || usage.outputTokens > 0)) {
        await recordTokenUsage({
          orgId,
          vendor: 'anthropic',
          model: 'claude-haiku',
          surface: 'doc_categorize',
          refId: document_id,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          userEmail: ownerEmail,
        });
      }
    });

    // 7. Mark ready
    await step.run('mark-ready', async () => {
      await fetchWithTimeout(
        `${sb.url}/rest/v1/deal_documents?id=eq.${document_id}`,
        {
          method: 'PATCH',
          headers: getSupabaseWriteHeaders(sb.key),
          body: JSON.stringify({ status: 'ready' }),
        },
      );
    });

    return { document_id, chunks: chunks.length, embedded: embeddingsConfigured() };
  },
);

async function markFailed(sb, document_id, msg) {
  await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_documents?id=eq.${document_id}`,
    {
      method: 'PATCH',
      headers: getSupabaseWriteHeaders(sb.key),
      body: JSON.stringify({ status: 'failed', processing_error: msg }),
    },
  );
}

// `stored` means: file is in the data room, downloadable + previewable, but
// has no text chunks (image, audio, video, archive, scanned PDF without OCR
// configured). The note explains why so the UI can surface a hint.
async function markStored(sb, document_id, reason) {
  const note = reason === 'pdf_no_text_layer'
    ? 'Scanned PDF — no text layer detected. Enable OCR (Mistral key under Org admin → API keys) to index this document.'
    : reason === 'ocr_failed'
      ? 'OCR provider returned an error — file is downloadable but not text-indexed. Try Reprocess once OCR is reachable.'
      : reason === 'non_extractable_format'
        ? 'Stored only — this format is not text-indexed but remains downloadable from the data room.'
        : 'Stored only — no text could be extracted.';
  await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_documents?id=eq.${document_id}`,
    {
      method: 'PATCH',
      headers: getSupabaseWriteHeaders(sb.key),
      body: JSON.stringify({ status: 'stored', processing_error: note }),
    },
  );
}
