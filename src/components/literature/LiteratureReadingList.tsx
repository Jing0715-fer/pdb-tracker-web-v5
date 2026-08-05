'use client';

import React, { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, BookmarkPlus, ListChecks, Trash2, Check, Clock, GripVertical } from 'lucide-react';
import type { LitPaper } from '@/lib/pdb-types';
import { useI18n } from '@/lib/i18n';

// ─── Types ────────────────────────────────────────────────────────────────────
//
// The `useReadingLists` hook and `ReadingList` type live in `./useReadingLists`
// so that `pdb-tracker.tsx` can import the hook without pulling `framer-motion`
// (used only by the components below) into its first-compile graph. Re-exported
// here for backward compatibility with existing consumers
// (e.g. `LiteratureView.tsx`, `literature/index.ts`).

import { useReadingLists, type ReadingList } from './useReadingLists';
export { useReadingLists };
export type { ReadingList };

// ─── Color palette for reading lists ──────────────────────────────────────────

const LIST_COLORS = [
  { name: 'red', dot: 'bg-red-500', bg: 'bg-red-50 dark:bg-red-900/20', text: 'text-red-600 dark:text-red-400' },
  { name: 'orange', dot: 'bg-orange-500', bg: 'bg-orange-50 dark:bg-orange-900/20', text: 'text-orange-600 dark:text-orange-400' },
  { name: 'amber', dot: 'bg-amber-500', bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-600 dark:text-amber-400' },
  { name: 'emerald', dot: 'bg-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20', text: 'text-emerald-600 dark:text-emerald-400' },
  { name: 'teal', dot: 'bg-teal-500', bg: 'bg-teal-50 dark:bg-teal-900/20', text: 'text-teal-600 dark:text-teal-400' },
  { name: 'blue', dot: 'bg-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20', text: 'text-blue-600 dark:text-blue-400' },
  { name: 'purple', dot: 'bg-purple-500', bg: 'bg-purple-50 dark:bg-purple-900/20', text: 'text-purple-600 dark:text-purple-400' },
  { name: 'pink', dot: 'bg-pink-500', bg: 'bg-pink-50 dark:bg-pink-900/20', text: 'text-pink-600 dark:text-pink-400' },
];

// Localized display name for default lists (id-based so users' localStorage
// entries don't need to be migrated when locale changes).
function getDefaultListDisplayName(id: string, locale: 'en' | 'zh'): string {
  if (locale === 'zh') {
    if (id === 'to-read') return '待读';
    if (id === 'reading') return '阅读中';
    if (id === 'read') return '已读';
  }
  if (id === 'to-read') return 'To Read';
  if (id === 'reading') return 'Reading';
  if (id === 'read') return 'Read';
  return id;
}

// Left-border color indicators for default categories
const CATEGORY_BORDER_COLORS: Record<string, string> = {
  'to-read': 'border-l-teal-500 dark:border-l-teal-400',
  'reading': 'border-l-amber-500 dark:border-l-amber-400',
  'read': 'border-l-emerald-500 dark:border-l-emerald-400',
};

// Left-border color map for custom list colors (Tailwind needs static class names)
const COLOR_BORDER_MAP: Record<string, string> = {
  red: 'border-l-red-500 dark:border-l-red-400',
  orange: 'border-l-orange-500 dark:border-l-orange-400',
  amber: 'border-l-amber-500 dark:border-l-amber-400',
  emerald: 'border-l-emerald-500 dark:border-l-emerald-400',
  teal: 'border-l-teal-500 dark:border-l-teal-400',
  blue: 'border-l-blue-500 dark:border-l-blue-400',
  purple: 'border-l-purple-500 dark:border-l-purple-400',
  pink: 'border-l-pink-500 dark:border-l-pink-400',
};

// ─── Component: ReadingListPaperItem ─────────────────────────────────────────

interface ReadingListPaperItemProps {
  pmid: string;
  paper?: LitPaper;
  readingProgress?: number; // 0-100
  onRemove: (pmid: string) => void;
  onClick?: (pmid: string) => void;
  borderColorClass?: string;
}

function ReadingListPaperItem({
  pmid,
  paper,
  readingProgress = 0,
  onRemove,
  onClick,
  borderColorClass,
}: ReadingListPaperItemProps) {
  if (!paper) {
    return (
      <div className={`px-2 py-1.5 rounded-md text-[11px] text-claude-text-muted border-l-2 ${borderColorClass || 'border-l-gray-300'} bg-claude-border-light/30 dark:bg-[#1a1917]/30`}>
        PMID: {pmid}
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(pmid); }}
          className="float-right p-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-claude-text-muted hover:text-red-500 transition-all"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      </div>
    );
  }

  // Truncate journal name
  const journalAbbrev = paper.journal
    ? paper.journal.length > 20
      ? paper.journal.slice(0, 18) + '…'
      : paper.journal
    : '';

  return (
    <div
      className={`group/item px-2 py-1.5 rounded-md border-l-2 ${borderColorClass || 'border-l-gray-300'} bg-claude-border-light/30 dark:bg-[#1a1917]/30 hover:bg-claude-border-light/60 dark:hover:bg-[#2b2926]/60 transition-colors cursor-pointer`}
      onClick={() => onClick?.(pmid)}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1">
          {/* Paper title - truncated to 1 line */}
          <div className="text-[11px] text-claude-text leading-snug line-clamp-1 font-medium">
            {paper.title || 'Untitled'}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            {/* Journal abbreviation */}
            {journalAbbrev && (
              <span className="text-[9px] text-claude-text-muted truncate max-w-[80px]">
                {journalAbbrev}
              </span>
            )}
            {/* Progress bar (small, inline) */}
            {readingProgress > 0 && (
              <div className="flex items-center gap-1 flex-shrink-0">
                <div className="h-1 w-10 bg-claude-border-light dark:bg-[#2b2926] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${readingProgress}%`,
                      background: readingProgress >= 100
                        ? '#10b981'
                        : 'linear-gradient(90deg, #2d8f8f, #c96442)',
                    }}
                  />
                </div>
                <span className="text-[8px] text-claude-text-muted tabular-nums">
                  {readingProgress}%
                </span>
              </div>
            )}
          </div>
        </div>
        {/* Remove button */}
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(pmid); }}
          className="p-0.5 rounded opacity-0 group-hover/item:opacity-100 hover:bg-red-50 dark:hover:bg-red-900/20 text-claude-text-muted hover:text-red-500 transition-all flex-shrink-0"
          title="Remove from list"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Component: ReadingListSidebar ────────────────────────────────────────────

interface ReadingListSidebarProps {
  lists: ReadingList[];
  selectedListId: string | null;
  onSelectList: (listId: string | null) => void;
  onCreateList: (name: string, color: string) => void;
  onDeleteList: (id: string) => void;
  onClearList?: (id: string) => void;
  onRemovePaperFromList?: (listId: string, pmid: string) => void;
  onReorderLists?: (fromIndex: number, toIndex: number) => void;
  // Papers data for displaying in list items
  papersMap?: Map<string, LitPaper>;
  // Progress data
  progressMap?: Record<string, number>;
  // Callback when clicking a paper in the list
  onPaperClick?: (pmid: string) => void;
}

export function ReadingListSidebar({
  lists,
  selectedListId,
  onSelectList,
  onCreateList,
  onDeleteList,
  onClearList,
  onRemovePaperFromList,
  onReorderLists,
  papersMap,
  progressMap,
  onPaperClick,
}: ReadingListSidebarProps) {
  const { locale } = useI18n();
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('teal');
  const [expandedListId, setExpandedListId] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragItemRef = useRef<number | null>(null);

  const handleCreate = useCallback(() => {
    if (!newName.trim()) return;
    onCreateList(newName.trim(), newColor);
    setNewName('');
    setNewColor('teal');
    setIsCreating(false);
  }, [newName, newColor, onCreateList]);

  // Get recently added papers (across all lists)
  const recentlyAddedPapers = React.useMemo(() => {
    if (!papersMap) return [];
    try {
      const addedAtMap: Record<string, string> = JSON.parse(localStorage.getItem('pdb-paper-added-at') || '{}');
      const allPmidsInLists = new Set<string>();
      lists.forEach(l => l.paperPmids.forEach(p => allPmidsInLists.add(p)));

      const sorted = Object.entries(addedAtMap)
        .filter(([pmid]) => allPmidsInLists.has(pmid) && papersMap.has(pmid))
        .sort(([, a], [, b]) => new Date(b).getTime() - new Date(a).getTime())
        .slice(0, 3);

      return sorted.map(([pmid]) => pmid);
    } catch {
      return [];
    }
  }, [lists, papersMap]);

  // Calculate average progress for all papers in lists
  const averageProgress = React.useMemo(() => {
    if (!progressMap) return 0;
    const allPmids = lists.flatMap(l => l.paperPmids);
    if (allPmids.length === 0) return 0;
    const total = allPmids.reduce((sum, pmid) => sum + (progressMap[pmid] ?? 0), 0);
    return Math.round(total / allPmids.length);
  }, [lists, progressMap]);

  // Total papers across all lists
  const totalPapersInLists = lists.reduce((sum, l) => sum + l.paperPmids.length, 0);

  // Drag handlers
  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index);
    dragItemRef.current = index;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    if (dragItemRef.current !== null && onReorderLists && dragItemRef.current !== toIndex) {
      onReorderLists(dragItemRef.current, toIndex);
    }
    setDragIndex(null);
    setDragOverIndex(null);
    dragItemRef.current = null;
  }, [onReorderLists]);

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDragOverIndex(null);
    dragItemRef.current = null;
  }, []);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-xs font-semibold text-claude-text-secondary uppercase tracking-wider flex items-center gap-1">
          <ListChecks className="h-3 w-3" />
          {locale === 'zh' ? '阅读列表' : 'Reading Lists'}
        </h3>
        <button
          onClick={() => setIsCreating(!isCreating)}
          className="p-0.5 rounded hover:bg-claude-border-light dark:hover:bg-[#2b2926] text-claude-text-muted hover:text-claude-accent transition-colors"
          title="Create new list"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>

      {/* Create new list form */}
      <AnimatePresence>
        {isCreating && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="p-2 rounded-lg border border-claude-border dark:border-[#3d3832] bg-claude-border-light/50 dark:bg-[#1a1917]/50 space-y-2">
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="List name..."
                className="w-full h-7 px-2 text-xs rounded border border-claude-border dark:border-[#3d3832] bg-white dark:bg-[#242220] text-claude-text placeholder:text-claude-text-muted focus:outline-none focus:ring-1 focus:ring-claude-accent/50"
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setIsCreating(false); }}
                autoFocus
              />
              <div className="flex items-center gap-1 flex-wrap">
                {LIST_COLORS.map(c => (
                  <button
                    key={c.name}
                    onClick={() => setNewColor(c.name)}
                    className={`h-4 w-4 rounded-full ${c.dot} transition-transform ${newColor === c.name ? 'scale-125 ring-2 ring-claude-accent ring-offset-1 ring-offset-white dark:ring-offset-[#1a1917]' : ''}`}
                    title={c.name}
                  />
                ))}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleCreate}
                  disabled={!newName.trim()}
                  className="h-6 px-2 text-[10px] font-medium rounded bg-claude-accent text-white hover:bg-claude-accent/90 disabled:opacity-50 transition-colors"
                >
                  Create
                </button>
                <button
                  onClick={() => setIsCreating(false)}
                  className="h-6 px-2 text-[10px] font-medium rounded hover:bg-claude-border-light dark:hover:bg-[#2b2926] text-claude-text-muted transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* "All papers" option */}
      <button
        onClick={() => onSelectList(null)}
        className={`w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors flex items-center justify-between group ${
          selectedListId === null
            ? 'bg-claude-accent-light dark:bg-[#3d2a22] text-claude-accent font-medium'
            : 'text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926] hover:pl-2'
        }`}
      >
        <span>{locale === 'zh' ? '全部论文' : 'All Papers'}</span>
        {totalPapersInLists > 0 && (
          <span className="text-[9px] text-claude-text-muted font-mono">{totalPapersInLists}</span>
        )}
      </button>

      {/* List items with drag-to-reorder */}
      {lists.map((list, index) => {
        const colorDef = LIST_COLORS.find(c => c.name === list.color) || LIST_COLORS[0];
        const isDefault = ['to-read', 'reading', 'read'].includes(list.id);
        const isExpanded = expandedListId === list.id;
        const isDragging = dragIndex === index;
        const isDragOver = dragOverIndex === index;

        return (
          <div
            key={list.id}
            draggable={onReorderLists !== undefined}
            onDragStart={() => handleDragStart(index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={(e) => handleDrop(e, index)}
            onDragEnd={handleDragEnd}
            className={`transition-all ${isDragging ? 'opacity-50 scale-95' : ''} ${isDragOver ? 'border-t-2 border-t-claude-accent' : ''}`}
          >
            <div
              className={`w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors flex items-center gap-1.5 group ${
                selectedListId === list.id
                  ? 'bg-claude-accent-light dark:bg-[#3d2a22] text-claude-accent font-medium'
                  : 'text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926] hover:pl-2 cursor-pointer'
              }`}
              onClick={() => {
                onSelectList(selectedListId === list.id ? null : list.id);
                setExpandedListId(isExpanded ? null : list.id);
              }}
            >
              {/* Drag handle */}
              {onReorderLists && (
                <span className="p-0 opacity-0 group-hover:opacity-50 hover:!opacity-100 cursor-grab active:cursor-grabbing text-claude-text-muted flex-shrink-0">
                  <GripVertical className="h-2.5 w-2.5" />
                </span>
              )}
              <span className={`inline-block h-2.5 w-2.5 rounded-full flex-shrink-0 ${colorDef.dot}`} />
              <span className="truncate flex-1">
                {isDefault ? getDefaultListDisplayName(list.id, locale) : list.name}
              </span>
              {/* Paper count badge */}
              {list.paperPmids.length > 0 && (
                <span className={`inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold ${
                  selectedListId === list.id
                    ? 'bg-claude-accent/20 text-claude-accent'
                    : `${colorDef.bg} ${colorDef.text}`
                }`}>
                  {list.paperPmids.length}
                </span>
              )}
              {/* Clear list button (only for non-empty lists) */}
              {onClearList && list.paperPmids.length > 0 && (
                <button
                  onClick={e => { e.stopPropagation(); onClearList(list.id); }}
                  className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 dark:hover:bg-red-900/20 text-claude-text-muted hover:text-red-500 transition-all flex-shrink-0"
                  title="Clear list"
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </button>
              )}
              {/* Delete custom list button */}
              {!isDefault && (
                <button
                  onClick={e => { e.stopPropagation(); onDeleteList(list.id); }}
                  className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 dark:hover:bg-red-900/20 text-claude-text-muted hover:text-red-500 transition-all flex-shrink-0"
                  title="Delete list"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>

            {/* Expanded list items */}
            <AnimatePresence>
              {isExpanded && list.paperPmids.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="ml-2 mt-1 mb-1 space-y-0.5 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                    {list.paperPmids.map(pmid => (
                      <ReadingListPaperItem
                        key={pmid}
                        pmid={pmid}
                        paper={papersMap?.get(pmid)}
                        readingProgress={progressMap?.[pmid] ?? 0}
                        onRemove={(pmid) => onRemovePaperFromList?.(list.id, pmid)}
                        onClick={onPaperClick}
                        borderColorClass={CATEGORY_BORDER_COLORS[list.id] || COLOR_BORDER_MAP[list.color] || 'border-l-gray-400 dark:border-l-gray-500'}
                      />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}

      {/* Recently Added section */}
      {recentlyAddedPapers.length > 0 && (
        <div className="mt-2 pt-2 border-t border-claude-border/50 dark:border-[#3d3832]/50">
          <div className="flex items-center gap-1 mb-1">
            <Clock className="h-3 w-3 text-claude-text-muted" />
            <span className="text-[9px] font-semibold text-claude-text-muted uppercase tracking-wider">
              {locale === 'zh' ? '最近添加' : 'Recently Added'}
            </span>
          </div>
          <div className="space-y-0.5">
            {recentlyAddedPapers.map(pmid => {
              const paper = papersMap?.get(pmid);
              return (
                <ReadingListPaperItem
                  key={pmid}
                  pmid={pmid}
                  paper={paper}
                  readingProgress={progressMap?.[pmid] ?? 0}
                  onRemove={() => {
                    // Remove from whichever list it's in
                    const containingList = lists.find(l => l.paperPmids.includes(pmid));
                    if (containingList && onRemovePaperFromList) {
                      onRemovePaperFromList(containingList.id, pmid);
                    }
                  }}
                  onClick={onPaperClick}
                  borderColorClass="border-l-claude-accent dark:border-l-claude-accent-hover"
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Total progress summary */}
      {totalPapersInLists > 0 && progressMap && (
        <div className="mt-2 pt-2 border-t border-claude-border/50 dark:border-[#3d3832]/50">
          <div className="px-2 py-1.5 rounded-md bg-claude-border-light/30 dark:bg-[#1a1917]/30">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-medium text-claude-text-muted uppercase tracking-wider">
                {locale === 'zh' ? '平均进度' : 'Average Progress'}
              </span>
              <span className={`text-[11px] font-bold tabular-nums ${
                averageProgress >= 100
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : averageProgress > 0
                    ? 'text-teal-600 dark:text-teal-400'
                    : 'text-claude-text-muted'
              }`}>
                {averageProgress}%
              </span>
            </div>
            <div className="h-1.5 w-full bg-claude-border-light dark:bg-[#2b2926] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${averageProgress}%`,
                  background: averageProgress >= 100
                    ? '#10b981'
                    : 'linear-gradient(90deg, #2d8f8f, #c96442)',
                }}
              />
            </div>
            <div className="flex items-center gap-2 mt-1 text-[9px] text-claude-text-muted">
              <span>{locale === 'zh' ? `${totalPapersInLists} 篇在列表中` : `${totalPapersInLists} papers in lists`}</span>
              {Object.values(progressMap).filter(p => p === 100).length > 0 && (
                <span className="text-emerald-600 dark:text-emerald-400">
                  {locale === 'zh'
                    ? `${Object.values(progressMap).filter(p => p === 100).length} 篇已完成`
                    : `${Object.values(progressMap).filter(p => p === 100).length} completed`}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Component: AddToListPopover ──────────────────────────────────────────────

interface AddToListPopoverProps {
  pmid: string;
  lists: ReadingList[];
  isPaperInList: (listId: string, pmid: string) => boolean;
  onToggle: (listId: string, pmid: string) => void;
}

export function AddToListPopover({ pmid, lists, isPaperInList, onToggle }: AddToListPopoverProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={e => { e.stopPropagation(); setOpen(!open); }}
        className={`p-1 rounded-md transition-colors ${
          open
            ? 'bg-claude-accent/10 text-claude-accent dark:text-claude-accent-hover'
            : 'text-claude-text-muted hover:text-claude-accent dark:hover:text-claude-accent-hover hover:bg-claude-accent/5 opacity-0 group-hover:opacity-100'
        }`}
        title="Add to reading list"
      >
        <BookmarkPlus className="h-3.5 w-3.5" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40"
              onClick={e => { e.stopPropagation(); setOpen(false); }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              className="absolute right-0 top-8 z-50 w-48 rounded-lg bg-white dark:bg-[#2b2926] shadow-lg border border-claude-border dark:border-[#3d3832] py-1.5 overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="px-2.5 py-1.5 text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider border-b border-claude-border dark:border-[#3d3832] mb-1">
                Add to List
              </div>
              {lists.map(list => {
                const colorDef = LIST_COLORS.find(c => c.name === list.color) || LIST_COLORS[0];
                const isIn = isPaperInList(list.id, pmid);
                return (
                  <button
                    key={list.id}
                    onClick={() => onToggle(list.id, pmid)}
                    className="w-full text-left px-2.5 py-1.5 text-xs flex items-center gap-2 hover:bg-claude-border-light dark:hover:bg-[#3d3832] transition-colors"
                  >
                    <span className={`inline-block h-2.5 w-2.5 rounded-full flex-shrink-0 ${colorDef.dot}`} />
                    <span className="flex-1 text-claude-text-secondary truncate">{list.name}</span>
                    {isIn && <Check className="h-3 w-3 text-claude-accent" />}
                  </button>
                );
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export { LIST_COLORS };
