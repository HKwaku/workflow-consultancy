import { getNavigation } from '@/lib/docsCatalogue';
import DocsNav from './DocsNav';
import './docs.css';

export const metadata = {
  title: 'Docs · Vesno',
  description: 'Guides and reference for the Vesno platform.',
};

export default function DocsLayout({ children }) {
  const nav = getNavigation();
  return (
    <div className="docs-shell">
      <aside className="docs-sidebar">
        <a href="/" className="docs-brand">Vesno<span>.</span></a>
        <h1 className="docs-sidebar-title">Documentation</h1>
        <DocsNav nav={nav} />
        <p className="docs-sidebar-foot">
          Need help? <a href="mailto:support@vesno.io">support@vesno.io</a>
        </p>
      </aside>
      <main className="docs-main">{children}</main>
    </div>
  );
}
