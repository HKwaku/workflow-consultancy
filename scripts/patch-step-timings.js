#!/usr/bin/env node
/**
 * Patches step timings for a single diagnostic record.
 * Usage: node scripts/patch-step-timings.js <short-id>
 *   e.g. node scripts/patch-step-timings.js SH-NRCWX
 */

const fs = require('fs');
const path = require('path');

try {
  const envContent = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8');
  for (const line of envContent.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[k]) process.env[k] = v;
  }
} catch {}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_KEY');
  process.exit(1);
}

const shortId = (process.argv[2] || 'SH-NRCWX').toUpperCase();

async function supabase(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: method === 'GET' ? 'return=representation' : 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

// Dummy timing sets — varied to make reports interesting
const TIMING_PRESETS = [
  { workMinutes: 15,  waitMinutes: 60,  waitType: 'dependency', waitNote: 'Client data submission', waitExternal: true,  capacity: 1 },
  { workMinutes: 30,  waitMinutes: 240, waitType: 'capacity',   waitNote: 'Finance team',           waitExternal: false, capacity: 1 },
  { workMinutes: 45,  waitMinutes: 20,  waitType: 'wip',        waitNote: null,                     waitExternal: null,  capacity: 2 },
  { workMinutes: 10,  waitMinutes: 480, waitType: 'blocked',    waitNote: 'Missing approval criteria from management', waitExternal: false, capacity: 1 },
  { workMinutes: 60,  waitMinutes: 30,  waitType: 'capacity',   waitNote: 'Senior reviewer',        waitExternal: false, capacity: 1 },
  { workMinutes: 20,  waitMinutes: 120, waitType: 'dependency', waitNote: 'Legal sign-off',         waitExternal: true,  capacity: 1 },
  { workMinutes: 90,  waitMinutes: 10,  waitType: 'wip',        waitNote: null,                     waitExternal: null,  capacity: 3 },
  { workMinutes: 25,  waitMinutes: 360, waitType: 'blocked',    waitNote: 'System access not provisioned', waitExternal: false, capacity: 1 },
  { workMinutes: 15,  waitMinutes: 45,  waitType: 'dependency', waitNote: 'Third-party verification', waitExternal: true, capacity: 1 },
  { workMinutes: 40,  waitMinutes: 15,  waitType: 'wip',        waitNote: null,                     waitExternal: null,  capacity: 2 },
];

async function main() {
  console.log(`Looking up record with short_id = ${shortId}…`);

  const rows = await supabase('GET', `/diagnostic_reports?display_code=eq.${shortId}&select=id,display_code,diagnostic_data`);
  if (!rows || rows.length === 0) {
    console.error(`No record found for short_id = ${shortId}`);
    process.exit(1);
  }

  const row = rows[0];
  console.log(`Found record id=${row.id}`);

  const data = row.diagnostic_data;
  const processes = data?.rawProcesses || data?.processes || [];

  if (processes.length === 0) {
    console.error('No processes found in diagnostic_data');
    process.exit(1);
  }

  let totalStepsPatched = 0;

  for (const proc of processes) {
    const steps = proc.steps || [];
    steps.forEach((step, idx) => {
      const preset = TIMING_PRESETS[idx % TIMING_PRESETS.length];
      step.workMinutes  = preset.workMinutes;
      step.waitMinutes  = preset.waitMinutes;
      step.waitType     = preset.waitType;
      step.waitNote     = preset.waitNote;
      step.waitExternal = preset.waitExternal;
      step.capacity     = preset.capacity;
      step.durationUnit = 'hours';
    });
    totalStepsPatched += steps.length;
    console.log(`  Process "${proc.processName || proc.processType}": patched ${steps.length} steps`);
  }

  await supabase('PATCH', `/diagnostic_reports?id=eq.${row.id}`, { diagnostic_data: data });

  console.log(`✓ Done — ${totalStepsPatched} steps patched across ${processes.length} process(es)`);
}

main().catch(err => { console.error(err); process.exit(1); });
