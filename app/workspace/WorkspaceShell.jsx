'use client';

/**
 * Client shell for /workspace. Lazy-loads DiagnosticClient (same surface
 * /workspace/map uses) and dispatches `vesno:open-workspace` once after
 * mount so the workspace overlay opens automatically on top of the
 * canvas + chat. Clicking a process inside the overlay then loads it
 * silently on the canvas (see the `vesno:open-process` listener in
 * DiagnosticWorkspace) without unmounting the chat.
 */

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/useAuth';
import { apiFetch } from '@/lib/api-fetch';

const DiagnosticClient = dynamic(() => import('@/components/diagnostic/DiagnosticClient'), {
  ssr: false,
  loading: () => (
    <div
      className="loading-state loading-fallback"
      style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}
    >
      <div className="loading-spinner" />
      <p style={{ color: 'var(--text-mid, #64748b)' }}>Loading workspace…</p>
    </div>
  ),
});

export default function WorkspaceShell() {
  const { accessToken, loading: authLoading } = useAuth();

  // Resolve the user's default operating model so the workspace overlay
  // can open straight to it instead of the model picker. Best-effort —
  // if the lookup fails the overlay falls back to its picker.
  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    const fire = (modelId) => {
      if (cancelled) return;
      try {
        window.dispatchEvent(new CustomEvent('vesno:open-workspace', {
          detail: { scope: 'standard', modelId: modelId || null },
        }));
      } catch { /* noop */ }
    };
    if (!accessToken) {
      // No auth: still open the overlay; it'll show the sign-in surface.
      const t = setTimeout(() => fire(null), 0);
      return () => clearTimeout(t);
    }
    apiFetch('/api/me/operating-model', {}, accessToken)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => fire(j?.modelId || null))
      .catch(() => fire(null));
    return () => { cancelled = true; };
  }, [authLoading, accessToken]);

  return <DiagnosticClient />;
}
