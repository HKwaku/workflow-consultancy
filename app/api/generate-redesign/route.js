import { NextResponse } from 'next/server';
import { getSupabaseHeaders, isValidUUID, isValidEmail, fetchWithTimeout, stripEmDashes, requireSupabase } from '@/lib/api-helpers';

export async function POST(request) {
  try {
    const body = await request.json();
    const { email, reportId } = body || {};
    if (!email || !reportId) return NextResponse.json({ error: 'email and reportId are required.' }, { status: 400 });
    if (!isValidUUID(reportId)) return NextResponse.json({ error: 'Invalid report ID format.' }, { status: 400 });
    if (!isValidEmail(email)) return NextResponse.json({ error: 'Invalid email format.' }, { status: 400 });

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) return NextResponse.json({ error: 'AI service not configured.' }, { status: 503 });

    const { regenerate } = body || {};
    const sbHeaders = getSupabaseHeaders(supabaseKey);
    const url = `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}&contact_email=ilike.${encodeURIComponent(email.toLowerCase())}&select=id,diagnostic_data,contact_name,company`;
    const sbResp = await fetch(url, { method: 'GET', headers: sbHeaders });
    if (!sbResp.ok) return NextResponse.json({ error: 'Failed to fetch report from storage.' }, { status: 502 });

    const rows = await sbResp.json();
    if (!rows || rows.length === 0) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });

    const report = rows[0];
    const d = report.diagnostic_data || {};
    if (d.redesign && !regenerate) return NextResponse.json({ success: true, reportId, redesign: d.redesign, cached: true });

    const rawProcesses = d.rawProcesses || [];
    const diagnosticContext = JSON.stringify({
      company: report.company || d.contact?.company || '',
      processes: (d.processes || []).map(p => ({ name: p.name, type: p.type, annualCost: p.annualCost, stepsCount: p.stepsCount, elapsedDays: p.elapsedDays, steps: (p.steps || []).map(s => ({ name: s.name, type: s.type, handoff: s.handoff, automatable: s.automatable, bottleneck: s.bottleneck, painPoints: s.painPoints })) })),
      rawProcesses: rawProcesses.map(rp => ({ processName: rp.processName, steps: (rp.steps || []).map(s => ({ number: s.number, name: s.name, department: s.department, isDecision: s.isDecision || false, isExternal: s.isExternal || false, branches: s.branches || [] })), handoffs: (rp.handoffs || []).map(h => ({ from: h.from?.name, to: h.to?.name, method: h.method, clarity: h.clarity })), bottleneck: rp.bottleneck, issues: rp.issues || [], biggestDelay: rp.biggestDelay })),
      summary: { totalProcesses: (d.summary || {}).totalProcesses, totalAnnualCost: (d.summary || {}).totalAnnualCost, potentialSavings: (d.summary || {}).potentialSavings, automationPercentage: d.automationScore?.percentage },
      recommendations: (d.recommendations || []).slice(0, 10).map(r => r.text),
      roadmapPhases: d.roadmap?.phases ? Object.keys(d.roadmap.phases) : []
    }, null, 2);

    const systemPrompt = `You are an expert operating model consultant. Given diagnostic data about a company's current processes, produce an operating model redesign in structured JSON. Return ONLY valid JSON with: { "executiveSummary": "...", "optimisedProcesses": [...], "changeLog": [...], "efficiencyGains": [...], "implementationPriority": [...] }`;
    const userPrompt = `Here is the diagnostic data for this organisation:\n\n${diagnosticContext}\n\nProduce the operating model redesign.`;

    const aiResp = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 8192, temperature: 0, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] })
    }, 45000);

    if (!aiResp.ok) return NextResponse.json({ error: 'AI service returned an error.' }, { status: 502 });
    const aiData = await aiResp.json();
    const content = aiData.content?.[0]?.text;
    if (!content) return NextResponse.json({ error: 'AI returned an empty response.' }, { status: 502 });

    let redesign;
    try {
      let cleaned = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) cleaned = cleaned.substring(firstBrace, lastBrace + 1);
      cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
      redesign = stripEmDashes(JSON.parse(cleaned));
    } catch (parseErr) {
      console.error('Failed to parse AI response:', parseErr.message);
      return NextResponse.json({ error: 'AI response was not valid JSON.' }, { status: 502 });
    }

    try {
      const updatedData = { ...d, redesign };
      await fetch(`${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}`, {
        method: 'PATCH',
        headers: { ...sbHeaders, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ diagnostic_data: updatedData })
      });
    } catch (cacheErr) { console.error('Failed to cache redesign:', cacheErr); }

    return NextResponse.json({ success: true, reportId, redesign });
  } catch (error) {
    console.error('Generate redesign error:', error);
    return NextResponse.json({ error: 'Failed to generate operating model redesign.' }, { status: 500 });
  }
}
