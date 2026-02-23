'use client';

import { useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function TeamResultsRedirect() {
  const searchParams = useSearchParams();
  const query = searchParams.toString();

  useEffect(() => {
    window.location.replace('/team-results.html' + (query ? '?' + query : ''));
  }, [query]);

  return (
    <div className="loading-state" style={{ padding: 60, textAlign: 'center' }}>
      <div className="loading-spinner" />
      <p>Loading team results...</p>
    </div>
  );
}

export default function TeamResultsPage() {
  return (
    <Suspense fallback={<div className="loading-state" style={{ padding: 60, textAlign: 'center' }}><div className="loading-spinner" /><p>Loading...</p></div>}>
      <TeamResultsRedirect />
    </Suspense>
  );
}
