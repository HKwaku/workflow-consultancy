'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

function formatCurrency(val) {
  if (val >= 1000000) return '\u00A3' + (val / 1000000).toFixed(1) + 'M';
  if (val >= 1000) return '\u00A3' + (val / 1000).toFixed(0) + 'K';
  return '\u00A3' + (val ?? 0);
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function ReportContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [report, setReport] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteEmail, setDeleteEmail] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [deleted, setDeleted] = useState(false);

  useEffect(() => {
    if (!id) { setError('No report ID provided'); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`/api/get-diagnostic?id=${encodeURIComponent(id)}`);
        const data = await resp.json();
        if (cancelled) return;
        if (!resp.ok || !data.success) { setError(data.error || 'Report not found.'); setLoading(false); return; }
        setReport(data.report);
      } catch (err) {
        if (cancelled) return;
        setError('Unable to reach the server. Please try again later.');
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  const contactEmail = report?.contactEmail || report?.diagnosticData?.contact?.email || '';

  const handleDelete = async () => {
    if (!deleteEmail.trim() || deleteEmail.trim().toLowerCase() !== contactEmail.toLowerCase()) {
      setDeleteError('Email does not match. Enter the contact email for this report.');
      return;
    }
    setDeleting(true); setDeleteError(null);
    try {
      const resp = await fetch('/api/get-dashboard', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportId: id, email: deleteEmail.trim() }) });
      const data = await resp.json();
      if (resp.ok && data.success) { setDeleted(true); setDeleteConfirm(false); setDeleteEmail(''); }
      else { setDeleteError(data.error || 'Failed to delete report.'); }
    } catch { setDeleteError('Network error. Please try again.'); }
    finally { setDeleting(false); }
  };

  if (loading) return <div className="loading-state" style={{ padding: 48, textAlign: 'center' }}><div className="loading-spinner" /><p>Retrieving your report...</p></div>;

  if (error) return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <p style={{ color: 'var(--red)' }}>{error}</p>
      <Link href="/diagnostic" style={{ color: 'var(--accent)', marginTop: 16, display: 'inline-block' }}>Start a New Diagnostic</Link><br />
      <Link href="/portal" style={{ color: 'var(--accent)', marginTop: 8, display: 'inline-block' }}>&larr; Back to Client Login</Link>
    </div>
  );

  if (deleted) return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <p style={{ color: 'var(--green)', fontWeight: 600, marginBottom: 16 }}>Report deleted successfully.</p>
      <Link href="/portal" style={{ color: 'var(--accent)', marginTop: 8, display: 'inline-block' }}>&larr; Back to Client Login</Link><br />
      <Link href="/diagnostic" style={{ color: 'var(--accent)', marginTop: 8, display: 'inline-block' }}>Start a New Diagnostic</Link>
    </div>
  );

  const d = report?.diagnosticData || {};
  const s = d.summary || {};
  const auto = d.automationScore || {};
  const c = d.contact || {};
  const recs = d.recommendations || [];
  const processes = d.processes || [];

  return (
    <div style={{ maxWidth: 720, margin: '40px auto 60px', padding: '0 20px' }}>
      <div style={{ background: 'var(--white)', borderRadius: 16, boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
        <div style={{ padding: 40 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32, flexWrap: 'wrap', gap: 16 }}>
            <div style={{ fontSize: '0.88rem', color: 'var(--text-light)' }}>
              <strong style={{ display: 'block', fontSize: '1.15rem', color: 'var(--text)', marginBottom: 2 }}>{report.company || c.company || 'Your Company'}</strong>
              <span>{report.contactName || c.name || ''} | {report.contactEmail || c.email || ''}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.88rem', color: 'var(--text-light)' }}>{formatDate(report.createdAt)}</span>
              {contactEmail && (
                <>
                  <Link href={`/portal?edit=${id}`} style={{ padding: '8px 16px', borderRadius: 8, fontSize: '0.84rem', fontWeight: 600, textDecoration: 'none', background: 'transparent', color: 'var(--accent)', border: '1.5px solid var(--border)' }}>Edit</Link>
                  <button onClick={() => setDeleteConfirm(true)} style={{ padding: '8px 16px', borderRadius: 8, fontSize: '0.84rem', fontWeight: 600, border: '1.5px solid var(--border)', background: 'transparent', color: 'var(--text-light)', cursor: 'pointer' }}>Delete</button>
                </>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16, marginBottom: 32 }}>
            <div style={{ background: 'var(--bg-alt)', borderRadius: 12, padding: 20, textAlign: 'center' }}>
              <div style={{ fontSize: '1.6rem', fontWeight: 700, marginBottom: 4, color: '#1e40af' }}>{s.totalProcesses ?? 0}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Processes Analysed</div>
            </div>
            <div style={{ background: 'var(--bg-alt)', borderRadius: 12, padding: 20, textAlign: 'center' }}>
              <div style={{ fontSize: '1.6rem', fontWeight: 700, marginBottom: 4, color: '#16a34a' }}>{formatCurrency(s.totalAnnualCost)}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Annual Process Cost</div>
            </div>
            <div style={{ background: 'var(--bg-alt)', borderRadius: 12, padding: 20, textAlign: 'center' }}>
              <div style={{ fontSize: '1.6rem', fontWeight: 700, marginBottom: 4, color: '#16a34a' }}>{formatCurrency(s.potentialSavings)}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Potential Savings</div>
            </div>
            <div style={{ background: 'var(--bg-alt)', borderRadius: 12, padding: 20, textAlign: 'center' }}>
              <div style={{ fontSize: '1.6rem', fontWeight: 700, marginBottom: 4, color: '#7c3aed' }}>{(auto.percentage ?? 0)}%</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Automation Ready</div>
            </div>
          </div>

          {processes.length > 0 && (
            <div style={{ marginBottom: 32 }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--primary)', marginBottom: 16, paddingBottom: 8, borderBottom: '2px solid var(--border)' }}>Process Breakdown</h3>
              {processes.map((proc, pi) => (
                <div key={pi} style={{ marginBottom: 24, background: 'var(--bg-alt)', borderRadius: 12, padding: 20, border: '1px solid var(--border)' }}>
                  <h4 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 12, color: 'var(--text)' }}>{proc.name || 'Process'}</h4>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-mid)', marginBottom: 12 }}>
                    {proc.stepsCount ?? (proc.steps || []).length} steps &middot; {formatCurrency(proc.annualCost)}/yr &middot; {proc.elapsedDays ?? 0} days typical
                  </div>
                  {(proc.steps || []).length > 0 && (
                    <ol style={{ margin: 0, paddingLeft: 20, fontSize: '0.9rem', lineHeight: 1.6 }}>
                      {(proc.steps || []).map((step, si) => (
                        <li key={si} style={{ marginBottom: 4 }}>
                          {step.name || 'Step ' + (si + 1)}
                          {step.department && <span style={{ color: 'var(--text-light)', fontSize: '0.8rem', marginLeft: 8 }}>({step.department})</span>}
                          {step.isDecision && <span style={{ marginLeft: 6, fontSize: '0.7rem', padding: '1px 6px', borderRadius: 4, background: '#7c3aed', color: 'white' }}>decision</span>}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ))}
            </div>
          )}

          {recs.length > 0 && (
            <div style={{ marginBottom: 32 }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--primary)', marginBottom: 16, paddingBottom: 8, borderBottom: '2px solid var(--border)' }}>Key Recommendations</h3>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {recs.map((r, i) => (
                  <li key={i} style={{ padding: '12px 16px', borderRadius: 8, marginBottom: 8, background: 'var(--bg-alt)', fontSize: '0.92rem', lineHeight: 1.5 }}>
                    <span style={{ display: 'inline-block', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', padding: '2px 8px', borderRadius: 4, background: 'var(--accent)', color: 'white', marginRight: 8, verticalAlign: 'middle' }}>{r.type || 'general'}</span>
                    {r.text || ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ background: 'linear-gradient(135deg, #eff6ff, #f0fdf4)', borderRadius: 12, padding: 32, textAlign: 'center', marginTop: 8 }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: 8, color: 'var(--text)' }}>Next Steps</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-mid)', marginBottom: 20 }}>Discuss your diagnostic findings and implementation roadmap with our team.</p>
            <a href="mailto:hopektettey@gmail.com?subject=Discovery%20Call%20-%20Process%20Diagnostic" style={{ display: 'inline-block', padding: '14px 36px', borderRadius: 8, fontWeight: 600, fontSize: '1rem', textDecoration: 'none', background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white' }}>Book Discovery Call</a>
          </div>

          {contactEmail && (
            <div style={{ background: 'linear-gradient(135deg, #faf5ff, #eff6ff)', borderRadius: 12, padding: 32, textAlign: 'center', marginTop: 16 }}>
              <h3 style={{ fontSize: '1.1rem', marginBottom: 8, color: 'var(--text)' }}>Track Your Progress Over Time</h3>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-mid)', marginBottom: 20 }}>Run another diagnostic in the future and compare results side-by-side in your client login.</p>
              <Link href="/portal" style={{ display: 'inline-block', padding: '14px 36px', borderRadius: 8, fontWeight: 600, fontSize: '1rem', textDecoration: 'none', background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white' }}>View in Client Login</Link>
            </div>
          )}
        </div>
      </div>

      {deleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={(e) => e.target === e.currentTarget && setDeleteConfirm(false)}>
          <div style={{ background: 'var(--white)', borderRadius: 12, padding: 24, maxWidth: 400, width: '90%', boxShadow: 'var(--shadow-lg)' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '1.1rem' }}>Delete Report</h3>
            <p style={{ margin: '0 0 16px', fontSize: '0.9rem', color: 'var(--text-mid)' }}>This will permanently delete this report. Enter your email to confirm.</p>
            <input type="email" placeholder="Your email" value={deleteEmail} onChange={(e) => { setDeleteEmail(e.target.value); setDeleteError(null); }} style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: '0.9rem', marginBottom: 12, boxSizing: 'border-box' }} />
            {deleteError && <p style={{ margin: '0 0 12px', fontSize: '0.84rem', color: 'var(--red)' }}>{deleteError}</p>}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button onClick={() => { setDeleteConfirm(false); setDeleteEmail(''); setDeleteError(null); }} disabled={deleting} style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--white)', cursor: 'pointer', fontSize: '0.9rem' }}>Cancel</button>
              <button onClick={handleDelete} disabled={deleting} style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: 'var(--red)', color: 'white', cursor: deleting ? 'not-allowed' : 'pointer', fontSize: '0.9rem' }}>{deleting ? 'Deleting...' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}

      <p style={{ padding: '30px 20px', textAlign: 'center', fontSize: '0.9rem', color: 'var(--text-mid)' }}>
        Sharpin &middot; <Link href="/">Home</Link> &middot; <Link href="/diagnostic">New Diagnostic</Link>
      </p>
    </div>
  );
}

export default function ReportPage() {
  return (
    <Suspense fallback={<div className="loading-state" style={{ padding: 48, textAlign: 'center' }}><div className="loading-spinner" /><p>Loading...</p></div>}>
      <ReportContent />
    </Suspense>
  );
}
