/**
 * GET /api/operating-models/[id]/processes/[processId]/detail
 *
 * Full process detail for the workspace design surface — diagnostic_data
 * (current state), target_data, plus a small summary block. Open to any
 * org member of the model's org (vs the existing /api/get-diagnostic which
 * gates on contact_email — that one's the public-by-id path).
 *
 * Returns: { report: { id, company, ..., diagnostic_data, target_data, ... } }
 */

import { NextResponse } from 'next/server';
import {
  isValidUUID, getSupabaseHeaders, fetchWithTimeout, requireSupabase,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveModelAccess } from '@/lib/operatingModel/auth';
import { deriveProcessMetrics } from '@/lib/processMetrics';
import { loadChanges } from '@/lib/changes/repo';
import { decidedSavingsFromChanges } from '@/lib/changes/savings';

export const maxDuration = 10;

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id, processId } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Valid model id required.' }, { status: 400 });
  if (!processId || typeof processId !== 'string' || processId.length > 64) {
    return NextResponse.json({ error: 'Valid report id required.' }, { status: 400 });
  }

  const access = await resolveModelAccess({ modelId: id, email: auth.email, userId: auth.userId });
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  // Living-workspace migration: state_kind, design_owner_email, target_data,
  // diagnostic_mode, total_annual_cost, potential_savings, automation_percentage
  // columns are gone. Cost / savings derive on-demand from flow_data.
  const select = 'id,company,contact_name,contact_email,' +
                 'function_id,operating_model_id,' +
                 'flow_data,' +
                 'created_at,updated_at';

  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/processes?id=eq.${encodeURIComponent(processId)}` +
      `&operating_model_id=eq.${encodeURIComponent(id)}` +
      `&select=${encodeURIComponent(select)}&limit=1`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  if (!resp.ok) return NextResponse.json({ error: 'Failed to load process.' }, { status: 502 });
  const [report] = await resp.json();
  if (!report) return NextResponse.json({ error: 'Process not found in this model.' }, { status: 404 });

  // Echo legacy keys so existing clients (the design surface) keep
  // reading the response. diagnostic_data mirrors flow_data; target_data
  // is permanently null. Cost / savings / automation derived from JSONB.
  const m = deriveProcessMetrics(report);
  // Potential savings = accepted/decided changes only (£0 until decided).
  const decidedChanges = await loadChanges({ reportId: processId, limit: 500 });
  const potentialSavings = decidedSavingsFromChanges(decidedChanges, m.total_annual_cost);
  return NextResponse.json({
    report: {
      ...report,
      diagnostic_data: report.flow_data || {},
      target_data: null,
      state_kind: null,
      total_annual_cost:     m.total_annual_cost,
      potential_savings:     potentialSavings,
      automation_percentage: m.automation_percentage,
      automation_grade:      m.automation_grade,
    },
  });
}
