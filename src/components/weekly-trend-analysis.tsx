'use client';

import React, { useMemo } from 'react';
import { useTheme } from 'next-themes';
import { motion } from 'framer-motion';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, Sparkles, Target, AlertTriangle } from 'lucide-react';
import type { WeeklySnapshot, PdbEntry } from '@/lib/pdb-types';
import { METHOD_COLORS, getChartAxisColor, getChartTickColor, ClaudeChartTooltip } from '@/components/chart-tooltips';
import { ChartExportButton } from '@/components/chart-export-button';

// ─── Props ────────────────────────────────────────────────────────────────────

interface WeeklyTrendAnalysisProps {
  snapshots: WeeklySnapshot[];
  entries: PdbEntry[];
}

// ─── Trend Direction Arrow ──────────────────────────────────────────────────────

function TrendArrow({ values }: { values: number[] }) {
  if (values.length < 2) return <Minus className="h-3 w-3 text-claude-text-muted" />;
  const last = values[values.length - 1];
  const prev = values[values.length - 2];
  const delta = last - prev;
  if (Math.abs(delta) < 0.5) return <Minus className="h-3 w-3 text-claude-text-muted" />;
  if (delta > 0) return <TrendingUp className="h-3 w-3 text-emerald-500" />;
  return <TrendingDown className="h-3 w-3 text-red-400" />;
}

// ─── Method Prediction ──────────────────────────────────────────────────────────

interface PredictionResult {
  projectedWeek: string;
  confidence: 'low' | 'medium' | 'high';
  alreadyPassed: boolean;
  currentPct: number;
}

function computeCryoEmPrediction(snapshots: WeeklySnapshot[]): PredictionResult {
  if (snapshots.length < 2) {
    return { projectedWeek: '', confidence: 'low', alreadyPassed: false, currentPct: 0 };
  }

  // Sort snapshots chronologically (oldest first)
  const sorted = [...snapshots].sort((a, b) => a.weekId.localeCompare(b.weekId));

  // Compute Cryo-EM percentage per week
  const data = sorted.map(s => ({
    weekId: s.weekId,
    cryoemPct: s.totalStructures > 0 ? (s.cryoemCount / s.totalStructures) * 100 : 0,
  }));

  const currentPct = data[data.length - 1].cryoemPct;

  if (currentPct >= 50) {
    return { projectedWeek: '', confidence: 'high', alreadyPassed: true, currentPct };
  }

  // Simple linear regression on Cryo-EM %
  const n = data.length;
  const xs = data.map((_, i) => i); // week index
  const ys = data.map(d => d.cryoemPct);

  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0);
  const sumXX = xs.reduce((a, x) => a + x * x, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // Calculate variance for confidence
  const meanY = sumY / n;
  const ssTot = ys.reduce((s, y) => s + (y - meanY) ** 2, 0);
  const ssRes = ys.reduce((s, y, i) => s + (y - (slope * i + intercept)) ** 2, 0);
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  const confidence: 'low' | 'medium' | 'high' =
    rSquared > 0.7 ? 'high' : rSquared > 0.4 ? 'medium' : 'low';

  if (slope <= 0) {
    // Cryo-EM is not growing, can't predict reaching 50%
    return { projectedWeek: 'N/A', confidence: 'low', alreadyPassed: false, currentPct };
  }

  // When will it reach 50%?  slope * weekIndex + intercept = 50
  const targetIndex = (50 - intercept) / slope;
  const weeksAhead = Math.ceil(targetIndex - (n - 1));

  if (weeksAhead <= 0) {
    return { projectedWeek: '', confidence, alreadyPassed: true, currentPct };
  }

  // Compute projected week ID
  const lastWeekId = sorted[sorted.length - 1].weekId;
  const match = lastWeekId.match(/(\d{4})-W(\d+)/);
  if (!match) {
    return { projectedWeek: `+${weeksAhead} weeks`, confidence, alreadyPassed: false, currentPct };
  }

  let year = parseInt(match[1]);
  let week = parseInt(match[2]) + weeksAhead;
  while (week > 52) {
    week -= 52;
    year++;
  }
  const projectedWeek = `${year}-W${String(week).padStart(2, '0')}`;

  return { projectedWeek, confidence, alreadyPassed: false, currentPct };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WeeklyTrendAnalysis({ snapshots, entries }: WeeklyTrendAnalysisProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const axisColor = getChartAxisColor(isDark);
  const tickColor = getChartTickColor(isDark);

  // ─── Method Trend Data ──────────────────────────────────────────────────────

  const methodTrendData = useMemo(() => {
    if (snapshots.length < 2) return [];
    const sorted = [...snapshots].sort((a, b) => a.weekId.localeCompare(b.weekId));
    return sorted.map(s => {
      const total = s.totalStructures || 1;
      return {
        week: s.weekId.replace('2025-', ''),
        'Cryo-EM': +((s.cryoemCount / total) * 100).toFixed(1),
        'X-ray': +((s.xrayCount / total) * 100).toFixed(1),
        'NMR': +((s.nmrCount / total) * 100).toFixed(1),
      };
    });
  }, [snapshots]);

  // Track direction for each method
  const methodDirections = useMemo(() => {
    const result: Record<string, number[]> = { 'Cryo-EM': [], 'X-ray': [], 'NMR': [] };
    methodTrendData.forEach(d => {
      result['Cryo-EM'].push(d['Cryo-EM']);
      result['X-ray'].push(d['X-ray']);
      result['NMR'].push(d['NMR']);
    });
    return result;
  }, [methodTrendData]);

  // ─── Resolution Trend Data ──────────────────────────────────────────────────

  const resolutionTrendData = useMemo(() => {
    if (snapshots.length < 2) return [];
    const sorted = [...snapshots].sort((a, b) => a.weekId.localeCompare(b.weekId));

    // Group entries by weekId and compute min/avg/max resolution
    const entriesByWeek: Record<string, number[]> = {};
    for (const e of entries) {
      if (e.resolution == null || !e.weekId) continue;
      if (!entriesByWeek[e.weekId]) entriesByWeek[e.weekId] = [];
      entriesByWeek[e.weekId].push(e.resolution);
    }

    return sorted.map(s => {
      const resValues = entriesByWeek[s.weekId] || [];
      if (resValues.length === 0) {
        return {
          week: s.weekId.replace('2025-', ''),
          min: 0,
          avg: 0,
          max: 0,
        };
      }
      const sortedRes = [...resValues].sort((a, b) => a - b);
      const min = sortedRes[0];
      const max = sortedRes[sortedRes.length - 1];
      const avg = sortedRes.reduce((a, b) => a + b, 0) / sortedRes.length;
      return {
        week: s.weekId.replace('2025-', ''),
        min: +min.toFixed(2),
        avg: +avg.toFixed(2),
        max: +max.toFixed(2),
      };
    }).filter(d => d.avg > 0);
  }, [snapshots, entries]);

  // ─── IF Distribution Trend Data ─────────────────────────────────────────────

  const ifTrendData = useMemo(() => {
    if (snapshots.length < 2) return [];
    const sorted = [...snapshots].sort((a, b) => a.weekId.localeCompare(b.weekId));

    // Group entries by weekId and compute IF tier percentages
    const entriesByWeek: Record<string, PdbEntry[]> = {};
    for (const e of entries) {
      if (!e.weekId) continue;
      if (!entriesByWeek[e.weekId]) entriesByWeek[e.weekId] = [];
      entriesByWeek[e.weekId].push(e);
    }

    return sorted.map(s => {
      const weekEntries = entriesByWeek[s.weekId] || [];
      const total = weekEntries.length || 1;
      const top = weekEntries.filter(e => (e.journalIf ?? 0) >= 20).length;
      const high = weekEntries.filter(e => (e.journalIf ?? 0) >= 10 && (e.journalIf ?? 0) < 20).length;
      const mid = weekEntries.filter(e => (e.journalIf ?? 0) >= 5 && (e.journalIf ?? 0) < 10).length;
      const low = weekEntries.filter(e => (e.journalIf ?? 0) > 0 && (e.journalIf ?? 0) < 5).length;
      return {
        week: s.weekId.replace('2025-', ''),
        'Top (IF\u226520)': +((top / total) * 100).toFixed(1),
        'High (IF\u226510)': +((high / total) * 100).toFixed(1),
        'Mid (IF\u22655)': +((mid / total) * 100).toFixed(1),
        'Low (IF<5)': +((low / total) * 100).toFixed(1),
      };
    });
  }, [snapshots, entries]);

  // ─── Prediction ─────────────────────────────────────────────────────────────

  const prediction = useMemo(() => computeCryoEmPrediction(snapshots), [snapshots]);

  // ─── No data guard ──────────────────────────────────────────────────────────

  if (snapshots.length < 2) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-claude-text-muted">Need at least 2 weekly snapshots for trend analysis</p>
      </div>
    );
  }

  const gridColor = isDark ? '#3d3832' : '#e8e4dd';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-4 p-4"
    >
      {/* 3 Charts in a Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* ── Method Trend Line ──────────────────────────────────────────────── */}
        <div className="bg-claude-surface dark:bg-[#242220] rounded-lg border border-claude-border dark:border-[#3d3832] p-4 chart-container">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold text-claude-text-secondary uppercase tracking-wider">
              Method Trend
            </h4>
            <div className="flex items-center gap-2">
              <ChartExportButton chartName="weekly-method-trend" />
              {/* Trend direction indicators */}
              {['Cryo-EM', 'X-ray', 'NMR'].map(method => (
                <div key={method} className="flex items-center gap-0.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: METHOD_COLORS[method] }} />
                  <TrendArrow values={methodDirections[method]} />
                </div>
              ))}
            </div>
          </div>
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart key="trend-method-line" data={methodTrendData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis
                  dataKey="week"
                  tick={{ fill: tickColor, fontSize: 10 }}
                  axisLine={{ stroke: axisColor }}
                  tickLine={{ stroke: axisColor }}
                />
                <YAxis
                  tick={{ fill: tickColor, fontSize: 10 }}
                  axisLine={{ stroke: axisColor }}
                  tickLine={{ stroke: axisColor }}
                  domain={[0, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip content={<ClaudeChartTooltip isDark={isDark} />} />
                <Line type="monotone" dataKey="Cryo-EM" stroke={METHOD_COLORS['Cryo-EM']} strokeWidth={2} dot={{ r: 3, fill: METHOD_COLORS['Cryo-EM'] }} />
                <Line type="monotone" dataKey="X-ray" stroke={METHOD_COLORS['X-ray']} strokeWidth={2} dot={{ r: 3, fill: METHOD_COLORS['X-ray'] }} />
                <Line type="monotone" dataKey="NMR" stroke={METHOD_COLORS['NMR']} strokeWidth={2} dot={{ r: 3, fill: METHOD_COLORS['NMR'] }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {/* Method legend */}
          <div className="flex items-center justify-center gap-3 mt-2">
            {['Cryo-EM', 'X-ray', 'NMR'].map(method => (
              <div key={method} className="flex items-center gap-1">
                <span className="w-2 h-0.5 rounded" style={{ backgroundColor: METHOD_COLORS[method] }} />
                <span className="text-[10px] text-claude-text-muted">{method}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Resolution Trend (Area) ─────────────────────────────────────────── */}
        <div className="bg-claude-surface dark:bg-[#242220] rounded-lg border border-claude-border dark:border-[#3d3832] p-4 chart-container">
          <h4 className="text-xs font-semibold text-claude-text-secondary mb-3 uppercase tracking-wider">
            Resolution Trend
          </h4>
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart key="trend-resolution-area" data={resolutionTrendData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis
                  dataKey="week"
                  tick={{ fill: tickColor, fontSize: 10 }}
                  axisLine={{ stroke: axisColor }}
                  tickLine={{ stroke: axisColor }}
                />
                <YAxis
                  tick={{ fill: tickColor, fontSize: 10 }}
                  axisLine={{ stroke: axisColor }}
                  tickLine={{ stroke: axisColor }}
                  domain={[0, 'auto']}
                  tickFormatter={(v: number) => `${v}Å`}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0]?.payload;
                    return (
                      <div className="rounded-lg px-3 py-2 text-xs shadow-lg border bg-white dark:bg-[#2b2926] dark:border-[#4a4540] text-claude-text">
                        <div className="font-semibold mb-1 text-[11px]">{label}</div>
                        {d && (
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#16a34a' }} />
                              <span className="text-claude-text-secondary">Min</span>
                              <span className="font-mono ml-auto">{d.min}Å</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#2d8f8f' }} />
                              <span className="text-claude-text-secondary">Avg</span>
                              <span className="font-mono ml-auto">{d.avg}Å</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#dc2626' }} />
                              <span className="text-claude-text-secondary">Max</span>
                              <span className="font-mono ml-auto">{d.max}Å</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                {/* Shaded area between min and max */}
                <Area type="monotone" dataKey="max" stroke="#dc2626" fill="transparent" strokeWidth={1.5} strokeDasharray="4 2" />
                <Area type="monotone" dataKey="avg" stroke="#2d8f8f" fill="#2d8f8f" fillOpacity={0.15} strokeWidth={2} />
                <Area type="monotone" dataKey="min" stroke="#16a34a" fill="transparent" strokeWidth={1.5} strokeDasharray="4 2" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {/* Resolution legend */}
          <div className="flex items-center justify-center gap-3 mt-2">
            <div className="flex items-center gap-1">
              <span className="w-2 h-0.5 rounded border-t border-dashed" style={{ borderColor: '#16a34a' }} />
              <span className="text-[10px] text-claude-text-muted">Min</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2 h-0.5 rounded" style={{ backgroundColor: '#2d8f8f' }} />
              <span className="text-[10px] text-claude-text-muted">Avg</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2 h-0.5 rounded border-t border-dashed" style={{ borderColor: '#dc2626' }} />
              <span className="text-[10px] text-claude-text-muted">Max</span>
            </div>
          </div>
        </div>

        {/* ── IF Distribution Trend (Stacked Area) ───────────────────────────── */}
        <div className="bg-claude-surface dark:bg-[#242220] rounded-lg border border-claude-border dark:border-[#3d3832] p-4 chart-container">
          <h4 className="text-xs font-semibold text-claude-text-secondary mb-3 uppercase tracking-wider">
            IF Tier Trend
          </h4>
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart key="trend-if-stacked" data={ifTrendData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis
                  dataKey="week"
                  tick={{ fill: tickColor, fontSize: 10 }}
                  axisLine={{ stroke: axisColor }}
                  tickLine={{ stroke: axisColor }}
                />
                <YAxis
                  tick={{ fill: tickColor, fontSize: 10 }}
                  axisLine={{ stroke: axisColor }}
                  tickLine={{ stroke: axisColor }}
                  domain={[0, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip content={<ClaudeChartTooltip isDark={isDark} />} />
                <Area type="monotone" dataKey="Top (IF\u226520)" stackId="1" stroke="#dc2626" fill="#dc2626" fillOpacity={0.7} />
                <Area type="monotone" dataKey="High (IF\u226510)" stackId="1" stroke="#ea580c" fill="#ea580c" fillOpacity={0.7} />
                <Area type="monotone" dataKey="Mid (IF\u22655)" stackId="1" stroke="#16a34a" fill="#16a34a" fillOpacity={0.7} />
                <Area type="monotone" dataKey="Low (IF<5)" stackId="1" stroke="#6b7280" fill="#6b7280" fillOpacity={0.7} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {/* IF legend */}
          <div className="flex items-center justify-center gap-2 mt-2 flex-wrap">
            {[
              { label: 'Top', color: '#dc2626' },
              { label: 'High', color: '#ea580c' },
              { label: 'Mid', color: '#16a34a' },
              { label: 'Low', color: '#6b7280' },
            ].map(t => (
              <div key={t.label} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: t.color }} />
                <span className="text-[10px] text-claude-text-muted">{t.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Method Prediction Mini-Widget ──────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2 }}
        className="bg-claude-surface dark:bg-[#242220] rounded-lg border border-claude-border dark:border-[#3d3832] p-4"
      >
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-gradient-to-br from-[#2d8f8f] to-[#1a6b6b] flex-shrink-0">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-xs font-semibold text-claude-text-secondary uppercase tracking-wider mb-1.5">
              Cryo-EM Adoption Prediction
            </h4>
            {prediction.alreadyPassed ? (
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-emerald-500" />
                <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  Cryo-EM has surpassed 50% of weekly structures! ({prediction.currentPct.toFixed(1)}%)
                </span>
              </div>
            ) : prediction.projectedWeek === 'N/A' ? (
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <span className="text-sm text-claude-text-secondary">
                  Cryo-EM adoption is not trending upward based on current data ({prediction.currentPct.toFixed(1)}%)
                </span>
              </div>
            ) : prediction.projectedWeek ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-claude-accent" />
                  <span className="text-sm text-claude-text-secondary">
                    Based on current trends, Cryo-EM is projected to reach 50% by{' '}
                    <span className="font-mono font-semibold text-claude-accent">{prediction.projectedWeek}</span>
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[10px]">
                  <span className="text-claude-text-muted">
                    Current: <span className="font-mono font-medium text-claude-text-secondary">{prediction.currentPct.toFixed(1)}%</span>
                  </span>
                  <span className="text-claude-text-muted">|</span>
                  <div className="flex items-center gap-1">
                    <span className="text-claude-text-muted">Confidence:</span>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider ${
                      prediction.confidence === 'high'
                        ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                        : prediction.confidence === 'medium'
                          ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                          : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                    }`}>
                      {prediction.confidence}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-claude-text-muted" />
                <span className="text-sm text-claude-text-muted">Insufficient data for prediction</span>
              </div>
            )}
          </div>
          {/* Visual progress bar toward 50% */}
          {!prediction.alreadyPassed && prediction.currentPct > 0 && (
            <div className="flex-shrink-0 w-24">
              <div className="h-2 w-full bg-claude-border-light dark:bg-[#2b2926] rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{
                    background: 'linear-gradient(90deg, #2d8f8f, #c96442)',
                  }}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(prediction.currentPct, 100)}%` }}
                  transition={{ duration: 0.8, delay: 0.4 }}
                />
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[8px] text-claude-text-muted font-mono">{prediction.currentPct.toFixed(0)}%</span>
                <span className="text-[8px] text-claude-text-muted font-mono">50%</span>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
