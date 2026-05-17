'use client';

/**
 * ShareProcessLink: "share this process map with a colleague".
 *
 * Replaces the old emailed resume link (which relied on /api/progress,
 * now 410). No new mechanism is needed: the read-only process view at
 * /process-mapping?view=<id> is public by design. The process UUID is
 * an unguessable bearer (see app/api/get-diagnostic GET, the read-only
 * branch serves any process without auth). So sharing is just exposing
 * a copyable link to that view. No token, no migration, no extra
 * surface: the recipient opens the same map read-only, no account.
 *
 * Two variants:
 *   - "bar"  → the canvas back-bar (share what you're looking at)
 *   - "row"  → a process list row (share straight from the workspace)
 *
 * The link always targets the canonical /process-mapping route.
 */

import { useState, useCallback } from 'react';

export default function ShareProcessLink({ processId, variant = 'bar' }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    if (!processId || typeof window === 'undefined') return;
    const url = `${window.location.origin}/process-mapping?view=${encodeURIComponent(processId)}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard blocked (insecure context / permissions): fall back
      // to a prompt so the user can still grab the link manually.
      try { window.prompt('Copy this share link:', url); } catch { /* give up */ }
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2600);
  }, [processId]);

  if (!processId) return null;

  const title =
    'Copy a link to this process map. Anyone with the link can view it read-only (no account needed). They cannot edit it.';

  if (variant === 'row') {
    return (
      <button
        type="button"
        className="ws-proc-file ws-proc-share"
        onClick={copy}
        title={title}
        aria-label={copied ? 'Share link copied' : 'Copy share link for this process'}
      >
        {copied ? 'Link copied' : 'Share'}
      </button>
    );
  }

  return (
    <span className="s7-share-link-wrap">
      <button
        type="button"
        className="s7-canvas-back-link s7-share-link-btn"
        onClick={copy}
        title={title}
        aria-label={copied ? 'Share link copied' : 'Copy share link for this process'}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
          <line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
        </svg>
        {copied ? 'Link copied (read-only, no account needed)' : 'Share'}
      </button>
    </span>
  );
}
