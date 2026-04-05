#!/usr/bin/env node
/**
 * seed-test-diagnostics.js
 *
 * Creates one comprehensive process flow per industry in Supabase, each with
 * complete cost analysis pre-populated. Owner: hope.tettey@gmail.com.
 *
 * Usage:
 *   node scripts/seed-test-diagnostics.js
 *
 * Requires .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL=...
 *   SUPABASE_SERVICE_ROLE_KEY=...   (or NEXT_PUBLIC_SUPABASE_ANON_KEY for anon insert)
 *
 * Login: hope.tettey@gmail.com | Cost analysis: /cost-analysis?id=<id>&token=<token>
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Load .env.local without dotenv
try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* .env.local not found */ }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const BASE_URL = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
const OWNER_EMAIL = 'hope.tettey@gmail.com';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

// ── helpers ─────────────────────────────────────────────────────────────────

function uuid() { return crypto.randomUUID(); }
function token() { return crypto.randomBytes(24).toString('base64url'); }

function step(label, dept, systems = [], opts = {}) {
  return {
    id: uuid(),
    label,
    department: dept,
    isManual: opts.isManual ?? true,
    isAutomated: opts.isAutomated ?? false,
    isApproval: opts.isApproval ?? false,
    isDecision: opts.isDecision ?? false,
    isBottleneck: opts.isBottleneck ?? false,
    branches: opts.branches ?? undefined,
    systems,
    workMinutes: opts.work ?? 20,
    waitMinutes: opts.wait ?? 10,
  };
}

function mkProcess(name, steps, freq, costs, bottleneck) {
  return {
    processName: name,
    steps,
    frequency: { type: freq.type, annual: freq.annual, inFlight: freq.inFlight ?? 0 },
    costs: {
      hoursPerInstance: costs.hours,
      teamSize: costs.team,
      annual: freq.annual,
      cycleDays: costs.cycleDays ?? 0,
    },
    bottleneck: { reason: bottleneck.reason, why: bottleneck.why ?? '' },
    savings: { percent: 25 },
  };
}

// ── test data by industry ────────────────────────────────────────────────────

const TEST_CASES = [

  // 1. Technology & Software
  {
    industry: 'Technology & Software',
    company: 'Apex Software Ltd',
    contactName: 'Sarah Chen',
    contactEmail: 'test+tech@sharpin.co',
    processes: [
      mkProcess(
        'Software Release Deployment',
        [
          step('Raise release request in Jira', 'Engineering', ['Jira'], { work: 20, wait: 5 }),
          step('Code review & merge approval', 'Engineering', ['GitHub', 'Jira'], { isApproval: true, work: 60, wait: 240, isBottleneck: true }),
          step('Run automated test suite', 'QA', ['GitHub Actions', 'Jira'], { isAutomated: true, work: 5, wait: 30 }),
          step('Manual regression testing', 'QA', ['Jira', 'TestRail'], { work: 90, wait: 60, isBottleneck: true }),
          step('Security & compliance sign-off', 'Security', ['Jira'], { isApproval: true, work: 30, wait: 480 }),
          step('Deploy to staging', 'DevOps', ['GitHub Actions', 'AWS'], { isAutomated: true, work: 5, wait: 20 }),
          step('Product owner UAT sign-off', 'Product', ['Jira'], { isApproval: true, work: 60, wait: 1440 }),
          step('Deploy to production & monitor', 'DevOps', ['AWS', 'Datadog'], { work: 30, wait: 10 }),
        ],
        { type: 'weekly', annual: 52 },
        { hours: 5.5, team: 3, cycleDays: 4 },
        { reason: 'approvals', why: 'Three sequential approval gates cause 2–3 day delays per release cycle' }
      ),
      mkProcess(
        'Customer Bug Triage & Resolution',
        [
          step('Bug reported via support ticket', 'Support', ['Zendesk'], { work: 10, wait: 0 }),
          step('Reproduce & classify severity', 'Support', ['Zendesk', 'Jira'], { work: 30, wait: 30 }),
          step('Route to engineering squad', 'Engineering', ['Jira', 'Slack'], { work: 15, wait: 120, isBottleneck: true }),
          step('Root cause investigation', 'Engineering', ['GitHub', 'Datadog', 'Jira'], { work: 120, wait: 0 }),
          step('Severity decision: hotfix or sprint?', 'Engineering', ['Jira'], { isDecision: true, branches: ['hotfix', 'schedule-sprint'], work: 15, wait: 0 }),
          step('Write & review fix', 'Engineering', ['GitHub', 'Jira'], { work: 90, wait: 60 }),
          step('QA validation', 'QA', ['Jira', 'TestRail'], { work: 45, wait: 60 }),
          step('Deploy fix & notify customer', 'DevOps', ['GitHub Actions', 'Zendesk'], { work: 20, wait: 10 }),
        ],
        { type: 'few-per-week', annual: 150 },
        { hours: 5.75, team: 2, cycleDays: 2 },
        { reason: 'handoffs', why: 'Support to engineering handoff loses context and delays initial triage' }
      ),
    ],
  },

  // 2. Financial Services
  {
    industry: 'Financial Services',
    company: 'Meridian Capital Partners',
    contactName: 'James Whitfield',
    contactEmail: 'test+finance@sharpin.co',
    processes: [
      mkProcess(
        'Corporate Invoice Approval',
        [
          step('Invoice received via email', 'Accounts Payable', ['Email', 'Outlook'], { work: 10, wait: 0 }),
          step('Data entry into ERP', 'Accounts Payable', ['SAP', 'Email'], { work: 25, wait: 5 }),
          step('Match against PO in system', 'Accounts Payable', ['SAP'], { work: 20, wait: 15, isBottleneck: true }),
          step('Exception: PO mismatch query to supplier', 'Accounts Payable', ['Email', 'SAP'], { isDecision: true, branches: ['matched', 'query-supplier'], work: 15, wait: 0 }),
          step('Line manager approval (< £10k)', 'Finance', ['SAP', 'Email'], { isApproval: true, work: 10, wait: 480 }),
          step('Finance director approval (> £10k)', 'Finance', ['SAP', 'Email'], { isApproval: true, work: 15, wait: 1440, isBottleneck: true }),
          step('Payment scheduled in ERP', 'Accounts Payable', ['SAP'], { work: 10, wait: 0 }),
          step('Remittance sent to supplier', 'Accounts Payable', ['SAP', 'Email'], { work: 5, wait: 0 }),
        ],
        { type: 'daily', annual: 365 },
        { hours: 1.75, team: 2, cycleDays: 5 },
        { reason: 'approvals', why: 'Multi-level approval chain means average 5-day payment cycle; suppliers frequently chase' }
      ),
      mkProcess(
        'Personal Loan Application Processing',
        [
          step('Application received online', 'Digital', ['Loan Portal', 'CRM'], { isAutomated: true, work: 5, wait: 0 }),
          step('Credit bureau check', 'Credit Risk', ['Experian', 'CRM'], { work: 10, wait: 30 }),
          step('Automated affordability scoring', 'Credit Risk', ['Credit Engine', 'CRM'], { isAutomated: true, work: 2, wait: 15 }),
          step('Manual underwriter review (edge cases)', 'Credit Risk', ['CRM', 'Excel'], { work: 45, wait: 240, isBottleneck: true }),
          step('Document verification (ID, payslips)', 'Operations', ['Onfido', 'CRM'], { work: 30, wait: 120 }),
          step('Compliance AML/KYC check', 'Compliance', ['Refinitiv', 'CRM'], { work: 20, wait: 60 }),
          step('Decision: approve / decline / refer', 'Credit Risk', ['CRM'], { isDecision: true, branches: ['approve', 'decline', 'refer'], work: 10, wait: 0 }),
          step('Offer letter generated & sent', 'Operations', ['CRM', 'DocuSign'], { work: 15, wait: 0 }),
          step('Customer acceptance & drawdown', 'Operations', ['CRM', 'Core Banking'], { isAutomated: true, work: 5, wait: 0 }),
        ],
        { type: 'daily', annual: 260 },
        { hours: 2.4, team: 3, cycleDays: 3 },
        { reason: 'manual-work', why: 'Manual underwriter review is required for 40% of applications that fall outside automated scoring rules' }
      ),
    ],
  },

  // 3. Healthcare & Life Sciences
  {
    industry: 'Healthcare & Life Sciences',
    company: 'Northgate Medical Group',
    contactName: 'Dr. Priya Sharma',
    contactEmail: 'test+health@sharpin.co',
    processes: [
      mkProcess(
        'New Patient Registration & Intake',
        [
          step('Patient calls or books online', 'Reception', ['Phone', 'EMIS Web'], { work: 15, wait: 0 }),
          step('Demographics captured on paper form', 'Reception', ['Paper'], { work: 20, wait: 5 }),
          step('Manual data entry into clinical system', 'Reception', ['EMIS Web'], { work: 15, wait: 10, isBottleneck: true }),
          step('GP registration confirmation letter posted', 'Administration', ['EMIS Web', 'Word'], { work: 20, wait: 0 }),
          step('Medical history questionnaire given to patient', 'Administration', ['Paper'], { work: 10, wait: 1440 }),
          step('Questionnaire manually reviewed by GP', 'Clinical', ['Paper', 'EMIS Web'], { work: 25, wait: 2880, isBottleneck: true }),
          step('New patient appointment booked', 'Reception', ['EMIS Web'], { work: 10, wait: 0 }),
        ],
        { type: 'daily', annual: 260 },
        { hours: 1.9, team: 2, cycleDays: 7 },
        { reason: 'manual-work', why: 'Paper forms transcribed manually; no digital intake pathway' }
      ),
    ],
  },

  // 4. Manufacturing & Engineering
  {
    industry: 'Manufacturing & Engineering',
    company: 'Fortis Precision Components',
    contactName: 'Mark Dawson',
    contactEmail: 'test+manufacturing@sharpin.co',
    processes: [
      mkProcess(
        'Purchase Order Approval & Procurement',
        [
          step('Requisition raised by department', 'Operations', ['ERP', 'Email'], { work: 20, wait: 0 }),
          step('Check approved supplier list', 'Procurement', ['ERP', 'Excel'], { work: 15, wait: 30 }),
          step('Request quotes from 3 suppliers', 'Procurement', ['Email'], { work: 30, wait: 2880, isBottleneck: true }),
          step('Compare quotes in spreadsheet', 'Procurement', ['Excel'], { work: 45, wait: 0, isBottleneck: true }),
          step('Manager approval (> £5k)', 'Finance', ['Email'], { isApproval: true, work: 10, wait: 1440 }),
          step('Director approval (> £25k)', 'Finance', ['Email'], { isApproval: true, work: 10, wait: 2880 }),
          step('PO raised in ERP', 'Procurement', ['SAP'], { work: 20, wait: 10 }),
          step('PO sent to supplier', 'Procurement', ['SAP', 'Email'], { work: 5, wait: 0 }),
          step('Goods receipt confirmation', 'Warehouse', ['SAP', 'Scanner'], { work: 15, wait: 0 }),
        ],
        { type: 'daily', annual: 260 },
        { hours: 2.9, team: 2, cycleDays: 8 },
        { reason: 'waiting', why: 'Waiting on supplier quotes and sequential approval chain averages 8 days end to end' }
      ),
      mkProcess(
        'Quality Inspection & Non-Conformance Reporting',
        [
          step('Incoming goods flagged for QC', 'Warehouse', ['SAP', 'Scanner'], { work: 10, wait: 0 }),
          step('Physical inspection against spec sheet', 'Quality', ['Paper', 'Calipers'], { work: 60, wait: 0 }),
          step('Non-conformance decision', 'Quality', ['Paper'], { isDecision: true, branches: ['pass', 'fail', 'conditional'], work: 10, wait: 0 }),
          step('NCR raised manually on paper form', 'Quality', ['Paper', 'Word'], { work: 30, wait: 0, isBottleneck: true }),
          step('NCR entered into quality system', 'Quality', ['QMS Software', 'Word'], { work: 25, wait: 60, isBottleneck: true }),
          step('Root cause analysis with supplier', 'Procurement', ['Email', 'QMS Software'], { work: 60, wait: 2880 }),
          step('Corrective action agreed & documented', 'Quality', ['QMS Software', 'Email'], { work: 30, wait: 1440 }),
          step('Re-inspection or return to supplier', 'Quality', ['QMS Software', 'SAP'], { work: 30, wait: 0 }),
        ],
        { type: 'weekly', annual: 52 },
        { hours: 3.8, team: 2, cycleDays: 6 },
        { reason: 'rework', why: 'Paper NCR forms regularly lost or mis-filed; re-entry into digital system is duplicated effort' }
      ),
    ],
  },

  // 5. Retail & E-commerce
  {
    industry: 'Retail & E-commerce',
    company: 'Crestwood Retail Group',
    contactName: 'Olivia Park',
    contactEmail: 'test+retail@sharpin.co',
    processes: [
      mkProcess(
        'Customer Returns Processing',
        [
          step('Customer initiates return online or in-store', 'Customer Service', ['Shopify', 'Zendesk'], { work: 10, wait: 0 }),
          step('Return reason recorded in CRM', 'Customer Service', ['Zendesk', 'Shopify'], { work: 10, wait: 5 }),
          step('Return label generated & emailed', 'Operations', ['ShipStation', 'Shopify'], { work: 5, wait: 0 }),
          step('Item received at warehouse', 'Warehouse', ['Shopify', 'Scanner'], { work: 10, wait: 2880 }),
          step('Manual item condition inspection', 'Warehouse', ['Paper', 'Shopify'], { work: 20, wait: 0, isBottleneck: true }),
          step('Restock or write-off decision', 'Warehouse', ['Shopify', 'ERP'], { isDecision: true, branches: ['restock', 'liquidate', 'dispose'], work: 10, wait: 0 }),
          step('Refund processed in payment system', 'Finance', ['Shopify', 'Stripe'], { work: 10, wait: 0 }),
          step('Inventory updated', 'Operations', ['Shopify', 'ERP'], { work: 8, wait: 0 }),
        ],
        { type: 'daily', annual: 365 },
        { hours: 1.4, team: 2, cycleDays: 5 },
        { reason: 'manual-work', why: 'No automated condition grading; each item manually assessed and re-entered' }
      ),
    ],
  },

  // 6. Professional Services
  {
    industry: 'Professional Services',
    company: 'Kelvin & Hargreaves Consulting',
    contactName: 'Tom Hargreaves',
    contactEmail: 'test+consulting@sharpin.co',
    processes: [
      mkProcess(
        'New Client Onboarding',
        [
          step('Proposal accepted — notification to ops', 'Sales', ['HubSpot', 'Email'], { work: 10, wait: 0 }),
          step('Conflict of interest check', 'Compliance', ['Email', 'Excel'], { work: 30, wait: 480, isBottleneck: true }),
          step('Engagement letter prepared in Word', 'Admin', ['Word', 'Email'], { work: 45, wait: 0 }),
          step('Partner review & signature', 'Leadership', ['DocuSign', 'Email'], { isApproval: true, work: 20, wait: 1440 }),
          step('Client signs engagement letter', 'Client', ['DocuSign'], { isApproval: true, work: 5, wait: 2880, isBottleneck: true }),
          step('KYC/AML documentation collected', 'Compliance', ['Email', 'SharePoint'], { work: 45, wait: 2880 }),
          step('Client record created in practice management', 'Admin', ['Sage Practice Manager', 'HubSpot'], { work: 30, wait: 0, isBottleneck: true }),
          step('Project workspace set up', 'Admin', ['SharePoint', 'Teams', 'Asana'], { work: 30, wait: 0 }),
          step('Welcome email & introduction sent', 'Account Manager', ['Outlook', 'HubSpot'], { work: 15, wait: 0 }),
        ],
        { type: 'twice-monthly', annual: 24 },
        { hours: 3.8, team: 3, cycleDays: 14 },
        { reason: 'handoffs', why: '5 different people involved; no central tracking — items frequently lost between teams' }
      ),
      mkProcess(
        'Monthly Timesheet Submission & Approval',
        [
          step('Reminder email sent to all staff', 'Admin', ['Outlook'], { work: 10, wait: 0 }),
          step('Consultant submits timesheet', 'Consultants', ['Excel', 'Email'], { work: 20, wait: 1440, isBottleneck: true }),
          step('Admin chases missing timesheets', 'Admin', ['Email', 'Phone'], { work: 30, wait: 2880, isBottleneck: true }),
          step('Manager reviews & approves', 'Management', ['Email', 'Excel'], { isApproval: true, work: 15, wait: 480 }),
          step('Admin consolidates into master spreadsheet', 'Admin', ['Excel'], { work: 60, wait: 0, isBottleneck: true }),
          step('Cross-check against project codes', 'Finance', ['Excel', 'Sage'], { work: 45, wait: 0 }),
          step('Data exported to payroll & billing', 'Finance', ['Sage', 'Excel'], { work: 30, wait: 0 }),
        ],
        { type: 'monthly', annual: 12 },
        { hours: 3.5, team: 4, cycleDays: 7 },
        { reason: 'manual-work', why: 'Excel-based timesheets with no system integration; full consolidation is manual' }
      ),
    ],
  },

  // 7. Government & Public Sector
  {
    industry: 'Government & Public Sector',
    company: 'Brindlewood Borough Council',
    contactName: 'Helen Forsyth',
    contactEmail: 'test+government@sharpin.co',
    processes: [
      mkProcess(
        'Planning Permission Application',
        [
          step('Application submitted (paper or portal)', 'Planning', ['Planning Portal', 'Paper'], { work: 20, wait: 0 }),
          step('Validation check: completeness', 'Planning', ['Uniform', 'Paper'], { work: 45, wait: 2880, isBottleneck: true }),
          step('Statutory consultation to neighbour notification', 'Planning', ['Uniform', 'Royal Mail'], { work: 60, wait: 0 }),
          step('Neighbour comment period (21 days)', 'Planning', ['Uniform'], { work: 10, wait: 30240, isBottleneck: true }),
          step('Internal consultee responses collated', 'Planning', ['Email', 'Uniform'], { work: 60, wait: 10080 }),
          step('Site visit by planning officer', 'Planning', ['Car', 'Paper'], { work: 90, wait: 0 }),
          step('Officer report drafted', 'Planning', ['Word', 'Uniform'], { work: 180, wait: 0 }),
          step('Committee or delegated decision', 'Planning', ['Uniform', 'Word'], { isDecision: true, branches: ['granted', 'refused', 'deferred'], work: 120, wait: 5040 }),
          step('Decision notice issued', 'Planning', ['Uniform', 'Email'], { work: 30, wait: 0 }),
        ],
        { type: 'weekly', annual: 52 },
        { hours: 9.2, team: 2, cycleDays: 56 },
        { reason: 'waiting', why: 'Statutory consultation periods and committee schedules create mandatory wait time; admin overhead is largely avoidable' }
      ),
    ],
  },

  // 8. Non-profit & Charities
  {
    industry: 'Non-profit & Charities',
    company: 'Greenfield Community Trust',
    contactName: 'Rachel Osei',
    contactEmail: 'test+nonprofit@sharpin.co',
    processes: [
      mkProcess(
        'Grant Application & Assessment',
        [
          step('Grant call published on website', 'Fundraising', ['Website', 'Mailchimp'], { work: 30, wait: 0 }),
          step('Applications received by email or post', 'Fundraising', ['Email', 'Post'], { work: 15, wait: 0 }),
          step('Applications logged in spreadsheet', 'Admin', ['Excel', 'Email'], { work: 20, wait: 0, isBottleneck: true }),
          step('Eligibility pre-screen', 'Fundraising', ['Excel', 'Word'], { work: 30, wait: 0 }),
          step('Full assessment scoring', 'Fundraising', ['Excel', 'Word'], { work: 60, wait: 0 }),
          step('Panel review meeting', 'Trustees', ['Word', 'Email'], { isApproval: true, work: 120, wait: 10080, isBottleneck: true }),
          step('Decision letters drafted & sent', 'Admin', ['Word', 'Email'], { work: 45, wait: 0 }),
          step('Grant agreement issued (successful)', 'Finance', ['Word', 'DocuSign'], { work: 30, wait: 2880 }),
          step('Payment processed', 'Finance', ['SAGE', 'Bank'], { work: 15, wait: 0 }),
        ],
        { type: 'quarterly', annual: 4 },
        { hours: 6.1, team: 4, cycleDays: 42 },
        { reason: 'manual-work', why: 'Entire process tracked in spreadsheets; no grant management system; every round restarts from scratch' }
      ),
    ],
  },

  // 9. Construction & Real Estate
  {
    industry: 'Construction & Real Estate',
    company: 'Redwood Build Group',
    contactName: 'Craig Bellamy',
    contactEmail: 'test+construction@sharpin.co',
    processes: [
      mkProcess(
        'Subcontractor Onboarding & Approval',
        [
          step('Subcontractor submits tender / expression of interest', 'Procurement', ['Email'], { work: 15, wait: 0 }),
          step('Pre-qualification questionnaire sent', 'Procurement', ['Email', 'Word'], { work: 20, wait: 0 }),
          step('PQQ returned and checked', 'Procurement', ['Email', 'Word', 'Excel'], { work: 60, wait: 2880, isBottleneck: true }),
          step('Insurance & accreditation certificates verified', 'HSEQ', ['Email', 'Excel'], { work: 45, wait: 1440, isBottleneck: true }),
          step('Financial health check', 'Finance', ['Creditsafe', 'Excel'], { work: 30, wait: 480 }),
          step('Approved supplier list decision', 'Procurement', ['Excel'], { isDecision: true, branches: ['approved', 'rejected', 'conditional'], work: 15, wait: 0 }),
          step('Set up on Sage & issue supplier code', 'Finance', ['Sage', 'Email'], { work: 20, wait: 960 }),
          step('Welcome pack & site induction materials sent', 'Admin', ['Email', 'SharePoint'], { work: 15, wait: 0 }),
        ],
        { type: 'weekly', annual: 52 },
        { hours: 3.4, team: 3, cycleDays: 10 },
        { reason: 'systems', why: 'Certificates tracked in email folders; expiry reminders manual; duplicate data entry across Sage and Excel' }
      ),
      mkProcess(
        'Variation Order Approval',
        [
          step('Site manager raises variation request', 'Site Management', ['Email', 'Paper'], { work: 20, wait: 0 }),
          step('Quantity surveyor prices variation', 'QS', ['Excel', 'Email'], { work: 90, wait: 1440, isBottleneck: true }),
          step('Revised programme impact assessed', 'Planning', ['MS Project', 'Email'], { work: 45, wait: 480 }),
          step('PM review & internal approval', 'Project Management', ['Email'], { isApproval: true, work: 20, wait: 480 }),
          step('Variation presented to client', 'Commercial', ['Email', 'Word'], { work: 30, wait: 2880, isBottleneck: true }),
          step('Client approval / rejection / negotiation', 'Client', ['Email'], { isApproval: true, work: 15, wait: 5040 }),
          step('VO formally instructed & signed', 'Commercial', ['Email', 'DocuSign'], { work: 15, wait: 0 }),
          step('Contract and programme updated', 'Commercial', ['Word', 'MS Project'], { work: 30, wait: 0 }),
        ],
        { type: 'weekly', annual: 104 },
        { hours: 4.3, team: 3, cycleDays: 12 },
        { reason: 'waiting', why: 'Client decision on variations averages 7 days; no portal — all via email with no version control' }
      ),
    ],
  },

  // 10. Logistics & Supply Chain
  {
    industry: 'Logistics & Supply Chain',
    company: 'SwiftMove Freight Solutions',
    contactName: 'Daniel Kovacs',
    contactEmail: 'test+logistics@sharpin.co',
    processes: [
      mkProcess(
        'International Shipment Booking & Documentation',
        [
          step('Customer booking request received', 'Customer Service', ['Email', 'Phone'], { work: 15, wait: 0 }),
          step('Rate check across carrier systems', 'Operations', ['Cargowise', 'Maersk', 'MSC Portal'], { work: 25, wait: 0, isBottleneck: true }),
          step('Booking confirmed with carrier', 'Operations', ['Cargowise', 'Carrier Portal'], { work: 20, wait: 60 }),
          step('Shipping instructions collected from customer', 'Customer Service', ['Email'], { work: 15, wait: 1440, isBottleneck: true }),
          step('Bill of Lading draft prepared', 'Documentation', ['Cargowise', 'Word'], { work: 30, wait: 0 }),
          step('Customer review & corrections', 'Documentation', ['Email'], { work: 10, wait: 2880, isBottleneck: true }),
          step('Customs entry prepared', 'Customs', ['Descartes', 'Cargowise'], { work: 45, wait: 0 }),
          step('HMRC submission & tariff classification check', 'Customs', ['CDS', 'Descartes'], { work: 30, wait: 120 }),
          step('Final documentation issued to customer', 'Documentation', ['Email', 'Cargowise'], { work: 10, wait: 0 }),
        ],
        { type: 'daily', annual: 260 },
        { hours: 3.3, team: 2, cycleDays: 6 },
        { reason: 'systems', why: 'Five separate systems with no integration; data re-keyed between carrier portals, Cargowise and customs platforms' }
      ),
    ],
  },

  // 11. Education & Training
  {
    industry: 'Education & Training',
    company: 'Westbourne Academy',
    contactName: 'Angela Nkosi',
    contactEmail: 'test+education@sharpin.co',
    processes: [
      mkProcess(
        'Student Enrollment & Induction',
        [
          step('Application submitted via UCAS or direct form', 'Admissions', ['UCAS', 'Website'], { work: 10, wait: 0 }),
          step('Application review & offer decision', 'Admissions', ['SITS', 'Email'], { work: 30, wait: 2880, isBottleneck: true }),
          step('Offer letter generated & sent', 'Admissions', ['SITS', 'Word'], { work: 20, wait: 0 }),
          step('Student accepts & pays deposit', 'Finance', ['SITS', 'Stripe'], { work: 10, wait: 5040, isBottleneck: true }),
          step('Pre-enrolment documents collected (ID, qualifications)', 'Registry', ['Email', 'SharePoint'], { work: 30, wait: 2880 }),
          step('Student record created in MIS', 'Registry', ['SITS', 'Portal'], { work: 25, wait: 0 }),
          step('Module registration & timetable', 'Registry', ['SITS'], { work: 20, wait: 0 }),
          step('IT account provisioning', 'IT', ['Active Directory', 'SITS'], { work: 20, wait: 480 }),
          step('Induction day attendance recorded', 'Registry', ['SITS', 'Paper'], { work: 15, wait: 0 }),
        ],
        { type: 'twice-yearly', annual: 2 },
        { hours: 2.8, team: 4, cycleDays: 30 },
        { reason: 'handoffs', why: 'Admissions, Registry, Finance and IT have no shared system; handoffs via email with no tracking' }
      ),
    ],
  },

  // 12. Legal & Compliance
  {
    industry: 'Legal & Compliance',
    company: 'Thornton & Calder Solicitors',
    contactName: 'Victoria Thornton',
    contactEmail: 'test+legal@sharpin.co',
    processes: [
      mkProcess(
        'Contract Review & Execution',
        [
          step('Contract received from counterparty', 'Legal', ['Email', 'Outlook'], { work: 10, wait: 0 }),
          step('Register in contract management log', 'Legal', ['Excel'], { work: 15, wait: 0, isBottleneck: true }),
          step('Assign reviewing solicitor', 'Legal', ['Email', 'Outlook'], { work: 10, wait: 120 }),
          step('First review & redline in Word', 'Legal', ['Word', 'Email'], { work: 120, wait: 0 }),
          step('Internal commercial sign-off', 'Commercial', ['Email', 'Word'], { isApproval: true, work: 30, wait: 1440, isBottleneck: true }),
          step('Negotiate redlines with counterparty', 'Legal', ['Email', 'Word'], { work: 60, wait: 2880, isBottleneck: true }),
          step('Final approval — partner review', 'Legal', ['Email', 'Word'], { isApproval: true, work: 20, wait: 480 }),
          step('Execution via DocuSign or wet ink', 'Legal', ['DocuSign', 'Email'], { work: 15, wait: 1440 }),
          step('Executed contract filed and logged', 'Legal', ['SharePoint', 'Excel'], { work: 15, wait: 0 }),
        ],
        { type: 'weekly', annual: 52 },
        { hours: 4.8, team: 3, cycleDays: 18 },
        { reason: 'unclear', why: 'No contract workflow system; parallel email threads lose version history; unclear who owns each negotiation' }
      ),
    ],
  },

  // 13. Hospitality & Travel
  {
    industry: 'Hospitality & Travel',
    company: 'Grand Horizon Hotels',
    contactName: 'Marco Rinaldi',
    contactEmail: 'test+hospitality@sharpin.co',
    processes: [
      mkProcess(
        'Group & Event Booking Confirmation',
        [
          step('Group enquiry received', 'Sales', ['Email', 'Phone', 'Opera PMS'], { work: 15, wait: 0 }),
          step('Room block & function space provisional hold', 'Reservations', ['Opera PMS'], { work: 20, wait: 0 }),
          step('Event contract prepared in Word', 'Sales', ['Word', 'Email'], { work: 45, wait: 0, isBottleneck: true }),
          step('Revenue manager approval on rate', 'Revenue', ['Email', 'Opera PMS'], { isApproval: true, work: 15, wait: 480 }),
          step('Contract sent and awaiting client signature', 'Sales', ['Email', 'DocuSign'], { work: 5, wait: 2880, isBottleneck: true }),
          step('Deposit invoice raised', 'Finance', ['Opera PMS', 'Sage'], { work: 20, wait: 0 }),
          step('Event brief distributed to departments', 'Events', ['Email', 'Word'], { work: 30, wait: 0 }),
          step('BEO (Banqueting Event Order) created', 'Events', ['Opera PMS', 'Word'], { work: 45, wait: 0, isBottleneck: true }),
        ],
        { type: 'weekly', annual: 52 },
        { hours: 3.3, team: 3, cycleDays: 7 },
        { reason: 'handoffs', why: 'Event data manually re-entered from email into Opera PMS and then again into Word BEOs — triple entry' }
      ),
    ],
  },

  // 14. Energy & Utilities
  {
    industry: 'Energy & Utilities',
    company: 'Clearstream Energy Services',
    contactName: 'Susan Bradley',
    contactEmail: 'test+energy@sharpin.co',
    processes: [
      mkProcess(
        'Domestic Meter Reading & Bill Reconciliation',
        [
          step('Scheduled meter reading due notification', 'Field Ops', ['Scheduled Job', 'SMS'], { isAutomated: true, work: 5, wait: 0 }),
          step('Field operative reads or customer submits reading', 'Field Ops', ['Mobile App', 'Phone', 'Website'], { work: 10, wait: 1440 }),
          step('Reading validated against estimated consumption', 'Billing', ['SAP IS-U', 'Excel'], { work: 15, wait: 0, isBottleneck: true }),
          step('Exception: estimated vs actual variance review', 'Billing', ['SAP IS-U', 'Excel'], { isDecision: true, branches: ['accepted', 'query', 'replace-with-estimate'], work: 20, wait: 0 }),
          step('Bill calculated in billing system', 'Billing', ['SAP IS-U'], { isAutomated: true, work: 2, wait: 10 }),
          step('Bill issued to customer', 'Billing', ['SAP IS-U', 'Email', 'Post'], { isAutomated: true, work: 2, wait: 0 }),
          step('Payment received & matched', 'Finance', ['SAP IS-U', 'Bank'], { isAutomated: true, work: 2, wait: 0 }),
          step('Debt flag raised if unpaid after 28 days', 'Collections', ['SAP IS-U'], { work: 10, wait: 40320, isBottleneck: true }),
        ],
        { type: 'monthly', annual: 12 * 1000 },
        { hours: 0.25, team: 1, cycleDays: 35 },
        { reason: 'rework', why: 'Estimated reads and missed reads create reconciliation exceptions that require manual intervention for ~15% of accounts' }
      ),
    ],
  },

  // 15. Media & Marketing
  {
    industry: 'Media & Marketing',
    company: 'Pulse Creative Agency',
    contactName: 'Jasmine Okafor',
    contactEmail: 'test+media@sharpin.co',
    processes: [
      mkProcess(
        'Campaign Content Approval Workflow',
        [
          step('Brief received from client', 'Account Management', ['Email', 'HubSpot'], { work: 15, wait: 0 }),
          step('Creative brief written & shared with team', 'Account Management', ['Asana', 'Word'], { work: 30, wait: 0 }),
          step('Creative assets produced', 'Creative', ['Adobe Creative Suite', 'Figma'], { work: 240, wait: 0 }),
          step('Internal creative director review', 'Creative', ['Slack', 'Frame.io'], { isApproval: true, work: 30, wait: 480, isBottleneck: true }),
          step('Amends and revisions', 'Creative', ['Adobe Creative Suite', 'Frame.io'], { work: 90, wait: 0 }),
          step('Compliance/legal check (regulated clients)', 'Legal', ['Email', 'Word'], { isApproval: true, work: 30, wait: 1440, isBottleneck: true }),
          step('Client review round 1', 'Client', ['Email', 'Frame.io'], { isApproval: true, work: 15, wait: 2880, isBottleneck: true }),
          step('Further amends if required', 'Creative', ['Adobe Creative Suite'], { work: 60, wait: 0 }),
          step('Client final sign-off', 'Client', ['Email'], { isApproval: true, work: 10, wait: 1440 }),
          step('Assets prepared for media delivery', 'Creative', ['Adobe Creative Suite', 'Dropbox'], { work: 30, wait: 0 }),
        ],
        { type: 'weekly', annual: 52 },
        { hours: 8.8, team: 3, cycleDays: 10 },
        { reason: 'approvals', why: 'Average 3.2 approval rounds per campaign; no structured feedback system means corrections misunderstood' }
      ),
    ],
  },

  // 16. Insurance
  {
    industry: 'Insurance',
    company: 'Beacon Underwriting Ltd',
    contactName: 'Philip Hartley',
    contactEmail: 'test+insurance@sharpin.co',
    processes: [
      mkProcess(
        'Motor Insurance Claims Processing',
        [
          step('Claim notification received (phone/portal)', 'Claims', ['Guidewire', 'Phone'], { work: 20, wait: 0 }),
          step('First notification of loss (FNOL) recorded', 'Claims', ['Guidewire'], { work: 25, wait: 0 }),
          step('Policy validation & coverage check', 'Claims', ['Guidewire', 'Policy Admin'], { work: 20, wait: 30, isBottleneck: true }),
          step('Vehicle damage assessment instructed', 'Claims', ['Guidewire', 'Email'], { work: 15, wait: 0 }),
          step('Repairer / assessor inspection', 'Third Party', ['Email', 'Guidewire'], { work: 10, wait: 2880, isBottleneck: true }),
          step('Estimate reviewed: total loss or repair?', 'Claims', ['Guidewire'], { isDecision: true, branches: ['repair', 'total-loss', 'further-investigation'], work: 15, wait: 0 }),
          step('Settlement offer calculated & presented', 'Claims', ['Guidewire', 'Excel'], { work: 30, wait: 0 }),
          step('Customer acceptance / negotiation', 'Claims', ['Phone', 'Guidewire'], { work: 20, wait: 2880, isBottleneck: true }),
          step('Payment authorised & processed', 'Finance', ['Guidewire', 'Bank'], { work: 15, wait: 240 }),
          step('Claim closed & reserve released', 'Claims', ['Guidewire'], { work: 10, wait: 0 }),
        ],
        { type: 'daily', annual: 260 },
        { hours: 3.0, team: 2, cycleDays: 12 },
        { reason: 'waiting', why: 'Assessor scheduling and customer response are the key bottlenecks; internal processing is relatively fast' }
      ),
    ],
  },

  // 17. Pharmaceuticals & Biotech
  {
    industry: 'Pharmaceuticals & Biotech',
    company: 'Elara BioSolutions',
    contactName: 'Dr. Nathan Webb',
    contactEmail: 'test+pharma@sharpin.co',
    processes: [
      mkProcess(
        'Batch Release & Quality Control Testing',
        [
          step('Batch manufactured; samples drawn', 'Manufacturing', ['MES', 'LIMS'], { work: 30, wait: 0 }),
          step('In-process QC results reviewed', 'Quality', ['LIMS', 'Excel'], { work: 45, wait: 0 }),
          step('Final product testing (microbial, potency, stability)', 'Quality', ['LIMS'], { work: 30, wait: 2880, isBottleneck: true }),
          step('OOS investigation if test failure', 'Quality', ['LIMS', 'Word'], { isDecision: true, branches: ['pass', 'oos-investigation'], work: 60, wait: 0 }),
          step('Batch record review (manual)', 'Quality', ['Paper', 'Word', 'LIMS'], { work: 180, wait: 0, isBottleneck: true }),
          step('QP certification review', 'Regulatory', ['Word', 'Email', 'LIMS'], { isApproval: true, work: 90, wait: 1440, isBottleneck: true }),
          step('Batch release authorised in system', 'Quality', ['SAP', 'LIMS'], { work: 15, wait: 0 }),
          step('Certificate of Analysis issued', 'Quality', ['LIMS', 'Word'], { work: 20, wait: 0 }),
          step('Product dispatched to distribution', 'Logistics', ['SAP'], { work: 15, wait: 0 }),
        ],
        { type: 'weekly', annual: 52 },
        { hours: 7.8, team: 4, cycleDays: 7 },
        { reason: 'manual-work', why: 'Batch records are still predominantly paper-based; QP relies on manual cross-checking across 3 systems' }
      ),
    ],
  },

  // 18. Telecommunications
  {
    industry: 'Telecommunications',
    company: 'Horizon Telecom Solutions',
    contactName: 'Amy Stafford',
    contactEmail: 'test+telco@sharpin.co',
    processes: [
      mkProcess(
        'Business Broadband New Connection Activation',
        [
          step('Order received via sales / web portal', 'Sales', ['Salesforce', 'Order Portal'], { work: 15, wait: 0 }),
          step('Credit check & customer validation', 'Finance', ['Experian', 'Salesforce'], { work: 15, wait: 30 }),
          step('Circuit & product availability check', 'Technical', ['Network Inventory', 'Salesforce'], { work: 20, wait: 0, isBottleneck: true }),
          step('Order provisioned in OSS/BSS', 'Operations', ['Netcracker', 'Salesforce'], { work: 30, wait: 0 }),
          step('Openreach / wholesale order raised', 'Provisioning', ['BT Wholesale Portal', 'Netcracker'], { work: 25, wait: 0 }),
          step('Engineer survey / installation appointment', 'Field', ['Openreach Portal', 'Scheduling Tool'], { work: 15, wait: 10080, isBottleneck: true }),
          step('On-site installation', 'Field', ['Laptop', 'Tools'], { work: 120, wait: 0 }),
          step('Service test & sign-off', 'Technical', ['Network Monitor', 'Netcracker'], { work: 30, wait: 0 }),
          step('Customer portal account created & welcome pack sent', 'Operations', ['Salesforce', 'Netcracker', 'Email'], { work: 20, wait: 0, isBottleneck: true }),
          step('Billing activated in BSS', 'Finance', ['Netcracker', 'Billing System'], { isAutomated: true, work: 5, wait: 0 }),
        ],
        { type: 'daily', annual: 260 },
        { hours: 4.6, team: 2, cycleDays: 14 },
        { reason: 'systems', why: 'Salesforce, Netcracker and Openreach portal operate independently; data entered three times with no automated handoffs' }
      ),
    ],
  },

];

// ── cost analysis computation (mirrors API logic) ────────────────────────────

const DEPT_RATE_MULT = {
  Engineering: 1.2, DevOps: 1.25, QA: 0.9, Product: 1.15, Security: 1.2,
  Finance: 1.0, 'Accounts Payable': 0.95, Credit: 1.05, 'Credit Risk': 1.1, Operations: 0.95, Compliance: 1.0,
  Clinical: 1.15, Reception: 0.7, Administration: 0.8,
  Procurement: 0.95, Warehouse: 0.75, Quality: 1.0, HSEQ: 0.95,
  'Customer Service': 0.85, 'Site Management': 0.95, QS: 1.0, 'Project Management': 1.0, Commercial: 1.05,
  Documentation: 0.9, Customs: 0.95, 'Field Ops': 0.9,
  Admissions: 0.85, Registry: 0.85, IT: 0.95,
  Legal: 1.2, Sales: 0.95, Reservations: 0.85, Revenue: 0.95, Events: 0.9,
  Billing: 0.9, Collections: 0.85,
  'Account Management': 0.95, Creative: 1.0,
  Claims: 0.9, 'Third Party': 0.8,
  Manufacturing: 0.9, Regulatory: 1.1, Logistics: 0.85,
  Technical: 0.95, Provisioning: 0.85, Field: 0.9,
  Planning: 0.9, Fundraising: 0.85, Trustees: 0.9, Admin: 0.8,
  Digital: 0.95, Support: 0.85, Leadership: 1.2, Consultants: 1.1, Management: 1.0,
};

function computeCostAnalysis(rawProcesses, industry) {
  const departments = [...new Set(rawProcesses.flatMap(p => (p.steps || []).map(s => s.department).filter(Boolean)))];
  const allSystems = [...new Set(rawProcesses.flatMap(p => (p.steps || []).flatMap(s => s.systems || []).filter(Boolean)))];
  const blendedBase = industry.includes('Pharma') || industry.includes('Financial') ? 60 : industry.includes('Healthcare') || industry.includes('Legal') ? 55 : 50;
  const labourRates = departments.length > 0
    ? departments.map(d => ({
        department: d,
        hourlyRate: Math.round(blendedBase * (DEPT_RATE_MULT[d] || 1)),
        utilisation: 0.85,
      }))
    : [{ department: 'Default', hourlyRate: blendedBase, utilisation: 0.85 }];
  const blendedRate = blendedBase;
  const onCostMultiplier = 1.25;
  const systemCosts = {};
  allSystems.forEach(s => { systemCosts[s] = s.length > 4 ? 12000 : 6000; });
  const totalSystemsCost = Object.values(systemCosts).reduce((a, b) => a + b, 0);
  const costAnalysis = {
    labourRates,
    blendedRate,
    onCostMultiplier,
    nonLabour: { externalPerInstance: 15, complianceAnnual: 8000, systemCosts, systemsAnnual: totalSystemsCost },
    processSavings: {},
    scenarios: { conservative: {}, base: {}, optimistic: {} },
    activeScenario: 'base',
    implementationCost: { platform: 12000, setup: 25000, training: 0, maintenanceAnnual: 0 },
    processCostDrivers: {},
    growthRate: 0.05,
    currency: 'GBP',
  };

  const rateByDept = (labourRates || []).reduce((acc, r) => {
    if (r.department && r.hourlyRate > 0) acc[r.department] = (r.hourlyRate || 0) * (r.utilisation ?? 1);
    return acc;
  }, {});
  const defaultRate = (blendedRate || 50) * (onCostMultiplier || 1.25);

  let totalTrueLabour = 0, totalHiddenCost = 0, totalPotentialSavings = 0;
  const updatedRaw = rawProcesses.map((raw, i) => {
    const cycleDays = raw.costs?.cycleDays ?? raw.frequency?.cycleDays ?? 0;
    const costs = raw.costs || {};
    const hoursPerInstance = costs.hoursPerInstance ?? 4;
    const teamSize = costs.teamSize ?? 1;
    const annual = costs.annual ?? (raw.frequency?.annual ?? 12);
    const depts = (raw.steps || []).map(s => s.department).filter(Boolean);
    const avgRate = depts.length > 0
      ? depts.reduce((sum, d) => sum + (rateByDept[d] ?? defaultRate), 0) / depts.length
      : defaultRate;
    const annualLabour = hoursPerInstance * avgRate * annual * teamSize;
    const errorRate = 0.08;
    const waitCostPct = 0.12;
    const errorCost = annualLabour * errorRate * 0.5;
    const waitCost = annualLabour * waitCostPct;
    const trueAnnualCost = annualLabour + errorCost + waitCost;
    const baseSavingsPct = raw.savings?.percent ?? 35;
    costAnalysis.scenarios.base[i] = baseSavingsPct;
    costAnalysis.scenarios.conservative[i] = Math.round(baseSavingsPct * 0.65);
    costAnalysis.scenarios.optimistic[i] = Math.min(80, Math.round(baseSavingsPct * 1.4));
    const potentialSavings = trueAnnualCost * (baseSavingsPct / 100);
    totalTrueLabour += annualLabour;
    totalHiddenCost += errorCost + waitCost;
    totalPotentialSavings += potentialSavings;
    costAnalysis.processCostDrivers[i] = { errorRate: 0.08, waitCostPct: 0.12 };
    return {
      ...raw,
      lastExample: { name: '', startDate: '', endDate: '', elapsedDays: cycleDays },
      costs: {
        ...costs,
        hourlyRate: avgRate,
        instanceCost: hoursPerInstance * avgRate,
        annualUserCost: hoursPerInstance * avgRate * annual,
        totalAnnualCost: annualLabour,
        trueAnnualCost,
        errorCost,
        waitCost,
        teamSize,
        hoursPerInstance,
        annual,
        cycleDays,
      },
      savings: { ...(raw.savings || {}), percent: baseSavingsPct, potential: trueAnnualCost * (baseSavingsPct / 100) },
    };
  });

  const totalInstances = updatedRaw.reduce((sum, r) => sum + ((r.costs?.annual ?? r.frequency?.annual ?? 12) * (r.costs?.teamSize ?? 1)), 0);
  const systemsAnnual = totalSystemsCost;
  const externalAnnual = 15 * Math.max(totalInstances, 1);
  const complianceAnnual = 8000;
  const totalFixed = systemsAnnual + externalAnnual + complianceAnnual;
  const totalAnnualCost = totalTrueLabour + totalHiddenCost + totalFixed;
  const fteEquivalent = totalPotentialSavings > 0 ? +(totalPotentialSavings / (defaultRate * 2080)).toFixed(2) : 0;
  const costPerInstanceAvg = totalInstances > 0 ? Math.round(totalAnnualCost / totalInstances) : 0;

  const implTotal = 12000 + 25000;
  const implMaintenance = 0;
  const DISCOUNT = 0.08;
  const year1Savings = totalPotentialSavings;
  const year2Savings = year1Savings * 1.05;
  const year3Savings = year2Savings * 1.05;
  const year1Net = year1Savings - implTotal - implMaintenance;
  const year2Net = year2Savings - implMaintenance;
  const year3Net = year3Savings - implMaintenance;
  const npv3yr = Math.round(
    year1Net / (1 + DISCOUNT) + year2Net / Math.pow(1 + DISCOUNT, 2) + year3Net / Math.pow(1 + DISCOUNT, 3)
  );
  const totalNetBenefit = year1Net + year2Net + year3Net;
  const roi3yr = implTotal > 0 ? Math.round(totalNetBenefit / implTotal * 100) : null;
  const monthlyNetSavings = (totalPotentialSavings - implMaintenance) / 12;
  const paybackMonths = implTotal > 0 && monthlyNetSavings > 0 ? Math.ceil(implTotal / monthlyNetSavings) : 0;

  const financialModel = {
    scenario: 'base',
    totalAnnualCost,
    totalLabour: totalTrueLabour,
    totalHiddenCost,
    totalFixed,
    potentialSavings: totalPotentialSavings,
    fteEquivalent,
    costPerInstanceAvg,
    implTotal,
    implMaintenance,
    paybackMonths,
    npv3yr,
    roi3yr,
    year1Net,
    year2Net,
    year3Net,
    growthRate: 0.05,
  };

  const updatedProcesses = rawProcesses.map((p, i) => ({
    name: p.processName,
    description: '',
    steps: p.steps,
    annualCost: updatedRaw[i].costs.trueAnnualCost,
    elapsedDays: updatedRaw[i].costs?.cycleDays ?? p.costs?.cycleDays ?? 0,
  }));

  return { costAnalysis, financialModel, updatedProcesses, updatedRawProcesses: updatedRaw };
}

// ── supabase insert ──────────────────────────────────────────────────────────

async function insertReport(tc) {
  const reportId = uuid();
  const costToken = token();
  const now = new Date().toISOString();

  // Build summary automation score from steps
  const allSteps = tc.processes.flatMap(p => p.steps);
  const manualCount = allSteps.filter(s => !s.isAutomated).length;
  const automationPct = allSteps.length > 0 ? Math.round((1 - manualCount / allSteps.length) * 100) : 50;

  // Compute complete cost analysis for this industry
  const rawProcesses = tc.processes.map(p => ({
    processName: p.processName,
    steps: p.steps,
    frequency: p.frequency,
    costs: p.costs,
    bottleneck: p.bottleneck,
    savings: p.savings,
  }));
  const { costAnalysis, financialModel, updatedProcesses, updatedRawProcesses } = computeCostAnalysis(rawProcesses, tc.industry);

  const diagData = {
    contact: {
      name: tc.contactName,
      email: OWNER_EMAIL,
      company: tc.company,
      industry: tc.industry,
    },
    summary: {
      processCount: tc.processes.length,
      totalProcesses: tc.processes.length,
      totalAnnualCost: financialModel.totalAnnualCost,
      potentialSavings: financialModel.potentialSavings,
    },
    automationScore: {
      percentage: automationPct,
      label: automationPct > 60 ? 'Developing' : 'Early Stage',
    },
    processes: updatedProcesses,
    rawProcesses: updatedRawProcesses,
    costAnalysisStatus: 'complete',
    costAnalysis,
    financialModel,
    costAnalysisToken: costToken,
    costAnalysisHistory: [{ savedAt: new Date().toISOString(), savedBy: 'manager' }],
  };

  const payload = {
    id: reportId,
    contact_name: tc.contactName,
    contact_email: OWNER_EMAIL,
    company: tc.company,
    lead_score: 70,
    lead_grade: 'B',
    diagnostic_data: diagData,
    created_at: now,
    updated_at: now,
  };

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/diagnostic_reports`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Supabase error for ${tc.industry}: ${resp.status} ${text}`);
  }

  return { reportId, costToken, industry: tc.industry, company: tc.company };
}

// ── main ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log(`\nSeeding ${TEST_CASES.length} test diagnostic reports…\n`);
  const results = [];

  for (const tc of TEST_CASES) {
    try {
      const r = await insertReport(tc);
      results.push(r);
      console.log(`✓  ${tc.industry.padEnd(38)} → ${r.reportId}`);
    } catch (e) {
      console.error(`✗  ${tc.industry}: ${e.message}`);
    }
  }

  console.log('\n── Cost analysis URLs (open in browser) ──────────────────────────────\n');
  results.forEach(r => {
    const url = `${BASE_URL}/cost-analysis?id=${r.reportId}&token=${r.costToken}`;
    console.log(`${r.industry}`);
    console.log(`  ${url}\n`);
  });

  console.log('── Report URLs ────────────────────────────────────────────────────────\n');
  results.forEach(r => {
    console.log(`${r.industry}`);
    console.log(`  ${BASE_URL}/report?id=${r.reportId}\n`);
  });

  console.log(`Done. ${results.length}/${TEST_CASES.length} reports created.\n`);
  console.log('── Access ─────────────────────────────────────────────────────────────\n');
  console.log('Owner login: hope.tettey@gmail.com → /portal (view all reports)');
  console.log('Manager: use cost-analysis URLs above with token for cost editing\n');
})();
