'use client';

/**
 * /deal-analysis/[dealId]/[analysisId]
 *
 * Full-page mount of DealAnalysisInline so users can open a redesign /
 * diligence / synergy analysis in its own tab via the "Open in new tab"
 * link in the inline viewer's top bar. The component itself is the same
 * one used inside the deal canvas column — only the shell is different
 * (no canvas-topbar back button; uses the page header bar instead).
 */

import { use } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/components/ThemeProvider';
import ThemeToggle from '@/components/ThemeToggle';

const DealAnalysisInline = dynamic(
  () => import('@/components/diagnostic/chat/DealAnalysisInline'),
  { ssr: false, loading: () => <div className="loading-state" style={{ padding: 60 }}><div className="loading-spinner" /></div> },
);

export default function DealAnalysisPage({ params }) {
  const { dealId, analysisId } = use(params);
  const { accessToken, loading } = useAuth();
  const { theme } = useTheme();

  if (loading) {
    return <div className="loading-state" style={{ padding: 60 }}><div className="loading-spinner" /></div>;
  }
  if (!accessToken) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <p>Sign in to view this analysis.</p>
        <Link href={`/signin?returnTo=${encodeURIComponent(`/deal-analysis/${dealId}/${analysisId}`)}`}>Go to sign in</Link>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <header className="dashboard-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 24px', borderBottom: '1px solid var(--border, #e5e7eb)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Link href="/" className="header-logo">Vesno<span style={{ color: 'var(--gold)' }}>.</span></Link>
          <div className="header-divider" />
          <Link href={`/process-audit?deal=${encodeURIComponent(dealId)}`} className="header-title" style={{ textDecoration: 'none', color: 'inherit' }}>
            ← Back to deal
          </Link>
        </div>
        <ThemeToggle className="header-theme-btn" />
      </header>
      <main style={{ flex: '1 1 auto', minHeight: 0 }}>
        <DealAnalysisInline
          dealId={dealId}
          analysisId={analysisId}
          accessToken={accessToken}
          darkTheme={theme === 'dark'}
        />
      </main>
    </div>
  );
}
