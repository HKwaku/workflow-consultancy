#!/usr/bin/env node
/**
 * One-off backfill: adopt orphaned standalone processes into an
 * operating model.
 *
 * Context: an older /api/update-diagnostic create path minted new
 * processes with operating_model_id = NULL. The workspace list / rollup
 * filter by operating_model_id, so those rows are invisible in the
 * model ("I mapped a process but it's not in the operating model").
 * The route is fixed going forward; this heals rows created before the
 * fix. The app's edit-path self-heal also covers any row the user
 * re-saves, so this script is only for bulk / unattended cleanup.
 *
 * Strictly fill-only and scoped:
 *   - only rows with operating_model_id IS NULL  (never moves a process
 *     that already belongs to a model)
 *   - only rows with deal_id IS NULL             (deal flows belong to
 *     the deal, not a standalone model)
 *   - only rows owned by the given email         (contact_email match)
 *
 * Usage:
 *   node scripts/backfill-process-operating-model.js --email you@x.com [--model <uuid>] [--function <uuid>] [--apply]
 *
 *   --email <addr>     (required) owner whose orphaned processes to adopt
 *   --model <uuid>     target operating model. If omitted, resolved from
 *                      the owner's org default model (same rule the app
 *                      uses: organization_members -> organization
 *                      .default_operating_model_id).
 *   --function <uuid>  optional function to also file them under
 *   --apply            perform the writes. WITHOUT this flag the script
 *                      runs in preview mode and changes nothing.
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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const email = (arg('--email') || '').trim().toLowerCase();
let modelId = (arg('--model') || '').trim() || null;
const functionId = (arg('--function') || '').trim() || null;
const APPLY = process.argv.includes('--apply');

if (!email) {
  console.error('Required: --email <owner address>');
  process.exit(1);
}
if (modelId && !UUID_RE.test(modelId)) {
  console.error(`--model is not a valid UUID: ${modelId}`);
  process.exit(1);
}
if (functionId && !UUID_RE.test(functionId)) {
  console.error(`--function is not a valid UUID: ${functionId}`);
  process.exit(1);
}

async function sb(method, p, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${p}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function resolveModelFromOrgDefault(ownerEmail) {
  // Mirror resolveDefaultModelForUser: member -> org -> default model.
  const rows = await sb(
    'GET',
    `/organization_members?email=eq.${encodeURIComponent(ownerEmail)}` +
      `&select=organization:organization_id(id,default_operating_model_id)&limit=1`,
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  return row?.organization?.default_operating_model_id || null;
}

(async () => {
  try {
    if (!modelId) {
      modelId = await resolveModelFromOrgDefault(email);
      if (!modelId) {
        console.error(
          `No --model given and could not resolve an org default model for ${email}. ` +
            `Pass --model <uuid> explicitly.`,
        );
        process.exit(1);
      }
      console.log(`Resolved target model from org default: ${modelId}`);
    }

    // Sanity-check the target model exists.
    const modelRows = await sb('GET', `/operating_models?id=eq.${encodeURIComponent(modelId)}&select=id,name&limit=1`);
    const model = Array.isArray(modelRows) ? modelRows[0] : null;
    if (!model) {
      console.error(`Target operating model ${modelId} not found.`);
      process.exit(1);
    }

    // Find the orphans: owned by email, no model, not a deal flow.
    const orphans = await sb(
      'GET',
      `/processes?contact_email=eq.${encodeURIComponent(email)}` +
        `&operating_model_id=is.null&deal_id=is.null` +
        `&select=id,flow_data,created_at&order=created_at.asc`,
    );
    const list = Array.isArray(orphans) ? orphans : [];

    if (list.length === 0) {
      console.log(`No orphaned standalone processes for ${email}. Nothing to do.`);
      return;
    }

    console.log(`\nFound ${list.length} orphaned process(es) for ${email}:`);
    for (const p of list) {
      let name = '(unnamed)';
      try {
        const fd = p.flow_data || {};
        name = fd.rawProcesses?.[0]?.processName || fd.rawProcesses?.[0]?.name || fd.processName || '(unnamed)';
      } catch {}
      console.log(`  - ${p.id}  "${name}"  created ${p.created_at}`);
    }
    console.log(
      `\nWould set operating_model_id = ${modelId} ("${model.name || 'model'}")` +
        (functionId ? ` and function_id = ${functionId}` : '') +
        ` on the ${list.length} row(s) above.`,
    );

    if (!APPLY) {
      console.log('\nPREVIEW only. Re-run with --apply to write these changes.');
      return;
    }

    const patch = { operating_model_id: modelId };
    if (functionId) patch.function_id = functionId;

    let ok = 0;
    for (const p of list) {
      try {
        await sb('PATCH', `/processes?id=eq.${encodeURIComponent(p.id)}`, patch);
        ok += 1;
      } catch (e) {
        console.error(`  FAILED ${p.id}: ${e.message}`);
      }
    }
    console.log(`\nDone. Adopted ${ok}/${list.length} process(es) into model ${modelId}.`);
  } catch (e) {
    console.error('Backfill failed:', e.message);
    process.exit(1);
  }
})();
