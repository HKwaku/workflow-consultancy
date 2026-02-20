const { setCorsHeaders, getSupabaseHeaders, isValidUUID, isValidEmail, fetchWithTimeout } = require('../lib/api-helpers');

module.exports = async function handler(req, res) {
  setCorsHeaders(res, 'POST,OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, reportId } = req.body || {};

    if (!email || !reportId) {
      return res.status(400).json({ error: 'email and reportId are required.' });
    }
    if (!isValidUUID(reportId)) {
      return res.status(400).json({ error: 'Invalid report ID format.' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format.' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(503).json({ error: 'Storage not configured.' });
    }
    if (!anthropicKey) {
      return res.status(503).json({ error: 'AI service not configured. Set ANTHROPIC_API_KEY in environment.' });
    }

    const { regenerate } = req.body || {};

    const sbHeaders = getSupabaseHeaders(supabaseKey);

    let report = null;
    let d = {};
    let sourceTable = 'diagnostic_reports';

    const url = `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}&contact_email=ilike.${encodeURIComponent(email.toLowerCase())}&select=id,diagnostic_data,contact_name,company`;
    const sbResp = await fetch(url, { method: 'GET', headers: sbHeaders });

    if (!sbResp.ok) {
      return res.status(502).json({ error: 'Failed to fetch report from storage.' });
    }

    const rows = await sbResp.json();
    if (rows && rows.length > 0) {
      report = rows[0];
      d = report.diagnostic_data || {};
    } else {
      // Fallback: diagnostics table
      const diagUrl = `${supabaseUrl}/rest/v1/diagnostics?id=eq.${reportId}&email=ilike.${encodeURIComponent(email.toLowerCase())}&select=*`;
      const diagResp = await fetch(diagUrl, { method: 'GET', headers: sbHeaders });
      if (!diagResp.ok) {
        return res.status(502).json({ error: 'Failed to fetch report from storage.' });
      }
      const diagRows = await diagResp.json();
      if (!diagRows || diagRows.length === 0) {
        return res.status(404).json({ error: 'Report not found.' });
      }
      const dr = diagRows[0];
      sourceTable = 'diagnostics';

      let procs = [];
      try { procs = typeof dr.processes === 'string' ? JSON.parse(dr.processes) : (dr.processes || []); } catch (e) { console.error('Failed to parse processes:', e.message); }
      let recs = [];
      try { recs = typeof dr.recommendations === 'string' ? JSON.parse(dr.recommendations) : (dr.recommendations || []); } catch (e) { console.error('Failed to parse recommendations:', e.message); }

      report = { id: dr.id, contact_name: dr.name, company: dr.company, diagnostic_data: {} };
      d = {
        contact: { name: dr.name, email: dr.email, company: dr.company },
        summary: { totalProcesses: dr.total_processes || 0, totalAnnualCost: dr.annual_process_cost || 0, potentialSavings: dr.potential_savings || 0, qualityScore: dr.quality_score || 0 },
        automationScore: { percentage: dr.automation_percentage || 0, grade: dr.automation_grade || 'N/A', insight: dr.automation_insight || '' },
        recommendations: recs,
        processes: procs,
        rawProcesses: [],
        roadmap: {}
      };
    }

    if (d.redesign && !regenerate) {
      return res.status(200).json({ success: true, reportId, redesign: d.redesign, cached: true });
    }
    const processes = d.processes || [];
    const summary = d.summary || {};
    const recommendations = d.recommendations || [];
    const roadmap = d.roadmap || {};

    const rawProcesses = d.rawProcesses || [];
    const diagnosticContext = JSON.stringify({
      company: report.company || d.contact?.company || '',
      processes: processes.map(p => ({
        name: p.name,
        type: p.type,
        annualCost: p.annualCost,
        stepsCount: p.stepsCount,
        elapsedDays: p.elapsedDays,
        steps: (p.steps || []).map(s => ({
          name: s.name,
          type: s.type,
          handoff: s.handoff,
          automatable: s.automatable,
          bottleneck: s.bottleneck,
          painPoints: s.painPoints
        }))
      })),
      rawProcesses: rawProcesses.map(rp => ({
        processName: rp.processName,
        steps: (rp.steps || []).map(s => ({
          number: s.number,
          name: s.name,
          department: s.department,
          isDecision: s.isDecision || false,
          isExternal: s.isExternal || false,
          branches: s.branches || []
        })),
        handoffs: (rp.handoffs || []).map(h => ({
          from: h.from?.name,
          to: h.to?.name,
          method: h.method,
          clarity: h.clarity
        })),
        bottleneck: rp.bottleneck,
        issues: rp.issues || [],
        biggestDelay: rp.biggestDelay
      })),
      summary: {
        totalProcesses: summary.totalProcesses,
        totalAnnualCost: summary.totalAnnualCost,
        potentialSavings: summary.potentialSavings,
        automationPercentage: d.automationScore?.percentage
      },
      recommendations: recommendations.slice(0, 10).map(r => r.text),
      roadmapPhases: roadmap.phases ? Object.keys(roadmap.phases) : []
    }, null, 2);

    const systemPrompt = `You are an expert operating model consultant. Given diagnostic data about a company's current processes, produce an operating model redesign in structured JSON.

Return ONLY valid JSON (no markdown, no code fences, no explanation text) with this exact structure:
{
  "executiveSummary": "2-3 sentence overview",
  "optimisedProcesses": [
    {
      "processName": "Exact process name from the input",
      "steps": [
        {
          "number": 1,
          "name": "Step name",
          "department": "Department name",
          "automated": false,
          "isNew": false,
          "changed": false,
          "isDecision": false,
          "isExternal": false,
          "branches": [{ "label": "Branch label", "target": "Step 3" }],
          "note": "Brief note on what changed"
        }
      ]
    }
  ],
  "changeLog": [
    {
      "process": "Process name",
      "step": "Step name",
      "changeType": "removed|merged|automated|simplified|added|reordered",
      "before": "What it was",
      "after": "What it is now",
      "rationale": "Why"
    }
  ],
  "efficiencyGains": [
    {
      "area": "Step or area name",
      "gainType": "time|cost|quality|handoff-reduction|error-reduction|bottleneck-removal",
      "description": "Description",
      "magnitude": "high|medium|low"
    }
  ],
  "implementationPriority": [
    { "action": "Action", "impact": "Impact", "effort": "low|medium|high" }
  ]
}

STRICT RULES — follow exactly:

1. ANCHORING: Start from the EXACT original steps provided in rawProcesses. Use the SAME step names as the original where a step is retained (even if modified). Only rename a step if its purpose fundamentally changes.

2. STRUCTURE: Each optimised process MUST preserve the original process name exactly. The redesigned flow should be a clear evolution of the original, not a completely different process.

3. STEP HANDLING:
   - Keep original steps that are fine as-is (automated:false, changed:false, isNew:false)
   - Mark steps you're automating with automated:true and changed:true
   - Mark modified steps with changed:true
   - Mark genuinely new steps with isNew:true
   - Do NOT include removed steps — document them only in changeLog
   - Preserve the original department assignments unless there's a specific reason to change them

4. DECISION POINTS: If the original process has decision points (isDecision:true), KEEP them in the redesign. You may simplify what happens after, but the decision itself should remain. For new decisions, set isDecision:true with branches array. Each branch needs "label" and "target" (format: "Step N" where N is the step number). The default/happy path is always the next sequential step — only add branches for non-default outcomes.

5. CONSISTENCY: For a given set of input data, there is ONE correct redesign. Do not introduce creative variation. Apply standard process optimisation: automate data entry, eliminate unnecessary handoffs, merge adjacent steps in the same department, add validation where errors are flagged, parallelize where possible.

6. DEPARTMENTS: Use the exact same department names from the original data. Do not invent new department names.

7. CHANGELOG: Reference exact original step names. Every removed/merged/changed step must appear here.

8. EFFICIENCY GAINS: Reference specific steps or handoffs. Be concrete, not generic.`;

    const userPrompt = `Here is the diagnostic data for this organisation:\n\n${diagnosticContext}\n\nProduce the operating model redesign.`;

    const aiResp = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        temperature: 0,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userPrompt }
        ]
      })
    }, 45000);

    if (!aiResp.ok) {
      const errBody = await aiResp.text();
      console.error('Anthropic error:', aiResp.status, errBody);
      return res.status(502).json({ error: 'AI service returned an error. Please try again.' });
    }

    const aiData = await aiResp.json();
    const content = aiData.content?.[0]?.text;

    if (!content) {
      return res.status(502).json({ error: 'AI returned an empty response.' });
    }

    let redesign;
    try {
      let cleaned = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        cleaned = cleaned.substring(firstBrace, lastBrace + 1);
      }
      cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
      redesign = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('Failed to parse AI response:', parseErr.message, 'Full content length:', content.length, 'First 500 chars:', content.substring(0, 500), 'Last 500 chars:', content.substring(content.length - 500));

      try {
        let fallback = content;
        const fb = fallback.indexOf('{');
        const lb = fallback.lastIndexOf('}');
        if (fb !== -1 && lb > fb) {
          fallback = fallback.substring(fb, lb + 1);
          fallback = fallback.replace(/,\s*([}\]])/g, '$1');
          fallback = fallback.replace(/[\x00-\x1F\x7F]/g, function(c) { return c === '\n' || c === '\r' || c === '\t' ? c : ''; });
          redesign = JSON.parse(fallback);
        } else {
          throw parseErr;
        }
      } catch (fallbackErr) {
        console.error('Fallback parse also failed:', fallbackErr.message);
        return res.status(502).json({ error: 'AI response was not valid JSON. Please try again.' });
      }
    }

    try {
      if (sourceTable === 'diagnostic_reports') {
        const updatedData = { ...d, redesign };
        await fetch(`${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}`, {
          method: 'PATCH',
          headers: { ...sbHeaders, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({ diagnostic_data: updatedData })
        });
      } else {
        await fetch(`${supabaseUrl}/rest/v1/diagnostics?id=eq.${reportId}`, {
          method: 'PATCH',
          headers: { ...sbHeaders, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({ redesign: JSON.stringify(redesign) })
        });
      }
    } catch (cacheErr) {
      console.error('Failed to cache redesign:', cacheErr);
    }

    return res.status(200).json({
      success: true,
      reportId,
      redesign
    });

  } catch (error) {
    console.error('Generate redesign error:', error);
    return res.status(500).json({ error: 'Failed to generate operating model redesign.' });
  }
};
