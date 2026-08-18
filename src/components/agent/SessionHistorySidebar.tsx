/**
 * SessionHistorySidebar — a collapsible sidebar listing all persisted agent
 * sessions. Click a session to resume it; click "New" to start a fresh one.
 * Includes a search/filter input that filters sessions by title or id.
 *
 * The sidebar fetches the session list on open and refreshes every 15s.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { History, Plus, MessageSquare, Trash2, X, Loader2, Clock, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { SessionListItem } from './use-agent-session';

interface Props {
  open: boolean;
  onClose: () => void;
  currentSessionId: string | null;
  listSessions: () => Promise<SessionListItem[]>;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete?: (id: string) => Promise<void>;
}

export function SessionHistorySidebar({
  open,
  onClose,
  currentSessionId,
  listSessions,
  onSelect,
  onNew,
  onDelete,
}: Props) {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await listSessions();
      setSessions(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void refresh();
  }, [open, currentSessionId]); // R121: Refresh when session changes

  // Auto-refresh every 15s while open.
  useEffect(() => {
    if (!open) return;
    const i = setInterval(() => void refresh(), 5_000); // R121: Faster refresh
    return () => clearInterval(i);
  }, [open]);

  // Filter sessions by query (title or id). Memoized — recomputed only when
  // sessions or query change.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q),
    );
  }, [sessions, query]);

  if (!open) return null;

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (onDelete) {
      await onDelete(id);
      await refresh();
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
        onClick={onClose}
      />
      {/* Sidebar — fixed so it overlays even if parent has overflow:hidden */}
      <aside className="fixed left-0 top-0 bottom-0 z-50 w-64 bg-claude-bg-surface border-r border-claude-border flex flex-col shadow-xl">
        <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-claude-border bg-claude-bg-elevated/50">
          <div className="flex items-center gap-1.5 min-w-0">
            <History className="h-3.5 w-3.5 text-claude-accent shrink-0" />
            <span className="text-xs font-semibold text-claude-text truncate">会话历史</span>
          </div>
          <button onClick={onClose} className="text-claude-text-muted hover:text-claude-text shrink-0">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="p-2 border-b border-claude-border space-y-2">
          <Button
            size="sm"
            onClick={onNew}
            className="w-full h-7 text-xs bg-claude-accent hover:bg-claude-accent/90 text-white"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            新会话
          </Button>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-claude-text-muted pointer-events-none" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索会话…"
              className="h-7 pl-7 pr-7 text-xs bg-claude-bg-base border-claude-border focus-visible:ring-claude-accent/30"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-claude-text-muted hover:text-claude-text"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-1.5 py-1.5 min-h-0">
          {loading && sessions.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-claude-text-muted text-xs gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              加载中…
            </div>
          ) : filtered.length === 0 ? (
            query ? (
              <div className="flex flex-col items-center justify-center py-8 text-claude-text-muted text-xs gap-2 text-center px-3">
                <Search className="h-5 w-5 opacity-40" />
                <span>未找到匹配 &ldquo;{query}&rdquo; 的会话</span>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-claude-text-muted text-xs gap-2 text-center px-3">
                <MessageSquare className="h-5 w-5 opacity-40" />
                <span>还没有会话记录。<br />点击&ldquo;新会话&rdquo;开始第一次对话。</span>
              </div>
            )
          ) : (
            <ul className="flex flex-col gap-1">
              {filtered.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => onSelect(s.id)}
                    className={cn(
                      'group w-full text-left rounded-md px-2 py-1.5 transition-colors border',
                      s.id === currentSessionId
                        ? 'bg-claude-accent/10 border-claude-accent/40'
                        : 'border-transparent hover:bg-claude-bg-elevated hover:border-claude-border',
                    )}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="text-xs font-medium text-claude-text truncate flex-1 min-w-0">
                        {s.title || 'Untitled'}
                      </span>
                      {onDelete && (
                        <button
                          onClick={(e) => void handleDelete(e, s.id)}
                          className="opacity-0 group-hover:opacity-100 text-claude-text-muted hover:text-red-500 transition-opacity shrink-0"
                          title="删除会话"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-claude-text-muted">
                      <span className="flex items-center gap-0.5">
                        <MessageSquare className="h-2.5 w-2.5" />
                        {s.eventCount}
                      </span>
                      <span className="flex items-center gap-0.5">
                        <Clock className="h-2.5 w-2.5" />
                        {formatRelative(s.updatedAt)}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-3 py-1.5 border-t border-claude-border text-[10px] text-claude-text-muted">
          {query ? `${filtered.length}/${sessions.length}` : sessions.length} 个会话 · 自动保存
        </div>
      </aside>
    </>
  );
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
