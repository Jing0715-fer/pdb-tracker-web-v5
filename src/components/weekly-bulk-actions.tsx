'use client';
import { useI18n } from '@/lib/i18n';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Bookmark, BookmarkCheck, Tag, Download, GitCompareArrows, X,
  Check, FileJson, FileText, Columns2, Boxes,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/tooltip';
import type { PdbEntry } from '@/lib/pdb-types';

// ─── Props ────────────────────────────────────────────────────────────────────

interface WeeklyBulkActionsProps {
  selectedCount: number;
  totalCount: number;
  selectedEntries: PdbEntry[];
  bookmarks: Set<string>;
  onBookmarkAll: () => void;
  onExportSelected: (format: 'csv' | 'json') => void;
  onCompare: () => void;
  onClearSelection: () => void;
  onBatchTag: (tag: string, pdbIds: string[]) => void;
  /** Whether compare is allowed (2-4 items) */
  canCompare: boolean;
  /** Callback for detailed multi-structure comparison */
  onMultiCompare?: () => void;
  /** Whether multi-compare is allowed (2+ items) */
  canMultiCompare?: boolean;
  /** Callback for multi-structure 3D preview */
  onMulti3D?: () => void;
  /** Whether multi-3D is allowed (2+ items) */
  canMulti3D?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WeeklyBulkActions({
  selectedCount,
  totalCount,
  selectedEntries,
  bookmarks,
  onBookmarkAll,
  onExportSelected,
  onCompare,
  onClearSelection,
  onBatchTag,
  canCompare,
  onMultiCompare,
  canMultiCompare,
  onMulti3D,
  canMulti3D,
}: WeeklyBulkActionsProps) {
  const { locale } = useI18n();
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [progressActive, setProgressActive] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);

  // Determine if most selected entries are already bookmarked
  const bookmarkedCount = selectedEntries.filter(e => bookmarks.has(e.pdbId)).length;
  const mostBookmarked = bookmarkedCount > selectedEntries.length / 2;

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (tagDialogOpen) {
          setTagDialogOpen(false);
        } else if (exportMenuOpen) {
          setExportMenuOpen(false);
        } else {
          onClearSelection();
        }
      }
    };
    if (selectedCount > 0) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [selectedCount, onClearSelection, tagDialogOpen, exportMenuOpen]);

  // Auto-focus tag input
  useEffect(() => {
    if (tagDialogOpen && tagInputRef.current) {
      tagInputRef.current.focus();
    }
  }, [tagDialogOpen]);

  // Close export menu when clicking outside
  useEffect(() => {
    if (!exportMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.batch-export-menu') && !target.closest('[data-export-trigger]')) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [exportMenuOpen]);

  // Brief progress indicator for batch operations
  const showProgress = useCallback((callback: () => void) => {
    setProgressActive(true);
    setTimeout(() => {
      callback();
      setTimeout(() => setProgressActive(false), 400);
    }, 300);
  }, []);

  const handleBookmarkClick = useCallback(() => {
    showProgress(onBookmarkAll);
  }, [onBookmarkAll, showProgress]);

  const handleExportCsv = useCallback(() => {
    showProgress(() => onExportSelected('csv'));
    setExportMenuOpen(false);
  }, [onExportSelected, showProgress]);

  const handleExportJson = useCallback(() => {
    showProgress(() => onExportSelected('json'));
    setExportMenuOpen(false);
  }, [onExportSelected, showProgress]);

  const handleCompareClick = useCallback(() => {
    if (canCompare) {
      showProgress(onCompare);
    }
  }, [canCompare, onCompare, showProgress]);

  const handleTagSubmit = useCallback(() => {
    if (tagInput.trim()) {
      const pdbIds = selectedEntries.map(e => e.pdbId);
      onBatchTag(tagInput.trim(), pdbIds);
      setTagInput('');
      setTagDialogOpen(false);
    }
  }, [tagInput, selectedEntries, onBatchTag]);

  // Don't render if no selection
  if (selectedCount === 0) return null;

  return (
    <>
      {/* ─── Batch Action Bar ──────────────────────────────────────────── */}
      <div
        className="batch-action-bar fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
        style={{ bottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        {/* Progress overlay */}
        {progressActive && (
          <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
            <div className="absolute inset-0 bg-claude-accent/8 animate-pulse" />
            <div className="absolute bottom-0 left-0 h-[3px] bg-claude-accent/60 rounded-full batch-progress-line" />
          </div>
        )}

        <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-5 py-2.5 sm:py-3 rounded-2xl shadow-lg border border-claude-border/50 dark:border-[#3d3832]/50 backdrop-blur-xl bg-white/90 dark:bg-[#242220]/90">
          {/* Left accent line */}
          <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-l-2xl bg-gradient-to-b from-transparent via-claude-accent/60 to-transparent" />

          {/* Selection count */}
          <div className="flex items-center gap-2 pr-3 border-r border-claude-border/50 dark:border-[#3d3832]/50">
            <div className="flex items-center justify-center h-6 w-6 rounded-full bg-claude-accent/15 text-claude-accent text-[11px] font-bold">
              {selectedCount}
            </div>
            <span className="text-xs text-claude-text-secondary font-medium whitespace-nowrap">
              <span className="hidden sm:inline">{selectedCount} of {totalCount} selected</span>
              <span className="sm:hidden">{selectedCount} selected</span>
            </span>
          </div>

          {/* Action buttons with staggered entrance */}
          <div className="flex items-center gap-1 sm:gap-1.5">
            {/* Bookmark All */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleBookmarkClick}
                  className="batch-btn-stagger batch-btn-stagger-1 h-8 px-2 sm:px-3 text-[11px] gap-1.5 text-claude-text-secondary hover:text-claude-accent hover:bg-claude-accent/10"
                >
                  {mostBookmarked ? (
                    <BookmarkCheck className="h-3.5 w-3.5 text-claude-accent" />
                  ) : (
                    <Bookmark className="h-3.5 w-3.5" />
                  )}
                  <span className="hidden sm:inline">{mostBookmarked ? 'Unbookmark' : 'Bookmark'}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>{mostBookmarked ? (locale === 'zh' ? '移除所有选中的收藏' : 'Remove bookmark from all selected') : (locale === 'zh' ? '收藏所有选中' : 'Add bookmark to all selected')}</p>
              </TooltipContent>
            </Tooltip>

            {/* Tag All */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setTagDialogOpen(true); setTagInput(''); }}
                  className="batch-btn-stagger batch-btn-stagger-2 h-8 px-2 sm:px-3 text-[11px] gap-1.5 text-claude-text-secondary hover:text-amber-600 hover:bg-amber-50 dark:hover:text-amber-400 dark:hover:bg-amber-900/20"
                >
                  <Tag className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Tag All</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>{locale === "zh" ? "为所有选中条目添加标签" : "Add a tag to all selected entries"}</p>
              </TooltipContent>
            </Tooltip>

            {/* Export Selected */}
            <div className="relative">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExportMenuOpen(!exportMenuOpen)}
                    data-export-trigger
                    className="batch-btn-stagger batch-btn-stagger-3 h-8 px-2 sm:px-3 text-[11px] gap-1.5 text-claude-text-secondary hover:text-claude-accent hover:bg-claude-accent/10"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Export</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>{locale === "zh" ? "导出选中条目为 CSV 或 JSON" : "Export selected entries as CSV or JSON"}</p>
                </TooltipContent>
              </Tooltip>

              {/* Export dropdown */}
              {exportMenuOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-44 rounded-lg border border-claude-border dark:border-[#3d3832] bg-white dark:bg-[#242220] shadow-lg py-1 z-50 batch-export-menu">
                  <button
                    onClick={handleExportCsv}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926] hover:text-claude-text transition-colors"
                  >
                    <FileText className="h-3.5 w-3.5 text-claude-text-muted" />
                    Export as CSV
                  </button>
                  <button
                    onClick={handleExportJson}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926] hover:text-claude-text transition-colors"
                  >
                    <FileJson className="h-3.5 w-3.5 text-claude-text-muted" />
                    Export as JSON
                  </button>
                </div>
              )}
            </div>

            {/* Compare Selected */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCompareClick}
                  disabled={!canCompare}
                  className={`batch-btn-stagger batch-btn-stagger-4 h-8 px-2 sm:px-3 text-[11px] gap-1.5 ${
                    canCompare
                      ? 'text-claude-text-secondary hover:text-[#2d8f8f] hover:bg-[#2d8f8f]/10'
                      : 'text-claude-text-muted/40 cursor-not-allowed'
                  }`}
                >
                  <GitCompareArrows className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Compare</span>
                  {!canCompare && (
                    <span className="text-[9px] text-claude-text-muted/60 hidden sm:inline">(2-4)</span>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>{canCompare ? (locale === 'zh' ? '并排比较选中的结构' : 'Compare selected structures side by side') : (locale === 'zh' ? '选择 2-4 个结构进行比较' : 'Select 2-4 structures to compare')}</p>
              </TooltipContent>
            </Tooltip>

            {/* Detailed Multi-Compare */}
            {onMultiCompare && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onMultiCompare}
                    disabled={!canMultiCompare}
                    className={`batch-btn-stagger batch-btn-stagger-4 h-8 px-2 sm:px-3 text-[11px] gap-1.5 ${
                      canMultiCompare
                        ? 'text-claude-text-secondary hover:text-[#7c5cbf] hover:bg-[#7c5cbf]/10'
                        : 'text-claude-text-muted/40 cursor-not-allowed'
                    }`}
                  >
                    <Columns2 className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{locale === 'zh' ? '详细对比' : 'Details'}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>{canMultiCompare ? (locale === 'zh' ? '详细指标对比' : 'Detailed metric comparison') : (locale === 'zh' ? '选择 2+ 个结构' : 'Select 2+ structures')}</p>
                </TooltipContent>
              </Tooltip>
            )}

            {/* 3D Preview */}
            {onMulti3D && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onMulti3D}
                    disabled={!canMulti3D}
                    className={`batch-btn-stagger batch-btn-stagger-4 h-8 px-2 sm:px-3 text-[11px] gap-1.5 ${
                      canMulti3D
                        ? 'text-claude-text-secondary hover:text-[#2d8f8f] hover:bg-[#2d8f8f]/10'
                        : 'text-claude-text-muted/40 cursor-not-allowed'
                    }`}
                  >
                    <Boxes className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{locale === 'zh' ? '3D预览' : '3D'}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>{canMulti3D ? (locale === 'zh' ? '并排 3D 结构预览' : 'Side-by-side 3D structure preview') : (locale === 'zh' ? '选择 2+ 个结构' : 'Select 2+ structures')}</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* Divider */}
          <div className="w-px h-5 bg-claude-border/50 dark:bg-[#3d3832]/50" />

          {/* Deselect All */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearSelection}
                className="batch-btn-stagger batch-btn-stagger-5 h-8 px-2 text-[11px] gap-1.5 text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926]"
              >
                <Check className="h-3 w-3" />
                <span className="hidden sm:inline">Deselect</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>{locale === "zh" ? "取消选择所有条目" : "Deselect all entries"}</p>
            </TooltipContent>
          </Tooltip>

          {/* Dismiss X */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearSelection}
            className="h-8 w-8 p-0 text-claude-text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
            title="Dismiss bar (Esc)"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ─── Batch Tag Mini-Dialog ─────────────────────────────────────── */}
      {tagDialogOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center"
          onClick={() => setTagDialogOpen(false)}
        >
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
          <div
            className="relative bg-white dark:bg-[#242220] border border-claude-border dark:border-[#3d3832] rounded-xl shadow-2xl w-[380px] max-w-[90vw] p-5 batch-tag-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-claude-text flex items-center gap-2">
                <Tag className="h-4 w-4 text-amber-500" />
                Batch Tag
              </h3>
              <button
                onClick={() => setTagDialogOpen(false)}
                className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-claude-border-light dark:hover:bg-[#3d3832] transition-colors"
              >
                <X className="h-4 w-4 text-claude-text-muted" />
              </button>
            </div>
            <p className="text-[11px] text-claude-text-muted mb-3">
              This tag will be added to all{' '}
              <span className="font-medium text-claude-text">{selectedCount}</span>{' '}
              selected entries.
            </p>
            <Input
              ref={tagInputRef}
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="Enter tag name (e.g., cryo-em, membrane-protein)..."
              className="h-9 text-xs"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tagInput.trim()) {
                  handleTagSubmit();
                }
              }}
            />
            <div className="flex items-center gap-2 mt-3">
              <Button
                onClick={handleTagSubmit}
                disabled={!tagInput.trim()}
                size="sm"
                className="flex-1 h-8 text-xs bg-amber-500 hover:bg-amber-600 disabled:bg-amber-500/50 disabled:cursor-not-allowed text-white"
              >
                Add Tag to {selectedCount} Entries
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTagDialogOpen(false)}
                className="h-8 px-3 text-xs"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
