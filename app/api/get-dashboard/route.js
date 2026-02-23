import { NextResponse } from 'next/server';
import { isValidEmail, isValidReportId } from '@/lib/api-helpers';
import { createClient } from '@supabase/supabase-js';

export async function GET(request) {
  try {
    const email = request.nextUrl.searchParams.get('email');
    if (!email) return NextResponse.json({ error: 'Email is required. Use ?email=xxx' }, { status: 400 });
    if (!isValidEmail(email)) return NextResponse.json({ error: 'Invalid email format.' }, { status: 400 });

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !supabaseKey) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

    const supabase = createClient(supabaseUrl, supabaseKey);
    const emailLower = email.toLowerCase().trim();

    const { data: rows, error: sbError } = await supabase
      .from('diagnostic_reports')
      .select('id,contact_email,contact_name,company,lead_score,lead_grade,diagnostic_data,created_at')
      .ilike('contact_email', emailLower)
      .order('created_at', { ascending: false });

    if (sbError) {
      console.error('Supabase error:', sbError);
      return NextResponse.json({ error: 'Failed to fetch reports.' }, { status: 502 });
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json({ success: true, email: emailLower, totalReports: 0, reports: [], deltas: null });
    }

    const reports = rows.map(row => {
      const d = row.diagnostic_data || {};
      const summary = d.summary || {};
      const auto = d.automationScore || {};
      const procs = d.processes || [];
      return {
        id: row.id, company: row.company || d.contact?.company || '',
        contactName: row.contact_name || d.contact?.name || '',
        leadScore: row.lead_score, leadGrade: row.lead_grade, createdAt: row.created_at,
        metrics: {
          totalProcesses: summary.totalProcesses || procs.length || 0,
          totalAnnualCost: summary.totalAnnualCost || 0,
          potentialSavings: summary.potentialSavings || 0,
          automationPercentage: auto.percentage || 0,
          automationGrade: auto.grade || 'N/A',
          qualityScore: summary.qualityScore || 0,
          analysisType: summary.analysisType || 'rule-based'
        },
        processes: procs.map(p => ({ name: p.name || '', type: p.type || '', annualCost: p.annualCost || 0, elapsedDays: p.elapsedDays || 0, stepsCount: p.stepsCount || 0 })),
        recommendations: (d.recommendations || []).slice(0, 5).map(r => ({ type: r.type || 'general', text: r.text || '' })),
        roadmap: d.roadmap ? { quickWins: d.roadmap.phases?.quick?.items?.length || 0, totalSavings: d.roadmap.totalSavings || 0 } : null
      };
    });

    let deltas = null;
    if (reports.length >= 2) {
      const latest = reports[0].metrics;
      const previous = reports[1].metrics;
      deltas = {
        comparedTo: reports[1].createdAt,
        annualCost: { change: latest.totalAnnualCost - previous.totalAnnualCost, percentChange: previous.totalAnnualCost > 0 ? ((latest.totalAnnualCost - previous.totalAnnualCost) / previous.totalAnnualCost * 100) : 0, improved: latest.totalAnnualCost < previous.totalAnnualCost },
        potentialSavings: { change: latest.potentialSavings - previous.potentialSavings, percentChange: previous.potentialSavings > 0 ? ((latest.potentialSavings - previous.potentialSavings) / previous.potentialSavings * 100) : 0, improved: latest.potentialSavings > previous.potentialSavings },
        automationReadiness: { change: latest.automationPercentage - previous.automationPercentage, improved: latest.automationPercentage > previous.automationPercentage },
        processCount: { change: latest.totalProcesses - previous.totalProcesses },
        qualityScore: { change: latest.qualityScore - previous.qualityScore, improved: latest.qualityScore > previous.qualityScore }
      };
    }

    return NextResponse.json({ success: true, email: emailLower, totalReports: reports.length, reports, deltas });
  } catch (err) {
    console.error('Get dashboard error:', err);
    return NextResponse.json({ error: 'Failed to retrieve dashboard data.' }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const body = await request.json();
    const { reportId, email } = body || {};
    if (!reportId || !email) return NextResponse.json({ error: 'reportId and email are required.' }, { status: 400 });
    if (!isValidReportId(reportId)) return NextResponse.json({ error: 'Invalid report ID format.' }, { status: 400 });
    if (!isValidEmail(email)) return NextResponse.json({ error: 'Invalid email format.' }, { status: 400 });

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !supabaseKey) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

    const supabase = createClient(supabaseUrl, supabaseKey);
    const normalEmail = email.toLowerCase();

    const { data: checkRows, error: checkErr } = await supabase.from('diagnostic_reports').select('id,contact_email').eq('id', reportId).limit(1);
    if (checkErr || !checkRows || checkRows.length === 0) return NextResponse.json({ error: 'Report not found or already deleted.' }, { status: 404 });
    if (checkRows[0].contact_email?.toLowerCase() !== normalEmail) return NextResponse.json({ error: 'You can only delete your own reports.' }, { status: 403 });

    const { error: delErr } = await supabase.from('diagnostic_reports').delete().eq('id', reportId);
    if (delErr) return NextResponse.json({ error: 'Failed to delete report.' }, { status: 502 });
    return NextResponse.json({ success: true, message: 'Report deleted.' });
  } catch (err) {
    console.error('Delete report error:', err);
    return NextResponse.json({ error: 'Failed to delete report.' }, { status: 500 });
  }
}
