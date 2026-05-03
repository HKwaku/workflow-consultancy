/**
 * syncConnectorBinding
 *
 * Two triggers:
 *   1. Cron — every 15 min, sweeps `deal_connector_bindings` whose
 *      next_sync_after has elapsed and queues this function for each.
 *   2. Event `connector-binding.sync-requested` — fired by the binding
 *      POST route (immediate sync) or by Reina's chat tool.
 *
 * Per binding:
 *   1. Resolve token via lib/connectors/tokens.js (refreshes if needed)
 *   2. Call provider.listChanges(deltaCursor) → { items, nextCursor }
 *   3. For each upsert item:
 *      - SHA-256 the bytes (downloaded once)
 *      - Upsert deal_documents row keyed on (binding_id, source_external_id)
 *      - Push bytes to Supabase Storage at deal-documents/{deal_id}/{doc_id}/{filename}
 *      - Emit `deal-document.uploaded` so the existing pipeline runs
 *   4. For each delete item: flip status='archived' on the matching row
 *   5. Persist nextCursor + last_sync_at + reschedule next_sync_after
 *
 * Best-effort throughout. Per-file failures don't fail the whole binding;
 * they're logged and the binding stays active for the next sweep.
 */

import crypto from 'node:crypto';
import { inngest } from '../client';
import { getProvider } from '@/lib/connectors';
import { resolveActiveToken } from '@/lib/connectors/tokens';
import {
  getSupabaseHeaders, getSupabaseWriteHeaders, requireSupabase, fetchWithTimeout,
} from '@/lib/api-helpers';
import { sendEvent } from '@/lib/inngest/client';
import { logger } from '@/lib/logger';

const SYNC_INTERVAL_MS = 15 * 60 * 1000;
const MAX_FILES_PER_RUN = 100;

export const syncConnectorBinding = inngest.createFunction(
  {
    id: 'sync-connector-binding',
    name: 'Sync deal connector binding',
    retries: 1, // sync issues are usually structural (token expired); fail fast
    concurrency: { limit: 8 },
  },
  [
    { event: 'connector-binding.sync-requested' },
    { cron: '*/15 * * * *' }, // every 15 min — fans out individual bindings
  ],
  async ({ event, step }) => {
    const sb = requireSupabase();
    if (!sb) throw new Error('Supabase not configured');

    // Cron path: enumerate due bindings and fan out.
    if (event.name !== 'connector-binding.sync-requested') {
      const due = await step.run('list-due-bindings', async () => {
        const r = await fetchWithTimeout(
          `${sb.url}/rest/v1/deal_connector_bindings?sync_status=eq.active&next_sync_after=lte.${encodeURIComponent(new Date().toISOString())}&select=id&limit=200`,
          { method: 'GET', headers: getSupabaseHeaders(sb.key) },
        );
        return r.ok ? await r.json() : [];
      });
      for (const b of due) {
        await step.sendEvent(`fan-${b.id}`, { name: 'connector-binding.sync-requested', data: { binding_id: b.id } });
      }
      return { fanned: due.length };
    }

    const bindingId = event.data?.binding_id;
    if (!bindingId) throw new Error('binding_id missing on event');

    // Load the binding + integration context.
    const ctx = await step.run('load-binding', async () => {
      const r = await fetchWithTimeout(
        `${sb.url}/rest/v1/deal_connector_bindings?id=eq.${bindingId}&select=id,deal_id,integration_id,source_ref,delta_cursor,source_party,visibility,org_integrations(provider,org_id,status)&limit=1`,
        { method: 'GET', headers: getSupabaseHeaders(sb.key) },
      );
      const [row] = r.ok ? await r.json() : [];
      return row || null;
    });
    if (!ctx) throw new Error(`Binding ${bindingId} not found`);
    if (ctx.org_integrations?.status !== 'active') {
      await markBinding(sb, bindingId, 'paused', 'Integration is not active.');
      return { skipped: 'integration_not_active' };
    }

    const provider = ctx.org_integrations.provider;
    const orgId = ctx.org_integrations.org_id;
    const def = getProvider(provider);
    if (!def) throw new Error(`No provider adapter for ${provider}`);

    // Mark syncing.
    await step.run('mark-syncing', async () => {
      await fetchWithTimeout(
        `${sb.url}/rest/v1/deal_connector_bindings?id=eq.${bindingId}`,
        { method: 'PATCH', headers: getSupabaseWriteHeaders(sb.key),
          body: JSON.stringify({ sync_status: 'syncing', last_sync_error: null, updated_at: new Date().toISOString() }) },
      );
    });

    // Resolve token (refreshes if expired).
    const tok = await resolveActiveToken({ orgId, provider });
    if (!tok) {
      await markBinding(sb, bindingId, 'error', 'Could not resolve OAuth token.');
      return { error: 'no_token' };
    }

    // List changes.
    let listResult;
    try {
      listResult = await step.run('list-changes', async () => {
        return def.listChanges({
          accessToken: tok.accessToken,
          sourceRef: ctx.source_ref,
          deltaCursor: ctx.delta_cursor || null,
          metadata: tok.metadata,
        });
      });
    } catch (e) {
      await markBinding(sb, bindingId, 'error', `listChanges failed: ${e.message}`.slice(0, 500));
      return { error: 'list_changes_failed' };
    }

    const items = (listResult.items || []).slice(0, MAX_FILES_PER_RUN);
    let processed = 0;
    let archived = 0;
    let errored = 0;

    for (const item of items) {
      try {
        if (item.op === 'delete') {
          await step.run(`archive-${item.externalId}`, async () => {
            // Scope the archive to (binding_id, externalId) so a deletion
            // event from binding A doesn't soft-delete a row that was
            // ingested by binding B referencing the same source file.
            // Two bindings touching the same external file is rare but
            // legal; without this scope the second binding would see the
            // archive and never re-ingest because dedup would match the
            // archived row.
            await fetchWithTimeout(
              `${sb.url}/rest/v1/deal_documents?connector_binding_id=eq.${bindingId}&source_external_id=eq.${encodeURIComponent(item.externalId)}`,
              { method: 'PATCH', headers: getSupabaseWriteHeaders(sb.key),
                body: JSON.stringify({ status: 'archived', updated_at: new Date().toISOString() }) },
            );
          });
          archived += 1;
          continue;
        }
        await step.run(`ingest-${item.externalId}`, async () => {
          const buf = await def.downloadFile({
            accessToken: tok.accessToken, externalId: item.externalId, sourceRef: ctx.source_ref,
          });
          const contentHash = crypto.createHash('sha256').update(buf).digest('hex');

          // Idempotency by (binding, externalId) — re-syncs update the same row.
          const cur = await fetchWithTimeout(
            `${sb.url}/rest/v1/deal_documents?connector_binding_id=eq.${bindingId}&source_external_id=eq.${encodeURIComponent(item.externalId)}&select=id,content_hash,status&limit=1`,
            { method: 'GET', headers: getSupabaseHeaders(sb.key) },
          );
          const [existing] = cur.ok ? await cur.json() : [];

          if (existing && existing.content_hash === contentHash && existing.status !== 'failed') {
            return; // unchanged — skip
          }

          let docId;
          if (existing) {
            // Re-upload + reset to pending so the worker re-chunks.
            docId = existing.id;
            await fetchWithTimeout(
              `${sb.url}/rest/v1/deal_documents?id=eq.${docId}`,
              { method: 'PATCH', headers: getSupabaseWriteHeaders(sb.key),
                body: JSON.stringify({
                  filename: item.filename, mime_type: item.mimeType, byte_size: item.byteSize,
                  content_hash: contentHash, status: 'pending', processing_error: null,
                  updated_at: new Date().toISOString(),
                }) },
            );
          } else {
            const ins = await fetchWithTimeout(
              `${sb.url}/rest/v1/deal_documents`,
              { method: 'POST',
                headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=representation' },
                body: JSON.stringify({
                  deal_id: ctx.deal_id, filename: item.filename, mime_type: item.mimeType,
                  byte_size: item.byteSize, content_hash: contentHash,
                  source_party: ctx.source_party, visibility: ctx.visibility,
                  uploaded_by_email: 'connector@vesno', status: 'pending',
                  connector_binding_id: bindingId, source_external_id: item.externalId,
                }) },
            );
            const [doc] = await ins.json();
            docId = doc.id;
          }

          // Upload bytes to Storage (overwrite if existing).
          const safeName = (item.filename || 'document').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
          const storagePath = `${ctx.deal_id}/${docId}/${safeName}`;
          const up = await fetchWithTimeout(
            `${sb.url}/storage/v1/object/deal-documents/${storagePath}`,
            { method: 'POST',
              headers: { ...getSupabaseHeaders(sb.key), 'Content-Type': item.mimeType || 'application/octet-stream', 'x-upsert': 'true' },
              body: buf },
            45000,
          );
          if (!up.ok) {
            await fetchWithTimeout(
              `${sb.url}/rest/v1/deal_documents?id=eq.${docId}`,
              { method: 'PATCH', headers: getSupabaseWriteHeaders(sb.key),
                body: JSON.stringify({ status: 'failed', processing_error: 'Storage upload failed during connector sync.' }) },
            );
            return;
          }
          await fetchWithTimeout(
            `${sb.url}/rest/v1/deal_documents?id=eq.${docId}`,
            { method: 'PATCH', headers: getSupabaseWriteHeaders(sb.key),
              body: JSON.stringify({ storage_path: storagePath }) },
          );

          // Hand off to the existing pipeline.
          try {
            await sendEvent({
              name: 'deal-document.uploaded',
              data: { deal_id: ctx.deal_id, document_id: docId, storage_path: storagePath, mime_type: item.mimeType, byte_size: item.byteSize },
            });
          } catch (e) {
            logger.warn('Connector sync: enqueue failed', { error: e.message, docId });
          }
        });
        processed += 1;
      } catch (e) {
        errored += 1;
        logger.warn('Connector sync: per-file error', { error: e.message, externalId: item.externalId });
      }
    }

    // Persist cursor + reschedule.
    await step.run('mark-active', async () => {
      const next = new Date(Date.now() + SYNC_INTERVAL_MS).toISOString();
      await fetchWithTimeout(
        `${sb.url}/rest/v1/deal_connector_bindings?id=eq.${bindingId}`,
        { method: 'PATCH', headers: getSupabaseWriteHeaders(sb.key),
          body: JSON.stringify({
            sync_status: 'active',
            delta_cursor: listResult.nextCursor || ctx.delta_cursor || null,
            last_sync_at: new Date().toISOString(),
            last_sync_error: errored > 0 ? `${errored} files errored — see logs.` : null,
            next_sync_after: next,
            updated_at: new Date().toISOString(),
          }) },
      );
    });

    return { processed, archived, errored, total: items.length };
  },
);

async function markBinding(sb, bindingId, status, errorText) {
  await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_connector_bindings?id=eq.${bindingId}`,
    { method: 'PATCH', headers: getSupabaseWriteHeaders(sb.key),
      body: JSON.stringify({
        sync_status: status,
        last_sync_error: errorText ? errorText.slice(0, 500) : null,
        updated_at: new Date().toISOString(),
      }) },
  );
}
