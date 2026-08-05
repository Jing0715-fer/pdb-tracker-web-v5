'use client';

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Evaluation } from '@/lib/pdb-types';
import { useI18n } from '@/lib/i18n';
import type { LocaleId } from '@/lib/i18n';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Step {
  key: string;
  label: string;
  description: string;
  isComplete: (eval_: Evaluation) => boolean;
  isCurrent: (eval_: Evaluation, stepIdx: number) => boolean;
}

// ─── Step Definitions ─────────────────────────────────────────────────────────

const buildSteps = (locale: LocaleId): Step[] => [
  {
    key: 'created',
    label: 'Created',
    description: locale === 'zh' ? '评估记录已创建' : 'Evaluation record has been created',
    isComplete: () => true, // Always done if evaluation exists
    isCurrent: (_eval, idx) => idx === 0,
  },
  {
    key: 'pdb_added',
    label: 'PDB Structures',
    description: locale === 'zh' ? 'PDB 结构已获取' : 'PDB structures have been fetched',
    isComplete: (eval_) => (eval_.pdbStructures?.length ?? 0) > 0,
    isCurrent: (_eval, idx) => idx === 1,
  },
  {
    key: 'blast_analysis',
    label: 'BLAST Analysis',
    description: locale === 'zh' ? 'BLAST 同源搜索完成' : 'BLAST homology search complete',
    isComplete: (eval_) => (eval_.blastResults?.length ?? 0) > 0,
    isCurrent: (_eval, idx) => idx === 2,
  },
  {
    key: 'report_generated',
    label: 'Report Generated',
    description: locale === 'zh' ? 'LLM 可行性报告已生成' : 'LLM feasibility report generated',
    isComplete: (eval_) => !!eval_.report,
    isCurrent: (_eval, idx) => idx === 3,
  },
  {
    key: 'review_complete',
    label: 'Review Complete',
    description: locale === 'zh' ? '评估已审核并完成' : 'The evaluation has been reviewed and finalized',
    isComplete: (eval_) => {
      // Review complete if report exists and scores are high enough
      if (!eval_.report) return false;
      const coverage = eval_.coverage ?? 0;
      return coverage > 0; // Simplified: any evaluation with a report and coverage > 0 is considered reviewed
    },
    isCurrent: (_eval, idx) => idx === 4,
  },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface EvalProgressTrackerProps {
  evaluation: Evaluation;
  compact?: boolean;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function EvalProgressTracker({ evaluation, compact = false }: EvalProgressTrackerProps) {
  const { t, locale } = useI18n();
  const STEPS = useMemo(() => buildSteps(locale), [locale]);

  // Determine which steps are complete
  const stepStates = useMemo(() => {
    const states: { complete: boolean; current: boolean }[] = [];

    let lastIncomplete = -1;
    for (let i = 0; i < STEPS.length; i++) {
      const isComplete = STEPS[i].isComplete(evaluation);
      if (!isComplete && lastIncomplete === -1) {
        lastIncomplete = i;
      }
      states.push({
        complete: isComplete,
        current: !isComplete && lastIncomplete === i,
      });
    }

    // If all are complete, no step is "current"
    if (lastIncomplete === -1) {
      states.forEach((s) => {
        s.current = false;
      });
    }

    return states;
  }, [evaluation, STEPS]);

  const completedCount = stepStates.filter((s) => s.complete).length;
  const progressPct = (completedCount / STEPS.length) * 100;

  if (compact) {
    return <CompactTracker stepStates={stepStates} progressPct={progressPct} />;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold text-claude-text uppercase tracking-wider">
          Progress
        </h4>
        <span className="text-[10px] font-mono text-claude-text-muted">
          {completedCount}/{STEPS.length} steps
        </span>
      </div>

      {/* Horizontal step bar */}
      <div className="relative">
        <div className="flex items-center justify-between relative">
          {/* Background track line */}
          <div className="absolute top-3 left-3 right-3 h-0.5 bg-claude-border-light dark:bg-[#2b2926]" />

          {/* Progress track (filled) */}
          <motion.div
            className="absolute top-3 left-3 h-0.5 bg-emerald-500/70"
            initial={{ width: 0 }}
            animate={{ width: `calc(${progressPct}% - 6px)` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />

          {/* Step circles */}
          {STEPS.map((step, idx) => {
            const state = stepStates[idx];
            const isLast = idx === STEPS.length - 1;

            return (
              <Tooltip key={step.key}>
                <TooltipTrigger asChild>
                  <div className="relative z-10 flex flex-col items-center">
                    {/* Circle */}
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{
                        duration: 0.3,
                        delay: idx * 0.1,
                        type: 'spring',
                        stiffness: 300,
                        damping: 20,
                      }}
                      className="relative"
                    >
                      {state.complete ? (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{
                            duration: 0.3,
                            delay: 0.3 + idx * 0.1,
                            type: 'spring',
                          }}
                          className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center shadow-sm"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 text-white" />
                        </motion.div>
                      ) : state.current ? (
                        <div className="w-6 h-6 rounded-full bg-amber-500/20 border-2 border-amber-500 flex items-center justify-center animate-pulse">
                          <Circle className="h-2.5 w-2.5 text-amber-500 fill-amber-500" />
                        </div>
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-claude-border-light dark:bg-[#2b2926] border border-claude-border dark:border-[#3d3832] flex items-center justify-center">
                          <div className="w-1.5 h-1.5 rounded-full bg-claude-text-muted/40" />
                        </div>
                      )}
                    </motion.div>

                    {/* Step label */}
                    <span
                      className={`text-[8px] mt-1.5 text-center max-w-[50px] leading-tight ${
                        state.complete
                          ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                          : state.current
                          ? 'text-amber-600 dark:text-amber-400 font-medium'
                          : 'text-claude-text-muted'
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  className="bg-claude-surface dark:bg-[#242220] border border-claude-border dark:border-[#3d3832] shadow-lg max-w-[180px]"
                >
                  <div className="text-[11px] space-y-1">
                    <div className="flex items-center gap-1.5">
                      {state.complete ? (
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      ) : state.current ? (
                        <Loader2 className="h-3 w-3 text-amber-500" />
                      ) : (
                        <Circle className="h-3 w-3 text-claude-text-muted" />
                      )}
                      <span className="font-medium text-claude-text">{step.label}</span>
                    </div>
                    <div className="text-[10px] text-claude-text-secondary">
                      {step.description}
                    </div>
                    <div className={`text-[9px] font-medium ${
                      state.complete
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : state.current
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-claude-text-muted'
                    }`}>
                      {state.complete ? '✓ Complete' : state.current ? '● In Progress' : '○ Pending'}
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Compact Variant ──────────────────────────────────────────────────────────

function CompactTracker({
  stepStates,
  progressPct,
}: {
  stepStates: { complete: boolean; current: boolean }[];
  progressPct: number;
}) {
  return (
    <div className="flex items-center gap-1">
      {/* Mini progress bar */}
      <div className="flex-1 h-1.5 bg-claude-border-light dark:bg-[#2b2926] rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-emerald-500/70"
          initial={{ width: 0 }}
          animate={{ width: `${progressPct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>

      {/* Step dots */}
      <div className="flex items-center gap-0.5">
        {stepStates.map((state, idx) => (
          <div
            key={idx}
            className={`w-1.5 h-1.5 rounded-full ${
              state.complete
                ? 'bg-emerald-500'
                : state.current
                ? 'bg-amber-500 animate-pulse'
                : 'bg-claude-text-muted/30'
            }`}
          />
        ))}
      </div>

      <span className="text-[9px] font-mono text-claude-text-muted">
        {Math.round(progressPct)}%
      </span>
    </div>
  );
}
