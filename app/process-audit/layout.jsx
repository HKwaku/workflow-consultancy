// Legacy alias route: the page-level redirect fires before any layout
// renders, so no CSS imports are needed here. Kept as a no-op layout to
// preserve the directory structure during the rename to /workspace/map.

export default function ProcessAuditLegacyLayout({ children }) {
  return children;
}
