'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useDiagnostic } from '../DiagnosticContext';
import { useAuth } from '@/lib/useAuth';
import { buildLocalResults, computeDurationFromSteps } from '@/lib/diagnostic';

/** Infer the primary bottleneck type from empirical step + handoff data. */
function inferBottleneck(steps, handoffs) {
  const approvals  = steps.filter(s => s.isApproval || s.isDecision).length;
  const multiSys   = steps.filter(s => (s.systems || []).length >= 2).length;
  const external   = steps.filter(s => s.isExternal).length;
  const flagged    = steps.filter(s => s.isBottleneck).length;
  const poorHoffs  = (handoffs || []).filter(h => ['yes-multiple','yes-major','confusing','unclear'].includes(h.clarity)).length;
  const scores = { approvals, systems: multiSys * 2, handoffs: external + poorHoffs * 2, 'manual-work': flagged * 2 };
  const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return top && top[1] > 0 ? top[0] : 'manual-work';
}

/** Auto-populate cost fields from process mapping data so the cost analysis page has full context. */
function enrichProcessCosts(p) {
  const steps    = p.steps || [];
  const handoffs = p.handoffs || [];
  const computed = computeDurationFromSteps(steps);
  const depts    = new Set(steps.filter(s => !s.isExternal && s.department).map(s => s.department));
  const teamSize = depts.size > 0 ? depts.size : (p.costs?.teamSize ?? 1);
  const hoursPerInstance = (computed?.hoursPerInstance > 0 ? computed.hoursPerInstance : null) ?? p.costs?.hoursPerInstance ?? 4;
  const annual   = p.frequency?.annual ?? p.costs?.annual ?? 12;
  const bottleneckReason = p.bottleneck?.reason || inferBottleneck(steps, handoffs);
  return {
    ...p,
    costs: { ...p.costs, hoursPerInstance, teamSize, annual },
    bottleneck: { ...p.bottleneck, reason: bottleneckReason },
    savings: p.savings?.percent ? p.savings : { percent: 20 },
  };
}

/* ── SSE stream reader ────────────────────────────────────────── */

async function readDiagnosticStream(payload, onProgress) {
  const resp = await fetch('/api/process-diagnostic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) throw new Error('Analysis failed');

  const contentType = resp.headers.get('content-type') || '';

  // Legacy JSON fallback (in case server returns non-streaming response)
  if (!contentType.includes('text/event-stream')) {
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'Analysis failed');
    return data;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let result = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);

      let eventName = 'message';
      let dataStr = '';
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event: ')) eventName = line.slice(7).trim();
        else if (line.startsWith('data: ')) dataStr = line.slice(6).trim();
      }
      if (!dataStr) continue;

      let parsed;
      try { parsed = JSON.parse(dataStr); } catch { continue; }

      if (eventName === 'progress') {
        onProgress(parsed.message || '');
      } else if (eventName === 'done') {
        result = parsed;
      } else if (eventName === 'error') {
        throw new Error(parsed.error || 'Analysis failed');
      }
    }
  }

  if (!result?.success) throw new Error('Analysis failed');
  return result;
}

/* ── Component ───────────────────────────────────────────────── */

export default function Screen6Complete() {
  const router = useRouter();
  const { user: sessionUser, loading: authLoading, accessToken } = useAuth();
  const {
    completedProcesses,
    processData,
    contact,
    authUser,
    diagnosticMode,
    customDepartments,
    editingReportId,
    sendDiagnosticReport,
    teamMode,
    auditTrail,
    goToScreen,
    setContact,
  } = useDiagnostic();

  const [status, setStatus] = useState('loading'); // loading | done | error
  const [reportId, setReportId] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [progressMessage, setProgressMessage] = useState('Starting analysis…');
  const [findings, setFindings] = useState([]);
  const [pendingUrl, setPendingUrl] = useState(null);

  const processes = completedProcesses.length > 0 ? completedProcesses : [processData];

  useEffect(() => {
    if (!contact?.email && sessionUser?.email) {
      setContact({
        name: contact?.name || sessionUser?.user_metadata?.full_name || sessionUser?.email || '',
        email: sessionUser.email,
        company: contact?.company || '',
        title: contact?.title || '',
        industry: contact?.industry || '',
        teamSize: contact?.teamSize || '',
      });
    }
  }, [contact?.email, sessionUser?.email, setContact]);

  const effectiveEmail = contact?.email || authUser?.email || sessionUser?.email;
  const effectiveContact = {
    name: contact?.name || authUser?.name || sessionUser?.user_metadata?.full_name || sessionUser?.email || '',
    email: effectiveEmail || '',
    company: contact?.company || '',
    title: contact?.title || '',
    industry: contact?.industry || '',
    teamSize: contact?.teamSize || '',
    segment: processData?.segment || '',
    ...(processData?.maEntity && { maEntity: processData.maEntity }),
    ...(processData?.maTimeline && { maTimeline: processData.maTimeline }),
    ...(processData?.peStage && { peStage: processData.peStage }),
    ...(processData?.highStakesType && { highStakesType: processData.highStakesType }),
    ...(processData?.highStakesDeadline && { highStakesDeadline: processData.highStakesDeadline }),
  };

  useEffect(() => {
    if (!effectiveEmail) {
      if (authLoading && !contact?.email) return;
      setStatus('error');
      setErrorMsg('Contact details missing. Please go back and enter your details.');
      return;
    }

    let cancelled = false;

    async function run() {
      try {
        setStatus('loading');
        setProgressMessage('Starting analysis…');
        const teamCode = teamMode?.code;

        if (teamCode) {
          const responseData = {
            processData: processes[0] || processData,
            metrics: {
              elapsedDays: processData?.lastExample?.elapsedDays ?? 0,
              stepsCount: (processData?.steps || []).length,
              handoffCount: (processData?.handoffs || []).length,
              poorHandoffs: (processData?.handoffs || []).filter(h => h.clarity === 'yes-multiple' || h.clarity === 'yes-major').length,
              performance: processData?.performance || '',
              issues: processData?.issues || [],
              biggestDelay: processData?.biggestDelay || '',
              bottleneck: processData?.bottleneck?.name || '',
              totalUserHours: processData?.userTime?.total || 0,
            },
          };
          const teamResp = await fetch('/api/team?action=submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              teamCode,
              respondentName: effectiveContact.name || '',
              respondentEmail: effectiveContact.email || null,
              respondentDepartment: contact?.department || contact?.title || null,
              responseData,
            }),
          });
          if (!teamResp.ok) {
            let errData;
            try { errData = await teamResp.json(); } catch { errData = {}; }
            throw new Error(errData.error || 'Failed to submit team response');
          }
          if (cancelled) return;
          setPendingUrl(`/team-results?code=${encodeURIComponent(teamCode)}`);
          setStatus('done');
          return;
        }

        const sanitizedProcesses = processes.filter(Boolean).map((p) => {
          const enriched = enrichProcessCosts(p);
          return {
            processName: enriched.processName || enriched.name || 'Process',
            processType: enriched.processType || enriched.type || 'other',
            steps: enriched.steps || [],
            handoffs: enriched.handoffs || [],
            definition: enriched.definition,
            lastExample: enriched.lastExample,
            costs: enriched.costs,
            frequency: enriched.frequency,
            bottleneck: enriched.bottleneck,
            savings: enriched.savings,
            userTime: enriched.userTime,
          };
        });
        if (sanitizedProcesses.length === 0) throw new Error('No process data to analyse.');

        const payload = {
          processes: sanitizedProcesses,
          contact: effectiveContact.email ? effectiveContact : undefined,
          qualityScore: { averageScore: 70 },
          diagnosticMode: diagnosticMode || 'comprehensive',
          timestamp: new Date().toISOString(),
        };

        let result;
        try {
          result = await readDiagnosticStream(payload, (msg) => {
            if (!cancelled) setProgressMessage(msg);
          });
        } catch (apiErr) {
          result = buildLocalResults({ processes, contact: effectiveContact });
          if (!result.success) throw apiErr;
        }

        if (cancelled) return;

        if (!cancelled) setProgressMessage('Saving your report…');

        const reportPayload = {
          editingReportId: editingReportId || null,
          diagnosticMode: diagnosticMode || 'comprehensive',
          contact: effectiveContact,
          fallbackEmail: sessionUser?.email || undefined,
          authToken: accessToken || undefined,
          summary: {
            totalProcesses: (result.processes || []).length,
            totalAnnualCost: result.totalCost || 0,
            potentialSavings: result.potentialSavings || 0,
            analysisType: result.analysisType || 'rule-based',
            qualityScore: result.qualityScore?.averageScore || 0,
          },
          recommendations: result.recommendations || [],
          automationScore: result.automationScore || {},
          roadmap: {},
          processes: (result.processes || []).map((p, idx) => {
            const raw = processes[idx] || {};
            const steps = (raw.steps || []).map((s, si) => ({
              number: si + 1,
              name: s.name || '',
              department: s.department || '',
              isDecision: !!s.isDecision,
              isExternal: !!s.isExternal,
              branches: s.branches || [],
            }));
            const handoffs = raw.handoffs || [];
            const departments = [...new Set(steps.map((s) => s.department).filter(Boolean))];
            return { ...p, steps, handoffs, handoffCount: handoffs.length, departments };
          }),
          rawProcesses: JSON.parse(JSON.stringify(processes)),
          customDepartments: customDepartments || [],
          auditTrail: (auditTrail || []).slice(-50),
          costAnalystEmail: contact?.costAnalystEmail || null,
        };

        const reportData = await sendDiagnosticReport(reportPayload, { accessToken: accessToken || undefined });
        if (cancelled) return;

        setReportId(reportData.reportId);

        if (reportData.costAnalysisUrl && typeof window !== 'undefined') {
          try {
            sessionStorage.setItem('costAnalysisUrl_' + reportData.reportId, reportData.costAnalysisUrl);
            localStorage.setItem('costAnalysisUrl_' + reportData.reportId, reportData.costAnalysisUrl);
          } catch { /* ignore */ }
        }

        // Auto-send cost analysis link to the nominated analyst
        const analystEmail = contact?.costAnalystEmail;
        if (analystEmail && reportData.costAnalysisUrl && reportData.reportId) {
          try {
            await fetch('/api/share-cost-analysis', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                reportId: reportData.reportId,
                managerEmail: analystEmail,
                costUrl: reportData.costAnalysisUrl,
                contactName: effectiveContact.name || '',
                company: effectiveContact.company || '',
              }),
            });
          } catch { /* non-fatal */ }
        }

        // Extract top 3 findings for the intermediate screen
        const recs = result.recommendations || [];
        const topFindings = recs.slice(0, 3).map(r =>
          typeof r === 'string' ? r : (r.title || r.description || r.text || JSON.stringify(r))
        ).filter(Boolean);
        setFindings(topFindings);

        if (reportData.reportUrl || reportData.reportId) {
          setPendingUrl(`/report?id=${reportData.reportId}`);
        }
        setStatus('done');
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setErrorMsg(err.message || 'Something went wrong. Please try again.');
        }
      }
    }

    run();
    return () => { cancelled = true; };
  }, [effectiveEmail, teamMode?.code, authLoading, contact?.email]);

  // Auto-redirect after 4 seconds once in the 'done' intermediate state
  useEffect(() => {
    if (status !== 'done' || !pendingUrl) return;
    const timer = setTimeout(() => {
      router.push(pendingUrl);
    }, 4000);
    return () => clearTimeout(timer);
  }, [status, pendingUrl, router]);

  function handleViewReport() {
    if (pendingUrl) router.push(pendingUrl);
  }

  return (
    <div className="screen active">
      <div className="screen-card">
        {status === 'loading' && (
          <>
            <h1 className="screen-title">Generating your report…</h1>
            <div className="loading-state loading-fallback">
              <div className="loading-spinner" />
              <p className="sc6-progress-message">{progressMessage}</p>
            </div>
          </>
        )}

        {status === 'done' && (
          <>
            <div className="sc6-done-header">
              <span className="sc6-done-check">✓</span>
              <h1 className="screen-title" style={{ margin: 0 }}>Process audit complete</h1>
            </div>

            {findings.length > 0 && (
              <>
                <p className="screen-subtitle" style={{ marginBottom: 14 }}>
                  Top findings from your process analysis:
                </p>
                <ul className="sc6-findings">
                  {findings.map((f, i) => (
                    <li key={i} className="sc6-finding-item">
                      <span className="sc6-finding-bullet">▶</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {pendingUrl && (
              <button
                type="button"
                className="button button-primary"
                onClick={handleViewReport}
              >
                View your report →
              </button>
            )}

            <p className="sc6-redirect-hint">Redirecting automatically in a few seconds…</p>
          </>
        )}

        {status === 'error' && (
          <>
            <h1 className="screen-title">Something went wrong</h1>
            <p className="screen-subtitle">{errorMsg}</p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    try { localStorage.removeItem('processDiagnosticProgress'); } catch {}
                  }
                  window.location.href = '/process-audit';
                }}
              >
                Start fresh
              </button>
              <button
                type="button"
                className="button"
                style={{ background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)' }}
                onClick={() => goToScreen(5)}
              >
                Go back to enter details
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
