'use client';

/**
 * Streamlined "your trial ran out — get to BYO in 30 seconds" flow.
 *
 * Three steps, sequential, no navigation away:
 *   1. Name your organisation       → POST /api/organizations
 *   2. Paste your Anthropic API key → reuses CustomerKeyPanel UI scoped to the new org
 *   3. ✓ Done                       → "Back to chat" button → /process-audit
 *
 * Mounted on /portal/org-admin?firstRun=1. If the user already has an org,
 * we skip step 1 and land them on the BYO key panel.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import CustomerKeyPanel from './CustomerKeyPanel';

export default function FirstRunOnboarding({ accessToken, onComplete }) {
  const [step, setStep] = useState('check'); // check | name | key | done
  const [orgId, setOrgId] = useState(null);
  const [orgName, setOrgName] = useState('');
  const [draftName, setDraftName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // Find the user's existing org (if any) on first mount so we can skip
  // step 1 if they already created one. Uses /api/organizations (GET)
  // which returns membership for the calling user.
  const detectExistingOrg = useCallback(async () => {
    if (!accessToken) return;
    try {
      const r = await apiFetch('/api/organizations', {}, accessToken);
      const j = r.ok ? await r.json() : null;
      const orgs = j?.organizations || j?.data || [];
      if (orgs.length > 0) {
        setOrgId(orgs[0].id);
        setOrgName(orgs[0].name || '');
        setStep('key');
      } else {
        setStep('name');
      }
    } catch {
      setStep('name');
    }
  }, [accessToken]);

  useEffect(() => { detectExistingOrg(); }, [detectExistingOrg]);

  const submitName = async (e) => {
    e.preventDefault();
    const name = draftName.trim();
    if (!name) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch(
        '/api/organizations',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) },
        accessToken,
      );
      const j = await r.json();
      if (!r.ok) { setErr(j?.error || 'Failed to create organisation.'); return; }
      setOrgId(j.organization?.id);
      setOrgName(j.organization?.name || name);
      setStep('key');
    } finally { setBusy(false); }
  };

  if (step === 'check') {
    return <div className="first-run-card"><div className="first-run-loading">Loading…</div></div>;
  }

  return (
    <div className="first-run-card">
      <ol className="first-run-stepper">
        <li className={`first-run-step${step === 'name' ? ' active' : ''}${step !== 'name' ? ' done' : ''}`}>1. Organisation</li>
        <li className={`first-run-step${step === 'key' ? ' active' : ''}${step === 'done' ? ' done' : ''}`}>2. API key</li>
        <li className={`first-run-step${step === 'done' ? ' active done' : ''}`}>3. Done</li>
      </ol>

      {step === 'name' && (
        <form onSubmit={submitName} className="first-run-body">
          <h2 className="first-run-title">Create your organisation</h2>
          <p className="first-run-blurb">
            Once you've set up an organisation and added your own Anthropic API key, you'll have unlimited use — billed directly by your provider, not us.
          </p>
          <input
            type="text"
            className="first-run-input"
            placeholder="e.g. Acme Capital"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            autoFocus
            required
          />
          {err && <div className="first-run-err">{err}</div>}
          <button type="submit" className="first-run-cta" disabled={busy || !draftName.trim()}>
            {busy ? 'Creating…' : 'Create organisation →'}
          </button>
        </form>
      )}

      {step === 'key' && orgId && (
        <div className="first-run-body">
          <h2 className="first-run-title">Add your Anthropic API key</h2>
          <p className="first-run-blurb">
            <strong>{orgName}</strong> · paste an Anthropic key below. We'll validate it with a 1-token test call before storing.
          </p>
          <CustomerKeyPanel orgId={orgId} accessToken={accessToken} />
          <div className="first-run-actions">
            <button
              type="button"
              className="first-run-cta"
              onClick={() => setStep('done')}
            >Continue →</button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="first-run-body first-run-body--done">
          <div className="first-run-check" aria-hidden>✓</div>
          <h2 className="first-run-title">You're all set</h2>
          <p className="first-run-blurb">
            <strong>{orgName}</strong> is live. From now on, all chat + analysis runs against your own API key. Your trial allowance is no longer relevant.
          </p>
          <a href="/process-audit" className="first-run-cta" onClick={onComplete}>Back to chat →</a>
        </div>
      )}
    </div>
  );
}
