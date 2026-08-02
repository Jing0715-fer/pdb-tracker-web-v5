'use client';

/**
 * ReportMarkdown — canonical renderer for LLM-generated evaluation reports.
 *
 * Uses the project's own markdown-renderer (src/lib/markdown-renderer.ts)
 * instead of react-markdown + remark-gfm. The self-built renderer supports
 * 4 table formats (pipe / no-separator / tab / multi-space) and correctly
 * renders GFM tables that react-markdown silently drops when a Chinese
 * paragraph precedes the table (a known remark-gfm edge case we hit in
 * every batch report — see markdown-renderer.ts header comment).
 *
 * The rendered HTML is injected via dangerouslySetInnerHTML. This is safe
 * because:
 *   1. The source markdown comes from our own LLM generation pipeline
 *      (not user input).
 *   2. sanitizeReport() strips YAML frontmatter, closes unclosed markup,
 *      and now also strips LLM tool-call leakage ("Write permission is not
 *      available...").
 *   3. renderMarkdownToHtml() escapes all cell/paragraph text via
 *      escapeHtml() before wrapping in tags.
 *
 * Used by:
 *   - ReportModal (src/components/ui/pdb-ui.tsx) — full-screen report viewer
 *   - evalReportTab (src/components/pdb-tracker.tsx) — inline report tab
 */
import { useMemo } from 'react';
import {
  renderMarkdownToHtml,
  stripMarkdownFrontmatterAndTitle,
  sanitizeReport,
} from '@/lib/markdown-renderer';

interface ReportMarkdownProps {
  /** Raw markdown source (may include YAML frontmatter + H1 title). */
  children: string;
  className?: string;
}

export function ReportMarkdown({ children, className }: ReportMarkdownProps) {
  const html = useMemo(() => {
    if (!children) return '';
    const stripped = stripMarkdownFrontmatterAndTitle(children);
    const sanitized = sanitizeReport(stripped);
    const { bodyHtml } = renderMarkdownToHtml(sanitized);
    return bodyHtml;
  }, [children]);

  if (!html) return null;

  return (
    <div
      className={`markdown-content report-markdown ${className || ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
