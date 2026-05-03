/**
 * Filesystem-backed catalogue of customer-facing docs.
 *
 * Scans content/docs/ recursively at build time. Each file becomes one
 * route at /docs/<slug-from-path>. Frontmatter is parsed manually (no
 * gray-matter dep) — keep it minimal: title, group, order, summary.
 *
 * Frontmatter shape:
 *   ---
 *   title: How to run a process audit
 *   group: Tutorials
 *   order: 1
 *   summary: Walk through your first diagnostic, end to end.
 *   ---
 *
 * The sidebar nav is derived from the catalogue: items grouped by `group`,
 * sorted by `order` within each group. Groups themselves are ordered by
 * the lowest order across their items.
 */

import fs from 'node:fs';
import path from 'node:path';

const DOCS_DIR = path.join(process.cwd(), 'content', 'docs');

function parseFrontmatter(raw) {
  if (!raw.startsWith('---\n')) return { meta: {}, body: raw };
  const end = raw.indexOf('\n---\n', 4);
  if (end === -1) return { meta: {}, body: raw };
  const yamlBlock = raw.slice(4, end);
  const body = raw.slice(end + 5);
  const meta = {};
  for (const line of yamlBlock.split('\n')) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.+)$/);
    if (!m) continue;
    let val = m[2].trim();
    // Strip optional surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    // Coerce bare numbers
    if (/^\d+$/.test(val)) val = Number(val);
    meta[m[1]] = val;
  }
  return { meta, body };
}

function walkDir(dir, prefix = []) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (e.name.startsWith('_') || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...walkDir(full, [...prefix, e.name]));
      continue;
    }
    if (!e.name.endsWith('.md')) continue;
    const slugParts = [...prefix, e.name.replace(/\.md$/, '')];
    const slug = slugParts.join('/');
    const raw = fs.readFileSync(full, 'utf8');
    const { meta, body } = parseFrontmatter(raw);
    out.push({
      slug,
      slugParts,
      title: meta.title || slugParts[slugParts.length - 1].replace(/-/g, ' '),
      group: meta.group || 'General',
      order: typeof meta.order === 'number' ? meta.order : 999,
      summary: meta.summary || '',
      body,
      filePath: full,
    });
  }
  return out;
}

let _cache = null;

export function getAllDocs() {
  if (_cache && process.env.NODE_ENV === 'production') return _cache;
  _cache = walkDir(DOCS_DIR);
  return _cache;
}

export function getDocBySlug(slug) {
  const all = getAllDocs();
  return all.find((d) => d.slug === slug) || null;
}

/**
 * Sidebar shape: [{ group, items: [{ slug, title, order }] }, ...]
 * Groups ordered by min(order) of their items; items by order then title.
 */
export function getNavigation() {
  const all = getAllDocs();
  const groups = {};
  for (const d of all) {
    (groups[d.group] ||= []).push({ slug: d.slug, title: d.title, order: d.order });
  }
  const groupArr = Object.entries(groups).map(([group, items]) => ({
    group,
    items: items.sort((a, b) => (a.order - b.order) || a.title.localeCompare(b.title)),
    minOrder: Math.min(...items.map((i) => i.order)),
  }));
  groupArr.sort((a, b) => a.minOrder - b.minOrder);
  return groupArr;
}
