/**
 * GET /api/operating-models/[id]/system-processes?system_id=…[&match_key=…]
 *
 * Lists processes that touch a specific system. Works for both:
 *   - canonical (linked):    pass system_id=<uuid>
 *   - raw mention (unlinked): pass match_key=<lowercase name>
 *
 * Returns: { processes: [{ id, company, function_id, total_annual_cost, ... }] }
 *
 * Powered by joining process_systems → diagnostic_reports. Sorted by
 * updated_at desc, deduplicated (same report mentioned in N steps yields
 * one row). Read-only for any org member of the model's org.
 */

import { NextResponse } from 'next/server';
import {
  isValidUUID, getSupabaseHeaders, fetchWithTimeout, requireSupabase,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveModelAccess } from '@/lib/operatingModel/auth';
import { deriveProcessMetrics } from '@/lib/processMetrics';

export const maxDuration = 10;

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Valid model id required.' }, { status: 400 });

  const access = await resolveModelAccess({ modelId: id, email: auth.email, userId: auth.userId });
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

  const sp = request.nextUrl.searchParams;
  const systemId = sp.get('system_id');
  const matchKey = sp.get('match_key');
  if (!systemId && !matchKey) {
    return NextResponse.json({ error: 'Pass system_id or match_key.' }, { status: 400 });
  }
  if (systemId && !isValidUUID(systemId)) {
    return NextResponse.json({ error: 'system_id must be a uuid.' }, { status: 400 });
  }

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  // Filter process_systems by either system_id OR (operating_model + match_key
  // for the unlinked case). Embed the report so we can return it directly.
  let filter = `operating_model_id=eq.${encodeURIComponent(id)}`;
  if (systemId) filter += `&system_id=eq.${encodeURIComponent(systemId)}`;
  else          filter += `&match_key=eq.${encodeURIComponent(String(matchKey).toLowerCase())}&system_id=is.null`;

  // Living-workspace migration: process_systems.report_id renamed to
  // process_id; FK now points at the `processes` table. The embed name
  // changes to `process:` to match. state_kind, cost / savings /
  // automation columns dropped.
  const select = 'process_id,step_name,function_id,' +
    'process:process_id(id,company,contact_name,function_id,updated_at,flow_data)';

  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/process_systems?${filter}&select=${encodeURIComponent(select)}&limit=2000`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    );
    if (!resp.ok) return NextResponse.json({ error: 'Failed to load.' }, { status: 502 });
    const rows = await resp.json();

    // Dedupe by process id; keep the first-seen step_name as a context hint.
    const byReport = new Map();
    for (const r of rows) {
      if (!r.process) continue;
      if (!byReport.has(r.process.id)) {
        const m = deriveProcessMetrics(r.process);
        // Drop the heavy flow_data field from the wire payload.
        const { flow_data: _omit, ...rest } = r.process;
        byReport.set(r.process.id, {
          ...rest,
          total_annual_cost: m.total_annual_cost,
          potential_savings: m.potential_savings,
          automation_percentage: m.automation_percentage,
          automation_grade: m.automation_grade,
          step_mentions: 0,
          first_step_name: r.step_name || null,
        });
      }
      byReport.get(r.process.id).step_mentions += 1;
    }
    const processes = [...byReport.values()].sort((a, b) => {
      const ad = new Date(a.updated_at || 0).getTime();
      const bd = new Date(b.updated_at || 0).getTime();
      return bd - ad;
    });

    return NextResponse.json({ processes });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to load.' }, { status: 502 });
  }
}
