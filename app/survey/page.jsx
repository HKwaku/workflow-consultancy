'use client';

import { useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function SurveyRedirect() {
  const searchParams = useSearchParams();
  const query = searchParams.toString();

  useEffect(() => {
    window.location.replace('/survey.html' + (query ? '?' + query : ''));
  }, [query]);

  return (
    <div className="loading-state" style={{ padding: 60, textAlign: 'center' }}>
      <div className="loading-spinner" />
      <p>Loading survey...</p>
    </div>
  );
}

export default function SurveyPage() {
  return (
    <Suspense fallback={<div className="loading-state" style={{ padding: 60, textAlign: 'center' }}><div className="loading-spinner" /><p>Loading...</p></div>}>
      <SurveyRedirect />
    </Suspense>
  );
}
