'use client';

/**
 * WorkspaceScopeNav - top-level nav that sits above the per-workspace
 * tab row. Three options:
 *
 *   - Standard:  the org's default operating model workspace (/workspace)
 *   - Deals:     the deals list (/workspace?view=deals); picking a deal
 *                navigates to /deals/<id>/workspace
 *   - Analytics: embedded analytics (/workspace?view=analytics)
 *
 * Mounted by both WorkspaceClient (standard surface) and
 * DealWorkspaceClient (deal surface) so the user can switch scopes
 * from anywhere. The active prop drives which pill is highlighted.
 */

import Link from 'next/link';

/**
 * Props:
 *   active:    'deals' | 'standard' | 'analytics' (highlighted pill)
 *   onSelect:  optional (scope) => void. When supplied, plain clicks
 *              call this instead of navigating - lets the canvas
 *              overlay swap content without a route change. Cmd/Ctrl/
 *              Shift/middle-click always falls through to the href so
 *              the user can still open in a new tab when they want to.
 */
export default function WorkspaceScopeNav({ active, onSelect }) {
  const item = (id, label, href) => (
    <Link
      key={id}
      href={href}
      className={`ws-scope-tab${active === id ? ' ws-scope-tab--active' : ''}`}
      aria-current={active === id ? 'page' : undefined}
      onClick={(e) => {
        if (!onSelect) return; // fall through to Link's normal navigation
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // new-tab opt-in
        e.preventDefault();
        onSelect(id);
      }}
    >{label}</Link>
  );
  return (
    <nav className="ws-scope-nav" aria-label="Workspace scope">
      {item('deals',     'Deals',     '/workspace?view=deals')}
      {item('standard',  'Standard',  '/workspace')}
      {item('analytics', 'Analytics', '/workspace?view=analytics')}
    </nav>
  );
}
