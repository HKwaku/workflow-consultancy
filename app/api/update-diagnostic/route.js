import { NextResponse } from 'next/server';
import { isValidUUID, isValidEmail, getSupabaseHeaders, getSupabaseWriteHeaders } from '@/lib/api-helpers';

export async function PUT(request) {
  try {
    const body = await request.json();
    const { reportId, email, updates } = body || {};

    if (!reportId || !isValidUUID(reportId))
      return NextResponse.json({ error: 'Valid report ID required.' }, { status: 400 });
    if (!email || !isValidEmail(email))
      return NextResponse.json({ error: 'Valid email required for ownership check.' }, { status: 400 });
    if (!updates || typeof updates !== 'object')
      return NextResponse.json({ error: 'Updates object required.' }, { status: 400 });

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !supabaseKey)
      return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

    const readUrl = `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}&select=id,contact_email,diagnostic_data`;
    const readResp = await fetch(readUrl, { headers: getSupabaseHeaders(supabaseKey) });
    if (!readResp.ok)
      return NextResponse.json({ error: 'Failed to read report.' }, { status: 502 });

    const rows = await readResp.json();
    if (!rows || rows.length === 0)
      return NextResponse.json({ error: 'Report not found.' }, { status: 404 });

    const existing = rows[0];
    if (existing.contact_email?.toLowerCase() !== email.toLowerCase())
      return NextResponse.json({ error: 'You do not have permission to edit this report.' }, { status: 403 });

    const dd = existing.diagnostic_data || {};

    const topLevelPatch = {};
    if (updates.contactName !== undefined) topLevelPatch.contact_name = updates.contactName;
    if (updates.contactEmail !== undefined) topLevelPatch.contact_email = updates.contactEmail;
    if (updates.company !== undefined) topLevelPatch.company = updates.company;
    if (updates.leadScore !== undefined) topLevelPatch.lead_score = updates.leadScore;
    if (updates.leadGrade !== undefined) topLevelPatch.lead_grade = updates.leadGrade;

    if (updates.contact) {
      dd.contact = { ...(dd.contact || {}), ...updates.contact };
    }

    if (updates.summary) {
      dd.summary = { ...(dd.summary || {}), ...updates.summary };
    }

    if (updates.automationScore) {
      dd.automationScore = { ...(dd.automationScore || {}), ...updates.automationScore };
    }

    if (updates.processes && Array.isArray(updates.processes)) {
      dd.processes = updates.processes;
    }

    if (updates.rawProcesses && Array.isArray(updates.rawProcesses)) {
      dd.rawProcesses = updates.rawProcesses;
    }

    if (updates.recommendations && Array.isArray(updates.recommendations)) {
      dd.recommendations = updates.recommendations;
    }

    if (updates.roadmap) {
      dd.roadmap = updates.roadmap;
    }

    if (updates.customDepartments && Array.isArray(updates.customDepartments)) {
      dd.customDepartments = updates.customDepartments;
    }

    const patchBody = {
      ...topLevelPatch,
      diagnostic_data: dd,
      updated_at: new Date().toISOString()
    };

    const writeUrl = `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}`;
    const writeResp = await fetch(writeUrl, {
      method: 'PATCH',
      headers: getSupabaseWriteHeaders(supabaseKey),
      body: JSON.stringify(patchBody)
    });

    if (!writeResp.ok) {
      const t = await writeResp.text();
      return NextResponse.json({ error: 'Write failed: ' + t }, { status: 502 });
    }

    return NextResponse.json({ success: true, message: 'Report updated.' });
  } catch (err) {
    console.error('Update diagnostic error:', err);
    return NextResponse.json({ error: 'Failed to update report.' }, { status: 500 });
  }
}
