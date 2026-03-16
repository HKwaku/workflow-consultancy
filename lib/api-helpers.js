import crypto from 'crypto';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_FETCH_TIMEOUT_MS = 30000;

/** Get or generate request ID for log correlation. */
export function getRequestId(request) {
  return request?.headers?.get?.('x-request-id') || crypto.randomUUID();
}

export function isValidUUID(str) {
  return UUID_REGEX.test(str);
}

export function isValidReportId(str) {
  return typeof str === 'string' && str.trim().length > 0 && str.length <= 64;
}

/** Generate human-friendly display code (e.g. SH-7K2M9) for reports. */
const DISPLAY_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generateDisplayCode() {
  let code = 'SH-';
  for (let i = 0; i < 5; i++) {
    code += DISPLAY_CODE_CHARS[Math.floor(Math.random() * DISPLAY_CODE_CHARS.length)];
  }
  return code;
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

/**
 * Lightweight CSRF mitigation: when Origin/Referer is present, it must match allowed origins.
 * Returns null if OK, or error object if rejected.
 */
export function checkOrigin(request) {
  const origin = request.headers.get('origin') || request.headers.get('referer');
  if (!origin) return null; // No origin (e.g. same-origin, curl) - allow
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return null; // No config - allow
  const allowed = appUrl.replace(/\/$/, '');
  try {
    const u = new URL(origin);
    const o = u.origin;
    if (o === allowed) return null;
    if (process.env.NODE_ENV !== 'production' && (o.startsWith('http://localhost:') || o.startsWith('http://127.0.0.1:'))) return null;
  } catch { /* invalid URL */ }
  return { error: 'Invalid origin.', status: 403 };
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
