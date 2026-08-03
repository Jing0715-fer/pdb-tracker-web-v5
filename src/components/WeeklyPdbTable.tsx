'use client';
import { useI18n } from '@/lib/i18n';

import React, { useCallback, useRef, useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ExternalLink, Bookmark, BookmarkCheck, ArrowUpDown, ArrowUp, ArrowDown, Database, ChevronRight, Eye, Copy, Check, BookOpen, Share2, Link2, BookmarkPlus } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import type { PdbEntry } from '@/lib/pdb-types';
import { WEEKLY_TABLE_COLUMNS } from '@/lib/pdb-utils';
import { getMethodColor, getMethodLabel, formatDate, parseLigands } from '@/components/pdb-helpers';
import { TableSkeleton } from '@/components/ui/pdb-ui';
import { EnhancedEmptyState } from '@/components/enhanced-empty-state';
import { MethodBadge } from '@/components/method-badge';
import { toast } from 'sonner';

// ─── Taxonomy Domain Helper ────────────────────────────────────────────────────

const EUKARYOTA_ORGANISMS = new Set([
  'Homo sapiens', 'Mus musculus', 'Rattus norvegicus',
  'Drosophila melanogaster', 'Arabidopsis thaliana', 'Saccharomyces cerevisiae',
]);

const PROKARYOTA_ORGANISMS = new Set([
  'Escherichia coli', 'Plasmodium falciparum',
]);

const VIRUS_ORGANISMS = new Set([
  'SARS-CoV-2',
]);

type TaxonomyDomain = 'Euk' | 'Pro' | 'Vir' | null;

function getTaxonomyDomain(organism: string | null): TaxonomyDomain {
  if (!organism) return null;
  const firstOrg = organism.split('|')[0]?.trim() || '';
  if (EUKARYOTA_ORGANISMS.has(firstOrg)) return 'Euk';
  if (PROKARYOTA_ORGANISMS.has(firstOrg)) return 'Pro';
  if (VIRUS_ORGANISMS.has(firstOrg)) return 'Vir';
  for (const euk of EUKARYOTA_ORGANISMS) {
    if (firstOrg.startsWith(euk)) return 'Euk';
  }
  for (const pro of PROKARYOTA_ORGANISMS) {
    if (firstOrg.startsWith(pro)) return 'Pro';
  }
  for (const vir of VIRUS_ORGANISMS) {
    if (firstOrg.includes(vir)) return 'Vir';
  }
  return null;
}

const DOMAIN_STYLES: Record<string, { bg: string; text: string }> = {
  Euk: { bg: 'bg-teal-100 dark:bg-teal-900/30', text: 'text-teal-700 dark:text-teal-400' },
  Pro: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-400' },
  Vir: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400' },
};

// ─── Mini Method Donut ──────────────────────────────────────────────────────

let donutCounter = 0;

function MiniMethodDonut({ method }: { method: string | null }) {
  const [uid] = useState(() => `donut${++donutCounter}`);
  const size = 40;
  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  const methodLabel = getMethodLabel(method || '');
  const isCryoem = methodLabel === 'Cryo-EM';
  const isXray = methodLabel === 'X-ray';

  const primaryColor = isCryoem ? '#2d8f8f' : isXray ? '#7c5cbf' : '#c9872e';
  const secondaryColor = isCryoem ? '#1a5a5a' : isXray ? '#4a3580' : '#7a5118';
  const primaryPct = 0.65;
  const secondaryPct = 0.35;

  const primaryOffset = 0;
  const primaryLength = circumference * primaryPct;
  const secondaryOffset = circumference * primaryPct;
  const secondaryLength = circumference * secondaryPct;

  return (
    <div className="flex items-center gap-2">
      <svg width={size} height={size} className="flex-shrink-0">
        <circle cx={center} cy={center} r={radius} fill="none" stroke="currentColor" strokeWidth={strokeWidth} className="text-claude-border-light dark:text-[#2b2926]" />
        <circle
          cx={center} cy={center} r={radius} fill="none"
          stroke={primaryColor} strokeWidth={strokeWidth}
          strokeDasharray={`${primaryLength} ${circumference - primaryLength}`}
          strokeDashoffset={-primaryOffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${center} ${center})`}
          opacity={0.9}
        />
        <circle
          cx={center} cy={center} r={radius} fill="none"
          stroke={secondaryColor} strokeWidth={strokeWidth}
          strokeDasharray={`${secondaryLength} ${circumference - secondaryLength}`}
          strokeDashoffset={-secondaryOffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${center} ${center})`}
          opacity={0.6}
        />
      </svg>
      <div className="flex flex-col gap-0.5">
        <span className="text-[9px] font-medium" style={{ color: primaryColor }}>{methodLabel}</span>
        <span className="text-[8px] text-claude-text-muted">
          {isCryoem ? 'EM' : isXray ? 'Diffraction' : 'Spectroscopy'}
        </span>
      </div>
    </div>
  );
}

// ─── Method Key Helper ─────────────────────────────────────────────────────────

function getMethodKey(method: string | null): string {
  const label = getMethodLabel(method || '');
  if (label === 'Cryo-EM') return 'cryoem';
  if (label === 'X-ray') return 'xray';
  if (label === 'NMR') return 'nmr';
  return 'other';
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface WeeklyPdbTableProps {
  entries: PdbEntry[];
  loading: boolean;
  sortField: string;
  sortDir: 'asc' | 'desc';
  onSort: (field: string) => void;
  onRowClick: (entry: PdbEntry) => void;
  bookmarks: Set<string>;
  onToggleBookmark: (pdbId: string) => void;
  // Selection props
  selectedEntryIds: Set<string>;
  onSelectEntries: (ids: Set<string>) => void;
  // Keyboard navigation
  highlightedRowId?: string | null;
  onHighlightRow?: (pdbId: string | null) => void;
  // Retry callback for fetch errors
  onRetry?: () => void;
  // Whether a fetch error occurred
  fetchError?: boolean;
  // Column visibility
  visibleColumns?: typeof WEEKLY_TABLE_COLUMNS;
}

// ─── Expanded Row Detail (Enhanced) ──────────────────────────────────────────

function ExpandedRowDetail({ entry, onRowClick, isBookmarked, onToggleBookmark }: { 
  entry: PdbEntry; 
  onRowClick: (entry: PdbEntry) => void;
  isBookmarked: boolean;
  onToggleBookmark: (pdbId: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  const handleCopyPdbId = useCallback(() => {
    navigator.clipboard.writeText(entry.pdbId).then(() => {
      setCopied(true);
      toast.success('Copied', { description: `PDB ID ${entry.pdbId} copied to clipboard` });
      setTimeout(() => setCopied(false), 2000);
    });
  }, [entry.pdbId]);

  const handleShare = useCallback(() => {
    const shareUrl = `https://www.rcsb.org/structure/${entry.pdbId}`;
    const shareText = `Check out PDB structure ${entry.pdbId}: ${entry.title || ''}`;
    if (navigator.share) {
      navigator.share({ title: `PDB ${entry.pdbId}`, text: shareText, url: shareUrl }).catch(() => {
        // Fallback to clipboard
        navigator.clipboard.writeText(shareUrl).then(() => {
          setShared(true);
          toast.success('Link copied', { description: 'RCSB link copied to clipboard' });
          setTimeout(() => setShared(false), 2000);
        });
      });
    } else {
      navigator.clipboard.writeText(shareUrl).then(() => {
        setShared(true);
        toast.success('Link copied', { description: 'RCSB link copied to clipboard' });
        setTimeout(() => setShared(false), 2000);
      });
    }
  }, [entry.pdbId, entry.title]);

  const handleBookmark = useCallback(() => {
    onToggleBookmark(entry.pdbId);
  }, [entry.pdbId, onToggleBookmark]);

  const methodLabel = getMethodLabel(entry.method || '');
  const methodColors = getMethodColor(entry.method || '');

  return (
    <div className="expanded-row-detail overflow-hidden" style={{ animation: 'expandRowIn 0.25s ease-out' }}>
      <div className="px-4 py-3 bg-claude-surface/50 dark:bg-[#1a1917]/50 border-b border-claude-border dark:border-[#3d3832]">
        {/* Top section: Method donut + PubMed abstract side by side */}
        <div className="flex gap-4 mb-3">
          {/* Left: Mini Method Donut */}
          <div className="flex-shrink-0 pt-0.5">
            <MiniMethodDonut method={entry.method} />
          </div>

          {/* Right: PubMed abstract preview */}
          {entry.pubmedAbstract ? (
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1">
                <BookOpen className="h-3 w-3 text-claude-accent flex-shrink-0" />
                <span className="text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider">PubMed Abstract</span>
              </div>
              <p className="text-[11px] text-claude-text-secondary leading-relaxed">
                {entry.pubmedAbstract.length > 100
                  ? entry.pubmedAbstract.slice(0, 100) + '...'
                  : entry.pubmedAbstract}
              </p>
              {entry.pubmedId && (
                <a
                  href={`https://pubmed.ncbi.nlm.nih.gov/${entry.pubmedId}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-claude-accent hover:underline mt-1 inline-flex items-center gap-0.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  Read on PubMed <ExternalLink className="h-2.5 w-2.5" />
                </a>
              )}
            </div>
          ) : (
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-claude-text-secondary italic">No PubMed abstract available</div>
            </div>
          )}
        </div>

        {/* Full Title */}
        {entry.title && (
          <div className="mb-2">
            <div className="text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider mb-0.5">Title</div>
            <div className="text-[11px] text-claude-text leading-relaxed">{entry.title}</div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
          {/* Authors */}
          {entry.authors && (
            <div>
              <div className="text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider mb-0.5">Authors</div>
              <div className="text-[11px] text-claude-text-secondary line-clamp-2">{entry.authors}</div>
            </div>
          )}

          {/* Chain & Entity Info */}
          <div>
            <div className="text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider mb-0.5">Structure Info</div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium border whitespace-nowrap ${methodColors.bg} ${methodColors.text} ${methodColors.border}`}>
                {methodLabel}
              </span>
              {entry.resolution != null && (
                <span className="text-[10px] font-mono text-claude-text-secondary">
                  {entry.resolution.toFixed(2)}Å
                </span>
              )}
              {entry.organisms && (
                <span className="text-[10px] text-claude-text-muted line-clamp-1">
                  {entry.organisms.split('|')[0]?.trim()}
                </span>
              )}
              {entry.ligands && parseLigands(entry.ligands).length > 0 && (
                <div className="flex items-center gap-0.5">
                  <span className="text-[9px] text-claude-text-muted">Ligands:</span>
                  {parseLigands(entry.ligands).slice(0, 3).map((lig, i) => (
                    <span key={i} className="ligand-chip">{lig}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Quick Action Buttons */}
        <div className="flex items-center gap-1.5 mt-3 pt-2 border-t border-claude-border-light dark:border-[#2b2926]">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] text-claude-accent hover:bg-claude-accent/10"
            onClick={(e) => { e.stopPropagation(); onRowClick(entry); }}
          >
            <Eye className="h-3 w-3 mr-1" />
            View Detail
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926]"
            onClick={(e) => { e.stopPropagation(); window.open(`https://www.rcsb.org/structure/${entry.pdbId}`, '_blank'); }}
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            Open RCSB
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926]"
            onClick={(e) => { e.stopPropagation(); handleCopyPdbId(); }}
          >
            {copied ? <Check className="h-3 w-3 mr-1 text-green-500" /> : <Copy className="h-3 w-3 mr-1" />}
            {copied ? 'Copied!' : 'Copy ID'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`h-6 px-2 text-[10px] hover:bg-claude-border-light dark:hover:bg-[#2b2926] ${isBookmarked ? 'text-claude-accent' : 'text-claude-text-secondary'}`}
            onClick={(e) => { e.stopPropagation(); handleBookmark(); }}
          >
            {isBookmarked ? <BookmarkCheck className="h-3 w-3 mr-1" /> : <BookmarkPlus className="h-3 w-3 mr-1" />}
            {isBookmarked ? 'Saved' : 'Bookmark'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926]"
            onClick={(e) => { e.stopPropagation(); handleShare(); }}
          >
            {shared ? <Check className="h-3 w-3 mr-1 text-green-500" /> : <Share2 className="h-3 w-3 mr-1" />}
            {shared ? 'Shared!' : 'Share'}
          </Button>
          {entry.doi && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926]"
              onClick={(e) => { e.stopPropagation(); window.open(`https://doi.org/${entry.doi}`, '_blank'); }}
            >
              <Link2 className="h-3 w-3 mr-1" />
              DOI
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WeeklyPdbTable({
  entries,
  loading,
  sortField,
  sortDir,
  onSort,
  onRowClick,
  bookmarks,
  onToggleBookmark,
  selectedEntryIds,
  onSelectEntries,
  highlightedRowId,
  onHighlightRow,
  onRetry,
  fetchError,
  visibleColumns,
}: WeeklyPdbTableProps) {
  // Use visible columns if provided, otherwise fall back to all columns
  const columns = visibleColumns ?? WEEKLY_TABLE_COLUMNS;
  const visibleFields = new Set(columns.map(c => c.field));
  const { t, locale } = useI18n();

  // Ref for shift-click range selection
  const lastClickedIdx = useRef<number | null>(null);

  // Expanded row state - only one row expanded at a time
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const renderSortIcon = (field: string) => {
    if (sortField !== field) return <ArrowUpDown className="h-2.5 w-2.5 opacity-30" />;
    return sortDir === 'asc'
      ? <ArrowUp className="h-2.5 w-2.5 text-claude-accent" />
      : <ArrowDown className="h-2.5 w-2.5 text-claude-accent" />;
  };

  const renderMethodBadge = (method: string | null) => {
    if (!method) return <span className="text-[10px] text-claude-text-muted">{'\u2014'}</span>;
    // Use the enhanced MethodBadge component with gradient + icon
    return <MethodBadge method={method} size="sm" showIcon={true} showLabel={true} />;
  };

  const renderResolution = (resolution: number | null) => {
    if (resolution == null) {
      return <span className="font-mono text-[11px] text-claude-text-muted">{'\u2014'}</span>;
    }
    const chipClass = resolution < 2 ? 'resolution-chip resolution-chip-high' : resolution < 3 ? 'resolution-chip resolution-chip-mid' : 'resolution-chip resolution-chip-low';
    const dotClass = resolution < 2 ? 'resolution-dot-high' : resolution < 3 ? 'resolution-dot-mid' : 'resolution-dot-low';
    return (
      <span className={chipClass}>
        <span className={`resolution-dot ${dotClass}`} />
        {resolution.toFixed(2)}Å
      </span>
    );
  };

  const renderIfBadge = (journalIf: number | null, ifTier: string) => {
    if (journalIf == null) return <span className="text-claude-text-muted text-[11px]">{'\u2014'}</span>;
    const enhancedTierClass = ifTier === 'top' ? 'if-badge-enhanced if-badge-enhanced-top' : ifTier === 'high' ? 'if-badge-enhanced if-badge-enhanced-high' : ifTier === 'mid' ? 'if-badge-enhanced if-badge-enhanced-mid' : 'if-badge-enhanced if-badge-enhanced-low';
    return (
      <span className={enhancedTierClass}>
        {journalIf.toFixed(1)}
      </span>
    );
  };

  const renderPdbId = (pdbId: string) => {
    return (
      <a
        href={`https://www.rcsb.org/structure/${pdbId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="external-link-hover inline-flex items-center gap-1 font-mono text-[11px] font-bold text-claude-accent hover:underline pdb-link"
        onClick={(e) => e.stopPropagation()}
      >
        {pdbId}
        <ExternalLink className="h-2.5 w-2.5 ext-arrow" />
      </a>
    );
  };

  const renderLigands = (ligandStr: string | null) => {
    const ligands = parseLigands(ligandStr);
    if (ligands.length === 0) return <span className="text-claude-text-muted text-[11px]">{'\u2014'}</span>;
    return (
      <div className="flex flex-wrap gap-0.5">
        {ligands.slice(0, 4).map((lig, i) => (
          <span key={i} className="ligand-chip">{lig}</span>
        ))}
        {ligands.length > 4 && (
          <span className="text-[9px] text-claude-text-muted self-center">+{ligands.length - 4}</span>
        )}
      </div>
    );
  };

  // ─── Selection handlers ─────────────────────────────────────────────────────

  const allSelected = entries.length > 0 && entries.every(e => selectedEntryIds.has(e.pdbId));
  const someSelected = entries.some(e => selectedEntryIds.has(e.pdbId)) && !allSelected;

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      const newSet = new Set(selectedEntryIds);
      entries.forEach(e => newSet.delete(e.pdbId));
      onSelectEntries(newSet);
    } else {
      const newSet = new Set(selectedEntryIds);
      entries.forEach(e => newSet.add(e.pdbId));
      onSelectEntries(newSet);
    }
  }, [allSelected, entries, selectedEntryIds, onSelectEntries]);

  const handleSelectRow = useCallback((entry: PdbEntry, idx: number, e: React.MouseEvent) => {
    const newSet = new Set(selectedEntryIds);

    if (e.shiftKey && lastClickedIdx.current !== null) {
      const start = Math.min(lastClickedIdx.current, idx);
      const end = Math.max(lastClickedIdx.current, idx);
      for (let i = start; i <= end; i++) {
        if (entries[i]) {
          newSet.add(entries[i].pdbId);
        }
      }
    } else {
      if (newSet.has(entry.pdbId)) {
        newSet.delete(entry.pdbId);
      } else {
        newSet.add(entry.pdbId);
      }
    }

    lastClickedIdx.current = idx;
    onSelectEntries(newSet);
  }, [entries, selectedEntryIds, onSelectEntries]);

  const handleToggleExpand = useCallback((pdbId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedRow(prev => prev === pdbId ? null : pdbId);
  }, []);

  if (loading) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-claude-border dark:border-[#3d3832]">
              <th className="px-1 py-2 w-7" />
              <th className="px-2 py-2 w-10" />
              <th className="px-2 py-2 w-8" />
              {columns.map(col => (
                <th key={col.field} className={`px-3 py-2 text-left text-[11px] font-semibold text-claude-text-muted ${col.widthClass}`}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <TableSkeleton rows={12} cols={columns.length + 3} />
          </tbody>
        </table>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <EnhancedEmptyState
        icon={<Database className="h-10 w-10" />}
        title={fetchError ? (locale === 'zh' ? '加载结构失败' : 'Failed to load structures') : (locale === 'zh' ? '未找到结构' : 'No structures found')}
        description={fetchError
          ? (locale === 'zh' ? '服务器可能暂时不可用，请稍后重试。' : 'The server may be temporarily unavailable. Please try again.')
          : (locale === 'zh' ? '请尝试调整筛选条件或选择其他周次来查找 PDB 结构。' : 'Try adjusting your filters or selecting a different week to find PDB structures.')}
        accentColor={fetchError ? '#dc2626' : '#2d8f8f'}
        action={fetchError && onRetry ? {
          label: 'Retry',
          icon: null,
          onClick: onRetry,
        } : undefined}
        suggestions={fetchError ? [
          { icon: '\uD83D\uDD04', text: 'Click Retry to reload' },
          { icon: '\uD83D\uDCC5', text: (locale === 'zh' ? '尝试其他周次' : 'Try a different week') },
        ] : [
          { icon: '\uD83D\uDD0D', text: (locale === 'zh' ? '清除所有筛选' : 'Clear all filters') },
          { icon: '\uD83D\uDCC5', text: (locale === 'zh' ? '尝试其他周次' : 'Try a different week') },
          { icon: '\uD83D\uDD2C', text: (locale === 'zh' ? '按 PDB ID 搜索' : 'Search by PDB ID') },
        ]}
      />
    );
  }

  return (
    <div className="relative">
      {/* Scroll hint indicator for narrow screens */}
      <div className="md:hidden absolute top-0 right-0 z-10 pointer-events-none">
        <div className="table-scroll-hint flex items-center gap-1 px-2 py-1 rounded-bl-lg bg-claude-surface/80 dark:bg-[#242220]/80 backdrop-blur-sm text-[9px] text-claude-text-muted border-b border-l border-claude-border/50 dark:border-[#3d3832]/50">
          <span>Scroll →</span>
        </div>
      </div>
      <div className="overflow-x-auto custom-scrollbar table-scroll-container">
        <table className="w-full border-collapse text-sm min-w-[700px]">
        <thead>
          <tr className="border-b-2 border-claude-border dark:border-[#4a4540] bg-gradient-to-r from-claude-surface to-[#faf7f4] dark:from-[#242220] dark:to-[#2b2926] sticky top-0 z-[5]">
            {/* Expand chevron column */}
            <th className="px-1 py-2.5 w-7" />

            {/* Checkbox column */}
            <th className="px-2 py-2.5 w-10">
              <Checkbox
                checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                onCheckedChange={handleSelectAll}
                className="indeterminate-checkbox data-[state=checked]:bg-[#c96442] data-[state=checked]:border-[#c96442]"
                aria-label={t.selectAllRows}
              />
            </th>

            {/* Bookmark column */}
            <th className="px-2 py-2.5 w-8" />

            {columns.map(col => (
              <th
                key={col.field}
                className={`table-header-cell table-header-enhanced px-3 py-2.5 text-left text-[10px] font-bold text-claude-text-muted uppercase tracking-wider whitespace-nowrap ${col.widthClass} ${
                  col.sortable ? 'cursor-pointer hover:text-claude-text select-none' : ''
                } ${sortField === col.field ? 'sort-active' : ''}`}
                onClick={() => col.sortable && onSort(col.field)}
              >
                <div className="flex items-center gap-1">
                  {col.label}
                  {col.sortable && renderSortIcon(col.field)}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, idx) => {
            const isEven = idx % 2 === 0;
            const isBookmarked = bookmarks.has(entry.pdbId);
            const isSelected = selectedEntryIds.has(entry.pdbId);
            const isExpanded = expandedRow === entry.pdbId;
            const isHighlighted = highlightedRowId === entry.pdbId;

            return (
              <React.Fragment key={entry.pdbId}>
                <tr
                  className={`cursor-pointer border-b border-claude-border-light dark:border-[#2b2926] table-row-hover-enhanced ${
                    isHighlighted
                      ? 'keyboard-focused-row border-l-claude-accent'
                      : isSelected
                        ? 'row-selected table-row-hover-enhanced'
                        : isEven ? 'table-zebra-even table-row-hover-enhanced' : 'table-zebra-odd table-row-hover-enhanced'
                  } ${isExpanded ? 'bg-claude-accent-light/30 dark:bg-[#3d2a22]/30 border-l-claude-accent/60' : ''}`}
                  onClick={() => onRowClick(entry)}
                  data-pdb-id={entry.pdbId}
                  data-method={getMethodKey(entry.method)}
                >
                  {/* Expand chevron */}
                  <td
                    className="px-1 py-2"
                    onClick={(e) => handleToggleExpand(entry.pdbId, e)}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button className="claude-focus-ring rounded p-0.5 active:scale-90 transition-transform duration-100" aria-label={isExpanded ? 'Collapse row' : 'Expand row'}>
                          <div
                            className="transition-transform duration-200"
                            style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                          >
                            <ChevronRight className={`h-3 w-3 transition-colors ${isExpanded ? 'text-claude-accent' : 'text-claude-text-muted opacity-40'}`} />
                          </div>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom"><p>{isExpanded ? 'Collapse' : 'Expand'}</p></TooltipContent>
                    </Tooltip>
                  </td>

                  {/* Checkbox */}
                  <td
                    className="px-2 py-2"
                    onClick={(e) => { e.stopPropagation(); handleSelectRow(entry, idx, e); }}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => {
                        const newSet = new Set(selectedEntryIds);
                        if (newSet.has(entry.pdbId)) newSet.delete(entry.pdbId);
                        else newSet.add(entry.pdbId);
                        lastClickedIdx.current = idx;
                        onSelectEntries(newSet);
                      }}
                      className="data-[state=checked]:bg-[#c96442] data-[state=checked]:border-[#c96442]"
                      aria-label={`Select ${entry.pdbId}`}
                    />
                  </td>

                  {/* Bookmark */}
                  <td className="px-2 py-2" onClick={(e) => { e.stopPropagation(); onToggleBookmark(entry.pdbId); }}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button className="claude-focus-ring rounded active:scale-90 transition-transform duration-100" aria-label={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}>
                          {isBookmarked ? (
                            <BookmarkCheck className="h-3.5 w-3.5 text-claude-accent" />
                          ) : (
                            <Bookmark className="h-3.5 w-3.5 text-claude-text-muted opacity-40 hover:opacity-70 transition-opacity" />
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom"><p>{isBookmarked ? 'Remove bookmark' : 'Add bookmark'} <kbd className="ml-1 text-[8px]">B</kbd></p></TooltipContent>
                    </Tooltip>
                  </td>

                  {/* PDB ID */}
                  {visibleFields.has('pdbId') && (
                  <td className="px-3 py-2 w-[90px]">
                    {renderPdbId(entry.pdbId)}
                  </td>
                  )}

                  {/* Method */}
                  {visibleFields.has('method') && (
                  <td className="px-3 py-2 w-[90px]">
                    {renderMethodBadge(entry.method)}
                  </td>
                  )}

                  {/* Resolution */}
                  {visibleFields.has('resolution') && (
                  <td className="px-3 py-2 w-[80px]">
                    {renderResolution(entry.resolution)}
                  </td>
                  )}

                  {/* IF */}
                  {visibleFields.has('journalIf') && (
                  <td className="px-3 py-2 w-[55px]">
                    {renderIfBadge(entry.journalIf, entry.ifTier)}
                  </td>
                  )}

                  {/* Organism */}
                  {visibleFields.has('organisms') && (
                  <td className="px-3 py-2 w-[130px]">
                    <div className="flex items-center gap-1">
                      {(() => {
                        const domain = getTaxonomyDomain(entry.organisms);
                        const domainStyle = domain ? DOMAIN_STYLES[domain] : null;
                        return domain && domainStyle ? (
                          <span className={`inline-flex items-center px-1 py-0 rounded text-[8px] font-bold leading-tight ${domainStyle.bg} ${domainStyle.text}`}>
                            {domain}
                          </span>
                        ) : null;
                      })()}
                      <span className="text-[11px] text-claude-text-secondary line-clamp-1" title={entry.organisms || ''}>
                        {entry.organisms ? entry.organisms.split('|')[0]?.trim() || entry.organisms : '\u2014'}
                      </span>
                    </div>
                  </td>
                  )}

                  {/* Title */}
                  {visibleFields.has('title') && (
                  <td className="px-3 py-2 min-w-[200px]">
                    <span className="text-[11px] text-claude-text line-clamp-1" title={entry.title || ''}>
                      {entry.title || '\u2014'}
                    </span>
                  </td>
                  )}

                  {/* Date */}
                  {visibleFields.has('releaseDate') && (
                  <td className="px-3 py-2 w-[95px]">
                    <span className="text-[11px] text-claude-text-muted font-mono">
                      {formatDate(entry.releaseDate)}
                    </span>
                  </td>
                  )}

                  {/* Ligands */}
                  {visibleFields.has('ligands') && (
                  <td className="px-3 py-2 w-[130px]">
                    {renderLigands(entry.ligands)}
                  </td>
                  )}

                  {/* Journal */}
                  {visibleFields.has('journal') && (
                  <td className="px-3 py-2 w-[120px]">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px] text-claude-text-secondary line-clamp-1" title={entry.journal || ''}>
                        {entry.journal || '\u2014'}
                      </span>
                      {entry.journalIf != null && entry.journalIf > 0 && (
                        <div className="flex items-center gap-1">
                          <div
                            className="journal-if-bar"
                            style={{
                              width: `${Math.min(Math.max(entry.journalIf * 1.2, 8), 30)}px`,
                              backgroundColor: entry.journalIf >= 20 ? '#dc2626' : entry.journalIf >= 10 ? '#ea580c' : entry.journalIf >= 5 ? '#16a34a' : '#6b7280',
                              opacity: 0.6,
                            }}
                          />
                          <span className="text-[8px] font-mono text-claude-text-muted">{entry.journalIf.toFixed(1)}</span>
                        </div>
                      )}
                    </div>
                  </td>
                  )}
                </tr>

                {/* Expanded detail row */}
                <AnimatePresence>
                  {isExpanded && (
                    <tr>
                      <td colSpan={columns.length + 3} className="p-0 border-b border-claude-border-light dark:border-[#2b2926]">
                        <ExpandedRowDetail 
                          entry={entry} 
                          onRowClick={onRowClick} 
                          isBookmarked={isBookmarked}
                          onToggleBookmark={onToggleBookmark}
                        />
                      </td>
                    </tr>
                  )}
                </AnimatePresence>
              </React.Fragment>
            );
          })}
        </tbody>
      </table>

      {/* Selection counter in toolbar area */}
      {selectedEntryIds.size > 0 && (
        <div className="px-3 py-1.5 bg-[#2d8f8f]/5 dark:bg-[#2d8f8f]/10 border-t border-[#2d8f8f]/20 flex items-center gap-2">
          <span className="text-[10px] font-medium text-[#2d8f8f]">
            {selectedEntryIds.size} of {entries.length} selected on this page
          </span>
          <button
            onClick={() => onSelectEntries(new Set())}
            className="text-[10px] text-claude-text-muted hover:text-red-500 transition-colors underline"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  </div>
  );
}
