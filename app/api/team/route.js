import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, stripEmDashes, requireSupabase, checkOrigin, getRequestId } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { TeamGapAnalysisSchema, TeamCreateSchema, TeamSubmitSchema, TeamInviteSchema, TeamCloseSchema, TeamDeleteSchema, TeamAnalyzeSchema } from '@/lib/ai-schemas';
import { invokeStructured } from '@/lib/agents/structured-output';
import { get, set } from '@/lib/agents/ai-cache';
import { triggerWebhook } from '@/lib/triggerWebhook';
import { teamAnalysisSystemPrompt, teamAnalysisUserPrompt } from '@/lib/prompts';
import { getFastModel } from '@/lib/agents/models';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';

const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024; // 2MB

export async function POST(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

  const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > MAX_PAYLOAD_BYTES) return NextResponse.json({ error: 'Request body too large.' }, { status: 413 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  const sp = request.nextUrl.searchParams;
  const action = sp.get('action') || '';

  switch (action) {
    case 'create': return createTeam(body, request);
    case 'invite': return inviteMembers(body, request);
    case 'submit': return submitResponse(body, request);
    case 'close': return closeTeam(body, request);
    case 'delete': return deleteTeam(body, request);
    case 'analyze': return analyzeGaps(body, request);
    default: return NextResponse.json({ error: 'Missing or invalid action. Use ?action=create, ?action=invite, ?action=submit, ?action=close, ?action=delete, or ?action=analyze' }, { status: 400 });
  }
}

export async function GET(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });
  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });
  const sp = request.nextUrl.searchParams;
  const action = sp.get('action') || 'results';
  if (action === 'results') return getResults(request);
  if (action === 'info') return getTeamInfo(request);
  return NextResponse.json({ error: 'Use ?action=results&code=xxx or ?action=info&code=xxx' }, { status: 400 });
}

function buildBaseUrl(request) {
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

const TEAM_CODE_REGEX = /^[a-zA-Z0-9]{4,12}$/;
function isValidTeamCode(c) { return typeof c === 'string' && c.trim().length >= 4 && c.length <= 12 && TEAM_CODE_REGEX.test(c); }

async function getTeamInfo(request) {
  try {
    const code = request.nextUrl.searchParams.get('code');
    if (!code || !isValidTeamCode(code)) return NextResponse.json({ error: 'Valid team code required (4-12 alphanumeric). Use ?action=info&code=xxx' }, { status: 400 });

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    const resp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/team_diagnostics?team_code=eq.${encodeURIComponent(code)}&select=id,process_name,company,status`, { method: 'GET', headers: getSupabaseHeaders(supabaseKey) });
    let rows;
    try { rows = await resp.json(); } catch (e) { logger.error('Get team info: Supabase parse error', { requestId: getRequestId(request), error: e.message }); return NextResponse.json({ error: 'Failed to fetch team.' }, { status: 502 }); }
    if (!rows || rows.length === 0) return NextResponse.json({ error: 'Team alignment session not found.' }, { status: 404 });
    const t = rows[0];
    if (t.status === 'closed') return NextResponse.json({ error: 'This team alignment session is closed.' }, { status: 400 });

    return NextResponse.json({ success: true, processName: t.process_name, company: t.company });
  } catch (error) {
    logger.error('Get team info error', { requestId: getRequestId(request), error: error.message, stack: error.stack });
    return NextResponse.json({ error: 'Failed to fetch team info.' }, { status: 500 });
  }
}

async function createTeam(body, request) {
  try {
    const parsed = TeamCreateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid input. Process name is required (max 200 chars).' }, { status: 400 });
    const { createdByEmail, createdByName, processName, company, description } = parsed.data;

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    const teamId = crypto.randomUUID();
    const teamCode = crypto.randomBytes(5).toString('hex').toUpperCase();
    const baseUrl = buildBaseUrl(request);
    const joinUrl = `${baseUrl}/process-audit?team=${teamCode}`;
    const resultsUrl = `${baseUrl}/team-results?code=${teamCode}`;

    const payload = { id: teamId, team_code: teamCode, created_by_email: createdByEmail || null, created_by_name: createdByName || null, process_name: processName, company: company || null, description: description || null, status: 'open', created_at: new Date().toISOString() };
    const sbResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/team_diagnostics`, { method: 'POST', headers: getSupabaseWriteHeaders(supabaseKey), body: JSON.stringify(payload) });
    if (!sbResp.ok && sbResp.status !== 201) return NextResponse.json({ error: 'Failed to create team alignment session.' }, { status: 502 });

    return NextResponse.json({ success: true, teamId, teamCode, joinUrl, resultsUrl, processName, message: `Team alignment session created. Share code ${teamCode} with your team.` });
  } catch (error) {
    logger.error('Create team alignment error', { requestId: getRequestId(request), error: error.message, stack: error.stack });
    return NextResponse.json({ error: 'Failed to create team alignment session.' }, { status: 500 });
  }
}

async function inviteMembers(body, request) {
  try {
    const parsed = TeamInviteSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid input. Team code and at least one invitee required.' }, { status: 400 });
    const { teamCode, invitees, inviterName, processName, company } = parsed.data;

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    const lookupResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/team_diagnostics?team_code=eq.${encodeURIComponent(teamCode)}&select=id,process_name,company,status`,
      { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
    );
    let teams;
    try { teams = await lookupResp.json(); } catch (e) { logger.error('Invite members: Supabase parse error', { requestId: getRequestId(request), error: e.message }); return NextResponse.json({ error: 'Failed to fetch team.' }, { status: 502 }); }
    if (!teams || teams.length === 0) return NextResponse.json({ error: 'Team not found.' }, { status: 404 });
    const team = teams[0];
    if (team.status === 'closed') return NextResponse.json({ error: 'This session is closed.' }, { status: 400 });

    const baseUrl = buildBaseUrl(request);
    const joinUrl = `${baseUrl}/process-audit?team=${teamCode}`;
    const results = [];

    for (const inv of invitees.slice(0, 50)) {
      const email = (inv.email || '').trim();
      if (!email) { results.push({ email, sent: false, reason: 'invalid-email' }); continue; }

      const { sent } = await triggerWebhook({
        requestType: 'team-invite',
        teamCode,
        joinUrl,
        inviteeEmail: email,
        inviteeName: inv.name || null,
        inviterName: inviterName || 'Your colleague',
        processName: processName || team.process_name || 'a workflow process',
        company: company || team.company || '',
        timestamp: new Date().toISOString(),
      }, { envSuffix: 'TEAM', requestId: getRequestId(request) });
      results.push({ email, sent });
    }

    const sentCount = results.filter((r) => r.sent).length;
    return NextResponse.json({ success: true, sentCount, total: results.length, results, message: `${sentCount} of ${results.length} invites sent.` });
  } catch (error) {
    logger.error('Invite members error', { requestId: getRequestId(request), error: error.message, stack: error.stack });
    return NextResponse.json({ error: 'Failed to send invites.' }, { status: 500 });
  }
}

async function closeTeam(body, request) {
  try {
    const parsed = TeamCloseSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid input. Team code and email required.' }, { status: 400 });
    const { teamCode, email } = parsed.data;

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    const lookupResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/team_diagnostics?team_code=eq.${encodeURIComponent(teamCode)}&select=id,created_by_email,status,process_name,company`,
      { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
    );
    let teams;
    try { teams = await lookupResp.json(); } catch (e) { logger.error('Close team: Supabase parse error', { requestId: getRequestId(request), error: e.message }); return NextResponse.json({ error: 'Failed to fetch team.' }, { status: 502 }); }
    if (!teams || teams.length === 0) return NextResponse.json({ error: 'Team not found.' }, { status: 404 });

    const team = teams[0];
    if (team.created_by_email?.toLowerCase() !== email.toLowerCase())
      return NextResponse.json({ error: 'Only the team creator can close this session.' }, { status: 403 });
    if (team.status === 'closed')
      return NextResponse.json({ error: 'Session is already closed.' }, { status: 400 });

    const patchResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/team_diagnostics?id=eq.${team.id}`, {
      method: 'PATCH',
      headers: getSupabaseWriteHeaders(supabaseKey),
      body: JSON.stringify({ status: 'closed', closed_at: new Date().toISOString() })
    });
    if (!patchResp.ok) return NextResponse.json({ error: 'Failed to close session.' }, { status: 502 });

    const respResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/team_responses?team_id=eq.${encodeURIComponent(team.id)}&select=respondent_email,respondent_name`,
      { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
    );
    let respondents;
    try { respondents = await respResp.json(); } catch (e) { logger.error('Close team: Supabase parse error', { requestId: getRequestId(request), error: e.message }); return NextResponse.json({ error: 'Failed to close session.' }, { status: 502 }); }
    const emails = (Array.isArray(respondents) ? respondents : [])
      .map((r) => r.respondent_email).filter(Boolean);

    if (emails.length > 0) {
      const baseUrl = buildBaseUrl(request);
      triggerWebhook({
        requestType: 'team-closed',
        teamCode,
        processName: team.process_name,
        company: team.company || '',
        respondentEmails: emails,
        resultsUrl: `${baseUrl}/team-results?code=${teamCode}`,
        timestamp: new Date().toISOString(),
      }, { envSuffix: 'TEAM', requestId: getRequestId(request) }).catch(() => {});
    }

    return NextResponse.json({ success: true, message: 'Team alignment session closed.' });
  } catch (error) {
    logger.error('Close team error', { requestId: getRequestId(request), error: error.message, stack: error.stack });
    return NextResponse.json({ error: 'Failed to close session.' }, { status: 500 });
  }
}

async function deleteTeam(body, request) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
    const email = auth.email;

    const parsed = TeamDeleteSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid input. Team code required.' }, { status: 400 });
    const { teamCode } = parsed.data;

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    const lookupResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/team_diagnostics?team_code=eq.${encodeURIComponent(teamCode)}&select=id,created_by_email`,
      { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
    );
    let teams;
    try { teams = await lookupResp.json(); } catch (e) { logger.error('Delete team: Supabase parse error', { requestId: getRequestId(request), error: e.message }); return NextResponse.json({ error: 'Failed to fetch team.' }, { status: 502 }); }
    if (!teams || teams.length === 0) return NextResponse.json({ error: 'Team not found.' }, { status: 404 });

    const team = teams[0];
    if (team.created_by_email?.toLowerCase() !== email.toLowerCase())
      return NextResponse.json({ error: 'Only the team creator can delete this session.' }, { status: 403 });

    const delRespResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/team_responses?team_id=eq.${encodeURIComponent(team.id)}`,
      { method: 'DELETE', headers: getSupabaseWriteHeaders(supabaseKey) }
    );
    if (!delRespResp.ok) return NextResponse.json({ error: 'Failed to delete team responses.' }, { status: 502 });

    const delTeamResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/team_diagnostics?id=eq.${encodeURIComponent(team.id)}`,
      { method: 'DELETE', headers: getSupabaseWriteHeaders(supabaseKey) }
    );
    if (!delTeamResp.ok) return NextResponse.json({ error: 'Failed to delete team session.' }, { status: 502 });

    return NextResponse.json({ success: true, message: 'Team alignment session deleted.' });
  } catch (error) {
    logger.error('Delete team error', { requestId: getRequestId(request), error: error.message, stack: error.stack });
    return NextResponse.json({ error: 'Failed to delete team session.' }, { status: 500 });
  }
}

async function submitResponse(body, request) {
  try {
    const parsed = TeamSubmitSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid input. Team code, name, and response data are required.' }, { status: 400 });
    const { teamCode, respondentName, respondentEmail, respondentDepartment, responseData } = parsed.data;

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    const lookupUrl = `${supabaseUrl}/rest/v1/team_diagnostics?team_code=eq.${encodeURIComponent(teamCode)}&select=id,process_name,company,status,created_by_email,created_by_name`;
    const lookupResp = await fetchWithTimeout(lookupUrl, { method: 'GET', headers: getSupabaseHeaders(supabaseKey) });
    let teams;
    try { teams = await lookupResp.json(); } catch (e) { logger.error('Submit response: Supabase parse error', { requestId: getRequestId(request), error: e.message }); return NextResponse.json({ error: 'Failed to fetch team.' }, { status: 502 }); }
    if (!teams || teams.length === 0) return NextResponse.json({ error: 'Team alignment session not found.' }, { status: 404 });
    const team = teams[0];
    if (team.status === 'closed') return NextResponse.json({ error: 'This team alignment session is closed.' }, { status: 400 });

    const matchField = respondentEmail ? 'respondent_email' : 'respondent_name';
    const matchValue = respondentEmail || respondentName;
    const existingResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/team_responses?team_id=eq.${encodeURIComponent(team.id)}&${matchField}=eq.${encodeURIComponent(matchValue)}&select=id&limit=1`,
      { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
    );
    let existingRows;
    try { existingRows = await existingResp.json(); } catch (e) { logger.error('Submit response: Supabase parse error', { requestId: getRequestId(request), error: e.message }); return NextResponse.json({ error: 'Failed to submit response.' }, { status: 502 }); }

    let responseId;
    if (Array.isArray(existingRows) && existingRows.length > 0) {
      responseId = existingRows[0].id;
      const updatePayload = { respondent_name: respondentName, respondent_email: respondentEmail || null, respondent_department: respondentDepartment || null, response_data: responseData, updated_at: new Date().toISOString() };
      const sbResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/team_responses?id=eq.${responseId}`, { method: 'PATCH', headers: getSupabaseWriteHeaders(supabaseKey), body: JSON.stringify(updatePayload) });
      if (!sbResp.ok && sbResp.status !== 204) return NextResponse.json({ error: 'Failed to update response.' }, { status: 502 });
    } else {
      responseId = crypto.randomUUID();
      const payload = { id: responseId, team_id: team.id, respondent_name: respondentName, respondent_email: respondentEmail || null, respondent_department: respondentDepartment || null, response_data: responseData, created_at: new Date().toISOString() };
      const sbResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/team_responses`, { method: 'POST', headers: getSupabaseWriteHeaders(supabaseKey), body: JSON.stringify(payload) });
      if (!sbResp.ok && sbResp.status !== 201) return NextResponse.json({ error: 'Failed to submit response.' }, { status: 502 });
    }

    notifyTeamCreator(supabaseUrl, supabaseKey, team, teamCode, respondentName, respondentEmail, request).catch(() => {});

    return NextResponse.json({ success: true, responseId, processName: team.process_name, message: 'Your perspective has been submitted.' });
  } catch (error) {
    logger.error('Submit team response error', { requestId: getRequestId(request), error: error.message, stack: error.stack });
    return NextResponse.json({ error: 'Failed to submit response.' }, { status: 500 });
  }
}

async function notifyTeamCreator(supabaseUrl, supabaseKey, team, teamCode, respondentName, respondentEmail, request) {
  if (!team.created_by_email) return;

  const baseUrl = buildBaseUrl(request);
  const resultsUrl = `${baseUrl}/team-results?code=${teamCode}`;

  triggerWebhook({
    requestType: 'team-response',
    teamCode,
    processName: team.process_name,
    company: team.company || '',
    creatorEmail: team.created_by_email,
    creatorName: team.created_by_name || '',
    respondentName,
    respondentEmail: respondentEmail || '',
    resultsUrl,
    timestamp: new Date().toISOString(),
  }, { envSuffix: 'TEAM', requestId: getRequestId(request) }).catch(() => {});

  try {
    const countResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/team_responses?team_id=eq.${encodeURIComponent(team.id)}&select=id`,
      { method: 'GET', headers: { ...getSupabaseHeaders(supabaseKey), 'Prefer': 'count=exact' } }
    );
    const countHeader = countResp.headers.get('content-range');
    const totalResponses = countHeader ? parseInt(countHeader.split('/')[1], 10) : 0;

    if (totalResponses === 2) {
      triggerWebhook({
        requestType: 'team-results-ready',
        teamCode,
        processName: team.process_name,
        company: team.company || '',
        creatorEmail: team.created_by_email,
        creatorName: team.created_by_name || '',
        responseCount: totalResponses,
        resultsUrl,
        timestamp: new Date().toISOString(),
      }, { envSuffix: 'TEAM', requestId: getRequestId(request) }).catch(() => {});
    }
  } catch (err) {
    logger.warn('Count responses for results-ready failed', { requestId: getRequestId(request), message: err.message });
  }
}

async function getResults(request) {
  try {
    const code = request.nextUrl.searchParams.get('code');
    if (!code || !isValidTeamCode(code)) return NextResponse.json({ error: 'Valid team code required (4-12 alphanumeric). Use ?action=results&code=xxx' }, { status: 400 });

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    const sbHeaders = getSupabaseHeaders(supabaseKey);
    const teamResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/team_diagnostics?team_code=eq.${encodeURIComponent(code)}&select=*`, { method: 'GET', headers: sbHeaders });
    let teams;
    try { teams = await teamResp.json(); } catch (e) { logger.error('Get results: Supabase parse error', { requestId: getRequestId(request), error: e.message }); return NextResponse.json({ error: 'Failed to fetch team.' }, { status: 502 }); }
    if (!teams || teams.length === 0) return NextResponse.json({ error: 'Team alignment session not found.' }, { status: 404 });
    const team = teams[0];

    const respResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/team_responses?team_id=eq.${encodeURIComponent(team.id)}&select=*&order=created_at.asc`, { method: 'GET', headers: sbHeaders });
    let responses;
    try { responses = await respResp.json(); } catch (e) { logger.error('Get results: Supabase parse error', { requestId: getRequestId(request), error: e.message }); return NextResponse.json({ error: 'Failed to fetch responses.' }, { status: 502 }); }
    if (!responses || responses.length === 0) return NextResponse.json({ success: true, team: { id: team.id, processName: team.process_name, company: team.company, status: team.status, createdAt: team.created_at, closedAt: team.closed_at }, responseCount: 0, responses: [], aggregation: null });

    const dedupMap = new Map();
    for (const r of responses) {
      const key = r.respondent_email || r.respondent_name;
      const existing = dedupMap.get(key);
      if (!existing || new Date(r.created_at) > new Date(existing.created_at)) {
        dedupMap.set(key, r);
      }
    }
    const uniqueResponses = [...dedupMap.values()];

    const individuals = uniqueResponses.map(r => {
      const d = r.response_data || {};
      const m = d.metrics || {};
      const p = d.processData || d;
      const hasDirectMetrics = m.elapsedDays !== undefined || m.stepsCount !== undefined;
      return {
        id: r.id, name: r.respondent_name, email: r.respondent_email, department: r.respondent_department, createdAt: r.created_at, responseData: d,
        metrics: {
          elapsedDays: hasDirectMetrics ? (m.elapsedDays || 0) : (p.lastExample?.elapsedDays || 0),
          stepsCount: hasDirectMetrics ? (m.stepsCount || (p.steps || []).length) : (p.steps || []).length,
          handoffCount: hasDirectMetrics ? (m.handoffCount || 0) : (p.handoffs || []).length,
          poorHandoffs: hasDirectMetrics ? (m.poorHandoffs || 0) : (p.handoffs || []).filter(h => h.clarity === 'yes-multiple' || h.clarity === 'yes-major').length,
          performance: hasDirectMetrics ? (m.performance || '') : (p.performance || ''),
          issues: hasDirectMetrics ? (d.issues || m.issues || []) : (p.issues || []),
          biggestDelay: hasDirectMetrics ? (m.biggestDelay || '') : (p.biggestDelay || ''),
          bottleneck: hasDirectMetrics ? (m.bottleneck || '') : (p.bottleneck?.name || ''),
          totalUserHours: hasDirectMetrics ? (m.totalUserHours || 0) : (p.userTime?.total || 0)
        }
      };
    });

    const nums = (key) => individuals.map(i => i.metrics[key]).filter(v => typeof v === 'number' && v > 0);
    const avg = (arr) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
    const spread = (arr) => arr.length > 1 ? Math.max(...arr) - Math.min(...arr) : 0;
    const safeMin = (arr) => arr.length > 0 ? Math.min(...arr) : 0;
    const safeMax = (arr) => arr.length > 0 ? Math.max(...arr) : 0;

    const elapsedDaysArr = nums('elapsedDays'), stepsArr = nums('stepsCount'), handoffArr = nums('handoffCount'), hoursArr = nums('totalUserHours');
    const gaps = [];

    if (spread(elapsedDaysArr) > 5) gaps.push({ metric: 'Cycle Time', severity: spread(elapsedDaysArr) > 14 ? 'high' : 'medium', detail: `Range: ${safeMin(elapsedDaysArr)} to ${safeMax(elapsedDaysArr)} days` });
    if (spread(stepsArr) > 3) gaps.push({ metric: 'Process Steps', severity: spread(stepsArr) > 8 ? 'high' : 'medium', detail: `Range: ${safeMin(stepsArr)} to ${safeMax(stepsArr)} steps` });
    if (spread(handoffArr) > 3) gaps.push({ metric: 'Handoff Count', severity: spread(handoffArr) > 8 ? 'high' : 'medium', detail: `Range: ${safeMin(handoffArr)} to ${safeMax(handoffArr)}` });

    const aggregation = {
      elapsedDays: { avg: avg(elapsedDaysArr), min: safeMin(elapsedDaysArr), max: safeMax(elapsedDaysArr), spread: spread(elapsedDaysArr) },
      steps: { avg: avg(stepsArr), min: safeMin(stepsArr), max: safeMax(stepsArr), spread: spread(stepsArr) },
      handoffs: { avg: avg(handoffArr), min: safeMin(handoffArr), max: safeMax(handoffArr) },
      totalHours: { avg: avg(hoursArr), min: safeMin(hoursArr), max: safeMax(hoursArr) },
      perceptionGaps: gaps,
      consensusScore: Math.max(0, 100 - (gaps.filter(g => g.severity === 'high').length * 25) - (gaps.filter(g => g.severity === 'medium').length * 10))
    };

    return NextResponse.json({ success: true, team: { id: team.id, processName: team.process_name, company: team.company, description: team.description, status: team.status, createdAt: team.created_at, closedAt: team.closed_at, createdBy: team.created_by_name }, responseCount: individuals.length, responses: individuals, aggregation });
  } catch (error) {
    logger.error('Get team results error', { requestId: getRequestId(request), error: error.message, stack: error.stack });
    return NextResponse.json({ error: 'Failed to retrieve team results.' }, { status: 500 });
  }
}

async function analyzeGaps(body, request) {
  try {
    const parsed = TeamAnalyzeSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Need at least 2 responses and aggregation data.' }, { status: 400 });
    const { team, responses, aggregation } = parsed.data;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ success: true, analysisType: 'rule-based', analysis: buildRuleBasedAnalysis(team, responses, aggregation) });

    const respondentSummaries = responses.map(r => `- ${r.name} (${r.department}): ${r.metrics.stepsCount} steps, ${r.metrics.elapsedDays} days, ${r.metrics.handoffCount} handoffs`).join('\n');
    const cacheKey = { teamId: team.id, respondentSummaries, consensusScore: aggregation.consensusScore };
    const cached = get(cacheKey);
    if (cached && typeof cached === 'object' && (cached.executiveSummary || cached.recommendations?.length)) {
      return NextResponse.json({ success: true, analysisType: 'ai-enhanced', analysis: cached });
    }

    const fallback = buildRuleBasedAnalysis(team, responses, aggregation);
    let analysis;
    try {
      analysis = await invokeStructured(
        getFastModel({ temperature: 0.4 }),
        [
          new SystemMessage(teamAnalysisSystemPrompt()),
          new HumanMessage(teamAnalysisUserPrompt({ processName: team.processName, responseCount: responses.length, consensusScore: aggregation.consensusScore, respondentSummaries, segment: team.segment || '' })),
        ],
        TeamGapAnalysisSchema,
        fallback
      );
    } catch {
      return NextResponse.json({ success: true, analysisType: 'rule-based', analysis: fallback });
    }

    set(cacheKey, analysis);
    return NextResponse.json({ success: true, analysisType: 'ai-enhanced', analysis });
  } catch (error) {
    logger.error('Analyze gaps error', { requestId: getRequestId(request), error: error.message, stack: error.stack });
    return NextResponse.json({ error: 'Analysis failed.' }, { status: 500 });
  }
}

function buildRuleBasedAnalysis(team, responses, aggregation) {
  return {
    executiveSummary: `The team shows ${aggregation.consensusScore >= 50 ? 'partial' : 'significant'} misalignment on "${team.processName}".`,
    rootCauses: [],
    hiddenInefficiencies: [{ title: 'Shadow processes', insight: 'Different step counts suggest undocumented workarounds.' }],
    recommendations: [{ priority: 1, action: 'Run a cross-departmental process mapping workshop', impact: 'Align on actual steps and ownership', owner: 'Operations', timeframe: 'quick-win' }],
    alignmentActions: ['Schedule a 90-minute cross-departmental review session']
  };
}
