'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';

function CopyButton({ text, label = 'Copy', copiedLabel = 'Copied', className = 's7-md-copy-btn' }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Silently ignore — clipboard may be unavailable
    }
  };
  return (
    <button type="button" className={className} onClick={onClick} aria-label={copied ? copiedLabel : label}>
      {copied ? copiedLabel : label}
    </button>
  );
}

function CodeRenderer({ className, children, ...rest }) {
  const match = /language-(\w+)/.exec(className || '');
  const raw = Array.isArray(children)
    ? children.join('')
    : typeof children === 'string'
    ? children
    : String(children ?? '');
  const isBlock = match || raw.includes('\n');

  if (!isBlock) {
    return <code className="s7-md-code-inline" {...rest}>{children}</code>;
  }

  const lang = match ? match[1] : '';
  const plain = raw.replace(/\n$/, '');

  return (
    <div className="s7-md-codeblock">
      <div className="s7-md-codeblock-head">
        <span className="s7-md-codeblock-lang">{lang || 'code'}</span>
        <CopyButton text={plain} className="s7-md-codeblock-copy" />
      </div>
      <pre className="s7-md-codeblock-pre"><code className={className} {...rest}>{children}</code></pre>
    </div>
  );
}

const MD_COMPONENTS = {
  code: CodeRenderer,
  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  table: ({ node, ...props }) => (
    <div className="s7-md-table-wrap"><table {...props} /></div>
  ),
};

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];

export default function ChatMessageContent({ content, streaming = false }) {
  if (!content) {
    return streaming ? <span className="s7-md-caret" aria-hidden="true" /> : null;
  }
  return (
    <div className={`s7-md${streaming ? ' s7-md-streaming' : ''}`}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={MD_COMPONENTS}
      >
        {content}
      </ReactMarkdown>
      {streaming && <span className="s7-md-caret" aria-hidden="true" />}
    </div>
  );
}

export { CopyButton };
