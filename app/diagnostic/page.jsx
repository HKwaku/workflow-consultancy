'use client';

import { useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function DiagnosticRedirect() {
  const searchParams = useSearchParams();
  const query = searchParams.toString();

  useEffect(() => {
    const url = '/diagnostic.html' + (query ? '?' + query : '');
    window.location.replace(url);
  }, [query]);

  return (
    <div className="loading-state" style={{ padding: 60, textAlign: 'center' }}>
      <div className="loading-spinner" />
      <p>Loading diagnostic...</p>
    </div>
  );
}

export default function DiagnosticPage() {
  return (
    <Suspense fallback={<div className="loading-state" style={{ padding: 60, textAlign: 'center' }}><div className="loading-spinner" /><p>Loading...</p></div>}>
      <DiagnosticRedirect />
    </Suspense>
  );
}
