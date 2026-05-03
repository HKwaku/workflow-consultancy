'use client';

/**
 * Home icon — always visible at the very top of the rail. Click resets
 * the chat surface to the canonical fresh state: drops every URL param
 * (deal / chatSession / edit / focusFinding / etc.), clears any deal scope
 * + canvas state, and pushes `/process-audit`. The DiagnosticWorkspace
 * seed effect then renders Reina's four-pillar intro.
 *
 * Visible to anonymous + signed-in users. Doesn't ask the user to confirm —
 * the action is fully recoverable (their reports / deals are still listed
 * in the rail icons below).
 */

export default function HomeRailButton() {
  const goHome = () => {
    // Strategy: clear every persistence layer that would otherwise restore
    // state on the next mount, then hard-navigate. We don't try to reset
    // React state in-place because:
    //   - When the user is already on a fresh URL, router.push('/process-audit')
    //     is a no-op for routing, so DiagnosticWorkspace doesn't remount
    //     and its seed-effect ref keeps `hasSeededChatRef.current = true`.
    //   - Hard nav (`window.location.assign`) is guaranteed to remount
    //     everything — most reliable path back to the four-pillar intro.

    try {
      // DiagnosticContext autosave key
      window.localStorage.removeItem('processDiagnosticProgress');
      // Cloud chat-session id pointers — these are what was actually loading
      // a "random chat history" on mount. The active one + any per-report
      // ones (vesno_chat_session_<reportId>) all need to go.
      window.localStorage.removeItem('vesno_chat_session_active');
      for (let i = window.localStorage.length - 1; i >= 0; i--) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith('vesno_chat_session_')) window.localStorage.removeItem(k);
      }
      // Module / deal context that participant resolvers stash
      window.localStorage.removeItem('diagnosticModuleContext');
      // Models cache (stale across home clicks)
      window.sessionStorage.removeItem('vesno_models_v4');
      // Per-deal "auto-open workspace once" flags
      for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
        const k = window.sessionStorage.key(i);
        if (k && k.startsWith('workflow-deal-autoopen-v1:')) window.sessionStorage.removeItem(k);
      }
    } catch { /* storage disabled / quota — fall through to nav anyway */ }

    window.location.assign('/process-audit');
  };

  return (
    <button
      type="button"
      className="s7-split-rail-btn"
      onClick={goHome}
      title="Home — fresh chat"
      aria-label="Home — fresh chat"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1h-5v-7h-6v7H4a1 1 0 01-1-1V9.5z" />
      </svg>
    </button>
  );
}
