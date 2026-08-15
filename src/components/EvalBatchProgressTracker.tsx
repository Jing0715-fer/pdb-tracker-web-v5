'use client';

import React, { useMemo, useState } from 'react';
import { useTheme } from 'next-themes';
import { CheckCircle2, Circle, Loader2, ChevronRight } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Evaluation, EvalBatch, EvalBatchSubTarget } from '@/lib/pdb-types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Step {
  key: string;
  label: string;
  isComplete: (eval_: Evaluation) => boolean;
}

const STEPS: Step[] = [
  { key: 'created', label: 'Created', isComplete: () => true },
  { key: 'pdb', label: 'PDB', isComplete: (e) => (e.pdbStructures?.length ?? 0) > 0 },
  { key: 'blast', label: 'BLAST', isComplete: (e) => (e.blastResults?.length ?? 0) > 0 },
  { key: 'report', label: 'Report', isComplete: (e) => !!e.report },
];

// ─── Sub-target Progress Row ───────────────────────────────────────────────────

function SubTargetProgressRow({
  subTarget,
  evaluation,
  isDark,
  index,
}: {
  subTarget: EvalBatchSubTarget;
  evaluation?: Evaluation;
  isDark: boolean;
  index: number;
}) {
  const stepStates = useMemo(() => {
    if (!evaluation) return STEPS.map(() => false);
    return STEPS.map(step => step.isComplete(evaluation));
  }, [evaluation]);

  const completedCount = stepStates.filter(Boolean).length;
  const progressPct = (completedCount / STEPS.length) * 100;

  const getStepColor = (complete: boolean) =>
    complete
      ? 'bg-emerald-500 dark:bg-emerald-400'
      : 'bg-claude-border-light dark:bg-[#2b2926]';

  const progressColor =
    progressPct >= 75 ? '#16a34a' :
    progressPct >= 50 ? '#c9872e' :
    progressPct > 0 ? '#ea580c' : '#6b7280';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="batch-progress-row flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-claude-border/30 dark:border-[#3d3832]/30 hover:bg-claude-border-light/40 dark:hover:bg-[#2b2926]/40 transition-colors"
          style={{ animationDelay: `${index * 40}ms` }}
        >
          {/* Protein name */}
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-medium text-claude-text truncate">
              {subTarget.proteinName || subTarget.uniprotId}
            </div>
            <div className="text-[8px] font-mono text-claude-text-muted">
              {subTarget.uniprotId}
            </div>
          </div>

          {/* Step dots */}
          <div className="flex items-center gap-1">
            {stepStates.map((complete, i) => (
              <span
                key={i}
                className={`w-2 h-2 rounded-full transition-all duration-200 ${getStepColor(complete)}`}
              />
            ))}
          </div>

          {/* Progress bar */}
          <div className="w-16 h-1.5 bg-claude-border-light dark:bg-[#2b2926] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full batch-progress-fill"
              style={{
                width: `${progressPct}%`,
                backgroundColor: progressColor,
                transition: 'width 0.6s ease-out',
              }}
            />
          </div>

          {/* Percentage */}
          <span className="text-[9px] font-mono text-claude-text-muted w-7 text-right">
            {Math.round(progressPct)}%
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="left" className="bg-claude-surface dark:bg-[#242220] border border-claude-border dark:border-[#3d3832] shadow-lg max-w-[200px]">
        <div className="text-[11px] space-y-1.5">
          <div className="font-medium text-claude-text">
            {subTarget.proteinName || subTarget.uniprotId}
          </div>
          <div className="text-[10px] text-claude-text-secondary">
            {subTarget.organism || 'Unknown organism'}
          </div>
          <div className="space-y-1">
            {STEPS.map((step, i) => (
              <div key={step.key} className="flex items-center gap-1.5">
                {stepStates[i] ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                ) : (
                  <Circle className="h-3 w-3 text-claude-text-muted" />
                )}
                <span className={`text-[10px] ${stepStates[i] ? 'text-emerald-600 dark:text-emerald-400' : 'text-claude-text-muted'}`}>
                  {step.label}
                </span>
              </div>
            ))}
          </div>
          <div className="text-[9px] text-claude-text-muted pt-1 border-t border-claude-border/50 dark:border-[#3d3832]/50">
            PDB: {subTarget.pdbCount} · BLAST: {subTarget.blastCount} · Score: {subTarget.bestScore.toFixed(1)}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Batch Progress Card ──────────────────────────────────────────────────────

function BatchProgressCard({
  batch,
  subTargets,
  evaluations,
  isDark,
  isExpanded,
  onToggle,
  index,
}: {
  batch: EvalBatch;
  subTargets: EvalBatchSubTarget[];
  evaluations: Evaluation[];
  isDark: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  index: number;
}) {
  // Find evaluations belonging to this batch
  const batchEvals = useMemo(() => {
    return evaluations.filter(e => e.batchId === batch.batchId);
  }, [evaluations, batch.batchId]);

  // Compute overall batch progress
  const batchProgress = useMemo(() => {
    if (batchEvals.length === 0) return 0;
    let totalSteps = 0;
    let completedSteps = 0;
    batchEvals.forEach(e => {
      STEPS.forEach(step => {
        totalSteps++;
        if (step.isComplete(e)) completedSteps++;
      });
    });
    return totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;
  }, [batchEvals]);

  // Create a map from uniprotId to evaluation
  const evalMap = useMemo(() => {
    const map = new Map<string, Evaluation>();
    batchEvals.forEach(e => map.set(e.uniprotId, e));
    return map;
  }, [batchEvals]);

  const completedCount = batchEvals.filter(e =>
    STEPS.every(step => step.isComplete(e))
  ).length;

  const progressColor =
    batchProgress >= 75 ? '#16a34a' :
    batchProgress >= 50 ? '#c9872e' :
    batchProgress > 0 ? '#ea580c' : '#6b7280';

  return (
    <div
      className="batch-progress-card rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-claude-surface dark:bg-[#242220] overflow-hidden"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-claude-border-light/30 dark:hover:bg-[#2b2926]/30 transition-colors text-left"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 text-claude-text-muted transition-transform duration-200 flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
        />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold text-claude-text truncate">
            {batch.title || batch.batchId}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[9px] text-claude-text-muted">
              {subTargets.length} target{subTargets.length !== 1 ? 's' : ''}
            </span>
            <span className="text-[9px] text-claude-text-muted">
              {completedCount}/{batchEvals.length} complete
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-20 h-2 bg-claude-border-light dark:bg-[#2b2926] rounded-full overflow-hidden flex-shrink-0">
          <div
            className="h-full rounded-full"
            style={{
              width: `${batchProgress}%`,
              backgroundColor: progressColor,
              transition: 'width 0.6s ease-out',
            }}
          />
        </div>
        <span className="text-[10px] font-mono font-semibold w-8 text-right flex-shrink-0" style={{ color: progressColor }}>
          {Math.round(batchProgress)}%
        </span>
      </button>

      {/* Expanded sub-targets */}
      {isExpanded && (
        <div className="px-3 pb-2.5 space-y-1 batch-progress-expand">
          {subTargets.map((st, i) => (
            <SubTargetProgressRow
              key={st.uniprotId}
              subTarget={st}
              evaluation={evalMap.get(st.uniprotId)}
              isDark={isDark}
              index={i}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

interface EvalBatchProgressTrackerProps {
  evaluations: Evaluation[];
  batches?: EvalBatch[];
  batchSubTargets?: Record<string, EvalBatchSubTarget[]>;
}

export function EvalBatchProgressTracker({
  evaluations,
  batches = [],
  batchSubTargets = {},
}: EvalBatchProgressTrackerProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);

  if (batches.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <h4 className="text-[11px] font-semibold text-claude-text uppercase tracking-wider flex items-center gap-1.5">
        <Loader2 className="h-3 w-3 text-claude-accent" />
        Batch Progress Tracker
      </h4>
      <div className="space-y-2 max-h-80 overflow-y-auto custom-scrollbar">
        {batches.map((batch, idx) => (
          <BatchProgressCard
            key={batch.batchId}
            batch={batch}
            subTargets={batchSubTargets[batch.batchId] || []}
            evaluations={evaluations}
            isDark={isDark}
            isExpanded={expandedBatch === batch.batchId}
            onToggle={() => setExpandedBatch(expandedBatch === batch.batchId ? null : batch.batchId)}
            index={idx}
          />
        ))}
      </div>
    </div>
  );
}
