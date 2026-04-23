'use client';

import { useDiagnostic } from './DiagnosticContext';

/**
 * Screen 0 - lightweight entry before template selection.
 * (Replaces a removed chat-native intro; keeps progress / resume compatibility.)
 */
export default function IntroChatScreen() {
  const { goToScreen } = useDiagnostic();

  return (
    <div className="screen-card" style={{ maxWidth: 560, margin: '0 auto', padding: '28px 24px' }}>
      <h1 className="screen-title" style={{ marginTop: 0 }}>Process audit</h1>
      <p className="screen-subtitle" style={{ marginBottom: 24, lineHeight: 1.55 }}>
        You&apos;ll map your process, add timings and handoffs, then generate a diagnostic report. Continue when you&apos;re ready.
      </p>
      <button
        type="button"
        onClick={() => goToScreen(1)}
        style={{
          padding: '12px 22px',
          borderRadius: 10,
          border: 'none',
          background: 'var(--accent, #0d9488)',
          color: '#fff',
          fontWeight: 600,
          fontSize: '0.95rem',
          cursor: 'pointer',
        }}
      >
        Continue
      </button>
    </div>
  );
}
