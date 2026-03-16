#!/usr/bin/env node
/**
 * Seed dummy team alignment diagnostics to the database.
 *
 * Creates one team_diagnostic per company with one process each,
 * and four team_responses per team for alignment assessment.
 *
 * Run from project root:
 *   npm run seed
 *   npm run seed 3              # 3 companies
 *   npm run seed 1 --email you@example.com   # One company, all for your portal
 *
 * Requires: SUPABASE_URL and SUPABASE_SERVICE_KEY in .env.local
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load .env.local if it exists
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
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. Set in .env.local or environment.');
  process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(supabaseUrl, supabaseKey);

const TEAM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateTeamCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += TEAM_CODE_CHARS[Math.floor(Math.random() * TEAM_CODE_CHARS.length)];
  }
  return code;
}

const DUMMY_COMPANIES = [
  { company: 'Acme Corp', name: 'Hope Tettey', email: 'hope.tettey@gmail.com' },
  { company: 'TechStart Ltd', name: 'Mike Johnson', email: 'mike@techstart.example.com' },
  { company: 'Global Finance Inc', name: 'Sarah Williams', email: 'sarah@globalfinance.example.com' },
  { company: 'HealthCare Partners', name: 'David Brown', email: 'david@healthcare.example.com' },
  { company: 'Retail Dynamics', name: 'Emma Davis', email: 'emma@retail.example.com' },
  { company: 'Manufacturing Co', name: 'James Wilson', email: 'james@mfg.example.com' },
  { company: 'Legal Services LLP', name: 'Lisa Anderson', email: 'lisa@legal.example.com' },
  { company: 'Education First', name: 'Robert Taylor', email: 'robert@edu.example.com' },
];

const PROCESS_NAMES = [
  'New customer onboarding',
  'Invoice processing',
  'Employee onboarding',
  'Order fulfilment',
  'Contract approval',
  'Expense claims',
  'Vendor management',
  'Client handover',
  'Compliance review',
  'New customer setup',
];

const STEP_NAMES = [
  'Receive request', 'Validate information', 'Assign to team', 'Review documents',
  'Approve or reject', 'Update system', 'Notify stakeholder', 'Archive record',
  'Generate report', 'Schedule follow-up', 'Send confirmation', 'Complete checklist',
  'Escalate if needed', 'Request approval', 'Log activity',
];

const DEPARTMENTS = ['Operations', 'Finance', 'HR', 'Legal', 'Sales', 'IT', 'Compliance', 'External'];

const RESPONDENT_NAMES = ['Alex Chen', 'Jordan Taylor', 'Sam Williams', 'Casey Morgan'];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomSteps(count) {
  const steps = [];
  const used = new Set();
  for (let i = 0; i < count; i++) {
    let name = pick(STEP_NAMES);
    while (used.has(name) && used.size < STEP_NAMES.length) name = pick(STEP_NAMES);
    used.add(name);
    steps.push({
      name,
      department: pick(DEPARTMENTS),
      isDecision: Math.random() < 0.2,
      branches: [],
    });
  }
  return steps;
}

function makeHandoffs(count, poorCount = 0) {
  const clarity = (i) => (i < poorCount ? 'yes-major' : 'clear');
  return Array.from({ length: count }, (_, i) => ({
    method: pick(['Email', 'Slack', 'Meeting', 'System']),
    clarity: clarity(i),
  }));
}

/** Build response_data for team alignment (processData + metrics for getResults) */
function makeResponseData(processName, stepCount, handoffCount, elapsedDays, totalUserHours) {
  const steps = randomSteps(stepCount);
  const handoffs = makeHandoffs(handoffCount, Math.min(1, Math.floor(handoffCount * 0.3)));
  return {
    processData: {
      processName,
      steps,
      handoffs,
      lastExample: { elapsedDays },
      userTime: { total: totalUserHours },
    },
    metrics: {
      elapsedDays,
      stepsCount: stepCount,
      handoffCount,
      poorHandoffs: handoffs.filter(h => h.clarity === 'yes-multiple' || h.clarity === 'yes-major').length,
      totalUserHours,
    },
  };
}

/** Four submissions with varying metrics to show alignment gaps */
function makeFourResponses(processName) {
  return [
    { steps: 6, handoffs: 5, elapsedDays: 8, hours: 12 },
    { steps: 8, handoffs: 7, elapsedDays: 12, hours: 18 },
    { steps: 10, handoffs: 9, elapsedDays: 20, hours: 24 },
    { steps: 7, handoffs: 6, elapsedDays: 6, hours: 10 },
  ];
}

async function seed(count = 1, overrideEmail = null) {
  console.log(`Seeding ${count} team alignment session(s)...`);
  console.log('  One process per company, four submissions per team.');
  if (overrideEmail) console.log(`  All sessions will use created_by_email: ${overrideEmail}`);
  const created = [];

  for (let i = 0; i < count; i++) {
    const company = { ...DUMMY_COMPANIES[i % DUMMY_COMPANIES.length] };
    if (overrideEmail) company.email = overrideEmail;

    const teamId = crypto.randomUUID();
    const teamCode = generateTeamCode();
    const processName = pick(PROCESS_NAMES);

    const team = {
      id: teamId,
      team_code: teamCode,
      created_by_email: company.email,
      created_by_name: company.name,
      process_name: processName,
      company: company.company,
      description: null,
      status: 'closed',
      closed_at: new Date().toISOString(),
      created_at: new Date(Date.now() - i * 86400000).toISOString(),
    };

    const { error: teamErr } = await supabase.from('team_diagnostics').insert(team);

    if (teamErr) {
      console.error(`Failed to insert team ${i + 1}:`, teamErr.message);
      continue;
    }

    const responses = makeFourResponses(processName);
    for (let r = 0; r < 4; r++) {
      const resp = responses[r];
      const responseData = makeResponseData(processName, resp.steps, resp.handoffs, resp.elapsedDays, resp.hours);
      const respRow = {
        id: crypto.randomUUID(),
        team_id: teamId,
        respondent_name: RESPONDENT_NAMES[r],
        respondent_email: null,
        respondent_department: pick(DEPARTMENTS),
        response_data: responseData,
        created_at: new Date(Date.now() - (i * 4 + r) * 3600000).toISOString(),
      };
      const { error: respErr } = await supabase.from('team_responses').insert(respRow);
      if (respErr) {
        console.warn(`  (response ${r + 1} for ${company.company} failed: ${respErr.message})`);
      }
    }

    created.push({ teamCode, company: company.company, processName });
  }

  console.log(`\nCreated ${created.length} team alignment session(s):`);
  created.forEach((c) => console.log(`  - ${c.company} | ${c.processName} | code: ${c.teamCode}`));
  const email = overrideEmail || DUMMY_COMPANIES[0].email;
  const first = created[0];
  console.log(`\nDone. Log in at /portal with ${email}, then view results at /team-results?code=${first ? first.teamCode : 'CODE'}`);
}

const countArg = process.argv.find((a) => /^\d+$/.test(a));
const count = countArg ? parseInt(countArg, 10) : 1;
const emailIdx = process.argv.indexOf('--email');
const overrideEmail = emailIdx >= 0 && process.argv[emailIdx + 1] ? process.argv[emailIdx + 1] : null;

seed(count, overrideEmail).catch((err) => {
  console.error(err);
  process.exit(1);
});
