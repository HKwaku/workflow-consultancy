import { NextResponse } from 'next/server';
import crypto from 'crypto';

export async function POST(request) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  try {
    const { reportId, email, processName, instanceName, status, notes } = await request.json();
    if (!processName || !status) return NextResponse.json({ error: 'processName and status are required.' }, { status: 400 });

    const validStatuses = ['started', 'in-progress', 'waiting', 'stuck', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) return NextResponse.json({ error: `Invalid status. Use one of: ${validStatuses.join(', ')}` }, { status: 400 });

    const payload = {
      id: crypto.randomUUID(), report_id: reportId || null, email: email || null,
      process_name: processName, instance_name: instanceName || null,
      status, notes: notes || null, logged_at: new Date().toISOString()
    };

    const sbResp = await fetch(`${supabaseUrl}/rest/v1/process_instances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Prefer': 'return=minimal' },
      body: JSON.stringify(payload)
    });

    if (!sbResp.ok) return NextResponse.json({ error: 'Failed to log instance.' }, { status: 502 });
    return NextResponse.json({ success: true, instanceId: payload.id });
  } catch (error) {
    console.error('Log instance error:', error);
    return NextResponse.json({ error: 'Failed to log instance.' }, { status: 500 });
  }
}

export async function GET(request) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  try {
    const sp = request.nextUrl.searchParams;
    const email = sp.get('email');
    const reportId = sp.get('reportId');
    const processName = sp.get('processName');
    const lim = sp.get('limit');

    if (!email && !reportId) return NextResponse.json({ error: 'email or reportId is required.' }, { status: 400 });

    let filter = '';
    if (email) filter = `email=ilike.${encodeURIComponent(email.toLowerCase())}`;
    else filter = `report_id=eq.${encodeURIComponent(reportId)}`;
    if (processName) filter += `&process_name=eq.${encodeURIComponent(processName)}`;

    const rowLimit = Math.min(parseInt(lim) || 200, 500);
    const url = `${supabaseUrl}/rest/v1/process_instances?${filter}&select=*&order=logged_at.desc&limit=${rowLimit}`;

    const sbResp = await fetch(url, {
      method: 'GET',
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Accept': 'application/json' }
    });

    if (!sbResp.ok) return NextResponse.json({ error: 'Failed to fetch instances.' }, { status: 502 });
    const rows = await sbResp.json();

    const byProcess = {};
    rows.forEach(r => {
      const key = r.process_name || 'Unknown';
      if (!byProcess[key]) byProcess[key] = { started: 0, completed: 0, stuck: 0, waiting: 0, cancelled: 0, inProgress: 0, instances: [] };
      byProcess[key][r.status === 'in-progress' ? 'inProgress' : r.status] = (byProcess[key][r.status === 'in-progress' ? 'inProgress' : r.status] || 0) + 1;
      byProcess[key].instances.push(r);
    });

    Object.keys(byProcess).forEach(proc => {
      const instances = byProcess[proc].instances;
      const completed = instances.filter(i => i.status === 'completed');
      const started = instances.filter(i => i.status === 'started');
      const completionTimes = [];
      completed.forEach(c => {
        const match = started.find(s => s.instance_name && s.instance_name === c.instance_name);
        if (match) {
          const days = (new Date(c.logged_at) - new Date(match.logged_at)) / (1000 * 60 * 60 * 24);
          if (days > 0 && days < 365) completionTimes.push(days);
        }
      });
      byProcess[proc].avgCompletionDays = completionTimes.length > 0
        ? Math.round(completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length * 10) / 10
        : null;
      byProcess[proc].totalInstances = instances.length;
    });

    return NextResponse.json({ success: true, totalEvents: rows.length, processes: byProcess, recentEvents: rows.slice(0, 20) });
  } catch (error) {
    console.error('Get instances error:', error);
    return NextResponse.json({ error: 'Failed to retrieve instances.' }, { status: 500 });
  }
}
