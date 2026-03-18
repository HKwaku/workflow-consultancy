'use client';

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import { getSupabaseClient } from '@/lib/supabase';

function formatCurrency(val) {
  if (val >= 1_000_000) return '\u00A3' + (val / 1_000_000).toFixed(1) + 'M';
  if (val >= 1_000) return '\u00A3' + (val / 1_000).toFixed(0) + 'K';
  return '\u00A3' + Math.round(val ?? 0);
}

function Tooltip({ text }) {
  return (
    <span className="cost-tooltip" title={text} aria-label={text}>?</span>
  );
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

function TopBar({ id, title, extra }) {
  return (
    <div className="top-bar">
      <div className="top-bar-inner">
        <div className="top-bar-left">
          <a href="/">Sharpin<span className="top-bar-brand-dot">.</span></a>
          <div className="top-bar-divider" />
          <span className="top-bar-title">{title || 'Cost analysis'}</span>
        </div>
        <div className="top-bar-nav">
          <ThemeToggle className="top-bar-theme-btn" />
          {extra}
          {id && <Link href={`/report?id=${id}`} className="top-bar-link">View report</Link>}
          <Link href="/portal" className="top-bar-link">Portal</Link>
        </div>
      </div>
    </div>
  );
}

function CostAnalysisContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id');
  const token = searchParams.get('token');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState('');
  const [shareError, setShareError] = useState('');
  const [redirectToReport, setRedirectToReport] = useState(false);
  const [data, setData] = useState(null);
  const [saveDone, setSaveDone] = useState(false);
  const [shared, setShared] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [validationWarnings, setValidationWarnings] = useState([]);

  const [labourRates, setLabourRates] = useState([]);
  const [blendedRate, setBlendedRate] = useState(50);
  const [onCostMultiplier, setOnCostMultiplier] = useState(1.25);
  const [nonLabour, setNonLabour] = useState({ systemsAnnual: 0, externalPerInstance: 0, complianceAnnual: 0 });
  const [processSavings, setProcessSavings] = useState({});
  const [systemCosts, setSystemCosts] = useState({});
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiReasonings, setAiReasonings] = useState({});
  const [aiEstimated, setAiEstimated] = useState({}); // tracks which savings % values came from AI
  const autoAiFetchedRef = useRef(false);

  const draftKey = id ? `cost-draft-${id}` : null;

  useEffect(() => {
    if (!id) { setError('Report ID is required.'); setLoading(false); return; }
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
        if (res.redirectToReport) { setRedirectToReport(true); return; }
        setData(res);

        let draft = null;
        try { draft = draftKey ? JSON.parse(localStorage.getItem(draftKey) || 'null') : null; } catch {}

        const existing = res.existingCostAnalysis;
        const source = draft || existing;
        if (source) {
          setLabourRates((source.labourRates || []).map((r) => ({
            department: r.department,
            hourlyRate: r.hourlyRate ?? 50,
            utilisation: r.utilisation ?? 0.85,
          })));
          setBlendedRate(source.blendedRate ?? 50);
          setOnCostMultiplier(source.onCostMultiplier ?? 1.25);
          setNonLabour({
            externalPerInstance: source.nonLabour?.externalPerInstance ?? 0,
            complianceAnnual: source.nonLabour?.complianceAnnual ?? 0,
          });
          // Load per-system costs (new format) or migrate from old systemsAnnual
          if (source.nonLabour?.systemCosts) {
            setSystemCosts(source.nonLabour.systemCosts);
          } else if (source.nonLabour?.systemsAnnual > 0) {
            // Distribute old total equally across all systems
            const sysList = res.allSystems || [];
            if (sysList.length > 0) {
              const perSystem = Math.round(source.nonLabour.systemsAnnual / sysList.length);
              const costs = {};
              sysList.forEach(s => { costs[s] = perSystem; });
              setSystemCosts(costs);
            }
          } else {
            // Pre-populate systems with 0 cost
            const costs = {};
            (res.allSystems || []).forEach(s => { costs[s] = 0; });
            setSystemCosts(costs);
          }
          if (source.processSavings) {
            setProcessSavings(source.processSavings);
          } else {
            // Use AI-suggested defaults from server
            const defaults = {};
            (res.processes || []).forEach((p, i) => {
              if (p.suggestedSavingsPct) defaults[i] = p.suggestedSavingsPct;
            });
            setProcessSavings(defaults);
          }
        } else {
          const depts = res.departments || ['Default'];
          setLabourRates(depts.map((d) => ({ department: d, hourlyRate: 50, utilisation: 0.85 })));
          // Pre-populate systems with 0 cost
          const costs = {};
          (res.allSystems || []).forEach(s => { costs[s] = 0; });
          setSystemCosts(costs);
          // Use rule-based suggested savings % as defaults
          const defaults = {};
          (res.processes || []).forEach((p, i) => {
            if (p.suggestedSavingsPct) defaults[i] = p.suggestedSavingsPct;
          });
          setProcessSavings(defaults);
        }
      })
      .catch((e) => setError(e.message || 'Failed to load report.'))
      .finally(() => setLoading(false));
  }, [id, token]);

  useEffect(() => {
    if (!draftKey || loading || !data) return;
    const draft = { labourRates, blendedRate, onCostMultiplier, nonLabour, processSavings, systemCosts, savedAt: Date.now() };
    try { localStorage.setItem(draftKey, JSON.stringify(draft)); } catch {}
  }, [labourRates, blendedRate, onCostMultiplier, nonLabour, processSavings, systemCosts]);

  const processes = data?.processes || [];
  const processName = processes[0]?.name || processes[0]?.processName || 'Cost analysis';

  const rateByDept = useMemo(() => {
    return (labourRates || []).reduce((acc, r) => {
      if (r.department && r.hourlyRate > 0) acc[r.department] = (r.hourlyRate || 0) * (r.utilisation ?? 1);
      return acc;
    }, {});
  }, [labourRates]);

  const defaultRate = useMemo(() => (blendedRate || 50) * (onCostMultiplier || 1.25), [blendedRate, onCostMultiplier]);

  const processBreakdown = useMemo(() => {
    return (processes || []).map((p, i) => {
      const hours = p.hoursPerInstance ?? 4;
      const teamSize = p.teamSize ?? 1;
      const annual = p.annual ?? 12;
      const depts = p.departments || [];
      const avgRate = depts.length > 0
        ? depts.reduce((sum, d) => sum + (rateByDept[d] ?? defaultRate), 0) / depts.length
        : defaultRate;
      const instanceCost = hours * avgRate;
      const annualLabour = instanceCost * annual * teamSize;
      const savingsPct = processSavings[i] ?? 30;
      const potentialSavings = annualLabour * (savingsPct / 100);
      return { name: p.name || `Process ${i + 1}`, hours, teamSize, annual, avgRate, instanceCost, annualLabour, savingsPct, potentialSavings, depts };
    });
  }, [processes, rateByDept, defaultRate, processSavings]);

  const totalSystemsCost = useMemo(
    () => Object.values(systemCosts).reduce((sum, v) => sum + (Number(v) || 0), 0),
    [systemCosts]
  );

  const { totalAnnualCost, potentialSavings, totalLabour, totalFixed } = useMemo(() => {
    const totalLabour = processBreakdown.reduce((sum, p) => sum + p.annualLabour, 0);
    const totalInstances = processes.reduce((sum, p) => sum + ((p.annual ?? 12) * (p.teamSize ?? 1)), 0);
    const externalAnnual = (nonLabour?.externalPerInstance ?? 0) * Math.max(totalInstances, 1);
    const complianceAnnual = (nonLabour?.complianceAnnual ?? 0) || 0;
    const totalFixed = totalSystemsCost + externalAnnual + complianceAnnual;
    const totalAnnualCost = totalLabour + totalFixed;
    const potentialSavings = processBreakdown.reduce((sum, p) => sum + p.potentialSavings, 0);
    return { totalAnnualCost, potentialSavings, totalLabour, totalFixed };
  }, [processBreakdown, processes, nonLabour, totalSystemsCost]);

  function validate() {
    const warnings = [];
    const hasAnyRate = labourRates.some(r => r.hourlyRate > 0) || blendedRate > 0;
    if (!hasAnyRate) warnings.push({ type: 'error', msg: 'At least one hourly rate must be greater than £0.' });
    labourRates.forEach(r => {
      if (r.hourlyRate > 0 && r.hourlyRate < 15) warnings.push({ type: 'warn', msg: `${r.department}: rate of £${r.hourlyRate}/hr seems very low. Please check.` });
      if (r.hourlyRate > 500) warnings.push({ type: 'warn', msg: `${r.department}: rate of £${r.hourlyRate}/hr is very high. Please check.` });
    });
    if (blendedRate > 0 && blendedRate < 15) warnings.push({ type: 'warn', msg: `Default rate of £${blendedRate}/hr seems very low. Please check.` });
    if (blendedRate > 500) warnings.push({ type: 'warn', msg: `Default rate of £${blendedRate}/hr is very high. Please check.` });
    return warnings;
  }

  const handleAiSuggest = useCallback(async (currentSavings) => {
    if (!id || !data) return;
    setAiSuggesting(true);
    setAiError('');
    try {
      const sb = getSupabaseClient();
      const { data: { session } } = await sb.auth.getSession();
      const headers = { 'Content-Type': 'application/json' };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const res = await fetch('/api/cost-analysis/suggest-savings', {
        method: 'POST',
        headers,
        body: JSON.stringify({ reportId: id, token: token || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'AI estimation failed.');
      const newSavings = { ...(currentSavings ?? processSavings) };
      const newReasonings = {};
      const newAiEstimated = {};
      (json.suggestions || []).forEach(s => {
        newSavings[s.processIndex] = s.savingsPct;
        newReasonings[s.processIndex] = { reasoning: s.reasoning, confidence: s.confidence };
        newAiEstimated[s.processIndex] = true;
      });
      setProcessSavings(newSavings);
      setAiReasonings(newReasonings);
      setAiEstimated(newAiEstimated);
    } catch (e) {
      setAiError(e.message || 'AI estimation failed.');
    } finally {
      setAiSuggesting(false);
    }
  }, [id, token, data, processSavings]);

  // Auto-fetch AI estimate on first load when no existing saved data
  useEffect(() => {
    if (!data || autoAiFetchedRef.current) return;
    const hasExistingSavings = data.existingCostAnalysis?.processSavings &&
      Object.keys(data.existingCostAnalysis.processSavings).length > 0;
    if (!hasExistingSavings) {
      autoAiFetchedRef.current = true;
      handleAiSuggest({});
    }
  }, [data]);

  function handleReview() {
    const warnings = validate();
    setValidationWarnings(warnings);
    if (warnings.some(w => w.type === 'error')) return;
    setShowReview(true);
  }

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
          costAnalysis: { labourRates, blendedRate, onCostMultiplier, nonLabour: { ...nonLabour, systemCosts, systemsAnnual: totalSystemsCost }, processSavings },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save.');
      try { if (draftKey) localStorage.removeItem(draftKey); } catch {}
      setSaveDone(true);
      setShowReview(false);
    } catch (e) {
      setError(e.message || 'Failed to save cost analysis.');
    } finally {
      setSaving(false);
    }
  }, [id, token, data, labourRates, blendedRate, onCostMultiplier, nonLabour, processSavings]);

  const handleShare = useCallback(async () => {
    if (!id) return;
    setSharing(true);
    setShareError('');
    try {
      const sb = getSupabaseClient();
      const { data: { session } } = await sb.auth.getSession();
      const headers = { 'Content-Type': 'application/json' };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const res = await fetch('/api/cost-analysis', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ reportId: id, token: token || undefined, shareWithOwner: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to share.');
      setShared(true);
    } catch (e) {
      setShareError(e.message || 'Failed to share.');
    } finally {
      setSharing(false);
    }
  }, [id, token]);

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
          {!token && <p style={{ marginTop: 12, fontSize: '0.9rem' }}>Use the link assigned to you by the report owner to complete cost analysis.</p>}
          <Link href="/portal" style={{ color: 'var(--accent)', marginTop: 16, display: 'inline-block' }}>Back to portal</Link>
        </div>
      </div>
    );
  }

  if (saveDone) {
    return (
      <div className="report-page cost-analysis-page">
        <TopBar id={id} title="Cost analysis — saved" />
        <div className="report-container">
          <div className="report-card">
            <div className="cost-save-done-hero">
              <div className="cost-save-done-icon">✓</div>
              <h2>Cost analysis saved</h2>
              <p>The cost breakdown has been saved. You can now share the results with the report owner, or keep them confidential.</p>
            </div>
            <div className="cost-share-card">
              <h3>Share with report owner?</h3>
              <p className="cost-share-desc">
                Cost data includes salary rates and potential redundancy savings — this is <strong>confidential by default</strong>. Only share if the owner needs to see the full cost breakdown to make decisions.
              </p>
              {shareError && <div className="cost-analysis-error" style={{ marginBottom: 12 }}>{shareError}</div>}
              {shared ? (
                <div className="cost-share-success">Results have been shared with the report owner.</div>
              ) : (
                <div className="cost-share-actions">
                  <button type="button" className="button button-primary" onClick={handleShare} disabled={sharing}>
                    {sharing ? 'Sharing...' : 'Share with owner'}
                  </button>
                  <Link href={`/report?id=${id}`} className="button" style={{ background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                    Keep confidential
                  </Link>
                </div>
              )}
            </div>
            {shared && (
              <div style={{ textAlign: 'center', marginTop: 24 }}>
                <Link href={`/report?id=${id}`} className="button button-primary">View report</Link>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (showReview) {
    return (
      <div className="report-page cost-analysis-page">
        <TopBar id={id} title="Cost analysis — review" extra={
          <button type="button" className="top-bar-link" onClick={() => setShowReview(false)}>← Back to edit</button>
        } />
        <div className="report-container">
          <div className="report-card">
            <div className="report-hero">
              <h1 className="report-title">Review cost breakdown</h1>
              <p className="report-subtitle">Confirm figures before saving. This data is <strong>confidential by default</strong> and will not be visible to the report owner unless you explicitly share it.</p>
            </div>
            {error && <div className="cost-analysis-error" style={{ marginBottom: 16 }}>{error}</div>}
            {validationWarnings.filter(w => w.type === 'warn').length > 0 && (
              <div className="cost-analysis-warnings">
                {validationWarnings.filter(w => w.type === 'warn').map((w, i) => (
                  <div key={i} className="cost-analysis-warning">⚠ {w.msg}</div>
                ))}
              </div>
            )}
            <div className="cost-review-breakdown">
              {processBreakdown.map((p, i) => (
                <div key={i} className="cost-review-process-row">
                  <div className="cost-review-process-name">{p.name}</div>
                  <div className="cost-review-process-details">
                    <span>{p.hours}h/instance × {p.annual} runs/yr × {p.teamSize} person(s)</span>
                    <span>Avg rate: £{p.avgRate.toFixed(0)}/hr (fully loaded)</span>
                    <span className="cost-review-annual">Annual labour cost: <strong>{formatCurrency(p.annualLabour)}</strong></span>
                    <span className="cost-review-savings">Variable savings ({p.savingsPct}%): <strong className="cost-review-savings-val">{formatCurrency(p.potentialSavings)}</strong></span>
                  </div>
                </div>
              ))}
            </div>
            {totalFixed > 0 && (
              <div className="cost-review-fixed-row">
                <span>Non-labour (fixed) costs</span>
                <strong>{formatCurrency(totalFixed)}/yr</strong>
              </div>
            )}
            <div className="cost-review-totals">
              <div className="cost-review-total-row">
                <span>Total annual cost</span>
                <span className="cost-review-total-val">{formatCurrency(totalAnnualCost)}</span>
              </div>
              <div className="cost-review-total-row success">
                <span>Automation savings potential</span>
                <span className="cost-review-total-val">{formatCurrency(potentialSavings)}</span>
              </div>
              {totalAnnualCost > 0 && (
                <div className="cost-review-leverage">
                  Operating leverage opportunity: <strong>{Math.round(potentialSavings / totalAnnualCost * 100)}%</strong> of total annual cost is reducible through process automation
                </div>
              )}
            </div>
            <div className="cost-analysis-actions">
              <button type="button" className="button button-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Confirm and save'}
              </button>
              <button type="button" className="button" style={{ background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)' }} onClick={() => setShowReview(false)}>
                Back to edit
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="report-page cost-analysis-page">
      <TopBar id={id} />
      <div className="report-container">
        <div className="report-card">
          <div className="report-hero">
            <h1 className="report-title">{processName}</h1>
            <p className="report-subtitle">Identify variable cost drivers and automation savings opportunities to build operating leverage. Data entered here is <strong>confidential by default</strong> — not visible to the report owner unless you choose to share it.</p>
          </div>

          {error && <div className="cost-analysis-error" style={{ marginBottom: 16 }}>{error}</div>}
          {validationWarnings.some(w => w.type === 'error') && (
            <div className="cost-analysis-errors">
              {validationWarnings.filter(w => w.type === 'error').map((w, i) => (
                <div key={i} className="cost-analysis-error">{w.msg}</div>
              ))}
            </div>
          )}

          <div className="cost-analysis-summary-cards">
            <div className="cost-analysis-summary-card">
              <div className="cost-analysis-summary-label">Variable (labour)</div>
              <div className="cost-analysis-summary-value">{formatCurrency(totalLabour)}<span className="cost-summary-sublabel">/yr</span></div>
            </div>
            <div className="cost-analysis-summary-card">
              <div className="cost-analysis-summary-label">Fixed (non-labour)</div>
              <div className="cost-analysis-summary-value">{formatCurrency(totalFixed)}<span className="cost-summary-sublabel">/yr</span></div>
            </div>
            <div className="cost-analysis-summary-card">
              <div className="cost-analysis-summary-label">Total annual cost</div>
              <div className="cost-analysis-summary-value">{formatCurrency(totalAnnualCost)}<span className="cost-summary-sublabel">/yr</span></div>
            </div>
            <div className="cost-analysis-summary-card cost-analysis-summary-card-success">
              <div className="cost-analysis-summary-label">Automation savings potential</div>
              <div className="cost-analysis-summary-value">{formatCurrency(potentialSavings)}<span className="cost-summary-sublabel">/yr</span></div>
            </div>
          </div>

          <SectionTabs
            tabs={[
              {
                id: 'labour',
                label: 'Labour rates',
                content: (
                  <>
                    <p className="cost-analysis-section-desc">Set fully loaded hourly rates per department. Labour is your primary variable cost — it scales with process volume and is the main driver of operating leverage through automation.</p>
                    <div className="cost-analysis-rates-wrapper">
                      {labourRates.map((r, i) => (
                        <div key={i} className="cost-analysis-rate-row">
                          <span className="cost-analysis-dept-name">{r.department}</span>
                          <input
                            type="number"
                            className={`cost-analysis-input cost-input-rate${r.hourlyRate > 0 && (r.hourlyRate < 15 || r.hourlyRate > 500) ? ' cost-input-warn' : ''}`}
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
                          <span className="cost-label-util">
                            Utilisation
                            <Tooltip text="Proportion of paid hours spent on this process. 0.85 = 85% productive (industry standard). Accounts for meetings, admin, and downtime." />
                          </span>
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
                label: 'Default rate',
                content: (
                  <>
                    <p className="cost-analysis-section-desc">Used when a department has no specific rate. Acts as a blended fallback across all teams.</p>
                    <div className="cost-analysis-form-row">
                      <div className="cost-analysis-field">
                        <label>Hourly rate (£)</label>
                        <input type="number" className="cost-analysis-input" min={10} step={5} value={blendedRate} onChange={(e) => setBlendedRate(parseFloat(e.target.value) || 50)} />
                      </div>
                      <div className="cost-analysis-field">
                        <label>
                          On-cost multiplier
                          <Tooltip text="Multiplies the base rate to cover employer costs: NI, pension, healthcare, and benefits. 1.25 means employer cost is 25% above the quoted hourly rate." />
                        </label>
                        <input type="number" className="cost-analysis-input" min={1} max={2} step={0.05} value={onCostMultiplier} onChange={(e) => setOnCostMultiplier(parseFloat(e.target.value) || 1.25)} placeholder="1.25" />
                      </div>
                    </div>
                  </>
                ),
              },
              {
                id: 'nonlabour',
                label: 'Non-labour costs',
                content: (
                  <>
                    {Object.keys(systemCosts).length > 0 ? (
                      <div className="cost-systems-section">
                        <p className="cost-analysis-section-desc">System licensing costs identified from process steps. Enter annual cost per system.</p>
                        <div className="cost-systems-grid">
                          {Object.keys(systemCosts).map((sys) => (
                            <div key={sys} className="cost-analysis-field cost-system-field">
                              <label className="cost-system-label">{sys}</label>
                              <div className="cost-system-input-wrap">
                                <span className="cost-currency-prefix">£</span>
                                <input
                                  type="number"
                                  className="cost-analysis-input cost-input-system"
                                  min={0}
                                  step={100}
                                  value={systemCosts[sys] ?? 0}
                                  onChange={(e) => setSystemCosts(prev => ({ ...prev, [sys]: parseFloat(e.target.value) || 0 }))}
                                  placeholder="0"
                                />
                                <span className="cost-system-unit">/yr</span>
                              </div>
                            </div>
                          ))}
                        </div>
                        {totalSystemsCost > 0 && (
                          <div className="cost-systems-total">
                            Total systems cost: <strong>{formatCurrency(totalSystemsCost)}/yr</strong>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="cost-analysis-section-desc" style={{ color: 'var(--muted)' }}>No systems were identified in the process steps. Systems with names entered in the process flow will appear here.</p>
                    )}
                    <div className="cost-analysis-grid" style={{ marginTop: 16 }}>
                      <div className="cost-analysis-field">
                        <label>
                          External per instance (£)
                          <Tooltip text="Variable cost per process run — e.g. courier fees, contractor day rates, third-party API calls. Multiplied by annual volume to give total." />
                        </label>
                        <input type="number" className="cost-analysis-input" min={0} step={0.5} value={nonLabour.externalPerInstance} onChange={(e) => setNonLabour({ ...nonLabour, externalPerInstance: parseFloat(e.target.value) || 0 })} />
                      </div>
                      <div className="cost-analysis-field">
                        <label>Compliance (£/yr)</label>
                        <input type="number" className="cost-analysis-input" min={0} step={100} value={nonLabour.complianceAnnual} onChange={(e) => setNonLabour({ ...nonLabour, complianceAnnual: parseFloat(e.target.value) || 0 })} />
                      </div>
                    </div>
                  </>
                ),
              },
              {
                id: 'variable',
                label: 'Variable cost drivers',
                content: (
                  <>
                    <div className="cost-variable-header">
                      <p className="cost-analysis-section-desc" style={{ margin: 0 }}>
                        Labour is your key variable cost — it scales with volume. Set the expected savings % per process from automation to quantify the operating leverage opportunity.
                      </p>
                      <div className="cost-ai-suggest-wrap">
                        {aiSuggesting ? (
                          <span className="cost-ai-loading">⟳ Getting AI estimates…</span>
                        ) : (
                          <button
                            type="button"
                            className="cost-ai-refresh-btn"
                            onClick={() => handleAiSuggest(processSavings)}
                            title="Re-run AI estimate for all processes"
                          >
                            Refresh AI estimate
                          </button>
                        )}
                        {aiError && <span className="cost-ai-error">{aiError}</span>}
                      </div>
                    </div>
                    <div className="cost-variable-breakdown">
                      {processBreakdown.map((p, i) => (
                        <div key={i} className="cost-variable-process-card">
                          <div className="cost-variable-process-header">
                            <span className="cost-variable-process-name">{p.name}</span>
                            <span className="cost-variable-process-annual">{formatCurrency(p.annualLabour)}/yr</span>
                          </div>
                          <div className="cost-variable-process-meta">
                            {p.hours}h × {p.annual} runs/yr × {p.teamSize} person(s) @ £{p.avgRate.toFixed(0)}/hr
                          </div>
                          <div className="cost-variable-savings-row">
                            <label>
                              Automation savings %
                              <Tooltip text="% of labour cost eliminable through automation. 30% is conservative; fully automated steps can achieve 60–80%." />
                            </label>
                            <div className="cost-variable-savings-input-wrap">
                              <input
                                type="number"
                                className="cost-analysis-input cost-input-pct"
                                min={0}
                                max={100}
                                step={5}
                                value={p.savingsPct}
                                onChange={(e) => {
                                  const val = Math.min(100, Math.max(0, parseFloat(e.target.value) || 0));
                                  setProcessSavings(prev => ({ ...prev, [i]: val }));
                                  setAiEstimated(prev => ({ ...prev, [i]: false }));
                                }}
                              />
                              <span className="cost-pct-symbol">%</span>
                              <span className="cost-variable-savings-val">= {formatCurrency(p.potentialSavings)}/yr</span>
                              {aiEstimated[i] && (
                                <span className="cost-ai-badge">AI estimate</span>
                              )}
                            </div>
                          </div>
                          {aiReasonings[i] && (
                            <div className={`cost-ai-reasoning cost-ai-reasoning-${aiReasonings[i].confidence}`}>
                              <span className="cost-ai-reasoning-label">{aiEstimated[i] ? `AI estimate · ${aiReasonings[i].confidence} confidence` : `AI suggested (overridden)`}:</span> {aiReasonings[i].reasoning}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    {totalAnnualCost > 0 && (
                      <div className="cost-leverage-callout">
                        <strong>Operating leverage opportunity:</strong> Automating {Math.round(potentialSavings / totalAnnualCost * 100)}% of total cost ({formatCurrency(potentialSavings)}/yr) while maintaining output directly improves margins at scale.
                      </div>
                    )}
                  </>
                ),
              },
            ]}
            defaultTab="labour"
          />

          <div className="cost-analysis-actions">
            <button type="button" className="button button-primary" onClick={handleReview} disabled={saving}>
              Review & submit
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
