'use client';

import { useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

const LoadingUI = ({ label = 'Loading…' }) => (
  <div
    style={{
      minHeight: '60vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
      padding: '60px 24px',
      textAlign: 'center',
    }}
  >
    <div className="loading-spinner" />
    <p style={{ color: 'var(--text-mid, #64748b)', fontSize: '0.95rem' }}>{label}</p>
  </div>
);

function SurveyRedirect() {
  const searchParams = useSearchParams();
  const query = searchParams.toString();

  useEffect(() => {
    window.location.replace('/survey.html' + (query ? '?' + query : ''));
  }, [query]);

  return <LoadingUI label="Loading survey…" />;
}

export default function SurveyPage() {
  return (
    <Suspense fallback={<LoadingUI label="Loading…" />}>
      <SurveyRedirect />
    </Suspense>
  );
}
