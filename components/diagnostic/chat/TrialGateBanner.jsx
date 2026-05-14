'use client';

/**
 * Trial-budget banner. Three states based on /api/me/budget:
 *
 *   trial, > 50% remaining        → nothing
 *   trial, ≤ 50% remaining        → small inline pill ("18k tokens left")
 *   trial_exhausted               → full-width blocking banner (gates chat)
 *
 * Org users (org_byo or org_platform) see nothing. Anonymous users see
 * nothing — their cap is the per-IP rate limit, not a token budget.
 *
 * The "Create org & add API key" CTA hard-navigates to
 * /org-admin?firstRun=1 which kicks the streamlined onboarding.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';

function fmtTokens(n) {
  if (typeof n !== 'number') return '—';
  if (n < 1000) return `${n}`;
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

export default function TrialGateBanner({ accessToken, onGateOpen, refreshTrigger }) {
  const [mode, setMode] = useState(null);

  const load = useCallback(async () => {
    if (!accessToken) { setMode({ mode: 'anonymous' }); return; }
    try {
      const r = await apiFetch('/api/me/budget', {}, accessToken);
      const j = r.ok ? await r.json() : null;
      if (j) setMode(j);
    } catch { /* swallow — banner is best-effort */ }
  }, [accessToken]);

  useEffect(() => { load(); }, [load, refreshTrigger]);

  if (!mode) return null;
  if (mode.mode === 'anonymous' || mode.mode === 'org_byo' || mode.mode === 'org_platform') {
    return null;
  }

  // Surface the exhausted state to the parent so it can disable the
  // composer / show a hint without re-fetching itself.
  if (mode.mode === 'trial_exhausted') {
    return (
      <div className="trial-gate-banner trial-gate-banner--blocking" role="alert">
        <div className="trial-gate-banner-body">
          <div className="trial-gate-banner-title">Free trial used up</div>
          <div className="trial-gate-banner-msg">
            You've used your {fmtTokens(mode.granted)} platform-token allowance. Create an organisation and paste your Anthropic API key to keep going — your usage will bill directly to your Anthropic account.
          </div>
        </div>
        <a
          href="/org-admin?firstRun=1"
          className="trial-gate-banner-cta"
          onClick={() => onGateOpen?.()}
        >Create org &amp; add key →</a>
      </div>
    );
  }

  // mode === 'trial'. Below 50% used → quiet. Above → soft pill.
  if (typeof mode.percent === 'number' && mode.percent < 50) return null;

  return (
    <div className="trial-gate-banner trial-gate-banner--warn">
      <span className="trial-gate-banner-pill">
        Trial: {fmtTokens(mode.remaining)} of {fmtTokens(mode.granted)} tokens left
      </span>
      <a href="/org-admin?firstRun=1" className="trial-gate-banner-link">
        Add your API key →
      </a>
    </div>
  );
}
