'use client';

/**
 * Real-time presence on a single flow scope. Uses Supabase Realtime's
 * Presence API (no schema changes — state lives in the broadcast
 * channel, not in Postgres). Each authenticated user joins a channel
 * keyed on (dealId, participantId) when they're viewing/editing that
 * flow; other users on the same channel see them appear in the
 * presence bar with a soft-presence "currently editing step N" cue.
 *
 * Soft, not hard: there's no lock. Two users can edit the same step;
 * the bar just makes the collision visible so they don't surprise
 * each other.
 *
 * Channel naming:
 *   flow-presence:deal:<dealId>:<participantId>   — deal-scoped, per participant
 *   flow-presence:deal:<dealId>:_                 — deal-scoped, no specific participant
 *   flow-presence:report:<reportId>               — non-deal flow tied to a report
 *   (no channel)                                  — anonymous / no scope; hook is a no-op
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase';

const HEARTBEAT_MS = 15_000;

function buildChannelName({ dealId, participantId, reportId }) {
  if (dealId) return `flow-presence:deal:${dealId}:${participantId || '_'}`;
  if (reportId) return `flow-presence:report:${reportId}`;
  return null;
}

// Stable per-tab colour from the user's email so the same user gets
// the same avatar tint across reloads. Hashes to one of 6 accent
// colours; keeps avatar bars visually distinct.
const PRESENCE_COLOURS = [
  '#0d9488', // teal
  '#2563eb', // blue
  '#7c3aed', // violet
  '#d97706', // amber
  '#dc2626', // red
  '#059669', // emerald
];
function colourFor(email) {
  if (!email) return PRESENCE_COLOURS[0];
  let h = 0;
  for (let i = 0; i < email.length; i++) {
    h = (h * 31 + email.charCodeAt(i)) >>> 0;
  }
  return PRESENCE_COLOURS[h % PRESENCE_COLOURS.length];
}

export function useFlowPresence({ user, dealId, participantId, reportId, currentlyEditingStep = null, enabled = true }) {
  const [peers, setPeers] = useState([]); // [{ key, email, name, colour, currentlyEditingStep, lastSeen }]
  const channelRef = useRef(null);
  const trackTimerRef = useRef(null);

  const channelName = buildChannelName({ dealId, participantId, reportId });
  const userEmail = (user?.email || '').toLowerCase().trim();

  // Build the local presence payload from current state. Memoised by
  // the editor's email + edited step so we don't re-track on every
  // render.
  const buildLocalState = useCallback(() => ({
    email: userEmail,
    name: user?.name || user?.email?.split('@')[0] || 'Anonymous',
    colour: colourFor(userEmail),
    currentlyEditingStep: currentlyEditingStep != null ? Number(currentlyEditingStep) : null,
    lastSeen: new Date().toISOString(),
  }), [userEmail, user?.name, currentlyEditingStep]);

  useEffect(() => {
    if (!enabled || !channelName || !userEmail) {
      setPeers([]);
      return undefined;
    }
    const supabase = getSupabaseClient();
    if (!supabase) return undefined;

    const channel = supabase.channel(channelName, {
      config: {
        presence: { key: userEmail },
        broadcast: { self: false },
      },
    });
    channelRef.current = channel;

    const flushPeers = () => {
      try {
        const state = channel.presenceState();
        // presence state shape: { [key]: [{ ...metadata }, ...] } — last
        // entry per key is the most recent track. Collapse to one entry
        // per email key; exclude the local user.
        const list = [];
        for (const [key, entries] of Object.entries(state)) {
          if (key === userEmail) continue;
          const latest = Array.isArray(entries) ? entries[entries.length - 1] : null;
          if (!latest) continue;
          list.push({
            key,
            email: latest.email || key,
            name: latest.name || (latest.email || key).split('@')[0],
            colour: latest.colour || colourFor(latest.email || key),
            currentlyEditingStep: latest.currentlyEditingStep ?? null,
            lastSeen: latest.lastSeen || null,
          });
        }
        setPeers(list);
      } catch {
        // Realtime may not be configured / network may have dropped; clear peers.
        setPeers([]);
      }
    };

    channel
      .on('presence', { event: 'sync' }, flushPeers)
      .on('presence', { event: 'join' }, flushPeers)
      .on('presence', { event: 'leave' }, flushPeers)
      .subscribe(async (status) => {
        if (status !== 'SUBSCRIBED') return;
        await channel.track(buildLocalState());
        // Heartbeat re-track so peers see freshness; also keeps the
        // channel alive on idle browsers that throttle WebSocket
        // traffic. Cleared on unmount or scope change.
        trackTimerRef.current = setInterval(() => {
          try { channel.track(buildLocalState()); } catch {}
        }, HEARTBEAT_MS);
      });

    return () => {
      if (trackTimerRef.current) clearInterval(trackTimerRef.current);
      trackTimerRef.current = null;
      try { channel.untrack(); } catch {}
      try { supabase.removeChannel(channel); } catch {}
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, channelName, userEmail]);

  // Re-track on edited-step changes so the indicator updates without
  // dropping the channel.
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel) return;
    try { channel.track(buildLocalState()); } catch {}
  }, [buildLocalState]);

  return { peers, channelName, selfColour: colourFor(userEmail) };
}
