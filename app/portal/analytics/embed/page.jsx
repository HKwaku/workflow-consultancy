'use client';

/**
 * /portal/analytics/embed — stripped-down analytics view designed to be
 * iframed from the chat surface (AnalyticsRailButton). Renders only
 * PortalAnalyticsPanel — no portal shell (header, nav, dashboard chrome).
 *
 * Auth: PortalAuth gates if no session. Same gate the standalone analytics
 * page uses, just without the surrounding chrome.
 *
 * Why a separate route rather than a query-param flag on the existing page:
 * keeps the standalone analytics page's chrome intact for direct visits,
 * and gives the iframe a purpose-built target with no Link-based navigation
 * that could escape the embed.
 */

import { useEffect, useMemo, useState, Suspense } from 'react';
import { getSupabaseClient, getSessionSafe } from '@/lib/supabase';
import { apiFetch } from '@/lib/api-fetch';
import PortalAuth from '../../PortalAuth';
import PortalAnalyticsPanel from '../../PortalAnalyticsPanel';
import '../../portal.css';
import '../../../../public/styles/diagnostic.css';
import '../../../../lib/modules/report/report.css';
import '../../../../lib/modules/cost/cost.css';

function EmbedContent() {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [supabase, setSupabase] = useState(null);
  const [data, setData] = useState({ reports: [], teamSessions: [] });
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeSection, setActiveSection] = useState('overview');

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const sb = getSupabaseClient();
        if (!mounted) return;
        setSupabase(sb);
        const { session: s } = await getSessionSafe(sb);
        if (mounted) { setSession(s); setUser(s?.user ?? null); }
        sb.auth.onAuthStateChange((_event, s2) => {
          if (mounted) { setSession(s2 ?? null); setUser(s2?.user ?? null); }
        });
      } catch (e) {
        console.warn('Supabase init failed:', e.message);
      } finally {
        if (mounted) setAuthLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!user?.email || !session?.access_token) return;
    let cancelled = false;
    setDataLoading(true);
    setError(null);
    apiFetch(`/api/get-dashboard?email=${encodeURIComponent(user.email)}`, {}, session.access_token)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.error) throw new Error(d.error);
        setData({ reports: d?.reports || [], teamSessions: d?.teamSessions || [] });
      })
      .catch((e) => !cancelled && setError(e?.message || 'Failed to load analytics.'))
      .finally(() => !cancelled && setDataLoading(false));
    return () => { cancelled = true; };
  }, [user?.email, session?.access_token]);

  const metrics = useMemo(() => {
    const reports = data.reports || [];
    if (!reports.length) return { totalProcs: 0, avgAuto: 0, autoColor: 'var(--text-mid)', redesignedCount: 0, totalCost: 0 };
    const totalProcs = reports.length;
    const automations = reports.map((r) => r.metrics?.automationPercentage || 0).filter((n) => n > 0);
    const avgAuto = automations.length ? Math.round(automations.reduce((a, b) => a + b, 0) / automations.length) : 0;
    const autoColor = avgAuto >= 60 ? '#0d9488' : avgAuto >= 30 ? '#d97706' : '#dc2626';
    const redesignedCount = reports.filter((r) => r.redesignStatus === 'accepted' || r.acceptedRedesign).length;
    const totalCost = reports.reduce((sum, r) => sum + (r.metrics?.totalAnnualCost || 0), 0);
    return { totalProcs, avgAuto, autoColor, redesignedCount, totalCost };
  }, [data.reports]);

  if (authLoading) {
    return (
      <div className="loading-state" style={{ padding: 60 }}>
        <div className="spinner" /><p>Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="portal-wrap" style={{ maxWidth: 480, margin: '40px auto', padding: '24px' }}>
        <PortalAuth supabase={supabase} onAuthenticated={setUser} />
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 22px' }}>
      {dataLoading && <div className="loading-state" style={{ padding: 24 }}><div className="spinner" /><p>Loading analytics…</p></div>}
      {error && <p style={{ color: '#dc2626', padding: 16 }}>{error}</p>}
      {!dataLoading && !error && (
        <PortalAnalyticsPanel
          reportList={data.reports}
          teamSessions={data.teamSessions}
          loading={false}
          activeSection={activeSection}
          onSectionChange={setActiveSection}
          metrics={metrics}
          onMetricDrill={() => {}}
        />
      )}
    </div>
  );
}

export default function PortalAnalyticsEmbed() {
  return (
    <Suspense fallback={<div className="loading-state" style={{ padding: 60 }}><div className="spinner" /><p>Loading…</p></div>}>
      <EmbedContent />
    </Suspense>
  );
}
