'use client';

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import { getSupabaseClient } from '@/lib/supabase';

function fc(val) {
  if (!val && val !== 0) return '£0';
  const n = Number(val);
  if (n < 0) return '-' + fc(-n);
  if (n >= 1_000_000) return '£' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return '£' + (n / 1_000).toFixed(0) + 'K';
  return '£' + Math.round(n);
}

function Tip({ text }) {
  return <span className="cost-tooltip" title={text} aria-label={text}>?</span>;
}

function CollapsibleSection({ title, subtitle, defaultOpen = false, children, badge }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`cost-collapsible${open ? ' open' : ''}`}>
      <button type="button" className="cost-collapsible-header" onClick={() => setOpen(o => !o)}>
        <div className="cost-collapsible-title-row">
          <span className="cost-collapsible-title">{title}</span>
          {badge && <span className="cost-collapsible-badge">{badge}</span>}
        </div>
        {subtitle && <span className="cost-collapsible-subtitle">{subtitle}</span>}
        <svg className={`cost-collapsible-chevron${open ? ' rotated' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && <div className="cost-collapsible-body">{children}</div>}
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

function ProcessCostCard({ p, i, activeScenario, scenarios, aiSuggestionData, processCostDrivers, onSetScenarioPct, onSetDrivers }) {
  const suggestion = aiSuggestionData[i];
  const drivers = processCostDrivers[i] || {};
  const [showDrivers, setShowDrivers] = useState(false);

  const getScenarioPct = useCallback((scenario) => {
    if (scenarios[scenario]?.[i] !== undefined) return scenarios[scenario][i];
    const base = suggestion?.savingsPct ?? p.suggestedBase ?? 30;
    if (scenario === 'conservative') return suggestion?.conservativePct ?? Math.round(base * 0.65);
    if (scenario === 'optimistic') return suggestion?.optimisticPct ?? Math.min(80, Math.round(base * 1.4));
    return base;
  }, [scenarios, i, suggestion, p.suggestedBase]);

  const SCENARIOS = ['conservative', 'base', 'optimistic'];
  const complexityColour = { low: '#059669', medium: '#d97706', high: '#dc2626' };

  return (
    <div className="cost-process-card">
      <div className="cost-process-card-header">
        <div className="cost-process-card-info">
          <span className="cost-process-card-name">{p.name}</span>
          {suggestion?.automationApproach && (
            <span className="cost-automation-approach">{suggestion.automationApproach}</span>
          )}
          {suggestion?.implementationComplexity && (
            <span className="cost-complexity-badge" style={{ color: complexityColour[suggestion.implementationComplexity] }}>
              {suggestion.implementationComplexity} complexity
            </span>
          )}
        </div>
        <div className="cost-process-card-cost">
          <span className="cost-process-card-total">{fc(p.trueAnnualCost)}</span>
          <span className="cost-process-card-unit">/yr true cost</span>
        </div>
      </div>

      {suggestion?.hiddenCostFlags?.length > 0 && (
        <div className="cost-hidden-flags">
          {suggestion.hiddenCostFlags.map((f, fi) => (
            <span key={fi} className="cost-hidden-flag">{f}</span>
          ))}
        </div>
      )}

      <div className="cost-breakdown-grid">
        <div className="cost-breakdown-row">
          <span className="cost-breakdown-label">Direct labour</span>
          <span className="cost-breakdown-amount">{fc(p.annualLabour)}</span>
          {p.trueAnnualCost > 0 && (
            <div className="cost-breakdown-bar-wrap">
              <div className="cost-breakdown-bar-fill" style={{ width: `${Math.round(p.annualLabour / p.trueAnnualCost * 100)}%` }} />
            </div>
          )}
        </div>
        {p.errorCost > 0 && (
          <div className="cost-breakdown-row cost-breakdown-hidden">
            <span className="cost-breakdown-label">Error / rework premium</span>
            <span className="cost-breakdown-amount cost-breakdown-hidden-val">{fc(p.errorCost)}</span>
          </div>
        )}
        {p.waitCost > 0 && (
          <div className="cost-breakdown-row cost-breakdown-hidden">
            <span className="cost-breakdown-label">Wait / idle time cost</span>
            <span className="cost-breakdown-amount cost-breakdown-hidden-val">{fc(p.waitCost)}</span>
          </div>
        )}
        <div className="cost-breakdown-meta">
          {p.hours}h × {p.annual} runs/yr × {p.teamSize} person(s) @ £{p.avgRate.toFixed(0)}/hr (fully loaded)
        </div>
      </div>

      <div className="cost-savings-scenarios">
        <div className="cost-savings-scenarios-label">
          Automation savings
          <Tip text="% of true process cost eliminable through automation. Conservative = reliable floor. Base = expected outcome. Optimistic = upside case." />
        </div>
        <div className="cost-savings-scenarios-grid">
          {SCENARIOS.map(scenario => {
            const pct = getScenarioPct(scenario);
            const savings = p.trueAnnualCost * (pct / 100);
            const isActive = activeScenario === scenario;
            const isAi = scenarios[scenario]?.[i] === undefined && !!suggestion;
            return (
              <div key={scenario} className={`cost-scenario-cell${isActive ? ' active' : ''}`}>
                <div className="cost-scenario-cell-label">
                  {scenario}
                  {isAi && <span className="cost-ai-badge">AI</span>}
                </div>
                <div className="cost-scenario-cell-input">
                  <input
                    type="number"
                    min={0} max={100} step={5}
                    value={pct}
                    onChange={e => {
                      const val = Math.min(100, Math.max(0, parseFloat(e.target.value) || 0));
                      onSetScenarioPct(i, scenario, val);
                    }}
                  />
                  <span className="cost-pct-symbol">%</span>
                </div>
                <div className="cost-scenario-cell-savings">{fc(savings)}/yr</div>
              </div>
            );
          })}
        </div>
      </div>

      {suggestion?.reasoning && (
        <div className={`cost-ai-reasoning cost-ai-reasoning-${suggestion.confidence}`}>
          <span className="cost-ai-reasoning-label">
            AI · {suggestion.confidence} confidence:
          </span>{' '}
          {suggestion.reasoning}
        </div>
      )}

      <button
        type="button"
        className="cost-drivers-toggle"
        onClick={() => setShowDrivers(o => !o)}
      >
        {showDrivers ? '▲ Hide' : '▼ Add hidden cost inputs'} (error rate, wait time)
      </button>

      {showDrivers && (
        <div className="cost-drivers-grid">
          <div className="cost-analysis-field">
            <label>
              Error / rework rate
              <Tip text="% of instances that require rework or correction. E.g. 0.08 = 8%. Each rework event adds ~50% of a normal instance's labour cost." />
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="number"
                className="cost-analysis-input"
                style={{ width: 90 }}
                min={0} max={0.5} step={0.01}
                value={drivers.errorRate ?? 0}
                onChange={e => onSetDrivers(i, 'errorRate', Math.min(0.5, Math.max(0, parseFloat(e.target.value) || 0)))}
                placeholder="0.05"
              />
              <span style={{ fontSize: '0.8rem', color: 'var(--text-light)' }}>
                {drivers.errorRate > 0 ? `→ ${fc(p.annualLabour * (drivers.errorRate || 0) * 0.5)}/yr hidden cost` : 'e.g. 0.08 = 8%'}
              </span>
            </div>
          </div>
          <div className="cost-analysis-field">
            <label>
              Wait / idle time %
              <Tip text="% of labour cost tied up in waiting — for approvals, data, or handoffs. E.g. 0.15 = 15% of cost is idle time." />
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="number"
                className="cost-analysis-input"
                style={{ width: 90 }}
                min={0} max={0.5} step={0.01}
                value={drivers.waitCostPct ?? 0}
                onChange={e => onSetDrivers(i, 'waitCostPct', Math.min(0.5, Math.max(0, parseFloat(e.target.value) || 0)))}
                placeholder="0.15"
              />
              <span style={{ fontSize: '0.8rem', color: 'var(--text-light)' }}>
                {drivers.waitCostPct > 0 ? `→ ${fc(p.annualLabour * (drivers.waitCostPct || 0))}/yr hidden cost` : 'e.g. 0.15 = 15%'}
              </span>
            </div>
          </div>
        </div>
      )}
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
  const [savedFinancials, setSavedFinancials] = useState(null);
  const [shared, setShared] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [validationWarnings, setValidationWarnings] = useState([]);

  // Inputs
  const [labourRates, setLabourRates] = useState([]);
  const [blendedRate, setBlendedRate] = useState(50);
  const [onCostMultiplier, setOnCostMultiplier] = useState(1.25);
  const [nonLabour, setNonLabour] = useState({ externalPerInstance: 0, complianceAnnual: 0 });
  const [systemCosts, setSystemCosts] = useState({});

  // Scenario state
  const [scenarios, setScenarios] = useState({ conservative: {}, base: {}, optimistic: {} });
  const [activeScenario, setActiveScenario] = useState('base');

  // Implementation cost
  const [implementationCost, setImplementationCost] = useState({ platform: 0, setup: 0, training: 0, maintenanceAnnual: 0 });

  // Advanced
  const [processCostDrivers, setProcessCostDrivers] = useState({});
  const [growthRate, setGrowthRate] = useState(0.05);

  // AI
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiSuggestionData, setAiSuggestionData] = useState({});
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
      .then(r => r.json())
      .then(res => {
        if (res.error) throw new Error(res.error);
        if (res.redirectToReport) { setRedirectToReport(true); return; }
        setData(res);

        let draft = null;
        try { draft = draftKey ? JSON.parse(localStorage.getItem(draftKey) || 'null') : null; } catch {}

        const existing = res.existingCostAnalysis;
        const source = draft || existing;

        if (source) {
          setLabourRates((source.labourRates || []).map(r => ({
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
          if (source.nonLabour?.systemCosts) {
            setSystemCosts(source.nonLabour.systemCosts);
          } else if (source.nonLabour?.systemsAnnual > 0) {
            const sysList = res.allSystems || [];
            if (sysList.length > 0) {
              const perSystem = Math.round(source.nonLabour.systemsAnnual / sysList.length);
              const costs = {};
              sysList.forEach(s => { costs[s] = perSystem; });
              setSystemCosts(costs);
            }
          } else {
            const costs = {};
            (res.allSystems || []).forEach(s => { costs[s] = 0; });
            setSystemCosts(costs);
          }
          if (source.scenarios) {
            setScenarios(source.scenarios);
          } else if (source.processSavings) {
            setScenarios({ conservative: {}, base: { ...source.processSavings }, optimistic: {} });
          } else {
            const defaults = {};
            (res.processes || []).forEach((p, i) => { if (p.suggestedSavingsPct) defaults[i] = p.suggestedSavingsPct; });
            setScenarios({ conservative: {}, base: defaults, optimistic: {} });
          }
          if (source.activeScenario) setActiveScenario(source.activeScenario);
          if (source.implementationCost) setImplementationCost({ platform: 0, setup: 0, training: 0, maintenanceAnnual: 0, ...source.implementationCost });
          if (source.processCostDrivers) setProcessCostDrivers(source.processCostDrivers);
          if (typeof source.growthRate === 'number') setGrowthRate(source.growthRate);
        } else {
          const depts = res.departments || ['Default'];
          setLabourRates(depts.map(d => ({ department: d, hourlyRate: 50, utilisation: 0.85 })));
          const costs = {};
          (res.allSystems || []).forEach(s => { costs[s] = 0; });
          setSystemCosts(costs);
          const defaults = {};
          (res.processes || []).forEach((p, i) => { if (p.suggestedSavingsPct) defaults[i] = p.suggestedSavingsPct; });
          setScenarios({ conservative: {}, base: defaults, optimistic: {} });
        }
      })
      .catch(e => setError(e.message || 'Failed to load report.'))
      .finally(() => setLoading(false));
  }, [id, token]);

  // Auto-save draft
  useEffect(() => {
    if (!draftKey || loading || !data) return;
    const draft = {
      labourRates, blendedRate, onCostMultiplier, nonLabour,
      processSavings: scenarios.base,
      scenarios, activeScenario, systemCosts,
      implementationCost, processCostDrivers, growthRate,
      savedAt: Date.now(),
    };
    try { localStorage.setItem(draftKey, JSON.stringify(draft)); } catch {}
  }, [labourRates, blendedRate, onCostMultiplier, nonLabour, scenarios, activeScenario, systemCosts, implementationCost, processCostDrivers, growthRate]);

  const processes = data?.processes || [];

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
      const annualLabour = hours * avgRate * annual * teamSize;

      const drivers = processCostDrivers[i] || {};
      const errorRate = Math.min(0.5, Math.max(0, Number(drivers.errorRate) || 0));
      const waitCostPct = Math.min(0.5, Math.max(0, Number(drivers.waitCostPct) || 0));
      const errorCost = annualLabour * errorRate * 0.5;
      const waitCost = annualLabour * waitCostPct;
      const trueAnnualCost = annualLabour + errorCost + waitCost;

      const ai = aiSuggestionData[i];
      const suggestedBase = p.suggestedSavingsPct ?? 30;

      const getScenarioPct = (scenario) => {
        if (scenarios[scenario]?.[i] !== undefined) return scenarios[scenario][i];
        if (scenario === 'conservative') return ai?.conservativePct ?? Math.round(suggestedBase * 0.65);
        if (scenario === 'optimistic') return ai?.optimisticPct ?? Math.min(80, Math.round(suggestedBase * 1.4));
        return ai?.savingsPct ?? suggestedBase;
      };

      const conservativePct = getScenarioPct('conservative');
      const basePct = getScenarioPct('base');
      const optimisticPct = getScenarioPct('optimistic');
      const activePct = getScenarioPct(activeScenario);

      return {
        name: p.name || `Process ${i + 1}`,
        hours, teamSize, annual, avgRate, annualLabour,
        errorCost, waitCost, trueAnnualCost,
        conservativePct, basePct, optimisticPct, activePct,
        activeSavings: trueAnnualCost * (activePct / 100),
        suggestedBase,
        depts,
      };
    });
  }, [processes, rateByDept, defaultRate, processCostDrivers, scenarios, activeScenario, aiSuggestionData]);

  const totalSystemsCost = useMemo(
    () => Object.values(systemCosts).reduce((sum, v) => sum + (Number(v) || 0), 0),
    [systemCosts]
  );

  const financials = useMemo(() => {
    const totalLabour = processBreakdown.reduce((sum, p) => sum + p.annualLabour, 0);
    const totalHiddenCost = processBreakdown.reduce((sum, p) => sum + p.errorCost + p.waitCost, 0);
    const totalInstances = processes.reduce((sum, p) => sum + ((p.annual ?? 12) * (p.teamSize ?? 1)), 0);
    const externalAnnual = (nonLabour?.externalPerInstance ?? 0) * Math.max(totalInstances, 1);
    const complianceAnnual = nonLabour?.complianceAnnual ?? 0;
    const totalFixed = totalSystemsCost + externalAnnual + complianceAnnual;
    const totalAnnualCost = totalLabour + totalHiddenCost + totalFixed;
    const potentialSavings = processBreakdown.reduce((sum, p) => sum + p.activeSavings, 0);
    const fteEquivalent = potentialSavings > 0 ? +(potentialSavings / (defaultRate * 2080)).toFixed(1) : 0;

    const implTotal = (Number(implementationCost.platform) || 0) + (Number(implementationCost.setup) || 0) + (Number(implementationCost.training) || 0);
    const implMaintenance = Number(implementationCost.maintenanceAnnual) || 0;
    const year1Savings = potentialSavings;
    const year2Savings = year1Savings * (1 + growthRate);
    const year3Savings = year2Savings * (1 + growthRate);
    const year1Net = year1Savings - implTotal - implMaintenance;
    const year2Net = year2Savings - implMaintenance;
    const year3Net = year3Savings - implMaintenance;
    const DISCOUNT = 0.08;
    const npv3yr = Math.round(
      year1Net / (1 + DISCOUNT) +
      year2Net / Math.pow(1 + DISCOUNT, 2) +
      year3Net / Math.pow(1 + DISCOUNT, 3)
    );
    const roi3yr = implTotal > 0 ? Math.round((year1Net + year2Net + year3Net) / implTotal * 100) : null;
    const monthlyNet = (potentialSavings - implMaintenance) / 12;
    const paybackMonths = implTotal > 0 && monthlyNet > 0 ? Math.ceil(implTotal / monthlyNet) : 0;

    return {
      totalLabour, totalHiddenCost, totalFixed, totalAnnualCost,
      potentialSavings, fteEquivalent,
      implTotal, implMaintenance,
      paybackMonths, npv3yr, roi3yr,
      year1Net, year2Net, year3Net,
    };
  }, [processBreakdown, processes, nonLabour, totalSystemsCost, implementationCost, growthRate, defaultRate]);

  const handleSetScenarioPct = useCallback((i, scenario, val) => {
    setScenarios(prev => ({ ...prev, [scenario]: { ...prev[scenario], [i]: val } }));
  }, []);

  const handleSetDrivers = useCallback((i, field, val) => {
    setProcessCostDrivers(prev => ({ ...prev, [i]: { ...(prev[i] || {}), [field]: val } }));
  }, []);

  const handleAiSuggest = useCallback(async () => {
    if (!id || !data) return;
    setAiSuggesting(true);
    setAiError('');
    try {
      const sb = getSupabaseClient();
      const { data: { session } } = await sb.auth.getSession();
      const headers = { 'Content-Type': 'application/json' };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const res = await fetch('/api/cost-analysis/suggest-savings', {
        method: 'POST', headers,
        body: JSON.stringify({ reportId: id, token: token || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'AI estimation failed.');

      const newSuggestions = {};
      const newScenarios = {
        conservative: { ...scenarios.conservative },
        base: { ...scenarios.base },
        optimistic: { ...scenarios.optimistic },
      };
      (json.suggestions || []).forEach(s => {
        newSuggestions[s.processIndex] = s;
        newScenarios.conservative[s.processIndex] = s.conservativePct;
        newScenarios.base[s.processIndex] = s.savingsPct;
        newScenarios.optimistic[s.processIndex] = s.optimisticPct;
      });
      setAiSuggestionData(newSuggestions);
      setScenarios(newScenarios);
    } catch (e) {
      setAiError(e.message || 'AI estimation failed.');
    } finally {
      setAiSuggesting(false);
    }
  }, [id, token, data, scenarios]);

  useEffect(() => {
    if (!data || autoAiFetchedRef.current) return;
    const hasExisting = data.existingCostAnalysis?.processSavings &&
      Object.keys(data.existingCostAnalysis.processSavings).length > 0;
    if (!hasExisting) {
      autoAiFetchedRef.current = true;
      handleAiSuggest();
    }
  }, [data]);

  function validate() {
    const warnings = [];
    const hasAnyRate = labourRates.some(r => r.hourlyRate > 0) || blendedRate > 0;
    if (!hasAnyRate) warnings.push({ type: 'error', msg: 'At least one hourly rate must be greater than £0.' });
    labourRates.forEach(r => {
      if (r.hourlyRate > 0 && r.hourlyRate < 15) warnings.push({ type: 'warn', msg: `${r.department}: rate of £${r.hourlyRate}/hr seems very low.` });
      if (r.hourlyRate > 500) warnings.push({ type: 'warn', msg: `${r.department}: rate of £${r.hourlyRate}/hr is very high.` });
    });
    return warnings;
  }

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
        method: 'POST', headers,
        body: JSON.stringify({
          reportId: id,
          token: token || undefined,
          costAnalysis: {
            labourRates, blendedRate, onCostMultiplier,
            nonLabour: { ...nonLabour, systemCosts, systemsAnnual: totalSystemsCost },
            processSavings: scenarios.base,
            scenarios, activeScenario,
            implementationCost, processCostDrivers, growthRate,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save.');
      try { if (draftKey) localStorage.removeItem(draftKey); } catch {}
      setSavedFinancials(json.financialModel || financials);
      setSaveDone(true);
      setShowReview(false);
    } catch (e) {
      setError(e.message || 'Failed to save cost analysis.');
    } finally {
      setSaving(false);
    }
  }, [id, token, data, labourRates, blendedRate, onCostMultiplier, nonLabour, scenarios, activeScenario, systemCosts, totalSystemsCost, implementationCost, processCostDrivers, growthRate, financials]);

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
        method: 'PATCH', headers,
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

  const hasAiData = Object.keys(aiSuggestionData).length > 0;
  const hasImpl = financials.implTotal > 0;
  const SCENARIO_LABELS = { conservative: 'Conservative', base: 'Base', optimistic: 'Optimistic' };

  // ── Redirect / loading / error states ──────────────────────────────────
  if (redirectToReport) {
    return (
      <div className="report-page" style={{ padding: 40, textAlign: 'center' }}>
        <div className="report-card" style={{ maxWidth: 480, margin: '0 auto' }}>
          <h1 className="report-title">Cost analysis complete</h1>
          <p className="report-subtitle">This report already has a cost analysis. View the full report below.</p>
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
          {!token && <p style={{ marginTop: 12, fontSize: '0.9rem' }}>Use the link provided by the report owner.</p>}
          <Link href="/portal" style={{ color: 'var(--accent)', marginTop: 16, display: 'inline-block' }}>Back to portal</Link>
        </div>
      </div>
    );
  }

  // ── Save done screen ────────────────────────────────────────────────────
  if (saveDone) {
    const fm = savedFinancials || financials;
    return (
      <div className="report-page cost-analysis-page">
        <TopBar id={id} title="Cost analysis — saved" />
        <div className="report-container">
          <div className="report-card">
            <div className="cost-save-done-hero">
              <div className="cost-save-done-icon">✓</div>
              <h2>Cost analysis saved</h2>
              <p>Business case complete. Review the headline metrics below, then decide whether to share with the report owner.</p>
            </div>

            {/* Headline metrics */}
            <div className="cost-save-metrics">
              <div className="cost-save-metric">
                <div className="cost-save-metric-label">Annual process cost</div>
                <div className="cost-save-metric-value">{fc(fm.totalAnnualCost)}</div>
              </div>
              <div className="cost-save-metric cost-save-metric-green">
                <div className="cost-save-metric-label">Savings potential ({activeScenario})</div>
                <div className="cost-save-metric-value">{fc(fm.potentialSavings)}/yr</div>
              </div>
              <div className="cost-save-metric">
                <div className="cost-save-metric-label">FTE equivalent</div>
                <div className="cost-save-metric-value">{fm.fteEquivalent ?? financials.fteEquivalent}</div>
              </div>
              {fm.paybackMonths > 0 && (
                <div className="cost-save-metric">
                  <div className="cost-save-metric-label">Payback period</div>
                  <div className="cost-save-metric-value">{fm.paybackMonths} months</div>
                </div>
              )}
              {fm.roi3yr != null && (
                <div className="cost-save-metric cost-save-metric-green">
                  <div className="cost-save-metric-label">3-year ROI</div>
                  <div className="cost-save-metric-value">{fm.roi3yr}%</div>
                </div>
              )}
              {fm.npv3yr != null && (
                <div className="cost-save-metric">
                  <div className="cost-save-metric-label">3-year NPV (8%)</div>
                  <div className="cost-save-metric-value">{fc(fm.npv3yr)}</div>
                </div>
              )}
            </div>

            <div className="cost-share-card">
              <h3>Share with report owner?</h3>
              <p className="cost-share-desc">
                Cost data includes salary rates and redundancy savings — <strong>confidential by default</strong>. Only share if the owner needs the full breakdown to make a decision.
              </p>
              {shareError && <div className="cost-analysis-error" style={{ marginBottom: 12 }}>{shareError}</div>}
              {shared ? (
                <div className="cost-share-success">Results have been shared with the report owner.</div>
              ) : (
                <div className="cost-share-actions">
                  <button type="button" className="button button-primary" onClick={handleShare} disabled={sharing}>
                    {sharing ? 'Sharing...' : 'Share with owner'}
                  </button>
                  <Link href={`/report?id=${id}`} className="button" style={{ background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)' }}>
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

  // ── Review / business case screen ───────────────────────────────────────
  if (showReview) {
    const hasHiddenCosts = processBreakdown.some(p => p.errorCost > 0 || p.waitCost > 0);
    return (
      <div className="report-page cost-analysis-page">
        <TopBar id={id} title="Cost analysis — review" extra={
          <button type="button" className="top-bar-link" onClick={() => setShowReview(false)}>← Back to edit</button>
        } />
        <div className="report-container">
          <div className="report-card">
            <div className="report-hero">
              <h1 className="report-title">Business case — {SCENARIO_LABELS[activeScenario]} scenario</h1>
              <p className="report-subtitle">Confirm figures before saving. This data is <strong>confidential by default</strong> and will not be visible to the report owner unless you explicitly share it.</p>
            </div>

            {validationWarnings.filter(w => w.type === 'warn').length > 0 && (
              <div className="cost-analysis-warnings">
                {validationWarnings.filter(w => w.type === 'warn').map((w, i) => (
                  <div key={i} className="cost-analysis-warning">⚠ {w.msg}</div>
                ))}
              </div>
            )}
            {error && <div className="cost-analysis-error" style={{ marginBottom: 16 }}>{error}</div>}

            {/* Current state */}
            <div className="cost-bc-section">
              <div className="cost-bc-section-title">Current state — annual process cost</div>
              {processBreakdown.map((p, i) => (
                <div key={i} className="cost-bc-process-row">
                  <div className="cost-bc-process-name">{p.name}</div>
                  <div className="cost-bc-process-detail">
                    <span>{p.hours}h × {p.annual} runs × {p.teamSize} person(s) @ £{p.avgRate.toFixed(0)}/hr</span>
                    <span>Labour: {fc(p.annualLabour)}</span>
                    {p.errorCost > 0 && <span>Error/rework: +{fc(p.errorCost)}</span>}
                    {p.waitCost > 0 && <span>Wait time: +{fc(p.waitCost)}</span>}
                    <span className="cost-bc-process-true">True cost: <strong>{fc(p.trueAnnualCost)}/yr</strong></span>
                  </div>
                </div>
              ))}
              <div className="cost-bc-subtotal-rows">
                <div className="cost-bc-subtotal-row">
                  <span>Total direct labour</span>
                  <span>{fc(financials.totalLabour)}/yr</span>
                </div>
                {financials.totalHiddenCost > 0 && (
                  <div className="cost-bc-subtotal-row cost-bc-subtotal-hidden">
                    <span>Hidden costs (error/rework + wait time)</span>
                    <span>+ {fc(financials.totalHiddenCost)}/yr</span>
                  </div>
                )}
                {financials.totalFixed > 0 && (
                  <div className="cost-bc-subtotal-row">
                    <span>Non-labour (systems, external, compliance)</span>
                    <span>+ {fc(financials.totalFixed)}/yr</span>
                  </div>
                )}
              </div>
              <div className="cost-bc-total-row">
                <span>Total annual cost</span>
                <span className="cost-bc-total-val">{fc(financials.totalAnnualCost)}</span>
              </div>
            </div>

            {/* Automation case */}
            <div className="cost-bc-section">
              <div className="cost-bc-section-title">Automation case — {SCENARIO_LABELS[activeScenario].toLowerCase()} scenario</div>
              {processBreakdown.map((p, i) => (
                <div key={i} className="cost-bc-savings-row">
                  <span className="cost-bc-savings-name">{p.name}</span>
                  <span className="cost-bc-savings-pct">{p.activePct}% savings</span>
                  <span className="cost-bc-savings-val">= {fc(p.activeSavings)}/yr</span>
                  {aiSuggestionData[i]?.automationApproach && (
                    <span className="cost-bc-approach">{aiSuggestionData[i].automationApproach}</span>
                  )}
                </div>
              ))}
              <div className="cost-bc-total-row cost-bc-total-green">
                <span>Total automation savings</span>
                <span className="cost-bc-total-val">{fc(financials.potentialSavings)}/yr</span>
              </div>
              <div className="cost-bc-fte-row">
                FTE equivalent freed: <strong>{financials.fteEquivalent}</strong> FTE
                {financials.fteEquivalent > 0 && <span className="cost-bc-fte-note"> — capacity available for redeployment or growth</span>}
              </div>
              <div className="cost-bc-residual">
                Residual annual cost post-automation: {fc(financials.totalAnnualCost - financials.potentialSavings)}
              </div>
            </div>

            {/* Investment & return */}
            {hasImpl && (
              <div className="cost-bc-section">
                <div className="cost-bc-section-title">Investment & return</div>
                <div className="cost-bc-impl-rows">
                  {implementationCost.platform > 0 && <div className="cost-bc-impl-row"><span>Platform / tooling</span><span>{fc(implementationCost.platform)}</span></div>}
                  {implementationCost.setup > 0 && <div className="cost-bc-impl-row"><span>Setup & build</span><span>{fc(implementationCost.setup)}</span></div>}
                  {implementationCost.training > 0 && <div className="cost-bc-impl-row"><span>Training</span><span>{fc(implementationCost.training)}</span></div>}
                  <div className="cost-bc-impl-row cost-bc-impl-total"><span>Total one-time investment</span><span>{fc(financials.implTotal)}</span></div>
                  {implementationCost.maintenanceAnnual > 0 && <div className="cost-bc-impl-row"><span>Annual maintenance</span><span>{fc(implementationCost.maintenanceAnnual)}/yr</span></div>}
                </div>
                <div className="cost-bc-returns">
                  {financials.paybackMonths > 0 && (
                    <div className="cost-bc-return-metric">
                      <div className="cost-bc-return-label">Payback period</div>
                      <div className="cost-bc-return-val">{financials.paybackMonths} months</div>
                    </div>
                  )}
                  {financials.roi3yr != null && (
                    <div className="cost-bc-return-metric cost-bc-return-highlight">
                      <div className="cost-bc-return-label">3-year ROI</div>
                      <div className="cost-bc-return-val">{financials.roi3yr}%</div>
                    </div>
                  )}
                  <div className="cost-bc-return-metric">
                    <div className="cost-bc-return-label">3-year NPV (8% discount)</div>
                    <div className="cost-bc-return-val">{fc(financials.npv3yr)}</div>
                  </div>
                </div>
                <div className="cost-bc-projection">
                  <div className="cost-bc-projection-title">3-year net benefit projection</div>
                  {[
                    { label: `Year 1 net${growthRate > 0 ? '' : ''}`, val: financials.year1Net },
                    { label: `Year 2 net (+${Math.round(growthRate * 100)}% volume growth)`, val: financials.year2Net },
                    { label: `Year 3 net (+${Math.round(growthRate * 100)}% volume growth)`, val: financials.year3Net },
                  ].map(({ label, val }, yi) => {
                    const maxAbs = Math.max(Math.abs(financials.year1Net), Math.abs(financials.year2Net), Math.abs(financials.year3Net), 1);
                    const pct = Math.abs(val) / maxAbs * 100;
                    return (
                      <div key={yi} className="cost-bc-bar-row">
                        <span className="cost-bc-bar-label">{label}</span>
                        <div className="cost-bc-bar-track">
                          <div
                            className={`cost-bc-bar-fill${val < 0 ? ' negative' : ''}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className={`cost-bc-bar-val${val < 0 ? ' negative' : ''}`}>{fc(val)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

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

  // ── Main form ───────────────────────────────────────────────────────────
  return (
    <div className="report-page cost-analysis-page">
      <TopBar id={id} />
      <div className="report-container">
        <div className="report-card">
          <div className="report-hero">
            <h1 className="report-title">Process cost analysis</h1>
            <p className="report-subtitle">
              Build a complete financial case: true process cost, automation savings by scenario, FTE impact, and ROI.
              Data entered here is <strong>confidential by default</strong> — not visible to the report owner unless you choose to share it.
            </p>
          </div>

          {error && <div className="cost-analysis-error" style={{ marginBottom: 16 }}>{error}</div>}
          {validationWarnings.some(w => w.type === 'error') && (
            <div className="cost-analysis-errors">
              {validationWarnings.filter(w => w.type === 'error').map((w, i) => (
                <div key={i} className="cost-analysis-error">{w.msg}</div>
              ))}
            </div>
          )}

          {/* Scenario selector */}
          <div className="cost-scenario-bar">
            <span className="cost-scenario-bar-label">Viewing scenario:</span>
            {(['conservative', 'base', 'optimistic']).map(s => (
              <button
                key={s}
                type="button"
                className={`cost-scenario-btn${activeScenario === s ? ' active' : ''}`}
                onClick={() => setActiveScenario(s)}
              >
                {SCENARIO_LABELS[s]}
              </button>
            ))}
          </div>

          {/* Live financial summary */}
          <div className="cost-financial-summary">
            <div className="cost-fin-metric">
              <div className="cost-fin-label">Annual process cost</div>
              <div className="cost-fin-value">{fc(financials.totalAnnualCost)}</div>
              {financials.totalHiddenCost > 0 && (
                <div className="cost-fin-sub">incl. {fc(financials.totalHiddenCost)} hidden</div>
              )}
            </div>
            <div className="cost-fin-metric cost-fin-metric-green">
              <div className="cost-fin-label">Savings — {SCENARIO_LABELS[activeScenario]}</div>
              <div className="cost-fin-value">{fc(financials.potentialSavings)}/yr</div>
              {financials.totalAnnualCost > 0 && (
                <div className="cost-fin-sub">{Math.round(financials.potentialSavings / financials.totalAnnualCost * 100)}% of total cost</div>
              )}
            </div>
            <div className="cost-fin-metric">
              <div className="cost-fin-label">FTE equivalent</div>
              <div className="cost-fin-value">{financials.fteEquivalent}</div>
              <div className="cost-fin-sub">people-equivalent freed</div>
            </div>
            {hasImpl ? (
              <>
                <div className="cost-fin-metric">
                  <div className="cost-fin-label">Payback period</div>
                  <div className="cost-fin-value">{financials.paybackMonths > 0 ? `${financials.paybackMonths} mo` : '—'}</div>
                </div>
                <div className="cost-fin-metric">
                  <div className="cost-fin-label">3-year NPV</div>
                  <div className="cost-fin-value">{fc(financials.npv3yr)}</div>
                  <div className="cost-fin-sub">at 8% discount rate</div>
                </div>
                {financials.roi3yr != null && (
                  <div className="cost-fin-metric cost-fin-metric-green">
                    <div className="cost-fin-label">3-year ROI</div>
                    <div className="cost-fin-value">{financials.roi3yr}%</div>
                  </div>
                )}
              </>
            ) : (
              <div className="cost-fin-metric cost-fin-metric-prompt">
                <div className="cost-fin-label">Payback / ROI</div>
                <div className="cost-fin-prompt">Add implementation cost to unlock payback, NPV & ROI</div>
              </div>
            )}
          </div>

          {/* Process cost cards */}
          <div className="cost-section-header">
            <span className="cost-section-title-text">Process cost analysis</span>
            <div className="cost-ai-suggest-wrap">
              {aiSuggesting ? (
                <span className="cost-ai-loading">⟳ Analysing processes…</span>
              ) : (
                <button
                  type="button"
                  className="cost-ai-refresh-btn"
                  onClick={handleAiSuggest}
                  title="Use AI to estimate automation savings across all three scenarios"
                >
                  {hasAiData ? '↺ Refresh AI estimates' : '✦ Get AI estimates'}
                </button>
              )}
              {aiError && <span className="cost-ai-error">{aiError}</span>}
            </div>
          </div>

          {processBreakdown.map((p, i) => (
            <ProcessCostCard
              key={i}
              p={p}
              i={i}
              activeScenario={activeScenario}
              scenarios={scenarios}
              aiSuggestionData={aiSuggestionData}
              processCostDrivers={processCostDrivers}
              onSetScenarioPct={handleSetScenarioPct}
              onSetDrivers={handleSetDrivers}
            />
          ))}

          {/* Labour rates */}
          <CollapsibleSection
            title="Labour rates"
            subtitle="Fully loaded hourly rates by department"
            defaultOpen={true}
          >
            <p className="cost-analysis-section-desc">
              Set the fully loaded hourly cost (including salary, NI, pension, and overhead) per department. Labour is your primary variable cost driver.
            </p>
            <div className="cost-analysis-rates-wrapper">
              {labourRates.map((r, i) => (
                <div key={i} className="cost-analysis-rate-row">
                  <span className="cost-analysis-dept-name">{r.department}</span>
                  <input
                    type="number"
                    className={`cost-analysis-input cost-input-rate${r.hourlyRate > 0 && (r.hourlyRate < 15 || r.hourlyRate > 500) ? ' cost-input-warn' : ''}`}
                    min={10} step={5}
                    value={r.hourlyRate}
                    onChange={e => {
                      const next = [...labourRates];
                      next[i] = { ...next[i], hourlyRate: parseFloat(e.target.value) || 0 };
                      setLabourRates(next);
                    }}
                    placeholder="£/hr"
                  />
                  <span className="cost-label-util">
                    Utilisation
                    <Tip text="Proportion of paid hours spent on this process. 0.85 = 85% productive (industry standard). Accounts for meetings, admin, and downtime." />
                  </span>
                  <input
                    type="number"
                    className="cost-analysis-input cost-input-util"
                    min={0.5} max={1} step={0.05}
                    value={r.utilisation ?? 0.85}
                    onChange={e => {
                      const next = [...labourRates];
                      next[i] = { ...next[i], utilisation: parseFloat(e.target.value) || 0.85 };
                      setLabourRates(next);
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="cost-analysis-form-row" style={{ marginTop: '1.25rem' }}>
              <div className="cost-analysis-field">
                <label>Default blended rate (£/hr)</label>
                <input type="number" className="cost-analysis-input" min={10} step={5} value={blendedRate} onChange={e => setBlendedRate(parseFloat(e.target.value) || 50)} />
              </div>
              <div className="cost-analysis-field">
                <label>
                  On-cost multiplier
                  <Tip text="Multiplies the base rate to cover employer costs: NI, pension, benefits. 1.25 = 25% above the quoted hourly rate. Used when no department-specific rate is set." />
                </label>
                <input type="number" className="cost-analysis-input" min={1} max={2} step={0.05} value={onCostMultiplier} onChange={e => setOnCostMultiplier(parseFloat(e.target.value) || 1.25)} placeholder="1.25" />
              </div>
            </div>
          </CollapsibleSection>

          {/* Non-labour costs */}
          <CollapsibleSection
            title="Non-labour costs"
            subtitle="Systems, external services, and compliance"
            badge={financials.totalFixed > 0 ? fc(financials.totalFixed) + '/yr' : undefined}
          >
            {Object.keys(systemCosts).length > 0 ? (
              <div className="cost-systems-section">
                <p className="cost-analysis-section-desc">Annual licensing cost per system identified in the process steps.</p>
                <div className="cost-systems-grid">
                  {Object.keys(systemCosts).map(sys => (
                    <div key={sys} className="cost-analysis-field cost-system-field">
                      <label className="cost-system-label">{sys}</label>
                      <div className="cost-system-input-wrap">
                        <span className="cost-currency-prefix">£</span>
                        <input
                          type="number"
                          className="cost-analysis-input cost-input-system"
                          min={0} step={100}
                          value={systemCosts[sys] ?? 0}
                          onChange={e => setSystemCosts(prev => ({ ...prev, [sys]: parseFloat(e.target.value) || 0 }))}
                          placeholder="0"
                        />
                        <span className="cost-system-unit">/yr</span>
                      </div>
                    </div>
                  ))}
                </div>
                {totalSystemsCost > 0 && (
                  <div className="cost-systems-total">
                    Total systems cost: <strong>{fc(totalSystemsCost)}/yr</strong>
                  </div>
                )}
              </div>
            ) : (
              <p className="cost-analysis-section-desc" style={{ color: 'var(--text-mid)' }}>No systems identified in the process steps. Systems named during the diagnostic will appear here.</p>
            )}
            <div className="cost-analysis-grid" style={{ marginTop: 16 }}>
              <div className="cost-analysis-field">
                <label>
                  External cost per instance (£)
                  <Tip text="Variable cost per process run — e.g. courier fees, contractor rates, third-party API calls. Multiplied by annual volume." />
                </label>
                <input type="number" className="cost-analysis-input" min={0} step={0.5} value={nonLabour.externalPerInstance} onChange={e => setNonLabour({ ...nonLabour, externalPerInstance: parseFloat(e.target.value) || 0 })} />
              </div>
              <div className="cost-analysis-field">
                <label>Compliance & audit (£/yr)</label>
                <input type="number" className="cost-analysis-input" min={0} step={100} value={nonLabour.complianceAnnual} onChange={e => setNonLabour({ ...nonLabour, complianceAnnual: parseFloat(e.target.value) || 0 })} />
              </div>
            </div>
          </CollapsibleSection>

          {/* Implementation investment */}
          <CollapsibleSection
            title="Implementation investment"
            subtitle="Platform, build, and maintenance costs — unlocks payback, NPV & ROI"
            badge={hasImpl ? fc(financials.implTotal) + ' one-time' : 'Optional'}
          >
            <p className="cost-analysis-section-desc">
              Enter expected automation investment costs to calculate payback period, 3-year NPV, and ROI. Leave at £0 if not yet scoped.
            </p>
            <div className="cost-impl-grid">
              {[
                { key: 'platform', label: 'Platform / tooling licence', tip: 'Annual or one-time cost of the automation platform (e.g. Power Automate, Zapier, Make, Workato).' },
                { key: 'setup', label: 'Setup & build cost', tip: 'One-time cost to design, build, and deploy the automation — includes developer or consultant time.' },
                { key: 'training', label: 'Training & change management', tip: 'Cost to train staff and manage the transition to the automated process.' },
                { key: 'maintenanceAnnual', label: 'Annual maintenance (£/yr)', tip: 'Ongoing cost to maintain, update, and support the automation post-launch.' },
              ].map(({ key, label, tip }) => (
                <div key={key} className="cost-analysis-field">
                  <label>
                    {label}
                    <Tip text={tip} />
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-light)' }}>£</span>
                    <input
                      type="number"
                      className="cost-analysis-input"
                      style={{ width: 140 }}
                      min={0} step={500}
                      value={implementationCost[key] || 0}
                      onChange={e => setImplementationCost(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                      placeholder="0"
                    />
                  </div>
                </div>
              ))}
            </div>

            {hasImpl && (
              <div className="cost-impl-metrics">
                <div className="cost-impl-metric">
                  <div className="cost-impl-metric-label">Payback period</div>
                  <div className="cost-impl-metric-val">{financials.paybackMonths > 0 ? `${financials.paybackMonths} months` : '—'}</div>
                </div>
                <div className="cost-impl-metric cost-impl-metric-highlight">
                  <div className="cost-impl-metric-label">3-year ROI</div>
                  <div className="cost-impl-metric-val">{financials.roi3yr != null ? `${financials.roi3yr}%` : '—'}</div>
                </div>
                <div className="cost-impl-metric">
                  <div className="cost-impl-metric-label">3-year NPV (8%)</div>
                  <div className="cost-impl-metric-val">{fc(financials.npv3yr)}</div>
                </div>
                <div className="cost-impl-metric">
                  <div className="cost-impl-metric-label">Year 1 net</div>
                  <div className={`cost-impl-metric-val${financials.year1Net < 0 ? ' negative' : ''}`}>{fc(financials.year1Net)}</div>
                </div>
                <div className="cost-impl-metric">
                  <div className="cost-impl-metric-label">Year 2 net</div>
                  <div className={`cost-impl-metric-val${financials.year2Net < 0 ? ' negative' : ''}`}>{fc(financials.year2Net)}</div>
                </div>
                <div className="cost-impl-metric">
                  <div className="cost-impl-metric-label">Year 3 net</div>
                  <div className={`cost-impl-metric-val${financials.year3Net < 0 ? ' negative' : ''}`}>{fc(financials.year3Net)}</div>
                </div>
              </div>
            )}
          </CollapsibleSection>

          {/* Advanced assumptions */}
          <CollapsibleSection
            title="Advanced assumptions"
            subtitle="Growth rate and hidden cost inputs"
          >
            <div className="cost-analysis-section-desc">
              These inputs refine the model but are optional. The growth rate affects multi-year projections; hidden cost inputs expose error and wait-time costs not captured in direct labour.
            </div>
            <div className="cost-analysis-field" style={{ marginBottom: '1.25rem' }}>
              <label>
                Annual volume growth rate
                <Tip text="Expected annual increase in process volume. 0.05 = 5% growth per year. Used to project Year 2 and Year 3 savings." />
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="number"
                  className="cost-analysis-input"
                  style={{ width: 100 }}
                  min={0} max={0.5} step={0.01}
                  value={growthRate}
                  onChange={e => setGrowthRate(Math.min(0.5, Math.max(0, parseFloat(e.target.value) || 0)))}
                  placeholder="0.05"
                />
                <span style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>{Math.round(growthRate * 100)}% per year</span>
              </div>
            </div>
            <p className="cost-analysis-section-desc" style={{ marginTop: 0 }}>
              To add error/rework rate or wait-time % per process, expand the &quot;Add hidden cost inputs&quot; section within each process card above.
            </p>
          </CollapsibleSection>

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
