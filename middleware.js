import { NextResponse } from 'next/server';

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB

function generateRequestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function middleware(request) {
  if (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH') {
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Request body too large.' }, { status: 413 });
    }
  }
  const requestId = request.headers.get('x-request-id') || generateRequestId();
  const res = NextResponse.next();
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('X-Request-ID', requestId);
  return res;
}

export const config = {
  matcher: '/api/:path*',
};
