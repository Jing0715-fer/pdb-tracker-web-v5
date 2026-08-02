'use client';

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, Lightbulb } from 'lucide-react';
import { ScoreBar } from '@/components/quality-components';
import { AnimatedNumber } from '@/components/ui/pdb-animated';
import { getScoreColor } from '@/components/pdb-helpers';
import { EvalDomainCoverage } from '@/components/EvalDomainCoverage';
import { EvalScoreRadar } from '@/components/EvalScoreRadar';
import { EvalProgressTracker } from '@/components/EvalProgressTracker';
import type { Evaluation, EvalPdbStructure, EvalBlastResult } from '@/lib/pdb-types';
import { useI18n } from '@/lib/i18n';

interface EvalSummaryProps {
  evaluation: Evaluation;
  comparisonEvaluations?: Evaluation[];
}

interface ScoreEntry {
  score: number;
  max?: number;
  description?: string;
}

function parseScores(scoresStr: string | null): Record<string, ScoreEntry> {
  if (!scoresStr) return {};
  try {
    const parsed = JSON.parse(scoresStr);
    const result: Record<string, ScoreEntry> = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (typeof val === 'object' && val !== null && 'score' in (val as any)) {
        const v = val as Record<string, any>;
        // Accept both `max` and legacy `maxScore`; default 10 (1–10 scale).
        result[key] = {
          score: v.score,
          max: v.max ?? v.maxScore ?? 10,
          description: v.description,
        };
      } else if (typeof val === 'number') {
        result[key] = { score: val, max: 10 };
      }
    }
    return result;
  } catch {
    return {};
  }
}

function CoverageRing({ coverage, size = 64 }: { coverage: number | null; size?: number }) {
  const pct = coverage ?? 0;
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(1, pct / 100));
  const color = pct >= 80 ? '#16a34a' : pct >= 50 ? '#c9872e' : '#dc2626';

  return (
    <div className="relative flex items-center justify-center">
      <svg width={size} height={size} className="transform -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={4}
          className="text-claude-border dark:text-[#3d3832]"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - progress) }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-bold">
          <AnimatedNumber value={pct} decimals={0} suffix="%" />
        </span>
      </div>
    </div>
  );
}

function generateRecommendations(
  evaluation: Evaluation,
  scores: Record<string, ScoreEntry>,
  locale: 'en' | 'zh' = 'en'
): { type: 'success' | 'warning' | 'info'; text: string }[] {
  const recs: { type: 'success' | 'warning' | 'info'; text: string }[] = [];
  const coverage = evaluation.coverage ?? 0;
  const zh = locale === 'zh';

  if (coverage >= 80) {
    recs.push({ type: 'success', text: zh ? '结构覆盖度优秀 — 序列绝大部分已有结构。' : 'Excellent structural coverage — most of the sequence is represented.' });
  } else if (coverage >= 50) {
    recs.push({ type: 'warning', text: zh ? '覆盖度中等 — 建议寻找更多结构填补空缺。' : 'Moderate coverage — consider looking for additional structures to fill gaps.' });
  } else {
    recs.push({ type: 'warning', text: zh ? '结构覆盖度较低 — 蛋白质大部分区域缺少结构数据。' : 'Low structural coverage — significant portions of the protein lack structural data.' });
  }

  const overallScore = scores['Overall']?.score ?? 0;
  if (overallScore >= 8) {
    recs.push({ type: 'success', text: zh ? '总体质量评分较高 — 现有结构通常较为适用。' : 'High overall quality score — available structures are generally well-suited.' });
  } else if (overallScore < 5) {
    recs.push({ type: 'warning', text: zh ? '质量评分较低 — 结构可能分辨率或相关性不足。' : 'Low quality score — structures may have limited resolution or relevance.' });
  }

  const blastCount = evaluation.blastResults?.length ?? 0;
  if (blastCount > 0) {
    recs.push({ type: 'info', text: zh ? `通过 BLAST 找到 ${blastCount} 个同源序列 — 可用于比较建模。` : `${blastCount} homolog${blastCount > 1 ? 's' : ''} found via BLAST — useful for comparative modeling.` });
  }

  const pdbCount = evaluation.pdbStructures?.length ?? 0;
  if (pdbCount === 0 && blastCount > 0) {
    recs.push({ type: 'info', text: zh ? '无直接结构 — 同源序列可通过建模提供结构信息。' : 'No direct structures — homologs can provide structural insights via modeling.' });
  }

  if (recs.length === 0) {
    recs.push({ type: 'info', text: zh ? '选择结构与同源序列以进行详细分析。' : 'Select structures and homologs for detailed analysis.' });
  }

  return recs;
}

export function EvalSummary({ evaluation, comparisonEvaluations }: EvalSummaryProps) {
  const { locale } = useI18n();
  const scores = useMemo(() => parseScores(evaluation.scores), [evaluation.scores]);

  const scoreEntries = useMemo(() => {
    return Object.entries(scores).filter(([key]) => key !== 'Overall');
  }, [scores]);

  const overallScore = scores['Overall']?.score ?? 0;

  const recommendations = useMemo(
    () => generateRecommendations(evaluation, scores, locale),
    [evaluation, scores, locale]
  );

  // Check if we have enough score dimensions for radar
  const hasRadarData = scoreEntries.length >= 3;

  return (
    <div className="space-y-5 p-1">
      {/* Progress Tracker */}
      <EvalProgressTracker evaluation={evaluation} compact={false} />

      {/* Coverage + Overall Score */}
      <div className="flex items-center gap-4">
        <div className="text-center">
          <CoverageRing coverage={evaluation.coverage} size={72} />
          <p className="text-[9px] text-claude-text-muted mt-1">{locale === 'zh' ? '覆盖度' : 'Coverage'}</p>
        </div>
        <div className="flex-1 space-y-2">
          <ScoreBar label={locale === 'zh' ? '总体评分' : 'Overall Score'} score={overallScore} maxScore={10} />
          {evaluation.sequenceLength && (
            <div className="text-[10px] text-claude-text-muted">
              {locale === 'zh' ? '序列长度：' : 'Sequence length: '}<span className="font-mono">{evaluation.sequenceLength}</span> {locale === 'zh' ? '残基' : 'residues'}
            </div>
          )}
        </div>
      </div>

      {/* Score Breakdown */}
      {scoreEntries.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-[11px] font-semibold text-claude-text uppercase tracking-wider">
            {locale === 'zh' ? '评分明细' : 'Score Breakdown'}
          </h4>
          <div className="space-y-1.5">
            {scoreEntries.map(([key, val]) => (
              <ScoreBar key={key} label={key} score={val.score} maxScore={val.max ?? 10} />
            ))}
          </div>
        </div>
      )}

      {/* Enhanced Score Radar (SVG) */}
      {hasRadarData && (
        <EvalScoreRadar
          evaluation={evaluation}
          comparisonEvaluations={comparisonEvaluations}
          size={220}
        />
      )}

      {/* Domain Coverage Visualization */}
      <EvalDomainCoverage evaluation={evaluation} />

      {/* Recommendations */}
      <div className="space-y-2">
        <h4 className="text-[11px] font-semibold text-claude-text uppercase tracking-wider flex items-center gap-1.5">
          <Lightbulb className="h-3 w-3 text-claude-accent" />
          {locale === 'zh' ? '建议' : 'Recommendations'}
        </h4>
        <div className="space-y-1.5">
          {recommendations.map((rec, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, x: -5 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
              className={`flex items-start gap-2 text-[11px] rounded-md px-2.5 py-2 ${
                rec.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-900/10 text-emerald-700 dark:text-emerald-400'
                  : rec.type === 'warning'
                  ? 'bg-amber-50 dark:bg-amber-900/10 text-amber-700 dark:text-amber-400'
                  : 'bg-sky-50 dark:bg-sky-900/10 text-sky-700 dark:text-sky-400'
              }`}
            >
              {rec.type === 'success' ? (
                <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              ) : rec.type === 'warning' ? (
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              ) : (
                <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              )}
              <span>{rec.text}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
