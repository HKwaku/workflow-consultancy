/**
 * GET /api/me/recent-processes?limit=3&operatingModelId=…&dealId=…
 *
 * Returns the calling user's most-recently-touched processes — for the
 * "Continue mapping" row above the chat input.
 *
 * Context filters (mutually exclusive priority):
 *   • dealId             → only this deal's processes (any participant)
 *   • operatingModelId   → only processes anchored to this model
 *   • neither            → user's own recent processes (contact_email match)
 */

import { NextResponse } from 'next/server';
import { getSupabaseHeaders, fetchWithTimeout, requireSupabase, isValidUUID } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';

export const maxDuration = 8;

export async function GET(request) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const sp = request.nextUrl.searchParams;
  const limit = Math.max(1, Math.min(Number(sp.get('limit') || 3), 10));
  const operatingModelId = sp.get('operatingModelId');
  const dealId           = sp.get('dealId');

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ processes: [] });

  // flow_data is included so the client can derive the process name
  // (rawProcesses[0].name) and the API can fall back gracefully when
  // the row has no contact_name. process_name is projected to make the
  // client's rendering simpler.
  const select = 'id,company,contact_name,function_id,operating_model_id,deal_id,flow_data,updated_at';

  // Build the filter chain. Scope filters dominate; only fall through
  // to email when no scope is given. Email match makes recent-processes
  // useful even when the user has no anchored model yet.
  let filter;
  if (dealId && isValidUUID(dealId)) {
    filter = `deal_id=eq.${encodeURIComponent(dealId)}`;
  } else if (operatingModelId && isValidUUID(operatingModelId)) {
    filter = `operating_model_id=eq.${encodeURIComponent(operatingModelId)}`;
  } else {
    filter = `contact_email=ilike.${encodeURIComponent(auth.email.toLowerCase())}`;
  }

  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/processes?${filter}` +
        `&select=${encodeURIComponent(select)}` +
        `&order=updated_at.desc&limit=${limit}`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    );
    if (!resp.ok) return NextResponse.json({ processes: [] });
    const rows = await resp.json();
    const processes = (rows || []).map((r) => {
      const dd = r.flow_data || {};
      const procs = Array.isArray(dd.rawProcesses) ? dd.rawProcesses
                  : Array.isArray(dd.processes)    ? dd.processes
                  : [];
      const processName = procs[0]?.name || procs[0]?.processName || null;
      // Strip flow_data from the wire — the card only needs the name.
      const { flow_data: _omit, ...rest } = r;
      return { ...rest, process_name: processName };
    });
    return NextResponse.json({ processes });
  } catch {
    return NextResponse.json({ processes: [] });
  }
}
