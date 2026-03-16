'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

const DiagnosticClient = dynamic(() => import('@/components/diagnostic/DiagnosticClient'), {
  ssr: false,
  loading: () => (
    <div className="loading-state loading-fallback" style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <div className="loading-spinner" />
      <p style={{ color: 'var(--text-mid, #64748b)' }}>Loading diagnostic...</p>
    </div>
  ),
});

export default function DiagnosticPage() {
  const [isMobile, setIsMobile] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setIsMobile(window.innerWidth < 768);
    setChecked(true);
  }, []);

  if (!checked) return null;

  if (isMobile) {
    return (
      <div style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 24px',
        textAlign: 'center',
        gap: 20,
        background: 'var(--bg, #111)',
        color: 'var(--text, #e8e8e8)',
      }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#94a3b8', flexShrink: 0 }}>
          <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
        </svg>
        <div style={{ maxWidth: 320 }}>
          <p style={{ fontSize: 18, fontWeight: 700, margin: '0 0 10px', color: 'var(--text, #e8e8e8)' }}>
            Desktop required
          </p>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: '#94a3b8', margin: 0 }}>
            The workflow diagnostic is designed for desktop or laptop use. Please open this page on a larger screen to continue.
          </p>
        </div>
      </div>
    );
  }

  return <DiagnosticClient />;
}
