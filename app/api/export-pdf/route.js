import { getSupabaseHeaders, requireSupabase, fetchWithTimeout, getRequestId, checkOrigin } from '@/lib/api-helpers';
import { logger } from '@/lib/logger';

function formatCurrency(val) {
  if (!val) return '£0';
  if (val >= 1000000) return '£' + (val / 1000000).toFixed(1) + 'M';
  if (val >= 1000) return '£' + (val / 1000).toFixed(0) + 'K';
  return '£' + Math.round(val);
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function normaliseRecs(recs) {
  if (!Array.isArray(recs)) return [];
  return recs.map((r) => ({
    process: r.process || '',
    text: (r.action || r.text || '').replace(/<[^>]*>/g, '').trim(),
    effortLevel: r.effortLevel || '',
  })).filter((r) => r.text).slice(0, 5);
}

export async function GET(request) {
  const originErr = checkOrigin(request);
  if (originErr) return new Response(JSON.stringify({ error: originErr.error }), { status: originErr.status });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return new Response('Report ID required', { status: 400 });

  const sbConfig = requireSupabase();
  if (!sbConfig) return new Response('Storage not configured', { status: 503 });
  const { url: supabaseUrl, key: supabaseKey } = sbConfig;

  try {
    const resp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${encodeURIComponent(id)}&select=contact_name,company,contact_email,created_at,diagnostic_data,total_annual_cost,potential_savings,automation_percentage`,
      { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
    );
    if (!resp.ok) return new Response('Report not found', { status: 404 });
    const rows = await resp.json().catch(() => []);
    if (!rows.length) return new Response('Report not found', { status: 404 });

    const row = rows[0];
    const d = row.diagnostic_data || {};
    const s = d.summary || {};
    const auto = d.automationScore || {};
    const c = d.contact || {};
    const recs = normaliseRecs(d.recommendations);
    const redesign = d.redesign || null;

    const company = row.company || c.company || 'Your Company';
    const contactName = row.contact_name || c.name || '';
    const auditDate = formatDate(row.created_at);
    const totalCost = formatCurrency(row.total_annual_cost || s.totalAnnualCost);
    const savings = formatCurrency(s.potentialSavings);
    const autoPct = Math.round(auto.percentage || 0);
    const grade = auto.grade || '–';
    const processes = d.processes || [];
    const avgCycleDays = processes.length
      ? Math.round(processes.reduce((sum, p) => sum + (p.elapsedDays || 0), 0) / processes.length)
      : null;

    const roadmap = redesign?.implementationPriority?.slice(0, 5) || [];

    const recRows = recs.map((r) => `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155;line-height:1.5;">${r.process ? `<strong>${r.process}:</strong> ` : ''}${r.text}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#64748b;white-space:nowrap;">${r.effortLevel || '–'}</td>
      </tr>`).join('');

    const roadmapItems = roadmap.map((ip, i) => {
      const text = typeof ip === 'object' ? (ip.action || ip.description || '') : String(ip);
      const phase = typeof ip === 'object' && ip.effort ? ip.effort : (['Quick Win', 'Short-term', 'Medium-term', 'Long-term'][i] || '');
      return `<li style="margin-bottom:8px;font-size:13px;color:#334155;"><strong style="color:#0d9488;">${phase}:</strong> ${text.replace(/^\d+\.\s*/, '')}</li>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Process Audit Report — ${company}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1e293b; background: #fff; padding: 40px; max-width: 800px; margin: 0 auto; }
  h1 { font-size: 26px; font-weight: 700; margin-bottom: 4px; }
  h2 { font-size: 16px; font-weight: 700; margin-bottom: 12px; color: #1e293b; border-bottom: 2px solid #0d9488; padding-bottom: 6px; }
  .header { margin-bottom: 32px; }
  .header-meta { font-size: 13px; color: #64748b; margin-top: 6px; }
  .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 32px; }
  .metric { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; text-align: center; }
  .metric-value { font-size: 28px; font-weight: 700; color: #0d9488; }
  .metric-label { font-size: 12px; color: #64748b; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.05em; }
  .section { margin-bottom: 28px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f1f5f9; padding: 8px 10px; text-align: left; font-size: 12px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.05em; }
  .auto-bar-wrap { background: #e2e8f0; border-radius: 999px; height: 10px; margin: 8px 0; overflow: hidden; }
  .auto-bar { background: linear-gradient(90deg, #0d9488, #6366f1); height: 100%; border-radius: 999px; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; }
  @media print {
    body { padding: 20px; }
    @page { margin: 20mm; }
  }
</style>
</head>
<body>
<div class="header">
  <div style="font-size:14px;font-weight:700;color:#0d9488;margin-bottom:8px;">Vesno.</div>
  <h1>Process Audit Report</h1>
  <p style="font-size:20px;color:#475569;margin-top:4px;">${company}</p>
  <div class="header-meta">
    ${contactName ? `Prepared for: ${contactName} &nbsp;·&nbsp; ` : ''}
    Audit date: ${auditDate}
    ${processes.length ? ` &nbsp;·&nbsp; ${processes.length} process${processes.length !== 1 ? 'es' : ''} audited` : ''}
  </div>
</div>

<div class="section">
  <h2>Key Metrics</h2>
  <div class="metrics">
    <div class="metric">
      <div class="metric-value">${totalCost}</div>
      <div class="metric-label">Total Annual Cost</div>
    </div>
    <div class="metric">
      <div class="metric-value">${savings}</div>
      <div class="metric-label">Potential Savings</div>
    </div>
    <div class="metric">
      <div class="metric-value">${autoPct}%</div>
      <div class="metric-label">Automation Ready (${grade})</div>
    </div>
  </div>
  <div class="auto-bar-wrap">
    <div class="auto-bar" style="width:${autoPct}%;"></div>
  </div>
  ${avgCycleDays != null ? `<p style="font-size:13px;color:#64748b;margin-top:8px;">Average cycle time: <strong>${avgCycleDays} days</strong></p>` : ''}
</div>

${recs.length > 0 ? `
<div class="section">
  <h2>Top Recommendations</h2>
  <table>
    <thead><tr><th>Recommendation</th><th>Effort</th></tr></thead>
    <tbody>${recRows}</tbody>
  </table>
</div>` : ''}

${roadmap.length > 0 ? `
<div class="section">
  <h2>Implementation Roadmap</h2>
  <ol style="padding-left:20px;">${roadmapItems}</ol>
</div>` : ''}

<div class="footer">
  Generated by Vesno · Process Intelligence Platform · vesno.ai
  <br>This report is AI-generated from the information provided. Validate with your team before acting on recommendations.
</div>

<script>window.onload = function() { window.print(); }</script>
</body>
</html>`;

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    logger.error('Export PDF error', { requestId: getRequestId(request), error: err.message });
    return new Response('Failed to generate report', { status: 500 });
  }
}
