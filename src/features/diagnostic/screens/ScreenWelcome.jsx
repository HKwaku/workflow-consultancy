import { useDiagnostic } from '../DiagnosticContext';

export default function ScreenWelcome() {
  const { goToScreen } = useDiagnostic();

  const handleTeamDiagnostic = () => {
    window.location.href = '/diagnostic.html';
  };

  return (
    <div className="diag-screen-card">
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🎯</div>
        <h1 className="diag-screen-title">Process Diagnostic</h1>
        <p className="diag-screen-subtitle">
          Evidence-based workflow analysis. 12-15 minutes per process.
        </p>
      </div>

      <div className="diag-checklist">
        <h3 style={{ marginBottom: '1rem', color: 'var(--primary)' }}>You'll need:</h3>
        <div className="diag-checklist-item">
          <span className="diag-checklist-icon">✓</span>
          <span>Your calendar from last week</span>
        </div>
        <div className="diag-checklist-item">
          <span className="diag-checklist-icon">✓</span>
          <span>Access to your email</span>
        </div>
        <div className="diag-checklist-item">
          <span className="diag-checklist-icon">✓</span>
          <span>A recent example to reference</span>
        </div>
        <div className="diag-checklist-item">
          <span className="diag-checklist-icon">✓</span>
          <span>Honesty about what's actually happening</span>
        </div>
      </div>

      <p style={{ textAlign: 'center', color: 'var(--text-mid)', marginBottom: '2rem' }}>
        We'll analyse 1-3 of your most critical processes.
        <br />
        The more specific you are, the better we can help.
      </p>

      <div className="diag-button-group" style={{ borderTop: 'none', paddingTop: 0 }}>
        <button
          className="diag-btn diag-btn-primary"
          onClick={() => goToScreen(1)}
        >
          Start Diagnostic →
        </button>
      </div>

      <div style={{ textAlign: 'center', marginTop: '1rem' }}>
        <button
          className="diag-btn diag-btn-secondary"
          onClick={handleTeamDiagnostic}
          style={{ fontSize: '0.88rem', padding: '0.6rem 1.5rem', borderRadius: '100px' }}
        >
          👥 Start a Team Diagnostic
        </button>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-light)', marginTop: '0.5rem' }}>
          Get multiple perspectives on the same process from different team members.
        </p>
      </div>
    </div>
  );
}
