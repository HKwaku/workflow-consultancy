import { NextResponse } from 'next/server';
import { getSupabaseHeaders, getSupabaseWriteHeaders, isValidUUID, requireSupabase } from '@/lib/api-helpers';

export async function GET(request) {
  try {
    const sp = request.nextUrl.searchParams;
    const id = sp.get('id');
    const editable = sp.get('editable');
    const email = sp.get('email');

    if (!id) return NextResponse.json({ error: 'Report ID is required. Use ?id=xxx' }, { status: 400 });
    if (!isValidUUID(id)) return NextResponse.json({ error: 'Invalid report ID format.' }, { status: 400 });

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Report storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    if (editable === 'true') {
      if (!email) return NextResponse.json({ error: 'Email is required for ownership verification.' }, { status: 400 });
      const editHeaders = getSupabaseHeaders(supabaseKey);
      const url = `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${id}&select=id,contact_email,contact_name,company,diagnostic_data,created_at`;
      const sbResp = await fetch(url, { method: 'GET', headers: editHeaders });
      if (!sbResp.ok) return NextResponse.json({ error: 'Failed to fetch report.' }, { status: 502 });
      const rows = await sbResp.json();
      if (!rows || rows.length === 0) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });

      const report = rows[0];
      if (report.contact_email.toLowerCase() !== email.toLowerCase()) {
        return NextResponse.json({ error: 'You do not have permission to edit this diagnostic.' }, { status: 403 });
      }
      const diagData = report.diagnostic_data || {};
      let rawProcesses = diagData.rawProcesses;
      if (!rawProcesses || rawProcesses.length === 0) {
        const processes = diagData.processes || [];
        rawProcesses = processes.map(function (p) {
          return {
            processName: p.name || 'Process', processType: p.type || 'other',
            definition: { startsWhen: '', completesWhen: '', complexity: 'complex', departments: [] },
            lastExample: { name: '', startDate: '', endDate: '', elapsedDays: p.elapsedDays || 0 },
            userTime: { meetings: 0, emails: 0, execution: 0, waiting: 0, total: 0 },
            timeAccuracy: 'confident', performance: 'typical', issues: [], biggestDelay: '', delayDetails: '',
            steps: (p.steps || []).map(function (s, si) {
              return { number: si + 1, name: s.name || 'Step ' + (si + 1), department: s.department || 'Operations', isDecision: s.isDecision || false, isExternal: s.isExternal || false, branches: s.branches || [] };
            }),
            handoffs: [], systems: [], approvals: [], knowledge: {}, newHire: {},
            frequency: { type: 'monthly', annual: 12, inFlight: 0, progressing: 0, stuck: 0, waiting: 0 },
            costs: { hourlyRate: 50, instanceCost: 0, annualUserCost: 0, totalAnnualCost: p.annualCost || 0, teamSize: p.teamSize || 1 },
            savings: {}, priority: {}, bottleneck: {}
          };
        });
      }
      return NextResponse.json({
        success: true,
        report: {
          id: report.id, contactEmail: report.contact_email, contactName: report.contact_name,
          company: report.company, createdAt: report.created_at,
          contact: diagData.contact || {}, rawProcesses, customDepartments: diagData.customDepartments || []
        }
      });
    }

    const sbHeaders = getSupabaseHeaders(supabaseKey);
    const url = `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${id}&select=*`;
    const sbResp = await fetch(url, { method: 'GET', headers: sbHeaders });
    if (!sbResp.ok) return NextResponse.json({ error: 'Failed to fetch report from storage.' }, { status: 502 });
    const rows = await sbResp.json();
    if (!rows || rows.length === 0) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });

    const report = rows[0];
    return NextResponse.json({
      success: true,
      report: {
        id: report.id, contactEmail: report.contact_email, contactName: report.contact_name,
        company: report.company, leadScore: report.lead_score, leadGrade: report.lead_grade,
        diagnosticData: report.diagnostic_data, createdAt: report.created_at
      }
    });
  } catch (error) {
    console.error('Get diagnostic error:', error);
    return NextResponse.json({ error: 'Failed to retrieve diagnostic report.' }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const sp = request.nextUrl.searchParams;
    const id = sp.get('id');
    const body = await request.json();
    const { steps, processIndex } = body || {};
    if (!id || !isValidUUID(id)) return NextResponse.json({ error: 'Valid report ID required.' }, { status: 400 });
    if (!steps || !Array.isArray(steps) || steps.length === 0) return NextResponse.json({ error: 'steps array is required.' }, { status: 400 });

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    const readResp = await fetch(`${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${id}&select=diagnostic_data`, { headers: getSupabaseHeaders(supabaseKey) });
    if (!readResp.ok) return NextResponse.json({ error: 'Failed to read report.' }, { status: 502 });
    const rows = await readResp.json();
    if (!rows || rows.length === 0) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });

    const dd = rows[0].diagnostic_data || {};
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

    const writeResp = await fetch(`${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${id}`, {
      method: 'PATCH', headers: getSupabaseWriteHeaders(supabaseKey),
      body: JSON.stringify({ diagnostic_data: dd })
    });
    if (!writeResp.ok) { const t = await writeResp.text(); return NextResponse.json({ error: 'Write failed: ' + t }, { status: 502 }); }
    return NextResponse.json({ success: true, stepsCount: steps.length });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
