'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import {
  Award,
  TrendingUp,
  Target,
  Shield,
  Boxes,
  Gauge,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import type { Evaluation } from '@/lib/pdb-types';
import { parseDruggabilityFromScores } from '@/lib/druggability';

/**
 * EvaluationScoreCard
 *
 * Displays the druggability score breakdown for a single evaluation:
 *   - Overall score (big number with grade badge)
 *   - Radar chart showing 5 score dimensions
 *   - Individual score bars with colors
 *   - Quick stats (coverage, PDB count, BLAST status)
 *
 * R210: scores 解析升级 —— 优先读 v2 嵌套 `druggability` 子对象（DSH
 * collect 落库新格式，四维 0-100 数据驱动计算），回退 legacy 顶层五键
 * （seed-demo 形态）。方法学键（X-ray/Cryo-EM/NMR/Overall）不在此卡
 * 展示（EvalSummary 已有）。此前 DSH 行四维恒 0/F 即键不匹配所致。
 */

interface ScoreDimensions {
  structure?: number;
  function?: number;
  topology?: number;
  feasibility?: number;
  overall?: number;
}

function parseScores(scores: string | null | undefined): ScoreDimensions {
  return parseDruggabilityFromScores(scores) ?? {};
}

function getGrade(overall: number): { label: string; color: string; bg: string } {
  if (overall >= 85) return { label: 'A+', color: '#16a34a', bg: 'from-[#16a34a] to-[#15803d]' };
  if (overall >= 75) return { label: 'A', color: '#2d8f8f', bg: 'from-[#2d8f8f] to-[#1a6b6b]' };
  if (overall >= 65) return { label: 'B', color: '#7c5cbf', bg: 'from-[#7c5cbf] to-[#5a3d99]' };
  if (overall >= 50) return { label: 'C', color: '#c9872e', bg: 'from-[#c9872e] to-[#a06b1a]' };
  if (overall >= 35) return { label: 'D', color: '#ea580c', bg: 'from-[#ea580c] to-[#c2410c]' };
  return { label: 'F', color: '#dc2626', bg: 'from-[#dc2626] to-[#991b1b]' };
}

const DIMENSION_CONFIG = [
  { key: 'structure' as const, label: 'Structure', icon: Boxes, color: '#2d8f8f', description: 'PDB coverage & resolution quality' },
  { key: 'function' as const, label: 'Function', icon: Target, color: '#7c5cbf', description: 'Known drug target validation' },
  { key: 'topology' as const, label: 'Topology', icon: Shield, color: '#c9872e', description: 'Domain architecture & pockets' },
  { key: 'feasibility' as const, label: 'Feasibility', icon: TrendingUp, color: '#16a34a', description: 'Practical druggability potential' },
];

interface EvaluationScoreCardProps {
  evaluation: Evaluation;
  compact?: boolean;
}

export function EvaluationScoreCard({ evaluation, compact = false }: EvaluationScoreCardProps) {
  const scores = useMemo(() => parseScores(evaluation.scores), [evaluation.scores]);
  const overall = scores.overall ?? 0;
  const grade = getGrade(overall);

  const radarData = DIMENSION_CONFIG.map((dim) => ({
    dimension: dim.label,
    score: scores[dim.key] ?? 0,
    fullMark: 100,
  }));

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="glass-card rounded-xl p-3 w-full"
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-claude-accent/15">
          <Award className="h-3.5 w-3.5 text-claude-accent" />
        </div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-claude-text">
          Druggability Score
        </h3>
      </div>

      {/* Horizontal layout: score ring | radar | bars */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Left: Overall score + grade */}
        <div className="flex items-center gap-3 justify-center lg:justify-start">
          <div className={`relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br ${grade.bg} shadow-lg shrink-0`}>
            <div className="absolute inset-1 rounded-full bg-claude-surface dark:bg-[#242220] flex flex-col items-center justify-center">
              <span className="text-xl font-bold tabular-nums leading-none" style={{ color: grade.color }}>
                {overall}
              </span>
              <span className="text-[7px] text-claude-text-muted uppercase mt-0.5">/ 100</span>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <div
              className="flex h-6 w-10 items-center justify-center rounded-md text-xs font-bold text-white shadow-sm"
              style={{ backgroundColor: grade.color }}
            >
              {grade.label}
            </div>
            <div className="text-[10px] text-claude-text-muted">
              {overall >= 75 ? 'Highly druggable' : overall >= 50 ? 'Moderate' : 'Challenging'}
            </div>
          </div>
        </div>

        {/* Middle: Radar chart */}
        {!compact && (
          <div className="eval-radar-container flex-1 min-h-[120px] max-w-[200px] mx-auto">
            <ResponsiveContainer width="100%" height={120}>
              <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="65%">
                <PolarGrid stroke="#e5ddd5" strokeOpacity={0.5} />
                <PolarAngleAxis
                  dataKey="dimension"
                  tick={{ fontSize: 8, fill: '#9a8f86' }}
                />
                <PolarRadiusAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 6, fill: '#c0b5ac' }}
                  tickCount={5}
                  axisLine={false}
                />
                <Radar
                  name="Score"
                  dataKey="score"
                  stroke="#c96442"
                  fill="#c96442"
                  fillOpacity={0.3}
                  strokeWidth={2}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(36, 34, 32, 0.95)',
                    border: '1px solid rgba(201, 100, 66, 0.3)',
                    borderRadius: '8px',
                    fontSize: '11px',
                    color: '#faf8f5',
                  }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Right: Score breakdown bars */}
        <div className="flex-1 space-y-1.5">
          {DIMENSION_CONFIG.map((dim, i) => {
            const value = scores[dim.key] ?? 0;
            const Icon = dim.icon;
            return (
              <motion.div
                key={dim.key}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.05 }}
                className="flex items-center gap-2"
              >
                <Icon className="h-3 w-3 shrink-0" style={{ color: dim.color }} />
                <span className="text-[10px] text-claude-text-muted w-16 shrink-0">
                  {dim.label}
                </span>
                <div className="flex-1 h-1.5 rounded-full bg-claude-border/30 dark:bg-[#3d3832]/30 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${value}%` }}
                    transition={{ delay: 0.3 + i * 0.05, duration: 0.6, ease: 'easeOut' }}
                    className="h-full rounded-full score-bar-fill"
                    style={{ backgroundColor: dim.color }}
                  />
                </div>
                <span className="text-[10px] font-semibold tabular-nums text-claude-text w-7 text-right">
                  {value}
                </span>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Quick stats footer */}
      <div className="mt-3 pt-2 border-t border-claude-border/30 dark:border-[#3d3832]/30 grid grid-cols-3 gap-2">
        <div className="text-center">
          <div className="flex items-center justify-center gap-1 text-[9px] text-claude-text-muted uppercase tracking-wider">
            <Gauge className="h-2.5 w-2.5" />
            Coverage
          </div>
          <div className="text-sm font-bold text-claude-text tabular-nums">
            {evaluation.coverage != null ? `${evaluation.coverage.toFixed(0)}%` : '—'}
          </div>
        </div>
        <div className="text-center">
          <div className="flex items-center justify-center gap-1 text-[9px] text-claude-text-muted uppercase tracking-wider">
            <Boxes className="h-2.5 w-2.5" />
            PDB Count
          </div>
          <div className="text-sm font-bold text-claude-text tabular-nums">
            {evaluation.pdbCountAtEval ?? evaluation.pdbStructures?.length ?? 0}
          </div>
        </div>
        <div className="text-center">
          <div className="flex items-center justify-center gap-1 text-[9px] text-claude-text-muted uppercase tracking-wider">
            {evaluation.blastWasSkipped ? (
              <AlertCircle className="h-2.5 w-2.5" />
            ) : (
              <CheckCircle2 className="h-2.5 w-2.5" />
            )}
            BLAST
          </div>
          <div className={`text-sm font-bold tabular-nums ${evaluation.blastWasSkipped ? 'text-amber-500' : 'text-emerald-500'}`}>
            {evaluation.blastWasSkipped ? 'Skipped' : 'Done'}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
