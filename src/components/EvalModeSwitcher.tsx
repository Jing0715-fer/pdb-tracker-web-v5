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
  Box,
  Microscope,
  Info,
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
                className="slide-in-left relative overflow-hidden p-3 pl-5 rounded-[10px] border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] space-y-2"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                {/* Left accent bar skeleton */}
                <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-[10px] bg-claude-border-light dark:bg-[#3d3832]" />
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <div className="h-3 w-16 rounded shimmer-skeleton" />
                    <div className="h-2.5 w-10 rounded shimmer-skeleton" />
                  </div>
                  <div className="h-4 w-8 rounded shimmer-skeleton" />
                </div>
                <div className="h-2.5 w-[80%] rounded shimmer-skeleton" />
                {/* Badges skeleton */}
                <div className="flex gap-1.5">
                  <div className="h-3.5 w-12 rounded shimmer-skeleton" />
                  <div className="h-3.5 w-10 rounded shimmer-skeleton" />
                  <div className="h-3.5 w-14 rounded shimmer-skeleton" />
                </div>
              </div>
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
                          style={{
                            ['--eval-score-color' as any]: getScoreColor(score),
                          }}
                          className={`slide-in-left w-full text-left p-3 pl-5 rounded-[10px] border transition-all duration-200 claude-hover btn-press btn-press-enhanced active:scale-[0.97] sidebar-week-item sidebar-item-press card-hover-scale relative overflow-hidden claude-focus-ring outline-none focus-visible:outline-none focus-visible:ring-0 ${
                            isSelected
                              ? 'week-card week-card-active bg-claude-accent-light dark:bg-[#3d2a22] border-claude-accent/30 shadow-sm sidebar-active-card sidebar-week-active animate-border-breathe breathe-glow-active'
                              : 'week-card bg-claude-surface dark:bg-[#242220] border-claude-border dark:border-[#3d3832] hover:border-claude-border-light dark:hover:border-[#4a4540] claude-card-shadow'
                          }`}
                        >
                          {/* Druggability-score vertical accent bar (left edge) */}
                          <div
                            className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-[10px] overflow-hidden"
                            style={{ opacity: isSelected ? 1 : 0.78 }}
                          >
                            <div className="h-full w-full" style={{ backgroundColor: getScoreColor(score) }} />
                          </div>
                          {/* Header: UniProt ID + gene chip + score badge */}
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className="hover-underline font-mono text-xs font-semibold text-claude-text dark:text-[#e8e4dd] truncate"
                                title={evalItem.uniprotId}
                              >
                                {evalItem.uniprotId}
                              </span>
                              {evalItem.geneNames && (
                                <span
                                  className="text-[9px] text-claude-text-muted dark:text-[#9b9590] px-1 py-0.5 rounded bg-claude-border-light/60 dark:bg-[#3d3832]/60 font-mono truncate max-w-[90px]"
                                  title={evalItem.geneNames}
                                >
                                  {evalItem.geneNames}
                                </span>
                              )}
                            </div>
                            {score > 0 ? (
                              <span
                                className="flex-shrink-0 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded text-white shadow-sm"
                                style={{ backgroundColor: getScoreColor(score) }}
                                title={locale === 'zh' ? `可成药性评分: ${score.toFixed(1)} / 10` : `Druggability score: ${score.toFixed(1)} / 10`}
                              >
                                {score.toFixed(1)}
                              </span>
                            ) : (
                              <span
                                className="flex-shrink-0 text-[9px] font-medium px-1.5 py-0.5 rounded text-claude-text-muted bg-claude-border-light/60 dark:bg-[#3d3832]/60"
                                title={locale === 'zh' ? '尚无评分' : 'No score yet'}
                              >
                                —
                              </span>
                            )}
                          </div>
                          {/* Protein name */}
                          <div className="text-[11px] text-claude-text-secondary dark:text-[#9b9590] line-clamp-1 leading-tight mb-1.5">
                            {evalItem.proteinName || evalItem.entryName || evalItem.uniprotId}
                          </div>
                          {/* Organism + footer badges */}
                          <div className="flex items-center justify-between gap-1.5 flex-wrap">
                            {evalItem.organism && (
                              <span className="text-[9px] text-claude-text-muted dark:text-[#6b6560] truncate max-w-[50%]" title={evalItem.organism}>
                                {truncateOrganism(evalItem.organism, 22)}
                              </span>
                            )}
                            <div className="flex items-center gap-1 flex-wrap ml-auto">
                              {pdbCount > 0 && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-claude-xray-bg text-claude-xray" title={locale === 'zh' ? 'PDB 结构数' : 'PDB structures'}>
                                  <Box className="h-2.5 w-2.5" />
                                  {pdbCount} PDB
                                </span>
                              )}
                              {blastCount > 0 && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-claude-nmr-bg text-claude-nmr" title={locale === 'zh' ? 'BLAST 同源数' : 'BLAST homologs'}>
                                  <Microscope className="h-2.5 w-2.5" />
                                  {blastCount} BLAST
                                </span>
                              )}
                              {pdbCount === 0 && blastCount === 0 && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-claude-border-light/60 dark:bg-[#3d3832]/60 text-claude-text-muted" title={locale === 'zh' ? '暂无结构数据' : 'No structure data yet'}>
                                  <Info className="h-2.5 w-2.5" />
                                  {locale === 'zh' ? '无数据' : 'No data'}
                                </span>
                              )}
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
                            className={`slide-in-left w-full text-left p-3 pl-5 rounded-[10px] border transition-all duration-200 claude-hover btn-press btn-press-enhanced active:scale-[0.97] sidebar-week-item sidebar-item-press card-hover-scale relative overflow-hidden claude-focus-ring ${
                              isBatchSelected
                                ? 'week-card week-card-active bg-claude-accent-light dark:bg-[#3d2a22] border-claude-accent/30 shadow-sm sidebar-active-card sidebar-week-active animate-border-breathe breathe-glow-active'
                                : 'week-card bg-claude-surface dark:bg-[#242220] border-claude-border dark:border-[#3d3832] hover:border-claude-border-light dark:hover:border-[#4a4540] claude-card-shadow'
                            }`}
                          >
                            {/* Left accent bar - violet for batches */}
                            <div
                              className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-[10px] overflow-hidden"
                              style={{ opacity: isBatchSelected ? 1 : 0.78, backgroundColor: '#7c5cbf' }}
                            />
                            {/* Header: title + sub-target count badge */}
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <Layers className="h-3 w-3 text-violet-600 dark:text-violet-300 flex-shrink-0" />
                                <span
                                  className="hover-underline text-xs font-semibold text-claude-text dark:text-[#e8e4dd] truncate"
                                  title={batch.title || batch.batchId}
                                >
                                  {batch.title || batch.batchId}
                                </span>
                              </div>
                              <span
                                className="flex-shrink-0 inline-flex items-center gap-0.5 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded text-white shadow-sm"
                                style={{ background: 'linear-gradient(135deg, #7c5cbf, #5a3d99)' }}
                                title={locale === 'zh' ? `${batch.subTargetCount} 个子靶点` : `${batch.subTargetCount} sub-targets`}
                              >
                                {batch.subTargetCount}
                              </span>
                            </div>
                            {/* Batch ID (mono) */}
                            <div className="text-[10px] text-claude-text-muted dark:text-[#6b6560] font-mono line-clamp-1 mb-1.5" title={batch.batchId}>
                              {batch.batchId}
                            </div>
                            {/* Footer badge: sub-target count + expanded state */}
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 border border-violet-200/50 dark:border-violet-800/30" title={locale === 'zh' ? '子靶点数' : 'Sub-targets'}>
                                <Dna className="h-2.5 w-2.5" />
                                {batch.subTargetCount} {locale === 'zh' ? '靶点' : 'targets'}
                              </span>
                              {isExpanded && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-claude-accent/10 text-claude-accent border border-claude-accent/20" title={locale === 'zh' ? '已展开' : 'Expanded'}>
                                  <ChevronDown className="h-2.5 w-2.5" />
                                  {locale === 'zh' ? '已展开' : 'Open'}
                                </span>
                              )}
                            </div>
                          </button>

                          {/* Sub-targets */}
                          {isExpanded && (
                          <div className="ml-3 pl-3 border-l-2 border-claude-border-light dark:border-[#2b2926] space-y-1 py-1">
                              {subTargets.map((st) => {
                                const isSelected = selectedUniprotId === st.uniprotId;
                                // Prefer gene name (shorter) for sidebar display; fall back to protein name.
                                const displayName = (st as any).geneName || (st as any).geneNames || st.proteinName || st.uniprotId;
                                const subScore = st.bestScore || 0;
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
                                    style={{
                                      ['--eval-score-color' as any]: getScoreColor(subScore),
                                    }}
                                    className={`slide-in-left w-full text-left p-2 pl-3 rounded-[8px] border transition-all duration-150 claude-hover btn-press active:scale-[0.97] sidebar-week-item sidebar-item-press card-hover-scale relative overflow-hidden claude-focus-ring ${
                                      isSelected
                                        ? 'week-card week-card-active bg-claude-accent-light dark:bg-[#3d2a22] border-claude-accent/30 shadow-sm sidebar-active-card sidebar-week-active animate-border-breathe breathe-glow-active'
                                        : 'week-card bg-claude-surface dark:bg-[#242220] border-claude-border/60 dark:border-[#3d3832]/60 hover:border-claude-border-light dark:hover:border-[#4a4540]'
                                    }`}
                                  >
                                    {/* Left accent bar (score-based) */}
                                    <div
                                      className="absolute left-0 top-0 bottom-0 w-[2px] rounded-l-[8px] overflow-hidden"
                                      style={{ opacity: isSelected ? 1 : 0.7, backgroundColor: getScoreColor(subScore) }}
                                    />
                                    {/* Header row: uniprotId + score badge */}
                                    <div className="flex items-center justify-between gap-1 mb-0.5">
                                      <span
                                        className="hover-underline font-mono text-[10px] font-semibold text-claude-text dark:text-[#e8e4dd] truncate"
                                        title={st.uniprotId}
                                      >
                                        {st.uniprotId}
                                      </span>
                                      {subScore > 0 ? (
                                        <span
                                          className="flex-shrink-0 text-[9px] font-mono font-bold px-1 py-0 rounded text-white shadow-sm"
                                          style={{ backgroundColor: getScoreColor(subScore) }}
                                          title={locale === 'zh' ? `评分: ${subScore.toFixed(1)} / 10` : `Score: ${subScore.toFixed(1)} / 10`}
                                        >
                                          {subScore.toFixed(1)}
                                        </span>
                                      ) : null}
                                    </div>
                                    {/* Display name (gene or protein) */}
                                    <div className="text-[10px] text-claude-text-secondary dark:text-[#9b9590] line-clamp-1 leading-tight mb-1" title={st.proteinName}>
                                      {displayName}
                                    </div>
                                    {/* Footer badges: PDB / BLAST / No data */}
                                    <div className="flex items-center gap-1 flex-wrap">
                                      {st.pdbCount > 0 && (
                                        <span className="inline-flex items-center gap-0.5 px-1 py-0 rounded text-[8px] font-medium bg-claude-xray-bg text-claude-xray" title={locale === 'zh' ? 'PDB 结构数' : 'PDB structures'}>
                                          <Box className="h-2 w-2" />
                                          {st.pdbCount} PDB
                                        </span>
                                      )}
                                      {st.blastCount > 0 && (
                                        <span className="inline-flex items-center gap-0.5 px-1 py-0 rounded text-[8px] font-medium bg-claude-nmr-bg text-claude-nmr" title={locale === 'zh' ? 'BLAST 同源数' : 'BLAST homologs'}>
                                          <Microscope className="h-2 w-2" />
                                          {st.blastCount} BLAST
                                        </span>
                                      )}
                                      {st.pdbCount === 0 && st.blastCount === 0 && (
                                        <span className="inline-flex items-center gap-0.5 px-1 py-0 rounded text-[8px] font-medium bg-claude-border-light/60 dark:bg-[#3d3832]/60 text-claude-text-muted">
                                          <Info className="h-2 w-2" />
                                          {locale === 'zh' ? '无数据' : 'No data'}
                                        </span>
                                      )}
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
