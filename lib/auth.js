/**
 * Server-side auth: verify Supabase JWT and return user email.
 * Use for protected API routes that require a logged-in user.
 */
import { createClient } from '@supabase/supabase-js';

// Module-level singleton for server-side JWT verification only.
// Created with persistSession:false and autoRefreshToken:false so it never
// acquires a Web Lock — avoids the Navigator LockManager timeout error that
// occurs when multiple full clients are created.
let _verifyClient = null;

function getVerifyClient() {
  if (_verifyClient) return _verifyClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  _verifyClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return _verifyClient;
}

export async function verifySupabaseSession(request) {
  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) return null;

  try {
    const supabase = getVerifyClient();
    if (!supabase) return null;
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user?.email) return null;
    return { user, email: user.email.toLowerCase().trim(), userId: user.id };
  } catch {
    return null;
  }
}

/**
 * Require auth: returns 401 response if no valid session.
 * Use: const auth = await requireAuth(request); if (auth.error) return auth.error;
 */
export async function requireAuth(request) {
  const session = await verifySupabaseSession(request);
  if (!session) {
    return { error: { status: 401, body: { error: 'Authentication required. Please sign in.' } } };
  }
  return { email: session.email, userId: session.userId, user: session.user };
}
