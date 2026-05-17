/**
 * operatingModel/artefacts — CRUD for the workspace "Artefacts" panel.
 *
 * `workspace_artefacts` rows are deliberately schema-light: a free-text
 * `type`, a `title`, a string `content`, and a jsonb `meta`. Nothing
 * here touches capabilities/processes/roles — an artefact is the agent
 * producing something that has no home in the canonical model schema
 * (a table, a doc, a query, a diagram), parked for the user to read.
 *
 * Used from two places:
 *   - the chat executor (server-side, service-role) when the agent
 *     calls the emit_artefact tool;
 *   - the API route behind the Artefacts tab (list / delete / rename).
 *
 * Writes are always scoped by operating_model_id so a caller can't
 * touch another model's artefacts.
 */

import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase,
} from '../api-helpers.js';
import { logger } from '../logger.js';

const SELECT =
  'id,operating_model_id,session_id,type,title,content,language,source,meta,created_by_email,created_at,updated_at';

/** List every artefact for a model, newest first. */
export async function listArtefacts(modelId, { limit = 200 } = {}) {
  if (!modelId) return [];
  const sb = requireSupabase();
  if (!sb) return [];
  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/workspace_artefacts?operating_model_id=eq.${encodeURIComponent(modelId)}` +
        `&select=${encodeURIComponent(SELECT)}&order=created_at.desc&limit=${Math.min(Number(limit) || 200, 500)}`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    );
    if (!resp.ok) return [];
    return await resp.json();
  } catch (e) {
    logger.error('listArtefacts failed', { modelId, error: e.message });
    return [];
  }
}

/**
 * Create an artefact. `content` is stored as-is (always a string);
 * table/json/csv types carry a serialised string the viewer parses.
 * Returns the new row, or null on failure.
 */
export async function createArtefact({
  operating_model_id, session_id = null, type = 'markdown',
  title = null, content = '', language = null, source = 'agent',
  meta = {}, created_by_email = null,
}) {
  if (!operating_model_id) return null;
  const sb = requireSupabase();
  if (!sb) return null;

  const row = {
    operating_model_id,
    session_id: session_id || null,
    type: String(type || 'markdown').slice(0, 40),
    title: title ? String(title).slice(0, 200) : null,
    content: typeof content === 'string' ? content : JSON.stringify(content ?? ''),
    language: language ? String(language).slice(0, 40) : null,
    source: source === 'user' ? 'user' : 'agent',
    meta: meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {},
    created_by_email: created_by_email ? String(created_by_email).toLowerCase() : null,
  };

  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/workspace_artefacts?select=${encodeURIComponent(SELECT)}`,
      {
        method: 'POST',
        headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=representation' },
        body: JSON.stringify([row]),
      },
    );
    if (!resp.ok) return null;
    const [created] = await resp.json().catch(() => []);
    return created || null;
  } catch (e) {
    logger.error('createArtefact failed', { error: e.message });
    return null;
  }
}

/** Fetch one artefact row, scoped by modelId. Null if not found. */
export async function getArtefact(modelId, artefactId) {
  if (!modelId || !artefactId) return null;
  const sb = requireSupabase();
  if (!sb) return null;
  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/workspace_artefacts?id=eq.${encodeURIComponent(artefactId)}` +
        `&operating_model_id=eq.${encodeURIComponent(modelId)}` +
        `&select=${encodeURIComponent(SELECT)}&limit=1`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    );
    if (!resp.ok) return null;
    const [row] = await resp.json();
    return row || null;
  } catch (e) {
    logger.error('getArtefact failed', { artefactId, error: e.message });
    return null;
  }
}

/**
 * Patch an artefact's title (rename from the panel). Scoped by modelId
 * so a caller can't rename another model's row with a guessed id.
 */
export async function updateArtefact(modelId, artefactId, patch = {}) {
  if (!modelId || !artefactId) return { ok: false };
  const sb = requireSupabase();
  if (!sb) return { ok: false };

  const next = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'title')) {
    next.title = patch.title ? String(patch.title).slice(0, 200) : null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'meta')
      && patch.meta && typeof patch.meta === 'object' && !Array.isArray(patch.meta)) {
    next.meta = patch.meta;
  }
  if (Object.keys(next).length === 0) return { ok: true };
  next.updated_at = new Date().toISOString();

  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/workspace_artefacts?id=eq.${encodeURIComponent(artefactId)}` +
        `&operating_model_id=eq.${encodeURIComponent(modelId)}`,
      { method: 'PATCH', headers: getSupabaseWriteHeaders(sb.key), body: JSON.stringify(next) },
    );
    return { ok: resp.ok };
  } catch (e) {
    logger.error('updateArtefact failed', { artefactId, error: e.message });
    return { ok: false };
  }
}

/**
 * Delete an artefact, scoped by modelId. Also removes the backing
 * Storage object for office binaries so deleted artefacts don't leave
 * orphaned files (cost + GDPR). Storage delete is best-effort and
 * happens BEFORE the row delete so we still have the meta pointer.
 */
export async function deleteArtefact(modelId, artefactId) {
  if (!modelId || !artefactId) return { ok: false };
  const sb = requireSupabase();
  if (!sb) return { ok: false };
  try {
    const row = await getArtefact(modelId, artefactId);
    const path = row?.meta?.file?.path;
    if (path) await deleteArtefactFile(path);
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/workspace_artefacts?id=eq.${encodeURIComponent(artefactId)}` +
        `&operating_model_id=eq.${encodeURIComponent(modelId)}`,
      { method: 'DELETE', headers: getSupabaseWriteHeaders(sb.key) },
    );
    return { ok: resp.ok };
  } catch (e) {
    logger.error('deleteArtefact failed', { artefactId, error: e.message });
    return { ok: false };
  }
}

/* ── Binary artefact files (Office docs) ───────────────────────────
 * Office-skill artefacts are binaries — they live in a private
 * Supabase Storage bucket, not in workspace_artefacts.content. The
 * object path is keyed by model + artefact id so it inherits the
 * same scoping; the row's meta carries the pointer.
 */

export const ARTEFACT_BUCKET = 'workspace-artefacts';

function storagePath(modelId, artefactId, ext) {
  return `${modelId}/${artefactId}.${String(ext || 'bin').replace(/[^a-z0-9]/gi, '')}`;
}

/** Upload bytes to the artefact bucket (service-role). Returns the object path or null. */
export async function uploadArtefactFile(modelId, artefactId, ext, bytes, contentType) {
  if (!modelId || !artefactId || !bytes) return null;
  const sb = requireSupabase();
  if (!sb) return null;
  const path = storagePath(modelId, artefactId, ext);
  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/storage/v1/object/${ARTEFACT_BUCKET}/${path}`,
      {
        method: 'POST',
        headers: {
          apikey: sb.key,
          Authorization: `Bearer ${sb.key}`,
          'Content-Type': contentType || 'application/octet-stream',
          'x-upsert': 'true',
        },
        body: bytes,
      },
      30000,
    );
    if (!resp.ok) {
      logger.error('uploadArtefactFile failed', { artefactId, status: resp.status });
      return null;
    }
    return path;
  } catch (e) {
    logger.error('uploadArtefactFile error', { artefactId, error: e.message });
    return null;
  }
}

/** Stream a stored artefact file back (service-role). Returns { bytes, contentType } or null. */
export async function downloadArtefactFile(path) {
  if (!path) return null;
  const sb = requireSupabase();
  if (!sb) return null;
  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/storage/v1/object/${ARTEFACT_BUCKET}/${encodeURI(path)}`,
      { method: 'GET', headers: { apikey: sb.key, Authorization: `Bearer ${sb.key}` } },
      30000,
    );
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    return { bytes: buf, contentType: resp.headers.get('content-type') || 'application/octet-stream' };
  } catch (e) {
    logger.error('downloadArtefactFile error', { error: e.message });
    return null;
  }
}

/** Delete a stored artefact object (service-role). Best-effort. */
export async function deleteArtefactFile(path) {
  if (!path) return false;
  const sb = requireSupabase();
  if (!sb) return false;
  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/storage/v1/object/${ARTEFACT_BUCKET}/${encodeURI(path)}`,
      { method: 'DELETE', headers: { apikey: sb.key, Authorization: `Bearer ${sb.key}` } },
      15000,
    );
    return resp.ok;
  } catch (e) {
    logger.warn('deleteArtefactFile error', { error: e.message });
    return false;
  }
}

/**
 * GDPR erasure: for every artefact a user created, delete its backing
 * Storage object and redact the creator email on the row. The row
 * itself is kept (the org's workspace continues, mirroring how
 * processes/sessions are anonymised, not deleted) but the user's
 * generated binary — which may carry personal/client data with no
 * clean separation — is removed. Returns the count of rows touched.
 */
export async function purgeArtefactsForUser(email, redactTo = '[redacted-deleted-account]') {
  const e = (email || '').toLowerCase().trim();
  if (!e) return 0;
  const sb = requireSupabase();
  if (!sb) return 0;
  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/workspace_artefacts?created_by_email=eq.${encodeURIComponent(e)}` +
        `&select=id,meta`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    );
    if (!resp.ok) return 0;
    const rows = await resp.json();
    for (const r of rows) {
      const path = r?.meta?.file?.path;
      if (path) await deleteArtefactFile(path);
    }
    // Redact the creator email + drop any file pointer in one bulk PATCH.
    await fetchWithTimeout(
      `${sb.url}/rest/v1/workspace_artefacts?created_by_email=eq.${encodeURIComponent(e)}`,
      {
        method: 'PATCH',
        headers: { ...getSupabaseWriteHeaders(sb.key), 'Content-Type': 'application/json' },
        body: JSON.stringify({ created_by_email: redactTo }),
      },
    );
    return rows.length;
  } catch (err) {
    logger.error('purgeArtefactsForUser failed', { error: err.message });
    return 0;
  }
}
