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

export default function Screen6Complete({ onComplete }) {
  const router = useRouter();
  const { user: sessionUser, loading: authLoading, accessToken } = useAuth();
  const {
    completedProcesses,
    processData,
    contact,
    authUser,
    moduleId,
    diagnosticMode,
    customDepartments,
    editingReportId,
    sendDiagnosticReport,
    teamMode,
    auditTrail,
    goToScreen,
    setContact,
    dealId,
    dealCode,
    dealRole,
    dealName,
    dealParticipants,
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
  // moduleId is the canonical module identifier (e.g. 'pe', 'ma', 'scaling', 'high-risk-ops').
  // It's set at the AuditGate and stored in DiagnosticContext. We pass it both as a top-level
  // field on the API payload AND as contact.segment so the agent and Supabase both receive it.
  const effectiveModuleId = moduleId || processData?.segment || '';
  const effectiveContact = {
    name: contact?.name || authUser?.name || sessionUser?.user_metadata?.full_name || sessionUser?.email || '',
    email: effectiveEmail || '',
    company: contact?.company || '',
    title: contact?.title || '',
    industry: contact?.industry || '',
    teamSize: contact?.teamSize || '',
    segment: effectiveModuleId,
    ...(processData?.maEntity && { maEntity: processData.maEntity }),
    ...(processData?.maTimeline && { maTimeline: processData.maTimeline }),
    ...(processData?.peStage && { peStage: processData.peStage }),
    ...(processData?.peYearsIn && { peYearsIn: processData.peYearsIn }),
    ...(processData?.peSopStatus && { peSopStatus: processData.peSopStatus }),
    ...(processData?.peKeyPerson && { peKeyPerson: processData.peKeyPerson }),
    ...(processData?.peReportingImpact && { peReportingImpact: processData.peReportingImpact }),
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
          moduleId: effectiveModuleId || undefined,
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
          dealParticipantToken: authUser?.dealParticipantToken || null,
          dealCode: authUser?.dealCode || null,
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

        // Cost-analysis share notification is fired server-side by
        // /api/send-diagnostic-report when the report is pending cost analysis.

        // Extract top 3 findings for the intermediate screen
        const recs = result.recommendations || [];
        const topFindings = recs.slice(0, 3).map(r =>
          typeof r === 'string' ? r : (r.title || r.description || r.text || JSON.stringify(r))
        ).filter(Boolean);
        setFindings(topFindings);

        // For PE Roll-up deals, redirect to the deal dashboard so all participants are visible
        const effectiveDealId = dealId || processData?.dealId;
        if (effectiveModuleId === 'pe' && effectiveDealId) {
          setPendingUrl(`/deals/${effectiveDealId}`);
        } else if (reportData.reportId) {
          // Chat-first: notify parent to load report in the workspace
          if (typeof onComplete === 'function') {
            onComplete(reportData.reportId);
          } else {
            setPendingUrl(`/report?id=${reportData.reportId}`);
          }
        } else if (!reportData.storedInSupabase) {
          throw new Error('Your report could not be saved. Please check your connection and try again.');
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

        {status === 'done' && (() => {
          const effectiveDealId = dealId || processData?.dealId;
          const isPEDeal = effectiveModuleId === 'pe' && effectiveDealId;
          const targets = dealParticipants?.filter((p) => p.role === 'portfolio_company') || [];
          const isPlatform = dealRole === 'platform_company';
          const isPortfolio = dealRole === 'portfolio_company' || !!authUser?.dealParticipantToken && !isPlatform;

          if (isPEDeal) {
            return (
              <>
                <div className="sc6-done-header">
                  <span className="sc6-done-check">✓</span>
                  <h1 className="screen-title" style={{ margin: 0 }}>Process mapped</h1>
                </div>

                <div className="sc6-pe-deal-card">
                  <div className="sc6-pe-deal-name">{dealName || 'PE Roll-up'}</div>
                  {isPlatform ? (
                    <>
                      <p className="sc6-pe-deal-desc">
                        Your platform company process is saved.
                        {targets.length > 0 && (
                          <> Share the links below with your {targets.length === 1 ? 'target' : `${targets.length} targets`} to complete the roll-up.</>
                        )}
                      </p>
                      {targets.length > 0 && (
                        <div className="sc6-pe-targets">
                          {targets.map((p) => (
                            <div key={p.id} className="sc6-pe-target-row">
                              <span className="sc6-pe-target-name">{p.companyName}</span>
                              {p.inviteUrl ? (
                                <button
                                  type="button"
                                  className="sc6-pe-copy-btn"
                                  onClick={() => navigator.clipboard?.writeText(p.inviteUrl)}
                                >
                                  Copy invite link
                                </button>
                              ) : (
                                <span className="sc6-pe-target-status">Invite pending</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="sc6-pe-deal-desc">
                      Your process is saved and shared with the deal coordinator.
                    </p>
                  )}
                </div>

                {pendingUrl && (
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={handleViewReport}
                  >
                    Go to deal dashboard →
                  </button>
                )}

                <p className="sc6-redirect-hint">Redirecting to the deal dashboard…</p>
              </>
            );
          }

          return (
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

              {!pendingUrl && onComplete && (
                <p className="sc6-redirect-hint">Report ready — loading in your workspace…</p>
              )}
              {pendingUrl && (
                <p className="sc6-redirect-hint">Redirecting automatically in a few seconds…</p>
              )}
            </>
          );
        })()}

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
