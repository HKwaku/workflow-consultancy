'use client';

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import { getSupabaseClient } from '@/lib/supabase';

function formatCurrency(val) {
  if (val >= 1000000) return '\u00A3' + (val / 1000000).toFixed(1) + 'M';
  if (val >= 1000) return '\u00A3' + (val / 1000).toFixed(0) + 'K';
  return '\u00A3' + Math.round(val ?? 0);
}

function SectionTabs({ tabs, defaultTab }) {
  const [activeTab, setActiveTab] = useState(defaultTab);
  const activeContent = tabs.find((t) => t.id === activeTab)?.content ?? tabs[0]?.content;
  return (
    <div className="cost-analysis-tabs-wrap">
      <nav className="cost-analysis-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            className={`cost-analysis-tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="cost-analysis-tab-content">{activeContent}</div>
    </div>
  );
}

function CostAnalysisContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id');
  const token = searchParams.get('token');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [redirectToReport, setRedirectToReport] = useState(false);
  const [data, setData] = useState(null);

  const [labourRates, setLabourRates] = useState([]);
  const [blendedRate, setBlendedRate] = useState(50);
  const [onCostMultiplier, setOnCostMultiplier] = useState(1.25);
  const [nonLabour, setNonLabour] = useState({ systemsAnnual: 0, externalPerInstance: 0, complianceAnnual: 0 });

  useEffect(() => {
    if (!id) {
      setError('Report ID is required.');
      setLoading(false);
      return;
    }
    const url = `/api/cost-analysis?id=${id}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
    const doFetch = async () => {
      const sb = getSupabaseClient();
      const { data: { session } } = await sb.auth.getSession();
      const headers = {};
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      return fetch(url, { headers });
    };
    doFetch()
      .then((r) => r.json())
      .then((res) => {
        if (res.error) throw new Error(res.error);
        if (res.redirectToReport) {
          setRedirectToReport(true);
          return;
        }
        setData(res);
        const existing = res.existingCostAnalysis;
        if (existing) {
          setLabourRates((existing.labourRates || []).map((r) => ({
            department: r.department,
            hourlyRate: r.hourlyRate ?? 50,
            utilisation: r.utilisation ?? 0.85,
          })));
          setBlendedRate(existing.blendedRate ?? 50);
          setOnCostMultiplier(existing.onCostMultiplier ?? 1.25);
          setNonLabour({
            systemsAnnual: existing.nonLabour?.systemsAnnual ?? 0,
            externalPerInstance: existing.nonLabour?.externalPerInstance ?? 0,
            complianceAnnual: existing.nonLabour?.complianceAnnual ?? 0,
          });
        } else {
          const depts = res.departments || ['Default'];
          setLabourRates(depts.map((d) => ({ department: d, hourlyRate: 50, utilisation: 0.85 })));
        }
      })
      .catch((e) => setError(e.message || 'Failed to load report.'))
      .finally(() => setLoading(false));
  }, [id, token]);

  const handleSave = useCallback(async () => {
    if (!id || !data) return;
    setSaving(true);
    setError('');
    try {
      const sb = getSupabaseClient();
      const { data: { session } } = await sb.auth.getSession();
      const headers = { 'Content-Type': 'application/json' };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const res = await fetch('/api/cost-analysis', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          reportId: id,
          token: token || undefined,
          costAnalysis: {
            labourRates,
            blendedRate,
            onCostMultiplier,
            nonLabour,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save.');
      window.location.href = json.reportUrl || `/report?id=${id}`;
    } catch (e) {
      setError(e.message || 'Failed to save cost analysis.');
    } finally {
      setSaving(false);
    }
  }, [id, token, data, labourRates, blendedRate, onCostMultiplier, nonLabour]);

  const processes = data?.processes || [];
  const processName = processes[0]?.name || processes[0]?.processName || 'Cost analysis';

  const { totalAnnualCost, potentialSavings } = useMemo(() => {
    const rateByDept = (labourRates || []).reduce((acc, r) => {
      if (r.department && r.hourlyRate > 0) acc[r.department] = (r.hourlyRate || 0) * (r.utilisation ?? 1);
      return acc;
    }, {});
    const defaultRate = (blendedRate || 50) * (onCostMultiplier || 1.25);

    let labourTotal = 0;
    let savingsTotal = 0;
    const savingsPct = 30;

    (processes || []).forEach((p) => {
      const hours = p.hoursPerInstance ?? 4;
      const teamSize = p.teamSize ?? 1;
      const annual = p.annual ?? 12;
      const depts = p.departments || [];
      const avgRate = depts.length > 0
        ? depts.reduce((sum, d) => sum + (rateByDept[d] ?? defaultRate), 0) / depts.length
        : defaultRate;
      const instanceCost = hours * avgRate;
      const annualCost = instanceCost * annual * teamSize;
      labourTotal += annualCost;
      savingsTotal += annualCost * (savingsPct / 100);
    });

    const totalInstances = processes.reduce((sum, p) => sum + ((p.annual ?? 12) * (p.teamSize ?? 1)), 0);
    const systemsAnnual = (nonLabour?.systemsAnnual ?? 0) || 0;
    const externalAnnual = (nonLabour?.externalPerInstance ?? 0) * Math.max(totalInstances, 1);
    const complianceAnnual = (nonLabour?.complianceAnnual ?? 0) || 0;
    const totalAnnualCost = labourTotal + systemsAnnual + externalAnnual + complianceAnnual;

    return { totalAnnualCost, potentialSavings: savingsTotal };
  }, [labourRates, blendedRate, onCostMultiplier, processes, nonLabour]);

  if (redirectToReport) {
    return (
      <div className="report-page" style={{ padding: 40, textAlign: 'center' }}>
        <div className="report-card" style={{ maxWidth: 480, margin: '0 auto' }}>
          <h1 className="report-title">Cost analysis complete</h1>
          <p className="report-subtitle">This report already has cost analysis. View the full report below.</p>
          <Link href={`/report?id=${id}`} className="button button-primary" style={{ marginTop: 16 }}>View report</Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="report-page" style={{ padding: 40, textAlign: 'center' }}>
        <div className="loading-state loading-fallback"><div className="loading-spinner" /></div>
        <p style={{ marginTop: 16 }}>Loading report...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="report-page" style={{ padding: 40, textAlign: 'center' }}>
        <div className="report-card" style={{ maxWidth: 480, margin: '0 auto' }}>
          <h1 className="report-title">Cost analysis</h1>
          <p className="report-subtitle" style={{ color: 'var(--danger)' }}>{error}</p>
          {!token && (
            <p style={{ marginTop: 12, fontSize: '0.9rem' }}>Use the link assigned to you by the report owner to complete cost analysis.</p>
          )}
          <Link href="/portal" style={{ color: 'var(--accent)', marginTop: 16, display: 'inline-block' }}>Back to portal</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="report-page cost-analysis-page">
      <div className="top-bar">
        <div className="top-bar-inner">
          <div className="top-bar-left">
            <a href="/">Sharpin<span className="top-bar-brand-dot">.</span></a>
            <div className="top-bar-divider" />
            <span className="top-bar-title">Cost analysis</span>
          </div>
          <div className="top-bar-nav">
            <ThemeToggle className="top-bar-theme-btn" />
            <Link href={`/report?id=${id}`} className="top-bar-link">View report</Link>
            <Link href="/portal" className="top-bar-link">Portal</Link>
          </div>
        </div>
      </div>

      <div className="report-container">
        <div className="report-card">
          <div className="report-hero">
            <h1 className="report-title">{processName}</h1>
            <p className="report-subtitle">Complete cost analysis. Add labour rates and non-labour costs to generate the full cost summary. This link is for managers with cost visibility.</p>
          </div>

          {error && <div className="cost-analysis-error">{error}</div>}

          <div className="cost-analysis-summary-cards">
            <div className="cost-analysis-summary-card">
              <div className="cost-analysis-summary-label">Total annual cost</div>
              <div className="cost-analysis-summary-value">{formatCurrency(totalAnnualCost)}</div>
            </div>
            <div className="cost-analysis-summary-card cost-analysis-summary-card-success">
              <div className="cost-analysis-summary-label">Potential savings</div>
              <div className="cost-analysis-summary-value">{formatCurrency(potentialSavings)}</div>
            </div>
          </div>

          <SectionTabs
            tabs={[
              {
                id: 'labour',
                label: 'Labour rates by department',
                content: (
                  <>
                    <p className="cost-analysis-section-desc">Set hourly rates (fully loaded) for each department involved in the process. Values update as you enter inputs.</p>
                    <div className="cost-analysis-rates-wrapper">
                      {labourRates.map((r, i) => (
                        <div key={i} className="cost-analysis-rate-row">
                          <span className="cost-analysis-dept-name">{r.department}</span>
                          <input
                            type="number"
                            className="cost-analysis-input cost-input-rate"
                            min={10}
                            step={5}
                            value={r.hourlyRate}
                            onChange={(e) => {
                              const next = [...labourRates];
                              next[i] = { ...next[i], hourlyRate: parseFloat(e.target.value) || 0 };
                              setLabourRates(next);
                            }}
                            placeholder="£/hr"
                          />
                          <span className="cost-label-util">Utilisation</span>
                          <input
                            type="number"
                            className="cost-analysis-input cost-input-util"
                            min={0.5}
                            max={1}
                            step={0.05}
                            value={r.utilisation ?? 0.85}
                            onChange={(e) => {
                              const next = [...labourRates];
                              next[i] = { ...next[i], utilisation: parseFloat(e.target.value) || 0.85 };
                              setLabourRates(next);
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </>
                ),
              },
              {
                id: 'blended',
                label: 'Blended rate (fallback)',
                content: (
                  <>
                    <p className="cost-analysis-section-desc">Used when a department has no specific rate.</p>
                    <div className="cost-analysis-form-row">
                      <div className="cost-analysis-field">
                        <label>Hourly rate (£)</label>
                        <input type="number" className="cost-analysis-input" min={10} step={5} value={blendedRate} onChange={(e) => setBlendedRate(parseFloat(e.target.value) || 50)} />
                      </div>
                      <div className="cost-analysis-field">
                        <label>On-cost multiplier</label>
                        <input type="number" className="cost-analysis-input" min={1} max={2} step={0.05} value={onCostMultiplier} onChange={(e) => setOnCostMultiplier(parseFloat(e.target.value) || 1.25)} placeholder="1.25" />
                      </div>
                    </div>
                  </>
                ),
              },
              {
                id: 'nonlabour',
                label: 'Non-labour costs (annual)',
                content: (
                  <div className="cost-analysis-grid">
                    <div className="cost-analysis-field">
                      <label>Systems (£/yr)</label>
                      <input type="number" className="cost-analysis-input" min={0} step={0} value={nonLabour.systemsAnnual} onChange={(e) => setNonLabour({ ...nonLabour, systemsAnnual: parseFloat(e.target.value) || 0 })} />
                    </div>
                    <div className="cost-analysis-field">
                      <label>External per instance (£)</label>
                      <input type="number" className="cost-analysis-input" min={0} step={0.5} value={nonLabour.externalPerInstance} onChange={(e) => setNonLabour({ ...nonLabour, externalPerInstance: parseFloat(e.target.value) || 0 })} />
                    </div>
                    <div className="cost-analysis-field">
                      <label>Compliance (£/yr)</label>
                      <input type="number" className="cost-analysis-input" min={0} step={0} value={nonLabour.complianceAnnual} onChange={(e) => setNonLabour({ ...nonLabour, complianceAnnual: parseFloat(e.target.value) || 0 })} />
                    </div>
                  </div>
                ),
              },
            ]}
            defaultTab="labour"
          />

          <div className="cost-analysis-actions">
            <button type="button" className="button button-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save cost analysis'}
            </button>
            <Link href={`/report?id=${id}`} className="button" style={{ background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)' }}>Cancel</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CostAnalysisPage() {
  return (
    <Suspense fallback={
      <div className="report-page" style={{ padding: 40, textAlign: 'center' }}>
        <div className="loading-state loading-fallback"><div className="loading-spinner" /></div>
        <p style={{ marginTop: 16 }}>Loading...</p>
      </div>
    }>
      <CostAnalysisContent />
    </Suspense>
  );
}
