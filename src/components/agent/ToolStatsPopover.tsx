/**
 * ToolStatsPopover — a popover showing per-tool execution statistics for the
 * current session: call count, success/error counts, success rate bar.
 *
 * Fetches from GET /api/agent/sessions/[id]/tool-stats on open.
 */

'use client';

import { useEffect, useState } from 'react';
import { BarChart3, X, Loader2, Check, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ToolStat {
  name: string;
  callCount: number;
  successCount: number;
  errorCount: number;
  successRate: number;
}

interface Props {
  sessionId: string | null;
  open: boolean;
  onClose: () => void;
  fetchStats: () => Promise<ToolStat[]>;
}

export function ToolStatsPopover({ sessionId, open, onClose, fetchStats }: Props) {
  const [stats, setStats] = useState<ToolStat[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !sessionId) return;
    setLoading(true);
    fetchStats()
      .then(setStats)
      .catch(() => setStats([]))
      .finally(() => setLoading(false));
  }, [open, sessionId, fetchStats]);

  if (!open) return null;

  const totalCalls = stats.reduce((sum, s) => sum + s.callCount, 0);
  const totalSuccess = stats.reduce((sum, s) => sum + s.successCount, 0);
  const totalError = stats.reduce((sum, s) => sum + s.errorCount, 0);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-[1px]" onClick={onClose}>
      <div
        className="w-80 max-h-[70vh] rounded-lg border border-claude-border bg-claude-bg-surface shadow-xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-claude-border bg-claude-bg-elevated/50 shrink-0">
          <div className="flex items-center gap-1.5">
            <BarChart3 className="h-3.5 w-3.5 text-claude-accent" />
            <span className="text-xs font-semibold text-claude-text">工具执行统计</span>
          </div>
          <button onClick={onClose} className="text-claude-text-muted hover:text-claude-text">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Summary */}
        <div className="px-3 py-2 border-b border-claude-border bg-claude-bg-elevated/30 shrink-0">
          <div className="flex items-center gap-3 text-[10px] text-claude-text-muted">
            <span>共 <strong className="text-claude-text">{totalCalls}</strong> 次调用</span>
            <span className="flex items-center gap-0.5 text-emerald-600">
              <Check className="h-2.5 w-2.5" />
              {totalSuccess}
            </span>
            {totalError > 0 && (
              <span className="flex items-center gap-0.5 text-red-600">
                <AlertCircle className="h-2.5 w-2.5" />
                {totalError}
              </span>
            )}
          </div>
        </div>

        {/* Stats list */}
        <div className="flex-1 overflow-y-auto p-2 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-claude-text-muted text-xs gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              加载中…
            </div>
          ) : stats.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-claude-text-muted text-xs gap-2 text-center">
              <BarChart3 className="h-5 w-5 opacity-40" />
              <span>还没有工具调用记录。<br />开始对话后这里会显示统计。</span>
            </div>
          ) : (
            <ul className="flex flex-col gap-1">
              {stats.map((s) => (
                <li
                  key={s.name}
                  className="rounded-md border border-claude-border bg-claude-bg-base px-2.5 py-1.5"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <code className="text-[11px] font-semibold text-claude-text truncate">{s.name}</code>
                    <span className="text-[10px] text-claude-text-muted shrink-0 tabular-nums">
                      {s.callCount} 次
                    </span>
                  </div>
                  {/* Success rate bar */}
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 h-1.5 rounded-full bg-claude-bg-elevated overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          s.successRate >= 0.8 ? 'bg-emerald-500' : s.successRate >= 0.5 ? 'bg-amber-500' : 'bg-red-500',
                        )}
                        style={{ width: `${s.successRate * 100}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-claude-text-muted tabular-nums w-8 text-right">
                      {Math.round(s.successRate * 100)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-[9px] text-claude-text-muted">
                    <span className="text-emerald-600">✓ {s.successCount}</span>
                    {s.errorCount > 0 && <span className="text-red-600">✗ {s.errorCount}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
