'use client';

/**
 * Top-right credits widget. Shows the remaining trial allowance as
 * "credits" (1 credit = 1,000 tokens — the standard most AI products use).
 *
 *   trial users      → "42 / 50 credits" pill, colours by remaining %
 *   trial exhausted  → red "0 credits — Add API key" pill, links to onboarding
 *   org_byo          → quiet (no display — they have unlimited)
 *   org_platform     → "Org plan" pill linking to org admin
 *   anonymous        → not rendered (the chat will never reach them anyway
 *                      since diagnostics now require sign-in)
 *
 * The widget pings /api/me/budget on mount + whenever `refreshKey` changes
 * (parent bumps it after each chat turn so the count drops in near-real-time).
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';

export default function CreditsWidget({ accessToken, refreshKey = 0 }) {
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    // While auth is still resolving accessToken can be null. Stay null
    // (render nothing) and wait for the next render — DO NOT set
    // {mode:'anonymous'} here, otherwise a later silent fetch failure
    // leaves the widget stuck in anonymous mode for an authenticated user.
    if (!accessToken) { setData(null); return; }
    try {
      const r = await apiFetch('/api/me/budget', {}, accessToken);
      if (!r.ok) {
        // Server reachable but rejected (5xx, auth race, etc). Surface a
        // visible fallback pill instead of silently disappearing — the
        // user explicitly expects to see *something* up here.
        setData({ mode: 'unknown' });
        return;
      }
      const j = await r.json();
      setData(j && typeof j === 'object' ? j : { mode: 'unknown' });
    } catch {
      setData({ mode: 'unknown' });
    }
  }, [accessToken]);

  useEffect(() => { load(); }, [load, refreshKey]);

  if (!data || data.mode === 'anonymous') return null;

  if (data.mode === 'unknown') {
    return (
      <a
        className="credits-widget credits-widget--org"
        href="/org-admin"
        title="Couldn't load your credit balance — open your account to check usage."
      >
        <span className="credits-widget-dot" aria-hidden />
        <span className="credits-widget-label">Credits unavailable</span>
      </a>
    );
  }

  if (data.mode === 'org_byo') {
    return (
      <a
        className="credits-widget credits-widget--org"
        href="/org-admin"
        title="Your organisation has its own provider key — usage bills directly to your account."
      >
        <span className="credits-widget-dot" aria-hidden />
        <span className="credits-widget-label">Unlimited · BYO key</span>
      </a>
    );
  }

  if (data.mode === 'org_platform') {
    return (
      <a className="credits-widget credits-widget--org" href="/org-admin" title="Org plan — manage usage">
        <span className="credits-widget-dot" aria-hidden />
        <span className="credits-widget-label">Org plan</span>
      </a>
    );
  }

  const credits = data.credits || { granted: 0, remaining: 0, consumed: 0 };
  const exhausted = data.mode === 'trial_exhausted' || credits.remaining <= 0;
  const pct = credits.granted > 0
    ? Math.max(0, Math.min(100, Math.round((credits.remaining / credits.granted) * 100)))
    : 0;
  const tone = exhausted ? 'danger'
              : pct <= 20 ? 'danger'
              : pct <= 50 ? 'warn'
              : 'ok';

  if (exhausted) {
    return (
      <a
        className="credits-widget credits-widget--danger"
        href="/org-admin?firstRun=1"
        title="You've used your free credits — add your own API key to continue."
      >
        <span className="credits-widget-icon" aria-hidden>⚡</span>
        <span className="credits-widget-count">0</span>
        <span className="credits-widget-label">credits — Add API key →</span>
      </a>
    );
  }

  return (
    <a
      className={`credits-widget credits-widget--${tone}`}
      href="/org-admin?firstRun=1"
      title={`${credits.remaining} of ${credits.granted} credits remaining (1 credit ≈ ${data.credits?.tokensPerCredit || 1000} tokens). Add your own API key for unlimited use.`}
    >
      <span className="credits-widget-icon" aria-hidden>⚡</span>
      <span className="credits-widget-count">{credits.remaining}</span>
      <span className="credits-widget-sep">/</span>
      <span className="credits-widget-total">{credits.granted}</span>
      <span className="credits-widget-label">credits</span>
    </a>
  );
}
