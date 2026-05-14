// CSS imports for the deal workspace surface. Mirrors
// app/workspace/layout.jsx so the .ws-* classes (defined in
// diagnostic.css alongside the chat surface) actually apply on this
// route. Without this, the deal workspace renders unstyled because
// the legacy /deals/[id] redirect never routes through a layout that
// loads the workspace CSS.

import '../../../../public/styles/diagnostic.css';
import '../../../../public/styles/flow-canvas.css';

export default function DealWorkspaceLayout({ children }) {
  return children;
}
