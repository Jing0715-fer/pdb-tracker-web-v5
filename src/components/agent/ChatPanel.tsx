/**
 * ChatPanel — the deepseek-harness-inspired agent chat panel.
 *
 * Replaces the legacy molcraft chat-tab. Talks to the new agent API:
 *   POST /api/agent/sessions — create session
 *   GET  /api/agent/sessions/[id]/events — SSE stream of session events
 *   POST /api/agent/sessions/[id]/messages — drive the loop
 *   POST /api/agent/sessions/[id]/tool-results — submit Molstar results
 *   POST /api/agent/sessions/[id]/approval — resolve approvals
 *
 * Renders the session log as conversation nodes: user messages, assistant
 * messages (markdown), tool call/result cards, turn/step boundaries. An
 * ApprovalPanel takes over the input bar when a tool needs approval.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { Send, Loader2, Sparkles, Bot, User, Wrench, Check, X, ChevronRight, Activity, Zap, History, Plus, Copy, Download, Pencil, RotateCw, ThumbsUp, ThumbsDown, Settings, Upload, BarChart3, GitFork, Key } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAppStore } from '@/lib/molcraft/store';
import { useAgentSession, type ConversationNode } from './use-agent-session';
import { ToolCallCard } from './ToolCallCard';
import { ApprovalPanel } from './ApprovalPanel';
import { SessionHistorySidebar } from './SessionHistorySidebar';
import { KeyboardShortcutsDialog, useKeyboardShortcutsDialog } from './KeyboardShortcutsDialog';
import { SessionSettingsPopover } from './SessionSettingsPopover';
import { ToolStatsPopover } from './ToolStatsPopover';
import { ProvidersPanel } from './ProvidersPanel';
import { cn } from '@/lib/utils';

const SUGGESTIONS = [
  {
    icon: '',
    title: 'Analyze complex',
    prompt: 'Load 1CBS and analyze its structure: get metadata, run hydrogen bond and salt bridge analysis on chain A, and summarize the key interactions.',
  },
  {
    icon: '',
    title: 'Active site analysis',
    prompt: 'Load 6LU7 (SARS-CoV-2 Mpro) and analyze the ligand binding pocket — run hydrogen bonds and salt bridges between chain A and the ligand, then focus the camera on the ligand.',
  },
  {
    icon: '',
    title: 'Oligomer analysis',
    prompt: 'Load 4HHB (hemoglobin) and analyze all chain-chain interactions. Set the representation to cartoon with chain coloring.',
  },
  {
    icon: '',
    title: 'Visualize',
    prompt: 'Load 1CBS, set the representation to ball-and-stick, color by element, then focus on residue ARG30.',
  },
];

/**
 * UI-021: defense-in-depth URL filter for markdown rendered from LLM output.
 * react-markdown's default urlTransform already drops javascript: URLs — this
 * makes the allowlist explicit: only absolute http(s), site-relative, and
 * fragment URLs survive; everything else is stripped.
 */
const safeUrlTransform = (url: string) =>
  /^https?:\/\//i.test(url) || url.startsWith('/') || url.startsWith('#') ? url : '';

export function AgentChatPanel() {
  const viewer = useAppStore((s) => s.viewer);
  const session = useAgentSession({ viewer });
  const [input, setInput] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toolStatsOpen, setToolStatsOpen] = useState(false);
  const [providersOpen, setProvidersOpen] = useState(false);
  const shortcutsDialog = useKeyboardShortcutsDialog();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  // Auto-scroll to bottom when new nodes arrive.
  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session.nodes, autoScroll]);

  // Keyboard shortcuts:
  //   Cmd/Ctrl+K       → focus the input
  //   Esc              → close sidebar / blur input
  //   Cmd/Ctrl+Shift+R → regenerate last response (plain Cmd/Ctrl+R keeps
  //                      the browser's refresh behavior)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      // Cmd/Ctrl+K → focus input
      if (mod && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      // UI-018: Cmd/Ctrl+Shift+R → regenerate; plain Cmd/Ctrl+R is left to
      // the browser (page refresh) instead of being hijacked.
      if (mod && e.shiftKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        if (!session.driving) void session.regenerate();
        return;
      }
      // Esc → close sidebar if open, else blur input
      if (e.key === 'Escape') {
        if (historyOpen) {
          setHistoryOpen(false);
          return;
        }
        // UI-005: if a modal dialog is open (e.g. the screenshot zoom
        // overlay, or any shadcn dialog), it owns the Escape key and closes
        // itself — don't blur the chat input underneath it.
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
          return;
        }
        inputRef.current?.blur();
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [session.driving, session.regenerate, historyOpen]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(atBottom);
    setShowScrollToBottom(!atBottom && el.scrollHeight > el.clientHeight + 100);
  };

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      setAutoScroll(true);
      setShowScrollToBottom(false);
    }
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || session.driving) return;
    setInput('');
    void session.sendMessage(text);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // UI-022: refuse oversized session files before reading them into memory.
    if (file.size > 10 * 1024 * 1024) {
      useAppStore.getState().toast('文件过大：会话文件不能超过 10MB', 'error');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const res = await fetch('/api/agent/sessions/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Import failed: ${res.status}`);
      const result = (await res.json()) as { sessionId?: unknown };
      // FE-07 (R172): shape-check the returned id before loading — a malformed
      // response previously fell through to loadSession(undefined).
      if (typeof result.sessionId !== 'string' || !result.sessionId) {
        throw new Error('服务器返回的会话 ID 无效');
      }
      await session.loadSession(result.sessionId);
      useAppStore.getState().toast('会话导入成功', 'success');
    } catch (err) {
      console.error('[import] failed:', err);
      // FE-07 (R172): surface import failures to the user — bad JSON or a 500
      // previously gave zero feedback (compare the analysis-panel importer,
      // which toasts).
      useAppStore.getState().toast(`导入会话失败：${err instanceof Error ? err.message : String(err)}`, 'error');
    }
    // Reset the input so the same file can be re-imported.
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="relative flex flex-col h-full bg-claude-bg-base min-h-0">
      <SessionHistorySidebar
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        currentSessionId={session.sessionId}
        listSessions={session.listSessions}
        onSelect={(id) => {
          void session.loadSession(id);
          setHistoryOpen(false);
        }}
        onNew={async () => {
          await session.startNewSession();
          // R121: Don't close sidebar — keep it open so user sees history
          // The sidebar will auto-refresh when session list changes
          setHistoryOpen(true);
        }}
      />
      {/* Header strip */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-claude-border bg-claude-bg-surface">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className="flex items-center justify-center h-6 w-6 rounded text-claude-text-muted hover:text-claude-accent hover:bg-claude-bg-elevated transition-colors shrink-0"
            title="会话历史"
            aria-label="会话历史"
          >
            <History className="h-3.5 w-3.5" />
          </button>
          <div className="flex items-center gap-1.5 min-w-0 max-w-[120px] sm:max-w-[160px]">
            <Sparkles className="h-3.5 w-3.5 text-claude-accent shrink-0" />
            <span className="text-xs font-semibold text-claude-text truncate" title={session.sessionTitle}>
              {session.sessionTitle || 'DeepSeek Harness Agent'}
            </span>
          </div>
          <Badge
            variant="outline"
            className={cn(
              'h-4 px-1.5 text-[10px] font-normal shrink-0',
              session.sseDead
                ? 'border-red-500/40 text-red-600 bg-red-500/10'
                : session.connected
                  ? 'border-emerald-500/40 text-emerald-600 bg-emerald-500/10'
                  : 'border-amber-500/40 text-amber-600 bg-amber-500/10',
            )}
          >
            <span className={cn('inline-block h-1.5 w-1.5 rounded-full mr-1', session.sseDead ? 'bg-red-500' : session.connected ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse')} />
            {session.sseDead ? 'disconnected' : session.connected ? 'connected' : 'connecting'}
          </Badge>
          {session.sessionId && (
            <span className="text-[10px] text-claude-text-muted font-mono truncate">
              {session.sessionId.slice(0, 8)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-claude-text-muted shrink-0">
          {session.driving && (
            <span className="flex items-center gap-1 text-claude-accent">
              <Activity className="h-3 w-3 animate-pulse" />
              running
            </span>
          )}
          <span className="flex items-center gap-0.5" title={`工具调用次数: ${session.nodes.filter((n) => n.kind === 'tool-call').length}`}>
            <Wrench className="h-3 w-3" />
            {session.nodes.filter((n) => n.kind === 'tool-call').length} tools
          </span>
          {session.tokenUsage.requestCount > 0 && (
            <span
              className="flex items-center gap-0.5"
              title={`Token 使用: prompt ${session.tokenUsage.promptTokens.toLocaleString()} / completion ${session.tokenUsage.completionTokens.toLocaleString()} / 共 ${session.tokenUsage.requestCount} 次请求`}
            >
              <Zap className="h-3 w-3" />
              {formatTokenCount(session.tokenUsage.totalTokens)}
            </span>
          )}
          <button
            onClick={() => void session.startNewSession()}
            disabled={session.driving}
            className="flex items-center gap-0.5 h-5 px-1.5 rounded text-claude-text-muted hover:text-claude-accent hover:bg-claude-bg-elevated transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="新会话"
            aria-label="新会话"
          >
            <Plus className="h-3 w-3" />
          </button>
          {session.sessionId && (
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-0.5 h-5 px-1.5 rounded text-claude-text-muted hover:text-claude-accent hover:bg-claude-bg-elevated transition-colors"
              title="会话设置"
              aria-label="会话设置"
            >
              <Settings className="h-3 w-3" />
            </button>
          )}
          <button
            onClick={() => setProvidersOpen(true)}
            className="flex items-center gap-0.5 h-5 px-1.5 rounded text-claude-text-muted hover:text-claude-accent hover:bg-claude-bg-elevated transition-colors"
            title="供应商配置"
            aria-label="供应商配置"
          >
            <Key className="h-3 w-3" />
          </button>
          {session.sessionId && session.nodes.filter((n) => n.kind === 'tool-call').length > 0 && (
            <button
              onClick={() => setToolStatsOpen(true)}
              className="flex items-center gap-0.5 h-5 px-1.5 rounded text-claude-text-muted hover:text-claude-accent hover:bg-claude-bg-elevated transition-colors"
              title="工具执行统计"
              aria-label="工具执行统计"
            >
              <BarChart3 className="h-3 w-3" />
            </button>
          )}
          {session.sessionId && session.nodes.length > 0 && (
            <a
              href={`/api/agent/sessions/${session.sessionId}/export?format=md`}
              download
              className="flex items-center gap-0.5 h-5 px-1.5 rounded text-claude-text-muted hover:text-claude-accent hover:bg-claude-bg-elevated transition-colors"
              title="导出为 Markdown"
              aria-label="导出为 Markdown"
            >
              <Download className="h-3 w-3" />
            </a>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={session.driving}
            className="flex items-center gap-0.5 h-5 px-1.5 rounded text-claude-text-muted hover:text-claude-accent hover:bg-claude-bg-elevated transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="导入会话 JSON"
            aria-label="导入会话 JSON"
          >
            <Upload className="h-3 w-3" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImportFile}
            className="hidden"
          />
        </div>
      </div>

      {/* Conversation */}
      <div className="relative flex-1 min-h-0">
      <div ref={scrollRef} onScroll={onScroll} className="absolute inset-0 overflow-y-auto px-3 py-3">
        {session.nodes.length === 0 ? (
          <EmptyState onPick={(t) => void session.sendMessage(t)} />
        ) : (
          <div className="flex flex-col gap-3">
            {(() => {
              // Find the last assistant-message seq for the regenerate button.
              let lastAssistantSeq = -1;
              for (let i = session.nodes.length - 1; i >= 0; i--) {
                if (session.nodes[i]!.kind === 'assistant-message') {
                  lastAssistantSeq = session.nodes[i]!.seq;
                  break;
                }
              }
              return session.nodes.map((node) => (
                <NodeRenderer
                  key={node.seq}
                  node={node}
                  onResend={(text) => void session.sendMessage(text)}
                  onRegenerate={() => void session.regenerate()}
                  isLastAssistant={node.seq === lastAssistantSeq}
                  driving={session.driving}
                  feedback={node.kind === 'assistant-message' ? session.feedback.get(node.seq) : undefined}
                  onFeedback={(rating) => void session.recordFeedback(node.seq, rating)}
                  onFork={(seq) => void session.forkFromSeq(seq)}
                />
              ));
            })()}
            {session.driving && (
              <div className="flex items-center gap-2 text-xs text-claude-text-muted px-1">
                <Loader2 className="h-3 w-3 animate-spin text-claude-accent" />
                <span>agent thinking…</span>
              </div>
            )}
          </div>
        )}
      </div>
      {/* Scroll-to-bottom button */}
      {showScrollToBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 h-7 px-3 rounded-full bg-claude-bg-surface border border-claude-border shadow-lg text-xs text-claude-text-muted hover:text-claude-accent hover:border-claude-accent/50 transition-colors"
          title="滚动到底部"
        >
          <ChevronRight className="h-3 w-3 rotate-90" />
          <span>最新消息</span>
        </button>
      )}
      </div>

      {/* UI-010: SSE stream gave up (retry cap / fatal error) — offer a
          refresh instead of an eternally pulsing "connecting" badge. */}
      {session.sseDead && (
        <div
          role="alert"
          className="mx-3 mb-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300"
        >
          <div className="flex items-center justify-between gap-2">
            <span>会话连接丢失（服务器不可达或已重启），实时更新已停止。请刷新页面以恢复。</span>
            <button
              onClick={() => window.location.reload()}
              className="shrink-0 flex items-center gap-1 h-6 px-2 rounded border border-red-500/40 hover:bg-red-500/20 transition-colors"
              title="刷新页面"
            >
              <RotateCw className="h-3 w-3" />
              刷新
            </button>
          </div>
        </div>
      )}

      {/* Error banner */}
      {session.error && (
        <div className="mx-3 mb-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300 max-w-full overflow-hidden">
          <div className="flex items-start justify-between gap-2">
            <span className="break-all line-clamp-4 flex-1 min-w-0">{session.error}</span>
            <button onClick={session.clearError} aria-label="关闭错误提示" className="shrink-0 text-red-500 hover:text-red-700">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Approval panel (composer takeover) */}
      {session.pendingApprovals.length > 0 ? (
        <ApprovalPanel
          approvals={session.pendingApprovals}
          onResolve={session.resolveApproval}
        />
      ) : (
        /* Input bar */
        <div className="border-t border-claude-border bg-claude-bg-surface px-3 py-2">
          <div className="flex items-end gap-2">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="向 DeepSeek Harness agent 提问…  (Enter 发送, Shift+Enter 换行)"
              aria-label="向 DeepSeek Harness agent 提问"
              disabled={session.driving}
              className="min-h-[44px] max-h-32 resize-none text-sm bg-claude-bg-base border-claude-border focus-visible:ring-claude-accent/30"
              rows={1}
            />
            <Button
              size="icon"
              onClick={handleSend}
              aria-label="发送"
              disabled={!input.trim() || session.driving}
              className="h-9 w-9 shrink-0 bg-claude-accent hover:bg-claude-accent/90 text-white"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-[10px] text-claude-text-muted">
              基于会话事件日志的插件式 agent harness
            </span>
            <div className="flex items-center gap-2 text-[10px] text-claude-text-muted">
              <kbd className="px-1 py-0.5 rounded border border-claude-border bg-claude-bg-base font-mono text-[9px]">⌘K</kbd>
              <span className="opacity-60">聚焦</span>
              <kbd className="px-1 py-0.5 rounded border border-claude-border bg-claude-bg-base font-mono text-[9px]">⌘⇧R</kbd>
              <span className="opacity-60">重生成</span>
              <button
                onClick={() => shortcutsDialog.setOpen(true)}
                className="flex items-center justify-center h-4 w-4 rounded border border-claude-border bg-claude-bg-base font-mono text-[9px] hover:border-claude-accent/50 hover:text-claude-accent transition-colors"
                title="快捷键帮助 (?)"
                aria-label="快捷键帮助"
              >
                ?
              </button>
              <span className="font-mono opacity-60">{session.nodes.length} events</span>
            </div>
          </div>
        </div>
      )}
      <KeyboardShortcutsDialog open={shortcutsDialog.open} onClose={() => shortcutsDialog.setOpen(false)} />
      <SessionSettingsPopover sessionId={session.sessionId} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ToolStatsPopover sessionId={session.sessionId} open={toolStatsOpen} onClose={() => setToolStatsOpen(false)} fetchStats={session.getToolStats} />
      <ProvidersPanel open={providersOpen} onClose={() => setProvidersOpen(false)} />
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
      <div className="rounded-full bg-claude-accent-light/40 p-3">
        <Sparkles className="h-5 w-5 text-claude-accent" />
      </div>
      <div>
        <p className="text-xs font-medium text-claude-text">Molcraft AI Agent</p>
        <p className="text-[10px] text-claude-text-muted mt-0.5 leading-relaxed">
          Ask me to analyze structures, run analyses, or change visualizations.
        </p>
      </div>
      <div className="w-full space-y-1 mt-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.title}
            onClick={() => onPick(s.prompt)}
            className="flex w-full items-start gap-2 rounded-md border border-claude-border-light/40 dark:border-claude-border/40 bg-claude-bg/40 dark:bg-claude-bg-elevated/40 px-2 py-1.5 text-left hover:border-claude-accent/40 hover:bg-claude-accent-light/20 transition-colors"
          >
            <span className="text-sm shrink-0">{s.icon}</span>
            <div className="min-w-0">
              <div className="text-[10px] font-medium text-claude-text">{s.title}</div>
              <div className="text-[9px] text-claude-text-muted truncate">{s.prompt}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function NodeRenderer({ node, onResend, onRegenerate, isLastAssistant, driving, feedback, onFeedback, onFork }: { node: ConversationNode; onResend?: (text: string) => void; onRegenerate?: () => void; isLastAssistant?: boolean; driving?: boolean; feedback?: 'up' | 'down'; onFeedback?: (rating: 'up' | 'down') => void; onFork?: (seq: number) => void }) {
  switch (node.kind) {
    case 'user-message':
      return <UserMessageNode key={node.seq} seq={node.seq} text={node.text} onResend={onResend} onFork={onFork} />;
    case 'assistant-message':
      return <AssistantMessageNode key={node.seq} seq={node.seq} text={node.text} reasoning={node.reasoning} onRegenerate={isLastAssistant ? onRegenerate : undefined} driving={driving} feedback={feedback} onFeedback={onFeedback} />;
    case 'streaming-assistant':
      return (
        <div className="flex justify-start animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-start gap-2 max-w-[90%]">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-claude-bg-elevated border border-claude-border text-claude-accent">
              <Bot className="h-3.5 w-3.5" />
            </div>
            <div className="rounded-2xl rounded-tl-sm bg-claude-bg-elevated border border-claude-accent/30 px-3 py-2 text-sm text-claude-text shadow-sm">
              {node.text ? (
                <div className="prose-sm max-w-none whitespace-pre-wrap break-words">
                  {node.text}
                  <StreamingCursor done={node.done} />
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-xs text-claude-text-muted py-0.5">
                  <span className="flex gap-0.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-claude-accent/60 animate-bounce [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-claude-accent/60 animate-bounce [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-claude-accent/60 animate-bounce" />
                  </span>
                  <span>thinking…</span>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    case 'tool-call':
      return <ToolCallCard node={node} />;
    case 'turn-boundary':
      return node.type === 'end' ? (
        <div className="flex items-center gap-2 py-1">
          <div className="h-px flex-1 bg-claude-border" />
          <span className="text-[10px] text-claude-text-muted font-mono">turn {node.turn} · {node.reason ?? 'completed'}</span>
          <div className="h-px flex-1 bg-claude-border" />
        </div>
      ) : null;
    case 'step-boundary':
      // Subtle step markers — hidden to reduce noise, but available for debugging.
      return null;
    default:
      return null;
  }
}

/** An animated cursor shown after streaming text. */
function StreamingCursor({ done }: { done: boolean }) {
  if (done) return null;
  return (
    <span
      className="inline-block w-1.5 h-3.5 ml-0.5 align-text-bottom bg-claude-accent animate-pulse rounded-sm"
      aria-hidden
    />
  );
}

/** Format a token count compactly (e.g. 1234 → "1.2k"). */
function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** User message node with hover edit + re-send + fork actions. */
function UserMessageNode({ seq, text, onResend, onFork }: { seq: number; text: string; onResend?: (text: string) => void; onFork?: (seq: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  const handleSave = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== text && onResend) {
      onResend(trimmed);
    }
    setEditing(false);
  };

  const handleCancel = () => {
    setDraft(text);
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  if (editing) {
    return (
      <div className="flex justify-end">
        <div className="flex items-start gap-2 max-w-[85%]">
          <div className="rounded-2xl rounded-tr-sm bg-claude-bg-surface border-2 border-claude-accent/40 px-2 py-1.5 text-sm min-w-[200px]">
            <Textarea
              aria-label="编辑消息"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              className="min-h-[44px] max-h-32 resize-none text-sm bg-transparent border-0 p-0 focus-visible:ring-0"
              rows={1}
            />
            <div className="flex items-center justify-end gap-1.5 mt-1">
              <button
                onClick={handleCancel}
                className="flex items-center gap-0.5 h-5 px-2 rounded text-[10px] text-claude-text-muted hover:text-claude-text hover:bg-claude-bg-elevated transition-colors"
              >
                <X className="h-3 w-3" />
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={!draft.trim() || draft.trim() === text}
                className="flex items-center gap-0.5 h-5 px-2 rounded text-[10px] bg-claude-accent text-white hover:bg-claude-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send className="h-3 w-3" />
                重发
              </button>
            </div>
          </div>
          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-claude-accent text-white">
            <User className="h-3.5 w-3.5" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex flex-col items-end animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-start gap-2 max-w-[85%]">
        <div className="relative rounded-2xl rounded-tr-sm bg-claude-accent text-white px-3 py-2 text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-claude-accent text-white">
          <User className="h-3.5 w-3.5" />
        </div>
      </div>
      {/* R144: Action bar — always visible inline below the message (not floating/absolute).
          Previously used opacity-40 group-hover:opacity-100 + absolute -bottom-2.5
          which was hard to see and could overlap other messages. */}
      {(onFork || onResend) && (
        <div className="flex items-center gap-1 mt-1 mr-8">
          {onFork && (
            <button
              onClick={() => onFork(seq)}
              className="flex items-center justify-center h-5 w-5 rounded-full text-claude-text-muted hover:text-claude-accent hover:bg-claude-accent/10 transition-colors"
              title="从此处分叉对话"
              aria-label="从此处分叉对话"
            >
              <GitFork className="h-3 w-3" />
            </button>
          )}
          {onResend && (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center justify-center h-5 w-5 rounded-full text-claude-text-muted hover:text-claude-accent hover:bg-claude-accent/10 transition-colors"
              title="编辑并重发"
              aria-label="编辑并重发"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Assistant message node with hover copy + regenerate + feedback actions. */
function AssistantMessageNode({ seq, text, reasoning, onRegenerate, driving, feedback, onFeedback }: { seq: number; text: string; reasoning?: string; onRegenerate?: () => void; driving?: boolean; feedback?: 'up' | 'down'; onFeedback?: (rating: 'up' | 'down') => void }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked */
    }
  };
  return (
    <div className="group flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-start gap-2 max-w-[90%]">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-claude-bg-elevated border border-claude-border text-claude-accent">
          <Bot className="h-3.5 w-3.5" />
        </div>
        <div className="rounded-2xl rounded-tl-sm bg-claude-bg-elevated border border-claude-border px-3 py-2 text-sm text-claude-text">
          {text ? (
            <div className="prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeUrlTransform}>{text}</ReactMarkdown>
            </div>
          ) : (
            <span className="text-claude-text-muted italic text-xs">(调用工具中…)</span>
          )}
          {reasoning && (
            <details className="mt-1.5 text-xs text-claude-text-muted">
              <summary className="cursor-pointer select-none">推理过程</summary>
              <div className="mt-1 whitespace-pre-wrap opacity-80">{reasoning}</div>
            </details>
          )}
        </div>
      </div>
      {/* R144: Action bar — always visible inline below the message (not floating/absolute).
          Previously used opacity-40 group-hover:opacity-100 + absolute -bottom-2.5
          which was hard to see and could overlap other messages. */}
      {text && (onFeedback || onRegenerate) && (
        <div className="flex items-center gap-0.5 mt-1 ml-8">
          {onFeedback && (
            <>
              <button
                onClick={() => onFeedback('up')}
                disabled={driving}
                className={cn(
                  'flex items-center justify-center h-5 w-5 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                  feedback === 'up'
                    ? 'text-emerald-600 bg-emerald-500/10'
                    : 'text-claude-text-muted hover:text-emerald-600 hover:bg-emerald-500/10',
                )}
                title="有帮助"
                aria-label="有帮助"
              >
                <ThumbsUp className="h-3 w-3" />
              </button>
              <button
                onClick={() => onFeedback('down')}
                disabled={driving}
                className={cn(
                  'flex items-center justify-center h-5 w-5 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                  feedback === 'down'
                    ? 'text-red-600 bg-red-500/10'
                    : 'text-claude-text-muted hover:text-red-600 hover:bg-red-500/10',
                )}
                title="无帮助"
                aria-label="无帮助"
              >
                <ThumbsDown className="h-3 w-3" />
              </button>
              <div className="w-px h-3 bg-claude-border mx-1" />
            </>
          )}
          {onRegenerate && (
            <button
              onClick={onRegenerate}
              disabled={driving}
              className="flex items-center justify-center h-5 w-5 rounded-full text-claude-text-muted hover:text-claude-accent hover:bg-claude-accent/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="重新生成 (⌘⇧R)"
              aria-label="重新生成 (⌘⇧R)"
            >
              <RotateCw className="h-3 w-3" />
            </button>
          )}
          <button
            onClick={handleCopy}
            className="flex items-center justify-center h-5 w-5 rounded-full text-claude-text-muted hover:text-claude-accent hover:bg-claude-accent/10 transition-colors"
            title="复制消息"
            aria-label="复制消息"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
      )}
    </div>
  );
}
