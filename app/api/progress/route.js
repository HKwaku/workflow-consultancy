import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSupabaseHeaders, isValidUUID, fetchWithTimeout, requireSupabase } from '@/lib/api-helpers';

export async function POST(request) {
  try {
    const body = await request.json();
    const { email, progressData, currentScreen, processName } = body;
    if (!progressData) return NextResponse.json({ error: 'Progress data is required.' }, { status: 400 });

    const payloadSize = JSON.stringify(progressData).length;
    if (payloadSize > 2 * 1024 * 1024) return NextResponse.json({ error: 'Progress data too large.' }, { status: 413 });

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    const progressId = body.progressId || crypto.randomUUID();
    const isUpdate = !!body.progressId;

    const proto = request.headers.get('x-forwarded-proto') || 'https';
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3000';
    const teamCode = progressData?.teamMode?.code;
    const resumeUrl = teamCode
      ? `${proto}://${host}/diagnostic?resume=${progressId}&team=${teamCode}`
      : `${proto}://${host}/diagnostic?resume=${progressId}`;

    const payload = {
      id: progressId, email: email || null, process_name: processName || null,
      current_screen: currentScreen || 0, progress_data: progressData, updated_at: new Date().toISOString()
    };
    if (!isUpdate) payload.created_at = new Date().toISOString();

    const sbResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/diagnostic_progress`, {
      method: 'POST',
      headers: { ...getSupabaseHeaders(supabaseKey), 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(payload)
    });

    if (!sbResp.ok && sbResp.status !== 201) {
      return NextResponse.json({ error: 'Failed to save progress.' }, { status: 502 });
    }

    let emailSent = false;
    if (email) {
      const webhookUrl = process.env.N8N_DIAGNOSTIC_WEBHOOK_URL || process.env.N8N_WEBHOOK_URL;
      const isValidUrl = webhookUrl && (webhookUrl.startsWith('http://') || webhookUrl.startsWith('https://'));
      if (isValidUrl) {
        try {
          const n8nResp = await fetch(webhookUrl, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestType: 'save-progress', progressId, resumeUrl, email, processName: processName || 'your diagnostic', currentScreen: currentScreen || 0, screenLabel: getScreenLabel(currentScreen), timestamp: new Date().toISOString() })
          });
          if (n8nResp.ok) emailSent = true;
        } catch (n8nErr) { console.warn('n8n webhook error:', n8nErr.message); }
      }
    }

    return NextResponse.json({
      success: true, progressId, resumeUrl, emailSent,
      message: emailSent ? 'Progress saved! A resume link has been sent to your email.' : email ? 'Progress saved! Email delivery is not configured, but you can use the link below.' : 'Progress saved!'
    });
  } catch (error) {
    console.error('Save progress error:', error);
    return NextResponse.json({ error: 'Failed to save progress.' }, { status: 500 });
  }
}

export async function GET(request) {
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Progress ID is required. Use ?id=xxx' }, { status: 400 });
    if (!isValidUUID(id)) return NextResponse.json({ error: 'Invalid progress ID format.' }, { status: 400 });

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    const url = `${supabaseUrl}/rest/v1/diagnostic_progress?id=eq.${id}&select=*`;
    const sbResp = await fetchWithTimeout(url, { method: 'GET', headers: getSupabaseHeaders(supabaseKey) });
    if (!sbResp.ok) return NextResponse.json({ error: 'Failed to fetch progress from storage.' }, { status: 502 });
    const rows = await sbResp.json();
    if (!rows || rows.length === 0) return NextResponse.json({ error: 'Saved progress not found.' }, { status: 404 });

    const progress = rows[0];
    const createdAt = new Date(progress.created_at || progress.updated_at);
    const ageDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > 30) return NextResponse.json({ error: 'This saved progress has expired (older than 30 days).' }, { status: 410 });

    return NextResponse.json({
      success: true,
      progress: { id: progress.id, email: progress.email, processName: progress.process_name, currentScreen: progress.current_screen, progressData: progress.progress_data, updatedAt: progress.updated_at, createdAt: progress.created_at }
    });
  } catch (error) {
    console.error('Load progress error:', error);
    return NextResponse.json({ error: 'Failed to retrieve saved progress.' }, { status: 500 });
  }
}

function getScreenLabel(screen) {
  const labels = { 0: 'Getting Started', 1: 'Process Selection', 2: 'Process Name', 3: 'Define Boundaries', 4: 'Last Example', 5: 'Time Investment', 6: 'Performance', 7: 'Steps & Handoffs', 8: 'Bottlenecks', 9: 'Systems & Tools', 10: 'Approvals', 11: 'Knowledge', 12: 'New Hire', 13: 'Frequency', 14: 'Cost Calculation', 15: 'Team Cost & Savings', 16: 'Priority', 17: 'Your Details', 18: 'Results' };
  return labels[screen] || 'In Progress';
}
