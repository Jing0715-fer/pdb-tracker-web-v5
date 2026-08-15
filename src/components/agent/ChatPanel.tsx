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
import { Send, Loader2, Sparkles, Bot, User, Wrench, Check, X, ChevronRight, Activity, Zap } from 'lucide-react';
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
    <div className="flex flex-col h-full bg-claude-bg-base min-h-0">
      {/* Header strip */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-claude-border bg-claude-bg-surface">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5 shrink-0">
            <Sparkles className="h-3.5 w-3.5 text-claude-accent" />
            <span className="text-xs font-semibold text-claude-text">DeepSeek Harness Agent</span>
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
          <span className="flex items-center gap-0.5">
            <Wrench className="h-3 w-3" />
            {session.nodes.filter((n) => n.kind === 'tool-call').length} tools
          </span>
        </div>
      </div>

      {/* Conversation */}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 py-3 min-h-0">
        {session.nodes.length === 0 ? (
          <EmptyState onPick={(t) => void session.sendMessage(t)} />
        ) : (
          <div className="flex flex-col gap-3">
            {session.nodes.map((node) => (
              <NodeRenderer key={node.seq} node={node} />
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

function NodeRenderer({ node }: { node: ConversationNode }) {
  switch (node.kind) {
    case 'user-message':
      return (
        <div className="flex justify-end">
          <div className="flex items-start gap-2 max-w-[85%]">
            <div className="rounded-2xl rounded-tr-sm bg-claude-accent text-white px-3 py-2 text-sm">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{node.text}</ReactMarkdown>
            </div>
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-claude-accent text-white">
              <User className="h-3.5 w-3.5" />
            </div>
          </div>
        </div>
      );
    case 'assistant-message':
      return (
        <div className="flex justify-start">
          <div className="flex items-start gap-2 max-w-[90%]">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-claude-bg-elevated border border-claude-border text-claude-accent">
              <Bot className="h-3.5 w-3.5" />
            </div>
            <div className="rounded-2xl rounded-tl-sm bg-claude-bg-elevated border border-claude-border px-3 py-2 text-sm text-claude-text">
              {node.text ? (
                <div className="prose-sm max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{node.text}</ReactMarkdown>
                </div>
              ) : (
                <span className="text-claude-text-muted italic text-xs">(调用工具中…)</span>
              )}
              {node.reasoning && (
                <details className="mt-1.5 text-xs text-claude-text-muted">
                  <summary className="cursor-pointer select-none">推理过程</summary>
                  <div className="mt-1 whitespace-pre-wrap opacity-80">{node.reasoning}</div>
                </details>
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
