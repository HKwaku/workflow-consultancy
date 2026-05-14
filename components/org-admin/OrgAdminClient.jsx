'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import { apiFetch } from '@/lib/api-fetch';
import { ENTITLEMENT_KEYS } from '@/lib/entitlements';
import CustomerKeyPanel from './CustomerKeyPanel';
import UsageAnalyticsPanel from './UsageAnalyticsPanel';
import ModelAllowlistPanel from './ModelAllowlistPanel';
import IntegrationsPanel from './IntegrationsPanel';
import FirstRunOnboarding from './FirstRunOnboarding';

async function parseJsonResponse(resp) {
  const text = await resp.text();
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    throw new Error(
      resp.status === 404
        ? 'API not found. Deploy the latest app or ensure /api/organizations exists.'
        : `Server returned non-JSON (${resp.status}). Check API logs.`,
    );
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error(`Invalid JSON from server (${resp.status}).`);
  }
}

export default function OrgAdminClient({ user, accessToken, onSignOut }) {
  // Streamlined onboarding intercept — when ?firstRun=1 is in the URL we
  // bypass the full admin shell and render the 3-step create-org + paste-key
  // flow. Used by the trial-exhausted gate banner CTA.
  const [firstRun, setFirstRun] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('firstRun') === '1') setFirstRun(true);
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [platformAdmin, setPlatformAdmin] = useState(false);
  const [allOrgs, setAllOrgs] = useState(null);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [activePanel, setActivePanel] = useState('organisations');
  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteOrgAdmin, setInviteOrgAdmin] = useState(false);
  const [inviteEnt, setInviteEnt] = useState({
    [ENTITLEMENT_KEYS.COST_ANALYST]: false,
    [ENTITLEMENT_KEYS.PORTAL]: true,
    [ENTITLEMENT_KEYS.DEALS]: false,
    [ENTITLEMENT_KEYS.ANALYTICS]: false,
  });
  const [inviteBusy, setInviteBusy] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [createBusy, setCreateBusy] = useState(false);

  const adminMemberships = (memberships || []).filter((m) => m.is_org_admin);
  const canUse = adminMemberships.length > 0 || platformAdmin;

  const loadOrgs = useCallback(async () => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const resp = await apiFetch('/api/organizations', {}, accessToken);
      const data = await parseJsonResponse(resp);
      if (!resp.ok) throw new Error(data.error || 'Failed to load');
      setMemberships(data.memberships || []);
      setPlatformAdmin(!!data.platformAdmin);
      setAllOrgs(data.organizations || null);
      const orgList = data.organizations || [];
      const admins = (data.memberships || []).filter((m) => m.is_org_admin);
      setSelectedOrgId((prev) => {
        if (prev) return prev;
        if (data.platformAdmin && orgList.length) return orgList[0].id;
        if (admins.length) return admins[0].organization_id;
        return '';
      });
    } catch (e) {
      setError(e.message || 'Failed to load');
      setMemberships([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    loadOrgs();
  }, [loadOrgs]);

  const loadMembers = useCallback(async () => {
    if (!accessToken || !selectedOrgId) return;
    setMembersLoading(true);
    try {
      const resp = await apiFetch(`/api/organizations/${selectedOrgId}/members`, {}, accessToken);
      const data = await parseJsonResponse(resp);
      if (!resp.ok) throw new Error(data.error || 'Failed to load members');
      setMembers(data.members || []);
    } catch (e) {
      setError(e.message || 'Failed to load members');
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  }, [accessToken, selectedOrgId]);

  useEffect(() => {
    if (selectedOrgId) loadMembers();
  }, [selectedOrgId, loadMembers]);

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !selectedOrgId) return;
    setInviteBusy(true);
    setError(null);
    try {
      const resp = await apiFetch(
        `/api/organizations/${selectedOrgId}/members`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: inviteEmail.trim(),
            isOrgAdmin: inviteOrgAdmin,
            entitlements: inviteEnt,
          }),
        },
        accessToken,
      );
      const data = await parseJsonResponse(resp);
      if (!resp.ok) throw new Error(data.error || 'Invite failed');
      setInviteEmail('');
      setInviteOrgAdmin(false);
      await loadMembers();
    } catch (err) {
      setError(err.message || 'Invite failed');
    } finally {
      setInviteBusy(false);
    }
  };

  const handleCreateOrg = async (e) => {
    e.preventDefault();
    if (!newOrgName.trim() || !platformAdmin) return;
    setCreateBusy(true);
    setError(null);
    try {
      const resp = await apiFetch(
        '/api/organizations',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newOrgName.trim() }),
        },
        accessToken,
      );
      const data = await parseJsonResponse(resp);
      if (!resp.ok) throw new Error(data.error || 'Create failed');
      setNewOrgName('');
      await loadOrgs();
      if (data.organization?.id) {
        setSelectedOrgId(data.organization.id);
        setActivePanel('setup');
      }
    } catch (err) {
      setError(err.message || 'Create failed');
    } finally {
      setCreateBusy(false);
    }
  };

  const toggleEnt = (key) => {
    setInviteEnt((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const [mfaReport, setMfaReport] = useState(null);
  const [mfaLoading, setMfaLoading] = useState(false);
  const [rowBusyId, setRowBusyId] = useState(null);

  useEffect(() => {
    if (!accessToken || !selectedOrgId || activePanel !== 'members') return;
    let cancelled = false;
    setMfaLoading(true);
    apiFetch(`/api/organizations/${selectedOrgId}/mfa-status`, {}, accessToken)
      .then((r) => r.json())
      .then((data) => { if (!cancelled && data && !data.error) setMfaReport(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setMfaLoading(false); });
    return () => { cancelled = true; };
  }, [accessToken, selectedOrgId, activePanel, members.length]);

  const patchMember = useCallback(async (member, patch) => {
    if (!accessToken || !selectedOrgId) return;
    setRowBusyId(member.user_id);
    setError(null);
    const prev = members;
    // optimistic update
    setMembers((list) => list.map((m) => (m.user_id === member.user_id
      ? { ...m, ...('isOrgAdmin' in patch ? { is_org_admin: patch.isOrgAdmin } : {}),
          ...(patch.entitlements ? { entitlements: { ...m.entitlements, ...patch.entitlements } } : {}) }
      : m)));
    try {
      const resp = await apiFetch(
        `/api/organizations/${selectedOrgId}/members/${member.user_id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        },
        accessToken,
      );
      const data = await parseJsonResponse(resp);
      if (!resp.ok) throw new Error(data.error || 'Update failed');
      setMembers((list) => list.map((m) => (m.user_id === member.user_id ? { ...m, ...data.member } : m)));
    } catch (err) {
      setError(err.message || 'Update failed');
      setMembers(prev);
    } finally {
      setRowBusyId(null);
    }
  }, [accessToken, selectedOrgId, members]);

  const orgOptions = platformAdmin && allOrgs?.length
    ? allOrgs
    : adminMemberships.map((m) => ({
        id: m.organization_id,
        name: m.organization?.name || m.organization_id,
        slug: m.organization?.slug,
      }));

  if (firstRun) {
    return (
      <div className="portal-viewport">
        <header className="dashboard-header">
          <div className="header-left">
            <Link href="/" className="header-logo">
              Vesno<span className="header-logo-dot">.</span>
            </Link>
            <div className="header-divider" />
            <span className="header-title">Get set up</span>
          </div>
          <div className="header-right">
            <ThemeToggle className="header-theme-btn" />
          </div>
        </header>
        <main className="portal-wrap" style={{ maxWidth: 720, margin: '40px auto', padding: '0 24px' }}>
          <FirstRunOnboarding accessToken={accessToken} onComplete={() => setFirstRun(false)} />
        </main>
      </div>
    );
  }

  return (
    <div className="portal-viewport">
      <header className="dashboard-header">
        <div className="header-left">
          <Link href="/" className="header-logo">
            Vesno<span className="header-logo-dot">.</span>
          </Link>
          <div className="header-divider" />
          <span className="header-title">Organisation admin</span>
        </div>
        <div className="header-right">
          <ThemeToggle className="header-theme-btn" />
          <span className="header-email">{(user?.email || '').slice(0, 24)}{(user?.email || '').length > 24 ? '…' : ''}</span>
          <button type="button" onClick={onSignOut} className="header-btn">
            Sign Out
          </button>
        </div>
      </header>

      <div className="portal-wrap org-admin-wrap">
        {error && (
          <div className="portal-error-banner org-admin-error-banner">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="portal-error-close">
              &times;
            </button>
          </div>
        )}

        {loading ? (
          <div className="portal-loading">
            <div className="spinner" />
            <p className="org-admin-muted">Loading…</p>
          </div>
        ) : !canUse ? (
          <div className="dash-card portal-content-card org-admin-card">
            <p className="org-admin-body">
              You don't have organisation admin access. Ask a platform administrator to assign you as an org admin, or add your email to{' '}
              <code className="org-admin-code">PLATFORM_ADMIN_EMAILS</code>.
            </p>
            <Link href="/workspace/map" className="portal-empty-cta org-admin-cta">
              Back to workspace
            </Link>
          </div>
        ) : (
          <>
            <nav className="portal-section-tabs" role="tablist" aria-label="Admin sections">
              <button
                type="button"
                role="tab"
                aria-selected={activePanel === 'organisations'}
                className={`portal-section-tab ${activePanel === 'organisations' ? 'active' : ''}`}
                onClick={() => setActivePanel('organisations')}
              >
                Organisations
                {(orgOptions || []).length > 0 && (
                  <span className="portal-section-tab-badge">{orgOptions.length}</span>
                )}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activePanel === 'members'}
                className={`portal-section-tab ${activePanel === 'members' ? 'active' : ''}`}
                onClick={() => setActivePanel('members')}
              >
                Members
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activePanel === 'api-keys'}
                className={`portal-section-tab ${activePanel === 'api-keys' ? 'active' : ''}`}
                onClick={() => setActivePanel('api-keys')}
                disabled={!selectedOrgId}
                title={selectedOrgId ? '' : 'Select an organisation first'}
              >
                API keys
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activePanel === 'integrations'}
                className={`portal-section-tab ${activePanel === 'integrations' ? 'active' : ''}`}
                onClick={() => setActivePanel('integrations')}
                disabled={!selectedOrgId}
                title={selectedOrgId ? '' : 'Select an organisation first'}
              >
                Integrations
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activePanel === 'usage'}
                className={`portal-section-tab ${activePanel === 'usage' ? 'active' : ''}`}
                onClick={() => setActivePanel('usage')}
                disabled={!selectedOrgId}
                title={selectedOrgId ? '' : 'Select an organisation first'}
              >
                Usage
              </button>
            </nav>

            {activePanel === 'api-keys' && selectedOrgId && (
              <>
                <CustomerKeyPanel orgId={selectedOrgId} accessToken={accessToken} />
                <ModelAllowlistPanel orgId={selectedOrgId} accessToken={accessToken} />
              </>
            )}
            {activePanel === 'integrations' && selectedOrgId && (
              <IntegrationsPanel orgId={selectedOrgId} accessToken={accessToken} />
            )}
            {activePanel === 'usage' && selectedOrgId && (
              <UsageAnalyticsPanel orgId={selectedOrgId} accessToken={accessToken} />
            )}

            {activePanel === 'organisations' && (
              <div className="dash-card portal-content-card org-admin-card">
                <h3 className="org-admin-panel-title">Organisations</h3>
                {(orgOptions || []).length === 0 ? (
                  <p className="org-admin-muted">
                    No organisations yet.{platformAdmin && ' Use the form below to create one.'}
                  </p>
                ) : (
                  <div className="org-admin-members-wrap">
                    <table className="org-admin-members-table">
                      <thead>
                        <tr>
                          <th scope="col">Name</th>
                          <th scope="col">Slug</th>
                          <th scope="col" />
                        </tr>
                      </thead>
                      <tbody>
                        {orgOptions.map((o) => (
                          <tr key={o.id}>
                            <td>{o.name}</td>
                            <td className="org-admin-mono">{o.slug || '-'}</td>
                            <td>
                              <button
                                type="button"
                                className="portal-flow-btn compact"
                                onClick={() => { setSelectedOrgId(o.id); setActivePanel('members'); }}
                              >
                                Manage members
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {platformAdmin && (
                  <form className="org-admin-form" onSubmit={handleCreateOrg}>
                    <h4 className="org-admin-subtitle">New organisation</h4>
                    <label className="org-admin-label">
                      Organisation name
                      <input
                        className="auth-input org-admin-input"
                        value={newOrgName}
                        onChange={(e) => setNewOrgName(e.target.value)}
                        placeholder="Acme Ltd"
                      />
                    </label>
                    <div className="org-admin-form-actions">
                      <button type="submit" className="portal-flow-btn portal-flow-btn-primary" disabled={createBusy || !newOrgName.trim()}>
                        {createBusy ? 'Creating…' : 'Create organisation'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {activePanel === 'members' && (
              <div className="dash-card portal-content-card org-admin-card">
                <div className="org-admin-panel-header">
                  <h3 className="org-admin-panel-title">Members</h3>
                  {(orgOptions || []).length > 0 && (
                    <label className="org-admin-selector">
                      Organisation
                      <select
                        className="auth-input org-admin-input"
                        value={selectedOrgId}
                        onChange={(e) => setSelectedOrgId(e.target.value)}
                      >
                        {orgOptions.map((o) => (
                          <option key={o.id} value={o.id}>{o.name}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>

                {!selectedOrgId ? (
                  <p className="org-admin-body">Select an organisation to invite users and view members.</p>
                ) : (
                  <>
                    {mfaReport && mfaReport.totalMembers > 0 && (
                      <div
                        className={`org-admin-mfa-banner ${mfaReport.fullyEnforced ? 'ok' : 'warn'}`}
                        role="status"
                        aria-live="polite"
                      >
                        <strong>MFA: {mfaReport.mfaEnabled}/{mfaReport.totalMembers} members enrolled</strong>
                        <span>
                          {mfaReport.fullyEnforced
                            ? 'All members have a verified second factor — SOC 2 CC6.2 satisfied.'
                            : `${mfaReport.mfaDisabled} member${mfaReport.mfaDisabled === 1 ? '' : 's'} without MFA. Chase them: SOC 2 CC6.2 expects 100% enforcement.`}
                        </span>
                      </div>
                    )}
                    {mfaLoading && !mfaReport && (
                      <p className="org-admin-muted">Checking MFA status…</p>
                    )}

                    <form className="org-admin-form" onSubmit={handleInvite}>
                      <div className="org-admin-invite-row">
                        <label className="org-admin-label">
                          Email
                          <input
                            className="auth-input org-admin-input"
                            type="email"
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                            placeholder="colleague@company.com"
                            required
                          />
                        </label>
                        <label className="org-admin-check">
                          <input type="checkbox" checked={inviteOrgAdmin} onChange={(e) => setInviteOrgAdmin(e.target.checked)} />
                          Org admin
                        </label>
                      </div>
                      <fieldset className="org-admin-fieldset">
                        <legend className="org-admin-legend">Entitlements</legend>
                        <div className="org-admin-ent-grid">
                          {[
                            { key: ENTITLEMENT_KEYS.COST_ANALYST, label: 'Cost analyst' },
                            { key: ENTITLEMENT_KEYS.PORTAL, label: 'Dashboard' },
                            { key: ENTITLEMENT_KEYS.DEALS, label: 'Deals' },
                            { key: ENTITLEMENT_KEYS.ANALYTICS, label: 'Analytics' },
                          ].map(({ key, label }) => (
                            <label key={key} className="org-admin-check">
                              <input type="checkbox" checked={!!inviteEnt[key]} onChange={() => toggleEnt(key)} />
                              {label}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <div className="org-admin-form-actions">
                        <button type="submit" className="portal-flow-btn portal-flow-btn-primary" disabled={inviteBusy}>
                          {inviteBusy ? 'Sending…' : 'Invite / add user'}
                        </button>
                      </div>
                    </form>

                    {membersLoading ? (
                      <p className="org-admin-muted">Loading members…</p>
                    ) : (
                      <div className="org-admin-members-wrap">
                        <table className="org-admin-members-table">
                          <thead>
                            <tr>
                              <th scope="col">Email</th>
                              <th scope="col">Org admin</th>
                              {[
                                { key: ENTITLEMENT_KEYS.COST_ANALYST, label: 'Cost analyst' },
                                { key: ENTITLEMENT_KEYS.PORTAL, label: 'Dashboard' },
                                { key: ENTITLEMENT_KEYS.DEALS, label: 'Deals' },
                                { key: ENTITLEMENT_KEYS.ANALYTICS, label: 'Analytics' },
                              ].map(({ key, label }) => (
                                <th key={key} scope="col">{label}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {members.length === 0 ? (
                              <tr><td colSpan={6} className="org-admin-empty-cell">No members yet.</td></tr>
                            ) : members.map((m) => {
                              const busy = rowBusyId === m.user_id;
                              return (
                                <tr key={m.id}>
                                  <td>{m.email}</td>
                                  <td>
                                    <input
                                      type="checkbox"
                                      checked={!!m.is_org_admin}
                                      disabled={busy || !m.user_id}
                                      onChange={(e) => patchMember(m, { isOrgAdmin: e.target.checked })}
                                      aria-label={`Org admin for ${m.email}`}
                                    />
                                  </td>
                                  {[
                                    ENTITLEMENT_KEYS.COST_ANALYST,
                                    ENTITLEMENT_KEYS.PORTAL,
                                    ENTITLEMENT_KEYS.DEALS,
                                    ENTITLEMENT_KEYS.ANALYTICS,
                                  ].map((key) => (
                                    <td key={key}>
                                      <input
                                        type="checkbox"
                                        checked={!!m.entitlements?.[key]}
                                        disabled={busy || !m.user_id}
                                        onChange={(e) => patchMember(m, { entitlements: { [key]: e.target.checked } })}
                                        aria-label={`${key} for ${m.email}`}
                                      />
                                    </td>
                                  ))}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
