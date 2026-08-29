'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

interface LazyMarkdownProps {
  children: string;
  className?: string;
}

// R179 (Task 2-b): DSH reports embed `![caption](url)` figures — react-markdown
// renders images by default, but we apply the same https-only allowlist used by
// src/lib/markdown-renderer.ts (see renderImageHtml there) so non-https URLs
// render nothing instead of a broken/mixed-content image. Idiom mirrors
// ChatPanel's safeUrlTransform defense-in-depth comment (UI-021).
const lazyMarkdownComponents: Components = {
  img: ({ alt, src, title }) => {
    const url = typeof src === 'string' ? src : '';
    if (!/^https:\/\//i.test(url)) return null;
    return (
      <img
        src={url}
        alt={alt || ''}
        title={title}
        loading="lazy"
        className="max-w-full rounded-lg border border-border/40 my-3"
      />
    );
  },
};

export function LazyMarkdown({ children, className }: LazyMarkdownProps) {
  return (
    <div className={`markdown-content ${className || ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={lazyMarkdownComponents}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
