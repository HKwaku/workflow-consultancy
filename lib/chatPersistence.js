/**
 * Chat persistence + session context.
 *
 * Two responsibilities:
 *   1. Write/read `chat_sessions` + `chat_messages` via the service-role client.
 *   2. Build a compact "session context" block for the system prompt so Reina
 *      remembers prior processes/redesigns this user has worked on.
 *
 * Called from:
 *   - /api/chat-messages (append)
 *   - /api/chat-sessions (list, search, patch)
 *   - /api/diagnostic-chat (context injection before the agent loop)
 */

import { getSupabaseAdmin } from './supabase.js';

const SESSION_CONTEXT_LIMIT = 5;

function isMissingColumn(err, column) {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return msg.includes(column.toLowerCase()) && (msg.includes('column') || msg.includes('does not exist') || msg.includes('schema cache'));
}

async function insertSession(sb, row) {
  let r = await sb.from('chat_sessions').insert(row).select('id').single();
  if (r.error && isMissingColumn(r.error, 'process_snapshot')) {
    const { process_snapshot, ...rest } = row; // eslint-disable-line no-unused-vars
    r = await sb.from('chat_sessions').insert(rest).select('id').single();
  }
  return r;
}

async function updateSession(sb, id, patch) {
  let r = await sb.from('chat_sessions').update(patch).eq('id', id);
  if (r.error && isMissingColumn(r.error, 'process_snapshot')) {
    const { process_snapshot, ...rest } = patch; // eslint-disable-line no-unused-vars
    r = await sb.from('chat_sessions').update(rest).eq('id', id);
  }
  return r;
}

export async function upsertChatSession({ sessionId, userId, email, reportId, kind, title, processSnapshot }) {
  const sb = getSupabaseAdmin();
  const payload = {
    user_id: userId || null,
    email: (email || '').toLowerCase().trim(),
    report_id: reportId || null,
    kind: kind || 'map',
    title: title || null,
  };
  if (processSnapshot !== undefined) payload.process_snapshot = processSnapshot;
  if (sessionId) {
    // Upsert by id — if the row already exists refresh title/snapshot only
    // when explicitly sent (don't clobber good data with null).
    const { data: existing } = await sb
      .from('chat_sessions')
      .select('id,title')
      .eq('id', sessionId)
      .maybeSingle();
    if (existing) {
      const patch = {};
      if (title && title !== existing.title) patch.title = title;
      if (processSnapshot !== undefined) patch.process_snapshot = processSnapshot;
      if (reportId) patch.report_id = reportId;
      if (Object.keys(patch).length) {
        await updateSession(sb, sessionId, patch);
      }
      return existing.id;
    }
    const { data, error } = await insertSession(sb, { id: sessionId, ...payload });
    if (error) throw new Error(`chat_sessions insert failed: ${error.message}`);
    return data.id;
  }
  const { data, error } = await insertSession(sb, payload);
  if (error) throw new Error(`chat_sessions insert failed: ${error.message}`);
  return data.id;
}

export async function getChatSession(sessionId) {
  if (!sessionId) return null;
  const sb = getSupabaseAdmin();
  // Try with process_snapshot first. If the column hasn't been created yet
  // (migration-chat-snapshot.sql not run) fall back to the base columns so
  // resume still works without the workspace snapshot.
  const full = await sb
    .from('chat_sessions')
    .select('id,report_id,kind,title,summary,process_snapshot,last_message_at,message_count,pinned,archived,created_at,updated_at')
    .eq('id', sessionId)
    .maybeSingle();
  if (!full.error) return full.data || null;
  const fallback = await sb
    .from('chat_sessions')
    .select('id,report_id,kind,title,summary,last_message_at,message_count,pinned,archived,created_at,updated_at')
    .eq('id', sessionId)
    .maybeSingle();
  if (fallback.error) throw new Error(`chat_sessions fetch failed: ${fallback.error.message}`);
  return fallback.data || null;
}

export async function appendChatMessage({ sessionId, role, content, actions, suggestions, attachments }) {
  if (!sessionId) throw new Error('sessionId required');
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from('chat_messages')
    .insert({
      session_id: sessionId,
      role,
      content: content || '',
      actions: actions || null,
      suggestions: suggestions || null,
      attachments: attachments || null,
    })
    .select('id,created_at')
    .single();
  if (error) throw new Error(`chat_messages insert failed: ${error.message}`);
  return data;
}

export async function listChatSessions({ email, userId, search, status = 'all', limit = 50, offset = 0 }) {
  const sb = getSupabaseAdmin();
  const emailLower = (email || '').toLowerCase().trim();
  let q = sb
    .from('chat_sessions')
    .select('id,report_id,kind,title,summary,last_message,last_message_at,message_count,pinned,starred,archived,created_at,updated_at')
    .order('pinned', { ascending: false })
    .order('updated_at', { ascending: false })
    .range(offset, offset + Math.min(limit, 100) - 1);

  if (userId) {
    q = q.or(`user_id.eq.${userId},email.eq.${emailLower}`);
  } else if (emailLower) {
    q = q.eq('email', emailLower);
  } else {
    return [];
  }

  if (status === 'pinned') q = q.eq('pinned', true);
  else if (status === 'archived') q = q.eq('archived', true);
  else if (status === 'starred') q = q.eq('starred', true);
  else q = q.eq('archived', false);

  if (search && search.trim()) {
    const term = search.trim().replace(/[%_]/g, '\\$&');
    q = q.or(`title.ilike.%${term}%,last_message.ilike.%${term}%,summary.ilike.%${term}%`);
  }

  const { data, error } = await q;
  if (error) throw new Error(`chat_sessions list failed: ${error.message}`);
  return data || [];
}

export async function fetchMessagesForSession(sessionId, { limit = 200 } = {}) {
  if (!sessionId) return [];
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from('chat_messages')
    .select('id,role,content,actions,suggestions,attachments,created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(Math.min(limit, 500));
  if (error) throw new Error(`chat_messages fetch failed: ${error.message}`);
  return data || [];
}

export async function patchChatSession(sessionId, patch) {
  const sb = getSupabaseAdmin();
  const allowed = ['title', 'summary', 'pinned', 'starred', 'archived'];
  const clean = {};
  for (const k of allowed) if (k in patch) clean[k] = patch[k];
  // Accept processSnapshot (client-side) → process_snapshot (db column).
  if ('processSnapshot' in patch) clean.process_snapshot = patch.processSnapshot;
  else if ('process_snapshot' in patch) clean.process_snapshot = patch.process_snapshot;
  if (!Object.keys(clean).length) return null;
  const result = await updateSession(sb, sessionId, clean);
  if (result.error) throw new Error(`chat_sessions update failed: ${result.error.message}`);
  return { id: sessionId };
}

export async function deleteChatSession(sessionId) {
  const sb = getSupabaseAdmin();
  const { error } = await sb.from('chat_sessions').delete().eq('id', sessionId);
  if (error) throw new Error(`chat_sessions delete failed: ${error.message}`);
}

/* ── Session context block ────────────────────────────────────────────
 *
 * Pulls the N most recent diagnostic_reports + chat_sessions for this
 * user and returns a short text block the system prompt can inject.
 * Kept under ~600 tokens so we don't blow the per-turn budget.
 */
export async function buildSessionContext({ email, userId, excludeReportId }) {
  const emailLower = (email || '').toLowerCase().trim();
  if (!emailLower && !userId) return null;

  const sb = getSupabaseAdmin();
  const reportQuery = sb
    .from('diagnostic_reports')
    .select('id,company,contact_name,diagnostic_data,total_annual_cost,potential_savings,automation_percentage,created_at')
    .order('created_at', { ascending: false })
    .limit(SESSION_CONTEXT_LIMIT);

  if (userId) reportQuery.or(`user_id.eq.${userId},contact_email.eq.${emailLower}`);
  else reportQuery.eq('contact_email', emailLower);

  const [{ data: reports }, { data: sessions }] = await Promise.all([
    reportQuery,
    sb
      .from('chat_sessions')
      .select('id,kind,title,summary,last_message_at')
      .or(userId ? `user_id.eq.${userId},email.eq.${emailLower}` : `email.eq.${emailLower}`)
      .eq('archived', false)
      .order('updated_at', { ascending: false })
      .limit(SESSION_CONTEXT_LIMIT),
  ]);

  const lines = [];

  const filteredReports = (reports || []).filter((r) => r.id !== excludeReportId).slice(0, SESSION_CONTEXT_LIMIT);
  if (filteredReports.length) {
    lines.push('Prior processes this user has mapped:');
    for (const r of filteredReports) {
      const d = r.diagnostic_data || {};
      const name = d.processes?.[0]?.name || d.rawProcesses?.[0]?.processName || 'Untitled process';
      const bits = [name];
      if (r.company) bits.push(r.company);
      if (r.automation_percentage != null) bits.push(`${r.automation_percentage}% automation`);
      if (r.potential_savings) bits.push(`£${Math.round(r.potential_savings / 1000)}k savings`);
      lines.push(`  • ${bits.join(' — ')}`);
    }
  }

  const filteredSessions = (sessions || []).slice(0, SESSION_CONTEXT_LIMIT);
  if (filteredSessions.length) {
    lines.push('Recent conversations:');
    for (const s of filteredSessions) {
      const label = s.title || s.summary || `Untitled ${s.kind}`;
      lines.push(`  • [${s.kind}] ${label.slice(0, 100)}`);
    }
  }

  if (!lines.length) return null;
  return lines.join('\n');
}
