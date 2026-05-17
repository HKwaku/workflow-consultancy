/**
 * operatingModelRepo — read/write helpers for the workspace primitive.
 *
 * The operating model is the org-wide aggregate of:
 *   * functions  – hierarchical taxonomy (Finance → AR → Cash collection)
 *   * model_roles   – named roles with headcount + capability scope
 *   * model_systems – normalised system inventory
 *   * processes     – existing diagnostic_reports anchored via operating_model_id
 *
 * What this file covers:
 *
 *   getDefaultOperatingModel(orgId)      ← the org's home model (created by
 *                                          migration 37 backfill)
 *   loadOperatingModel(modelId)          ← model + functions tree + roles
 *                                          + systems + process count rollup
 *   loadModelRollup(modelId)             ← aggregated stats per capability:
 *                                          process count, FTE, annual cost
 *   createOperatingModel({...})          ← new model in an org
 *   create/update/deleteCapability(...)  ← capability CRUD
 *   createModelRole(...) / createModelSystem(...) ← role + system inventory
 *   attachProcessToModel({...})          ← bind a diagnostic_report to a
 *                                          (model, capability) pair
 *   setProcessTarget({...})              ← write target_data + flip state_kind
 *   promoteTargetToCurrent({...})        ← copy target → current, archive
 *                                          previous current as a `changes` row
 *
 * Tree shape returned by loadOperatingModel:
 *   {
 *     model:       { id, name, kind, status, ... },
 *     functions:[{ id, name, parent_function_id, layer, ..., children: [...] }],
 *     roles:       [...],
 *     systems:     [...],
 *     processCount: number,
 *   }
 *
 * Capabilities arrive flat from the DB; we nest them in JS so the picker
 * UI can render the tree without a recursive CTE.
 */

import { randomUUID } from 'node:crypto';
import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase,
} from '../api-helpers.js';
import { logger } from '../logger.js';
import { recordChanges } from '../changes/repo.js';
import { attachDerivedMetrics } from '../processMetrics.js';

// ------------------------------------------------------------------
// Operating model
// ------------------------------------------------------------------

/**
 * Fetch the org's default operating model. NULL if the org has none
 * (shouldn't happen post-migration-37 backfill, but be defensive).
 */
export async function getDefaultOperatingModel(orgId) {
  if (!orgId) return null;
  const sb = requireSupabase();
  if (!sb) return null;

  try {
    // Two-step: read default_operating_model_id, then load the row. One
    // round-trip via embed: organizations?select=…operating_models(*).
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/organizations?id=eq.${encodeURIComponent(orgId)}` +
        `&select=id,default_operating_model_id,model:default_operating_model_id(id,name,kind,status,description,settings,parent_model_id,created_at,updated_at)` +
        `&limit=1`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    );
    if (!resp.ok) return null;
    const [row] = await resp.json();
    return row?.model || null;
  } catch (e) {
    logger.error('getDefaultOperatingModel failed', { orgId, error: e.message });
    return null;
  }
}

/**
 * Create a new operating model. Returns the new row's id.
 */
export async function createOperatingModel({
  organization_id, name, kind = 'single_entity',
  parent_model_id = null, description = null, settings = null,
  created_by_email = null,
}) {
  if (!organization_id || !name) return null;
  const sb = requireSupabase();
  if (!sb) return null;

  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/operating_models?select=id`,
      {
        method: 'POST',
        headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=representation' },
        body: JSON.stringify([{
          organization_id,
          name: String(name).slice(0, 200),
          kind,
          parent_model_id,
          description: description ? String(description).slice(0, 4000) : null,
          settings: settings || {},
          created_by_email: created_by_email ? String(created_by_email).toLowerCase() : null,
        }]),
      },
    );
    if (!resp.ok) return null;
    const [row] = await resp.json().catch(() => []);
    return row?.id || null;
  } catch (e) {
    logger.error('createOperatingModel failed', { error: e.message });
    return null;
  }
}

/**
 * Every operating model in an org (newest first). Powers the model
 * switcher. Returns [] on any failure (the caller falls back to the
 * single resolved model).
 */
export async function listOrgModels(organizationId) {
  if (!organizationId) return [];
  const sb = requireSupabase();
  if (!sb) return [];
  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/operating_models?organization_id=eq.${encodeURIComponent(organizationId)}` +
        `&select=id,name,status,created_at&order=created_at.asc`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    );
    return resp.ok ? await resp.json() : [];
  } catch (e) {
    logger.error('listOrgModels failed', { organizationId, error: e.message });
    return [];
  }
}

/**
 * Set (or clear, with modelId=null) the member's active operating
 * model. Caller MUST have already verified the model belongs to the
 * member's org. Matches the membership row by org + (user_id|email).
 * @returns {Promise<{ok:boolean}>}
 */
export async function setMemberPreferredModel({ organizationId, email, userId, modelId }) {
  if (!organizationId || (!email && !userId)) return { ok: false };
  const sb = requireSupabase();
  if (!sb) return { ok: false };
  const ors = [];
  if (userId) ors.push(`user_id.eq.${encodeURIComponent(userId)}`);
  if (email)  ors.push(`email.eq.${encodeURIComponent(String(email).toLowerCase())}`);
  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/organization_members?organization_id=eq.${encodeURIComponent(organizationId)}` +
        `&or=(${ors.join(',')})`,
      {
        method: 'PATCH',
        headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=minimal' },
        body: JSON.stringify({ preferred_operating_model_id: modelId || null }),
      },
    );
    return { ok: resp.ok };
  } catch (e) {
    logger.error('setMemberPreferredModel failed', { organizationId, error: e.message });
    return { ok: false };
  }
}

/**
 * Load the full model + functions + roles + systems + process count.
 *
 * Capabilities arrive flat and are nested into a tree before return.
 * Returns null if the model doesn't exist (or RLS blocks the read).
 */
export async function loadOperatingModel(modelId) {
  if (!modelId) return null;
  const sb = requireSupabase();
  if (!sb) return null;

  const headers = getSupabaseHeaders(sb.key);
  try {
    const [modelResp, capsResp, rolesResp, sysResp, procCountResp] = await Promise.all([
      fetchWithTimeout(
        `${sb.url}/rest/v1/operating_models?id=eq.${encodeURIComponent(modelId)}` +
          `&select=id,organization_id,name,kind,parent_model_id,status,description,settings,created_by_email,created_at,updated_at&limit=1`,
        { method: 'GET', headers },
      ),
      fetchWithTimeout(
        `${sb.url}/rest/v1/functions?operating_model_id=eq.${encodeURIComponent(modelId)}` +
          `&select=id,name,parent_function_id,layer,status,owner_email,description,order_index,created_at,updated_at` +
          `&order=parent_function_id.asc.nullsfirst,order_index.asc`,
        { method: 'GET', headers },
      ),
      fetchWithTimeout(
        `${sb.url}/rest/v1/model_roles?operating_model_id=eq.${encodeURIComponent(modelId)}` +
          `&select=id,name,headcount,owner_email,function_ids,description,created_at,updated_at&order=name.asc`,
        { method: 'GET', headers },
      ),
      fetchWithTimeout(
        `${sb.url}/rest/v1/model_systems?operating_model_id=eq.${encodeURIComponent(modelId)}` +
          `&select=id,name,vendor,category,layer,owner_email,description,match_key,created_at,updated_at&order=name.asc`,
        { method: 'GET', headers },
      ),
      // HEAD with Prefer: count=exact returns the total via Content-Range.
      // PostgREST also supports select=id with a HEAD-style read; we use
      // the same pattern as loadChanges for simplicity.
      fetchWithTimeout(
        `${sb.url}/rest/v1/processes?operating_model_id=eq.${encodeURIComponent(modelId)}&select=id`,
        { method: 'GET', headers: { ...headers, Prefer: 'count=exact' } },
      ),
    ]);

    if (!modelResp.ok) return null;
    const [model] = await modelResp.json();
    if (!model) return null;

    const capsFlat = capsResp.ok ? await capsResp.json() : [];
    const roles    = rolesResp.ok ? await rolesResp.json() : [];
    const systems  = sysResp.ok   ? await sysResp.json()   : [];

    let processCount = 0;
    if (procCountResp.ok) {
      const range = procCountResp.headers.get('content-range') || '';
      const total = range.split('/')[1];
      processCount = total && total !== '*' ? Number(total) : 0;
    }

    return {
      model,
      functions: nestFunctions(capsFlat),
      functionsFlat: capsFlat,
      roles,
      systems,
      processCount,
    };
  } catch (e) {
    logger.error('loadOperatingModel failed', { modelId, error: e.message });
    return null;
  }
}

/**
 * Take a flat array of capability rows and nest them by parent_function_id.
 * Top-level functions have parent_function_id = null and end up in the
 * returned root array. Each row gets a `children: []` array (recursive).
 *
 * Pure — exported for tests.
 */
export function nestFunctions(flat) {
  if (!Array.isArray(flat) || flat.length === 0) return [];
  const byId = new Map();
  for (const c of flat) byId.set(c.id, { ...c, children: [] });
  const roots = [];
  for (const c of flat) {
    const node = byId.get(c.id);
    if (c.parent_function_id && byId.has(c.parent_function_id)) {
      byId.get(c.parent_function_id).children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/**
 * Aggregate stats per capability: process count, summed FTE, annual cost.
 * Walks all diagnostic_reports + model_roles for the model. v1 reads the
 * existing JSONB shapes; a future migration will normalise these into a
 * proper join table.
 */
export async function loadModelRollup(modelId) {
  if (!modelId) return null;
  const sb = requireSupabase();
  if (!sb) return null;

  const headers = getSupabaseHeaders(sb.key);
  try {
    const [reportsResp, rolesResp, capsResp] = await Promise.all([
      fetchWithTimeout(
        // Living-workspace migration: total_annual_cost, potential_savings,
        // automation_percentage columns dropped. Cost / savings are now
        // derived on-the-fly from flow_data steps (TODO: compute here).
        `${sb.url}/rest/v1/processes?operating_model_id=eq.${encodeURIComponent(modelId)}` +
          `&select=id,function_id,flow_data`,
        { method: 'GET', headers },
      ),
      fetchWithTimeout(
        `${sb.url}/rest/v1/model_roles?operating_model_id=eq.${encodeURIComponent(modelId)}` +
          `&select=id,headcount,function_ids`,
        { method: 'GET', headers },
      ),
      fetchWithTimeout(
        `${sb.url}/rest/v1/functions?operating_model_id=eq.${encodeURIComponent(modelId)}` +
          `&select=id,name,parent_function_id`,
        { method: 'GET', headers },
      ),
    ]);

    const reports = reportsResp.ok ? await reportsResp.json() : [];
    const roles   = rolesResp.ok   ? await rolesResp.json()   : [];
    const caps    = capsResp.ok    ? await capsResp.json()    : [];

    // Living-workspace migration: derive cost / savings / automation from
    // flow_data so computeModelRollup's per-process accumulators keep
    // working without the dropped columns.
    for (const r of reports) attachDerivedMetrics(r);

    return computeModelRollup({ reports, roles, caps });
  } catch (e) {
    logger.error('loadModelRollup failed', { modelId, error: e.message });
    return null;
  }
}

/**
 * Pure aggregator — exported for tests. Takes raw rows, returns:
 *   {
 *     totals: { processes, fte, annualCost, potentialSavings, avgAutomationPct },
 *     byFunction: [{ functionId, name, processCount, fte, annualCost, ... }],
 *     unfiledProcesses: number,    // processes with no function_id
 *   }
 */
export function computeModelRollup({ reports, roles, caps }) {
  const funcsById = new Map((caps || []).map((c) => [c.id, c]));

  // Per-capability accumulators. "unfiled" bucket for processes without a
  // function_id (typical right after migration 37 backfill).
  const buckets = new Map(); // functionId|null → row
  const ensureBucket = (capId) => {
    if (!buckets.has(capId)) {
      const cap = capId ? funcsById.get(capId) : null;
      buckets.set(capId, {
        functionId: capId,
        name: cap?.name || (capId ? '(orphaned)' : '(unfiled)'),
        processCount: 0,
        fte: 0,
        annualCost: 0,
        potentialSavings: 0,
        automationPctSum: 0,
        automationPctCount: 0,
        stepMinutes: 0,
        stepCount: 0,
      });
    }
    return buckets.get(capId);
  };

  // Walk processes — sum cost + auto pct + count. Also walk steps to
  // accumulate stepMinutes per function (per-step functionId wins;
  // untagged steps fall back to the process owner). At the same pass we
  // record where each role's work actually lands (roleId → function →
  // minutes) so we can do step-driven FTE attribution further down.
  const roleUsage = new Map(); // roleId → { totalMinutes, perFunction: Map<funcId, mins> }
  const recordRoleStep = (roleId, funcId, mins) => {
    if (!roleId || !funcId || !(mins > 0)) return;
    if (!roleUsage.has(roleId)) {
      roleUsage.set(roleId, { totalMinutes: 0, perFunction: new Map() });
    }
    const u = roleUsage.get(roleId);
    u.totalMinutes += mins;
    u.perFunction.set(funcId, (u.perFunction.get(funcId) || 0) + mins);
  };

  for (const r of reports || []) {
    const b = ensureBucket(r.function_id || null);
    b.processCount += 1;
    if (r.total_annual_cost != null)    b.annualCost       += Number(r.total_annual_cost) || 0;
    if (r.potential_savings != null)    b.potentialSavings += Number(r.potential_savings) || 0;
    if (r.automation_percentage != null) {
      b.automationPctSum += Number(r.automation_percentage) || 0;
      b.automationPctCount += 1;
    }

    // Living-workspace migration: column renamed to flow_data. Accept
    // either shape so the in-flight rollup keeps working alongside
    // tests that still pass `diagnostic_data` as mock input.
    const dd = r.flow_data || r.diagnostic_data || {};
    const procs = Array.isArray(dd.rawProcesses) ? dd.rawProcesses
                : Array.isArray(dd.processes)    ? dd.processes
                : [];
    for (const proc of procs) {
      const steps = Array.isArray(proc?.steps) ? proc.steps : [];
      for (const step of steps) {
        const stepCapId = step?.functionId || step?.function_id || step?.capabilityId || step?.capability_id || r.function_id || null;
        const sb = ensureBucket(stepCapId);
        sb.stepCount += 1;
        const wm = Number(step?.workMinutes);
        if (Number.isFinite(wm) && wm > 0) sb.stepMinutes += wm;
        // Tally for step-driven FTE: roleId × functionId × minutes
        if (step?.roleId && stepCapId) recordRoleStep(step.roleId, stepCapId, Number.isFinite(wm) ? wm : 0);
      }
    }
  }

  // Walk roles — distribute headcount.
  //
  // Step-driven attribution: when a role's id appears on at least one
  // step (with workMinutes > 0), apportion that role's headcount across
  // functions by where the work actually happens. A 6-FTE Account Exec
  // whose steps are 200m in Pipeline + 100m in Sales contributes 4 FTE
  // to Pipeline and 2 FTE to Sales — coherent with the heatmap.
  //
  // Legacy fallback: when no steps cite the role (e.g. a role exists in
  // the inventory but isn't yet wired into any process), fall back to
  // an equal split across role.function_ids — same as before.
  let totalFte = 0;
  for (const role of roles || []) {
    const hc = Number(role.headcount) || 0;
    totalFte += hc;
    const usage = roleUsage.get(role.id);
    if (usage && usage.totalMinutes > 0) {
      for (const [funcId, mins] of usage.perFunction.entries()) {
        const share = mins / usage.totalMinutes;
        ensureBucket(funcId).fte += hc * share;
      }
      continue;
    }
    const caps = Array.isArray(role.function_ids) ? role.function_ids : [];
    if (!caps.length) continue;
    const each = hc / caps.length;
    for (const cid of caps) ensureBucket(cid).fte += each;
  }

  // Roll sub-function buckets up to their top-level parent so the
  // heatmap stays one-row-per-function. Sub-function granularity is now
  // available via the flow-canvas swimlane toggle (Sub-function /
  // Function), so duplicating it here just adds noise. The unfiled
  // bucket (functionId === null) stays as its own row.
  const topLevelOf = (capId) => {
    let cursor = capId ? funcsById.get(capId) : null;
    if (!cursor) return capId; // unfiled or orphan: treat as its own root
    while (cursor.parent_function_id && funcsById.has(cursor.parent_function_id)) {
      cursor = funcsById.get(cursor.parent_function_id);
    }
    return cursor.id;
  };

  const rolled = new Map(); // topLevelId|null -> bucket clone
  for (const b of buckets.values()) {
    const rootId = topLevelOf(b.functionId);
    if (!rolled.has(rootId)) {
      const root = rootId ? funcsById.get(rootId) : null;
      rolled.set(rootId, {
        functionId: rootId,
        name: root?.name || (rootId ? '(orphaned)' : '(unfiled)'),
        processCount: 0,
        stepCount: 0,
        stepMinutes: 0,
        fte: 0,
        annualCost: 0,
        potentialSavings: 0,
        automationPctSum: 0,
        automationPctCount: 0,
      });
    }
    const r = rolled.get(rootId);
    r.processCount       += b.processCount;
    r.stepCount          += b.stepCount;
    r.stepMinutes        += b.stepMinutes;
    r.fte                += b.fte;
    r.annualCost         += b.annualCost;
    r.potentialSavings   += b.potentialSavings;
    r.automationPctSum   += b.automationPctSum;
    r.automationPctCount += b.automationPctCount;
  }

  // Finalise: round derived numbers, compute average automation per bucket.
  // Sort top-level rows alphabetically; pin the (unfiled) row to the bottom.
  const byFunction = [...rolled.values()]
    .map((b) => ({
      functionId: b.functionId,
      name: b.name,
      processCount: b.processCount,
      stepCount: b.stepCount,
      stepMinutes: round2(b.stepMinutes),
      fte: round2(b.fte),
      annualCost: round2(b.annualCost),
      potentialSavings: round2(b.potentialSavings),
      avgAutomationPct: b.automationPctCount ? round2(b.automationPctSum / b.automationPctCount) : null,
    }))
    .sort((a, b) => {
      if (!a.functionId && b.functionId) return 1;
      if (a.functionId && !b.functionId) return -1;
      return (a.name || '').localeCompare(b.name || '');
    });

  const totals = {
    processes: (reports || []).length,
    fte: round2(totalFte),
    annualCost: round2(byFunction.reduce((s, b) => s + b.annualCost, 0)),
    potentialSavings: round2(byFunction.reduce((s, b) => s + b.potentialSavings, 0)),
    avgAutomationPct: (() => {
      const samples = (reports || []).filter((r) => r.automation_percentage != null);
      if (!samples.length) return null;
      return round2(samples.reduce((s, r) => s + (Number(r.automation_percentage) || 0), 0) / samples.length);
    })(),
  };

  return {
    totals,
    byFunction,
    unfiledProcesses: buckets.get(null)?.processCount || 0,
  };
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// ------------------------------------------------------------------
// Capability CRUD
// ------------------------------------------------------------------

export async function createCapability({
  operating_model_id, name, parent_function_id = null,
  layer = 'value_chain', status = 'live',
  owner_email = null, description = null, order_index = 0,
}) {
  if (!operating_model_id || !name) return null;
  const sb = requireSupabase();
  if (!sb) return null;

  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/functions?select=id`,
      {
        method: 'POST',
        headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=representation' },
        body: JSON.stringify([{
          operating_model_id,
          name: String(name).slice(0, 200),
          parent_function_id,
          layer, status,
          owner_email: owner_email ? String(owner_email).toLowerCase() : null,
          description: description ? String(description).slice(0, 4000) : null,
          order_index: Number(order_index) || 0,
        }]),
      },
    );
    if (!resp.ok) return null;
    const [row] = await resp.json().catch(() => []);
    return row?.id || null;
  } catch (e) {
    logger.error('createCapability failed', { error: e.message });
    return null;
  }
}

export async function updateCapability(functionId, patch) {
  if (!functionId || !patch) return { ok: false };
  const sb = requireSupabase();
  if (!sb) return { ok: false };

  const allowed = ['name', 'parent_function_id', 'layer', 'status', 'owner_email', 'description', 'order_index'];
  const body = {};
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, k)) body[k] = patch[k];
  }
  if (Object.keys(body).length === 0) return { ok: true };

  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/functions?id=eq.${encodeURIComponent(functionId)}`,
      {
        method: 'PATCH',
        headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=minimal' },
        body: JSON.stringify(body),
      },
    );
    return { ok: resp.ok };
  } catch (e) {
    logger.error('updateCapability failed', { functionId, error: e.message });
    return { ok: false };
  }
}

export async function deleteCapability(functionId) {
  if (!functionId) return { ok: false };
  const sb = requireSupabase();
  if (!sb) return { ok: false };

  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/functions?id=eq.${encodeURIComponent(functionId)}`,
      { method: 'DELETE', headers: getSupabaseWriteHeaders(sb.key) },
    );
    return { ok: resp.ok || resp.status === 204 };
  } catch (e) {
    logger.error('deleteCapability failed', { functionId, error: e.message });
    return { ok: false };
  }
}

// ------------------------------------------------------------------
// Roles + systems
// ------------------------------------------------------------------

const ROLE_PATCH_FIELDS = ['name', 'headcount', 'owner_email', 'function_ids', 'description'];

/** Coerce one role payload field into the shape the table expects. */
function coerceRoleField(key, val) {
  if (key === 'name')          return String(val || '').trim().slice(0, 200);
  if (key === 'headcount')     return Math.max(0, Math.floor(Number(val) || 0));
  if (key === 'owner_email')   return val ? String(val).toLowerCase() : null;
  if (key === 'function_ids') return Array.isArray(val) ? val : [];
  if (key === 'description')   return val ? String(val).slice(0, 4000) : null;
  return val;
}

export async function updateModelRole(roleId, patch) {
  if (!roleId || !patch) return { ok: false };
  const sb = requireSupabase();
  if (!sb) return { ok: false };

  const body = {};
  for (const k of ROLE_PATCH_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, k)) body[k] = coerceRoleField(k, patch[k]);
  }
  if (Object.keys(body).length === 0) return { ok: true };
  // name is required if supplied — empty strings would violate NOT NULL
  if ('name' in body && !body.name) return { ok: false, reason: 'name_required' };

  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/model_roles?id=eq.${encodeURIComponent(roleId)}`,
      {
        method: 'PATCH',
        headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=minimal' },
        body: JSON.stringify(body),
      },
    );
    return { ok: resp.ok };
  } catch (e) {
    logger.error('updateModelRole failed', { roleId, error: e.message });
    return { ok: false };
  }
}

export async function deleteModelRole(roleId) {
  if (!roleId) return { ok: false };
  const sb = requireSupabase();
  if (!sb) return { ok: false };
  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/model_roles?id=eq.${encodeURIComponent(roleId)}`,
      { method: 'DELETE', headers: getSupabaseWriteHeaders(sb.key) },
    );
    return { ok: resp.ok || resp.status === 204 };
  } catch (e) {
    logger.error('deleteModelRole failed', { roleId, error: e.message });
    return { ok: false };
  }
}

export async function createModelRole({
  operating_model_id, name, headcount = 1,
  owner_email = null, function_ids = [], description = null,
}) {
  if (!operating_model_id || !name) return null;
  const sb = requireSupabase();
  if (!sb) return null;

  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/model_roles?select=id`,
      {
        method: 'POST',
        headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=representation' },
        body: JSON.stringify([{
          operating_model_id,
          name: String(name).slice(0, 200),
          headcount: Math.max(0, Math.floor(Number(headcount) || 0)),
          owner_email: owner_email ? String(owner_email).toLowerCase() : null,
          function_ids: Array.isArray(function_ids) ? function_ids : [],
          description: description ? String(description).slice(0, 4000) : null,
        }]),
      },
    );
    if (!resp.ok) return null;
    const [row] = await resp.json().catch(() => []);
    return row?.id || null;
  } catch (e) {
    logger.error('createModelRole failed', { error: e.message });
    return null;
  }
}

const SYSTEM_PATCH_FIELDS = ['name', 'vendor', 'category', 'layer', 'owner_email', 'description'];
const VALID_SYSTEM_LAYERS = new Set(['system_of_record', 'productivity', 'workflow', 'analytics', 'comms', 'other']);

function coerceSystemField(key, val) {
  if (key === 'name')        return String(val || '').trim().slice(0, 200);
  if (key === 'vendor')      return val ? String(val).slice(0, 200) : null;
  if (key === 'category')    return val ? String(val).slice(0, 80)  : null;
  if (key === 'layer')       return VALID_SYSTEM_LAYERS.has(val) ? val : 'other';
  if (key === 'owner_email') return val ? String(val).toLowerCase() : null;
  if (key === 'description') return val ? String(val).slice(0, 4000) : null;
  return val;
}

export async function updateModelSystem(systemId, patch) {
  if (!systemId || !patch) return { ok: false };
  const sb = requireSupabase();
  if (!sb) return { ok: false };

  const body = {};
  for (const k of SYSTEM_PATCH_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, k)) body[k] = coerceSystemField(k, patch[k]);
  }
  if (Object.keys(body).length === 0) return { ok: true };
  if ('name' in body && !body.name) return { ok: false, reason: 'name_required' };

  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/model_systems?id=eq.${encodeURIComponent(systemId)}`,
      {
        method: 'PATCH',
        headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=minimal' },
        body: JSON.stringify(body),
      },
    );
    return { ok: resp.ok };
  } catch (e) {
    logger.error('updateModelSystem failed', { systemId, error: e.message });
    return { ok: false };
  }
}

export async function deleteModelSystem(systemId) {
  if (!systemId) return { ok: false };
  const sb = requireSupabase();
  if (!sb) return { ok: false };
  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/model_systems?id=eq.${encodeURIComponent(systemId)}`,
      { method: 'DELETE', headers: getSupabaseWriteHeaders(sb.key) },
    );
    return { ok: resp.ok || resp.status === 204 };
  } catch (e) {
    logger.error('deleteModelSystem failed', { systemId, error: e.message });
    return { ok: false };
  }
}

export async function createModelSystem({
  operating_model_id, name, vendor = null, category = null,
  layer = 'other', owner_email = null, description = null,
}) {
  if (!operating_model_id || !name) return null;
  const sb = requireSupabase();
  if (!sb) return null;

  try {
    const resp = await fetchWithTimeout(
      // ON CONFLICT (operating_model_id, match_key) — names collide
      // intentionally so adding "Salesforce" twice doesn't dupe.
      `${sb.url}/rest/v1/model_systems?on_conflict=operating_model_id,match_key&select=id`,
      {
        method: 'POST',
        headers: {
          ...getSupabaseWriteHeaders(sb.key),
          Prefer: 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify([{
          operating_model_id,
          name: String(name).slice(0, 200),
          vendor: vendor ? String(vendor).slice(0, 200) : null,
          category: category ? String(category).slice(0, 80) : null,
          layer,
          owner_email: owner_email ? String(owner_email).toLowerCase() : null,
          description: description ? String(description).slice(0, 4000) : null,
        }]),
      },
    );
    if (!resp.ok) return null;
    const [row] = await resp.json().catch(() => []);
    if (!row?.id) return null;

    // Auto-relink existing process_systems rows that already mention this
    // system by name. Without this, every existing step.systems[] mention
    // would stay "unlinked" until the next save touched its parent report.
    // Matches by lower(name) → row.match_key.
    try {
      const matchKey = String(name).trim().toLowerCase();
      await fetchWithTimeout(
        `${sb.url}/rest/v1/process_systems?` +
          `operating_model_id=eq.${encodeURIComponent(operating_model_id)}` +
          `&match_key=eq.${encodeURIComponent(matchKey)}` +
          `&system_id=is.null`,
        {
          method: 'PATCH',
          headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=minimal' },
          body: JSON.stringify({ system_id: row.id }),
        },
      );
    } catch (relinkErr) {
      // Non-fatal — the system row exists, future inserts will link
      // correctly via the syncProcessSystemsForReport pre-fetch.
      logger.warn('createModelSystem: relink existing process_systems failed', {
        systemId: row.id, error: relinkErr.message,
      });
    }
    return row.id;
  } catch (e) {
    logger.error('createModelSystem failed', { error: e.message });
    return null;
  }
}

// ------------------------------------------------------------------
// Process anchoring + design surface
// ------------------------------------------------------------------

/**
 * Bind a diagnostic_report to a (model, capability) pair. Either field can
 * be null to clear; pass both to attach.
 */
export async function attachProcessToModel({
  reportId, operating_model_id = undefined,
  function_id = undefined,
  // Living-workspace migration: design_owner_email column dropped.
  // Accepted as a kwarg for API back-compat but silently ignored.
  design_owner_email: _designOwnerEmail = undefined,
}) {
  if (!reportId) return { ok: false };
  const sb = requireSupabase();
  if (!sb) return { ok: false };

  const patch = {};
  if (operating_model_id !== undefined) patch.operating_model_id = operating_model_id || null;
  if (function_id !== undefined)      patch.function_id      = function_id || null;
  if (Object.keys(patch).length === 0) return { ok: true };

  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/processes?id=eq.${encodeURIComponent(reportId)}`,
      {
        method: 'PATCH',
        headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=minimal' },
        body: JSON.stringify(patch),
      },
    );
    return { ok: resp.ok };
  } catch (e) {
    logger.error('attachProcessToModel failed', { reportId, error: e.message });
    return { ok: false };
  }
}

/* ── Capability name aliases ───────────────────────────────────────
   The capability CRUD API routes import {createFunction, updateFunction,
   deleteFunction}; the historical repo names are *Capability. Export both
   so the routes (and the chat agent's propose_*_function tools) resolve.
   Without these the function routes import `undefined` and 500 at call
   time — a latent bug surfaced by the agent-coverage audit. */
export {
  createCapability as createFunction,
  updateCapability as updateFunction,
  deleteCapability as deleteFunction,
};

// ------------------------------------------------------------------
// Process lifecycle (create / duplicate / delete within a model)
// ------------------------------------------------------------------

/**
 * Mint a new, empty process anchored to an operating model. The caller
 * (API route) has already authorised the user against the model; we
 * record them as contact_email (owner) so the existing edit path
 * (/api/update-diagnostic, which checks contact_email) lets them edit it.
 *
 * @returns {Promise<{ok:boolean,id?:string}>}
 */
export async function createModelProcess({ modelId, name, functionId = null, ownerEmail }) {
  if (!modelId || !name || !ownerEmail) return { ok: false };
  const sb = requireSupabase();
  if (!sb) return { ok: false };
  const id = randomUUID();
  const nowIso = new Date().toISOString();
  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/processes`,
      {
        method: 'POST',
        headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=minimal' },
        body: JSON.stringify({
          id,
          operating_model_id: modelId,
          function_id: functionId || null,
          contact_email: String(ownerEmail).toLowerCase(),
          contact_name: '',
          company: '',
          flow_data: { rawProcesses: [{ name: String(name).slice(0, 200), definition: '', steps: [] }] },
          created_at: nowIso,
          updated_at: nowIso,
        }),
      },
    );
    return { ok: resp.ok || resp.status === 201, id };
  } catch (e) {
    logger.error('createModelProcess failed', { modelId, error: e.message });
    return { ok: false };
  }
}

/**
 * Deep-copy an existing in-model process into a new row. Source must
 * belong to the model (defence in depth on top of the route's check).
 *
 * @returns {Promise<{ok:boolean,id?:string}>}
 */
export async function duplicateModelProcess({ modelId, sourceId, newName, ownerEmail }) {
  if (!modelId || !sourceId || !ownerEmail) return { ok: false };
  const sb = requireSupabase();
  if (!sb) return { ok: false };
  try {
    const readResp = await fetchWithTimeout(
      `${sb.url}/rest/v1/processes?id=eq.${encodeURIComponent(sourceId)}` +
        `&operating_model_id=eq.${encodeURIComponent(modelId)}` +
        `&select=flow_data,function_id,company&limit=1`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    );
    if (!readResp.ok) return { ok: false };
    const [src] = await readResp.json().catch(() => []);
    if (!src) return { ok: false };

    const flow = JSON.parse(JSON.stringify(src.flow_data || {}));
    if (Array.isArray(flow.rawProcesses) && flow.rawProcesses[0]) {
      flow.rawProcesses[0].name = String(newName || `${flow.rawProcesses[0].name || 'Process'} (copy)`).slice(0, 200);
    }
    const id = randomUUID();
    const nowIso = new Date().toISOString();
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/processes`,
      {
        method: 'POST',
        headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=minimal' },
        body: JSON.stringify({
          id,
          operating_model_id: modelId,
          function_id: src.function_id || null,
          contact_email: String(ownerEmail).toLowerCase(),
          contact_name: '',
          company: src.company || '',
          flow_data: flow,
          created_at: nowIso,
          updated_at: nowIso,
        }),
      },
    );
    return { ok: resp.ok || resp.status === 201, id };
  } catch (e) {
    logger.error('duplicateModelProcess failed', { modelId, sourceId, error: e.message });
    return { ok: false };
  }
}

/**
 * Hard-delete a process, scoped to the model so a caller can never
 * delete a process outside the model they were authorised against.
 *
 * @returns {Promise<{ok:boolean}>}
 */
export async function deleteModelProcess({ modelId, processId }) {
  if (!modelId || !processId) return { ok: false };
  const sb = requireSupabase();
  if (!sb) return { ok: false };
  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/processes?id=eq.${encodeURIComponent(processId)}` +
        `&operating_model_id=eq.${encodeURIComponent(modelId)}`,
      { method: 'DELETE', headers: getSupabaseWriteHeaders(sb.key) },
    );
    return { ok: resp.ok || resp.status === 204 };
  } catch (e) {
    logger.error('deleteModelProcess failed', { modelId, processId, error: e.message });
    return { ok: false };
  }
}

/**
 * Living-workspace migration: target_data + state_kind columns are
 * dropped. A process is now a single living thing — no "target" state
 * to write, no "promote" event. These functions are kept as stubs so
 * remaining callers don't crash; they return { ok: false, gone: true }.
 */
export async function setProcessTarget({ reportId }) {
  logger.warn('setProcessTarget called after migration — no-op', { reportId });
  return { ok: false, gone: true };
}

export async function promoteTargetToCurrent({ reportId }) {
  logger.warn('promoteTargetToCurrent called after migration — no-op', { reportId });
  return { ok: false, gone: true };
  // Legacy body below kept for reference, never reached.
  // eslint-disable-next-line no-unreachable
  try {
    const sb = requireSupabase();
    if (!sb) return { ok: false };
    const [row] = [null];
    if (!row) return { ok: false };
    const { ids } = await recordChanges([{
      subject_type: 'process',
      subject_ref: { report_id: reportId },
      kind: 'modified',
      state: 'applied',
      before_state: {},
      after_state:  {},
      rationale: 'Promoted designed target state to current.',
      report_id: reportId,
      actor_kind: 'system',
      actor_email: null,
      agent_name: 'workspace',
    }]);

    return { ok: true, change_id: ids?.[0] || null };
  } catch (e) {
    logger.error('promoteTargetToCurrent failed', { reportId, error: e.message });
    return { ok: false };
  }
}
