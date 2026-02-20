// lib/fetch-report.js
// Shared helper for fetching diagnostic reports with legacy table fallback.
// Tries `diagnostic_reports` first, falls back to `diagnostics` if not found.

const { getSupabaseHeaders, fetchWithTimeout } = require('./api-helpers');

/**
 * Parse a legacy diagnostics row's JSON string fields safely.
 */
function parseLegacyJSON(value, label) {
  if (!value) return [];
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (e) {
    console.error(`Failed to parse ${label}:`, e.message);
    return [];
  }
}

/**
 * Convert a legacy `diagnostics` table row into the `diagnostic_reports` shape.
 */
function normaliseLegacyRow(d) {
  const procs = parseLegacyJSON(d.processes, 'processes');
  const recs = parseLegacyJSON(d.recommendations, 'recommendations');
  const factors = parseLegacyJSON(d.lead_score_factors, 'lead_score_factors');

  return {
    id: d.id,
    contact_email: d.email,
    contact_name: d.name || '',
    company: d.company || '',
    lead_score: d.lead_score || 0,
    lead_grade: d.lead_grade || '',
    diagnostic_data: {
      contact: {
        name: d.name, email: d.email, company: d.company,
        title: d.title, phone: d.phone, industry: d.industry, teamSize: d.team_size
      },
      summary: {
        totalProcesses: d.total_processes || 0,
        totalAnnualCost: d.annual_process_cost || 0,
        potentialSavings: d.potential_savings || 0,
        analysisType: d.analysis_type || 'rule-based',
        qualityScore: d.quality_score || 0
      },
      automationScore: {
        percentage: d.automation_percentage || 0,
        grade: d.automation_grade || 'N/A',
        insight: d.automation_insight || ''
      },
      recommendations: recs,
      processes: procs,
      rawProcesses: [],
      roadmap: (d.quick_wins || d.agent_items || d.human_loop_items || d.multi_agent_items) ? {
        phases: {
          quick: { items: new Array(d.quick_wins || 0) },
          agent: { items: new Array(d.agent_items || 0) },
          human: { items: new Array(d.human_loop_items || 0) },
          multi: { items: new Array(d.multi_agent_items || 0) }
        },
        totalSavings: d.roadmap_total_savings || 0
      } : null,
      leadScore: { score: d.lead_score || 0, grade: d.lead_grade || '', factors }
    },
    pdf_base64: null,
    created_at: d.completed_at || d.created_at,
    _source: 'diagnostics'
  };
}

module.exports = { parseLegacyJSON, normaliseLegacyRow };
