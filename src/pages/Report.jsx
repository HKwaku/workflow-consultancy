import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export default function Report() {
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!id) {
      setError('No report ID provided');
      setLoading(false);
      return;
    }
    setLoading(false);
  }, [id]);

  if (loading) {
    return (
      <div className="loading-state" style={{ padding: 48, textAlign: 'center' }}>
        <div className="spinner" />
        <p>Loading report...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <p style={{ color: 'var(--red)' }}>{error}</p>
        <a href="/portal" style={{ color: 'var(--accent)', marginTop: 16, display: 'inline-block' }}>
          ← Back to Portal
        </a>
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <p>Report view (id: {id}) — full migration pending.</p>
      <a href={`/report.html?id=${id}`} style={{ color: 'var(--accent)' }}>
        View legacy report
      </a>
    </div>
  );
}
