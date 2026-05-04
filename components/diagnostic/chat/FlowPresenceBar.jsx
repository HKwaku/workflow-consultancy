'use client';

/**
 * Pill row showing other authenticated users currently viewing or
 * editing the same flow scope. Fed by useFlowPresence.
 *
 * Visual: stacked circular avatars (initial of each user's name) with
 * the same accent colour their cursor would use. Hover for full email
 * + last-seen timestamp + currently-editing-step (if set). When a peer
 * is editing the same step the local user is on, the pill gets a
 * subtle outline highlight so the user notices the collision before
 * they save.
 */

import { useMemo } from 'react';

function relativeTime(iso) {
  if (!iso) return 'just now';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 5_000) return 'now';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

export default function FlowPresenceBar({ peers, currentlyEditingStep = null }) {
  const visiblePeers = useMemo(() => peers || [], [peers]);
  if (!visiblePeers.length) return null;

  return (
    <div className="flow-presence-bar" role="status" aria-live="polite" aria-label={`${visiblePeers.length} ${visiblePeers.length === 1 ? 'collaborator' : 'collaborators'} on this flow`}>
      <span className="flow-presence-label">
        {visiblePeers.length === 1
          ? `${visiblePeers[0].name} is also here`
          : `${visiblePeers.length} collaborators here`}
      </span>
      <div className="flow-presence-stack">
        {visiblePeers.slice(0, 5).map((p) => {
          const sameStep = currentlyEditingStep != null
            && p.currentlyEditingStep != null
            && Number(p.currentlyEditingStep) === Number(currentlyEditingStep);
          const initials = (p.name || p.email || '?').slice(0, 1).toUpperCase();
          const editingNote = p.currentlyEditingStep != null ? ` · editing step ${p.currentlyEditingStep}` : '';
          const title = `${p.name || p.email} <${p.email}>${editingNote} · last active ${relativeTime(p.lastSeen)}${sameStep ? ' · ⚠ same step as you' : ''}`;
          return (
            <span
              key={p.key}
              className={`flow-presence-pill${sameStep ? ' flow-presence-pill--collision' : ''}`}
              style={{ background: p.colour, borderColor: p.colour }}
              title={title}
              aria-label={title}
            >
              {initials}
            </span>
          );
        })}
        {visiblePeers.length > 5 && (
          <span
            className="flow-presence-pill flow-presence-pill--more"
            title={visiblePeers.slice(5).map((p) => p.name || p.email).join(', ')}
          >
            +{visiblePeers.length - 5}
          </span>
        )}
      </div>
    </div>
  );
}
