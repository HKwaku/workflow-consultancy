/**
 * Basic sanitization for user content to reduce XSS risk.
 */
const ENTITY_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(str) {
  if (str == null || typeof str !== 'string') return '';
  return str.replace(/[&<>"']/g, (c) => ENTITY_MAP[c] || c);
}

export function sanitizeForDisplay(obj) {
  if (typeof obj === 'string') return escapeHtml(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeForDisplay);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = sanitizeForDisplay(v);
    return out;
  }
  return obj;
}
