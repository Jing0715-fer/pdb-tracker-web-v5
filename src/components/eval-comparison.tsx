'use client';
import { useI18n } from '@/lib/i18n';

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from 'next-themes';
import { Star, ArrowRightLeft, ChevronDown } from 'lucide-react';
import { ScoreBar } from '@/components/quality-components';
import { AnimatedNumber } from '@/components/ui/pdb-animated';
import { getScoreColor } from '@/components/pdb-helpers';
import { ChartExportButton } from '@/components/chart-export-button';
import type { Evaluation } from '@/lib/pdb-types';

// ─── Score Parsing ──────────────────────────────────────────────────────────────

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
      if (typeof val === 'object' && val !== null && 'score' in (val as Record<string, unknown>)) {
        result[key] = val as ScoreEntry;
      } else if (typeof val === 'number') {
        result[key] = { score: val };
      }
    }
    return result;
  } catch {
    return {};
  }
}

// ─── Comparison Ring ────────────────────────────────────────────────────────────

function ComparisonRing({ coverage, size = 80, label }: { coverage: number | null; size?: number; label: string }) {
  const pct = coverage ?? 0;
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(1, pct / 100));
  const color = pct >= 80 ? '#16a34a' : pct >= 50 ? '#2d8f8f' : pct >= 30 ? '#c9872e' : '#dc2626';

  return (
    <div className="flex flex-col items-center">
      <div className="relative flex items-center justify-center">
        <svg width={size} height={size} className="transform -rotate-90">
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke="currentColor" strokeWidth={5}
            className="text-claude-border dark:text-[#3d3832]"
          />
          <motion.circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke={color} strokeWidth={5} strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: circumference * (1 - progress) }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <AnimatedNumber value={pct} decimals={0} suffix="%" />
        </div>
      </div>
      <p className="text-[10px] text-claude-text-muted mt-1 font-medium uppercase tracking-wider">{label}</p>
    </div>
  );
}

// ─── Comparison Score Bar ────────────────────────────────────────────────────────

function ComparisonScoreBar({
  label,
  leftScore,
  rightScore,
  maxScore = 10,
}: {
  label: string;
  leftScore: number;
  rightScore: number;
  maxScore?: number;
}) {
  const leftBetter = leftScore > rightScore;
  const rightBetter = rightScore > leftScore;
  const equal = leftScore === rightScore;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          <span className="font-mono font-semibold" style={{
            color: leftBetter ? '#2d8f8f' : equal ? undefined : '#9b9590',
          }}>
            {leftScore.toFixed(1)}
          </span>
          {leftBetter && <Star className="h-3 w-3 text-teal-500 fill-teal-500" />}
        </div>
        <span className="text-claude-text-secondary text-[11px] font-medium">{label}</span>
        <div className="flex items-center gap-1.5">
          {rightBetter && <Star className="h-3 w-3 text-teal-500 fill-teal-500" />}
          <span className="font-mono font-semibold" style={{
            color: rightBetter ? '#2d8f8f' : equal ? undefined : '#9b9590',
          }}>
            {rightScore.toFixed(1)}
          </span>
        </div>
      </div>
      <div className="flex gap-1">
        {/* Left bar (right-aligned) */}
        <div className="flex-1 flex justify-end">
          <div className="h-2 bg-claude-border-light dark:bg-[#2b2926] rounded-l-full overflow-hidden flex justify-end w-full">
            <motion.div
              className="h-full rounded-l-full"
              initial={{ width: 0 }}
              animate={{ width: `${Math.min((leftScore / maxScore) * 100, 100)}%` }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
              style={{ backgroundColor: leftBetter ? '#2d8f8f' : equal ? '#c96442' : '#9b9590' }}
            />
          </div>
        </div>
        {/* Right bar (left-aligned) */}
        <div className="flex-1">
          <div className="h-2 bg-claude-border-light dark:bg-[#2b2926] rounded-r-full overflow-hidden w-full">
            <motion.div
              className="h-full rounded-r-full"
              initial={{ width: 0 }}
              animate={{ width: `${Math.min((rightScore / maxScore) * 100, 100)}%` }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
              style={{ backgroundColor: rightBetter ? '#2d8f8f' : equal ? '#c96442' : '#9b9590' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Comparison Metric Row ─────────────────────────────────────────────────────

function ComparisonMetricRow({
  label,
  leftValue,
  rightValue,
  formatFn,
}: {
  label: string;
  leftValue: number;
  rightValue: number;
  formatFn?: (v: number) => string;
}) {
  const fmt = formatFn || ((v: number) => v.toString());
  const leftBetter = leftValue > rightValue;
  const rightBetter = rightValue > leftValue;
  const equal = leftValue === rightValue;

  return (
    <div className="flex items-center justify-between py-2 border-b border-claude-border/40 dark:border-[#3d3832]/40 last:border-0">
      <div className="flex items-center gap-1.5 w-24 justify-end">
        <span className={`text-sm font-mono font-semibold ${
          leftBetter ? 'text-teal-600 dark:text-teal-400' : equal ? 'text-claude-text' : 'text-claude-text-muted'
        }`}>
          {fmt(leftValue)}
        </span>
        {leftBetter && <Star className="h-3 w-3 text-teal-500 fill-teal-500 flex-shrink-0" />}
      </div>
      <span className="text-[11px] text-claude-text-secondary font-medium px-3 flex-1 text-center">{label}</span>
      <div className="flex items-center gap-1.5 w-24">
        {rightBetter && <Star className="h-3 w-3 text-teal-500 fill-teal-500 flex-shrink-0" />}
        <span className={`text-sm font-mono font-semibold ${
          rightBetter ? 'text-teal-600 dark:text-teal-400' : equal ? 'text-claude-text' : 'text-claude-text-muted'
        }`}>
          {fmt(rightValue)}
        </span>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

interface EvalComparisonProps {
  evaluations: Evaluation[];
}

export function EvalComparison({ evaluations }: EvalComparisonProps) {
  const { theme } = useTheme();
  const { locale } = useI18n();
  const isDark = theme === 'dark';

  const [leftId, setLeftId] = useState<string>(evaluations[0]?.uniprotId || '');
  const [rightId, setRightId] = useState<string>(evaluations.length > 1 ? evaluations[1]?.uniprotId || '' : '');

  const leftEval = useMemo(() => evaluations.find(e => e.uniprotId === leftId) || null, [evaluations, leftId]);
  const rightEval = useMemo(() => evaluations.find(e => e.uniprotId === rightId) || null, [evaluations, rightId]);

  const leftScores = useMemo(() => parseScores(leftEval?.scores ?? null), [leftEval]);
  const rightScores = useMemo(() => parseScores(rightEval?.scores ?? null), [rightEval]);

  const allScoreKeys = useMemo(() => {
    const keys = new Set([...Object.keys(leftScores), ...Object.keys(rightScores)]);
    keys.delete('Overall');
    return Array.from(keys);
  }, [leftScores, rightScores]);

  // Compute method distribution for each eval
  const getMethodDist = (eval_: Evaluation | null) => {
    if (!eval_) return { cryoem: 0, xray: 0, nmr: 0, other: 0 };
    let cryoem = 0, xray = 0, nmr = 0, other = 0;
    [...eval_.pdbStructures, ...eval_.blastResults].forEach(s => {
      const m = (s.method || '').toUpperCase();
      if (m.includes('CRYO')) cryoem++;
      else if (m.includes('X-RAY') || m.includes('XRAY')) xray++;
      else if (m.includes('NMR')) nmr++;
      else other++;
    });
    return { cryoem, xray, nmr, other };
  };

  const leftMethods = useMemo(() => getMethodDist(leftEval), [leftEval]);
  const rightMethods = useMemo(() => getMethodDist(rightEval), [rightEval]);

  // Average resolution
  const getAvgRes = (eval_: Evaluation | null) => {
    if (!eval_) return 0;
    const resolutions = eval_.pdbStructures
      .map(s => s.resolution)
      .filter((r): r is number => r != null);
    return resolutions.length > 0 ? resolutions.reduce((a, b) => a + b, 0) / resolutions.length : 0;
  };

  // Get unique organisms
  const getOrganisms = (eval_: Evaluation | null) => {
    if (!eval_) return [];
    const orgs = new Set<string>();
    eval_.pdbStructures.forEach(s => { if (s.organism) orgs.add(s.organism); });
    if (eval_.organism) orgs.add(eval_.organism);
    return Array.from(orgs);
  };

  const selectClass = `w-full h-8 px-2.5 text-xs font-medium rounded-md border border-claude-border dark:border-[#3d3832] bg-white dark:bg-[#1a1917] text-claude-text focus:outline-none focus:ring-2 focus:ring-claude-accent/30`;

  if (evaluations.length < 2) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center h-full min-h-[300px] px-4"
      >
        <ArrowRightLeft className="h-12 w-12 text-claude-text-muted mb-3" />
        <h3 className="text-base font-semibold text-claude-text mb-1">Need More Evaluations</h3>
        <p className="text-sm text-claude-text-secondary text-center">
          At least 2 evaluations are needed for comparison. Currently have {evaluations.length}.
        </p>
      </motion.div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto custom-scrollbar">
      {/* Header */}
      <div className="px-4 py-3 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
        <div className="flex items-center gap-2 mb-3">
          <ArrowRightLeft className="h-4 w-4 text-claude-accent" />
          <h2 className="text-sm font-bold text-claude-text">Evaluation Comparison</h2>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider mb-1 block">Evaluation A</label>
            <select
              value={leftId}
              onChange={(e) => setLeftId(e.target.value)}
              className={selectClass}
            >
              {evaluations.map(ev => (
                <option key={ev.uniprotId} value={ev.uniprotId}>
                  {ev.proteinName || ev.uniprotId} ({ev.uniprotId})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider mb-1 block">Evaluation B</label>
            <select
              value={rightId}
              onChange={(e) => setRightId(e.target.value)}
              className={selectClass}
            >
              {evaluations.map(ev => (
                <option key={ev.uniprotId} value={ev.uniprotId}>
                  {ev.proteinName || ev.uniprotId} ({ev.uniprotId})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Comparison Content */}
      <div className="flex-1 p-4 space-y-6">
        {/* Coverage Rings */}
        <div className="flex items-center justify-center gap-8">
          <ComparisonRing
            coverage={leftEval?.coverage ?? 0}
            size={90}
            label={leftEval?.proteinName || leftEval?.uniprotId || 'A'}
          />
          <div className="flex flex-col items-center gap-1">
            <span className="text-[10px] font-bold text-claude-accent uppercase tracking-wider">VS</span>
            <div className="w-px h-6 bg-claude-border dark:bg-[#3d3832]" />
          </div>
          <ComparisonRing
            coverage={rightEval?.coverage ?? 0}
            size={90}
            label={rightEval?.proteinName || rightEval?.uniprotId || 'B'}
          />
        </div>

        {/* Score Comparison Bars */}
        {allScoreKeys.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-[11px] font-semibold text-claude-text uppercase tracking-wider flex items-center gap-1.5">
                Score Comparison
                <span className="text-[9px] font-normal text-claude-text-muted">(★ = better)</span>
              </h4>
              <ChartExportButton chartName="eval-score-comparison" />
            </div>
            <div className="space-y-3">
              {allScoreKeys.map(key => (
                <ComparisonScoreBar
                  key={key}
                  label={key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  leftScore={leftScores[key]?.score ?? 0}
                  rightScore={rightScores[key]?.score ?? 0}
                  maxScore={leftScores[key]?.max ?? rightScores[key]?.max ?? 10}
                />
              ))}
            </div>
          </div>
        )}

        {/* Overall Score Comparison */}
        {(leftScores['Overall'] || rightScores['Overall']) && (
          <ComparisonScoreBar
            label={locale === "zh" ? "总体" : "Overall"}
            leftScore={leftScores['Overall']?.score ?? 0}
            rightScore={rightScores['Overall']?.score ?? 0}
            maxScore={leftScores['Overall']?.max ?? rightScores['Overall']?.max ?? 10}
          />
        )}

        {/* Key Metrics Table */}
        <div className="space-y-2">
          <h4 className="text-[11px] font-semibold text-claude-text uppercase tracking-wider">Key Metrics</h4>
          <div className="bg-claude-border-light/30 dark:bg-[#1a1917]/30 rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 overflow-hidden">
            <ComparisonMetricRow
              label="PDB Structures"
              leftValue={leftEval?.pdbStructures.length ?? 0}
              rightValue={rightEval?.pdbStructures.length ?? 0}
            />
            <ComparisonMetricRow
              label="BLAST Results"
              leftValue={leftEval?.blastResults.length ?? 0}
              rightValue={rightEval?.blastResults.length ?? 0}
            />
            <ComparisonMetricRow
              label={locale === "zh" ? "覆盖率 %" : "Coverage %"}
              leftValue={leftEval?.coverage ?? 0}
              rightValue={rightEval?.coverage ?? 0}
              formatFn={(v) => `${v.toFixed(0)}%`}
            />
            <ComparisonMetricRow
              label={locale === "zh" ? "平均分辨率" : "Avg Resolution"}
              leftValue={getAvgRes(leftEval)}
              rightValue={getAvgRes(rightEval)}
              formatFn={(v) => v > 0 ? `${v.toFixed(2)}Å` : '—'}
            />
            <ComparisonMetricRow
              label={locale === "zh" ? "Cryo-EM 数量" : "Cryo-EM Count"}
              leftValue={leftMethods.cryoem}
              rightValue={rightMethods.cryoem}
            />
            <ComparisonMetricRow
              label="X-ray Count"
              leftValue={leftMethods.xray}
              rightValue={rightMethods.xray}
            />
            <ComparisonMetricRow
              label="NMR Count"
              leftValue={leftMethods.nmr}
              rightValue={rightMethods.nmr}
            />
            <ComparisonMetricRow
              label={locale === "zh" ? "序列长度" : "Sequence Length"}
              leftValue={leftEval?.sequenceLength ?? 0}
              rightValue={rightEval?.sequenceLength ?? 0}
              formatFn={(v) => v > 0 ? `${v} aa` : '—'}
            />
          </div>
        </div>

        {/* Organisms */}
        <div className="space-y-2">
          <h4 className="text-[11px] font-semibold text-claude-text uppercase tracking-wider">Organisms</h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-claude-border-light/30 dark:bg-[#1a1917]/30 border border-claude-border/50 dark:border-[#3d3832]/50">
              <div className="text-[10px] text-claude-text-muted mb-1.5 font-medium uppercase tracking-wider">A — {leftEval?.uniprotId}</div>
              {getOrganisms(leftEval).length > 0 ? (
                <div className="space-y-0.5">
                  {getOrganisms(leftEval).map((org, i) => (
                    <div key={i} className="text-[11px] text-claude-text-secondary">{org}</div>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-claude-text-muted">—</div>
              )}
            </div>
            <div className="p-3 rounded-lg bg-claude-border-light/30 dark:bg-[#1a1917]/30 border border-claude-border/50 dark:border-[#3d3832]/50">
              <div className="text-[10px] text-claude-text-muted mb-1.5 font-medium uppercase tracking-wider">B — {rightEval?.uniprotId}</div>
              {getOrganisms(rightEval).length > 0 ? (
                <div className="space-y-0.5">
                  {getOrganisms(rightEval).map((org, i) => (
                    <div key={i} className="text-[11px] text-claude-text-secondary">{org}</div>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-claude-text-muted">—</div>
              )}
            </div>
          </div>
        </div>

        {/* Method Distribution */}
        <div className="space-y-2">
          <h4 className="text-[11px] font-semibold text-claude-text uppercase tracking-wider">Method Distribution</h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2 p-3 rounded-lg bg-claude-border-light/30 dark:bg-[#1a1917]/30 border border-claude-border/50 dark:border-[#3d3832]/50">
              <div className="text-[10px] text-claude-text-muted font-medium uppercase tracking-wider">A</div>
              <MethodBar method="Cryo-EM" count={leftMethods.cryoem} total={leftMethods.cryoem + leftMethods.xray + leftMethods.nmr + leftMethods.other} color="#2d8f8f" />
              <MethodBar method="X-ray" count={leftMethods.xray} total={leftMethods.cryoem + leftMethods.xray + leftMethods.nmr + leftMethods.other} color="#7c5cbf" />
              <MethodBar method="NMR" count={leftMethods.nmr} total={leftMethods.cryoem + leftMethods.xray + leftMethods.nmr + leftMethods.other} color="#c9872e" />
            </div>
            <div className="space-y-2 p-3 rounded-lg bg-claude-border-light/30 dark:bg-[#1a1917]/30 border border-claude-border/50 dark:border-[#3d3832]/50">
              <div className="text-[10px] text-claude-text-muted font-medium uppercase tracking-wider">B</div>
              <MethodBar method="Cryo-EM" count={rightMethods.cryoem} total={rightMethods.cryoem + rightMethods.xray + rightMethods.nmr + rightMethods.other} color="#2d8f8f" />
              <MethodBar method="X-ray" count={rightMethods.xray} total={rightMethods.cryoem + rightMethods.xray + rightMethods.nmr + rightMethods.other} color="#7c5cbf" />
              <MethodBar method="NMR" count={rightMethods.nmr} total={rightMethods.cryoem + rightMethods.xray + rightMethods.nmr + rightMethods.other} color="#c9872e" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Method Distribution Bar ──────────────────────────────────────────────────

function MethodBar({ method, count, total, color }: { method: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0;

  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-claude-text-secondary">{method}</span>
        <span className="font-mono text-claude-text-muted">{count}</span>
      </div>
      <div className="h-1.5 bg-claude-border-light dark:bg-[#2b2926] rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          style={{ backgroundColor: color }}
        />
      </div>
    </div>
  );
}
