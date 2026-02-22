import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

function getStatusInfo(r) {
  const pct = r.metrics?.automationPercentage ?? 0;
  if (pct >= 70) return { dot: 'green', tag: 'optimised', tagText: 'Automation Ready' };
  if (pct >= 40) return { dot: 'amber', tag: 'progress', tagText: 'Improvements Required' };
  return { dot: 'red', tag: 'review', tagText: 'Requires Process Redesign' };
}

function formatCurrency(amount) {
  if (amount >= 1000000) return '£' + (amount / 1000000).toFixed(2) + 'M';
  if (amount >= 1000) return '£' + (amount / 1000).toFixed(0) + 'K';
  return '£' + Math.round(amount).toLocaleString();
}

export default function PortalDashboard({ user, onSignOut }) {
  const [tab, setTab] = useState('overview');
  const [reports, setReports] = useState(null);
  const [loading, setLoading] = useState(true);

  const email = user?.email || '';

  useEffect(() => {
    if (!email) return;
    (async () => {
      setLoading(true);
      try {
        const resp = await fetch('/api/get-dashboard?email=' + encodeURIComponent(email));
        const data = await resp.json();
        if (resp.ok && data.success && Array.isArray(data.reports)) {
          setReports(data);
        } else {
          setReports({ reports: [] });
        }
      } catch (e) {
        setReports({ reports: [] });
      } finally {
        setLoading(false);
      }
    })();
  }, [email]);

  const reportList = reports?.reports || [];
  const totalProcs = reportList.reduce((s, r) => s + (r.metrics?.totalProcesses || 0), 0);
  const avgAuto = reportList.length ? Math.round(reportList.reduce((s, r) => s + (r.metrics?.automationPercentage || 0), 0) / reportList.length) : 0;
  const optimisedCount = reportList.filter(r => (r.metrics?.automationPercentage ?? 0) >= 70).length;
  const progressCount = reportList.filter(r => {
    const p = r.metrics?.automationPercentage ?? 0;
    return p >= 40 && p < 70;
  }).length;
  const reviewCount = reportList.filter(r => (r.metrics?.automationPercentage ?? 0) < 40).length;

  const renderReportRow = (r) => {
    const date = new Date(r.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const procs = (r.processes || []).map(p => p.name).join(', ') || 'Process Diagnostic';
    const editUrl = '/diagnostic?edit=' + r.id + '&email=' + encodeURIComponent(email);
    const s = getStatusInfo(r);
    return (
      <div key={r.id} className="process-row">
        <span className={'process-dot ' + s.dot} />
        <div className="process-name">
          <strong>{procs}</strong>
          <span className="process-val"> — {date}</span>
        </div>
        <span className={'process-tag ' + s.tag}>{s.tagText}</span>
        <div className="process-actions">
          <Link to={'/report?id=' + r.id} className="process-btn process-btn-view">View</Link>
          <a href={editUrl} className="process-btn process-btn-edit">Edit</a>
        </div>
      </div>
    );
  };

  const emptyHtml = (
    <div className="empty-state">
      No diagnostics found yet. <Link to="/diagnostic">Start your first diagnostic</Link>
    </div>
  );

  const statusLegend = (
    <div className="status-legend">
      <span className="status-legend-item"><span className="status-legend-dot green" /><span className="status-legend-label">Automation Ready</span><span className="status-legend-desc">— 70%+ automatable</span></span>
      <span className="status-legend-item"><span className="status-legend-dot amber" /><span className="status-legend-label">Improvements Required</span><span className="status-legend-desc">— 40–69% automatable</span></span>
      <span className="status-legend-item"><span className="status-legend-dot red" /><span className="status-legend-label">Requires Process Redesign</span><span className="status-legend-desc">— below 40%</span></span>
    </div>
  );

  return (
    <>
      <div className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 28px', background: 'linear-gradient(135deg, var(--primary), #243f5c)', color: 'white' }}>
        <div className="header-left" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link to="/" className="header-logo" style={{ color: 'white', textDecoration: 'none', fontFamily: "'Cormorant Garamond', serif", fontSize: '1.3rem', fontWeight: 700 }}>
            Workflow<span style={{ color: 'var(--gold)' }}>.</span>
          </Link>
          <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.15)' }} />
          <span className="header-title" style={{ fontSize: '0.85rem', opacity: 0.7 }}>Client Portal</span>
        </div>
        <div className="header-right" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: '0.76rem', opacity: 0.55, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{email}</span>
          <button onClick={onSignOut} className="header-btn" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)', padding: '6px 16px', borderRadius: 6, cursor: 'pointer' }}>
            Sign Out
          </button>
        </div>
      </div>

      <div className="portal-tabs" style={{ display: 'flex', gap: 4, borderBottom: '1.5px solid var(--border)', marginBottom: 28 }}>
        {['overview', 'reports'].map(t => (
          <button
            key={t}
            className={'portal-tab' + (tab === t ? ' active' : '')}
            onClick={() => setTab(t)}
            style={{ padding: '11px 22px', fontSize: '0.84rem', fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer', textTransform: 'capitalize' }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <div className="metrics-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 26 }}>
            <div className="metric-card" style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '22px 20px', textAlign: 'center' }}>
              <span className="metric-val" style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '2rem', fontWeight: 700, color: 'var(--primary)' }}>{loading ? '—' : totalProcs}</span>
              <span className="metric-lbl" style={{ fontSize: '0.68rem', color: 'var(--text-light)', textTransform: 'uppercase' }}>Process Analyses</span>
            </div>
            <div className="metric-card" style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '22px 20px', textAlign: 'center' }}>
              <span className="metric-val" style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '2rem', fontWeight: 700, color: 'var(--primary)' }}>{loading ? '—' : avgAuto + '%'}</span>
              <span className="metric-lbl" style={{ fontSize: '0.68rem', color: 'var(--text-light)', textTransform: 'uppercase' }}>Automation Readiness</span>
            </div>
            <div className="metric-card" style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '22px 20px', textAlign: 'center' }}>
              <span className="metric-val" style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '2rem', fontWeight: 700, color: 'var(--primary)' }}>{loading ? '—' : reportList.length}</span>
              <span className="metric-lbl" style={{ fontSize: '0.68rem', color: 'var(--text-light)', textTransform: 'uppercase' }}>Reports</span>
            </div>
          </div>

          <div className="quick-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 28 }}>
            <Link to="/diagnostic" className="quick-tile" style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '22px 18px', textAlign: 'center', textDecoration: 'none', color: 'var(--text)' }}>
              <div className="quick-tile-icon ic-diag" style={{ width: 44, height: 44, borderRadius: 12, margin: '0 auto 10px', background: 'linear-gradient(135deg, #eff6ff, #dbeafe)', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📋</div>
              <h3 style={{ fontSize: '0.86rem', fontWeight: 600, marginBottom: 3 }}>New Diagnostic</h3>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-light)' }}>Analyse a new process</p>
            </Link>
          </div>

          <div className="dash-card" style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', marginBottom: 20 }}>
            <div className="dash-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px', borderBottom: '1px solid var(--border)' }}>
              <span className="dash-card-title" style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--primary)' }}>Your Diagnostic Reports</span>
              <Link to="/diagnostic" className="dash-card-action" style={{ fontSize: '0.78rem', color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}>+ New Diagnostic</Link>
            </div>
            <div id="reportList">
              {loading ? (
                <div className="loading-state" style={{ padding: 48, textAlign: 'center' }}>
                  <div className="spinner" />
                  <p>Loading your reports...</p>
                </div>
              ) : reportList.length === 0 ? (
                emptyHtml
              ) : (
                reportList.slice(0, 5).map(renderReportRow)
              )}
            </div>
            {statusLegend}
          </div>
        </>
      )}

      {tab === 'reports' && (
        <div className="dash-card" style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
          <div className="dash-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px', borderBottom: '1px solid var(--border)' }}>
            <span className="dash-card-title" style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--primary)' }}>All Diagnostic Reports</span>
            <Link to="/diagnostic" className="dash-card-action" style={{ fontSize: '0.78rem', color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}>+ New Diagnostic</Link>
          </div>
          <div id="reportListFull">
            {loading ? (
              <div className="loading-state" style={{ padding: 48, textAlign: 'center' }}>
                <div className="spinner" />
                <p>Loading your reports...</p>
              </div>
            ) : reportList.length === 0 ? (
              emptyHtml
            ) : (
              reportList.map(renderReportRow)
            )}
          </div>
          {statusLegend}
        </div>
      )}
    </>
  );
}
