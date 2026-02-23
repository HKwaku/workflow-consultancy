const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_FETCH_TIMEOUT_MS = 30000;

export function isValidUUID(str) {
  return UUID_REGEX.test(str);
}

export function isValidReportId(str) {
  return typeof str === 'string' && str.trim().length > 0 && str.length <= 64;
}

export function isValidEmail(str) {
  return EMAIL_REGEX.test(str);
}

export function fetchWithTimeout(url, options, timeoutMs) {
  const ms = timeoutMs || DEFAULT_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

export function getSupabaseHeaders(serviceKey) {
  return {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Accept': 'application/json'
  };
}

export function getSupabaseWriteHeaders(serviceKey) {
  return {
    'Content-Type': 'application/json',
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Prefer': 'return=minimal'
  };
}

export function requireSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

export function stripEmDashes(obj) {
  if (typeof obj === 'string') return obj.replace(/\u2014/g, '-').replace(/&mdash;/g, '-');
  if (Array.isArray(obj)) return obj.map(stripEmDashes);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = stripEmDashes(v);
    return out;
  }
  return obj;
}

export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS,PATCH,DELETE,POST,PUT',
    'Access-Control-Allow-Headers': 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  };
}
