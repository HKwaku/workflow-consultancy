#!/usr/bin/env node
/**
 * Seed a PE roll-up test scenario end-to-end.
 *
 *   - Creates a deal of type=pe_rollup
 *   - Two participants: one platform_company, one portfolio_company
 *   - Two diagnostic_reports for the SAME process ("Customer onboarding")
 *     with deliberately divergent shapes (HQ has 7 well-documented steps;
 *     subsidiary has 5 sloppier steps with manual handoffs)
 *   - Each report bound to its participant's deal_flow.report_id
 *
 * Stops short of running the analysis — that needs an Anthropic key + the
 * deal owner's session. Once the script finishes, sign in as the owner
 * email and visit the printed URL; click Run analysis -> Redesign.
 *
 * Run from project root:
 *   node scripts/seed-pe-rollup-test.js
 *   node scripts/seed-pe-rollup-test.js --email hope.tettey@gmail.com
 *   node scripts/seed-pe-rollup-test.js --email <user> --name "Acme roll-up"
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── .env.local loader (same shape as scripts/seed-dummy-diagnostics.js) ──
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach((line) => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const key = m[1].trim();
      const val = m[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  });
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.');
  process.exit(1);
}

// ── CLI args ──
const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.findIndex((a) => a === `--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
}
const ownerEmail = (arg('email', 'hope.tettey@gmail.com') || '').toLowerCase().trim();
const dealName = arg('name', `Test PE roll-up — ${new Date().toISOString().slice(0, 10)}`);
const processName = arg('process', 'Customer onboarding');
const baseUrl = arg('base-url', process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');

// ── Tiny REST helpers (no @supabase/supabase-js dep — keep this script
//    runnable on a fresh checkout). ──
const writeHeaders = {
  apikey: supabaseKey,
  Authorization: `Bearer ${supabaseKey}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};
const readHeaders = {
  apikey: supabaseKey,
  Authorization: `Bearer ${supabaseKey}`,
};

async function rest(method, urlPath, body) {
  const r = await fetch(`${supabaseUrl}/rest/v1/${urlPath}`, {
    method,
    headers: body !== undefined ? writeHeaders : readHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${urlPath} -> ${r.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

// ── Two divergent process shapes for the same logical process. ──
//
// platform_company (Acme HQ): mature, well-instrumented, 7 steps, mostly
// system-driven, one human approval, low handoff friction.
//
// portfolio_company (Beta Subsidiary): manual, ad-hoc, 5 steps, lots of
// email handoffs, no system of record. The shape the redesign should
// rationalise toward the HQ version.
const PLATFORM_STEPS = [
  { name: 'Lead captured in CRM',                department: 'Sales',     systems: ['HubSpot'],            timeMin: 5,  handoff: { method: 'system' } },
  { name: 'Auto-qualify with enrichment',        department: 'Sales',     systems: ['Clearbit', 'HubSpot'], timeMin: 2,  handoff: { method: 'system' } },
  { name: 'Account exec books discovery call',   department: 'Sales',     systems: ['Calendly'],           timeMin: 30, handoff: { method: 'system' } },
  { name: 'Generate quote in CPQ',               department: 'Sales Ops', systems: ['Salesforce CPQ'],     timeMin: 20, handoff: { method: 'system' } },
  { name: 'Customer signs MSA via e-sign',       department: 'Legal',     systems: ['DocuSign'],           timeMin: 60, handoff: { method: 'system' } },
  { name: 'Provisioning kicks off automatically', department: 'Customer Success', systems: ['Internal API'], timeMin: 5,  handoff: { method: 'system' } },
  { name: 'CSM owns 30-day onboarding plan',     department: 'Customer Success', systems: ['Gainsight'],   timeMin: 240, handoff: { method: 'system' } },
];

const PORTFOLIO_STEPS = [
  { name: 'Sales rep emails new lead',                 department: 'Sales',     systems: ['Outlook'],   timeMin: 15,  handoff: { method: 'email' } },
  { name: 'Manager reviews lead in spreadsheet',       department: 'Sales',     systems: ['Excel'],     timeMin: 30,  handoff: { method: 'email' } },
  { name: 'Quote drafted manually in Word',            department: 'Sales',     systems: ['Word'],      timeMin: 60,  handoff: { method: 'email' } },
  { name: 'Customer signs scanned PDF and emails back', department: 'Legal',     systems: ['Email'],     timeMin: 1440, handoff: { method: 'email' } },
  { name: 'Ops sets up account by hand on receipt',    department: 'Operations', systems: ['Internal app'], timeMin: 120, handoff: { method: 'manual' } },
];

// Hourly rate + annual instances are seed assumptions. They only need to
// be plausible enough that the deal-workspace summary cards render numbers
// that reflect the divergence between platform_company and portfolio_company.
const SEED_HOURLY_RATE = 80;
const SEED_ANNUAL_INSTANCES = 250;

function buildRawProcess({ processName, steps, companyLabel }) {
  const totalMin = steps.reduce((acc, s) => acc + (s.timeMin || 0), 0);
  return {
    processName,
    processDefinition: `${processName} as run by ${companyLabel}.`,
    segment: 'pe',
    moduleId: 'pe',
    company: companyLabel,
    steps: steps.map((s, i) => ({
      id: `step-${i}`,
      name: s.name,
      department: s.department,
      systems: s.systems,
      durationMin: s.timeMin,
      durationMinutes: s.timeMin,
      workMinutes: s.timeMin,
      handoff: s.handoff,
      checklist: [],
    })),
    handoffs: steps.slice(0, -1).map((s, i) => ({
      from: `step-${i}`,
      to: `step-${i + 1}`,
      method: s.handoff?.method || 'manual',
    })),
    cycleTimeMin: totalMin,
    cycleTimeHours: +(totalMin / 60).toFixed(2),
    submittedAt: new Date().toISOString(),
  };
}

// Produce the canonical diagnostic_data shape that the deal API + report
// page + cost-analysis page all read from: rawProcesses[] for full process
// detail, processes[] for summary cards, summary for top-line counts.
// Earlier versions of this seed wrote a flat object — symptom was the deal
// workspace participant card showing zero steps / zero cost even though
// the row existed.
function buildDiagnosticData({ processName, steps, companyLabel }) {
  const raw = buildRawProcess({ processName, steps, companyLabel });
  const annualCost = +(raw.cycleTimeHours * SEED_ANNUAL_INSTANCES * SEED_HOURLY_RATE).toFixed(0);
  // Handoff automation: 'system' = automated; everything else counts as manual.
  const totalHandoffs = raw.handoffs.length || 1;
  const systemHandoffs = raw.handoffs.filter((h) => h.method === 'system').length;
  const automationPct = Math.round((systemHandoffs / totalHandoffs) * 100);
  const summaryProcess = {
    name: processName,
    type: 'pe',
    stepsCount: raw.steps.length,
    annualCost,
    annualInstances: SEED_ANNUAL_INSTANCES,
    teamSize: 1,
    quality: { score: automationPct >= 70 ? 80 : 50 },
    automationPct,
  };
  return {
    rawProcesses: [raw],
    processes: [summaryProcess],
    summary: { totalProcesses: 1 },
    segment: 'pe',
    moduleId: 'pe',
  };
}

// Top-line metrics live as columns on diagnostic_reports (the deal API
// reads them off the row, not out of diagnostic_data). Heuristic: a higher
// system-handoff ratio means more automation, lower potential savings.
function topLineMetrics({ steps }) {
  const totalMin = steps.reduce((acc, s) => acc + (s.timeMin || 0), 0);
  const cycleHours = totalMin / 60;
  const annualCost = +(cycleHours * SEED_ANNUAL_INSTANCES * SEED_HOURLY_RATE).toFixed(0);
  const handoffs = steps.slice(0, -1).map((s) => s.handoff?.method || 'manual');
  const systemPct = handoffs.length
    ? Math.round((handoffs.filter((m) => m === 'system').length / handoffs.length) * 100)
    : 0;
  const savingsPct = systemPct >= 70 ? 0.20 : 0.55;
  const grade = systemPct >= 70 ? 'A' : systemPct >= 40 ? 'B' : 'D';
  return {
    total_annual_cost: annualCost,
    potential_savings: +(annualCost * savingsPct).toFixed(0),
    automation_percentage: systemPct,
    automation_grade: grade,
  };
}

(async () => {
  console.log(`Seeding PE roll-up test for owner=${ownerEmail} ...`);

  // 1. Resolve auth.users.id by email so deals.owner_user_id is populated.
  let ownerUserId = null;
  try {
    const r = await fetch(`${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(ownerEmail)}`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    });
    if (r.ok) {
      const data = await r.json();
      const u = (data?.users || []).find((row) => (row.email || '').toLowerCase() === ownerEmail);
      ownerUserId = u?.id || null;
    }
  } catch { /* fall through, owner_user_id is nullable */ }
  if (!ownerUserId) {
    console.warn(`  ! Could not resolve auth user for ${ownerEmail} — leaving owner_user_id null.`);
    console.warn('    The deal will still be visible to that email via owner_email matching.');
  } else {
    console.log(`  resolved owner_user_id=${ownerUserId}`);
  }

  // 2. Create the deal.
  const [deal] = await rest('POST', 'deals', {
    type: 'pe_rollup',
    name: dealName,
    process_name: processName,
    owner_email: ownerEmail,
    owner_user_id: ownerUserId,
    status: 'collecting',
    settings: {},
  });
  console.log(`  deal id=${deal.id} code=${deal.deal_code} type=${deal.type}`);

  // 3. Two participants — platform + portfolio company.
  const participants = await rest('POST', 'deal_participants', [
    {
      deal_id: deal.id,
      role: 'platform_company',
      company_name: 'Acme HQ',
      participant_email: ownerEmail,
      participant_name: 'Acme HQ (seed)',
      status: 'in_progress',
    },
    {
      deal_id: deal.id,
      role: 'portfolio_company',
      company_name: 'Beta Subsidiary',
      participant_email: ownerEmail,
      participant_name: 'Beta Subsidiary (seed)',
      status: 'in_progress',
    },
  ]);
  const platformP = participants.find((p) => p.role === 'platform_company');
  const portfolioP = participants.find((p) => p.role === 'portfolio_company');
  console.log(`  participants: platform=${platformP.id} portfolio=${portfolioP.id}`);

  // 4. Two diagnostic_reports — same processName, divergent shapes.
  // Only columns that exist in the live diagnostic_reports schema.
  // Columns like `recommendations` aren't on the table — they're derived
  // from diagnostic_data or stored elsewhere.
  const reportRows = [
    {
      id: crypto.randomUUID(),
      contact_email: ownerEmail,
      contact_name: 'Acme HQ (seed)',
      company: 'Acme HQ',
      diagnostic_data: buildDiagnosticData({ processName, steps: PLATFORM_STEPS, companyLabel: 'Acme HQ' }),
      user_id: ownerUserId,
      ...topLineMetrics({ steps: PLATFORM_STEPS }),
    },
    {
      id: crypto.randomUUID(),
      contact_email: ownerEmail,
      contact_name: 'Beta Subsidiary (seed)',
      company: 'Beta Subsidiary',
      diagnostic_data: buildDiagnosticData({ processName, steps: PORTFOLIO_STEPS, companyLabel: 'Beta Subsidiary' }),
      user_id: ownerUserId,
      ...topLineMetrics({ steps: PORTFOLIO_STEPS }),
    },
  ];
  const reports = await rest('POST', 'diagnostic_reports', reportRows);
  const platformReport = reports.find((r) => r.company === 'Acme HQ');
  const portfolioReport = reports.find((r) => r.company === 'Beta Subsidiary');
  console.log(`  reports: platform=${platformReport.id} portfolio=${portfolioReport.id}`);

  // 5. deal_flows linking each participant to its report.
  const flows = await rest('POST', 'deal_flows', [
    {
      deal_id: deal.id,
      participant_id: platformP.id,
      label: processName,
      flow_kind: 'customer_onboarding',
      report_id: platformReport.id,
      status: 'complete',
      created_by_email: ownerEmail,
    },
    {
      deal_id: deal.id,
      participant_id: portfolioP.id,
      label: processName,
      flow_kind: 'customer_onboarding',
      report_id: portfolioReport.id,
      status: 'complete',
      created_by_email: ownerEmail,
    },
  ]);
  console.log(`  flows: ${flows.length} created`);

  // 6. Backfill participants.report_id so the deal API's path-A enrichment
  //    (rawSteps + processes + processCount) runs. Path B (deal_flows-only)
  //    surfaces just the column metrics, not the map detail; without this
  //    backfill the workspace participant cards render zero step / zero
  //    process counts even though diagnostic_reports has full data.
  await rest('PATCH', `deal_participants?id=eq.${platformP.id}`, {
    report_id: platformReport.id,
    status: 'complete',
    completed_at: new Date().toISOString(),
  });
  await rest('PATCH', `deal_participants?id=eq.${portfolioP.id}`, {
    report_id: portfolioReport.id,
    status: 'complete',
    completed_at: new Date().toISOString(),
  });

  // ── Done ──────────────────────────────────────────────────────────
  const dealUrl = `${baseUrl}/process-audit?deal=${deal.id}`;
  console.log('');
  console.log('────────────────────────────────────────────────────────────');
  console.log(' Seed complete.');
  console.log('────────────────────────────────────────────────────────────');
  console.log(` Deal name: ${deal.name}`);
  console.log(` Deal code: ${deal.deal_code}`);
  console.log(` Owner:     ${ownerEmail}`);
  console.log(` Process:   ${processName}`);
  console.log('');
  console.log(' Open in browser (sign in first as the owner):');
  console.log(`   ${dealUrl}`);
  console.log('');
  console.log(' Workspace modal will show both participants complete with');
  console.log(' divergent flows. Click Run analysis -> Redesign and the');
  console.log(' Inngest worker will produce a unified target process.');
  console.log('');
})().catch((e) => {
  console.error('SEED FAILED:', e.message);
  process.exit(1);
});
