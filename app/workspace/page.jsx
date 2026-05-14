/**
 * /workspace — operating-model home.
 *
 * Embeds the canvas + chat shell (DiagnosticClient) and auto-opens the
 * workspace overlay on top, so clicking a process loads it inline on
 * the canvas without a route change. The chat thread persists across
 * process opens because the component stays mounted.
 */

import WorkspaceShell from './WorkspaceShell';

export const metadata = { title: 'Workspace — Vesno' };

export default function WorkspacePage() {
  return <WorkspaceShell />;
}
