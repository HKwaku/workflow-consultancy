'use client';

/**
 * Splash shown when an anonymous visitor lands on the diagnostic surface.
 * Diagnostics now require a Vesno account so we can meter the trial
 * credit allowance against a known user. Two CTAs — "Sign in" / "Create
 * account" — both deep-link into /portal with `?returnTo=/workspace/map`
 * so the user lands right back on the chat after signing in.
 *
 * Participant-invite flows (deal magic links) bypass this gate entirely;
 * see DiagnosticClient.jsx where `isParticipantInvite` is checked.
 */

import Link from 'next/link';

export default function SignInRequired({ returnTo = '/workspace/map' }) {
  const ret = encodeURIComponent(returnTo);
  return (
    <div className="audit-gate-screen">
      <div className="audit-gate-inner">
        <header className="audit-gate-hero">
          <div className="audit-gate-brand">
            Vesno<span>.</span>
          </div>
          <h1 className="audit-gate-title" style={{ color: '#fff' }}>Sign in to start</h1>
        </header>

        <div className="audit-gate-cta-row">
          <Link
            href={`/signin?mode=signup&returnTo=${ret}`}
            className="audit-gate-cta audit-gate-cta--primary"
          >
            Create account
          </Link>
          <Link
            href={`/signin?mode=login&returnTo=${ret}`}
            className="audit-gate-cta audit-gate-cta--ghost"
          >
            Sign in
          </Link>
        </div>

        <p className="audit-gate-fineprint">
          By creating an account you agree to our terms. We never share your data.
        </p>
      </div>
    </div>
  );
}
