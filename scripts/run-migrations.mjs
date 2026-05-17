#!/usr/bin/env node
/**
 * Migration runner.
 *
 *   DATABASE_URL=postgres://... node scripts/run-migrations.mjs [--dry-run]
 *
 * Replaces "hand-apply the SQL files in order". It:
 *   1. ensures public.schema_migrations exists,
 *   2. takes a session advisory lock (no two runners at once),
 *   3. reads the ORDERED migration list straight from
 *      supabase/MIGRATIONS.md (the existing source of truth — no
 *      separate manifest to drift),
 *   4. applies every file not already in the ledger, each inside its
 *      own transaction, recording it on success.
 *
 * Idempotent: already-applied files are skipped. A file that fails
 * rolls back and stops the run (later files are not applied) so the
 * DB never ends up half-migrated past a broken step.
 *
 * --dry-run prints the pending list and exits without connecting-for-writes.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const ADVISORY_KEY = 873_201_456; // arbitrary, stable

// Parse the MIGRATIONS.md table rows: | N | `file.sql` | `folder/` | ... |
// Returns [{ folder, file }] in document order. The leading
// migration-000-schema-migrations.sql is always applied first.
function readManifest() {
  const md = readFileSync(join(ROOT, 'supabase', 'MIGRATIONS.md'), 'utf8');
  const rows = [];
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^\|\s*\d+\s*\|\s*`([^`]+\.sql)`\s*\|\s*`([^`]+)`\s*\|/);
    if (m) rows.push({ file: m[1], folder: m[2].replace(/\/+$/, '') });
  }
  // Bootstrap ledger file first (it's not a numbered row).
  return [{ folder: 'supabase', file: 'migration-000-schema-migrations.sql' }, ...rows];
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. e.g. DATABASE_URL=postgres://... npm run migrate');
    process.exit(1);
  }

  const manifest = readManifest().filter((m) => existsSync(join(ROOT, m.folder, m.file)));
  const missing = readManifest().filter((m) => !existsSync(join(ROOT, m.folder, m.file)));
  if (missing.length) {
    console.warn(`⚠ ${missing.length} file(s) in MIGRATIONS.md not found on disk (skipped): ` +
      missing.map((m) => `${m.folder}/${m.file}`).join(', '));
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_KEY]);

    const { rows: appliedRows } = await client.query('SELECT filename FROM public.schema_migrations');
    const applied = new Set(appliedRows.map((r) => r.filename));
    const pending = manifest.filter((m) => !applied.has(m.file));

    if (pending.length === 0) {
      console.log(`✓ Up to date — ${applied.size} migration(s) already applied.`);
      return;
    }
    console.log(`${pending.length} pending migration(s):`);
    for (const m of pending) console.log(`  • ${m.folder}/${m.file}`);
    if (DRY) { console.log('\n(--dry-run: nothing applied)'); return; }

    for (const m of pending) {
      const sql = readFileSync(join(ROOT, m.folder, m.file), 'utf8');
      process.stdout.write(`→ applying ${m.file} … `);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO public.schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
          [m.file],
        );
        await client.query('COMMIT');
        console.log('ok');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.log('FAILED');
        console.error(`\n✗ ${m.file} failed — rolled back. Later migrations NOT applied.\n  ${e.message}`);
        process.exitCode = 1;
        return;
      }
    }
    console.log(`\n✓ Applied ${pending.length} migration(s).`);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_KEY]).catch(() => {});
    await client.end().catch(() => {});
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
