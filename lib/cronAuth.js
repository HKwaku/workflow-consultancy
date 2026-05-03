/**
 * Auth helper for /api/cron/* endpoints.
 *
 * Vercel Cron sends an `Authorization: Bearer <CRON_SECRET>` header where
 * CRON_SECRET is set as a project env var (Vercel auto-injects on cron
 * invocations). Locally we accept any request when CRON_SECRET is unset, so
 * `curl localhost:3000/api/cron/reap-stuck-documents` works during dev.
 *
 * Pure function with no Next.js dep so it's importable from `node --test`.
 * The handler-wrapping helper that uses NextResponse lives in lib/cronWrapper.js.
 */
export function isAuthorisedCron(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // dev / unset
  const auth = request.headers.get('authorization') || '';
  return auth === `Bearer ${secret}`;
}
