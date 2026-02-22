// api/get-diagnostic.js
// Vercel Serverless Function - Fetches a diagnostic report from Supabase by ID
// Used by /report?id=xxx to retrieve stored diagnostic data + PDF
// Also supports ?id=xxx&editable=true&email=yyy to return raw process data for editing

const { setCorsHeaders, getSupabaseHeaders, getSupabaseWriteHeaders, isValidUUID, isValidEmail, fetchWithTimeout } = require('../lib/api-helpers');
const { normaliseLegacyRow } = require('../lib/fetch-report');

module.exports = async function handler(req, res) {
  setCorsHeaders(res, 'GET,POST,PATCH,OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── POST ?action=migrate-legacy: bulk-copy diagnostics → diagnostic_reports ──
  if (req.method === 'POST' && req.query.action === 'migrate-legacy') {
    try {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
      if (!supabaseUrl || !supabaseKey) return res.status(503).json({ error: 'Storage not configured.' });

      const legResp = await fetch(`${supabaseUrl}/rest/v1/diagnostics?select=*&order=completed_at.desc&limit=500`, { headers: getSupabaseHeaders(supabaseKey) });
      if (!legResp.ok) return res.status(502).json({ error: 'Failed to read legacy table.' });
      const legRows = await legResp.json();
      if (!legRows || legRows.length === 0) return res.status(200).json({ success: true, migrated: 0, skipped: 0, message: 'No legacy records found.' });

      const existResp = await fetch(`${supabaseUrl}/rest/v1/diagnostic_reports?select=id`, { headers: getSupabaseHeaders(supabaseKey) });
      const existRows = existResp.ok ? await existResp.json() : [];
      const existIds = new Set((existRows || []).map(r => r.id));

      let migrated = 0, skipped = 0, errors = [];
      for (const row of legRows) {
        if (existIds.has(row.id)) { skipped++; continue; }
        try {
          const norm = normaliseLegacyRow(row);
          const ins = await fetch(`${supabaseUrl}/rest/v1/diagnostic_reports`, {
            method: 'POST', headers: getSupabaseWriteHeaders(supabaseKey),
            body: JSON.stringify({ id: norm.id, contact_email: norm.contact_email, contact_name: norm.contact_name, company: norm.company, lead_score: norm.lead_score, lead_grade: norm.lead_grade, diagnostic_data: norm.diagnostic_data, created_at: norm.created_at })
          });
          if (ins.ok || ins.status === 201) { migrated++; } else { errors.push({ id: row.id, err: await ins.text() }); }
        } catch (e) { errors.push({ id: row.id, err: e.message }); }
      }
      return res.status(200).json({ success: true, total: legRows.length, migrated, skipped, errors: errors.length > 0 ? errors : undefined });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ── PATCH: update step data for an existing diagnostic ──────
  if (req.method === 'PATCH') {
    try {
      const { id } = req.query;
      const { steps, processIndex } = req.body || {};
      if (!id || !isValidUUID(id)) return res.status(400).json({ error: 'Valid report ID required.' });
      if (!steps || !Array.isArray(steps) || steps.length === 0) return res.status(400).json({ error: 'steps array is required.' });
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
      if (!supabaseUrl || !supabaseKey) return res.status(503).json({ error: 'Storage not configured.' });

      let dd, foundInLegacy = false;

      const readResp = await fetch(`${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${id}&select=diagnostic_data`, { headers: getSupabaseHeaders(supabaseKey) });
      if (readResp.ok) {
        const rows = await readResp.json();
        if (rows && rows.length > 0) {
          dd = rows[0].diagnostic_data || {};
        }
      }

      if (!dd) {
        const legResp = await fetch(`${supabaseUrl}/rest/v1/diagnostics?id=eq.${id}&select=*`, { headers: getSupabaseHeaders(supabaseKey) });
        if (legResp.ok) {
          const legRows = await legResp.json();
          if (legRows && legRows.length > 0) {
            const norm = normaliseLegacyRow(legRows[0]);
            dd = norm.diagnostic_data || {};
            foundInLegacy = true;
          }
        }
      }

      if (!dd) return res.status(404).json({ error: 'Report not found.' });

      const pi = processIndex || 0;

      if (!dd.rawProcesses) dd.rawProcesses = [];
      if (dd.rawProcesses.length > pi && dd.rawProcesses[pi]) {
        dd.rawProcesses[pi].steps = steps;
      } else {
        const procName = (dd.processes && dd.processes[pi]) ? dd.processes[pi].name : 'Process';
        while (dd.rawProcesses.length <= pi) dd.rawProcesses.push({ processName: procName, steps: [] });
        dd.rawProcesses[pi].steps = steps;
        dd.rawProcesses[pi].processName = procName;
      }

      if (dd.processes && dd.processes[pi]) {
        dd.processes[pi].steps = steps.map(function(s, si) {
          return { number: si + 1, name: s.name || '', department: s.department || '', isDecision: !!s.isDecision, isExternal: !!s.isExternal, branches: s.branches || [] };
        });
      }

      let writeResp;
      if (foundInLegacy) {
        const contact = dd.contact || {};
        writeResp = await fetch(`${supabaseUrl}/rest/v1/diagnostic_reports`, {
          method: 'POST', headers: getSupabaseWriteHeaders(supabaseKey),
          body: JSON.stringify({ id, contact_email: contact.email || '', contact_name: contact.name || '', company: contact.company || '', lead_score: (dd.leadScore || {}).score || 0, lead_grade: (dd.leadScore || {}).grade || '', diagnostic_data: dd, created_at: new Date().toISOString() })
        });
      } else {
        writeResp = await fetch(`${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${id}`, {
          method: 'PATCH', headers: getSupabaseWriteHeaders(supabaseKey),
          body: JSON.stringify({ diagnostic_data: dd, updated_at: new Date().toISOString() })
        });
      }
      if (!writeResp.ok) { const t = await writeResp.text(); return res.status(502).json({ error: 'Write failed: ' + t }); }
      return res.status(200).json({ success: true, stepsCount: steps.length, migrated: foundInLegacy });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { id, editable, email } = req.query;

    if (!id) {
      return res.status(400).json({ error: 'Report ID is required. Use ?id=xxx' });
    }

    if (!isValidUUID(id)) {
      return res.status(400).json({ error: 'Invalid report ID format.' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(503).json({
        error: 'Report storage not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.'
      });
    }

    // ── Editable mode: return raw process data for editing ──────
    if (editable === 'true') {
      if (!email) {
        return res.status(400).json({ error: 'Email is required for ownership verification.' });
      }

      const editHeaders = getSupabaseHeaders(supabaseKey);

      const url = `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${id}&select=id,contact_email,contact_name,company,diagnostic_data,created_at`;
      const sbResp = await fetch(url, { method: 'GET', headers: editHeaders });

      if (!sbResp.ok) {
        console.error('Supabase fetch error:', sbResp.status);
        return res.status(502).json({ error: 'Failed to fetch report.' });
      }

      let rows = await sbResp.json();

      if (rows && rows.length > 0) {
        const report = rows[0];
        if (report.contact_email.toLowerCase() !== email.toLowerCase()) {
          return res.status(403).json({ error: 'You do not have permission to edit this diagnostic.' });
        }
        const diagData = report.diagnostic_data || {};
        if (!diagData.rawProcesses || diagData.rawProcesses.length === 0) {
          return res.status(404).json({ error: 'Raw process data not available for this diagnostic. Only diagnostics submitted after this feature was added can be edited.' });
        }
        return res.status(200).json({
          success: true,
          report: {
            id: report.id, contactEmail: report.contact_email, contactName: report.contact_name,
            company: report.company, createdAt: report.created_at,
            contact: diagData.contact || {}, rawProcesses: diagData.rawProcesses,
            customDepartments: diagData.customDepartments || []
          }
        });
      }

      // Fallback to diagnostics table
      try {
        const diagUrl = `${supabaseUrl}/rest/v1/diagnostics?id=eq.${id}&select=*`;
        const diagResp = await fetch(diagUrl, { method: 'GET', headers: editHeaders });
        if (diagResp.ok) {
          const diagRows = await diagResp.json();
          if (diagRows && diagRows.length > 0) {
            const d = diagRows[0];
            if (d.email.toLowerCase() !== email.toLowerCase()) {
              return res.status(403).json({ error: 'You do not have permission to edit this diagnostic.' });
            }
            return res.status(404).json({ error: 'Raw process data not available for this diagnostic. Records from the legacy table cannot be edited — run a new diagnostic to get editable data.' });
          }
        }
      } catch (e) { console.error('Editable fallback error:', e.message); }

      return res.status(404).json({ error: 'Report not found.' });
    }

    // ── Standard mode: return full report + PDF ─────────────────
    const sbHeaders = getSupabaseHeaders(supabaseKey);

    const url = `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${id}&select=*`;
    const sbResp = await fetch(url, { method: 'GET', headers: sbHeaders });

    if (!sbResp.ok) {
      const errText = await sbResp.text();
      console.error('Supabase fetch error:', sbResp.status, errText);
      return res.status(502).json({ error: 'Failed to fetch report from storage.' });
    }

    let rows = await sbResp.json();

    // Fallback: check the diagnostics table if not found in diagnostic_reports
    if (!rows || rows.length === 0) {
      try {
        const diagUrl = `${supabaseUrl}/rest/v1/diagnostics?id=eq.${id}&select=*`;
        const diagResp = await fetch(diagUrl, { method: 'GET', headers: sbHeaders });
        if (diagResp.ok) {
          const diagRows = await diagResp.json();
          if (diagRows && diagRows.length > 0) {
            const normalised = normaliseLegacyRow(diagRows[0]);
            return res.status(200).json({
              success: true,
              source: 'diagnostics',
              report: {
                id: normalised.id,
                contactEmail: normalised.contact_email,
                contactName: normalised.contact_name,
                company: normalised.company,
                leadScore: normalised.lead_score,
                leadGrade: normalised.lead_grade,
                diagnosticData: normalised.diagnostic_data,
                pdfBase64: null,
                createdAt: normalised.created_at
              }
            });
          }
        }
      } catch (fallbackErr) {
        console.warn('Diagnostics table fallback failed:', fallbackErr.message);
      }

      return res.status(404).json({ error: 'Report not found. It may have expired or the ID is incorrect.' });
    }

    const report = rows[0];

    return res.status(200).json({
      success: true,
      report: {
        id: report.id,
        contactEmail: report.contact_email,
        contactName: report.contact_name,
        company: report.company,
        leadScore: report.lead_score,
        leadGrade: report.lead_grade,
        diagnosticData: report.diagnostic_data,
        pdfBase64: report.pdf_base64,
        createdAt: report.created_at
      }
    });

  } catch (error) {
    console.error('Get diagnostic error:', error);
    return res.status(500).json({ error: 'Failed to retrieve diagnostic report.' });
  }
};
