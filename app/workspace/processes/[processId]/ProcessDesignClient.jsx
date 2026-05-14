'use client';

/**
 * Workspace process design surface - a single canvas for the process,
 * plus the in-flight changes timeline. Editing happens in chat at
 *   /workspace/map?edit=<processId>
 *
 * Resolve flow on mount:
 *   1. /api/me/operating-model → modelId
 *   2. /api/operating-models/[m]/processes/[r]/detail → load the process
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/useAuth';
import { apiFetch } from '@/lib/api-fetch';
import ProcessDesignSurface from '@/components/workspace/ProcessDesignSurface';
import ChangesTimeline from '@/components/diagnostic/chat/ChangesTimeline';

export default function ProcessDesignClient({ processId }) {
  const { user, accessToken, loading: authLoading } = useAuth();
  const [modelId, setModelId] = useState(null);
  const [report, setReport]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    if (authLoading || !accessToken) return;
    let cancelled = false;
    apiFetch('/api/me/operating-model', {}, accessToken)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`me/operating-model ${r.status}`)))
      .then((data) => { if (!cancelled) setModelId(data?.modelId || null); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [authLoading, accessToken]);

  const loadDetail = useCallback(async () => {
    if (!modelId || !accessToken) return;
    setLoading(true);
    try {
      const r = await apiFetch(
        `/api/operating-models/${modelId}/processes/${encodeURIComponent(processId)}/detail`,
        {}, accessToken,
      );
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || `detail ${r.status}`);
      }
      const j = await r.json();
      setReport(j.report || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [modelId, processId, accessToken]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  if (authLoading || (loading && !report)) {
    return <div className="ws-shell ws-empty">Loading process…</div>;
  }
  if (!user) {
    return (
      <div className="ws-shell ws-empty">
        <h1>Process</h1>
        <p>Sign in to access the workspace.</p>
        <Link href="/signin" className="ws-cta">Sign in</Link>
      </div>
    );
  }
  if (error) {
    return (
      <div className="ws-shell ws-empty">
        <h1>Process</h1>
        <p className="ws-error">{error}</p>
        <Link href="/workspace" className="ws-cta">Back to workspace</Link>
      </div>
    );
  }
  if (!modelId) {
    return (
      <div className="ws-shell ws-empty">
        <h1>Process</h1>
        <p>Your account isn’t associated with an operating model.</p>
        <Link href="/org-admin" className="ws-cta">Open org admin</Link>
      </div>
    );
  }
  if (!report) {
    return (
      <div className="ws-shell ws-empty">
        <h1>Process not found</h1>
        <p>This process isn’t filed in your model. It may belong to another organisation.</p>
        <Link href="/workspace" className="ws-cta">Back to workspace</Link>
      </div>
    );
  }

  return (
    <div className="ws-shell ws-process-shell">
      <header className="ws-header">
        <div className="ws-header-titles">
          <Link href="/workspace" className="ws-back">← Workspace</Link>
          <h1>{report.company || 'Untitled process'}</h1>
        </div>
        <div className="ws-header-meta">
          <a
            className="ws-link"
            href={`/workspace/map?edit=${encodeURIComponent(processId)}`}
            target="_blank" rel="noopener noreferrer"
          >Edit in chat ↗</a>
        </div>
      </header>

      <ProcessDesignSurface
        report={report}
        accessToken={accessToken}
        modelId={modelId}
        canEdit
        onChanged={loadDetail}
      />

      <section className="ws-process-changes">
        <ChangesTimeline
          processId={processId}
          accessToken={accessToken}
          canEdit
          defaultOpen
          title="In-flight changes"
          pollIntervalMs={30_000}
        />
      </section>
    </div>
  );
}
