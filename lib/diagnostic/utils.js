/**
 * Diagnostic utilities - esc, fixMojibake, form helpers, formatting
 */

export function esc(s) {
  return fixMojibake(String(s || ''))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function fixMojibake(s) {
  if (!s || typeof s !== 'string') return s || '';
  return s
    .replace(/\u00C2\u00A3/g, '\u00A3')      // Â£ → £
    .replace(/\u00C2\u00B0/g, '\u00B0')      // Â° → °
    .replace(/\u00E2\u0080\u0094/g, '-')     // â€" → hyphen
    .replace(/\u00E2\u0080\u0093/g, '-')     // â€" → hyphen
    .replace(/\u00E2\u0080\u0098/g, '\u2018') // â€˜ → '
    .replace(/\u00E2\u0080\u0099/g, '\u2019') // â€™ → '
    .replace(/\u00E2\u0080\u009C/g, '\u201C') // â€œ → "
    .replace(/\u00E2\u0080\u009D/g, '\u201D') // â€ → "
    .replace(/\u00E2\u0080\u00A6/g, '\u2026') // â€¦ → …
    .replace(/\u00C2\u00B7/g, '\u00B7')      // Â· → ·
    .replace(/â€"/g, '-')
    .replace(/â€"/g, '-')
    .replace(/Â£/g, '\u00A3')
    .replace(/Â°/g, '\u00B0')
    .replace(/Â·/g, '\u00B7');
}

export function fixMojibakeInObj(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return fixMojibake(obj);
  if (Array.isArray(obj)) return obj.map(fixMojibakeInObj);
  if (typeof obj === 'object') {
    const out = {};
    for (const k in obj) out[k] = fixMojibakeInObj(obj[k]);
    return out;
  }
  return obj;
}

/** Get checked radio value by name (DOM-based, for legacy HTML) */
export function getRadioValue(name, doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return '';
  const el = doc.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : '';
}

/** Get all checked checkbox values by name */
export function getCheckedValues(name, doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return [];
  return Array.from(doc.querySelectorAll(`input[name="${name}"]:checked`)).map((cb) => cb.value);
}

export function formatCurrency(amount, symbol = '\u00A3') {
  if (amount >= 1000000) return symbol + (amount / 1000000).toFixed(2) + 'M';
  if (amount >= 1000) return symbol + (amount / 1000).toFixed(0) + 'K';
  return symbol + Math.round(amount || 0).toLocaleString();
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
