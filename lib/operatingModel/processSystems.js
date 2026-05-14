/**
 * processSystems — keep the process_systems join table in sync with
 * the diagnostic_reports JSONB whenever a process is saved.
 *
 * Strategy: walk the report's rawProcesses[].steps[].systems[], compute
 * the desired set of (process_index, step_index, system_name_raw) rows,
 * then DELETE all existing rows for the report and bulk-INSERT the new
 * set. Cheap because the row count per report is tiny (typically <100).
 *
 * Best-effort link to model_systems: when a model_systems row exists
 * with the same lower(name) under the report's operating_model, we set
 * system_id on insert so cross-process queries can group by canonical
 * system from day one.
 *
 * Called from /api/update-diagnostic save paths (current AND target). We
 * always normalise from the diagnostic_data column — current is the
 * canonical "what's actually live"; target_data is the design draft and
 * doesn't drive system inventory.
 */

import { getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase } from '../api-helpers.js';
import { logger } from '../logger.js';

/**
 * Pure: walk the diagnostic_data shape and emit insert-row payloads.
 * Skips empty / null systems entries. Exported for tests.
 *
 * Per-step function tagging: when a step has its own `functionId` (or
 * `function_id`), that wins over the process-level fallback. Lets the
 * heatmap attribute work to the function the step actually belongs to,
 * which matters for processes that span functions (order-to-cash starts
 * in Sales, ends in Finance — the steps should count under each).
 */
export function extractSystemRows({ diagnosticData, reportId, operatingModelId, functionId }) {
  if (!diagnosticData || typeof diagnosticData !== 'object') return [];
  const rps = Array.isArray(diagnosticData.rawProcesses) ? diagnosticData.rawProcesses : [];
  const out = [];
  rps.forEach((proc, pIdx) => {
    const steps = Array.isArray(proc?.steps) ? proc.steps : [];
    steps.forEach((step, sIdx) => {
      const systems = Array.isArray(step?.systems) ? step.systems : [];
      const stepCapId = step?.functionId || step?.function_id || step?.capabilityId || step?.capability_id || null;
      for (const sys of systems) {
        const name = typeof sys === 'string' ? sys.trim() : '';
        if (!name) continue;
        out.push({
          // Living-workspace migration: column renamed report_id → process_id.
          process_id: reportId,
          process_index: pIdx,
          step_index: sIdx,
          step_name: step.name || null,
          system_name_raw: name,
          operating_model_id: operatingModelId || null,
          function_id: stepCapId || functionId || null,
        });
      }
    });
  });
  return out;
}

/**
 * Replace the process_systems rows for one report with a fresh set
 * computed from the supplied diagnostic_data. Idempotent.
 *
 * Auto-links to model_systems when a same-org row matches by lower(name).
 *
 * Best-effort — never throws into the calling save path. Returns
 * { ok, written, errors } so the caller can log summaries.
 */
export async function syncProcessSystemsForReport({
  reportId, diagnosticData, operatingModelId, functionId,
}) {
  if (!reportId) return { ok: false, written: 0, errors: 0 };
  const sb = requireSupabase();
  if (!sb) return { ok: false, written: 0, errors: 0 };

  const rows = extractSystemRows({ diagnosticData, reportId, operatingModelId, functionId });

  // Pre-fetch model_systems for the report's operating model so we can
  // populate system_id inline on insert. Skipped when no model is set
  // (the report isn't yet anchored to an operating model).
  const matchKeyToSystemId = new Map();
  if (operatingModelId && rows.length) {
    try {
      const resp = await fetchWithTimeout(
        `${sb.url}/rest/v1/model_systems?operating_model_id=eq.${encodeURIComponent(operatingModelId)}&select=id,match_key`,
        { method: 'GET', headers: getSupabaseHeaders(sb.key) },
      );
      if (resp.ok) {
        const sysRows = await resp.json();
        for (const s of sysRows) matchKeyToSystemId.set(s.match_key, s.id);
      }
    } catch (e) {
      logger.warn('syncProcessSystemsForReport: model_systems fetch failed', { reportId, error: e.message });
    }
  }

  const enriched = rows.map((r) => {
    const key = r.system_name_raw.toLowerCase();
    return matchKeyToSystemId.has(key)
      ? { ...r, system_id: matchKeyToSystemId.get(key) }
      : r;
  });

  // Replace strategy: DELETE all then INSERT. Wrapped so a partial
  // failure doesn't leave the report systemless when the pre-write set
  // was good — we only DELETE after the (possibly empty) INSERT works.
  // (PostgREST has no real transaction primitive; this is best-effort.)
  try {
    if (enriched.length > 0) {
      const insertResp = await fetchWithTimeout(
        `${sb.url}/rest/v1/process_systems`,
        {
          method: 'POST',
          headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=minimal' },
          body: JSON.stringify(enriched),
        },
      );
      if (!insertResp.ok) {
        const txt = await insertResp.text().catch(() => '');
        logger.warn('syncProcessSystemsForReport: insert failed', { reportId, status: insertResp.status, body: txt.slice(0, 300) });
        return { ok: false, written: 0, errors: enriched.length };
      }
    }

    // Now drop any pre-existing rows that don't match the freshly-inserted
    // set. We use created_at as a proxy: anything created before the bulk
    // insert window is stale. This avoids dupes from the previous version
    // of the canvas hanging around.
    //
    // The window: rows older than 5 seconds before "now". Generous enough
    // to ignore clock skew, tight enough not to swallow concurrent writes.
    const cutoff = new Date(Date.now() - 5_000).toISOString();
    const delResp = await fetchWithTimeout(
      `${sb.url}/rest/v1/process_systems?process_id=eq.${encodeURIComponent(reportId)}` +
        `&created_at=lt.${encodeURIComponent(cutoff)}`,
      { method: 'DELETE', headers: getSupabaseWriteHeaders(sb.key) },
    );
    if (!delResp.ok && delResp.status !== 204) {
      logger.warn('syncProcessSystemsForReport: stale-delete failed', { reportId, status: delResp.status });
    }

    return { ok: true, written: enriched.length, errors: 0 };
  } catch (e) {
    logger.error('syncProcessSystemsForReport threw', { reportId, error: e.message });
    return { ok: false, written: 0, errors: enriched.length };
  }
}
