/**
 * changesRepo — read/write the `changes` and `change_outcomes` tables.
 *
 * The relational store for "what was changed in this report or deal, by whom,
 * why, and how it landed." Replaces the scattered persistence today:
 *
 *   * Redesign agent's `record_change` tool calls were only persisted inside
 *     report_redesigns.redesign_data JSONB. We now mirror them into rows.
 *   * Deal `propose_*` tool calls (finding reviews, doc reprocess, participant
 *     edits, etc.) wrote directly to their target tables with no common audit
 *     spine. We log a row per proposal so the deal page can show a timeline.
 *
 * The legacy JSONB blobs stay where they are as the raw audit archive; this
 * table is the canonical read source going forward — same pattern as
 * lib/deal-analysis/findingsRepo.js wrt deal_findings.
 *
 * Recommended outcome metric vocabulary (free-form, but consistent across
 * sources keeps the cross-deal "what actually moved" view sensible):
 *
 *   cycle_time_minutes  – wall-clock minutes from start to end of one instance
 *   work_minutes        – hands-on minutes per instance
 *   cost_per_run        – currency per instance
 *   annual_cost         – currency per year
 *   automation_pct      – % of steps automated
 *   error_rate_pct      – % of instances requiring rework
 *   fte                 – full-time equivalents
 */

import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase,
} from '../api-helpers.js';
import { logger } from '../logger.js';

const SUBJECT_TYPES = new Set([
  'process', 'process_step', 'handoff', 'cost_input',
  'redesign', 'deal_finding', 'participant', 'document',
]);
const KINDS = new Set([
  'added', 'removed', 'modified', 'merged',
  'reordered', 'automated', 'reverted',
]);
const STATES = new Set([
  'proposed', 'accepted', 'rejected',
  'applied', 'live', 'measured', 'reverted',
]);
const ACTOR_KINDS = new Set(['agent', 'user', 'system']);
const OUTCOME_SOURCES = new Set([
  'process_instance', 'report_rerun', 'manual', 'inferred_from_doc', 'agent',
]);

function clampConfidence(v) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

function toRow(input) {
  const row = {
    subject_type: SUBJECT_TYPES.has(input.subject_type) ? input.subject_type : 'process_step',
    subject_ref: input.subject_ref || {},
    kind: KINDS.has(input.kind) ? input.kind : 'modified',
    state: STATES.has(input.state) ? input.state : 'proposed',
    before_state: input.before_state ?? null,
    after_state: input.after_state ?? null,
    rationale: input.rationale ? String(input.rationale).slice(0, 4000) : null,
    principle: input.principle ? String(input.principle).slice(0, 80) : null,
    evidence_refs: Array.isArray(input.evidence_refs) ? input.evidence_refs : [],
    discovery_session_id: input.discovery_session_id || null,
    parent_change_id: input.parent_change_id || null,
    // Living-workspace migration: changes.report_id renamed to
    // process_id; redesign_id column dropped. Callers still pass
    // input.report_id by convention — accept either key.
    process_id: input.process_id || input.report_id || null,
    deal_id: input.deal_id || null,
    actor_kind: ACTOR_KINDS.has(input.actor_kind) ? input.actor_kind : 'agent',
    actor_email: input.actor_email ? String(input.actor_email).toLowerCase() : null,
    agent_name: input.agent_name ? String(input.agent_name).slice(0, 80) : null,
    confidence: clampConfidence(input.confidence),
    expected_impact: input.expected_impact ?? null,
  };
  // Lifecycle timestamps are filled by recordTransition / recordOutcome rather
  // than at insert. proposed_at defaults to now() in the table.
  return row;
}

/**
 * Insert one or more changes. Returns the inserted ids in order.
 * Each input must carry either `report_id` or `deal_id` (CHECK constraint).
 */
export async function recordChanges(inputs) {
  const arr = Array.isArray(inputs) ? inputs : [inputs];
  if (arr.length === 0) return { ids: [], written: 0, errors: 0 };

  const sb = requireSupabase();
  if (!sb) return { ids: [], written: 0, errors: arr.length };

  const rows = arr
    .filter((i) => i && (i.process_id || i.report_id || i.deal_id))
    .map(toRow);
  let errors = arr.length - rows.length;
  if (rows.length === 0) {
    logger.warn('recordChanges: no rows had process_id/report_id or deal_id', { count: arr.length });
    return { ids: [], written: 0, errors };
  }

  const ids = [];
  let written = 0;

  // Batch 100 at a time to keep request size sensible.
  for (let i = 0; i < rows.length; i += 100) {
    const slice = rows.slice(i, i + 100);
    try {
      const resp = await fetchWithTimeout(
        `${sb.url}/rest/v1/changes?select=id`,
        {
          method: 'POST',
          headers: {
            ...getSupabaseWriteHeaders(sb.key),
            Prefer: 'return=representation',
          },
          body: JSON.stringify(slice),
        },
      );
      if (resp.ok) {
        const body = await resp.json().catch(() => []);
        body.forEach((r) => ids.push(r.id));
        written += slice.length;
      } else {
        errors += slice.length;
        const txt = await resp.text().catch(() => '');
        logger.error('recordChanges batch failed', {
          status: resp.status, body: txt.slice(0, 300),
        });
      }
    } catch (e) {
      errors += slice.length;
      logger.error('recordChanges batch threw', { error: e.message });
    }
  }
  return { ids, written, errors };
}

/**
 * Advance a change's state. Sets the matching lifecycle timestamp.
 * Allowed transitions (validated server-side via the CHECK on `state`):
 *   proposed → accepted | rejected | applied
 *   accepted → applied  | rejected
 *   applied  → live     | reverted
 *   live     → measured | reverted
 *   measured → measured (re-measure) | reverted
 */
export async function recordTransition({ id, state, actor_email = null }) {
  if (!id || !STATES.has(state)) return { ok: false };
  const sb = requireSupabase();
  if (!sb) return { ok: false };

  const now = new Date().toISOString();
  const patch = { state, updated_at: now };
  if (state === 'accepted' || state === 'rejected') patch.decided_at = now;
  if (state === 'applied') patch.applied_at = now;
  if (state === 'live') patch.live_at = now;
  if (state === 'measured') patch.measured_at = now;
  if (state === 'reverted') patch.reverted_at = now;
  if (actor_email) patch.actor_email = String(actor_email).toLowerCase();

  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/changes?id=eq.${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=minimal' },
        body: JSON.stringify(patch),
      },
    );
    return { ok: resp.ok };
  } catch (e) {
    logger.error('recordTransition failed', { id, state, error: e.message });
    return { ok: false };
  }
}

/**
 * Living-workspace migration: redesign_id column and the report_redesigns
 * table are gone. This bulk-transition function has no consumer in the
 * new system — AI suggestions are inline `changes` rows that the user
 * accepts individually. Validate args (so tests of input handling still
 * pass) then return a clean no-op.
 */
export async function transitionChangesForRedesign({
  redesignId, fromState, toState,
}) {
  if (!redesignId || !STATES.has(toState) || !STATES.has(fromState)) {
    return { ok: false, updated: 0 };
  }
  return { ok: true, updated: 0 };
}

/**
 * Attach a measured outcome. Flips the parent change to `measured` opportunistically.
 */
export async function recordOutcome({
  change_id, metric, unit = null,
  value_before = null, value_after = null,
  source, source_ref = null, notes = null,
}) {
  if (!change_id || !metric) return { ok: false };
  if (!OUTCOME_SOURCES.has(source)) return { ok: false };
  const sb = requireSupabase();
  if (!sb) return { ok: false };

  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/change_outcomes`,
      {
        method: 'POST',
        headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=minimal' },
        body: JSON.stringify({
          change_id, metric, unit,
          value_before, value_after,
          source, source_ref, notes,
        }),
      },
    );
    if (!resp.ok) return { ok: false };

    // Best-effort flip to `measured` — ignored if the change is already
    // `reverted` because we don't want a late metric to resurrect a revert.
    await recordTransition({ id: change_id, state: 'measured' }).catch(() => {});
    return { ok: true };
  } catch (e) {
    logger.error('recordOutcome failed', { change_id, metric, error: e.message });
    return { ok: false };
  }
}

/**
 * Read all changes for a report or deal, newest first. Pass exactly one of
 * `reportId` or `dealId`. Includes a single embedded outcome count so the
 * timeline UI can show "measured" badges without a second round-trip.
 */
export async function loadChanges({ reportId, dealId, limit = 200 }) {
  const sb = requireSupabase();
  if (!sb) return [];
  // Living-workspace migration: changes.report_id renamed to process_id,
  // redesign_id column dropped. Callers still pass `reportId` by convention.
  const filter = reportId
    ? `process_id=eq.${encodeURIComponent(reportId)}`
    : dealId ? `deal_id=eq.${encodeURIComponent(dealId)}` : null;
  if (!filter) return [];

  const select =
    'id,subject_type,subject_ref,kind,state,rationale,principle,evidence_refs,' +
    'discovery_session_id,parent_change_id,process_id,deal_id,' +
    'actor_kind,actor_email,agent_name,confidence,expected_impact,' +
    'proposed_at,decided_at,applied_at,live_at,measured_at,reverted_at,' +
    'created_at,updated_at,' +
    'change_outcomes(id,metric,unit,value_before,value_after,delta,source,measured_at)';

  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/changes?${filter}&select=${encodeURIComponent(select)}` +
        `&order=created_at.desc&limit=${Math.max(1, Math.min(500, limit))}`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    );
    if (!resp.ok) {
      logger.warn('loadChanges fetch failed', { status: resp.status });
      return [];
    }
    return await resp.json();
  } catch (e) {
    logger.error('loadChanges threw', { error: e.message });
    return [];
  }
}

/**
 * Batched read of DECIDED changes for many processes at once. Powers the
 * decided-savings figure on process/graph/insights surfaces without an
 * N+1 per-process query. Returns Map<process_id, change[]> containing
 * only accepted/applied/live/measured rows (the states that count as a
 * decided improvement). Processes with no decided changes are absent
 * from the map (callers treat absence as £0).
 */
export async function loadDecidedChangesByProcess(processIds) {
  const sb = requireSupabase();
  if (!sb) return new Map();
  const ids = [...new Set((processIds || []).filter(Boolean).map(String))];
  if (ids.length === 0) return new Map();

  const inList = ids.map((x) => encodeURIComponent(x)).join(',');
  const select =
    'process_id,state,expected_impact,' +
    'change_outcomes(metric,unit,value_before,value_after,delta)';
  const url = `${sb.url}/rest/v1/changes?process_id=in.(${inList})` +
    '&state=in.(accepted,applied,live,measured)' +
    `&select=${encodeURIComponent(select)}&limit=2000`;

  try {
    const resp = await fetchWithTimeout(url, { method: 'GET', headers: getSupabaseHeaders(sb.key) });
    if (!resp.ok) {
      logger.warn('loadDecidedChangesByProcess fetch failed', { status: resp.status });
      return new Map();
    }
    const rows = await resp.json();
    const byProc = new Map();
    for (const r of rows) {
      if (!r?.process_id) continue;
      if (!byProc.has(r.process_id)) byProc.set(r.process_id, []);
      byProc.get(r.process_id).push(r);
    }
    return byProc;
  } catch (e) {
    logger.error('loadDecidedChangesByProcess threw', { error: e.message });
    return new Map();
  }
}

// ------------------------------------------------------------------
// Discovery sessions
// ------------------------------------------------------------------

/**
 * Open a discovery session anchored to a report or deal (or both). Returns
 * the row id. The chat agent's `ask_discovery` tool calls appendObservation()
 * against this id; recordChanges() rows can reference it too so the timeline
 * can show "this proposal came out of the question we asked at 14:32".
 */
export async function openDiscoverySession({
  chat_session_id = null, report_id = null, deal_id = null,
  user_email = null, goal = null,
}) {
  if (!report_id && !deal_id && !chat_session_id) return null;
  const sb = requireSupabase();
  if (!sb) return null;

  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/discovery_sessions?select=id`,
      {
        method: 'POST',
        headers: {
          ...getSupabaseWriteHeaders(sb.key),
          Prefer: 'return=representation',
        },
        body: JSON.stringify([{
          chat_session_id, report_id, deal_id,
          user_email: user_email ? String(user_email).toLowerCase() : null,
          goal,
        }]),
      },
    );
    if (!resp.ok) return null;
    const rows = await resp.json().catch(() => []);
    return rows[0]?.id || null;
  } catch (e) {
    logger.error('openDiscoverySession failed', { error: e.message });
    return null;
  }
}

/**
 * Append one observation to a discovery session's `observations` array.
 * Uses a read-modify-write rather than jsonb_path_ops because PostgREST
 * doesn't expose array push; the row is small so the round-trip is fine.
 */
export async function appendObservation(sessionId, observation) {
  if (!sessionId || !observation) return { ok: false };
  const sb = requireSupabase();
  if (!sb) return { ok: false };

  try {
    const getResp = await fetchWithTimeout(
      `${sb.url}/rest/v1/discovery_sessions?id=eq.${encodeURIComponent(sessionId)}&select=observations`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    );
    if (!getResp.ok) return { ok: false };
    const rows = await getResp.json().catch(() => []);
    if (rows.length === 0) return { ok: false };

    const next = [...(rows[0].observations || []), {
      observed_at: new Date().toISOString(),
      ...observation,
    }];

    const patchResp = await fetchWithTimeout(
      `${sb.url}/rest/v1/discovery_sessions?id=eq.${encodeURIComponent(sessionId)}`,
      {
        method: 'PATCH',
        headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=minimal' },
        body: JSON.stringify({ observations: next }),
      },
    );
    return { ok: patchResp.ok };
  } catch (e) {
    logger.error('appendObservation failed', { sessionId, error: e.message });
    return { ok: false };
  }
}

/**
 * Close a discovery session (records ended_at + optional summary). Idempotent.
 */
export async function closeDiscoverySession(sessionId, { summary = null } = {}) {
  if (!sessionId) return { ok: false };
  const sb = requireSupabase();
  if (!sb) return { ok: false };

  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/discovery_sessions?id=eq.${encodeURIComponent(sessionId)}`,
      {
        method: 'PATCH',
        headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=minimal' },
        body: JSON.stringify({
          ended_at: new Date().toISOString(),
          ...(summary != null && { summary }),
        }),
      },
    );
    return { ok: resp.ok };
  } catch (e) {
    logger.error('closeDiscoverySession failed', { sessionId, error: e.message });
    return { ok: false };
  }
}

