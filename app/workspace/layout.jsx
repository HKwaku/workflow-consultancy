// CSS imports for the workspace surface. The .ws-* classes live in
// diagnostic.css alongside the chat surface (single source of truth);
// flow-canvas styles aren't needed here but are imported so the design
// surface — which renders flow snippets — picks them up too.

import '../../public/styles/diagnostic.css';
import '../../public/styles/flow-canvas.css';

export default function WorkspaceLayout({ children }) {
  return children;
}
