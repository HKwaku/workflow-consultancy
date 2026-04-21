'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import { apiFetch } from '@/lib/api-fetch';
import { ENTITLEMENT_KEYS } from '@/lib/entitlements';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [platformAdmin, setPlatformAdmin] = useState(false);
  const [allOrgs, setAllOrgs] = useState(null);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [activePanel, setActivePanel] = useState('users');
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
    if (!accessToken) return;
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

  const orgOptions = platformAdmin && allOrgs?.length
    ? allOrgs
    : adminMemberships.map((m) => ({
        id: m.organization_id,
        name: m.organization?.name || m.organization_id,
        slug: m.organization?.slug,
      }));

  const selectedOrg = (orgOptions || []).find((o) => o.id === selectedOrgId) || null;

  return (
    <div className="org-admin-shell portal-viewport dashboard-viewport">
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
          <Link href="/portal" className="header-primary-cta" style={{ textDecoration: 'none' }}>
            Dashboard
          </Link>
          <span className="header-email">{(user?.email || '').slice(0, 24)}{(user?.email || '').length > 24 ? '…' : ''}</span>
          <button type="button" onClick={onSignOut} className="header-btn">
            Sign Out
          </button>
        </div>
      </header>

      <div className="portal-wrap dashboard-wrap org-admin-wrap">
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
              You don’t have organization admin access. Ask a platform administrator to assign you as an org admin, or set{' '}
              <code className="org-admin-code">PLATFORM_ADMIN_EMAILS</code> for your account.
            </p>
            <Link href="/portal" className="portal-empty-cta org-admin-cta">
              Back to dashboard
            </Link>
          </div>
        ) : (
          <div className="org-admin-layout">
            <aside className="org-admin-sidebar" aria-label="Organisations and sections">
              <h2 className="org-admin-sidebar-title">Organisations</h2>
              <p className="org-admin-sidebar-hint">Select an organisation to manage it.</p>
              <div className="org-admin-org-table-wrap">
                <table className="org-admin-org-table">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Slug</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(orgOptions || []).length === 0 ? (
                      <tr>
                        <td colSpan={2} className="org-admin-empty-cell">
                          No organisations yet.
                          {platformAdmin && ' Create one under Organisation setup.'}
                        </td>
                      </tr>
                    ) : (
                      (orgOptions || []).map((o) => (
                        <tr
                          key={o.id}
                          className={`org-admin-org-tr${selectedOrgId === o.id ? ' is-active' : ''}`}
                          onClick={() => setSelectedOrgId(o.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedOrgId(o.id);
                            }
                          }}
                          tabIndex={0}
                          role="button"
                          aria-pressed={selectedOrgId === o.id}
                          aria-label={`Select ${o.name}`}
                        >
                          <td>{o.name}</td>
                          <td className="org-admin-mono">{o.slug || '—'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <nav className="org-admin-section-nav" aria-label="Admin sections">
                <button
                  type="button"
                  className={`org-admin-section-btn${activePanel === 'setup' ? ' is-active' : ''}`}
                  onClick={() => setActivePanel('setup')}
                >
                  Organisation setup
                </button>
                <button
                  type="button"
                  className={`org-admin-section-btn${activePanel === 'users' ? ' is-active' : ''}`}
                  onClick={() => setActivePanel('users')}
                >
                  Users
                </button>
              </nav>
            </aside>

            <main className="org-admin-main">
              {activePanel === 'setup' && (
                <div className="dash-card portal-content-card org-admin-card">
                  <h3 className="org-admin-panel-title">Organisation setup</h3>
                  {platformAdmin && (
                    <form className="org-admin-form" onSubmit={handleCreateOrg}>
                      <p className="org-admin-panel-lead">
                        Platform administrators can create a new organisation. The first admin is your account.
                      </p>
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
                  {selectedOrg && (
                    <div className="org-admin-detail-block">
                      <h4 className="org-admin-subtitle">Current organisation</h4>
                      <dl className="org-admin-dl">
                        <div>
                          <dt>Name</dt>
                          <dd>{selectedOrg.name}</dd>
                        </div>
                        <div>
                          <dt>Slug</dt>
                          <dd>{selectedOrg.slug || '—'}</dd>
                        </div>
                        <div>
                          <dt>Id</dt>
                          <dd className="org-admin-mono">{selectedOrg.id}</dd>
                        </div>
                      </dl>
                    </div>
                  )}
                  {!selectedOrg && (orgOptions || []).length === 0 && !platformAdmin && (
                    <p className="org-admin-muted">You are not assigned to any organisation yet.</p>
                  )}
                </div>
              )}

              {activePanel === 'users' && (
                <div className="dash-card portal-content-card org-admin-card">
                  <h3 className="org-admin-panel-title">Users</h3>
                  {!selectedOrgId ? (
                    <p className="org-admin-body">Select an organisation in the list on the left to invite users and view members.</p>
                  ) : (
                    <>
                      <p className="org-admin-panel-lead">
                        New users receive a Supabase invite email. Existing accounts are linked immediately.{' '}
                        <strong className="org-admin-strong">Org admin</strong> can manage members and invites.
                      </p>
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
                              { key: ENTITLEMENT_KEYS.PORTAL, label: 'Portal' },
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

                      <h4 className="org-admin-subtitle">Members</h4>
                      {membersLoading ? (
                        <p className="org-admin-muted">Loading members…</p>
                      ) : (
                        <div className="org-admin-members-wrap">
                          <table className="org-admin-members-table">
                            <thead>
                              <tr>
                                <th scope="col">Email</th>
                                <th scope="col">Org admin</th>
                                <th scope="col">Entitlements</th>
                              </tr>
                            </thead>
                            <tbody>
                              {members.map((m) => (
                                <tr key={m.id}>
                                  <td>{m.email}</td>
                                  <td>{m.is_org_admin ? 'Yes' : '—'}</td>
                                  <td className="org-admin-mono org-admin-ent-cell">
                                    {Object.entries(m.entitlements || {})
                                      .filter(([, v]) => v)
                                      .map(([k]) => k)
                                      .join(', ') || '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </main>
          </div>
        )}
      </div>
    </div>
  );
}
