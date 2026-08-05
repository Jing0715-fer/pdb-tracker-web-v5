'use client';

import React, { useMemo, useId } from 'react';
import { useTheme } from 'next-themes';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts';
import {
  LayoutDashboard, AlertTriangle, Clock, Target, Activity,
  Trophy, ListChecks, ChevronRight,
} from 'lucide-react';
import { TiltCard, AnimatedNumber } from '@/components/ui/pdb-animated';
import { ClaudeChartTooltip, getChartAxisColor, getChartTickColor } from '@/components/chart-tooltips';
import { getScoreColor, getMethodLabel, getMethodColor } from '@/components/pdb-helpers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EvalHeatmap } from '@/components/eval-heatmap';
import { EvalScoreEvolution } from '@/components/eval-score-evolution';
import { DistributionBar, type DistributionSegment } from '@/components/ui/distribution-bar';
import { EvalBatchProgressTracker } from '@/components/EvalBatchProgressTracker';
import { ChartExportButton } from '@/components/chart-export-button';
import type { Evaluation, EvalBatch, EvalBatchSubTarget } from '@/lib/pdb-types';
import { useI18n } from '@/lib/i18n';

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

function getScoreValue(scoresStr: string | null, key: string): number {
  const scores = parseScores(scoresStr);
  return scores[key]?.score ?? 0;
}

/** Compute combined score from all score dimensions */
function getCombinedScore(scoresStr: string | null): number {
  const scores = parseScores(scoresStr);
  const vals = Object.values(scores).map(s => s.score);
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// ─── Time Ago Helper ────────────────────────────────────────────────────────────

function getTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) > 1 ? 's' : ''} ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} month${Math.floor(diffDays / 30) > 1 ? 's' : ''} ago`;
  return `${Math.floor(diffDays / 365)} year${Math.floor(diffDays / 365) > 1 ? 's' : ''} ago`;
}

// ─── Enhanced Stat Card (using TiltCard + AnimatedNumber) ───────────────────────

interface EnhancedStatCardProps {
  title: string;
  value: number;
  suffix?: string;
  decimals?: number;
  icon: React.ReactNode;
  color: string;
  glowColor?: string;
  subtitle?: string;
  delay?: number;
  borderColor?: string;
  children?: React.ReactNode;
  sparklineData?: number[];
  trendDirection?: 'up' | 'down' | 'flat';
  trendColor?: string;
}

function EnhancedStatCard({
  title, value, suffix = '', decimals = 0, icon, color, glowColor,
  subtitle, delay = 0, borderColor = '#c96442', children,
  sparklineData, trendDirection, trendColor,
}: EnhancedStatCardProps) {
  return (
    <TiltCard
      className="gradient-border-wrap min-w-0 h-full"
      animationDelay={`${delay}ms`}
      style={{ '--gradient-border-color': borderColor } as React.CSSProperties}
    >
      <div className="gradient-border-inner bg-claude-surface dark:bg-[#242220] p-3 sm:p-4 claude-card-shadow transition-transform duration-200 min-w-0 h-full flex flex-col">
        <div className="flex items-start justify-between mb-1.5 sm:mb-2 min-h-[36px] gap-2">
          <div className={`flex items-center justify-center w-8 h-8 min-w-[32px] rounded-md ${color} stat-icon-float flex-shrink-0`}>
            {icon}
          </div>
          <div className="hidden sm:flex items-center justify-center h-[38px] min-w-0">{children ?? <div className="h-[38px]" />}</div>
        </div>
        <div className="text-xl sm:text-2xl font-bold text-claude-text tabular-nums">
          <AnimatedNumber value={value} decimals={decimals} suffix={suffix} glowColor={glowColor} />
        </div>
        <div className="flex items-end justify-between gap-1">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] sm:text-[11px] font-medium text-claude-text-muted mt-0.5">{title}</div>
            <div className={`text-[9px] sm:text-[10px] mt-0.5 line-clamp-1 ${subtitle ? 'text-claude-text-muted opacity-70' : 'invisible'}`}>
              {subtitle || '\u00A0'}
            </div>
          </div>
          {/* Sparkline + Trend indicator (bottom-right) */}
          {sparklineData && sparklineData.length >= 2 && (
            <div className="hidden sm:flex items-center gap-0.5 flex-shrink-0 pb-0.5">
              <MiniSparkline
                data={sparklineData}
                color={borderColor}
                width={60}
                height={20}
              />
              <TrendArrow direction={trendDirection} color={trendColor} />
            </div>
          )}
        </div>
      </div>
    </TiltCard>
  );
}

// ─── Mini Sparkline SVG (CSS-only animated, matches Weekly style) ──────────────

function MiniSparkline({ data, color = '#c96442', width = 60, height = 20 }: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const reactId = useId();
  const uid = reactId.replace(/:/g, '');

  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 2;
  const usableH = height - padding * 2;
  const usableW = width - padding * 2;

  const points = data.map((v, i) => ({
    x: padding + (i / (data.length - 1)) * usableW,
    y: height - padding - ((v - min) / range) * usableH,
  }));

  // Build smooth bezier path (Catmull-Rom to Bezier)
  let path = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;

  if (points.length === 2) {
    const cpx = (points[0].x + points[1].x) / 2;
    path += ` Q${cpx.toFixed(1)},${points[0].y.toFixed(1)} ${points[1].x.toFixed(1)},${points[1].y.toFixed(1)}`;
  } else {
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      path += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
  }

  // Gradient fill path (close to bottom)
  const fillPath = `${path} L${points[points.length - 1].x.toFixed(1)},${(height - padding).toFixed(1)} L${points[0].x.toFixed(1)},${(height - padding).toFixed(1)} Z`;

  return (
    <svg width={width} height={height} className="flex-shrink-0 sparkline-svg" style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={`spark-fill-eval-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {/* Gradient fill */}
      <path
        d={fillPath}
        fill={`url(#spark-fill-eval-${uid})`}
        className="sparkline-fade-in"
      />
      {/* Line */}
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="sparkline-draw-in"
      />
      {/* End dot */}
      {points.length > 0 && (
        <circle
          cx={points[points.length - 1].x}
          cy={points[points.length - 1].y}
          r={2}
          fill={color}
          className="sparkline-dot-in"
        />
      )}
    </svg>
  );
}

// ─── Trend Arrow Indicator (matches Weekly style) ───────────────────────────────

function TrendArrow({ direction, color }: { direction?: 'up' | 'down' | 'flat'; color?: string }) {
  if (!direction) return null;

  const arrowColor = direction === 'up' ? (color || '#16a34a') : direction === 'down' ? (color || '#dc2626') : (color || '#6b7280');
  const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→';

  return (
    <span
      className="text-[11px] font-bold sparkline-fade-in"
      style={{ color: arrowColor, lineHeight: 1 }}
    >
      {arrow}
    </span>
  );
}

// ─── Trend helpers (matches Weekly style) ───────────────────────────────────────

function getTrendDirection(data: number[], invert = false): 'up' | 'down' | 'flat' {
  if (!data || data.length < 2) return 'flat';
  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  const diff = last - prev;
  const threshold = Math.max(Math.abs(prev) * 0.02, 0.01);
  if (Math.abs(diff) < threshold) return 'flat';
  if (invert) return diff < 0 ? 'up' : 'down';
  return diff > 0 ? 'up' : 'down';
}

function getTrendColor(direction: 'up' | 'down' | 'flat', invert = false): string {
  if (direction === 'flat') return '#6b7280';
  if (invert) return direction === 'up' ? '#dc2626' : '#16a34a';
  return direction === 'up' ? '#16a34a' : '#dc2626';
}

// ─── Circular Progress Ring SVG ─────────────────────────────────────────────────

function CircularProgressRing({ value, max, color, size = 34 }: { value: number; max: number; color: string; size?: number }) {
  const radius = (size - 4) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(value / max, 1);
  const offset = circumference * (1 - progress);

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke="currentColor"
        strokeWidth={2.5}
        className="text-claude-border dark:text-[#3d3832]"
      />
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 0.6s ease-out' }}
      />
    </svg>
  );
}

// ─── Mini Trend Indicator (CSS-only, matches CryoEmTrendIndicator style) ───────

function TrendIndicator({ direction, value }: { direction: 'up' | 'down' | 'neutral'; value: string }) {
  const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→';
  return (
    <div
      className="flex items-center gap-1 px-1.5 py-0.5 rounded-md sparkline-fade-in"
      style={{
        backgroundColor:
          direction === 'up' ? 'rgba(16, 163, 74, 0.1)' :
          direction === 'down' ? 'rgba(220, 38, 38, 0.1)' :
          'rgba(107, 114, 128, 0.1)',
      }}
    >
      <span className={`text-[10px] ${
        direction === 'up' ? 'text-green-500' :
        direction === 'down' ? 'text-red-400' :
        'text-claude-text-muted'
      }`}>
        {arrow}
      </span>
      <span className={`text-[10px] font-mono font-semibold ${
        direction === 'up' ? 'text-green-600 dark:text-green-400' :
        direction === 'down' ? 'text-red-500 dark:text-red-400' :
        'text-claude-text-muted'
      }`}>
        {value}
      </span>
    </div>
  );
}

// ─── Completion Progress Bar ────────────────────────────────────────────────────

function CompletionBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="w-full h-2 bg-claude-border-light dark:bg-[#2b2926] rounded-full overflow-hidden">
      <div
        className="h-full rounded-full score-bar-fill"
        style={{ backgroundColor: color, '--score-width': `${pct}%` } as React.CSSProperties}
      />
    </div>
  );
}

// ─── Method Distribution Stacked Bar (using unified DistributionBar) ──────────

function MethodDistributionBar({ evaluations, width = 200, height = 8 }: {
  evaluations: Evaluation[];
  width?: number;
  height?: number;
}) {
  const segments: DistributionSegment[] = useMemo(() => {
    let cryoem = 0, xray = 0, nmr = 0, other = 0;
    evaluations.forEach(e => {
      const pdbs = e.pdbStructures || [];
      if (pdbs.length === 0) return;
      const method = pdbs[0]?.method?.toUpperCase() || '';
      if (method.includes('CRYO') || method.includes('ELECTRON MICROSCOPY')) cryoem++;
      else if (method.includes('X-RAY') || method.includes('XRAY')) xray++;
      else if (method.includes('NMR')) nmr++;
      else other++;
    });
    return [
      { label: 'Cryo-EM', count: cryoem, color: '#2d8f8f' },
      { label: 'X-ray', count: xray, color: '#7c5cbf' },
      { label: 'NMR', count: nmr, color: '#c9872e' },
      { label: 'Other', count: other, color: '#6b7280' },
    ];
  }, [evaluations]);

  return <DistributionBar segments={segments} width={width} height={height} />;
}

// ─── Priority Item (preserved from original) ────────────────────────────────────

function PriorityItem({
  evaluation, priority, reason,
}: {
  evaluation: Evaluation;
  priority: number;
  reason: string;
}) {
  const { locale } = useI18n();
  const coverage = evaluation.coverage ?? 0;
  const diseaseRelevance = getScoreValue(evaluation.scores, 'disease_relevance');

  const priorityColor = priority >= 3
    ? 'text-red-500 bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800/30'
    : priority >= 2
    ? 'text-amber-500 bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/30'
    : 'text-teal-500 bg-teal-50 dark:bg-teal-900/10 border-teal-200 dark:border-teal-800/30';

  return (
    <div
      className={`flex items-center gap-3 p-2.5 rounded-lg border ${priorityColor} stagger-list-item`}
      style={{ animationDelay: `${priority * 50}ms` }}
    >
      <div className="flex items-center justify-center h-7 w-7 rounded-full bg-current/10 flex-shrink-0">
        <span className="text-xs font-bold text-current">{priority}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-claude-text truncate">
            {evaluation.proteinName || evaluation.uniprotId}
          </span>
          <span className="text-[9px] font-mono text-claude-text-muted">{evaluation.uniprotId}</span>
        </div>
        <div className="text-[10px] text-claude-text-secondary mt-0.5">{reason}</div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="text-right">
          <div className="text-[10px] text-claude-text-muted">{locale === 'zh' ? '覆盖度' : 'Coverage'}</div>
          <div className="text-xs font-mono font-semibold" style={{ color: getScoreColor(coverage / 10) }}>
            {coverage.toFixed(0)}%
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-claude-text-muted">{locale === 'zh' ? '疾病' : 'Disease'}</div>
          <div className="text-xs font-mono font-semibold" style={{ color: getScoreColor(diseaseRelevance) }}>
            {diseaseRelevance.toFixed(1)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Batch Summary Card ─────────────────────────────────────────────────────────

interface BatchCardProps {
  batch: EvalBatch;
  subTargets: EvalBatchSubTarget[];
  evaluations: Evaluation[];
  onView: (batchId: string) => void;
  index: number;
}

function BatchSummaryCard({ batch, subTargets, evaluations, onView, index }: BatchCardProps) {
  const { locale } = useI18n();
  // Find evaluations that belong to this batch
  const batchEvals = evaluations.filter(e => e.batchId === batch.batchId);
  const evalCount = batchEvals.length;

  // Average combined score
  const avgScore = evalCount > 0
    ? batchEvals.reduce((acc, e) => acc + getCombinedScore(e.scores), 0) / evalCount
    : 0;

  const scoreColor = avgScore >= 0.8 ? '#2d8f8f' : avgScore >= 0.5 ? '#c9872e' : '#dc2626';

  // Mini progress dots: determine completion status of each evaluation
  // A complete evaluation has: has PDB structures, has BLAST results, has a report
  const dots = batchEvals.map(e => {
    const hasPdb = (e.pdbStructures?.length ?? 0) > 0;
    const hasBlast = (e.blastResults?.length ?? 0) > 0;
    const hasReport = !!e.report;
    if (hasPdb && hasBlast && hasReport) return 'complete';
    if (hasPdb || hasBlast) return 'in-progress';
    return 'not-started';
  });

  return (
    <div
      className="p-3 rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-claude-surface dark:bg-[#242220] hover:border-claude-accent/30 transition-colors stagger-list-item"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h5 className="text-xs font-semibold text-claude-text truncate">
            {batch.title || batch.batchId}
          </h5>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-claude-text-muted">
              {evalCount} evaluation{evalCount !== 1 ? 's' : ''}
            </span>
            <Badge
              variant="outline"
              className="h-4 px-1.5 text-[9px] font-mono border-0"
              style={{ backgroundColor: `${scoreColor}15`, color: scoreColor }}
            >
              Avg: {(avgScore * 100).toFixed(0)}%
            </Badge>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onView(batch.batchId)}
          className="h-6 px-2 text-[10px] text-claude-accent hover:text-claude-accent-hover hover:bg-claude-accent/10 flex-shrink-0"
        >
          View
          <ChevronRight className="h-3 w-3 ml-0.5" />
        </Button>
      </div>

      {/* Mini progress dots */}
      {dots.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {dots.map((status, i) => (
            <span
              key={i}
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{
                backgroundColor:
                  status === 'complete' ? '#16a34a' :
                  status === 'in-progress' ? '#c9872e' :
                  '#6b7280',
              }}
              title={status === 'complete' ? (locale === 'zh' ? '已完成' : 'Complete') : status === 'in-progress' ? (locale === 'zh' ? '进行中' : 'In Progress') : (locale === 'zh' ? '未开始' : 'Not Started')}
            />
          ))}
          <span className="text-[9px] text-claude-text-muted ml-1">
            {dots.filter(d => d === 'complete').length}/{dots.length} {locale === 'zh' ? '完成' : 'complete'}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Recent Activity Item ───────────────────────────────────────────────────────

interface RecentActivityItemProps {
  evaluation: Evaluation;
  index: number;
}

function RecentActivityItem({ evaluation, index }: RecentActivityItemProps) {
  const method = evaluation.pdbStructures?.[0]?.method || '';
  const methodLabel = getMethodLabel(method);
  const methodColors = getMethodColor(method);
  const combinedScore = getCombinedScore(evaluation.scores);
  const scoreColor = combinedScore >= 0.8 ? '#2d8f8f' : combinedScore >= 0.5 ? '#c9872e' : '#dc2626';

  return (
    <div
      className="flex items-center gap-3 p-2.5 rounded-lg border border-claude-border/30 dark:border-[#3d3832]/30 hover:bg-claude-border-light/30 dark:hover:bg-[#2b2926]/30 transition-colors stagger-list-item"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-claude-text truncate">
            {evaluation.proteinName || evaluation.uniprotId}
          </span>
          <span className="text-[9px] font-mono text-claude-text-muted">{evaluation.uniprotId}</span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          {methodLabel && (
            <Badge
              variant="outline"
              className={`h-4 px-1.5 text-[9px] ${methodColors.bg} ${methodColors.text} ${methodColors.border}`}
            >
              {methodLabel}
            </Badge>
          )}
          <Badge
            variant="outline"
            className="h-4 px-1.5 text-[9px] font-mono border-0"
            style={{ backgroundColor: `${scoreColor}15`, color: scoreColor }}
          >
            {(combinedScore * 100).toFixed(0)}%
          </Badge>
          <span className="text-[9px] text-claude-text-muted">
            {getTimeAgo(evaluation.createdAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Main Dashboard Component ───────────────────────────────────────────────────

interface EvalDashboardProps {
  evaluations: Evaluation[];
  batches?: EvalBatch[];
  batchSubTargets?: Record<string, EvalBatchSubTarget[]>;
  onViewBatch?: (batchId: string) => void;
}

export function EvalDashboard({ evaluations, batches = [], batchSubTargets = {}, onViewBatch }: EvalDashboardProps) {
  const { theme } = useTheme();
  const { locale } = useI18n();
  const isDark = theme === 'dark';

  // ─── Enhanced Summary Stats ─────────────────────────────────────────────

  const stats = useMemo(() => {
    if (evaluations.length === 0) {
      return { total: 0, avgCoverage: 0, topScore: 0, completionRate: 0, recentTrend: 'neutral' as const };
    }

    const totalCoverage = evaluations.reduce((acc, e) => acc + (e.coverage ?? 0), 0);
    const avgCoverage = totalCoverage / evaluations.length;

    // Top combined score
    const combinedScores = evaluations.map(e => getCombinedScore(e.scores));
    const topScore = Math.max(...combinedScores);

    // Completion rate: evaluation has pdbStructures > 0 AND blastResults > 0 AND report
    const completedCount = evaluations.filter(e => {
      const hasPdb = (e.pdbStructures?.length ?? 0) > 0;
      const hasBlast = (e.blastResults?.length ?? 0) > 0;
      const hasReport = !!e.report;
      return hasPdb && hasBlast && hasReport;
    }).length;
    const completionRate = (completedCount / evaluations.length) * 100;

    // Recent trend: compare evaluations created in last half vs first half
    const sortedByDate = [...evaluations].sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const midPoint = Math.floor(sortedByDate.length / 2);
    const firstHalf = sortedByDate.slice(0, midPoint);
    const secondHalf = sortedByDate.slice(midPoint);
    const firstAvg = firstHalf.length > 0 ? firstHalf.reduce((acc, e) => acc + (e.coverage ?? 0), 0) / firstHalf.length : 0;
    const secondAvg = secondHalf.length > 0 ? secondHalf.reduce((acc, e) => acc + (e.coverage ?? 0), 0) / secondHalf.length : 0;
    const recentTrend: 'up' | 'down' | 'neutral' =
      secondAvg > firstAvg * 1.05 ? 'up' :
      secondAvg < firstAvg * 0.95 ? 'down' : 'neutral';

    return {
      total: evaluations.length,
      avgCoverage,
      topScore,
      completionRate,
      completedCount,
      recentTrend,
    };
  }, [evaluations]);

  // ─── Sparkline Data (from evaluations chunked by createdAt) ──────────────

  const evalSparklines = useMemo(() => {
    if (evaluations.length < 4) return { total: [], coverage: [], score: [], completion: [] };

    const sorted = [...evaluations].sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    // Divide into up to 8 chunks
    const numChunks = Math.min(8, sorted.length);
    const chunkSize = Math.ceil(sorted.length / numChunks);
    const chunks: Evaluation[][] = [];
    for (let i = 0; i < sorted.length; i += chunkSize) {
      chunks.push(sorted.slice(i, i + chunkSize));
    }

    // Cumulative total evaluations
    const total = chunks.map((_, i) => chunks.slice(0, i + 1).reduce((acc, c) => acc + c.length, 0));

    // Average coverage per chunk
    const coverage = chunks.map(chunk => {
      const avg = chunk.reduce((acc, e) => acc + (e.coverage ?? 0), 0) / chunk.length;
      return avg;
    });

    // Top combined score per chunk (scaled to 0-100)
    const score = chunks.map(chunk => {
      const maxScore = Math.max(...chunk.map(e => getCombinedScore(e.scores)));
      return maxScore * 100;
    });

    // Completion rate per chunk
    const completion = chunks.map(chunk => {
      const completed = chunk.filter(e => {
        const hasPdb = (e.pdbStructures?.length ?? 0) > 0;
        const hasBlast = (e.blastResults?.length ?? 0) > 0;
        const hasReport = !!e.report;
        return hasPdb && hasBlast && hasReport;
      }).length;
      return (completed / chunk.length) * 100;
    });

    return { total, coverage, score, completion };
  }, [evaluations]);

  // Trend directions and colors for each stat card
  const totalTrend = getTrendDirection(evalSparklines.total);
  const coverageTrend = getTrendDirection(evalSparklines.coverage);
  const scoreTrend = getTrendDirection(evalSparklines.score);
  const completionTrend = getTrendDirection(evalSparklines.completion);

  const totalTrendColor = getTrendColor(totalTrend);
  const coverageTrendColor = getTrendColor(coverageTrend);
  const scoreTrendColor = getTrendColor(scoreTrend);
  const completionTrendColor = getTrendColor(completionTrend);

  // ─── Coverage Distribution ────────────────────────────────────────────────

  const coverageDistribution = useMemo(() => {
    const buckets = [
      { range: '0-20%', min: 0, max: 20, count: 0, color: '#dc2626' },
      { range: '20-40%', min: 20, max: 40, count: 0, color: '#ea580c' },
      { range: '40-60%', min: 40, max: 60, count: 0, color: '#c9872e' },
      { range: '60-80%', min: 60, max: 80, count: 0, color: '#2d8f8f' },
      { range: '80-100%', min: 80, max: 100, count: 0, color: '#16a34a' },
    ];

    evaluations.forEach(e => {
      const cov = e.coverage ?? 0;
      for (const bucket of buckets) {
        if (cov >= bucket.min && cov < bucket.max) {
          bucket.count++;
          return;
        }
      }
      // Handle exactly 100%
      if (cov === 100) buckets[4].count++;
    });

    return buckets;
  }, [evaluations]);

  // ─── Top 5 Evaluations for Radar Overlay ──────────────────────────────────

  const top5RadarData = useMemo(() => {
    if (evaluations.length === 0) return { data: [], evaluations: [] };

    // Sort by coverage descending, take top 5
    const sorted = [...evaluations].sort((a, b) => (b.coverage ?? 0) - (a.coverage ?? 0));
    const top5 = sorted.slice(0, 5);

    // Get all score keys (excluding Overall)
    const allKeys = new Set<string>();
    top5.forEach(e => {
      const scores = parseScores(e.scores);
      Object.keys(scores).forEach(k => {
        if (k !== 'Overall') allKeys.add(k);
      });
    });

    const categories = Array.from(allKeys);
    if (categories.length < 3) return { data: [], evaluations: top5 };

    const radarColors = ['#c96442', '#2d8f8f', '#7c5cbf', '#c9872e', '#16a34a'];

    // Build data for each category
    const data = categories.map(cat => {
      const point: Record<string, string | number> = { category: cat.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) };
      top5.forEach((ev) => {
        const scores = parseScores(ev.scores);
        const val = scores[cat]?.score ?? 0;
        const max = scores[cat]?.max ?? 10;
        point[ev.uniprotId] = val;
        point[`${ev.uniprotId}Max`] = max;
      });
      return point;
    });

    return { data, evaluations: top5, colors: radarColors };
  }, [evaluations]);

  // ─── Priority Recommendations ─────────────────────────────────────────────

  const priorities = useMemo(() => {
    return evaluations
      .map(e => {
        const coverage = e.coverage ?? 0;
        const diseaseRelevance = getScoreValue(e.scores, 'disease_relevance');
        const structuralCoverage = getScoreValue(e.scores, 'structural_coverage');

        // Priority: high disease relevance + low coverage = needs attention
        const needsAttention = (1 - coverage / 100) * diseaseRelevance;
        let reason = '';
        if (diseaseRelevance > 0.9 && coverage < 50) {
          reason = locale === 'zh' ? '疾病相关性高但结构覆盖度低' : 'High disease relevance but low structural coverage';
        } else if (coverage < 30) {
          reason = locale === 'zh' ? '结构覆盖度极低' : 'Very low structural coverage';
        } else if (diseaseRelevance > 0.9 && structuralCoverage < 0.5) {
          reason = locale === 'zh' ? '疾病相关性高，结构数据有限' : 'High disease relevance, limited structural data';
        } else {
          reason = locale === 'zh' ? '中等优先级，建议进一步研究' : 'Moderate priority for further study';
        }

        return { evaluation: e, needsAttention, reason };
      })
      .sort((a, b) => b.needsAttention - a.needsAttention)
      .slice(0, 5);
  }, [evaluations]);

  // ─── Progress Timeline ────────────────────────────────────────────────────

  const timeline = useMemo(() => {
    return [...evaluations]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map(e => ({
        evaluation: e,
        date: new Date(e.createdAt),
        coverage: e.coverage ?? 0,
      }));
  }, [evaluations]);

  // ─── Recent Activity ──────────────────────────────────────────────────────

  const recentActivity = useMemo(() => {
    return [...evaluations]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);
  }, [evaluations]);

  // ─── Render ───────────────────────────────────────────────────────────────

  if (evaluations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[300px] px-4 sparkline-fade-in">
        <LayoutDashboard className="h-12 w-12 text-claude-text-muted mb-3" />
        <h3 className="text-base font-semibold text-claude-text mb-1">{locale === 'zh' ? '暂无评估' : 'No Evaluations Yet'}</h3>
        <p className="text-sm text-claude-text-secondary text-center">
          {locale === 'zh' ? '评估数据加载后将在此处显示。' : 'Evaluation data will appear here once evaluations are loaded.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto custom-scrollbar">
      {/* Header */}
      <div className="px-4 py-3 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] flex-shrink-0">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="h-4 w-4 text-claude-accent" />
          <h2 className="text-sm font-bold text-claude-text">{locale === 'zh' ? '评估看板' : 'Evaluation Dashboard'}</h2>
          <span className="text-[10px] text-claude-text-muted font-medium ml-auto">
            {evaluations.length} {locale === 'zh' ? '项评估' : 'evaluations'}
          </span>
        </div>
      </div>

      <div className="flex-1 p-4 space-y-5">
        {/* ── Enhanced Summary Stat Cards ──────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 [grid-auto-rows:1fr]">
          {/* Total Evaluations */}
          <EnhancedStatCard
            title={locale === "zh" ? "评估总数" : "Total Evaluations"}
            value={stats.total}
            icon={<Activity className="h-4 w-4 text-white" />}
            color="bg-gradient-to-br from-[#2d8f8f] to-[#1a6b6b]"
            glowColor="#2d8f8f"
            subtitle={stats.recentTrend === 'up' ? (locale === 'zh' ? '覆盖率上升趋势' : 'Coverage trending up') : stats.recentTrend === 'down' ? (locale === 'zh' ? '覆盖率下降趋势' : 'Coverage trending down') : (locale === 'zh' ? '覆盖率稳定' : 'Coverage stable')}
            delay={0}
            borderColor="#2d8f8f"
            sparklineData={evalSparklines.total}
            trendDirection={totalTrend}
            trendColor={totalTrendColor}
          >
            <TrendIndicator
              direction={stats.recentTrend}
              value={stats.recentTrend === 'up' ? '↑' : stats.recentTrend === 'down' ? '↓' : '—'}
            />
          </EnhancedStatCard>

          {/* Avg Coverage */}
          <EnhancedStatCard
            title={locale === "zh" ? "平均覆盖率" : "Avg Coverage"}
            value={stats.avgCoverage}
            suffix="%"
            decimals={1}
            icon={<Target className="h-4 w-4 text-white" />}
            color="bg-gradient-to-br from-[#7c5cbf] to-[#5a3d99]"
            glowColor="#7c5cbf"
            subtitle={locale === 'zh' ? `共 ${stats.total} 个评估` : `across ${stats.total} evaluations`}
            delay={80}
            borderColor="#7c5cbf"
            sparklineData={evalSparklines.coverage}
            trendDirection={coverageTrend}
            trendColor={coverageTrendColor}
          >
            <CircularProgressRing value={stats.avgCoverage} max={100} color="#7c5cbf" size={34} />
          </EnhancedStatCard>

          {/* Top Score */}
          <EnhancedStatCard
            title={locale === "zh" ? "最高评分" : "Top Score"}
            value={stats.topScore * 100}
            suffix="%"
            decimals={0}
            icon={<Trophy className="h-4 w-4 text-white" />}
            color="bg-gradient-to-br from-[#c9872e] to-[#a06b1a]"
            glowColor="#c9872e"
            subtitle={locale === "zh" ? "最高综合评分" : "Highest combined score"}
            delay={160}
            borderColor="#c9872e"
            sparklineData={evalSparklines.score}
            trendDirection={scoreTrend}
            trendColor={scoreTrendColor}
          >
            {/* Small trophy accent */}
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#c9872e]/10">
              <Trophy className="h-3 w-3 text-[#c9872e]" />
              <span className="text-[9px] font-mono font-semibold text-[#c9872e]">
                Best
              </span>
            </div>
          </EnhancedStatCard>

          {/* Completion Rate */}
          <EnhancedStatCard
            title={locale === "zh" ? "完成率" : "Completion Rate"}
            value={stats.completionRate}
            suffix="%"
            decimals={0}
            icon={<ListChecks className="h-4 w-4 text-white" />}
            color={
              stats.completionRate >= 75 ? 'bg-gradient-to-br from-green-500 to-green-700' :
              stats.completionRate >= 50 ? 'bg-gradient-to-br from-amber-500 to-amber-700' :
              'bg-gradient-to-br from-red-500 to-red-700'
            }
            glowColor={
              stats.completionRate >= 75 ? '#16a34a' :
              stats.completionRate >= 50 ? '#c9872e' : '#dc2626'
            }
            subtitle={locale === 'zh' ? `${stats.completedCount ?? 0} / ${stats.total} 已完成` : `${stats.completedCount ?? 0} of ${stats.total} complete`}
            delay={240}
            borderColor={
              stats.completionRate >= 75 ? '#16a34a' :
              stats.completionRate >= 50 ? '#c9872e' : '#dc2626'
            }
            sparklineData={evalSparklines.completion}
            trendDirection={completionTrend}
            trendColor={completionTrendColor}
          >
            <div className="w-[80px] flex flex-col gap-1.5">
              <CompletionBar
                pct={stats.completionRate}
                color={
                  stats.completionRate >= 75 ? '#16a34a' :
                  stats.completionRate >= 50 ? '#c9872e' : '#dc2626'
                }
              />
              <span className="text-[8px] text-claude-text-muted font-mono">
                {stats.completedCount ?? 0}/{stats.total}
              </span>
            </div>
          </EnhancedStatCard>
        </div>

        {/* ── Method Distribution Mini Bar ─────────────────────────────────── */}
        <div className="space-y-1.5 sparkline-fade-in">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] font-semibold text-claude-text uppercase tracking-wider">
              Method Distribution
            </h4>
            <ChartExportButton chartName="eval-dashboard-method-dist" />
          </div>
          <MethodDistributionBar evaluations={evaluations} />
        </div>

        {/* ── Score Comparison Heatmap ─────────────────────────────────────── */}
        <EvalHeatmap
          evaluations={evaluations}
          batches={batches}
          batchSubTargets={batchSubTargets}
        />

        {/* ── Batch Summary Section ────────────────────────────────────────── */}
        {batches.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold text-claude-text uppercase tracking-wider flex items-center gap-1.5">
              <LayoutDashboard className="h-3 w-3 text-claude-accent" />
              Batch Summary
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-72 overflow-y-auto custom-scrollbar">
              {batches.map((batch, idx) => (
                <BatchSummaryCard
                  key={batch.batchId}
                  batch={batch}
                  subTargets={batchSubTargets[batch.batchId] || []}
                  evaluations={evaluations}
                  onView={(batchId) => {
                    if (onViewBatch) onViewBatch(batchId);
                  }}
                  index={idx}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Batch Progress Tracker ────────────────────────────────────── */}
        {batches.length > 0 && (
          <EvalBatchProgressTracker
            evaluations={evaluations}
            batches={batches}
            batchSubTargets={batchSubTargets}
          />
        )}

        {/* ── Coverage Distribution Chart (preserved) ──────────────────────── */}
        <div className="space-y-2">
          <h4 className="text-[11px] font-semibold text-claude-text uppercase tracking-wider">{locale === 'zh' ? '覆盖度分布' : 'Coverage Distribution'}</h4>
          <div className="chart-container chart-inner-shadow rounded-lg p-3 bg-claude-surface dark:bg-[#242220] border border-claude-border-light dark:border-[#2b2926]">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={coverageDistribution} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#3d3832' : '#e8e4dd'} />
                <XAxis
                  dataKey="range"
                  tick={{ fontSize: 10, fill: getChartTickColor(isDark) }}
                  axisLine={{ stroke: getChartAxisColor(isDark) }}
                  tickLine={{ stroke: getChartAxisColor(isDark) }}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: getChartTickColor(isDark) }}
                  axisLine={{ stroke: getChartAxisColor(isDark) }}
                  tickLine={{ stroke: getChartAxisColor(isDark) }}
                  allowDecimals={false}
                />
                <Tooltip content={<ClaudeChartTooltip isDark={isDark} />} />
                <Bar
                  dataKey="count"
                  name="Evaluations"
                  radius={[4, 4, 0, 0]}
                >
                  {coverageDistribution.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Score Radar Overlay (preserved) ──────────────────────────────── */}
        {top5RadarData.data.length >= 3 && (
          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold text-claude-text uppercase tracking-wider">
              Score Radar — Top {top5RadarData.evaluations.length} Evaluations
            </h4>
            <div className="chart-container chart-inner-shadow rounded-lg p-3 bg-claude-surface dark:bg-[#242220] border border-claude-border-light dark:border-[#2b2926]">
              <ResponsiveContainer width="100%" height={280}>
                <RadarChart data={top5RadarData.data} cx="50%" cy="50%" outerRadius="70%">
                  <PolarGrid stroke={isDark ? '#3d3832' : '#e8e4dd'} strokeDasharray="2 2" />
                  <PolarAngleAxis
                    dataKey="category"
                    tick={{ fontSize: 9, fill: isDark ? '#6b6560' : '#7c756e' }}
                  />
                  <PolarRadiusAxis
                    angle={90}
                    domain={[0, 'auto']}
                    tick={{ fontSize: 8, fill: isDark ? '#6b6560' : '#9b9590' }}
                  />
                  {top5RadarData.evaluations.map((ev, idx) => {
                    const colors = top5RadarData.colors as string[];
                    const color = colors[idx % colors.length];
                    return (
                      <Radar
                        key={ev.uniprotId}
                        name={ev.proteinName || ev.uniprotId}
                        dataKey={ev.uniprotId}
                        stroke={color}
                        fill={color}
                        fillOpacity={0.05}
                        strokeWidth={2}
                      />
                    );
                  })}
                  <Tooltip content={<ClaudeChartTooltip isDark={isDark} />} />
                </RadarChart>
              </ResponsiveContainer>
              {/* Legend */}
              <div className="flex flex-wrap gap-3 mt-2 justify-center">
                {top5RadarData.evaluations.map((ev, idx) => {
                  const colors = top5RadarData.colors as string[];
                  const color = colors[idx % colors.length];
                  return (
                    <div key={ev.uniprotId} className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                      <span className="text-[10px] text-claude-text-secondary font-medium">
                        {ev.proteinName || ev.uniprotId}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── Score Evolution Projection ───────────────────────────────────── */}
        <EvalScoreEvolution
          evaluations={evaluations}
          batches={batches}
          batchSubTargets={batchSubTargets}
        />

        {/* ── Priority Recommendations (preserved) ─────────────────────────── */}
        <div className="space-y-2">
          <h4 className="text-[11px] font-semibold text-claude-text uppercase tracking-wider flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3 text-claude-accent" />
            {locale === 'zh' ? '优先推荐' : 'Priority Recommendations'}
          </h4>
          <div className="space-y-1.5 max-h-64 overflow-y-auto custom-scrollbar">
            {priorities.map((p, idx) => (
              <PriorityItem
                key={p.evaluation.uniprotId}
                evaluation={p.evaluation}
                priority={idx + 1}
                reason={p.reason}
              />
            ))}
          </div>
        </div>

        {/* ── Recent Activity Section ──────────────────────────────────────── */}
        <div className="space-y-2">
          <h4 className="text-[11px] font-semibold text-claude-text uppercase tracking-wider flex items-center gap-1.5">
            <Clock className="h-3 w-3 text-claude-accent" />
            {locale === 'zh' ? '最近活动' : 'Recent Activity'}
          </h4>
          <div className="space-y-1.5">
            {recentActivity.map((evaluation, idx) => (
              <RecentActivityItem
                key={evaluation.uniprotId}
                evaluation={evaluation}
                index={idx}
              />
            ))}
          </div>
        </div>

        {/* ── Progress Timeline (preserved) ────────────────────────────────── */}
        <div className="space-y-2">
          <h4 className="text-[11px] font-semibold text-claude-text uppercase tracking-wider flex items-center gap-1.5">
            <Clock className="h-3 w-3 text-claude-accent" />
            {locale === 'zh' ? '进度时间线' : 'Progress Timeline'}
          </h4>
          <div className="relative pl-6 space-y-0">
            {/* Vertical line */}
            <div className="absolute left-2.5 top-2 bottom-2 w-px bg-claude-border dark:bg-[#3d3832]" />
            {timeline.map((item, idx) => {
              const cov = item.coverage;
              const dotColor = cov >= 80 ? '#16a34a' : cov >= 50 ? '#2d8f8f' : cov >= 30 ? '#c9872e' : '#dc2626';
              return (
                <div
                  key={item.evaluation.uniprotId}
                  className="relative pb-4 last:pb-0 stagger-list-item"
                  style={{ animationDelay: `${idx * 50}ms` }}
                >
                  {/* Dot */}
                  <div
                    className="absolute -left-[14px] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-[#242220]"
                    style={{ backgroundColor: dotColor }}
                  />
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-claude-text truncate">
                          {item.evaluation.proteinName || item.evaluation.uniprotId}
                        </span>
                        <span className="text-[9px] font-mono text-claude-text-muted">{item.evaluation.uniprotId}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-[10px] text-claude-text-muted">
                          {item.date.toLocaleDateString()}
                        </span>
                        <div className="flex items-center gap-1.5 flex-1 max-w-[120px]">
                          <div className="h-1 flex-1 bg-claude-border-light dark:bg-[#2b2926] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${cov}%`, backgroundColor: dotColor }}
                            />
                          </div>
                          <span className="text-[9px] font-mono text-claude-text-muted">{cov.toFixed(0)}%</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
