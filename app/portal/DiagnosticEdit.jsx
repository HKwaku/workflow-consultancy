'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

function Section({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="edit-section">
      <button type="button" className="edit-section-toggle" onClick={() => setOpen(!open)}>
        <span className="edit-section-title">{title}</span>
        <span className={`edit-section-chevron${open ? ' open' : ''}`}>&#9662;</span>
      </button>
      {open && <div className="edit-section-body">{children}</div>}
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder, min, max, step, textarea, readOnly }) {
  const id = label.replace(/\s+/g, '-').toLowerCase();
  return (
    <div className="edit-field">
      <label htmlFor={id}>{label}</label>
      {textarea ? (
        <textarea id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} readOnly={readOnly} rows={3} />
      ) : (
        <input id={id} type={type} value={value ?? ''} onChange={(e) => onChange(type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} placeholder={placeholder} min={min} max={max} step={step} readOnly={readOnly} />
      )}
    </div>
  );
}

function SelectField({ label, value, onChange, options }) {
  const id = label.replace(/\s+/g, '-').toLowerCase();
  return (
    <div className="edit-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

export default function DiagnosticEdit({ reportId, email, onBack }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [report, setReport] = useState(null);

  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [company, setCompany] = useState('');
  const [contactTitle, setContactTitle] = useState('');
  const [contactIndustry, setContactIndustry] = useState('');
  const [contactTeamSize, setContactTeamSize] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [leadScore, setLeadScore] = useState(0);
  const [leadGrade, setLeadGrade] = useState('');

  const [totalProcesses, setTotalProcesses] = useState(0);
  const [totalAnnualCost, setTotalAnnualCost] = useState(0);
  const [potentialSavings, setPotentialSavings] = useState(0);
  const [qualityScore, setQualityScore] = useState(0);
  const [analysisType, setAnalysisType] = useState('rule-based');

  const [automationPct, setAutomationPct] = useState(0);
  const [automationGrade, setAutomationGrade] = useState('N/A');
  const [automationInsight, setAutomationInsight] = useState('');

  const [processes, setProcesses] = useState([]);
  const [recommendations, setRecommendations] = useState([]);

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
        const s = dd.summary || {};
        const auto = dd.automationScore || {};

        setReport(r);
        setContactName(r.contactName || c.name || '');
        setContactEmail(r.contactEmail || c.email || '');
        setCompany(r.company || c.company || '');
        setContactTitle(c.title || '');
        setContactIndustry(c.industry || '');
        setContactTeamSize(c.teamSize || '');
        setContactPhone(c.phone || '');
        setLeadScore(r.leadScore ?? 0);
        setLeadGrade(r.leadGrade || '');

        setTotalProcesses(s.totalProcesses || 0);
        setTotalAnnualCost(s.totalAnnualCost || 0);
        setPotentialSavings(s.potentialSavings || 0);
        setQualityScore(s.qualityScore || 0);
        setAnalysisType(s.analysisType || 'rule-based');

        setAutomationPct(auto.percentage || 0);
        setAutomationGrade(auto.grade || 'N/A');
        setAutomationInsight(auto.insight || '');

        setProcesses((dd.processes || []).map((p, i) => ({
          _key: i,
          name: p.name || '',
          type: p.type || '',
          elapsedDays: p.elapsedDays || 0,
          annualCost: p.annualCost || 0,
          annualInstances: p.annualInstances || 0,
          teamSize: p.teamSize || 0,
          stepsCount: p.stepsCount || (p.steps || []).length,
          steps: (p.steps || []).map((st, si) => ({
            _key: si,
            name: st.name || '',
            department: st.department || '',
            isDecision: !!st.isDecision,
            isExternal: !!st.isExternal,
          })),
        })));

        setRecommendations((dd.recommendations || []).map((r, i) => ({
          _key: i,
          type: r.type || 'general',
          process: r.process || '',
          text: r.text || '',
        })));
      } catch {
        if (!cancelled) setError('Network error. Could not load report.');
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [reportId]);

  const handleSave = useCallback(async () => {
    setSaving(true); setError(null); setSuccess(null);
    try {
      const updates = {
        contactName,
        contactEmail,
        company,
        leadScore,
        leadGrade,
        contact: {
          name: contactName,
          email: contactEmail,
          company,
          title: contactTitle,
          industry: contactIndustry,
          teamSize: contactTeamSize,
          phone: contactPhone,
        },
        summary: {
          totalProcesses,
          totalAnnualCost,
          potentialSavings,
          qualityScore,
          analysisType,
        },
        automationScore: {
          percentage: automationPct,
          grade: automationGrade,
          insight: automationInsight,
        },
        processes: processes.map(p => ({
          name: p.name,
          type: p.type,
          elapsedDays: p.elapsedDays,
          annualCost: p.annualCost,
          annualInstances: p.annualInstances,
          teamSize: p.teamSize,
          stepsCount: p.stepsCount,
          steps: p.steps.map((st, si) => ({
            number: si + 1,
            name: st.name,
            department: st.department,
            isDecision: st.isDecision,
            isExternal: st.isExternal,
          })),
        })),
        recommendations: recommendations.map(r => ({
          type: r.type,
          process: r.process,
          text: r.text,
        })),
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
  }, [reportId, email, contactName, contactEmail, company, contactTitle, contactIndustry, contactTeamSize, contactPhone, leadScore, leadGrade, totalProcesses, totalAnnualCost, potentialSavings, qualityScore, analysisType, automationPct, automationGrade, automationInsight, processes, recommendations]);

  const updateProcess = (idx, field, val) => {
    setProcesses(prev => prev.map((p, i) => i === idx ? { ...p, [field]: val } : p));
  };

  const addProcess = () => {
    setProcesses(prev => [...prev, { _key: Date.now(), name: '', type: '', elapsedDays: 0, annualCost: 0, annualInstances: 0, teamSize: 1, stepsCount: 0, steps: [] }]);
  };

  const removeProcess = (idx) => {
    setProcesses(prev => prev.filter((_, i) => i !== idx));
  };

  const updateStep = (procIdx, stepIdx, field, val) => {
    setProcesses(prev => prev.map((p, pi) => {
      if (pi !== procIdx) return p;
      const newSteps = p.steps.map((s, si) => si === stepIdx ? { ...s, [field]: val } : s);
      return { ...p, steps: newSteps, stepsCount: newSteps.length };
    }));
  };

  const addStep = (procIdx) => {
    setProcesses(prev => prev.map((p, pi) => {
      if (pi !== procIdx) return p;
      const newSteps = [...p.steps, { _key: Date.now(), name: '', department: '', isDecision: false, isExternal: false }];
      return { ...p, steps: newSteps, stepsCount: newSteps.length };
    }));
  };

  const removeStep = (procIdx, stepIdx) => {
    setProcesses(prev => prev.map((p, pi) => {
      if (pi !== procIdx) return p;
      const newSteps = p.steps.filter((_, si) => si !== stepIdx);
      return { ...p, steps: newSteps, stepsCount: newSteps.length };
    }));
  };

  const updateRecommendation = (idx, field, val) => {
    setRecommendations(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r));
  };

  const addRecommendation = () => {
    setRecommendations(prev => [...prev, { _key: Date.now(), type: 'general', process: '', text: '' }]);
  };

  const removeRecommendation = (idx) => {
    setRecommendations(prev => prev.filter((_, i) => i !== idx));
  };

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
          <button type="button" onClick={onBack} className="header-btn">&#8592; Back to Dashboard</button>
        </div>
      </header>

      <div className="portal-wrap edit-wrap">
        {error && <div className="edit-banner edit-banner-error">{error}</div>}
        {success && <div className="edit-banner edit-banner-success">{success}</div>}

        <div className="edit-top-bar">
          <div>
            <h2 className="edit-page-title">Edit Diagnostic Report</h2>
            <p className="edit-page-sub">
              Report ID: <code>{reportId}</code>
              {report?.createdAt && <> &middot; Created {new Date(report.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</>}
            </p>
          </div>
          <button type="button" className="edit-save-btn" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save All Changes'}
          </button>
        </div>

        <Section title="Contact Information">
          <div className="edit-grid-2">
            <Field label="Full Name" value={contactName} onChange={setContactName} placeholder="Jane Smith" />
            <Field label="Email" value={contactEmail} onChange={setContactEmail} type="email" placeholder="jane@company.com" />
          </div>
          <div className="edit-grid-3">
            <Field label="Company" value={company} onChange={setCompany} placeholder="Acme Corp" />
            <Field label="Job Title" value={contactTitle} onChange={setContactTitle} placeholder="Operations Manager" />
            <Field label="Industry" value={contactIndustry} onChange={setContactIndustry} placeholder="Financial Services" />
          </div>
          <div className="edit-grid-3">
            <Field label="Team Size" value={contactTeamSize} onChange={setContactTeamSize} placeholder="15" />
            <Field label="Phone" value={contactPhone} onChange={setContactPhone} placeholder="+44 7XXX XXXXXX" />
            <div />
          </div>
        </Section>

        <Section title="Lead Scoring">
          <div className="edit-grid-2">
            <Field label="Lead Score" value={leadScore} onChange={setLeadScore} type="number" min={0} max={100} />
            <SelectField label="Lead Grade" value={leadGrade} onChange={setLeadGrade} options={[
              { value: '', label: '— Select —' },
              { value: 'Hot', label: 'Hot' },
              { value: 'Warm', label: 'Warm' },
              { value: 'Interested', label: 'Interested' },
              { value: 'Cold', label: 'Cold' },
            ]} />
          </div>
        </Section>

        <Section title="Summary Metrics">
          <div className="edit-grid-3">
            <Field label="Total Processes" value={totalProcesses} onChange={setTotalProcesses} type="number" min={0} />
            <Field label="Total Annual Cost (£)" value={totalAnnualCost} onChange={setTotalAnnualCost} type="number" min={0} step={100} />
            <Field label="Potential Savings (£)" value={potentialSavings} onChange={setPotentialSavings} type="number" min={0} step={100} />
          </div>
          <div className="edit-grid-3">
            <Field label="Quality Score" value={qualityScore} onChange={setQualityScore} type="number" min={0} max={100} />
            <SelectField label="Analysis Type" value={analysisType} onChange={setAnalysisType} options={[
              { value: 'rule-based', label: 'Rule-Based' },
              { value: 'ai-enhanced', label: 'AI-Enhanced' },
            ]} />
            <div />
          </div>
        </Section>

        <Section title="Automation Score">
          <div className="edit-grid-3">
            <Field label="Automation %" value={automationPct} onChange={setAutomationPct} type="number" min={0} max={100} />
            <SelectField label="Grade" value={automationGrade} onChange={setAutomationGrade} options={[
              { value: 'N/A', label: 'N/A' },
              { value: 'HIGH', label: 'High' },
              { value: 'MEDIUM', label: 'Medium' },
              { value: 'LOW', label: 'Low' },
            ]} />
            <div />
          </div>
          <Field label="Automation Insight" value={automationInsight} onChange={setAutomationInsight} textarea placeholder="Key insight about automation readiness..." />
        </Section>

        <Section title={`Processes (${processes.length})`}>
          {processes.map((proc, pi) => (
            <div key={proc._key ?? pi} className="edit-process-card">
              <div className="edit-process-header">
                <span className="edit-process-num">Process {pi + 1}</span>
                <button type="button" className="edit-remove-btn" onClick={() => removeProcess(pi)}>Remove</button>
              </div>
              <div className="edit-grid-3">
                <Field label="Name" value={proc.name} onChange={(v) => updateProcess(pi, 'name', v)} placeholder="Invoice Approval" />
                <Field label="Type" value={proc.type} onChange={(v) => updateProcess(pi, 'type', v)} placeholder="approval-workflow" />
                <Field label="Elapsed Days" value={proc.elapsedDays} onChange={(v) => updateProcess(pi, 'elapsedDays', v)} type="number" min={0} />
              </div>
              <div className="edit-grid-3">
                <Field label="Annual Cost (£)" value={proc.annualCost} onChange={(v) => updateProcess(pi, 'annualCost', v)} type="number" min={0} step={100} />
                <Field label="Annual Instances" value={proc.annualInstances} onChange={(v) => updateProcess(pi, 'annualInstances', v)} type="number" min={0} />
                <Field label="Team Size" value={proc.teamSize} onChange={(v) => updateProcess(pi, 'teamSize', v)} type="number" min={0} />
              </div>

              <div className="edit-steps-block">
                <div className="edit-steps-header">
                  <span>Steps ({proc.steps.length})</span>
                  <button type="button" className="edit-add-btn-sm" onClick={() => addStep(pi)}>+ Step</button>
                </div>
                {proc.steps.map((st, si) => (
                  <div key={st._key ?? si} className="edit-step-row">
                    <span className="edit-step-num">{si + 1}</span>
                    <input type="text" value={st.name} onChange={(e) => updateStep(pi, si, 'name', e.target.value)} placeholder="Step name" className="edit-step-input" />
                    <input type="text" value={st.department} onChange={(e) => updateStep(pi, si, 'department', e.target.value)} placeholder="Department" className="edit-step-dept" />
                    <label className="edit-step-check">
                      <input type="checkbox" checked={st.isDecision} onChange={(e) => updateStep(pi, si, 'isDecision', e.target.checked)} /> Decision
                    </label>
                    <label className="edit-step-check">
                      <input type="checkbox" checked={st.isExternal} onChange={(e) => updateStep(pi, si, 'isExternal', e.target.checked)} /> External
                    </label>
                    <button type="button" className="edit-step-remove" onClick={() => removeStep(pi, si)}>&times;</button>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <button type="button" className="edit-add-btn" onClick={addProcess}>+ Add Process</button>
        </Section>

        <Section title={`Recommendations (${recommendations.length})`}>
          {recommendations.map((rec, ri) => (
            <div key={rec._key ?? ri} className="edit-rec-row">
              <div className="edit-grid-3" style={{ flex: 1 }}>
                <SelectField label="Type" value={rec.type} onChange={(v) => updateRecommendation(ri, 'type', v)} options={[
                  { value: 'general', label: 'General' },
                  { value: 'automation', label: 'Automation' },
                  { value: 'handoff', label: 'Handoff' },
                  { value: 'integration', label: 'Integration' },
                  { value: 'approval', label: 'Approval' },
                  { value: 'knowledge', label: 'Knowledge' },
                ]} />
                <Field label="Process" value={rec.process} onChange={(v) => updateRecommendation(ri, 'process', v)} placeholder="Which process" />
                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <button type="button" className="edit-remove-btn" onClick={() => removeRecommendation(ri)}>Remove</button>
                </div>
              </div>
              <Field label="Recommendation Text" value={rec.text} onChange={(v) => updateRecommendation(ri, 'text', v)} textarea placeholder="Describe the recommendation..." />
            </div>
          ))}
          <button type="button" className="edit-add-btn" onClick={addRecommendation}>+ Add Recommendation</button>
        </Section>

        <div className="edit-bottom-bar">
          <button type="button" onClick={onBack} className="edit-cancel-btn">Cancel</button>
          <button type="button" className="edit-save-btn" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save All Changes'}
          </button>
        </div>
      </div>
    </>
  );
}
