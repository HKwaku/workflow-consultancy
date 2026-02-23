'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

function getStatusInfo(r) {
  const pct = r.metrics?.automationPercentage ?? 0;
  if (pct >= 70) return { dot: 'green', tag: 'optimised', tagText: 'Automation Ready' };
  if (pct >= 40) return { dot: 'amber', tag: 'progress', tagText: 'Improvements Required' };
  return { dot: 'red', tag: 'review', tagText: 'Requires Process Redesign' };
}

export default function PortalDashboard({ user, onSignOut, onEditReport }) {
  const [tab, setTab] = useState('overview');
  const [reports, setReports] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [redesigningId, setRedesigningId] = useState(null);

  const email = user?.email || '';

  const refreshReports = useCallback(async () => {
    if (!email) return;
    setLoading(true);
    try {
      const resp = await fetch('/api/get-dashboard?email=' + encodeURIComponent(email));
      const data = await resp.json();
      if (resp.ok && data.success && Array.isArray(data.reports)) {
        setReports(data);
      } else {
        setReports({ reports: [] });
      }
    } catch {
      setReports({ reports: [] });
    } finally {
      setLoading(false);
    }
  }, [email]);

  useEffect(() => {
    if (!email) return;
    refreshReports();
  }, [email, refreshReports]);

  const reportList = reports?.reports || [];
  const totalProcs = reportList.reduce((s, r) => s + (r.metrics?.totalProcesses || 0), 0);
  const avgAuto = reportList.length ? Math.round(reportList.reduce((s, r) => s + (r.metrics?.automationPercentage || 0), 0) / reportList.length) : 0;

  const handleDeleteClick = (reportId) => {
    setConfirmDeleteId(confirmDeleteId === reportId ? null : reportId);
  };

  const handleRedesign = async (reportId) => {
    setRedesigningId(reportId);
    try {
      const resp = await fetch('/api/generate-redesign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, reportId })
      });
      const data = await resp.json();
      if (resp.ok && data.success && data.redesign?.optimisedProcesses) {
        const procs = data.redesign.optimisedProcesses.map((p) => ({
          processName: p.processName || p.name || 'Redesigned Process',
          steps: (p.steps || []).map((s, i) => ({
            number: i + 1,
            name: s.name || s.stepName || `Step ${i + 1}`,
            department: s.department || 'Operations',
            isDecision: s.isDecision || false,
            isExternal: s.isExternal || false,
            branches: s.branches || [],
            removed: s.removed
          }))
        }));
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem('redesignProcesses', JSON.stringify(procs));
        }
        window.location.href = '/diagnostic?render-redesign';
      } else {
        alert(data.error || 'Failed to generate redesign.');
      }
    } catch {
      alert('Failed to generate redesign. Please try again.');
    } finally {
      setRedesigningId(null);
    }
  };

  const handleDeleteConfirm = async (reportId) => {
    setDeletingId(reportId);
    try {
      const resp = await fetch('/api/get-dashboard', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, email })
      });
      const data = await resp.json();
      if (resp.ok && data.success) {
        setConfirmDeleteId(null);
        await refreshReports();
      } else {
        alert(data.error || 'Failed to delete report.');
      }
    } catch {
      alert('Failed to delete report. Please try again.');
    } finally {
      setDeletingId(null);
    }
  };

  const renderReportRow = (r) => {
    const date = new Date(r.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const procs = (r.processes || []).map(p => p.name).join(', ') || 'Process Diagnostic';
    const handleEdit = () => onEditReport?.(r.id);
    const s = getStatusInfo(r);
    const showConfirm = confirmDeleteId === r.id;
    const isDeleting = deletingId === r.id;
    return (
      <div key={r.id} className="process-row">
        <span className={'process-dot ' + s.dot} />
        <div className="process-name">
          <strong>{procs}</strong>
          <span className="process-val"> | {date}</span>
        </div>
        <span className={'process-tag ' + s.tag}>{s.tagText}</span>
        <div className="process-actions">
          <Link href={'/diagnostic?view=' + r.id} className="process-btn process-btn-view">View</Link>
          <button type="button" onClick={() => handleRedesign(r.id)} className="process-btn process-btn-redesign" disabled={redesigningId === r.id}>
            {redesigningId === r.id ? 'Generating...' : 'Redesign'}
          </button>
          <button type="button" onClick={handleEdit} className="process-btn process-btn-edit">Edit</button>
          <button type="button" className="process-btn process-btn-delete" onClick={() => handleDeleteClick(r.id)} disabled={isDeleting}>
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
        {showConfirm && !isDeleting && (
          <div className="delete-confirm-bar">
            <span>Delete this report permanently?</span>
            <button type="button" className="delete-confirm-yes" onClick={() => handleDeleteConfirm(r.id)}>Delete</button>
            <button type="button" className="delete-confirm-no" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
          </div>
        )}
      </div>
    );
  };

  const emptyHtml = (
    <div className="empty-state">
      No diagnostics found yet. <Link href="/diagnostic">Start your first diagnostic</Link>
    </div>
  );

  const statusLegend = (
    <div className="status-legend">
      <span className="status-legend-item"><span className="status-legend-dot green" /><span className="status-legend-label">Automation Ready</span><span className="status-legend-desc">- 70%+ automatable</span></span>
      <span className="status-legend-item"><span className="status-legend-dot amber" /><span className="status-legend-label">Improvements Required</span><span className="status-legend-desc">- 40&ndash;69% automatable</span></span>
      <span className="status-legend-item"><span className="status-legend-dot red" /><span className="status-legend-label">Requires Process Redesign</span><span className="status-legend-desc">- below 40%</span></span>
    </div>
  );

  const autoColor = avgAuto >= 70 ? '#16a34a' : avgAuto >= 40 ? '#d97706' : '#dc2626';

  return (
    <>
      <header className="dashboard-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Link href="/" className="header-logo">Sharpin<span style={{ color: 'var(--gold)' }}>.</span></Link>
          <div className="header-divider" />
          <span className="header-title">Client Login</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="header-email">{email}</span>
          <button onClick={onSignOut} className="header-btn">Sign Out</button>
        </div>
      </header>

      <div className="portal-wrap">
        <div className="dashboard-tabs">
          {['overview', 'reports'].map(t => (
            <button key={t} className={'dashboard-tab' + (tab === t ? ' active' : '')} onClick={() => setTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <div className="fade-in">
            <div className="metrics-row">
              <div className="metric-card">
                <span className="metric-val">{loading ? '--' : totalProcs}</span>
                <span className="metric-lbl">Process Analyses</span>
              </div>
              <div className="metric-card">
                <span className="metric-val" style={{ color: loading ? undefined : autoColor }}>
                  {loading ? '--' : avgAuto + '%'}
                </span>
                <span className="metric-lbl">Automation Readiness</span>
              </div>
              <div className="metric-card">
                <span className="metric-val">{loading ? '--' : reportList.length}</span>
                <span className="metric-lbl">Reports</span>
              </div>
            </div>

            <div className="quick-grid">
              <Link href="/diagnostic" className="quick-tile">
                <div className="quick-tile-icon" style={{ background: 'linear-gradient(135deg, #eff6ff, #dbeafe)', color: '#2563eb' }}>
                  <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 14l2 2 4-4"/></svg>
                </div>
                <h3>New Diagnostic</h3>
                <p>Analyse a new process</p>
              </Link>
              <a href="#" className="quick-tile" onClick={(e) => { e.preventDefault(); setTab('reports'); }}>
                <div className="quick-tile-icon" style={{ background: 'linear-gradient(135deg, #f0fdf4, #dcfce7)', color: '#16a34a' }}>
                  <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M7 16l4-4 4 4 5-6"/></svg>
                </div>
                <h3>All Reports</h3>
                <p>View all your diagnostics</p>
              </a>
              <Link href={'/monitor?email=' + encodeURIComponent(email)} className="quick-tile">
                <div className="quick-tile-icon" style={{ background: 'linear-gradient(135deg, #fef3c7, #fde68a)', color: '#b45309' }}>
                  <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                </div>
                <h3>Process Monitor</h3>
                <p>Track live instances</p>
              </Link>
            </div>

            <div className="dash-card">
              <div className="dash-card-header">
                <span className="dash-card-title">Your Diagnostic Reports</span>
                <Link href="/diagnostic" className="dash-card-action">+ New Diagnostic</Link>
              </div>
              <div>
                {loading ? (
                  <div className="loading-state" style={{ padding: 48 }}><div className="spinner" /><p>Loading your reports...</p></div>
                ) : reportList.length === 0 ? emptyHtml : reportList.slice(0, 5).map(renderReportRow)}
              </div>
              {statusLegend}
            </div>
          </div>
        )}

        {tab === 'reports' && (
          <div className="fade-in">
            <div className="dash-card">
              <div className="dash-card-header">
                <span className="dash-card-title">All Diagnostic Reports</span>
                <Link href="/diagnostic" className="dash-card-action">+ New Diagnostic</Link>
              </div>
              <div>
                {loading ? (
                  <div className="loading-state" style={{ padding: 48 }}><div className="spinner" /><p>Loading your reports...</p></div>
                ) : reportList.length === 0 ? emptyHtml : reportList.map(renderReportRow)}
              </div>
              {statusLegend}
            </div>
          </div>
        )}
      </div>

      <footer style={{ padding: '32px 24px', fontSize: '0.76rem', borderTop: '1px solid #e8ecf1', textAlign: 'center', color: 'var(--text-light)' }}>
        <Link href="/" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Sharpin</Link> &middot; Technology-agnostic process optimisation
      </footer>
    </>
  );
}
