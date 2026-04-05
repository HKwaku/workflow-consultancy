import { NextResponse } from 'next/server';
import { getSupabaseHeaders, requireSupabase, fetchWithTimeout, getRequestId, checkOrigin } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export async function GET(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const { url: supabaseUrl, key: supabaseKey } = sbConfig;

  try {
    // Fetch all reports with the fields we need for aggregation
    const resp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/diagnostic_reports?select=segment,total_annual_cost,automation_percentage,diagnostic_data&cost_analysis_status=eq.complete`,
      { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
    );
    if (!resp.ok) return NextResponse.json({ error: 'Failed to fetch data.' }, { status: 502 });

    const rows = await resp.json().catch(() => []);

    // Aggregate by segment
    const bySegment = {};
    const byIndustry = {};
    const MIN_SAMPLE = 3; // don't expose benchmarks with fewer than 3 reports

    for (const row of rows) {
      const seg = row.segment || row.diagnostic_data?.contact?.segment || 'other';
      const industry = row.diagnostic_data?.rawProcesses?.[0]?.industry || row.diagnostic_data?.contact?.industry || null;
      const cost = parseFloat(row.total_annual_cost) || 0;
      const autoP = parseFloat(row.automation_percentage) || 0;
      const cycleDays = row.diagnostic_data?.rawProcesses?.[0]?.lastExample?.elapsedDays || null;

      if (seg && seg !== 'other') {
        if (!bySegment[seg]) bySegment[seg] = { costs: [], autoPs: [], cycleDays: [], count: 0 };
        bySegment[seg].costs.push(cost);
        bySegment[seg].autoPs.push(autoP);
        if (cycleDays) bySegment[seg].cycleDays.push(cycleDays);
        bySegment[seg].count++;
      }

      if (industry) {
        if (!byIndustry[industry]) byIndustry[industry] = { costs: [], autoPs: [], cycleDays: [], count: 0 };
        byIndustry[industry].costs.push(cost);
        byIndustry[industry].autoPs.push(autoP);
        if (cycleDays) byIndustry[industry].cycleDays.push(cycleDays);
        byIndustry[industry].count++;
      }
    }

    const median = (arr) => {
      if (!arr.length) return null;
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };

    const summarise = (group) => {
      if (group.count < MIN_SAMPLE) return null;
      return {
        count: group.count,
        medianAnnualCost: Math.round(median(group.costs) || 0),
        medianAutomationPct: Math.round(median(group.autoPs) || 0),
        medianCycleDays: group.cycleDays.length >= MIN_SAMPLE ? Math.round(median(group.cycleDays)) : null,
      };
    };

    const segmentBenchmarks = {};
    for (const [k, v] of Object.entries(bySegment)) {
      const s = summarise(v);
      if (s) segmentBenchmarks[k] = s;
    }

    const industryBenchmarks = {};
    for (const [k, v] of Object.entries(byIndustry)) {
      const s = summarise(v);
      if (s) industryBenchmarks[k] = s;
    }

    return NextResponse.json({
      success: true,
      totalReports: rows.length,
      bySegment: segmentBenchmarks,
      byIndustry: industryBenchmarks,
      minSampleSize: MIN_SAMPLE,
    });
  } catch (err) {
    logger.error('Benchmarks error', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Failed to compute benchmarks.' }, { status: 500 });
  }
}
