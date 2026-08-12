'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Clock, ChevronLeft, ChevronRight, Download, FileText, FileCode, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { TagInfo, TagCategory } from '@/lib/pdb-types';
import { PAGE_SIZE_OPTIONS, loadStoredPageSize } from '@/lib/pdb-utils';
import { sanitizeReport, stripMarkdownFrontmatterAndTitle, renderMarkdownToFullPage } from '@/lib/markdown-renderer';
import { ReportMarkdown } from '@/components/report-markdown';

// ─── Tag Category Styles ──────────────────────────────────────────────────

const TAG_CATEGORY_STYLES: Record<TagCategory, { bg: string; text: string; border: string; darkBg: string; darkText: string }> = {
  method:     { bg: 'bg-teal-50',      text: 'text-teal-700',     border: 'border-teal-200',      darkBg: 'dark:bg-teal-900/20',     darkText: 'dark:text-teal-400' },
  resolution: { bg: 'bg-green-50',     text: 'text-green-700',    border: 'border-green-200',     darkBg: 'dark:bg-green-900/20',    darkText: 'dark:text-green-400' },
  if:         { bg: 'bg-amber-50',     text: 'text-amber-700',    border: 'border-amber-200',     darkBg: 'dark:bg-amber-900/20',    darkText: 'dark:text-amber-400' },
  quality:    { bg: 'bg-purple-50',    text: 'text-purple-700',   border: 'border-purple-200',    darkBg: 'dark:bg-purple-900/20',   darkText: 'dark:text-purple-400' },
  date:       { bg: 'bg-gray-50',      text: 'text-gray-600',     border: 'border-gray-200',      darkBg: 'dark:bg-gray-800/30',     darkText: 'dark:text-gray-400' },
  organism:   { bg: 'bg-sky-50',       text: 'text-sky-700',      border: 'border-sky-200',       darkBg: 'dark:bg-sky-900/20',      darkText: 'dark:text-sky-400' },
  ligand:     { bg: 'bg-rose-50',      text: 'text-rose-700',     border: 'border-rose-200',      darkBg: 'dark:bg-rose-900/20',     darkText: 'dark:text-rose-400' },
  special:    { bg: 'bg-emerald-50',   text: 'text-emerald-700',  border: 'border-emerald-200',   darkBg: 'dark:bg-emerald-900/20',  darkText: 'dark:text-emerald-400' },
};

export { TAG_CATEGORY_STYLES };

// ─── TagPill Component ─────────────────────────────────────────────────────

export function TagPill({ tag, onClick, size = 'sm' }: { tag: TagInfo; onClick?: () => void; size?: 'sm' | 'xs' }) {
  const style = TAG_CATEGORY_STYLES[tag.category as TagCategory];
  if (!style) return null;
  const sizeClasses = size === 'xs' ? 'px-1.5 py-0 text-[9px]' : 'px-2 py-0.5 text-[10px]';
  const categoryPillVariant: Record<string, string> = {
    method: 'tag-pill-green',
    resolution: 'tag-pill-blue',
    if: 'tag-pill-amber',
    quality: 'tag-pill-purple',
    ligand: 'tag-pill-rose',
    special: 'tag-pill-green',
    date: 'tag-pill-blue',
    organism: 'tag-pill-blue',
  };
  return (
    <span
      className={`tag-pill ${categoryPillVariant[tag.category] || 'tag-pill-blue'} inline-flex items-center rounded-md font-medium border ${style.bg} ${style.text} ${style.border} ${style.darkBg} ${style.darkText} ${sizeClasses} ${onClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
    >
      {tag.label}
    </span>
  );
}

// ─── Report Modal Component ──────────────────────────────────────────────────

export function ReportModal({ isOpen, onClose, title, content }: { isOpen: boolean; onClose: () => void; title: string; content: string }) {
  const [copied, setCopied] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (isOpen) window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Close export menu when clicking outside
  useEffect(() => {
    if (!exportMenuOpen) return;
    const handleClick = () => setExportMenuOpen(false);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [exportMenuOpen]);

  // Pre-process: strip YAML frontmatter + first H1 (title duplication),
  // then sanitize (close unclosed **, fix mid-table truncation, collapse
  // failed-chapter markers). We then feed the cleaned markdown to
  // ReactMarkdown (via LazyMarkdown) which correctly renders headings (#,
  // ##, ###), GFM pipe tables, lists, bold/italic/code — same renderer
  // used by the Run Center chapter stream, so the output is consistent.
  const processedContent = useMemo(() => {
    const stripped = stripMarkdownFrontmatterAndTitle(content);
    return sanitizeReport(stripped);
  }, [content]);

  // Round 56: Export handlers — Markdown / HTML / Copy
  const safeTitle = useMemo(() => {
    // Derive a filesystem-safe name from the modal title.
    // "Weekly Report — 2026-W28" → "Weekly-Report-2026-W28"
    return (title || 'report')
      .replace(/[^\w\u4e00-\u9fa5\-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 60) || 'report';
  }, [title]);

  const downloadBlob = useCallback((data: string, mime: string, ext: string) => {
    const blob = new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeTitle}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [safeTitle]);

  const exportMarkdown = useCallback(() => {
    const md = `# ${title}\n\n${processedContent}\n`;
    downloadBlob(md, 'text/markdown;charset=utf-8', 'md');
    setExportMenuOpen(false);
  }, [title, processedContent, downloadBlob]);

  const exportHtml = useCallback(() => {
    const { html } = renderMarkdownToFullPage(processedContent, {
      title,
      bodyClassName: 'report-export',
      maxWidth: 820,
    });
    downloadBlob(html, 'text/html;charset=utf-8', 'html');
    setExportMenuOpen(false);
  }, [title, processedContent, downloadBlob]);

  const copyToClipboard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(processedContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }, [processedContent]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.2 }}
            className="bg-claude-surface dark:bg-[#242220] rounded-[10px] shadow-xl max-w-[66rem] w-full mx-4 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-claude-border dark:border-[#3d3832] bg-gradient-to-r from-[#faf7f4] to-[#f5f0ea] dark:from-[#242220] dark:to-[#2b2926]">
              <h2 className="text-base font-bold text-claude-text pl-2 border-l-4 border-claude-accent flex-1 min-w-0 truncate">
                {title}
              </h2>
              <div className="flex items-center gap-1 shrink-0">
                {/* Copy button */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1 text-claude-text-muted hover:text-claude-text"
                  onClick={copyToClipboard}
                  title="复制到剪贴板"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  <span className="hidden sm:inline">{copied ? '已复制' : '复制'}</span>
                </Button>
                {/* Export dropdown */}
                <div className="relative" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs gap-1 text-claude-text-muted hover:text-claude-text"
                    onClick={() => setExportMenuOpen(o => !o)}
                    title="导出报告"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">导出</span>
                  </Button>
                  <AnimatePresence>
                    {exportMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -4, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -4, scale: 0.96 }}
                        transition={{ duration: 0.12 }}
                        className="absolute right-0 top-full mt-1 w-44 rounded-md border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] shadow-lg z-10 overflow-hidden"
                      >
                        <button
                          type="button"
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-claude-text-secondary dark:text-[#c4beb7] hover:bg-claude-border-light dark:hover:bg-[#3d3832]/60 transition-colors"
                          onClick={exportMarkdown}
                        >
                          <FileText className="h-3.5 w-3.5 text-claude-accent" />
                          <div className="flex flex-col">
                            <span className="font-medium">Markdown (.md)</span>
                            <span className="text-[10px] text-claude-text-muted">纯文本，可编辑</span>
                          </div>
                        </button>
                        <button
                          type="button"
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-claude-text-secondary dark:text-[#c4beb7] hover:bg-claude-border-light dark:hover:bg-[#3d3832]/60 transition-colors border-t border-claude-border/50 dark:border-[#3d3832]/50"
                          onClick={exportHtml}
                        >
                          <FileCode className="h-3.5 w-3.5 text-claude-accent" />
                          <div className="flex flex-col">
                            <span className="font-medium">HTML (.html)</span>
                            <span className="text-[10px] text-claude-text-muted">独立网页，可打印</span>
                          </div>
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0 text-claude-text-muted hover:text-claude-text hover:bg-claude-border-light dark:hover:bg-[#3d3832]/50">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5 custom-scrollbar preview-scroll">
              <ReportMarkdown>{processedContent}</ReportMarkdown>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Pagination Component ────────────────────────────────────────────────────

export function Pagination({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (p: number) => void;
}) {
  const [jumpValue, setJumpValue] = useState('');
  // Derive currentPageSize directly from the pageSize prop — the parent owns
  // this value (the user-driven change is propagated back via onPageChange).
  // No local mirror state, so no set-state-in-effect is needed to sync props.
  const currentPageSize = pageSize;

  const start = (page - 1) * currentPageSize + 1;
  const end = Math.min(page * currentPageSize, totalItems);

  const handlePageSizeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newSize = parseInt(e.target.value, 10);
    try { localStorage.setItem('pdb-page-size', String(newSize)); } catch { /* ignore */ }
    onPageChange(1); // Reset to first page; parent updates pageSize prop
  };

  const handleJumpToPage = () => {
    const target = parseInt(jumpValue, 10);
    if (!isNaN(target) && target >= 1 && target <= totalPages) {
      onPageChange(target);
      setJumpValue('');
    }
  };

  const getPageNumbers = () => {
    const pages: (number | '...')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push('...');
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
        pages.push(i);
      }
      if (page < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  };

  return (
    <div className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3 border-t border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
      {/* Left: Range display + page size selector */}
      <div className="flex items-center gap-2 sm:gap-3">
        <span className="text-[11px] text-claude-text-muted hidden sm:inline">
          Showing <span className="font-mono font-medium text-claude-text-secondary">{start}</span>–<span className="font-mono font-medium text-claude-text-secondary">{end}</span> of <span className="font-mono font-medium text-claude-text-secondary">{totalItems}</span> entries
        </span>
        <span className="text-[11px] text-claude-text-muted sm:hidden">
          {start}–{end} of {totalItems}
        </span>
        {/* Page size selector */}
        <select
          value={currentPageSize}
          onChange={handlePageSizeChange}
          className="h-6 px-1.5 text-[10px] font-medium rounded border border-claude-border dark:border-[#3d3832] bg-white dark:bg-[#1a1917] text-claude-text-secondary dark:text-[#9b9590] focus:outline-none focus:ring-1 focus:ring-claude-accent/30 cursor-pointer claude-focus-ring"
        >
          {PAGE_SIZE_OPTIONS.map(size => (
            <option key={size} value={size}>{size}/page</option>
          ))}
        </select>
      </div>
      {/* Center & Right: Pagination + Jump to page */}
      <div className="flex items-center gap-1 sm:gap-2">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="pagination-btn btn-press btn-press-enhanced inline-flex items-center justify-center min-h-[44px] sm:min-h-0 sm:h-7 px-2 rounded-md text-[11px] font-medium border border-claude-border bg-claude-surface text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-claude-border disabled:opacity-40 disabled:cursor-not-allowed claude-focus-ring"
        >
          <ChevronLeft className="h-3.5 w-3.5 mr-0.5" />
          Prev
        </button>
        {getPageNumbers().map((p, i) =>
          p === '...' ? (
            <span key={`dots-${i}`} className="px-1.5 text-[11px] text-claude-text-muted">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={`pagination-btn btn-press btn-press-enhanced inline-flex items-center justify-center min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:h-7 sm:w-7 rounded-md text-[11px] font-medium claude-focus-ring ${
                page === p
                  ? 'bg-claude-accent text-white shadow-sm pagination-active pagination-active-premium pagination-btn-active'
                  : 'border border-claude-border bg-claude-surface text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-claude-border'
              }`}
            >
              {p}
            </button>
          )
        )}
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="pagination-btn btn-press btn-press-enhanced inline-flex items-center justify-center min-h-[44px] sm:min-h-0 sm:h-7 px-2 rounded-md text-[11px] font-medium border border-claude-border bg-claude-surface text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-claude-border disabled:opacity-40 disabled:cursor-not-allowed claude-focus-ring"
        >
          Next
          <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
        </button>
        {/* Jump to page input */}
        <div className="hidden sm:flex items-center gap-1 ml-1 pl-2 border-l border-claude-border dark:border-[#3d3832]">
          <span className="text-[10px] text-claude-text-muted whitespace-nowrap">Go to:</span>
          <input
            type="text"
            inputMode="numeric"
            value={jumpValue}
            onChange={(e) => setJumpValue(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleJumpToPage(); } }}
            onBlur={handleJumpToPage}
            placeholder={String(page)}
            className="w-10 h-6 px-1 text-[10px] text-center font-mono rounded border border-claude-border dark:border-[#3d3832] bg-white dark:bg-[#1a1917] text-claude-text-secondary dark:text-[#9b9590] focus:outline-none focus:ring-1 focus:ring-claude-accent/30 placeholder:text-claude-text-muted/50 claude-focus-ring"
          />
          <span className="text-[10px] text-claude-text-muted">/ {totalPages}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Table Skeleton Component ────────────────────────────────────────────────

export function TableSkeleton({ rows = 12, cols = 8 }: { rows?: number; cols?: number }) {
  // Realistic column widths that mimic actual data layout
  const colConfigs = [
    { width: 'w-3.5', height: 'h-3.5' },   // checkbox
    { width: 'w-3.5', height: 'h-3.5' },   // bookmark
    { width: 'w-3.5', height: 'h-3.5' },   // compare
    { width: 'w-[70px]', height: 'h-4' },   // PDB ID (monospace, wider)
    { width: 'w-[55px]', height: 'h-3' },   // Method badge
    { width: 'w-[45px]', height: 'h-3.5' }, // Resolution
    { width: 'w-[35px]', height: 'h-3' },   // IF
    { width: 'w-[100px]', height: 'h-3' },  // Organism
    { width: 'w-[80%]', height: 'h-3' },    // Title (longest)
    { width: 'w-[60px]', height: 'h-3' },   // Date
    { width: 'w-[90px]', height: 'h-3' },   // Ligands
  ];
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={`skel-${i}`} className="border-b border-claude-border-light dark:border-[#3d3832] skeleton-row-staggered">
          {Array.from({ length: cols }).map((_, j) => {
            const config = colConfigs[j % colConfigs.length];
            return (
              <td key={`skel-${i}-${j}`} className="px-3 py-2.5">
                <div className={`${config.width} ${config.height} rounded-md skeleton-bar skeleton-shine shimmer-loading`} />
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

// ─── Footer Clock Component ──────────────────────────────────────────────────

export function FooterClock() {
  const [time, setTime] = useState<string>('');
  useEffect(() => {
    const fmt = () => {
      const d = new Date();
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };
    const id = setInterval(() => setTime(fmt()), 60000);
    // Defer initial setState to avoid synchronous setState in effect
    const initialTimer = setTimeout(() => setTime(fmt()), 0);
    return () => { clearInterval(id); clearTimeout(initialTimer); };
  }, []);
  if (!time) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 border-l border-claude-border/50 font-mono">
      <Clock className="h-3 w-3" />
      <span>{time}</span>
    </span>
  );
}
