import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Diagnostic flow — during migration we redirect to the legacy HTML.
 * Full React migration will replace this with modular screen components.
 */
export default function Diagnostic() {
  const [searchParams] = useSearchParams();
  const query = searchParams.toString();

  useEffect(() => {
    const url = '/diagnostic.html' + (query ? '?' + query : '');
    window.location.href = url;
  }, [query]);

  return (
    <div className="loading-state" style={{ padding: 60, textAlign: 'center' }}>
      <div className="spinner" />
      <p>Loading diagnostic...</p>
    </div>
  );
}
