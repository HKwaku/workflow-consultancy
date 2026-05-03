/**
 * findingsRepo — read/write the `deal_findings` table.
 *
 * The relational store for AI-generated findings. Replaces direct JSONB
 * access in `deal_analyses.result` for everything except the raw audit
 * archive (JSONB still kept around as the model's untouched output).
 *
 * Three entry points:
 *
 *   persistFindingsForAnalysis({ analysisId, dealId, bundle, executiveSummary })
 *     UPSERTs findings keyed on (analysis_id, finding_key). Re-running an
 *     analysis with the same key updates the row in place — preserves
 *     review-row linkage. The `bundle` is the per-section grouping from
 *     normaliseFindings(); the `executiveSummary` is the singleton.
 *
 *   loadFindingsForAnalysis(analysisId)
 *     Returns a flat array of finding rows ordered by (section, order_index).
 *
 *   hydrateAnalysisFromFindings(analysisRow, findings)
 *     Rebuilds the in-memory shape the renderer + applyReviewsToAnalysis
 *     expect: `{ summary, executiveSummary, technologyLandscape: [...], ... }`.
 *     Lets us keep the entire downstream stack unchanged while moving the
 *     storage underneath.
 */

import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase,
} from '../api-helpers.js';
import { logger } from '../logger.js';

const ARRAY_SECTIONS = [
  'mergeRecommendations', 'opportunities', 'integrationRisks', 'risks',
  'redFlags', 'keyFindings',
  'technologyLandscape', 'operationalFootprint', 'organisation',
];
const SINGLETON_SECTIONS = ['executiveSummary'];

function findingToRow({ analysisId, dealId, section, orderIndex, finding }) {
  return {
    analysis_id: analysisId,
    deal_id: dealId,
    finding_key: finding.key,
    section,
    order_index: orderIndex,
    title: String(finding.title || '').slice(0, 500),
    body: String(finding.body || '').slice(0, 4000),
    category: String(finding.category || section).slice(0, 80),
    severity: ['low', 'medium', 'high', 'critical'].includes(finding.severity)
      ? finding.severity : 'medium',
    confidence: Math.max(0, Math.min(1, Number(finding.confidence) || 0.5)),
    impact: Array.isArray(finding.impact) ? finding.impact : [],
    evidence: Array.isArray(finding.evidence) ? finding.evidence : [],
    recommendations: Array.isArray(finding.recommendations) ? finding.recommendations : [],
  };
}

/**
 * Persist a normalised findings bundle to deal_findings via UPSERT.
 *
 * @returns {Promise<{ written: number, errors: number }>}
 */
export async function persistFindingsForAnalysis({ analysisId, dealId, bundle, executiveSummary }) {
  if (!analysisId || !dealId) return { written: 0, errors: 0 };
  const sb = requireSupabase();
  if (!sb) return { written: 0, errors: 0 };

  const rows = [];

  if (executiveSummary && executiveSummary.key) {
    rows.push(findingToRow({
      analysisId, dealId,
      section: 'executiveSummary',
      orderIndex: 0,
      finding: executiveSummary,
    }));
  }

  for (const section of ARRAY_SECTIONS) {
    const arr = bundle?.perPath?.[section];
    if (!Array.isArray(arr)) continue;
    arr.forEach((finding, idx) => {
      if (finding?.key) {
        rows.push(findingToRow({ analysisId, dealId, section, orderIndex: idx, finding }));
      }
    });
  }

  if (rows.length === 0) return { written: 0, errors: 0 };

  // PostgREST UPSERT via on_conflict + Prefer: resolution=merge-duplicates.
  // Batch in chunks of 100 to keep request size reasonable.
  let written = 0;
  let errors = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const slice = rows.slice(i, i + 100);
    try {
      const resp = await fetchWithTimeout(
        `${sb.url}/rest/v1/deal_findings?on_conflict=analysis_id,finding_key`,
        {
          method: 'POST',
          headers: {
            ...getSupabaseWriteHeaders(sb.key),
            Prefer: 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify(slice),
        },
      );
      if (resp.ok) {
        written += slice.length;
      } else {
        errors += slice.length;
        const txt = await resp.text().catch(() => '');
        logger.error('persistFindingsForAnalysis batch failed', {
          analysisId, status: resp.status, body: txt.slice(0, 300),
        });
      }
    } catch (e) {
      errors += slice.length;
      logger.error('persistFindingsForAnalysis batch threw', { analysisId, error: e.message });
    }
  }
  return { written, errors };
}

/**
 * Load all findings for an analysis ordered by (section, order_index).
 *
 * @returns {Promise<Array>} raw rows; use hydrateAnalysisFromFindings() to
 *                            reshape into the renderer's expected JSON.
 */
export async function loadFindingsForAnalysis(analysisId) {
  if (!analysisId) return [];
  const sb = requireSupabase();
  if (!sb) return [];

  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_findings?analysis_id=eq.${encodeURIComponent(analysisId)}` +
      `&select=id,finding_key,section,order_index,title,body,category,severity,confidence,impact,evidence,recommendations,tags,stale,stale_reason,stale_at` +
      `&order=section.asc,order_index.asc`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  if (!resp.ok) {
    logger.warn('loadFindingsForAnalysis fetch failed', { analysisId, status: resp.status });
    return [];
  }
  return await resp.json();
}

/**
 * Reshape a flat list of finding rows into the canonical JSON the renderer
 * + applyReviewsToAnalysis + the PPTX exporter all expect.
 *
 * Inputs:
 *   - analysisRow: the original `deal_analyses` row. We pull non-finding
 *     narrative fields (`summary`, `proposedProcess`, `phasing`, etc.) from
 *     its `result` JSONB so the rest of the shape isn't lost.
 *   - findings: array of rows from loadFindingsForAnalysis().
 *
 * Output: an object shaped identically to what the renderer used to read
 * directly from `analysisRow.result`. The renderer doesn't change.
 */
export function hydrateAnalysisFromFindings(analysisRow, findings) {
  // Start from the raw JSONB so non-finding fields (`summary`,
  // `proposedProcess`, `phasing`, `removedSteps`, `adoptionNotes`, etc.)
  // are preserved. Then OVERWRITE the finding-bearing arrays from the
  // relational rows so the table is the source of truth for those.
  const out = analysisRow?.result ? { ...analysisRow.result } : {};

  // Reset all finding-bearing slots so stale JSONB doesn't mix with table data.
  for (const s of ARRAY_SECTIONS) out[s] = [];
  for (const s of SINGLETON_SECTIONS) out[s] = null;

  for (const row of findings || []) {
    const finding = rowToFinding(row);
    if (SINGLETON_SECTIONS.includes(row.section)) {
      out[row.section] = finding;
    } else if (ARRAY_SECTIONS.includes(row.section)) {
      out[row.section].push(finding);
    }
  }

  // Drop empty array sections so the renderer's existing "is this empty?"
  // checks behave the same as before. (Don't drop singleton nulls — those
  // are meaningful: "this analysis has no exec summary".)
  for (const s of ARRAY_SECTIONS) {
    if (Array.isArray(out[s]) && out[s].length === 0) delete out[s];
  }

  return out;
}

function rowToFinding(row) {
  return {
    key: row.finding_key,
    title: row.title,
    body: row.body || '',
    category: row.category || 'general',
    severity: row.severity,
    confidence: Number(row.confidence),
    impact: Array.isArray(row.impact) ? row.impact : [],
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    recommendations: Array.isArray(row.recommendations) ? row.recommendations : [],
  };
}

/**
 * Convenience: load + hydrate in one call. Most route handlers want this.
 */
export async function loadHydratedAnalysis(analysisRow) {
  if (!analysisRow?.id) return analysisRow?.result || {};
  const findings = await loadFindingsForAnalysis(analysisRow.id);
  return hydrateAnalysisFromFindings(analysisRow, findings);
}

// Re-export for tests
export const __sections = { ARRAY_SECTIONS, SINGLETON_SECTIONS };
