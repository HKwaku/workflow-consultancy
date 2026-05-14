/**
 * /docs — index page. Lists every group + summary tile.
 */

import Link from 'next/link';
import { getNavigation, getAllDocs } from '@/lib/docsCatalogue';

export default function DocsIndex() {
  const nav = getNavigation();
  const all = getAllDocs();
  const summaryByGroup = {};
  for (const g of nav) summaryByGroup[g.group] = g.items.map((i) => all.find((d) => d.slug === i.slug));

  return (
    <article className="docs-article">
      <header className="docs-article-head">
        <h1>Vesno documentation</h1>
        <p className="docs-article-lede">
          Guides and reference for using the platform — operating-model management, process mapping, deal diligence, M&A workflows.
          New here? Start with <Link href="/docs/tutorials/your-first-audit">Mapping your first process</Link>.
        </p>
      </header>

      {nav.map((g) => (
        <section key={g.group} className="docs-index-group">
          <h2 className="docs-index-group-title">{g.group}</h2>
          <ul className="docs-index-list">
            {summaryByGroup[g.group].map((d) => (
              <li key={d.slug} className="docs-index-card">
                <Link href={`/docs/${d.slug}`} className="docs-index-card-link">
                  <strong>{d.title}</strong>
                  {d.summary && <span>{d.summary}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </article>
  );
}
