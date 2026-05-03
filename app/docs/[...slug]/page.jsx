import { notFound } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { getAllDocs, getDocBySlug } from '@/lib/docsCatalogue';

export async function generateStaticParams() {
  return getAllDocs().map((d) => ({ slug: d.slugParts }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const doc = getDocBySlug(slug.join('/'));
  if (!doc) return { title: 'Not found · Vesno docs' };
  return {
    title: `${doc.title} · Vesno docs`,
    description: doc.summary || undefined,
  };
}

export default async function DocPage({ params }) {
  const { slug } = await params;
  const doc = getDocBySlug(slug.join('/'));
  if (!doc) notFound();

  return (
    <article className="docs-article">
      <header className="docs-article-head">
        <p className="docs-article-breadcrumb">
          <Link href="/docs">Docs</Link> <span>›</span> {doc.group}
        </p>
        <h1>{doc.title}</h1>
        {doc.summary && <p className="docs-article-lede">{doc.summary}</p>}
      </header>
      <div className="docs-article-body">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
        >
          {doc.body}
        </ReactMarkdown>
      </div>
    </article>
  );
}
