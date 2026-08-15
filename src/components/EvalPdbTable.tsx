'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  ExternalLink,
  Copy,
  Search as SearchIcon,
  MoreHorizontal,
  BookOpen,
} from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { Badge } from '@/components/ui/badge';
import { Pagination } from '@/components/ui/pdb-ui';
import { TableSkeleton } from '@/components/ui/pdb-ui';
import type { EvalRow, EvalStructureRow, EvalBlastRow } from '@/lib/pdb-types';
import { EVAL_TABLE_COLUMNS, DEFAULT_PAGE_SIZE } from '@/lib/pdb-utils';
import {
  getMethodColor,
  getMethodLabel,
  getIfTierStyle,
  getResolutionColor,
  getIdentityColor,
  formatDate,
  parseLigands,
  formatEvalue,
  getScoreColor,
} from '@/components/pdb-helpers';
import { toast } from 'sonner';

interface EvalPdbTableProps {
  rows: EvalRow[];
  loading?: boolean;
  compact?: boolean;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  onSelectRow?: (row: EvalRow) => void;
  selectedPdbId?: string | null;
}

const TYPE_STYLES = {
  structure: {
    bg: 'bg-teal-50 dark:bg-teal-900/20',
    text: 'text-teal-700 dark:text-teal-300',
    border: 'border-teal-200 dark:border-teal-700/50',
    label: 'Structure',
  },
  blast: {
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-200 dark:border-amber-700/50',
    label: 'Homolog',
  },
};

function getResolutionDot(resolution: number | null): string {
  if (resolution == null) return 'bg-gray-300 dark:bg-gray-600';
  if (resolution <= 2.0) return 'bg-emerald-500';
  if (resolution <= 3.0) return 'bg-amber-500';
  return 'bg-red-500';
}

export function EvalPdbTable({
  rows,
  loading = false,
  compact = false,
  searchQuery = '',
  onSearchChange,
  onSelectRow,
  selectedPdbId,
}: EvalPdbTableProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [sortField, setSortField] = useState<string>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const handleSort = useCallback(
    (field: string) => {
      if (sortField === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDir('desc');
      }
      setPage(1);
    },
    [sortField]
  );

  const sortedRows = useMemo(() => {
    if (!sortField) return rows;
    const sorted = [...rows].sort((a, b) => {
      let aVal: any;
      let bVal: any;

      if (sortField === '_type') {
        aVal = a._type;
        bVal = b._type;
      } else if (sortField === '_ligands') {
        const aLig = a._type === 'structure' ? (a as EvalStructureRow).ligand : (a as EvalBlastRow).ligand;
        const bLig = b._type === 'structure' ? (b as EvalStructureRow).ligand : (b as EvalBlastRow).ligand;
        aVal = aLig || '';
        bVal = bLig || '';
      } else {
        aVal = (a as any)[sortField];
        bVal = (b as any)[sortField];
      }

      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }

      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      return sortDir === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
    });
    return sorted;
  }, [rows, sortField, sortDir]);

  const filteredRows = useMemo(() => {
    if (!searchQuery) return sortedRows;
    const q = searchQuery.toLowerCase();
    return sortedRows.filter((row) => {
      const pdbId = row.pdbId?.toLowerCase() || '';
      const title = (row as any).title?.toLowerCase() || '';
      const description = (row as EvalBlastRow).description?.toLowerCase() || '';
      const method = getMethodLabel(row.method).toLowerCase();
      return pdbId.includes(q) || title.includes(q) || description.includes(q) || method.includes(q);
    });
  }, [sortedRows, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, page, pageSize]);

  const handleCopyPdbId = (pdbId: string) => {
    navigator.clipboard.writeText(pdbId);
    toast.success(`Copied ${pdbId} to clipboard`);
  };

  const handleOpenRcsb = (pdbId: string) => {
    window.open(`https://www.rcsb.org/structure/${pdbId}`, '_blank', 'noopener');
  };

  const handleSearchPubMed = (row: EvalRow) => {
    const query = row.pdbId || '';
    if (query) {
      window.open(`https://pubmed.ncbi.nlm.nih.gov/?term=${query}`, '_blank', 'noopener');
    }
  };

  const renderTypeBadge = (type: 'structure' | 'blast') => {
    const style = TYPE_STYLES[type];
    return (
      <span
        className={`inline-flex items-center justify-center min-w-[62px] px-1.5 py-0.5 rounded text-[9px] font-medium border ${style.bg} ${style.text} ${style.border} method-badge`}
      >
        {style.label}
      </span>
    );
  };

  const renderMethodBadge = (method: string | null) => {
    if (!method) return <span className="text-[10px] text-claude-text-muted">—</span>;
    const colors = getMethodColor(method);
    const label = getMethodLabel(method);
    const methodKey = label.toLowerCase().replace('-', '') as 'cryoem' | 'xray' | 'nmr' | 'other';
    const badgeClass = `method-badge-${methodKey}`;
    return (
      <span
        className={`inline-flex items-center justify-center min-w-[62px] px-1.5 py-0.5 rounded text-[9px] font-medium border ${colors.bg} ${colors.text} ${colors.border} method-badge ${badgeClass}`}
      >
        {label}
      </span>
    );
  };

  const renderIfTier = (ifTier: string | null, journalIf: number | null) => {
    if (!ifTier && journalIf == null) return <span className="text-[10px] text-claude-text-muted">—</span>;
    const tier = ifTier || 'unknown';
    const style = getIfTierStyle(tier);
    return (
      <span className={`inline-flex items-center gap-1 ${style.text}`}>
        <span className="font-mono text-[10px] font-medium">
          {journalIf != null ? journalIf.toFixed(1) : '—'}
        </span>
      </span>
    );
  };

  const renderResolution = (resolution: number | null) => {
    if (resolution == null) return <span className="text-[10px] text-claude-text-muted">—</span>;
    const colorClass = getResolutionColor(resolution);
    return (
      <span className={`inline-flex items-center gap-1 ${colorClass}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${getResolutionDot(resolution)}`} />
        <span className="font-mono text-[10px]">{resolution.toFixed(2)}Å</span>
      </span>
    );
  };

  const renderLigandChips = (ligand: string | null) => {
    const ligands = parseLigands(ligand);
    if (ligands.length === 0) return <span className="text-[10px] text-claude-text-muted">—</span>;
    return (
      <div className="flex flex-wrap gap-0.5">
        {ligands.slice(0, 3).map((l, i) => (
          <span key={`${l}-${i}`} className="ligand-chip">
            {l}
          </span>
        ))}
        {ligands.length > 3 && (
          <span className="text-[9px] text-claude-text-muted">+{ligands.length - 3}</span>
        )}
      </div>
    );
  };

  const getTitle = (row: EvalRow): string => {
    if (row._type === 'blast') {
      const blastRow = row as EvalBlastRow;
      return blastRow.description || blastRow.title || '—';
    }
    return (row as EvalStructureRow).title || '—';
  };

  const getLigand = (row: EvalRow): string | null => {
    if (row._type === 'structure') return (row as EvalStructureRow).ligand;
    return (row as EvalBlastRow).ligand;
  };

  const getIfTier = (row: EvalRow): string | null => {
    if (row._type === 'structure') return (row as EvalStructureRow).ifTier;
    return (row as EvalBlastRow).ifTier;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Table container */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        <table className={`w-full border-collapse text-left ${compact ? 'compact-table' : ''}`}>
          <thead className="sticky top-0 z-10 bg-gradient-to-r from-claude-surface to-[#faf7f4] dark:from-[#242220] dark:to-[#2b2926] border-b-2 border-claude-border dark:border-[#4a4540]">
            <tr>
              {EVAL_TABLE_COLUMNS.map((col) => (
                <th
                  key={col.field}
                  className={`table-header-cell px-3 py-2.5 text-[10px] font-bold text-claude-text-muted uppercase tracking-wider whitespace-nowrap ${col.widthClass} ${
                    col.sortable ? 'cursor-pointer hover:text-claude-text select-none' : ''
                  } ${sortField === col.field ? 'sort-active' : ''}`}
                  onClick={col.sortable ? () => handleSort(col.field) : undefined}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    {col.sortable && sortField === col.field && (
                      <span className="text-claude-accent">
                        {sortDir === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableSkeleton rows={10} cols={EVAL_TABLE_COLUMNS.length} />
            ) : pageRows.length === 0 ? (
              <tr>
                <td
                  colSpan={EVAL_TABLE_COLUMNS.length}
                  className="text-center py-12 text-sm text-claude-text-muted"
                >
                  No structures or homologs found
                </td>
              </tr>
            ) : (
              pageRows.map((row, idx) => {
                const isEven = idx % 2 === 0;
                const isSelected = selectedPdbId === row.pdbId;
                return (
                  <ContextMenu key={`${row._type}-${row.pdbId}-${idx}`}>
                    <ContextMenuTrigger asChild>
                      <tr
                        className={`table-row-hover table-row-hover-enhanced cursor-pointer border-l-2 border-l-transparent transition-all duration-150 ${
                          isEven ? 'table-row-even' : 'table-row-odd'
                        } ${isSelected ? 'bg-claude-accent-light/50 dark:bg-[#3d2a22]/50 border-l-claude-accent/60' : ''}`}
                        data-method={getMethodLabel(row.method)}
                        onClick={() => onSelectRow?.(row)}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSelectRow?.(row);
                          }
                        }}
                      >
                        {/* PDB ID */}
                        <td className="px-3 py-2">
                          <span className="font-mono text-[11px] font-medium text-claude-accent pdb-link">
                            {row.pdbId}
                          </span>
                        </td>

                        {/* Type */}
                        <td className="px-3 py-2">{renderTypeBadge(row._type)}</td>

                        {/* Source (BLAST specific) */}
                        <td className="px-3 py-2">
                          {row._type === 'blast' ? (
                            <div className="space-y-0.5">
                              {(row as EvalBlastRow).identity != null && (
                                <span
                                  className={`text-[10px] font-mono font-medium ${getIdentityColor(
                                    (row as EvalBlastRow).identity!
                                  )}`}
                                >
                                  {(row as EvalBlastRow).identity!.toFixed(0)}%
                                </span>
                              )}
                              {(row as EvalBlastRow).evalue != null && (
                                <span className="block text-[9px] text-claude-text-muted font-mono">
                                  E:{' '}
                                  {formatEvalue(
                                    parseFloat((row as EvalBlastRow).evalue!) || 0
                                  )}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-[9px] text-claude-text-muted">Direct</span>
                          )}
                        </td>

                        {/* Method */}
                        <td className="px-3 py-2">{renderMethodBadge(row.method)}</td>

                        {/* Resolution */}
                        <td className="px-3 py-2">{renderResolution(row.resolution)}</td>

                        {/* IF */}
                        <td className="px-3 py-2">
                          {renderIfTier(getIfTier(row), row.journalIf)}
                        </td>

                        {/* Title / Description */}
                        <td className="px-3 py-2 max-w-[300px]">
                          <p className="text-[11px] text-claude-text truncate" title={getTitle(row)}>
                            {getTitle(row)}
                          </p>
                        </td>

                        {/* Date */}
                        <td className="px-3 py-2">
                          <span className="text-[10px] text-claude-text-muted whitespace-nowrap">
                            {formatDate(row.releaseDate)}
                          </span>
                        </td>

                        {/* Ligands */}
                        <td className="px-3 py-2">{renderLigandChips(getLigand(row))}</td>
                      </tr>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-48">
                      <ContextMenuItem
                        onClick={() => onSelectRow?.(row)}
                        className="text-xs"
                      >
                        <ExternalLink className="h-3.5 w-3.5 mr-2" />
                        View Detail
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => handleCopyPdbId(row.pdbId)}
                        className="text-xs"
                      >
                        <Copy className="h-3.5 w-3.5 mr-2" />
                        Copy PDB ID
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => handleOpenRcsb(row.pdbId)}
                        className="text-xs"
                      >
                        <ExternalLink className="h-3.5 w-3.5 mr-2" />
                        Open in RCSB
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        onClick={() => handleSearchPubMed(row)}
                        className="text-xs"
                      >
                        <BookOpen className="h-3.5 w-3.5 mr-2" />
                        Search PubMed
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {!loading && filteredRows.length > 0 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          totalItems={filteredRows.length}
          pageSize={pageSize}
          onPageChange={(p) => {
            setPage(p);
            setPageSize(pageSize);
          }}
        />
      )}
    </div>
  );
}
