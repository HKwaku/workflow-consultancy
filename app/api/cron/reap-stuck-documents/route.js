/**
 * GET /api/cron/reap-stuck-documents
 *
 * Vercel Cron — runs every 15 minutes (see vercel.json).
 *
 * Recovers documents whose Inngest event was lost or whose worker died
 * mid-pipeline. Selects:
 *   - status = 'pending'  AND created_at < now() - 15 min
 *   - status = 'parsing'  AND updated_at < now() - 30 min
 *   - status = 'embedding' AND updated_at < now() - 60 min
 *
 * For each: re-emits `deal-document.uploaded`. The worker is idempotent on
 * (document_id, chunk_index) via the unique constraint, so re-firing can't
 * duplicate chunks within a single run. (If you want the re-run to wipe
 * existing chunks first, hit /api/deals/[id]/documents/[docId]/reprocess?wipe=1
 * manually instead — the reaper is conservative.)
 *
 * Returns a JSON summary so the cron history is auditable.
 */

import { NextResponse } from 'next/server';
import { getSupabaseHeaders, fetchWithTimeout, requireSupabase } from '@/lib/api-helpers';
import { sendEvent } from '@/lib/inngest/client';
import { withCron } from '@/lib/cronWrapper';
import { logger } from '@/lib/logger';

export const maxDuration = 60;

const STUCK_QUERIES = [
  // status, age threshold (Postgres interval), label
  { status: 'pending',   ageInterval: '15 minutes', label: 'never_started' },
  { status: 'parsing',   ageInterval: '30 minutes', label: 'parsing_stuck' },
  { status: 'embedding', ageInterval: '60 minutes', label: 'embedding_stuck' },
];

export const GET = withCron('reap-stuck-documents', async (request) => {
  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  const summary = { checked: 0, requeued: 0, failed: 0, byStatus: {} };

  for (const q of STUCK_QUERIES) {
    // PostgREST: "updated_at=lt.now()-interval '15 minutes'" isn't valid;
    // we compute the cutoff in JS and pass an ISO timestamp.
    const cutoffMs = q.status === 'pending'
      ? Date.now() - 15 * 60 * 1000
      : q.status === 'parsing'
      ? Date.now() - 30 * 60 * 1000
      : Date.now() - 60 * 60 * 1000;
    const cutoff = new Date(cutoffMs).toISOString();
    const ageColumn = q.status === 'pending' ? 'created_at' : 'updated_at';

    const url = `${sb.url}/rest/v1/deal_documents`
      + `?status=eq.${q.status}`
      + `&${ageColumn}=lt.${encodeURIComponent(cutoff)}`
      + `&select=id,deal_id,storage_path,mime_type,byte_size,filename`
      + `&limit=50`;

    const resp = await fetchWithTimeout(url, { method: 'GET', headers: getSupabaseHeaders(sb.key) });
    if (!resp.ok) {
      logger.warn('Stuck-doc query failed', { status: resp.status, label: q.label });
      continue;
    }
    const rows = await resp.json();
    summary.checked += rows.length;
    summary.byStatus[q.label] = rows.length;

    for (const doc of rows) {
      if (!doc.storage_path) {
        // No bytes uploaded — there's nothing to do; mark as failed so it
        // stops appearing in this query.
        await fetchWithTimeout(
          `${sb.url}/rest/v1/deal_documents?id=eq.${doc.id}`,
          {
            method: 'PATCH',
            headers: { ...getSupabaseHeaders(sb.key), 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'failed', processing_error: 'No stored bytes to process.' }),
          },
        ).catch(() => {});
        summary.failed += 1;
        continue;
      }

      try {
        const result = await sendEvent({
          name: 'deal-document.uploaded',
          data: {
            deal_id: doc.deal_id,
            document_id: doc.id,
            storage_path: doc.storage_path,
            mime_type: doc.mime_type,
            byte_size: doc.byte_size,
            requeued_by: 'cron',
            requeue_reason: q.label,
          },
        });
        if (result?.skipped) {
          // No worker configured. Nothing we can do beyond logging.
          summary.failed += 1;
        } else {
          summary.requeued += 1;
        }
      } catch (e) {
        logger.error('Stuck-doc requeue failed', {
          document_id: doc.id, deal_id: doc.deal_id, error: e.message,
        });
        summary.failed += 1;
      }
    }
  }

  logger.info('Stuck-doc reaper run complete', summary);
  return NextResponse.json({ ok: true, ...summary });
});
