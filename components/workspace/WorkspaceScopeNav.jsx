'use client';

/**
 * WorkspaceScopeNav - top-level nav that sits above the per-workspace
 * tab row. Three options:
 *
 *   - Standard:  the org's default operating model workspace (/workspace).
 *                Analytics lives here as the "Analysis" tab — there is no
 *                separate Analytics scope.
 *   - Deals:     the deals list (/workspace?view=deals); picking a deal
 *                navigates to /deals/<id>/workspace
 *   - Outputs:   schema-free generated content the agent produces
 *                during interaction (/workspace?view=outputs). Named
 *                "Outputs" so it doesn't collide with the chat rail's
 *                separate, session-scoped "Artefacts" panel.
 *
 * Mounted by both WorkspaceClient (standard surface) and
 * DealWorkspaceClient (deal surface) so the user can switch scopes
 * from anywhere. The active prop drives which pill is highlighted.
 */

import Link from 'next/link';

/**
 * Props:
 *   active:    'deals' | 'standard' | 'outputs' (highlighted pill)
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
      {item('outputs',   'Outputs',   '/workspace?view=outputs')}
    </nav>
  );
}
