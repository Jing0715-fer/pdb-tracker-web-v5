'use client';

// ─── Chart Color Constants ───────────────────────────────────────────────────

export const METHOD_COLORS: Record<string, string> = {
  'Cryo-EM': '#2d8f8f',
  'X-ray': '#7c5cbf',
  'NMR': '#c9872e',
  'Other': '#6b7280',
};

export const RESOLUTION_RANGES: { label: string; min: number; max: number; color: string }[] = [
  { label: '≤1.5Å', min: 0, max: 1.5, color: '#16a34a' },
  { label: '1.5-2.0Å', min: 1.5, max: 2.0, color: '#2d8f8f' },
  { label: '2.0-2.5Å', min: 2.0, max: 2.5, color: '#7c5cbf' },
  { label: '2.5-3.0Å', min: 2.5, max: 3.0, color: '#c9872e' },
  { label: '3.0-3.5Å', min: 3.0, max: 3.5, color: '#ea580c' },
  { label: '>3.5Å', min: 3.5, max: Infinity, color: '#dc2626' },
];

export const IF_TIER_COLORS: Record<string, string> = {
  top: '#dc2626',
  high: '#ea580c',
  mid: '#16a34a',
  low: '#6b7280',
  unknown: '#9b9590',
};

// ─── Chart Color Helpers (dark-mode aware) ───────────────────────────────────

export function getChartAxisColor(isDark: boolean) { return isDark ? '#9b9590' : '#7c756e'; }
export function getChartTickColor(isDark: boolean) { return isDark ? '#6b6560' : '#9b9590'; }

// ─── Custom Recharts Tooltip Components ──────────────────────────────────────

interface ChartTooltipProps { active?: boolean; payload?: any[]; label?: string; isDark: boolean; }

export function ClaudeChartTooltip({ active, payload, label, isDark }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + p.value, 0);
  return (
    <div className={`rounded-lg px-3 py-2 text-xs shadow-lg border bg-white dark:bg-[#2b2926] dark:border-[#4a4540] text-claude-text`}>
      {label && <div className={`font-semibold mb-1 text-[11px] text-claude-text`}>{label}</div>}
      {payload.map((p: any, i: number) => {
        const pct = total > 0 ? ((p.value / total) * 100).toFixed(1) : '0';
        const name = p.name || p.payload?.name || p.payload?.tier || p.payload?.range || '';
        const color = p.fill || p.payload?.color || '#c4644a';
        return (
          <div key={i} className="flex items-center gap-2 py-0.5">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
            <span className="text-claude-text-secondary">{name}</span>
            <span className={`font-mono font-medium ml-auto text-claude-text`}>{p.value}</span>
            <span className="text-claude-text-muted">({pct}%)</span>
          </div>
        );
      })}
    </div>
  );
}

export function ClaudeTrendTooltip({ active, payload, label, isDark }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className={`rounded-lg px-3 py-2 text-xs shadow-lg border bg-white dark:bg-[#2b2926] dark:border-[#4a4540] text-claude-text`}>
      <div className={`font-semibold mb-0.5 text-[11px] text-claude-text`}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0 bg-claude-accent" />
          <span className="text-claude-text-secondary">{p.dataKey === 'total' ? 'Structures' : p.dataKey}</span>
          <span className={`font-mono font-medium ml-auto text-claude-text`}>{p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function ClaudeResTooltip({ active, payload, isDark }: { active?: boolean; payload?: any[]; isDark: boolean }) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const range = p.payload?.range || '';
  return (
    <div className={`rounded-lg px-3 py-2 text-xs shadow-lg border bg-white dark:bg-[#2b2926] dark:border-[#4a4540] text-claude-text`}>
      <div className={`font-semibold mb-0.5 text-[11px] text-claude-text`}>{range}</div>
      <div className="flex items-center gap-2 py-0.5">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.payload?.color || '#7c5cbf' }} />
        <span className="text-claude-text-secondary">Count</span>
        <span className={`font-mono font-medium ml-auto text-claude-text`}>{p.value}</span>
      </div>
    </div>
  );
}

export function ClaudeScatterTooltip({ active, payload, isDark }: {
  active?: boolean;
  payload?: Array<{ payload?: { pdbId?: string; resolution?: number; journalIf?: number; method?: string; ifTier?: string; title?: string } }>;
  isDark: boolean;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  if (!d) return null;
  const methodLabel = d.method ? (d.method.includes('CRYO') ? 'Cryo-EM' : d.method.includes('X-RAY') ? 'X-ray' : d.method.includes('NMR') ? 'NMR' : 'Other') : '';
  const methodColor = d.method ? (METHOD_COLORS[methodLabel] || METHOD_COLORS['Other']) : METHOD_COLORS['Other'];
  return (
    <div className={`rounded-lg px-3 py-2 text-xs shadow-lg border bg-white dark:bg-[#2b2926] dark:border-[#4a4540] text-claude-text`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`font-mono font-semibold text-[11px] text-claude-accent`}>{d.pdbId}</span>
        {methodLabel && (
          <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-medium" style={{ backgroundColor: methodColor + '20', color: methodColor }}>
            {methodLabel}
          </span>
        )}
      </div>
      {d.title && (
        <p className={`text-[10px] mb-1 line-clamp-2 text-claude-text-secondary`}>{d.title}</p>
      )}
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {d.resolution != null && (
          <div>
            <span className="text-claude-text-muted">Resolution:</span>{' '}
            <span className={`font-mono font-medium`}>{d.resolution?.toFixed(2)}Å</span>
          </div>
        )}
        {d.journalIf != null && (
          <div>
            <span className="text-claude-text-muted">IF:</span>{' '}
            <span className={`font-mono font-medium text-claude-text`}>{d.journalIf?.toFixed(1)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
