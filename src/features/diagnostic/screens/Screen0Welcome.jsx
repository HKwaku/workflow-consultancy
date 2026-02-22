import React from 'react';
import { useDiagnostic } from '../DiagnosticContext';

export default function Screen0Welcome() {
  const { goToScreen } = useDiagnostic();

  return (
    <>
      <div className="welcome-hero">
        <div className="welcome-icon">&#127919;</div>
        <h1 className="screen-title">Process Diagnostic</h1>
        <p className="screen-subtitle">Evidence-based workflow analysis. 12-15 minutes per process.</p>
      </div>

      <div className="checklist">
        <h3 style={{ marginBottom: '1rem', color: 'var(--primary)' }}>You'll need:</h3>
        <div className="checklist-item"><span className="checklist-icon">&#10003;</span><span>Your calendar from last week</span></div>
        <div className="checklist-item"><span className="checklist-icon">&#10003;</span><span>Access to your email</span></div>
        <div className="checklist-item"><span className="checklist-icon">&#10003;</span><span>A recent example to reference</span></div>
        <div className="checklist-item"><span className="checklist-icon">&#10003;</span><span>Honesty about what's actually happening</span></div>
      </div>

      <p style={{ textAlign: 'center', color: 'var(--text-mid)', marginBottom: '2rem' }}>
        We'll analyse 1-3 of your most critical processes.<br />
        The more specific you are, the better we can help.
      </p>

      <div className="button-group" style={{ borderTop: 'none', paddingTop: 0 }}>
        <button className="button button-primary" onClick={() => goToScreen(1)}>
          Start Diagnostic &rarr;
        </button>
      </div>

      <div style={{ textAlign: 'center', marginTop: '1rem' }}>
        <button
          className="button button-secondary"
          style={{ fontSize: '0.88rem', padding: '0.6rem 1.5rem', borderRadius: '100px' }}
          onClick={() => window.location.href = '/diagnostic.html?'}
        >
          &#128101; Start a Team Diagnostic
        </button>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-light)', marginTop: '0.5rem' }}>
          Get multiple perspectives on the same process from different team members.
        </p>
      </div>
    </>
  );
}
