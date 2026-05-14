/**
 * GET /api/operating-models/[id]/processes
 *
 * Returns processes (diagnostic_reports) anchored to this model. Optional
 * `?capability=<id>` filter for files-under-this-capability views; pass
 * `?capability=null` for the unfiled bucket.
 *
 * Sorts by function_id then updated_at desc so the workspace can group
 * client-side.
 */

import { NextResponse } from 'next/server';
import { isValidUUID, getSupabaseHeaders, fetchWithTimeout, requireSupabase } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveModelAccess } from '@/lib/operatingModel/auth';
import { deriveProcessMetrics, deriveCostByFunction } from '@/lib/processMetrics';

export const maxDuration = 10;

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Valid model id required.' }, { status: 400 });

  const access = await resolveModelAccess({ modelId: id, email: auth.email, userId: auth.userId });
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

  const sp = request.nextUrl.searchParams;
  const capability = sp.get('capability');
  const limit = Math.max(10, Math.min(Number(sp.get('limit') || 200), 500));

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  let filter = `operating_model_id=eq.${encodeURIComponent(id)}`;
  if (capability === 'null') filter += '&function_id=is.null';
  else if (capability && isValidUUID(capability)) filter += `&function_id=eq.${encodeURIComponent(capability)}`;

  // Living-workspace migration: total_annual_cost, potential_savings,
  // automation_percentage, state_kind, design_owner_email, diagnostic_mode
  // columns are gone. flow_data replaces diagnostic_data. The function_ids
  // derivation still walks the JSONB to populate the spans-multiple-functions
  // badge.
  const select = 'id,company,contact_name,contact_email,' +
                 'function_id,' +
                 'created_at,updated_at,flow_data';

  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/processes?${filter}&select=${encodeURIComponent(select)}` +
        `&order=function_id.asc.nullslast,updated_at.desc&limit=${limit}`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    );
    if (!resp.ok) return NextResponse.json({ error: 'Failed to load processes.' }, { status: 502 });
    const raw = await resp.json();

    // Project: for each row, derive `function_ids` (step-tagged functions
    // — drives the "spans multiple" badge) + `cost_by_function`
    // (workMinutes-weighted attribution; powers the graph view's cost
    // heatmap and owner-mismatch flag). Then drop the heavy flow_data
    // field so we don't ship the whole JSONB to the client.
    const processes = raw.map((r) => {
      const dd = r.flow_data || {};
      const procs = Array.isArray(dd.rawProcesses) ? dd.rawProcesses
                  : Array.isArray(dd.processes)    ? dd.processes
                  : [];
      const ids = new Set();
      for (const proc of procs) {
        const steps = Array.isArray(proc?.steps) ? proc.steps : [];
        for (const step of steps) {
          const sid = step?.functionId || step?.function_id || step?.capabilityId || step?.capability_id;
          if (sid) ids.add(sid);
        }
      }
      // Surface the first process's name so the workspace can label rows
      // by the actual process ("Cash collection", "Order fulfilment") rather
      // than the company. Falls back to null when the JSONB has no name.
      const processName = procs[0]?.name || null;
      const m = deriveProcessMetrics(r);
      const annualCost = Number(m.total_annual_cost) || 0;
      const cost_by_function = deriveCostByFunction({
        rawProcesses: procs,
        declaredFunctionId: r.function_id || null,
        annualCost,
      });
      const { flow_data: _omit, ...rest } = r;
      return {
        ...rest,
        function_ids: [...ids],
        process_name: processName,
        total_annual_cost: annualCost,
        potential_savings: m.potential_savings,
        automation_percentage: m.automation_percentage,
        automation_grade: m.automation_grade,
        cost_by_function,
      };
    });

    return NextResponse.json({ processes });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to load processes.' }, { status: 502 });
  }
}
