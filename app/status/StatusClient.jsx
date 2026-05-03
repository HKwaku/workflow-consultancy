'use client';

/**
 * Renders the /status page in two modes — vendor link-out OR self-reported.
 *
 * Self-reported mode shows a per-component table + a "last checked" timestamp.
 * Vendor mode shows the vendor URL prominently + a small note that the
 * vendor is the source of truth.
 */

import './status.css';

const COMPONENT_LABELS = {
  database:  'Database (Supabase)',
  anthropic: 'AI provider (Anthropic)',
  sentry:    'Error monitoring (Sentry)',
  inngest:   'Async workers (Inngest)',
  voyage:    'Embeddings (Voyage)',
};

const STATUS_PILL = {
  ok:               { label: 'Operational',   tone: 'ok' },
  fail:             { label: 'Degraded',      tone: 'fail' },
  'not-configured': { label: 'Not configured', tone: 'idle' },
};

function StatusBadge({ status }) {
  const meta = STATUS_PILL[status] || { label: status, tone: 'idle' };
  return <span className={`status-pill status-pill--${meta.tone}`}>{meta.label}</span>;
}

export default function StatusClient({ vendorUrl, selfReport }) {
  if (vendorUrl) {
    return (
      <main className="status-page">
        <header className="status-hero">
          <h1>System status</h1>
          <p>Live status, recent incidents and historical uptime are published by our status partner.</p>
        </header>
        <div className="status-vendor-card">
          <a href={vendorUrl} target="_blank" rel="noopener noreferrer" className="status-vendor-link">
            View live status →
          </a>
          <p className="status-vendor-note">
            The status page is the authoritative source of incident communications.
            Subscribe there for email or webhook notifications.
          </p>
        </div>
      </main>
    );
  }

  // Self-reported fallback
  const overallOk = selfReport?.ok === true;
  const checks = selfReport?.payload?.checks || {};
  const dbLatency = selfReport?.payload?.latencyMs?.database;
  const version = selfReport?.payload?.version;

  return (
    <main className="status-page">
      <header className="status-hero">
        <h1>System status</h1>
        <p className="status-hero-meta">
          Self-reported · last checked {selfReport?.fetchedAt ? new Date(selfReport.fetchedAt).toLocaleString() : 'never'}
        </p>
      </header>

      <div className={`status-overall status-overall--${overallOk ? 'ok' : 'fail'}`}>
        <div className="status-overall-dot" aria-hidden="true" />
        <div className="status-overall-text">
          <strong>{overallOk ? 'All critical systems operational' : 'Service degraded'}</strong>
          <span>
            {overallOk
              ? 'No active incidents.'
              : 'A core component is failing health checks. Engineering has been notified.'}
          </span>
        </div>
      </div>

      <section className="status-table-card">
        <h2 className="status-table-title">Components</h2>
        <table className="status-table">
          <thead>
            <tr>
              <th>Component</th>
              <th>Status</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(COMPONENT_LABELS).map(([key, label]) => (
              <tr key={key}>
                <td>{label}</td>
                <td><StatusBadge status={checks[key] || 'not-configured'} /></td>
                <td>
                  {key === 'database' && dbLatency != null && <span>{dbLatency} ms round-trip</span>}
                  {key !== 'database' && checks[key] === 'not-configured' && <span>Optional — degrades gracefully</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer className="status-foot">
        <p>
          {version && <span>Build {version} · </span>}
          For incidents and questions, email <a href="mailto:support@vesno.io">support@vesno.io</a>.
        </p>
        <p className="status-foot-note">
          Self-reported status is a single point-in-time check. For continuous monitoring with email/SMS/webhook notifications,
          we recommend signing up for a third-party status page (see internal RUNBOOK).
        </p>
      </footer>
    </main>
  );
}
