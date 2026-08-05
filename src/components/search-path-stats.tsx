'use client';

import { useMemo } from 'react';

interface SearchPathStatsProps {
  pathACount: number;
  pathBCount: number;
  pathCCount: number;
  finalCount: number;
  totalCandidates: number;
  methodStats?: Record<string, number>;
  durationMs?: number;
  pubmedSaved?: number;
  locale?: 'zh' | 'en';
}

const PATH_CONFIG = [
  {
    key: 'A',
    labelZh: 'Path A · MeSH + 方法关键词',
    labelEn: 'Path A · MeSH + method keywords',
    color: 'sky',
    descZh: '基于 MeSH 词表 + 结构生物学方法关键词，按出版日期窗口检索',
    descEn: 'MeSH terms + structural-biology method keywords, filtered by publication date window',
  },
  {
    key: 'B',
    labelZh: 'Path B · 高 IF 期刊 + 方法关键词',
    labelEn: 'Path B · High-IF journals + method keywords',
    color: 'amber',
    descZh: '限定 Nature/Science/Cell 等顶级期刊，方法关键词过滤',
    descEn: 'Restricted to top journals (Nature/Science/Cell…), method keyword filter',
  },
  {
    key: 'C',
    labelZh: 'Path C · 方法关键词 + MeSH 索引日期',
    labelEn: 'Path C · Method keywords + MeSH indexing date',
    color: 'emerald',
    descZh: '前瞻式检索：从目标日期到 3000 年的 MeSH 索引日期，捕捉新索引文献',
    descEn: 'Forward-looking: MeSH indexing date from target date to year 3000, catches newly-indexed papers',
  },
] as const;

const COLOR_MAP: Record<string, { bg: string; text: string; border: string; bar: string; dot: string }> = {
  sky:     { bg: 'bg-sky-50 dark:bg-sky-950/40',     text: 'text-sky-700 dark:text-sky-300',     border: 'border-sky-200 dark:border-sky-800',     bar: 'bg-sky-500',     dot: 'bg-sky-500' },
  amber:   { bg: 'bg-amber-50 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-200 dark:border-amber-800', bar: 'bg-amber-500',   dot: 'bg-amber-500' },
  emerald: { bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-200 dark:border-emerald-800', bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
};

export function SearchPathStats({
  pathACount, pathBCount, pathCCount, finalCount, totalCandidates, methodStats, durationMs, pubmedSaved, locale = 'zh',
}: SearchPathStatsProps) {
  const counts = { A: pathACount, B: pathBCount, C: pathCCount };
  const rawTotal = pathACount + pathBCount + pathCCount;
  const dedupCount = rawTotal - totalCandidates;

  const maxCount = Math.max(pathACount, pathBCount, pathCCount, 1);

  const methodEntries = useMemo(() => {
    if (!methodStats) return [];
    return Object.entries(methodStats)
      .filter(([, c]) => c > 0)
      .sort(([, a], [, b]) => b - a);
  }, [methodStats]);

  const totalMethods = methodEntries.reduce((s, [, c]) => s + c, 0);

  return (
    <div className="mt-3 rounded-lg border border-border/60 bg-card/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/40 bg-muted/30">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <span className="text-xs font-semibold text-foreground">
            {locale === 'zh' ? 'PubMed 三通路检索统计' : 'PubMed Triple-Path Search Statistics'}
          </span>
        </div>
        {durationMs != null && (
          <span className="text-[10px] font-mono text-muted-foreground">
            {locale === 'zh' ? `${(durationMs / 1000).toFixed(1)}秒` : `${(durationMs / 1000).toFixed(1)}s`}
          </span>
        )}
      </div>

      {/* Path breakdown bars */}
      <div className="p-4 space-y-3">
        {PATH_CONFIG.map((p) => {
          const c = counts[p.key as 'A' | 'B' | 'C'];
          const pct = maxCount > 0 ? (c / maxCount) * 100 : 0;
          const sharePct = rawTotal > 0 ? (c / rawTotal) * 100 : 0;
          const colors = COLOR_MAP[p.color];
          return (
            <div key={p.key} className={`rounded-md border ${colors.border} ${colors.bg} p-2.5`}>
              <div className="flex items-baseline justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${colors.dot}`} />
                  <span className={`text-xs font-medium ${colors.text}`}>
                    {locale === 'zh' ? p.labelZh : p.labelEn}
                  </span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className={`text-lg font-bold tabular-nums ${colors.text}`}>{c}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {locale === 'zh' ? '篇' : 'hits'}
                  </span>
                </div>
              </div>
              {/* Bar */}
              <div className="h-1.5 rounded-full bg-background/60 overflow-hidden">
                <div
                  className={`h-full ${colors.bar} rounded-full transition-all duration-500 ease-out`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-muted-foreground leading-tight">
                  {locale === 'zh' ? p.descZh : p.descEn}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {sharePct.toFixed(0)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary row */}
      <div className="px-4 py-2.5 border-t border-border/40 bg-muted/20 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
        <div>
          <div className="text-base font-bold tabular-nums text-foreground">{rawTotal}</div>
          <div className="text-[10px] text-muted-foreground">{locale === 'zh' ? '原始命中' : 'Raw hits'}</div>
        </div>
        <div>
          <div className="text-base font-bold tabular-nums text-muted-foreground">−{dedupCount}</div>
          <div className="text-[10px] text-muted-foreground">{locale === 'zh' ? '去重' : 'Dedup'}</div>
        </div>
        <div>
          <div className="text-base font-bold tabular-nums text-foreground">{totalCandidates}</div>
          <div className="text-[10px] text-muted-foreground">{locale === 'zh' ? '候选' : 'Candidates'}</div>
        </div>
        <div>
          <div className="text-base font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{pubmedSaved ?? finalCount}</div>
          <div className="text-[10px] text-muted-foreground">{locale === 'zh' ? '入库' : 'Saved'}</div>
        </div>
      </div>

      {/* Method distribution */}
      {methodEntries.length > 0 && (
        <div className="px-4 py-2.5 border-t border-border/40 bg-muted/20">
          <div className="text-[10px] font-medium text-muted-foreground mb-1.5">
            {locale === 'zh' ? '方法分布' : 'Method distribution'}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {methodEntries.map(([m, c]) => {
              const pct = totalMethods > 0 ? (c / totalMethods) * 100 : 0;
              return (
                <span
                  key={m}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-background/80 border border-border/60"
                  title={`${m}: ${c} (${pct.toFixed(0)}%)`}
                >
                  <span className="text-muted-foreground">{m}</span>
                  <span className="font-bold text-foreground">{c}</span>
                  <span className="text-muted-foreground">{pct.toFixed(0)}%</span>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
