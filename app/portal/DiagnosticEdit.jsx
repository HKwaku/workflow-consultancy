'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

const PHASES = [
  { key: 'define', label: 'Define' },
  { key: 'measure', label: 'Measure' },
  { key: 'map', label: 'Map' },
  { key: 'assess', label: 'Assess' },
  { key: 'quantify', label: 'Quantify' },
  { key: 'details', label: 'Your Details' },
];

const DEPARTMENTS = ['Sales', 'Operations', 'Finance', 'IT', 'Customer Success', 'Product', 'Leadership', 'HR'];

const HANDOFF_METHODS = [
  { value: 'email-details', label: 'Email with full details' },
  { value: 'email-check', label: 'Email — just a heads up' },
  { value: 'slack', label: 'Slack / Teams message' },
  { value: 'spreadsheet', label: 'Shared spreadsheet' },
  { value: 'in-person', label: 'In-person / call' },
  { value: 'verbal', label: 'Verbal / informal' },
  { value: 'they-knew', label: 'They just knew' },
  { value: 'other', label: 'Other' },
];

const CLARITY_OPTIONS = [
  { value: 'no', label: 'No confusion' },
  { value: 'yes-once', label: 'Yes — needed one clarification' },
  { value: 'yes-multiple', label: 'Yes — back and forth' },
  { value: 'yes-major', label: 'Yes — caused a major delay' },
];

const ISSUE_OPTIONS = [
  { value: 'approval-delay', label: 'Waiting for approval' },
  { value: 'slow-response', label: 'Slow response from someone' },
  { value: 'missing-info', label: 'Missing information' },
  { value: 'wrong-person', label: 'Sent to wrong person' },
  { value: 'system-issues', label: 'System / tool issues' },
  { value: 'unavailable', label: 'Key person unavailable' },
  { value: 'escalation', label: 'Needed escalation' },
  { value: 'external', label: 'Waiting on external party' },
  { value: 'rework', label: 'Had to redo work' },
  { value: 'unclear-process', label: 'Unclear next step' },
];

const FREQUENCY_OPTIONS = [
  { value: 'multi-daily', label: 'Multiple times per day', annual: 750 },
  { value: 'daily', label: 'Once per day', annual: 250 },
  { value: '2-3-week', label: '2–3 times per week', annual: 130 },
  { value: 'weekly', label: 'Once per week', annual: 52 },
  { value: '2-3-month', label: '2–3 times per month', annual: 30 },
  { value: 'monthly', label: 'Once per month', annual: 12 },
  { value: 'less', label: 'Less than monthly', annual: 6 },
];

const INDUSTRIES = [
  'Financial Services', 'Healthcare', 'Technology', 'Manufacturing', 'Retail',
  'Professional Services', 'Education', 'Government', 'Non-profit', 'Real Estate',
  'Construction', 'Media & Entertainment', 'Logistics & Supply Chain', 'Energy', 'Other',
];

export default function DiagnosticEdit({ reportId, email, onBack }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [report, setReport] = useState(null);
  const [activePhase, setActivePhase] = useState('define');
  const [activeProcessIdx, setActiveProcessIdx] = useState(0);

  const [processes, setProcesses] = useState([]);
  const [contact, setContact] = useState({ name: '', email: '', company: '', title: '', teamSize: '', industry: '', phone: '' });

  useEffect(() => {
    if (!reportId) { setError('No report ID.'); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`/api/get-diagnostic?id=${encodeURIComponent(reportId)}`);
        const data = await resp.json();
        if (cancelled) return;
        if (!resp.ok || !data.success) { setError(data.error || 'Failed to load report.'); setLoading(false); return; }

        const r = data.report;
        const dd = r.diagnosticData || {};
        const c = dd.contact || {};
        const raw = dd.rawProcesses || [];
        const procs = dd.processes || [];

        setReport(r);
        setContact({
          name: r.contactName || c.name || '',
          email: r.contactEmail || c.email || '',
          company: r.company || c.company || '',
          title: c.title || '',
          teamSize: c.teamSize || '',
          industry: c.industry || '',
          phone: c.phone || '',
        });

        const builtProcesses = raw.length > 0
          ? raw.map((rp, i) => buildProcessFromRaw(rp, i))
          : procs.map((p, i) => buildProcessFromSummary(p, i));

        setProcesses(builtProcesses.length > 0 ? builtProcesses : [createEmptyProcess(0)]);
      } catch {
        if (!cancelled) setError('Network error. Could not load report.');
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [reportId]);

  function buildProcessFromRaw(rp, idx) {
    const def = rp.definition || {};
    const ex = rp.lastExample || {};
    const ut = rp.userTime || {};
    const freq = rp.frequency || {};
    const costs = rp.costs || {};
    const know = rp.knowledge || {};
    const hire = rp.newHire || {};
    const steps = (rp.steps || []).map((s, si) => ({
      _key: si,
      name: s.name || '',
      department: s.department || '',
      isDecision: !!s.isDecision,
      isExternal: !!s.isExternal,
      branches: s.branches || [],
    }));

    const handoffs = (rp.handoffs || []).map((h, hi) => ({
      _key: hi,
      fromStep: h.from?.name || '',
      toStep: h.to?.name || '',
      method: h.method || '',
      methodOther: h.methodOther || '',
      clarity: h.clarity || 'no',
    }));

    const stepHandoffs = steps.map((step, si) => {
      if (si >= steps.length - 1) return null;
      const existing = handoffs.find(h =>
        h.fromStep === step.name || handoffs.indexOf(h) === si
      ) || handoffs[si] || null;
      return existing || { _key: si, fromStep: step.name, toStep: steps[si + 1]?.name || '', method: '', methodOther: '', clarity: 'no' };
    });

    return {
      _key: idx,
      processName: rp.processName || '',
      processType: rp.processType || '',
      startsWhen: def.startsWhen || '',
      completesWhen: def.completesWhen || '',
      complexity: def.complexity || '',
      departments: def.departments || [],
      exampleName: ex.name || '',
      startDate: ex.startDate || '',
      endDate: ex.endDate || '',
      elapsedDays: ex.elapsedDays || 0,
      userTime: { meetings: ut.meetings || '', emails: ut.emails || '', execution: ut.execution || '', waiting: ut.waiting || '' },
      timeAccuracy: rp.timeAccuracy || 'confident',
      performance: rp.performance || 'typical',
      issues: rp.issues || [],
      biggestDelay: rp.biggestDelay || '',
      delayDetails: rp.delayDetails || '',
      steps,
      stepHandoffs,
      systems: (rp.systems || []).map((sys, si) => ({ _key: si, name: sys.name || '', purpose: sys.purpose || '', actions: sys.actions || [] })),
      approvals: (rp.approvals || []).map((a, ai) => ({ _key: ai, name: a.name || '', who: a.who || '', assessment: a.assessment || 'just-right' })),
      knowledge: {
        source: know.source || know.knowledgeFirst || '',
        askWho: know.askWho || '',
        personType: know.personType || '',
        vacationImpact: know.vacationImpact || '',
      },
      newHire: {
        learningMethod: hire.learningMethod || [],
        timeToCompetence: hire.timeToCompetence || '',
      },
      frequencyType: freq.type || 'monthly',
      annualInstances: freq.annual || 12,
      inFlight: freq.inFlight || 0,
      stuck: freq.stuck || 0,
      waiting: freq.waiting || 0,
      hourlyRate: costs.hourlyRate || 50,
      teamSize: costs.teamSize || 1,
      priority: rp.priority?.level || '',
      priorityReason: rp.priority?.reason || '',
    };
  }

  function buildProcessFromSummary(p, idx) {
    const proc = createEmptyProcess(idx);
    proc.processName = p.name || '';
    proc.processType = p.type || '';
    proc.elapsedDays = p.elapsedDays || 0;
    proc.teamSize = p.teamSize || 1;
    proc.steps = (p.steps || []).map((s, si) => ({
      _key: si, name: s.name || '', department: s.department || '',
      isDecision: !!s.isDecision, isExternal: !!s.isExternal, branches: [],
    }));
    proc.stepHandoffs = proc.steps.map((_, si) =>
      si < proc.steps.length - 1
        ? { _key: si, fromStep: '', toStep: '', method: '', methodOther: '', clarity: 'no' }
        : null
    );
    return proc;
  }

  function createEmptyProcess(idx) {
    return {
      _key: idx,
      processName: '', processType: '', startsWhen: '', completesWhen: '',
      complexity: '', departments: [], exampleName: '', startDate: '', endDate: '',
      elapsedDays: 0,
      userTime: { meetings: '', emails: '', execution: '', waiting: '' },
      timeAccuracy: 'confident', performance: 'typical', issues: [], biggestDelay: '', delayDetails: '',
      steps: [], stepHandoffs: [],
      systems: [], approvals: [],
      knowledge: { source: '', askWho: '', personType: '', vacationImpact: '' },
      newHire: { learningMethod: [], timeToCompetence: '' },
      frequencyType: 'monthly', annualInstances: 12, inFlight: 0, stuck: 0, waiting: 0,
      hourlyRate: 50, teamSize: 1, priority: '', priorityReason: '',
    };
  }

  const proc = processes[activeProcessIdx] || processes[0];

  const updateProc = useCallback((field, val) => {
    setProcesses(prev => prev.map((p, i) => i === activeProcessIdx ? { ...p, [field]: val } : p));
  }, [activeProcessIdx]);

  const updateNestedProc = useCallback((parent, field, val) => {
    setProcesses(prev => prev.map((p, i) => {
      if (i !== activeProcessIdx) return p;
      return { ...p, [parent]: { ...p[parent], [field]: val } };
    }));
  }, [activeProcessIdx]);

  const updateStep = (si, field, val) => {
    setProcesses(prev => prev.map((p, i) => {
      if (i !== activeProcessIdx) return p;
      const newSteps = p.steps.map((s, j) => j === si ? { ...s, [field]: val } : s);
      return { ...p, steps: newSteps };
    }));
  };

  const updateHandoff = (si, field, val) => {
    setProcesses(prev => prev.map((p, i) => {
      if (i !== activeProcessIdx) return p;
      const newH = [...(p.stepHandoffs || [])];
      while (newH.length <= si) newH.push({ _key: newH.length, fromStep: '', toStep: '', method: '', methodOther: '', clarity: 'no' });
      newH[si] = { ...newH[si], [field]: val };
      return { ...p, stepHandoffs: newH };
    }));
  };

  const addStep = () => {
    setProcesses(prev => prev.map((p, i) => {
      if (i !== activeProcessIdx) return p;
      const newSteps = [...p.steps, { _key: Date.now(), name: '', department: '', isDecision: false, isExternal: false, branches: [] }];
      const newH = [...(p.stepHandoffs || [])];
      if (p.steps.length > 0) {
        newH.push({ _key: Date.now(), fromStep: p.steps[p.steps.length - 1]?.name || '', toStep: '', method: '', methodOther: '', clarity: 'no' });
      }
      return { ...p, steps: newSteps, stepHandoffs: newH };
    }));
  };

  const removeStep = (si) => {
    setProcesses(prev => prev.map((p, i) => {
      if (i !== activeProcessIdx) return p;
      const newSteps = p.steps.filter((_, j) => j !== si);
      const newH = (p.stepHandoffs || []).filter((_, j) => j !== si && j !== si - 1)
        .map((h, j) => ({ ...h, _key: j }));
      return { ...p, steps: newSteps, stepHandoffs: newH };
    }));
  };

  const addSystem = () => {
    setProcesses(prev => prev.map((p, i) => {
      if (i !== activeProcessIdx) return p;
      return { ...p, systems: [...p.systems, { _key: Date.now(), name: '', purpose: '', actions: [] }] };
    }));
  };

  const removeSystem = (si) => {
    setProcesses(prev => prev.map((p, i) => {
      if (i !== activeProcessIdx) return p;
      return { ...p, systems: p.systems.filter((_, j) => j !== si) };
    }));
  };

  const updateSystem = (si, field, val) => {
    setProcesses(prev => prev.map((p, i) => {
      if (i !== activeProcessIdx) return p;
      return { ...p, systems: p.systems.map((s, j) => j === si ? { ...s, [field]: val } : s) };
    }));
  };

  const addApproval = () => {
    setProcesses(prev => prev.map((p, i) => {
      if (i !== activeProcessIdx) return p;
      return { ...p, approvals: [...p.approvals, { _key: Date.now(), name: '', who: '', assessment: 'just-right' }] };
    }));
  };

  const removeApproval = (ai) => {
    setProcesses(prev => prev.map((p, i) => {
      if (i !== activeProcessIdx) return p;
      return { ...p, approvals: p.approvals.filter((_, j) => j !== ai) };
    }));
  };

  const updateApproval = (ai, field, val) => {
    setProcesses(prev => prev.map((p, i) => {
      if (i !== activeProcessIdx) return p;
      return { ...p, approvals: p.approvals.map((a, j) => j === ai ? { ...a, [field]: val } : a) };
    }));
  };

  const toggleDept = (dept) => {
    const current = proc.departments || [];
    updateProc('departments', current.includes(dept) ? current.filter(d => d !== dept) : [...current, dept]);
  };

  const toggleIssue = (issue) => {
    const current = proc.issues || [];
    updateProc('issues', current.includes(issue) ? current.filter(i => i !== issue) : [...current, issue]);
  };

  const handleSave = useCallback(async () => {
    setSaving(true); setError(null); setSuccess(null);
    try {
      const rawProcesses = processes.map(p => ({
        processName: p.processName,
        processType: p.processType,
        definition: { startsWhen: p.startsWhen, completesWhen: p.completesWhen, complexity: p.complexity, departments: p.departments },
        lastExample: { name: p.exampleName, startDate: p.startDate, endDate: p.endDate, elapsedDays: p.elapsedDays },
        userTime: p.userTime,
        timeAccuracy: p.timeAccuracy,
        performance: p.performance,
        issues: p.issues,
        biggestDelay: p.biggestDelay,
        delayDetails: p.delayDetails,
        steps: p.steps.map((s, si) => ({ number: si + 1, name: s.name, department: s.department, isDecision: s.isDecision, isExternal: s.isExternal, branches: s.branches || [] })),
        handoffs: (p.stepHandoffs || []).filter(Boolean).map((h, hi) => ({
          from: { name: p.steps[hi]?.name || '', department: p.steps[hi]?.department || '' },
          to: { name: p.steps[hi + 1]?.name || '', department: p.steps[hi + 1]?.department || '' },
          method: h.method,
          clarity: h.clarity,
        })),
        systems: p.systems.map(s => ({ name: s.name, purpose: s.purpose, actions: s.actions })),
        approvals: p.approvals.map(a => ({ name: a.name, who: a.who, assessment: a.assessment })),
        knowledge: p.knowledge,
        newHire: p.newHire,
        frequency: { type: p.frequencyType, annual: p.annualInstances, inFlight: p.inFlight, stuck: p.stuck, waiting: p.waiting },
        costs: { hourlyRate: p.hourlyRate, teamSize: p.teamSize },
        priority: { level: p.priority, reason: p.priorityReason },
      }));

      const summaryProcesses = processes.map(p => ({
        name: p.processName, type: p.processType, elapsedDays: p.elapsedDays,
        annualCost: 0, teamSize: p.teamSize,
        stepsCount: p.steps.length,
        steps: p.steps.map((s, si) => ({ number: si + 1, name: s.name, department: s.department, isDecision: s.isDecision, isExternal: s.isExternal })),
      }));

      const updates = {
        contactName: contact.name,
        contactEmail: contact.email,
        company: contact.company,
        contact,
        rawProcesses,
        processes: summaryProcesses,
      };

      const resp = await fetch('/api/update-diagnostic', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, email, updates }),
      });
      const data = await resp.json();
      if (resp.ok && data.success) {
        setSuccess('Changes saved successfully.');
        setTimeout(() => setSuccess(null), 4000);
      } else {
        setError(data.error || 'Failed to save changes.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [reportId, email, contact, processes]);

  if (loading) return (
    <div className="loading-state" style={{ padding: 60 }}>
      <div className="spinner" />
      <p>Loading diagnostic data...</p>
    </div>
  );

  return (
    <>
      <header className="dashboard-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Link href="/" className="header-logo">Sharpin<span style={{ color: 'var(--gold)' }}>.</span></Link>
          <div className="header-divider" />
          <span className="header-title">Edit Diagnostic</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" className="edit-save-btn" onClick={handleSave} disabled={saving} style={{ padding: '6px 18px', fontSize: '0.78rem' }}>
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button type="button" onClick={onBack} className="header-btn">&larr; Dashboard</button>
        </div>
      </header>

      <div className="portal-wrap edit-wrap">
        {error && <div className="edit-banner edit-banner-error">{error}</div>}
        {success && <div className="edit-banner edit-banner-success">{success}</div>}

        {/* Process tabs */}
        {processes.length > 1 && (
          <div className="edit-proc-tabs">
            {processes.map((p, i) => (
              <button key={p._key ?? i} type="button" className={`edit-proc-tab${i === activeProcessIdx ? ' active' : ''}`} onClick={() => setActiveProcessIdx(i)}>
                {p.processName || `Process ${i + 1}`}
              </button>
            ))}
          </div>
        )}

        {/* Phase navigation */}
        <div className="edit-phases">
          {PHASES.map(ph => (
            <button key={ph.key} type="button" className={`edit-phase${activePhase === ph.key ? ' active' : ''}`} onClick={() => setActivePhase(ph.key)}>
              {ph.label}
            </button>
          ))}
        </div>

        {/* ─── DEFINE PHASE ─── */}
        {activePhase === 'define' && proc && (
          <div className="edit-stage fade-in">
            <div className="edit-stage-card">
              <h3 className="edit-stage-title">Process Identity</h3>
              <p className="edit-stage-desc">What process are you analysing?</p>
              <div className="edit-grid-2">
                <div className="edit-field">
                  <label>Process Name</label>
                  <input type="text" value={proc.processName} onChange={e => updateProc('processName', e.target.value)} placeholder="e.g. Invoice Approval" />
                </div>
                <div className="edit-field">
                  <label>Process Type</label>
                  <input type="text" value={proc.processType} onChange={e => updateProc('processType', e.target.value)} placeholder="e.g. approval-workflow" />
                </div>
              </div>
            </div>

            <div className="edit-stage-card">
              <h3 className="edit-stage-title">Process Boundaries</h3>
              <p className="edit-stage-desc">Where does this process start and end?</p>
              <div className="edit-grid-2">
                <div className="edit-field">
                  <label>Starts When</label>
                  <input type="text" value={proc.startsWhen} onChange={e => updateProc('startsWhen', e.target.value)} placeholder="e.g. Customer submits request" />
                </div>
                <div className="edit-field">
                  <label>Completes When</label>
                  <input type="text" value={proc.completesWhen} onChange={e => updateProc('completesWhen', e.target.value)} placeholder="e.g. Customer receives confirmation" />
                </div>
              </div>
              <div className="edit-field" style={{ marginTop: 16 }}>
                <label>Departments Involved</label>
                <div className="edit-chip-group">
                  {DEPARTMENTS.map(d => (
                    <button key={d} type="button" className={`edit-chip${(proc.departments || []).includes(d) ? ' active' : ''}`} onClick={() => toggleDept(d)}>{d}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── MEASURE PHASE ─── */}
        {activePhase === 'measure' && proc && (
          <div className="edit-stage fade-in">
            <div className="edit-stage-card">
              <h3 className="edit-stage-title">Last Real Example</h3>
              <p className="edit-stage-desc">Think of the last time this process ran.</p>
              <div className="edit-grid-3">
                <div className="edit-field">
                  <label>What Was It?</label>
                  <input type="text" value={proc.exampleName} onChange={e => updateProc('exampleName', e.target.value)} placeholder="e.g. Acme Corp onboarding" />
                </div>
                <div className="edit-field">
                  <label>Start Date</label>
                  <input type="date" value={proc.startDate} onChange={e => updateProc('startDate', e.target.value)} />
                </div>
                <div className="edit-field">
                  <label>End Date</label>
                  <input type="date" value={proc.endDate} onChange={e => updateProc('endDate', e.target.value)} />
                </div>
              </div>
            </div>

            <div className="edit-stage-card">
              <h3 className="edit-stage-title">Your Time Investment</h3>
              <p className="edit-stage-desc">Roughly how much of your time went into this?</p>
              <div className="edit-grid-2">
                <div className="edit-field">
                  <label>Hours in Meetings</label>
                  <input type="number" value={proc.userTime.meetings} onChange={e => updateNestedProc('userTime', 'meetings', e.target.value)} min={0} placeholder="0" />
                </div>
                <div className="edit-field">
                  <label>Hours on Emails</label>
                  <input type="number" value={proc.userTime.emails} onChange={e => updateNestedProc('userTime', 'emails', e.target.value)} min={0} placeholder="0" />
                </div>
                <div className="edit-field">
                  <label>Hours of Execution</label>
                  <input type="number" value={proc.userTime.execution} onChange={e => updateNestedProc('userTime', 'execution', e.target.value)} min={0} placeholder="0" />
                </div>
                <div className="edit-field">
                  <label>Hours Waiting</label>
                  <input type="number" value={proc.userTime.waiting} onChange={e => updateNestedProc('userTime', 'waiting', e.target.value)} min={0} placeholder="0" />
                </div>
              </div>
            </div>

            <div className="edit-stage-card">
              <h3 className="edit-stage-title">Performance</h3>
              <p className="edit-stage-desc">How did that example compare to normal?</p>
              <div className="edit-radio-group">
                {[['Much faster', 'faster'], ['Typical', 'typical'], ['Slower than usual', 'slower'], ['Way longer', 'way-longer']].map(([label, val]) => (
                  <label key={val} className={`edit-radio-card${proc.performance === val ? ' active' : ''}`}>
                    <input type="radio" name="performance" value={val} checked={proc.performance === val} onChange={() => updateProc('performance', val)} />
                    {label}
                  </label>
                ))}
              </div>
              {(proc.performance === 'slower' || proc.performance === 'way-longer') && (
                <div style={{ marginTop: 16 }}>
                  <div className="edit-field">
                    <label>What Went Wrong?</label>
                    <div className="edit-chip-group">
                      {ISSUE_OPTIONS.map(o => (
                        <button key={o.value} type="button" className={`edit-chip${(proc.issues || []).includes(o.value) ? ' active' : ''}`} onClick={() => toggleIssue(o.value)}>{o.label}</button>
                      ))}
                    </div>
                  </div>
                  <div className="edit-field" style={{ marginTop: 12 }}>
                    <label>Describe the Delay</label>
                    <textarea value={proc.delayDetails} onChange={e => updateProc('delayDetails', e.target.value)} placeholder="What happened?" rows={2} maxLength={200} />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── MAP PHASE (Steps + Handoffs integrated) ─── */}
        {activePhase === 'map' && proc && (
          <div className="edit-stage fade-in">
            <div className="edit-stage-card">
              <h3 className="edit-stage-title">Steps &amp; Handoffs</h3>
              <p className="edit-stage-desc">Define each step and how it hands over to the next.</p>

              {proc.steps.map((step, si) => (
                <div key={step._key ?? si} className="edit-step-block">
                  <div className="edit-step-main">
                    <span className="edit-step-num">{si + 1}</span>
                    <div className="edit-step-fields">
                      <input type="text" value={step.name} onChange={e => updateStep(si, 'name', e.target.value)} placeholder="Step name" className="edit-step-name-input" />
                      <select value={step.department} onChange={e => updateStep(si, 'department', e.target.value)} className="edit-step-dept-select">
                        <option value="">Department</option>
                        {[...DEPARTMENTS, ...(proc.departments || []).filter(d => !DEPARTMENTS.includes(d))].map(d => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                      <div className="edit-step-toggles">
                        <label className="edit-step-check">
                          <input type="checkbox" checked={step.isDecision} onChange={e => updateStep(si, 'isDecision', e.target.checked)} /> Decision
                        </label>
                        <label className="edit-step-check">
                          <input type="checkbox" checked={step.isExternal} onChange={e => updateStep(si, 'isExternal', e.target.checked)} /> External
                        </label>
                      </div>
                    </div>
                    <button type="button" className="edit-step-remove" onClick={() => removeStep(si)} title="Remove step">&times;</button>
                  </div>

                  {si < proc.steps.length - 1 && (
                    <div className="edit-handoff-row">
                      <div className="edit-handoff-connector">
                        <span className="edit-handoff-line" />
                        <span className="edit-handoff-label">Handoff to Step {si + 2}</span>
                      </div>
                      <div className="edit-handoff-fields">
                        <select value={(proc.stepHandoffs || [])[si]?.method || ''} onChange={e => updateHandoff(si, 'method', e.target.value)} className="edit-handoff-select">
                          <option value="">How is this handed over?</option>
                          {HANDOFF_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                        <select value={(proc.stepHandoffs || [])[si]?.clarity || 'no'} onChange={e => updateHandoff(si, 'clarity', e.target.value)} className="edit-handoff-select">
                          {CLARITY_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              <button type="button" className="edit-add-btn" onClick={addStep}>+ Add Step</button>
            </div>
          </div>
        )}

        {/* ─── ASSESS PHASE ─── */}
        {activePhase === 'assess' && proc && (
          <div className="edit-stage fade-in">
            <div className="edit-stage-card">
              <h3 className="edit-stage-title">Systems &amp; Tools</h3>
              <p className="edit-stage-desc">What systems are used in this process?</p>
              {proc.systems.map((sys, si) => (
                <div key={sys._key ?? si} className="edit-system-row">
                  <div className="edit-grid-2">
                    <div className="edit-field">
                      <label>System Name</label>
                      <input type="text" value={sys.name} onChange={e => updateSystem(si, 'name', e.target.value)} placeholder="e.g. Salesforce" />
                    </div>
                    <div className="edit-field">
                      <label>Purpose</label>
                      <input type="text" value={sys.purpose} onChange={e => updateSystem(si, 'purpose', e.target.value)} placeholder="What is it used for?" />
                    </div>
                  </div>
                  <div className="edit-system-actions">
                    {['read', 'copy-out', 'copy-in', 'reconcile'].map(action => (
                      <label key={action} className="edit-step-check">
                        <input type="checkbox" checked={(sys.actions || []).includes(action)} onChange={e => {
                          const cur = sys.actions || [];
                          updateSystem(si, 'actions', e.target.checked ? [...cur, action] : cur.filter(a => a !== action));
                        }} /> {action}
                      </label>
                    ))}
                    <button type="button" className="edit-step-remove" onClick={() => removeSystem(si)}>&times;</button>
                  </div>
                </div>
              ))}
              <button type="button" className="edit-add-btn" onClick={addSystem}>+ Add System</button>
            </div>

            <div className="edit-stage-card">
              <h3 className="edit-stage-title">Approvals &amp; Decisions</h3>
              <p className="edit-stage-desc">What formal approvals does this process require?</p>
              {proc.approvals.map((ap, ai) => (
                <div key={ap._key ?? ai} className="edit-approval-row">
                  <div className="edit-grid-3">
                    <div className="edit-field">
                      <label>Approval Name</label>
                      <input type="text" value={ap.name} onChange={e => updateApproval(ai, 'name', e.target.value)} placeholder="e.g. Budget sign-off" />
                    </div>
                    <div className="edit-field">
                      <label>Who Approves?</label>
                      <input type="text" value={ap.who} onChange={e => updateApproval(ai, 'who', e.target.value)} placeholder="e.g. Finance Director" />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                      <div className="edit-field" style={{ flex: 1 }}>
                        <label>Assessment</label>
                        <select value={ap.assessment} onChange={e => updateApproval(ai, 'assessment', e.target.value)}>
                          <option value="too-loose">Too loose</option>
                          <option value="just-right">Just right</option>
                          <option value="too-tight">Too tight</option>
                          <option value="bureaucratic">Bureaucratic</option>
                        </select>
                      </div>
                      <button type="button" className="edit-step-remove" onClick={() => removeApproval(ai)} style={{ marginBottom: 5 }}>&times;</button>
                    </div>
                  </div>
                </div>
              ))}
              <button type="button" className="edit-add-btn" onClick={addApproval}>+ Add Approval</button>
            </div>

            <div className="edit-stage-card">
              <h3 className="edit-stage-title">Knowledge &amp; Documentation</h3>
              <p className="edit-stage-desc">How does the team learn about this process?</p>
              <div className="edit-radio-group">
                {[['Check documentation', 'documentation'], ['Ask someone', 'ask-someone'], ['Search email/Slack', 'search-email'], ['Shared spreadsheet', 'spreadsheet'], ['Look in a system', 'system'], ['Just know it', 'just-know']].map(([label, val]) => (
                  <label key={val} className={`edit-radio-card${proc.knowledge.source === val ? ' active' : ''}`}>
                    <input type="radio" name="knowledge" value={val} checked={proc.knowledge.source === val} onChange={() => updateNestedProc('knowledge', 'source', val)} />
                    {label}
                  </label>
                ))}
              </div>
              {proc.knowledge.source === 'ask-someone' && (
                <div className="edit-grid-2" style={{ marginTop: 16 }}>
                  <div className="edit-field">
                    <label>Who Do They Ask?</label>
                    <input type="text" value={proc.knowledge.askWho} onChange={e => updateNestedProc('knowledge', 'askWho', e.target.value)} placeholder="Name or role" />
                  </div>
                  <div className="edit-field">
                    <label>What If They&apos;re on Holiday?</label>
                    <select value={proc.knowledge.vacationImpact} onChange={e => updateNestedProc('knowledge', 'vacationImpact', e.target.value)}>
                      <option value="">Select...</option>
                      <option value="fine">It&apos;s fine</option>
                      <option value="ask-else">Ask someone else</option>
                      <option value="slows-down">Slows things down</option>
                      <option value="stops">Process stops</option>
                      <option value="guess">People guess</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── QUANTIFY PHASE ─── */}
        {activePhase === 'quantify' && proc && (
          <div className="edit-stage fade-in">
            <div className="edit-stage-card">
              <h3 className="edit-stage-title">Frequency &amp; Volume</h3>
              <p className="edit-stage-desc">How often does this process run?</p>
              <div className="edit-radio-group">
                {FREQUENCY_OPTIONS.map(f => (
                  <label key={f.value} className={`edit-radio-card${proc.frequencyType === f.value ? ' active' : ''}`}>
                    <input type="radio" name="frequency" value={f.value} checked={proc.frequencyType === f.value} onChange={() => { updateProc('frequencyType', f.value); updateProc('annualInstances', f.annual); }} />
                    {f.label}
                  </label>
                ))}
              </div>
              <div className="edit-grid-3" style={{ marginTop: 16 }}>
                <div className="edit-field">
                  <label>In-Flight Right Now</label>
                  <input type="number" value={proc.inFlight} onChange={e => updateProc('inFlight', Number(e.target.value) || 0)} min={0} />
                </div>
                <div className="edit-field">
                  <label>Delayed / Stuck</label>
                  <input type="number" value={proc.stuck} onChange={e => updateProc('stuck', Number(e.target.value) || 0)} min={0} />
                </div>
                <div className="edit-field">
                  <label>Waiting for Someone</label>
                  <input type="number" value={proc.waiting} onChange={e => updateProc('waiting', Number(e.target.value) || 0)} min={0} />
                </div>
              </div>
            </div>

            <div className="edit-stage-card">
              <h3 className="edit-stage-title">Cost</h3>
              <p className="edit-stage-desc">Cost assumptions for this process.</p>
              <div className="edit-grid-3">
                <div className="edit-field">
                  <label>Hourly Rate (£)</label>
                  <input type="number" value={proc.hourlyRate} onChange={e => updateProc('hourlyRate', Number(e.target.value) || 0)} min={0} />
                </div>
                <div className="edit-field">
                  <label>Team Size</label>
                  <input type="number" value={proc.teamSize} onChange={e => updateProc('teamSize', Number(e.target.value) || 1)} min={1} />
                </div>
                <div className="edit-field">
                  <label>Annual Instances</label>
                  <input type="number" value={proc.annualInstances} onChange={e => updateProc('annualInstances', Number(e.target.value) || 0)} min={0} />
                </div>
              </div>
            </div>

            <div className="edit-stage-card">
              <h3 className="edit-stage-title">Priority</h3>
              <p className="edit-stage-desc">How important is optimising this process?</p>
              <div className="edit-radio-group">
                {[['Top priority', 'top'], ['Important', 'important'], ['Medium', 'medium'], ['Low', 'low']].map(([label, val]) => (
                  <label key={val} className={`edit-radio-card${proc.priority === val ? ' active' : ''}`}>
                    <input type="radio" name="priority" value={val} checked={proc.priority === val} onChange={() => updateProc('priority', val)} />
                    {label}
                  </label>
                ))}
              </div>
              <div className="edit-field" style={{ marginTop: 12 }}>
                <label>Why?</label>
                <textarea value={proc.priorityReason} onChange={e => updateProc('priorityReason', e.target.value)} placeholder="Why is this a priority?" rows={2} maxLength={150} />
              </div>
            </div>
          </div>
        )}

        {/* ─── YOUR DETAILS ─── */}
        {activePhase === 'details' && (
          <div className="edit-stage fade-in">
            <div className="edit-stage-card">
              <h3 className="edit-stage-title">Your Details</h3>
              <p className="edit-stage-desc">Contact information for this diagnostic.</p>
              <div className="edit-grid-2">
                <div className="edit-field">
                  <label>Full Name</label>
                  <input type="text" value={contact.name} onChange={e => setContact(c => ({ ...c, name: e.target.value }))} placeholder="Jane Smith" />
                </div>
                <div className="edit-field">
                  <label>Email</label>
                  <input type="email" value={contact.email} onChange={e => setContact(c => ({ ...c, email: e.target.value }))} placeholder="jane@company.com" />
                </div>
              </div>
              <div className="edit-grid-3">
                <div className="edit-field">
                  <label>Company</label>
                  <input type="text" value={contact.company} onChange={e => setContact(c => ({ ...c, company: e.target.value }))} placeholder="Acme Corp" />
                </div>
                <div className="edit-field">
                  <label>Job Title</label>
                  <input type="text" value={contact.title} onChange={e => setContact(c => ({ ...c, title: e.target.value }))} placeholder="Operations Manager" />
                </div>
                <div className="edit-field">
                  <label>Industry</label>
                  <select value={contact.industry} onChange={e => setContact(c => ({ ...c, industry: e.target.value }))}>
                    <option value="">Select industry</option>
                    {INDUSTRIES.map(ind => <option key={ind} value={ind}>{ind}</option>)}
                  </select>
                </div>
              </div>
              <div className="edit-grid-2">
                <div className="edit-field">
                  <label>Team Size</label>
                  <input type="text" value={contact.teamSize} onChange={e => setContact(c => ({ ...c, teamSize: e.target.value }))} placeholder="15" />
                </div>
                <div className="edit-field">
                  <label>Phone</label>
                  <input type="text" value={contact.phone} onChange={e => setContact(c => ({ ...c, phone: e.target.value }))} placeholder="+44 7XXX XXXXXX" />
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="edit-bottom-bar">
          <button type="button" onClick={onBack} className="edit-cancel-btn">Back to Dashboard</button>
          <button type="button" className="edit-save-btn" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save All Changes'}
          </button>
        </div>
      </div>
    </>
  );
}
