import React from 'react';
import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div className="portal-wrap" style={{ maxWidth: 960, margin: '0 auto', padding: '48px 24px' }}>
      <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '2rem', color: 'var(--primary)', marginBottom: 8 }}>
        Workflow<span style={{ color: 'var(--gold)' }}>.</span>
      </h1>
      <p style={{ color: 'var(--text-mid)', marginBottom: 32, fontSize: '0.95rem' }}>
        Evidence-based process diagnostics and client portal.
      </p>
      <p style={{ marginBottom: 24, fontSize: '0.88rem' }}>
        <a href="/landing.html" style={{ color: 'var(--accent)' }}>View full marketing site</a>
      </p>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Link
          to="/diagnostic"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '14px 24px',
            background: 'linear-gradient(135deg, var(--accent), var(--primary))',
            color: 'white',
            textDecoration: 'none',
            borderRadius: 10,
            fontWeight: 600,
            fontSize: '0.9rem',
          }}
        >
          Process Diagnostic
        </Link>
        <Link
          to="/portal"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '14px 24px',
            background: 'var(--white)',
            color: 'var(--accent)',
            textDecoration: 'none',
            borderRadius: 10,
            fontWeight: 600,
            fontSize: '0.9rem',
            border: '2px solid var(--accent)',
          }}
        >
          Client Portal
        </Link>
      </div>
    </div>
  );
}
