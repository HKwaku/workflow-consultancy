'use client';

/**
 * Rail icon — opens the operating-model workspace inside the chat surface's
 * canvas column. Pure dispatcher: fires `vesno:open-workspace`, which
 * DiagnosticWorkspace listens for and mounts the workspace into the canvas
 * (so chat stays visible on the left). On mobile DiagnosticWorkspace also
 * flips mobileView='canvas' so the user actually sees it.
 */

export default function WorkspaceRailButton() {
  const open = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('vesno:open-workspace'));
    }
  };

  return (
    <button
      type="button"
      className="s7-split-rail-btn"
      onClick={open}
      title="Workspace"
      aria-label="Workspace"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="6" cy="6" r="2" />
        <circle cx="18" cy="6" r="2" />
        <circle cx="12" cy="18" r="2" />
        <line x1="8" y1="7" x2="11" y2="16" />
        <line x1="16" y1="7" x2="13" y2="16" />
      </svg>
    </button>
  );
}
