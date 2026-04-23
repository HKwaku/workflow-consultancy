'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import { useTheme } from '@/components/ThemeProvider';
import InteractiveFlowCanvas from '@/components/flow/InteractiveFlowCanvas';
import { resolveStoredPositions, writeLayoutKey } from '@/lib/flows';
import { getSupabaseClient, getSessionSafe } from '@/lib/supabase';

const PHASES = [
  { key: 'define', label: 'Define', icon: '\u2699' },
  { key: 'measure', label: 'Measure', icon: '\u23F1' },
  { key: 'map', label: 'Map', icon: '\u2B13' },
  { key: 'assess', label: 'Assess', icon: '\u2611' },
  { key: 'quantify', label: 'Quantify', icon: '\u00A3' },
  { key: 'details', label: 'Details', icon: '\u270E' },
];

const FLOW_VIEWS = [
  { id: 'grid', label: 'Linear', icon: '\u2192' },
  { id: 'swimlane', label: 'Swimlane', icon: '\u23F8' },
  { id: 'list', label: 'List', icon: '\u2630' },
];

const DEPARTMENTS = ['Sales', 'Operations', 'Finance', 'IT', 'Customer Success', 'Product', 'Leadership', 'HR'];

const HANDOFF_METHODS = [
  { value: 'email-details', label: 'Email with full details' },
  { value: 'email-check', label: 'Email (just a heads up)' },
  { value: 'slack', label: 'Slack / Teams message' },
  { value: 'spreadsheet', label: 'Shared spreadsheet' },
  { value: 'in-person', label: 'In-person / call' },
  { value: 'verbal', label: 'Verbal / informal' },
  { value: 'they-knew', label: 'They just knew' },
  { value: 'other', label: 'Other' },
];

const CLARITY_OPTIONS = [
  { value: 'no', label: 'No confusion' },
  { value: 'yes-once', label: 'Yes, needed one clarification' },
  { value: 'yes-multiple', label: 'Yes, back and forth' },
  { value: 'yes-major', label: 'Yes, caused a major delay' },
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
  const { theme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [report, setReport] = useState(null);
  const [activePhase, setActivePhase] = useState('define');
  const [activeProcessIdx, setActiveProcessIdx] = useState(0);
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [flowView, setFlowView] = useState('grid');
  const isWrapped = flowView === 'wrap';
  const handleWrapToggle = () => setFlowView((v) => v === 'wrap' ? 'grid' : 'wrap');
  const [previewCollapsed, setPreviewCollapsed] = useState(false);

  const [processes, setProcesses] = useState([]);
  const [contact, setContact] = useState({ name: '', email: '', company: '', title: '', teamSize: '', industry: '', phone: '' });

  useEffect(() => {
    if (!reportId) { setError('No report ID.'); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const url = email
          ? `/api/get-diagnostic?id=${encodeURIComponent(reportId)}&editable=true&email=${encodeURIComponent(email)}`
          : `/api/get-diagnostic?id=${encodeURIComponent(reportId)}`;
        const resp = await fetch(url);
        let data;
        try { data = await resp.json(); } catch (e) { setError('Invalid response from server.'); setLoading(false); return; }
        if (cancelled) return;
        if (!resp.ok || !data.success) { setError(data.error || 'Failed to load report.'); setLoading(false); return; }

        const r = data.report;
        const dd = r.diagnosticData || {};
        const c = dd.contact || r.contact || {};
        const raw = r.rawProcesses || dd.rawProcesses || [];
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
          segment: c.segment || '',
          maEntity: c.maEntity || '',
          maTimeline: c.maTimeline || '',
          peStage: c.peStage || '',
          highStakesType: c.highStakesType || '',
          highStakesDeadline: c.highStakesDeadline || '',
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
    const steps = (rp.steps || []).map((s, si) => {
      const rawBranches = (s.branches || []).map((b, bi) => ({
        _key: b._key ?? `b${si}-${bi}`,
        label: b.label || '',
        target: b.target || b.targetStep || '',
      }));
      const branches = s.isDecision && rawBranches.length === 0
        ? [{ _key: `b${si}-0`, label: '', target: '' }, { _key: `b${si}-1`, label: '', target: '' }]
        : rawBranches;
      return {
        _key: si,
        name: s.name || '',
        department: s.department || '',
        isDecision: !!s.isDecision,
        isExternal: !!s.isExternal,
        branches,
        workMinutes: s.workMinutes,
        waitMinutes: s.waitMinutes,
        waitType: s.waitType,
        waitNote: s.waitNote,
        waitExternal: s.waitExternal,
        capacity: s.capacity,
        durationUnit: s.durationUnit,
      };
    });

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
      flowNodePositions: rp.flowNodePositions || {},
      flowCustomEdges: rp.flowCustomEdges || [],
      flowDeletedEdges: rp.flowDeletedEdges || [],
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
    proc.steps = (p.steps || []).map((s, si) => {
      const branches = s.isDecision
        ? (s.branches || []).map((b, bi) => ({ _key: `b${si}-${bi}`, label: b.label || '', target: b.target || b.targetStep || '' }))
        : [];
      const defaultBranches = s.isDecision && branches.length === 0
        ? [{ _key: `b${si}-0`, label: '', target: '' }, { _key: `b${si}-1`, label: '', target: '' }]
        : branches;
      return {
        _key: si, name: s.name || '', department: s.department || '',
        isDecision: !!s.isDecision, isExternal: !!s.isExternal, branches: defaultBranches,
      };
    });
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
      flowNodePositions: {}, flowCustomEdges: [], flowDeletedEdges: [],
    };
  }

  const proc = processes[activeProcessIdx] || processes[0];

  const processForFlow = useMemo(() => {
    if (!proc || !proc.steps?.length) return null;
    return {
      processName: proc.processName || 'Process',
      steps: proc.steps.map((s, si) => ({
        number: si + 1,
        name: s.name || `Step ${si + 1}`,
        department: s.department || '',
        isDecision: !!s.isDecision,
        isMerge: !!s.isMerge,
        isExternal: !!s.isExternal,
        branches: (s.branches || []).map(b => ({ label: b.label || '', target: b.target || '' })),
        systems: s.systems || [],
      })),
      handoffs: (proc.stepHandoffs || []).filter(Boolean).map((h, hi) => ({
        from: { name: proc.steps[hi]?.name || '', department: proc.steps[hi]?.department || '' },
        to: { name: proc.steps[hi + 1]?.name || '', department: proc.steps[hi + 1]?.department || '' },
        method: h.method || '',
        clarity: h.clarity || '',
      })),
      definition: { startsWhen: proc.startsWhen || 'Start', completesWhen: proc.completesWhen || 'End' },
      bottleneck: {},
    };
  }, [proc]);

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
      const newSteps = p.steps.map((s, j) => {
        if (j !== si) return s;
        const updated = { ...s, [field]: val };
        if (field === 'isDecision' && val && (!s.branches || s.branches.length === 0)) {
          updated.branches = [{ _key: Date.now(), label: '', target: '' }, { _key: Date.now() + 1, label: '', target: '' }];
        }
        return updated;
      });
      return { ...p, steps: newSteps };
    }));
  };

  const updateBranch = (si, bi, field, val) => {
    setProcesses(prev => prev.map((p, i) => {
      if (i !== activeProcessIdx) return p;
      const newSteps = p.steps.map((s, j) => {
        if (j !== si || !s.branches) return s;
        const newBranches = s.branches.map((b, k) => k === bi ? { ...b, [field]: val } : b);
        return { ...s, branches: newBranches };
      });
      return { ...p, steps: newSteps };
    }));
  };

  const addBranch = (si) => {
    setProcesses(prev => prev.map((p, i) => {
      if (i !== activeProcessIdx) return p;
      const newSteps = p.steps.map((s, j) => {
        if (j !== si) return s;
        const branches = s.branches || [];
        return { ...s, branches: [...branches, { _key: Date.now(), label: '', target: '' }] };
      });
      return { ...p, steps: newSteps };
    }));
  };

  const removeBranch = (si, bi) => {
    setProcesses(prev => prev.map((p, i) => {
      if (i !== activeProcessIdx) return p;
      const newSteps = p.steps.map((s, j) => {
        if (j !== si || !s.branches) return s;
        const newBranches = s.branches.filter((_, k) => k !== bi);
        return { ...s, branches: newBranches };
      });
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

  const addStep = (asDecision = false) => {
    setProcesses(prev => prev.map((p, i) => {
      if (i !== activeProcessIdx) return p;
      const newStep = {
        _key: Date.now(), name: '', department: '', isExternal: false,
        isDecision: !!asDecision,
        branches: asDecision ? [{ _key: Date.now(), label: '', target: '' }, { _key: Date.now() + 1, label: '', target: '' }] : [],
      };
      const newSteps = [...p.steps, newStep];
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

  const moveStep = (fromIdx, toIdx) => {
    if (fromIdx === toIdx) return;
    setProcesses(prev => prev.map((p, i) => {
      if (i !== activeProcessIdx) return p;
      const newSteps = [...p.steps];
      const [moved] = newSteps.splice(fromIdx, 1);
      newSteps.splice(toIdx, 0, moved);
      const newH = newSteps.slice(0, -1).map((_, hi) => (p.stepHandoffs || [])[hi] || { _key: hi, method: '', clarity: 'no' });
      return { ...p, steps: newSteps, stepHandoffs: newH };
    }));
  };

  const insertStepAt = (idx, asDecision = false) => {
    setProcesses(prev => prev.map((p, i) => {
      if (i !== activeProcessIdx) return p;
      const newStep = {
        _key: Date.now(), name: '', department: '', isExternal: false,
        isDecision: !!asDecision,
        branches: asDecision ? [{ _key: Date.now(), label: '', target: '' }, { _key: Date.now() + 1, label: '', target: '' }] : [],
      };
      const newSteps = [...p.steps];
      newSteps.splice(idx, 0, newStep);
      const newH = [...(p.stepHandoffs || [])];
      newH.splice(idx, 0, { _key: Date.now(), method: '', clarity: 'no' });
      return { ...p, steps: newSteps, stepHandoffs: newH };
    }));
  };

  const handleDragStart = (si) => { setDragIdx(si); };
  const handleDragOver = (e, si) => { e.preventDefault(); setDragOverIdx(si); };
  const handleDrop = (si) => { if (dragIdx !== null) moveStep(dragIdx, si); setDragIdx(null); setDragOverIdx(null); };
  const handleDragEnd = () => { setDragIdx(null); setDragOverIdx(null); };

  const moveStepUp = (si) => { if (si > 0) moveStep(si, si - 1); };
  const moveStepDown = (si) => { if (si < (proc?.steps?.length || 0) - 1) moveStep(si, si + 1); };

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
      const rawProcesses = processes.map((p) => {
        return ({
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
        steps: p.steps.map((s, si) => {
          const rawBranches = (s.branches || []).map(b => ({ label: (b.label || '').trim(), target: (b.target || '').trim() }));
          const filledBranches = rawBranches.filter(b => b.label || b.target);
          // Preserve isDecision from user intent; keep placeholder branches when marked as decision so structure survives reload
          const branches = s.isDecision && filledBranches.length === 0
            ? (rawBranches.length > 0 ? rawBranches : [{ label: '', target: '' }, { label: '', target: '' }])
            : filledBranches;
          return {
            number: si + 1, name: s.name, department: s.department,
            isDecision: !!s.isDecision,
            isExternal: s.isExternal,
            branches,
            workMinutes: s.workMinutes,
            waitMinutes: s.waitMinutes,
            waitType: s.waitType,
            waitNote: s.waitNote,
            waitExternal: s.waitExternal,
            capacity: s.capacity,
            durationUnit: s.durationUnit,
          };
        }),
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
        flowCustomEdges: p.flowCustomEdges || [],
        flowDeletedEdges: p.flowDeletedEdges || [],
        flowNodePositions: p.flowNodePositions || {},
      });});

      const summaryProcesses = processes.map(p => ({
        name: p.processName, type: p.processType, elapsedDays: p.elapsedDays,
        annualCost: 0, teamSize: p.teamSize,
        stepsCount: p.steps.length,
        steps: p.steps.map((s, si) => ({
          number: si + 1, name: s.name, department: s.department,
          isDecision: s.isDecision, isExternal: s.isExternal,
          branches: (s.branches || []).map(b => ({ label: b.label || '', target: b.target || '' })),
        })),
      }));

      const updates = {
        contactName: contact.name,
        contactEmail: contact.email,
        company: contact.company,
        contact,
        rawProcesses,
        processes: summaryProcesses,
      };

      const sb = getSupabaseClient();
      const { session } = await getSessionSafe(sb);
      const headers = { 'Content-Type': 'application/json' };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

      const resp = await fetch('/api/update-diagnostic', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ reportId, email, updates }),
      });
      let data;
      try { data = await resp.json(); } catch (e) { setError('Invalid response from server.'); return; }
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
      <p>Loading audit data...</p>
    </div>
  );

  return (
    <>
      <header className="dashboard-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Link href="/" className="header-logo">Vesno<span style={{ color: 'var(--gold)' }}>.</span></Link>
          <div className="header-divider" />
          <span className="header-title">Edit Process Audit</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ThemeToggle className="header-theme-btn" />
          <button type="button" className="edit-save-btn" onClick={handleSave} disabled={saving} style={{ padding: '6px 18px', fontSize: '0.78rem' }}>
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button type="button" onClick={onBack} className="header-btn">&larr; Dashboard</button>
        </div>
      </header>

      <div className={`portal-wrap${activePhase === 'map' ? ' edit-wrap-wide' : ' edit-wrap'}`}>
        {error && <div className="edit-banner edit-banner-error">{error}</div>}
        {success && <div className="edit-banner edit-banner-success">{success}</div>}

        {processes.length > 1 && (
          <div className="edit-proc-tabs">
            {processes.map((p, i) => (
              <button key={p._key ?? i} type="button" className={`edit-proc-tab${i === activeProcessIdx ? ' active' : ''}`} onClick={() => setActiveProcessIdx(i)}>
                {p.processName || `Process ${i + 1}`}
              </button>
            ))}
          </div>
        )}

        <div className="edit-phases">
          {PHASES.map((ph, phi) => {
            const isActive = activePhase === ph.key;
            const pastIdx = PHASES.findIndex(p => p.key === activePhase);
            const isPast = phi < pastIdx;
            return (
              <button key={ph.key} type="button" className={`edit-phase${isActive ? ' active' : ''}${isPast ? ' past' : ''}`} onClick={() => setActivePhase(ph.key)}>
                <span className="edit-phase-icon">{ph.icon}</span>
                {ph.label}
              </button>
            );
          })}
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

            {contact.segment && (
              <div className="edit-stage-card">
                <h3 className="edit-stage-title">Audit Context</h3>
                <p className="edit-stage-desc">Segment captured at sign-up - shapes AI recommendations.</p>
                {(() => {
                  const SEGMENT_LABELS = { scaling: 'Scaling Business', ma: 'M&A Integration', pe: 'Private Equity', highstakes: 'High-stakes Event' };
                  const SEGMENT_COLORS = { scaling: '#0d9488', ma: '#6366f1', pe: '#8b5cf6', highstakes: '#d97706' };
                  const seg = contact.segment;
                  const color = SEGMENT_COLORS[seg] || 'var(--text-mid)';
                  return (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' }}>
                      <span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 4, background: color + '22', color, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{SEGMENT_LABELS[seg] || seg}</span>
                      {contact.maEntity && <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>Entity: <strong>{contact.maEntity}</strong></span>}
                      {contact.maTimeline && <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>Timeline: <strong>{contact.maTimeline}</strong></span>}
                      {contact.peStage && <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>PE Stage: <strong>{contact.peStage}</strong></span>}
                      {contact.highStakesType && <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>Type: <strong>{contact.highStakesType}</strong></span>}
                      {contact.highStakesDeadline && <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>Deadline: <strong>{contact.highStakesDeadline}</strong></span>}
                    </div>
                  );
                })()}
              </div>
            )}

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
                <label>Teams Involved</label>
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

        {/* ─── MAP PHASE (Steps + Handoffs + live flowchart preview) ─── */}
        {activePhase === 'map' && proc && (
          <div className="edit-stage edit-map-split fade-in">
            <div className={`edit-map-editor${previewCollapsed ? ' edit-map-editor-full' : ''}`}>
              <div className="edit-stage-card">
                <div className="edit-stage-card-header">
                  <div>
                    <h3 className="edit-stage-title">Steps &amp; Handoffs</h3>
                    <p className="edit-stage-desc">Define each step and how it hands over to the next. Drag to reorder.</p>
                  </div>
                  <span className="edit-step-count-badge">{proc.steps.length} step{proc.steps.length !== 1 ? 's' : ''}</span>
                </div>

                <div className="edit-step-list">
                  {proc.steps.map((step, si) => (
                    <div key={step._key ?? si}>
                      {si > 0 && (
                        <div className="edit-insert-divider">
                          <button type="button" onClick={() => insertStepAt(si)} title="Insert step here">+</button>
                        </div>
                      )}

                      <div
                        className={`edit-step-item${dragIdx === si ? ' dragging' : ''}${dragOverIdx === si && dragIdx !== si ? ' drag-over' : ''}`}
                        draggable
                        onDragStart={() => handleDragStart(si)}
                        onDragOver={(e) => handleDragOver(e, si)}
                        onDrop={() => handleDrop(si)}
                        onDragEnd={handleDragEnd}
                      >
                        <div className="edit-step-drag-handle" title="Drag to reorder">
                          <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
                            <circle cx="2" cy="2" r="1.5"/><circle cx="8" cy="2" r="1.5"/>
                            <circle cx="2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/>
                            <circle cx="2" cy="14" r="1.5"/><circle cx="8" cy="14" r="1.5"/>
                          </svg>
                        </div>

                        <span className="edit-step-num">{si + 1}</span>

                        <div className="edit-step-content">
                          <div className="edit-step-top-row">
                            <input type="text" value={step.name} onChange={e => updateStep(si, 'name', e.target.value)} placeholder="Step name" className="edit-step-name-input" />
                            <select value={step.department} onChange={e => updateStep(si, 'department', e.target.value)} className="edit-step-dept-select">
                              <option value="">Team</option>
                              {[...DEPARTMENTS, ...(proc.departments || []).filter(d => !DEPARTMENTS.includes(d))].map(d => (
                                <option key={d} value={d}>{d}</option>
                              ))}
                            </select>
                          </div>
                          <div className="edit-step-bottom-row">
                            <label className="edit-step-check">
                              <input type="checkbox" checked={step.isDecision} onChange={e => updateStep(si, 'isDecision', e.target.checked)} /> Decision
                            </label>
                            <label className="edit-step-check">
                              <input type="checkbox" checked={step.isExternal} onChange={e => updateStep(si, 'isExternal', e.target.checked)} /> External
                            </label>
                            {step.isDecision && <span className="edit-step-badge decision">Decision</span>}
                            {step.isExternal && <span className="edit-step-badge external">External</span>}
                          </div>
                          {step.isDecision && (
                            <div className="edit-step-branches">
                              <div className="edit-step-branches-label">Routes from this decision:</div>
                              {(step.branches || []).map((br, bi) => (
                                <div key={br._key ?? bi} className="edit-branch-row">
                                  <span className="edit-branch-icon">&#10132;</span>
                                  <input type="text" value={br.label || ''} onChange={e => updateBranch(si, bi, 'label', e.target.value)} placeholder="Route label" className="edit-branch-input" />
                                  <input type="text" value={br.target || ''} onChange={e => updateBranch(si, bi, 'target', e.target.value)} placeholder="Goes to..." className="edit-branch-input edit-branch-target" />
                                  <button type="button" className="edit-branch-remove" onClick={() => removeBranch(si, bi)}>&times;</button>
                                </div>
                              ))}
                              <button type="button" className="edit-add-branch-btn" onClick={() => addBranch(si)}>+ Add route</button>
                            </div>
                          )}
                        </div>

                        <div className="edit-step-actions">
                          <button type="button" className="edit-step-arrow" onClick={() => moveStepUp(si)} disabled={si === 0} title="Move up">&uarr;</button>
                          <button type="button" className="edit-step-arrow" onClick={() => moveStepDown(si)} disabled={si === proc.steps.length - 1} title="Move down">&darr;</button>
                          <button type="button" className="edit-step-remove" onClick={() => removeStep(si)}>&times;</button>
                        </div>
                      </div>

                      {si < proc.steps.length - 1 && (
                        <div className="edit-handoff-row">
                          <div className="edit-handoff-connector">
                            <span className="edit-handoff-pipe" />
                            <span className="edit-handoff-tag">Handoff</span>
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
                </div>

                <div className="edit-add-actions">
                  <button type="button" className="edit-add-btn" onClick={() => addStep(false)}>+ Add Step</button>
                  <button type="button" className="edit-add-btn edit-add-decision-btn" onClick={() => addStep(true)}>+ Add Decision</button>
                </div>
              </div>
            </div>

            <div className={`edit-map-preview${previewCollapsed ? ' collapsed' : ''}`}>
              <div className="edit-preview-header">
                <span className="edit-preview-title">Flow Preview</span>
                <div className="edit-preview-controls">
                  <div className="edit-flow-view-toggle">
                    {FLOW_VIEWS.map(v => (
                      <button key={v.id} type="button" className={`edit-flow-view-btn${(flowView === v.id || (v.id === 'grid' && isWrapped)) ? ' active' : ''}`} onClick={() => setFlowView(v.id)} title={v.title || v.label}>
                        {v.icon}
                      </button>
                    ))}
                  </div>
                  <button type="button" className="edit-preview-collapse" onClick={() => setPreviewCollapsed(c => !c)} title={previewCollapsed ? 'Show preview' : 'Hide preview'}>
                    {previewCollapsed ? '\u25C0' : '\u25B6'}
                  </button>
                </div>
              </div>
              {!previewCollapsed && (
                <div className="edit-preview-body">
                  {processForFlow ? (
                    <div className="edit-flow-canvas-wrap">
                      <InteractiveFlowCanvas
                        process={processForFlow}
                        layout={flowView}
                        darkTheme={theme === 'dark'}
                        onWrapToggle={handleWrapToggle}
                        isWrapped={isWrapped}
                        storedPositions={resolveStoredPositions(proc.flowNodePositions, proc.steps.length, flowView)}
                        onPositionsChange={(positions, layout) => updateProc('flowNodePositions', { ...proc.flowNodePositions, [writeLayoutKey(proc.steps.length, layout)]: positions })}
                        customEdges={proc.flowCustomEdges}
                        onCustomEdgesChange={(edges) => updateProc('flowCustomEdges', edges)}
                        deletedEdges={proc.flowDeletedEdges}
                        onDeletedEdgesChange={(edges) => updateProc('flowDeletedEdges', edges)}
                      />
                    </div>
                  ) : (
                    <div className="edit-preview-empty">
                      <span className="edit-preview-empty-icon">&#x2B13;</span>
                      <p>Add steps to see your flow diagram</p>
                    </div>
                  )}
                </div>
              )}
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
              <p className="edit-stage-desc">Contact information for this process audit.</p>
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
          <button type="button" onClick={onBack} className="edit-cancel-btn">&larr; Dashboard</button>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Link href={`/report?id=${reportId}`} className="edit-view-report-btn" target="_blank" rel="noopener noreferrer">View Report</Link>
            <button type="button" className="edit-save-btn" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save All Changes'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
