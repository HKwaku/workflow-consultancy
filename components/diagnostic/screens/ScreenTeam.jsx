'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useDiagnostic } from '../DiagnosticContext';

import { PROCESSES } from '@/lib/diagnostic/processData';
const TEAM_PROCESSES = PROCESSES;

export default function ScreenTeam() {
  const searchParams = useSearchParams();
  const { goToScreen, updateProcessData, setProcessData, setTeamMode, authUser } = useDiagnostic();
  const urlTeamCode = searchParams.get('team')?.trim().toUpperCase() || '';
  const [selectedProcess, setSelectedProcess] = useState('');
  const [customProcess, setCustomProcess] = useState('');
  const [company, setCompany] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [created, setCreated] = useState(false);
  const [teamCode, setTeamCode] = useState('');
  const [joinUrl, setJoinUrl] = useState('');
  const [resultsUrl, setResultsUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [urlCodeApplied, setUrlCodeApplied] = useState(false);
  const [inviteEmails, setInviteEmails] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);

  const processName = customProcess.trim() || selectedProcess;

  useEffect(() => {
    if (urlTeamCode && !urlCodeApplied) {
      setJoinCode(urlTeamCode);
      setUrlCodeApplied(true);
    }
  }, [urlTeamCode, urlCodeApplied]);

  const handleSelectProcess = (name) => {
    setSelectedProcess(name);
    setCustomProcess('');
  };

  const handleCreateTeam = async () => {
    if (!processName.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      const resp = await fetch('/api/team?action=create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          processName: processName.trim(),
          company: company.trim() || null,
          createdByName: authUser?.name || null,
          createdByEmail: authUser?.email || null,
        }),
      });
      let data;
      try { data = await resp.json(); } catch (e) { throw new Error('Invalid response from server'); }
      if (!resp.ok) throw new Error(data.error || 'Failed to create team session');
      setTeamCode(data.teamCode);
      setJoinUrl(data.joinUrl || '');
      setResultsUrl(data.resultsUrl || '');
      setCreated(true);
      updateProcessData({ processType: 'custom', processName: processName.trim() });
      setTeamMode({ code: data.teamCode });
    } catch (err) {
      setCreateError(err.message || 'Failed to create team session');
    } finally {
      setCreating(false);
    }
  };

  const handleJoinSession = async () => {
    if (!joinCode.trim()) return;
    setJoining(true);
    setJoinError('');
    try {
      const resp = await fetch(`/api/team?action=info&code=${encodeURIComponent(joinCode.trim().toUpperCase())}`);
      let data;
      try { data = await resp.json(); } catch (e) { throw new Error('Invalid response from server'); }
      if (!resp.ok) throw new Error(data.error || 'Invalid team code');
      setProcessData({ processType: 'custom', processName: data.processName || 'Team process' });
      setTeamMode({ code: joinCode.trim().toUpperCase() });
      goToScreen(1);
    } catch (err) {
      setJoinError(err.message || 'Invalid team code');
    } finally {
      setJoining(false);
    }
  };

  const handleSendInvites = async () => {
    const emails = inviteEmails
      .split(/[,\n;]+/)
      .map((e) => e.trim())
      .filter((e) => e && e.includes('@'));
    if (emails.length === 0) return;
    setInviting(true);
    setInviteResult(null);
    try {
      const resp = await fetch('/api/team?action=invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamCode,
          invitees: emails.map((email) => ({ email })),
          inviterName: authUser?.name || 'Your colleague',
          processName: processName.trim(),
          company: company.trim() || null,
        }),
      });
      let data;
      try { data = await resp.json(); } catch (e) { throw new Error('Invalid response from server'); }
      if (!resp.ok) throw new Error(data.error || 'Failed to send invites');
      setInviteResult({ ok: true, sentCount: data.sentCount, total: data.total });
      if (data.sentCount === data.total) setInviteEmails('');
    } catch (err) {
      setInviteResult({ ok: false, error: err.message });
    } finally {
      setInviting(false);
    }
  };

  const handleStartDiagnostic = () => {
    if (!processName.trim()) return;
    setProcessData({ processType: 'custom', processName: processName.trim() });
    setTeamMode({ code: teamCode });
    goToScreen(1);
  };

  const handleBack = () => {
    goToScreen(0);
  };

  return (
    <div className="screen active">
      <div className="screen-card">
        <button type="button" className="mode-back-btn" onClick={handleBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={16} height={16}>
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <div className="mode-header">
          <span className="mode-eyebrow is-team">Team Alignment</span>
          <h2 className="screen-title mode-header-title">
            Set up your team session
          </h2>
          <p className="screen-subtitle mode-header-subtitle">
            Each person maps the process independently. The AI compares responses to reveal where your team&apos;s understanding diverges.
          </p>
        </div>

        {!created ? (
          <div id="teamSetupCreate">
            <div className="form-group">
              <label className="form-label-bold">Select a process:</label>
            </div>
            <div className="process-grid" id="teamProcessGrid">
              {TEAM_PROCESSES.map((p) => (
                <div
                  key={p.name}
                  className={`process-card ${selectedProcess === p.name ? 'selected' : ''}`}
                  onClick={() => handleSelectProcess(p.name)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSelectProcess(p.name)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="process-icon" dangerouslySetInnerHTML={{ __html: p.icon }} />
                  <div className="process-name">{p.name}</div>
                </div>
              ))}
            </div>
            <div className="form-group form-group-mt-md">
              <label>Or describe your own:</label>
              <input
                type="text"
                id="teamProcessName"
                placeholder="e.g., Quote to Contract"
                value={customProcess}
                onChange={(e) => setCustomProcess(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label htmlFor="teamCompany">Company name (optional)</label>
              <input type="text" id="teamCompany" placeholder="e.g., Acme Corp" value={company} onChange={(e) => setCompany(e.target.value)} />
            </div>
            {authUser?.name && (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-mid, #64748b)', margin: '0 0 8px' }}>
                Creating as <strong>{authUser.name}</strong>{authUser.email ? ` (${authUser.email})` : ''}
              </p>
            )}
            <div className="button-group">
              <button type="button" className="button button-secondary" onClick={handleBack}>
                ← Back
              </button>
              {createError && <p className="inline-error">{createError}</p>}
              <button
                type="button"
                className="button button-primary"
                id="teamCreateBtn"
                onClick={handleCreateTeam}
                disabled={!processName.trim() || creating}
              >
                {creating ? 'Creating…' : 'Create Team Session →'}
              </button>
            </div>
            <div className="team-join-divider">
              <p className="team-join-label">Already have a team code?</p>
              <div className="team-join-row">
                <input
                  type="text"
                  id="teamJoinCode"
                  className="team-join-code-input"
                  placeholder="ABC123"
                  maxLength={6}
                  value={joinCode}
                  onChange={(e) => { setJoinCode(e.target.value.toUpperCase()); setJoinError(''); }}
                />
                <button type="button" className="button button-secondary btn-nowrap" onClick={() => joinCode && handleJoinSession()} disabled={!joinCode.trim() || joining}>
                  {joining ? 'Joining…' : 'Join Session'}
                </button>
              </div>
              {joinError && <p className="inline-error-center">{joinError}</p>}
            </div>
          </div>
        ) : (
          <div id="teamSetupSuccess">
            <div className="team-success-wrap">
              <div className="team-success-icon">&#128101;</div>
              <h3 className="team-success-heading">Team Session Created!</h3>
              <p id="teamSuccessMsg" className="team-success-msg">
                Share the code below with your team.
              </p>
            </div>
            <div className="form-group team-code-card">
              <label>Share this code with your team</label>
              <div className="team-code-display" id="teamCodeDisplay">
                {teamCode}
              </div>
            </div>

            <div className="team-invite-section">
              <label className="form-label-bold">Invite team members by email</label>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-mid, #64748b)', margin: '0 0 8px' }}>
                Enter email addresses separated by commas or new lines.
              </p>
              <textarea
                className="team-invite-input"
                rows={3}
                placeholder={"alice@company.com\nbob@company.com"}
                value={inviteEmails}
                onChange={(e) => { setInviteEmails(e.target.value); setInviteResult(null); }}
              />
              <button
                type="button"
                className="button button-secondary btn-nowrap"
                style={{ marginTop: 8 }}
                onClick={handleSendInvites}
                disabled={inviting || !inviteEmails.trim()}
              >
                {inviting ? 'Sending…' : 'Send Invites'}
              </button>
              {inviteResult && inviteResult.ok && (
                <p className="inline-success" style={{ marginTop: 6 }}>
                  {inviteResult.sentCount} of {inviteResult.total} invite{inviteResult.total !== 1 ? 's' : ''} sent.
                </p>
              )}
              {inviteResult && !inviteResult.ok && (
                <p className="inline-error" style={{ marginTop: 6 }}>
                  {inviteResult.error}
                </p>
              )}
            </div>

            <div className="button-group button-group-mt">
              <button type="button" className="button button-secondary" onClick={handleBack}>
                ← Back
              </button>
              <button
                type="button"
                className="button button-primary btn-team-start"
                onClick={handleStartDiagnostic}
              >
                Start My Audit →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
