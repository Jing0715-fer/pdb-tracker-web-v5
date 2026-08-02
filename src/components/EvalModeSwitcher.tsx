'use client';

import React, { useState, useMemo } from 'react';
import { useI18n } from '@/lib/i18n';
import {
  Search,
  ChevronDown,
  ChevronRight,
  Layers,
  Dna,
  Target,
  Trash2,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import type { Evaluation, EvalBatch } from '@/lib/pdb-types';
import type { ComplexGroup, EvalBatchSubTarget } from './pdb-sidebar';
import { getScoreColor, truncateOrganism } from '@/components/pdb-helpers';

interface EvalModeSwitcherProps {
  // Individual eval props (all optional for compatibility with sidebar usage)
  evaluations?: Evaluation[];
  batches?: EvalBatch[];
  batchSubTargets?: Record<string, EvalBatchSubTarget[]>;
  selectedUniprotId?: string | null;
  onSelectEval?: (uniprotId: string) => void;
  onDeleteEval?: (uniprotId: string) => void;
  loading?: boolean;
  // Complex group props
  complexGroups?: ComplexGroup[];
  selectedComplexId?: string | null;
  expandedComplexId?: string | null;
  selectedEvalId?: string | null;
  complexFetchedEvals?: Record<string, Evaluation>;
  onSelectComplexGroup?: (id: string) => void;
  onToggleExpandedComplex?: (id: string) => void;
  onRemoveComplexGroup?: (id: string) => void;
  evalBatches?: EvalBatch[];
  evalBatchSubTargets?: Record<string, EvalBatchSubTarget[]>;
  selectedBatchId?: string | null;
  expandedEvalGroups?: Set<string> | ((prev: Set<string>) => Set<string>);
  batchFetchedEvals?: Record<string, Evaluation>;
  onSelectBatch?: (id: string) => void;
  onSelectBatchSubTarget?: (batchId: string, uniprotId: string) => void;
  onToggleExpandedBatch?: (id: string, expanded: boolean) => void;
  showComplexDialog?: boolean;
  onOpenComplexDialog?: () => void;
}

export function EvalModeSwitcher({
  evaluations = [],
  batches = [],
  batchSubTargets = {},
  selectedUniprotId = null,
  onSelectEval = () => {},
  onDeleteEval,
  loading = false,
  // Complex group props (unused in this component, accepted for compatibility)
  complexGroups,
  selectedComplexId,
  expandedComplexId,
  selectedEvalId,
  complexFetchedEvals,
  onSelectComplexGroup,
  onToggleExpandedComplex,
  onRemoveComplexGroup,
  evalBatches,
  evalBatchSubTargets,
  selectedBatchId,
  expandedEvalGroups,
  batchFetchedEvals,
  onSelectBatch,
  onSelectBatchSubTarget,
  onToggleExpandedBatch,
  showComplexDialog,
  onOpenComplexDialog,
}: EvalModeSwitcherProps) {
  const { t, locale } = useI18n();
  const [searchQuery, setSearchQuery] = useState('');
  const [individualOpen, setIndividualOpen] = useState(true);
  const [batchOpen, setBatchOpen] = useState(true);
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());

  const toggleBatch = (batchId: string) => {
    setExpandedBatches((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
    // Notify parent that the batch was selected (so it can open the batch
    // detail panel). The parent decides whether to also clear the selected
    // sub-target / individual eval.
    onSelectBatch?.(batchId);
  };

  const filteredEvaluations = useMemo(() => {
    if (!searchQuery) return evaluations;
    const q = searchQuery.toLowerCase();
    return evaluations.filter(
      (e) =>
        e.uniprotId.toLowerCase().includes(q) ||
        e.proteinName?.toLowerCase().includes(q) ||
        e.geneNames?.toLowerCase().includes(q) ||
        e.organism?.toLowerCase().includes(q)
    );
  }, [evaluations, searchQuery]);

  const filteredBatches = useMemo(() => {
    if (!searchQuery) return batches;
    const q = searchQuery.toLowerCase();
    return batches.filter(
      (b) =>
        b.title?.toLowerCase().includes(q) ||
        b.batchId.toLowerCase().includes(q)
    );
  }, [batches, searchQuery]);

  const parseScores = (scoresStr: string | null): Record<string, { score: number }> => {
    if (!scoresStr) return {};
    try {
      return JSON.parse(scoresStr);
    } catch {
      return {};
    }
  };

  const getOverallScore = (evalItem: Evaluation): number => {
    const scores = parseScores(evalItem.scores);
    return scores?.Overall?.score ?? 0;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search - compact, no duplicate header (sidebar already has one) */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-claude-text-muted" />
          <Input
            type="text"
            placeholder={t.searchProteins}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 pl-8 pr-3 text-xs bg-claude-bg dark:bg-[#1a1917] border-claude-border dark:border-[#3d3832] focus:ring-claude-accent/30 input-focus-glow"
          />
        </div>
        <p className="text-[10px] text-claude-text-muted mt-1.5">
          {evaluations.length} {locale === 'zh' ? '个蛋白' : 'proteins'} · {batches.length} {locale === 'zh' ? '个批次' : 'batches'}
        </p>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto sidebar-scroll px-2 pb-3 space-y-1">
        {loading ? (
          <div className="space-y-2 px-1 pt-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={`skel-${i}`}
                className="h-16 rounded-lg shimmer-skeleton"
              />
            ))}
          </div>
        ) : (
          <>
            {/* Individual Evaluations Section */}
            <div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setIndividualOpen(!individualOpen)}
                    className="flex items-center gap-1.5 w-full px-2 py-1.5 text-xs font-medium text-claude-text-secondary hover:text-claude-text transition-colors rounded-md hover:bg-claude-border-light dark:hover:bg-[#2b2926] active:scale-[0.98]"
                  >
                    {individualOpen ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    <Dna className="h-3 w-3" />
                    <span>{t.individualEvalsFull}</span>
                    <Badge
                      variant="secondary"
                      className="ml-auto h-4 px-1.5 text-[9px] bg-claude-border-light dark:bg-[#2b2926] text-claude-text-muted border-0"
                    >
                      {filteredEvaluations.length}
                    </Badge>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right"><p>{individualOpen ? (locale === 'zh' ? '收起' : 'Collapse') : (locale === 'zh' ? '展开' : 'Expand')} {locale === 'zh' ? '单独评估' : 'individual evaluations'}</p></TooltipContent>
              </Tooltip>

              <div className={individualOpen ? 'eval-section-expand' : 'eval-section-collapse'}>
                <div className="space-y-1 px-1 pt-1">
                  {filteredEvaluations.length === 0 ? (
                    <p className="text-[11px] text-claude-text-muted px-2 py-3 text-center">
                      {searchQuery ? (locale === 'zh' ? '未找到匹配的评估' : 'No matching evaluations') : (locale === 'zh' ? '暂无单独评估' : 'No individual evaluations')}
                    </p>
                  ) : (
                    filteredEvaluations.map((evalItem) => {
                      const score = getOverallScore(evalItem);
                      const isSelected = selectedUniprotId === evalItem.uniprotId;
                      const pdbCount = evalItem.pdbStructures?.length ?? 0;
                      const blastCount = evalItem.blastResults?.length ?? 0;

                      const evalButton = (
                        <button
                          key={evalItem.uniprotId}
                          onClick={() => onSelectEval(evalItem.uniprotId)}
                          className={`w-full text-left rounded-md px-3 py-2.5 transition-all duration-150 claude-focus-ring ${
                            isSelected
                              ? 'sidebar-active-card bg-claude-accent-light dark:bg-[#3d2a22] border-l-2 border-claude-accent'
                              : 'bg-claude-surface dark:bg-[#242220] border border-transparent hover:border-claude-border dark:hover:border-[#3d3832] hover:bg-claude-border-light dark:hover:bg-[#2b2926]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] font-mono font-medium text-claude-accent truncate">
                                  {evalItem.uniprotId}
                                </span>
                                {score > 0 && (
                                  <span
                                    className="text-[9px] font-mono font-bold px-1 py-0 rounded"
                                    style={{
                                      color: getScoreColor(score),
                                      backgroundColor: getScoreColor(score) + '15',
                                    }}
                                  >
                                    {score.toFixed(1)}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] font-medium text-claude-text truncate mt-0.5">
                                {evalItem.proteinName || evalItem.entryName || evalItem.uniprotId}
                              </p>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-[9px] text-claude-text-muted truncate">
                                  {truncateOrganism(evalItem.organism, 20)}
                                </span>
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-1 flex-shrink-0">
                              <div className="flex items-center gap-1.5">
                                <span className="inline-flex items-center gap-0.5 text-[9px] text-claude-cryoem">
                                  <Layers className="h-2.5 w-2.5" />
                                  {pdbCount}
                                </span>
                                <span className="inline-flex items-center gap-0.5 text-[9px] text-claude-nmr">
                                  <Target className="h-2.5 w-2.5" />
                                  {blastCount}
                                </span>
                              </div>
                            </div>
                          </div>
                        </button>
                      );

                      // Wrap with right-click context menu only when deletion is wired
                      if (!onDeleteEval) return evalButton;
                      return (
                        <ContextMenu key={evalItem.uniprotId}>
                          <ContextMenuTrigger asChild>{evalButton}</ContextMenuTrigger>
                          <ContextMenuContent>
                            <ContextMenuItem
                              onClick={() => onSelectEval(evalItem.uniprotId)}
                            >
                              <Dna className="h-3.5 w-3.5 mr-2" />
                              Open
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              onClick={() => onDeleteEval(evalItem.uniprotId)}
                              className="text-red-600 dark:text-red-400 focus:text-red-600 focus:dark:text-red-400"
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-2" />
                              Delete Evaluation
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Evaluation Batches Section */}
            <div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setBatchOpen(!batchOpen)}
                    className="flex items-center gap-1.5 w-full px-2 py-1.5 text-xs font-medium text-claude-text-secondary hover:text-claude-text transition-colors rounded-md hover:bg-claude-border-light dark:hover:bg-[#2b2926] active:scale-[0.98]"
                  >
                    {batchOpen ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    <Layers className="h-3 w-3" />
                    <span>{t.evalBatchesFull}</span>
                    <Badge
                      variant="secondary"
                      className="ml-auto h-4 px-1.5 text-[9px] bg-claude-border-light dark:bg-[#2b2926] text-claude-text-muted border-0"
                    >
                      {filteredBatches.length}
                    </Badge>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right"><p>{batchOpen ? (locale === 'zh' ? '收起' : 'Collapse') : (locale === 'zh' ? '展开' : 'Expand')} {locale === 'zh' ? '批量评估' : 'evaluation batches'}</p></TooltipContent>
              </Tooltip>

              {batchOpen && (
              <div>
                <div className="space-y-1 px-1 pt-1">
                  {filteredBatches.length === 0 ? (
                    <p className="text-[11px] text-claude-text-muted px-2 py-3 text-center">
                      {searchQuery ? (locale === 'zh' ? '未找到匹配的批次' : 'No matching batches') : (locale === 'zh' ? '暂无批量评估' : 'No evaluation batches')}
                    </p>
                  ) : (
                    filteredBatches.map((batch) => {
                      const isExpanded = expandedBatches.has(batch.batchId);
                      const subTargets = batchSubTargets[batch.batchId] || [];
                      const isBatchSelected = selectedBatchId === batch.batchId;

                      return (
                        <div key={batch.batchId}>
                          <button
                            onClick={() => toggleBatch(batch.batchId)}
                            className={`w-full text-left rounded-md px-3 py-2.5 transition-all duration-150 claude-focus-ring ${
                              isBatchSelected
                                ? 'sidebar-active-card bg-claude-accent-light dark:bg-[#3d2a22] border-l-2 border-claude-accent'
                                : 'bg-claude-surface dark:bg-[#242220] border border-transparent hover:border-claude-border dark:hover:border-[#3d3832] hover:bg-claude-border-light dark:hover:bg-[#2b2926]'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[11px] font-medium text-claude-text truncate">
                                    {batch.title || batch.batchId}
                                  </span>
                                </div>
                                <span className="text-[9px] font-mono text-claude-text-muted mt-0.5 block">
                                  {batch.batchId}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                <span className="inline-flex items-center gap-0.5 text-[9px] text-claude-cryoem">
                                  <Layers className="h-2.5 w-2.5" />
                                  {batch.subTargetCount}
                                </span>
                              </div>
                            </div>
                          </button>

                          {/* Sub-targets */}
                          {isExpanded && (
                          <div className="ml-3 pl-3 border-l-2 border-claude-border-light dark:border-[#2b2926] space-y-1 py-1">
                              {subTargets.map((st) => {
                                const isSelected = selectedUniprotId === st.uniprotId;
                                // Prefer gene name (shorter) for sidebar display; fall back to protein name.
                                const displayName = (st as any).geneName || (st as any).geneNames || st.proteinName || st.uniprotId;
                                return (
                                  <button
                                    key={st.uniprotId}
                                    onClick={() => {
                                      // Keep existing behavior (select the individual eval) but also
                                      // inform the parent that this is a batch-sub-target click so
                                      // it can keep the batch context active.
                                      onSelectEval(st.uniprotId);
                                      if (onSelectBatchSubTarget) {
                                        onSelectBatchSubTarget(batch.batchId, st.uniprotId);
                                      }
                                    }}
                                    className={`w-full text-left rounded-md px-2.5 py-1.5 transition-all duration-100 text-[11px] claude-focus-ring ${
                                      isSelected
                                        ? 'bg-claude-accent-light dark:bg-[#3d2a22] text-claude-accent font-medium border-l-2 border-claude-accent'
                                        : 'hover:bg-claude-border-light dark:hover:bg-[#2b2926] text-claude-text-secondary'
                                    }`}
                                  >
                                    <div className="flex items-center justify-between gap-1">
                                      <div className="min-w-0 flex-1 flex items-baseline gap-1">
                                        <span className="font-mono text-[10px] text-claude-accent/80 flex-shrink-0">
                                          {st.uniprotId}
                                        </span>
                                        <span className="truncate overflow-hidden text-ellipsis whitespace-nowrap min-w-0" title={st.proteinName}>{displayName}</span>
                                      </div>
                                      <div className="flex items-center gap-1.5 flex-shrink-0 ml-1">
                                        <span className="text-[9px] text-claude-cryoem">
                                          {st.pdbCount}P
                                        </span>
                                        <span className="text-[9px] text-claude-nmr">
                                          {st.blastCount}B
                                        </span>
                                        {st.bestScore > 0 && (
                                          <span
                                            className="text-[8px] font-mono font-bold"
                                            style={{ color: getScoreColor(st.bestScore) }}
                                          >
                                            {st.bestScore.toFixed(1)}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
