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
import { Send, Loader2, Sparkles, Bot, User, Wrench, Check, X, ChevronRight, Activity, Zap, History, Plus, Copy, Download, Pencil } from 'lucide-react';
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
import { cn } from '@/lib/utils';

const SUGGESTIONS = [
  { label: '加载 4HHB', text: '请加载 PDB 结构 4HHB 并分析其氢键相互作用' },
  { label: '加载 6LU7', text: '加载 6LU7 (SARS-CoV-2 主蛋白酶) 并查看与配体的相互作用' },
  { label: '分析口袋', text: '加载 1CBS 然后运行 binding_pocket 分析' },
  { label: '截图', text: '加载 4HHB 后从多个角度截图' },
];

export function AgentChatPanel() {
  const viewer = useAppStore((s) => s.viewer);
  const session = useAgentSession({ viewer });
  const [input, setInput] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll to bottom when new nodes arrive.
  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session.nodes, autoScroll]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(atBottom);
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || session.driving) return;
    setInput('');
    void session.sendMessage(text);
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
          setHistoryOpen(false);
        }}
      />
      {/* Header strip */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-claude-border bg-claude-bg-surface">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className="flex items-center justify-center h-6 w-6 rounded text-claude-text-muted hover:text-claude-accent hover:bg-claude-bg-elevated transition-colors shrink-0"
            title="会话历史"
          >
            <History className="h-3.5 w-3.5" />
          </button>
          <div className="flex items-center gap-1.5 shrink-0 min-w-0">
            <Sparkles className="h-3.5 w-3.5 text-claude-accent shrink-0" />
            <span className="text-xs font-semibold text-claude-text truncate" title={session.sessionTitle}>
              {session.sessionTitle || 'DeepSeek Harness Agent'}
            </span>
          </div>
          <Badge
            variant="outline"
            className={cn(
              'h-4 px-1.5 text-[10px] font-normal shrink-0',
              session.connected
                ? 'border-emerald-500/40 text-emerald-600 bg-emerald-500/10'
                : 'border-amber-500/40 text-amber-600 bg-amber-500/10',
            )}
          >
            <span className={cn('inline-block h-1.5 w-1.5 rounded-full mr-1', session.connected ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse')} />
            {session.connected ? 'connected' : 'connecting'}
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
          >
            <Plus className="h-3 w-3" />
          </button>
          {session.sessionId && session.nodes.length > 0 && (
            <a
              href={`/api/agent/sessions/${session.sessionId}/export?format=md`}
              download
              className="flex items-center gap-0.5 h-5 px-1.5 rounded text-claude-text-muted hover:text-claude-accent hover:bg-claude-bg-elevated transition-colors"
              title="导出为 Markdown"
            >
              <Download className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      {/* Conversation */}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 py-3 min-h-0">
        {session.nodes.length === 0 ? (
          <EmptyState onPick={(t) => void session.sendMessage(t)} />
        ) : (
          <div className="flex flex-col gap-3">
            {session.nodes.map((node) => (
              <NodeRenderer key={node.seq} node={node} onResend={(text) => void session.sendMessage(text)} />
            ))}
            {session.driving && (
              <div className="flex items-center gap-2 text-xs text-claude-text-muted px-1">
                <Loader2 className="h-3 w-3 animate-spin text-claude-accent" />
                <span>agent thinking…</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Error banner */}
      {session.error && (
        <div className="mx-3 mb-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          <div className="flex items-start justify-between gap-2">
            <span className="break-words">{session.error}</span>
            <button onClick={session.clearError} className="shrink-0 text-red-500 hover:text-red-700">
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
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="向 DeepSeek Harness agent 提问…  (Enter 发送, Shift+Enter 换行)"
              disabled={session.driving}
              className="min-h-[44px] max-h-32 resize-none text-sm bg-claude-bg-base border-claude-border focus-visible:ring-claude-accent/30"
              rows={1}
            />
            <Button
              size="icon"
              onClick={handleSend}
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
            <span className="text-[10px] text-claude-text-muted font-mono">
              {session.nodes.length} events
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-4 py-8">
      <div className="flex items-center gap-2 text-claude-accent">
        <Sparkles className="h-6 w-6" />
        <span className="text-sm font-semibold">DeepSeek Harness Agent</span>
      </div>
      <p className="text-xs text-claude-text-muted max-w-xs">
        一个受 DeepSeek Harness 架构启发的 agent 子系统：append-only 会话事件日志、
        turn/step agent loop、工具注册表 + 执行管道 + 权限网关、LLM 适配器接口。
        所有 agent 活动通过工具注册表进行。
      </p>
      <div className="flex flex-col gap-1.5 w-full max-w-xs">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            onClick={() => onPick(s.text)}
            className="group flex items-center gap-2 rounded-md border border-claude-border bg-claude-bg-surface px-3 py-2 text-left text-xs hover:border-claude-accent/50 hover:bg-claude-accent/5 transition-colors"
          >
            <ChevronRight className="h-3 w-3 text-claude-text-muted group-hover:text-claude-accent shrink-0" />
            <span className="text-claude-text">{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function NodeRenderer({ node, onResend }: { node: ConversationNode; onResend?: (text: string) => void }) {
  switch (node.kind) {
    case 'user-message':
      return <UserMessageNode key={node.seq} text={node.text} onResend={onResend} />;
    case 'assistant-message':
      return <AssistantMessageNode key={node.seq} text={node.text} reasoning={node.reasoning} />;
    case 'streaming-assistant':
      return (
        <div className="flex justify-start">
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

/** User message node with hover edit + re-send action. */
function UserMessageNode({ text, onResend }: { text: string; onResend?: (text: string) => void }) {
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
    <div className="group flex justify-end">
      <div className="flex items-start gap-2 max-w-[85%]">
        <div className="relative rounded-2xl rounded-tr-sm bg-claude-accent text-white px-3 py-2 text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          {onResend && (
            <button
              onClick={() => setEditing(true)}
              className="absolute -bottom-2 -left-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center h-5 w-5 rounded-full bg-claude-bg-surface border border-claude-border shadow-sm hover:border-claude-accent/50 hover:text-claude-accent text-claude-text-muted"
              title="编辑并重发"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-claude-accent text-white">
          <User className="h-3.5 w-3.5" />
        </div>
      </div>
    </div>
  );
}

/** Assistant message node with hover copy action. */
function AssistantMessageNode({ text, reasoning }: { text: string; reasoning?: string }) {
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
    <div className="group flex justify-start">
      <div className="flex items-start gap-2 max-w-[90%]">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-claude-bg-elevated border border-claude-border text-claude-accent">
          <Bot className="h-3.5 w-3.5" />
        </div>
        <div className="relative rounded-2xl rounded-tl-sm bg-claude-bg-elevated border border-claude-border px-3 py-2 text-sm text-claude-text">
          {text ? (
            <div className="prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
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
          {text && (
            <button
              onClick={handleCopy}
              className="absolute -bottom-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center h-5 w-5 rounded-full bg-claude-bg-surface border border-claude-border shadow-sm hover:border-claude-accent/50 hover:text-claude-accent text-claude-text-muted"
              title="复制消息"
            >
              {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
