/**
 * Server-side auth: verify Supabase JWT and return user email.
 * Use for protected API routes that require a logged-in user.
 */
import { createClient } from '@supabase/supabase-js';

export async function verifySupabaseSession(request) {
  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  try {
    const supabase = createClient(url, anonKey);
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
