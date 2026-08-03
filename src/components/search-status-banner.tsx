'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, Filter, Database, FlaskConical, BookOpen } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

/**
 * SearchStatusBanner
 *
 * A compact banner that appears when a search query or filter is active,
 * showing:
 *   - The current search term (with a clear button)
 *   - The active method filter (Cryo-EM / X-ray / NMR / Bookmarks / etc.)
 *   - The result count vs. total
 *
 * This gives users clear feedback about what filters are applied and
 * a one-click way to reset them.
 *
 * Supports all 3 data modes: weekly (structures), evaluation (targets),
 * literature (papers).
 */

type BannerMode = 'weekly' | 'evaluation' | 'literature';

interface SearchStatusBannerProps {
  searchQuery: string;
  activeFilter: string;
  resultCount: number;
  totalCount: number;
  onClearSearch: () => void;
  onClearFilter: () => void;
  onClearAll: () => void;
  mode?: BannerMode;
}

// Human-readable filter labels
const FILTER_LABELS: Record<string, { en: string; zh: string }> = {
  // Weekly filters
  all: { en: 'All', zh: '全部' },
  bookmarks: { en: 'Bookmarks', zh: '收藏' },
  cryoem: { en: 'Cryo-EM', zh: '冷冻电镜' },
  'cryo-em': { en: 'Cryo-EM', zh: '冷冻电镜' },
  'Cryo-EM': { en: 'Cryo-EM', zh: '冷冻电镜' },
  xray: { en: 'X-ray', zh: 'X射线' },
  'X-RAY DIFFRACTION': { en: 'X-ray', zh: 'X射线' },
  nmr: { en: 'NMR', zh: '核磁共振' },
  'SOLUTION NMR': { en: 'NMR', zh: '核磁共振' },
  'high-if': { en: 'High IF (≥20)', zh: '高影响因子' },
  'top-if': { en: 'Top IF (≥10)', zh: '顶级影响因子' },
  // Evaluation filters
  'high-coverage': { en: '≥80% Coverage', zh: '高覆盖率' },
  'medium-coverage': { en: '≥50% Coverage', zh: '中覆盖率' },
  'low-coverage': { en: '<50% Coverage', zh: '低覆盖率' },
  'has-structure': { en: 'Has Structure', zh: '有结构' },
  'has-blast': { en: 'Has Homolog', zh: '有同源' },
  // Literature filters
  daily: { en: 'Daily Digest', zh: '日报' },
  '5': { en: 'IF ≥ 5', zh: 'IF ≥ 5' },
  '10': { en: 'IF ≥ 10', zh: 'IF ≥ 10' },
  '20': { en: 'IF ≥ 20', zh: 'IF ≥ 20' },
};

// Unit text per mode
function getUnitText(mode: BannerMode, locale: string): string {
  if (locale === 'zh') {
    return mode === 'evaluation' ? '个靶点' : mode === 'literature' ? '篇论文' : '个结构';
  }
  return mode === 'evaluation' ? 'targets' : mode === 'literature' ? 'papers' : 'structures';
}

export function SearchStatusBanner({
  searchQuery,
  activeFilter,
  resultCount,
  totalCount,
  onClearSearch,
  onClearFilter,
  onClearAll,
  mode = 'weekly',
}: SearchStatusBannerProps) {
  const { locale } = useI18n();
  const hasSearch = searchQuery.trim().length > 0;
  const hasFilter = activeFilter && activeFilter !== 'all' && activeFilter !== '';
  const isVisible = hasSearch || hasFilter;

  if (!isVisible) return null;

  const filterLabel = hasFilter
    ? (FILTER_LABELS[activeFilter]?.[locale === 'zh' ? 'zh' : 'en'] || activeFilter)
    : null;

  const isFiltered = resultCount < totalCount;
  const unit = getUnitText(mode, locale);
  const resultText = locale === 'zh'
    ? `${resultCount} / ${totalCount} ${unit}`
    : `${resultCount} of ${totalCount} ${unit}`;

  return (
    <AnimatePresence mode="wait">
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="overflow-hidden border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="flex items-center gap-2 px-3 sm:px-4 py-2 flex-wrap">
            {/* Active indicator dot */}
            <div className="flex items-center gap-1.5 shrink-0">
              <motion.div
                animate={{ scale: [1, 1.2, 1], opacity: [0.6, 1, 0.6] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                className="w-1.5 h-1.5 rounded-full bg-claude-accent"
              />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-claude-text-muted">
                {locale === 'zh' ? '已筛选' : 'Filtered'}
              </span>
            </div>

            {/* Search term chip */}
            {hasSearch && (
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-claude-accent/10 border border-claude-accent/20 text-[11px]"
              >
                <Search className="h-2.5 w-2.5 text-claude-accent" />
                <span className="font-mono text-claude-text-secondary max-w-[200px] truncate">
                  &ldquo;{searchQuery}&rdquo;
                </span>
                <button
                  onClick={onClearSearch}
                  className="ml-0.5 text-claude-text-muted hover:text-claude-accent transition-colors"
                  aria-label={locale === 'zh' ? '清除搜索' : 'Clear search'}
                >
                  <X className="h-3 w-3" />
                </button>
              </motion.div>
            )}

            {/* Filter chip */}
            {filterLabel && (
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#2d8f8f]/10 border border-[#2d8f8f]/20 text-[11px]"
              >
                <Filter className="h-2.5 w-2.5 text-[#2d8f8f]" />
                <span className="text-claude-text-secondary">{filterLabel}</span>
                <button
                  onClick={onClearFilter}
                  className="ml-0.5 text-claude-text-muted hover:text-[#2d8f8f] transition-colors"
                  aria-label={locale === 'zh' ? '清除筛选' : 'Clear filter'}
                >
                  <X className="h-3 w-3" />
                </button>
              </motion.div>
            )}

            {/* Result count */}
            <div className="flex items-center gap-1.5 ml-auto shrink-0">
              {mode === 'evaluation' ? <FlaskConical className="h-3 w-3 text-claude-text-muted" /> : mode === 'literature' ? <BookOpen className="h-3 w-3 text-claude-text-muted" /> : <Database className="h-3 w-3 text-claude-text-muted" />}
              <span className={`text-[11px] font-mono ${isFiltered ? 'text-claude-accent font-semibold' : 'text-claude-text-muted'}`}>
                {resultText}
              </span>
            </div>

            {/* Clear all button */}
            <button
              onClick={onClearAll}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium text-claude-text-muted hover:text-claude-text hover:bg-claude-border-light dark:hover:bg-[#2b2926] transition-all"
            >
              <X className="h-2.5 w-2.5" />
              {locale === 'zh' ? '清除全部' : 'Clear all'}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
