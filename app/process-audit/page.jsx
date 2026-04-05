'use client';

import dynamic from 'next/dynamic';

const DiagnosticClient = dynamic(() => import('@/components/diagnostic/DiagnosticClient'), {
  ssr: false,
  loading: () => (
    <div className="loading-state loading-fallback" style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <div className="loading-spinner" />
      <p style={{ color: 'var(--text-mid, #64748b)' }}>Loading...</p>
    </div>
  ),
});

export default function DiagnosticPage() {
  return <DiagnosticClient />;
}
