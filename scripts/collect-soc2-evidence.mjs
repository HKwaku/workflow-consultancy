#!/usr/bin/env node
/**
 * collect-soc2-evidence.mjs
 *
 * Monthly SOC 2 evidence snapshot. Run from a workstation with .env.local
 * loaded (or via a scheduled CI job). Writes a timestamped folder under
 * ./compliance/evidence/YYYY-MM-DD/ containing:
 *
 *   01-rls-policies.json          — pg_policies dump (CC6.1, CC6.3, C1.1)
 *   02-cron-runs.json             — last 30 days of cron-job audit rows (CC4.1, CC7.2, A1.2)
 *   03-audit-log-summary.json     — audit_logs row counts + 50-row sample (CC2.1, CC4.2)
 *   04-mfa-status.json            — per-org MFA enrolment (CC6.2)
 *   05-token-usage.json           — token_usage_ledger 30-day rollup (CC9.1)
 *   06-vendor-inventory.json      — extracted from package.json + env names (CC9.2)
 *   07-migration-history.json     — supabase/MIGRATIONS.md + git log of migrations (CC8.1)
 *   08-customer-key-status.json   — per-org BYO key fingerprints + age (CC6.5, P-series)
 *   00-MANIFEST.md                — index + control mapping for the auditor
 *
 * Usage:
 *   node scripts/collect-soc2-evidence.mjs
 *   node scripts/collect-soc2-evidence.mjs --out ./snapshots/2026-04
 *
 * Requires:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * The script is idempotent — re-running on the same day overwrites that day's
 * folder. Snapshots are intended to live in a private store the auditor can
 * read (Drata/Vanta/Secureframe upload, or a versioned private S3 bucket).
 *
 * NEVER commit the evidence/ folder to git. It contains customer identifiers
 * and access patterns. The .gitignore in this repo excludes it; verify before
 * each run.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

/* ── Env loading (minimal — avoid pulling next/env into a node script) ── */

function loadDotEnv() {
  const path = join(REPO_ROOT, '.env.local');
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadDotEnv();

/* ── CLI args ───────────────────────────────────────────── */

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') out.out = argv[i + 1]; // takes next
    if (arg === '--help' || arg === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv);
if (args.help) {
  console.log('Usage: node scripts/collect-soc2-evidence.mjs [--out <dir>]');
  process.exit(0);
}

const today = new Date().toISOString().slice(0, 10);
const outDir = args.out
  ? resolve(args.out)
  : join(REPO_ROOT, 'compliance', 'evidence', today);

mkdirSync(outDir, { recursive: true });

/* ── Supabase client ────────────────────────────────────── */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('FATAL: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required.');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/* ── Helpers ────────────────────────────────────────────── */

function writeJson(name, payload) {
  const path = join(outDir, name);
  writeFileSync(path, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`  wrote ${name}`);
}

function writeText(name, content) {
  const path = join(outDir, name);
  writeFileSync(path, content, 'utf8');
  console.log(`  wrote ${name}`);
}

async function safe(label, fn) {
  try {
    const result = await fn();
    return { ok: true, label, ...result };
  } catch (e) {
    console.warn(`  WARN ${label}: ${e?.message || e}`);
    return { ok: false, label, error: e?.message || String(e) };
  }
}

/* ── Collectors ─────────────────────────────────────────── */

async function collectRlsPolicies() {
  // pg_policies is exposed via the `pg_catalog` schema; we read via a
  // service-role RPC if it exists, else fall back to a select on the view.
  const { data, error } = await sb.rpc('debug_list_rls_policies').catch(() => ({ data: null, error: null }));
  if (data) return { generatedAt: new Date().toISOString(), source: 'rpc', policies: data };

  // Fallback: pg_policies is queryable via PostgREST only if exposed in schema.
  // If not, the auditor will pull via Supabase Studio export.
  void error;
  return {
    generatedAt: new Date().toISOString(),
    source: 'manual',
    note: 'RPC debug_list_rls_policies not present; export pg_policies from Supabase Studio and attach as 01b-rls-policies-supabase-export.json',
  };
}

async function collectCronRuns() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Per-job rollup from the view — small payload, exactly what an auditor wants.
  const { data: rollup, error: rollupErr } = await sb
    .from('cron_run_log_30d_rollup')
    .select('*');

  // Recent failure sample — auditor will dig into these.
  const { data: failures, error: failuresErr } = await sb
    .from('cron_run_log')
    .select('id, job_name, status, started_at, completed_at, duration_ms, error_message, request_id')
    .in('status', ['failed', 'timed_out'])
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(200);

  return {
    generatedAt: new Date().toISOString(),
    since,
    rollup: rollupErr ? { error: rollupErr.message } : rollup,
    recentFailures: failuresErr ? { error: failuresErr.message } : failures,
    note: rollupErr?.message?.includes('does not exist')
      ? 'cron_run_log table not yet created — apply supabase/migration-cron-run-log.sql + wrap cron handlers via lib/cronWrapper.js.'
      : null,
  };
}

async function collectAuditLogSummary() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: sample, error } = await sb
    .from('audit_logs')
    .select('id, actor_email, actor_kind, action, target_type, target_id, organization_id, deal_id, outcome, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    // Fall back to BYO-key audit if audit_logs not yet applied.
    const { data: keyAudit } = await sb
      .from('customer_api_key_audit')
      .select('id, organization_id, vendor, action, key_fingerprint, actor_email, request_id, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(50);
    return {
      generatedAt: new Date().toISOString(),
      source: 'fallback',
      table: 'customer_api_key_audit',
      sample: keyAudit || [],
      note: 'audit_logs table missing — apply supabase/migration-audit-logs.sql. Showing customer_api_key_audit only as a fallback.',
      error: error.message,
    };
  }

  const { count, error: countErr } = await sb
    .from('audit_logs')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', since);

  // Per-action and per-outcome rollups for the auditor's quick scan.
  const byAction = {};
  const byOutcome = { success: 0, denied: 0, error: 0 };
  for (const row of sample || []) {
    byAction[row.action] = (byAction[row.action] || 0) + 1;
    if (byOutcome[row.outcome] !== undefined) byOutcome[row.outcome] += 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    source: 'audit_logs',
    window: '30 days',
    rowCount: countErr ? null : count,
    sampleRollup: { byAction, byOutcome, sampleSize: (sample || []).length },
    sample,
  };
}

async function collectMfaStatus() {
  // We import the helper directly so the policy lives in one place.
  const { getAllOrgsMfaReport } = await import('../lib/mfaCheck.js');
  const report = await getAllOrgsMfaReport({ limit: 1000 });
  return report || { generatedAt: new Date().toISOString(), error: 'mfaCheck unavailable' };
}

async function collectTokenUsage() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from('token_usage_ledger')
    .select('organization_id, vendor, model, surface, input_tokens, output_tokens, total_tokens, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) {
    return { generatedAt: new Date().toISOString(), error: error.message };
  }
  const byOrg = {};
  for (const row of data || []) {
    const k = row.organization_id || 'unknown';
    if (!byOrg[k]) byOrg[k] = { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    byOrg[k].calls += 1;
    byOrg[k].inputTokens += Number(row.input_tokens) || 0;
    byOrg[k].outputTokens += Number(row.output_tokens) || 0;
    byOrg[k].totalTokens += Number(row.total_tokens) || 0;
  }
  return {
    generatedAt: new Date().toISOString(),
    window: '30 days',
    totalCalls: (data || []).length,
    note: 'token_usage_ledger has no cost column in current schema. Cost is computed at read time from model rate cards. If auditor needs $ figures, run computeCostFromTokens(byOrg) at upload time.',
    byOrg,
  };
}

function collectVendorInventory() {
  const pkgPath = join(REPO_ROOT, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

  // Extract unique vendor identifiers from env-var names (do NOT capture values).
  const envKeys = Object.keys(process.env).filter((k) => /API_KEY|SECRET|TOKEN|URL/.test(k));
  const envIdentifiers = envKeys.map((k) => k.replace(/_(API_KEY|SECRET|TOKEN|URL)$/i, '')).filter(Boolean);
  const uniqueVendors = [...new Set(envIdentifiers)].sort();

  return {
    generatedAt: new Date().toISOString(),
    note: 'Vendor inventory from package.json deps + env-var prefixes. Cross-reference compliance/policies/05-vendor-management.md and confirm DPA in force for each.',
    npmDependencies: Object.fromEntries(Object.entries(deps).sort()),
    envVendorPrefixes: uniqueVendors,
  };
}

function collectMigrationHistory() {
  const log = join(REPO_ROOT, 'supabase', 'MIGRATIONS.md');
  let migrationLog = null;
  if (existsSync(log)) migrationLog = readFileSync(log, 'utf8');

  let gitLog = null;
  try {
    gitLog = execSync('git log --since="365 days ago" --pretty=format:"%h %ai %an %s" -- supabase/', {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString('utf8');
  } catch {
    gitLog = null;
  }

  return {
    generatedAt: new Date().toISOString(),
    migrationLogPresent: Boolean(migrationLog),
    migrationLogChars: migrationLog?.length || 0,
    gitLogLast365Days: gitLog,
  };
}

async function collectCustomerKeyStatus() {
  const { data, error } = await sb
    .from('customer_api_keys')
    .select('organization_id, vendor, key_fingerprint, status, set_at, updated_at, last_validated_at, last_used_at, rotation_due_at');
  if (error) {
    return { generatedAt: new Date().toISOString(), error: error.message };
  }
  const now = Date.now();
  const enriched = (data || []).map((row) => {
    const lastTouch = new Date(row.updated_at || row.set_at).getTime();
    const ageDays = Math.floor((now - lastTouch) / (24 * 60 * 60 * 1000));
    const revoked = row.status === 'revoked';
    const rotationOverdue = !revoked && row.rotation_due_at
      ? new Date(row.rotation_due_at).getTime() < now
      : !revoked && ageDays >= 90;
    return {
      organization_id: row.organization_id,
      vendor: row.vendor,
      key_fingerprint: row.key_fingerprint,
      status: row.status,
      ageDays,
      lastValidatedAt: row.last_validated_at,
      lastUsedAt: row.last_used_at,
      rotationDueAt: row.rotation_due_at,
      rotationOverdue,
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    totalKeys: enriched.length,
    activeKeys: enriched.filter((k) => k.status === 'active').length,
    rotationOverdue: enriched.filter((k) => k.rotationOverdue).length,
    keys: enriched,
  };
}

/* ── Main ───────────────────────────────────────────────── */

async function main() {
  console.log(`SOC 2 evidence snapshot → ${outDir}`);

  const collectors = [
    ['01-rls-policies.json', collectRlsPolicies],
    ['02-cron-runs.json', collectCronRuns],
    ['03-audit-log-summary.json', collectAuditLogSummary],
    ['04-mfa-status.json', collectMfaStatus],
    ['05-token-usage.json', collectTokenUsage],
    ['06-vendor-inventory.json', () => Promise.resolve(collectVendorInventory())],
    ['07-migration-history.json', () => Promise.resolve(collectMigrationHistory())],
    ['08-customer-key-status.json', collectCustomerKeyStatus],
  ];

  const summary = [];
  for (const [name, fn] of collectors) {
    const result = await safe(name, async () => ({ payload: await fn() }));
    if (result.ok) {
      writeJson(name, result.payload);
      summary.push({ artefact: name, status: 'ok' });
    } else {
      writeJson(name, { error: result.error });
      summary.push({ artefact: name, status: 'failed', error: result.error });
    }
  }

  const manifest = renderManifest(summary);
  writeText('00-MANIFEST.md', manifest);

  const failed = summary.filter((s) => s.status !== 'ok');
  if (failed.length) {
    console.warn(`\nDone with ${failed.length} failed artefacts. Review the manifest before sharing with the auditor.`);
    process.exit(2);
  }
  console.log('\nDone.');
}

function renderManifest(summary) {
  const date = new Date().toISOString();
  const rows = summary.map((s) => `| ${s.artefact} | ${s.status} | ${s.error ? s.error.replace(/\|/g, '\\|') : ''} |`).join('\n');
  return `# SOC 2 Evidence Manifest

**Snapshot date:** ${date}
**Output directory:** ${outDir}

## Artefacts

| Artefact | Status | Notes |
|---|---|---|
${rows}

## Control mapping

| Artefact | TSC criteria |
|---|---|
| 01-rls-policies.json | CC6.1, CC6.3, C1.1 |
| 02-cron-runs.json | CC4.1, CC7.2, A1.2 |
| 03-audit-log-summary.json | CC2.1, CC4.2 |
| 04-mfa-status.json | CC6.2 |
| 05-token-usage.json | CC9.1 |
| 06-vendor-inventory.json | CC9.2 |
| 07-migration-history.json | CC8.1 |
| 08-customer-key-status.json | CC6.5, P-series |

## Handling

This snapshot contains customer identifiers and access patterns. Do **not** commit
to git. Upload to your compliance vendor (Drata / Vanta / Secureframe) or to a
private versioned object store the auditor can read.

See \`compliance/README.md\` for the broader evidence-collection process.
`;
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
