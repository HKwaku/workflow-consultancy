'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

export default function DocsNav({ nav }) {
  const pathname = usePathname();
  const activeSlug = pathname?.replace(/^\/docs\/?/, '') || '';

  return (
    <nav className="docs-nav" aria-label="Documentation">
      {nav.map((g) => (
        <div key={g.group} className="docs-nav-group">
          <h3 className="docs-nav-group-title">{g.group}</h3>
          <ul>
            {g.items.map((item) => {
              const isActive = item.slug === activeSlug;
              return (
                <li key={item.slug}>
                  <Link
                    href={`/docs/${item.slug}`}
                    className={`docs-nav-link ${isActive ? 'is-active' : ''}`}
                  >
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
