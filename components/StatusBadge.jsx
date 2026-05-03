'use client';

/**
 * Footer status badge — compact pill that links to /status. Polls
 * /api/health every 60s in the background; if it ever fails, the dot
 * goes red. Cheap; doesn't block any render.
 *
 * Drop into the marketing footer (or anywhere else you want a "we're up"
 * affordance).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function StatusBadge() {
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let cancelled = false;
    let timer;
    const tick = async () => {
      try {
        const resp = await fetch('/api/health', { cache: 'no-store' });
        if (cancelled) return;
        setStatus(resp.ok ? 'ok' : 'fail');
      } catch {
        if (!cancelled) setStatus('fail');
      } finally {
        if (!cancelled) timer = setTimeout(tick, 60_000);
      }
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  const tone =
    status === 'ok'   ? { dot: '#4ade80', label: 'All systems operational' } :
    status === 'fail' ? { dot: '#f87171', label: 'Service degraded' } :
                        { dot: '#94a3b8', label: 'Checking status…' };

  return (
    <Link
      href="/status"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '6px 12px',
        borderRadius: 999,
        background: 'var(--surface, rgba(255,255,255,0.04))',
        border: '1px solid var(--border, rgba(255,255,255,0.08))',
        color: 'var(--text-mid, #94a3b8)',
        fontSize: 12,
        textDecoration: 'none',
        fontWeight: 500,
      }}
      title="Open the status page"
    >
      <span
        aria-hidden="true"
        style={{
          width: 8, height: 8, borderRadius: '50%',
          background: tone.dot,
          boxShadow: status === 'fail' ? `0 0 0 3px rgba(248,113,113,0.18)` : undefined,
        }}
      />
      <span>{tone.label}</span>
    </Link>
  );
}
