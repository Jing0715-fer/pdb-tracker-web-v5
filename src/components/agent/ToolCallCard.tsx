/**
 * ToolCallCard — renders a tool/call + tool/result pair as a compact card.
 *
 * Shows the tool name, a friendly title, the parsed arguments, and (once the
 * result arrives) the result summary or error. Uses the tool's presentCall
 * card kind to pick an icon + accent color.
 */

'use client';

import { useEffect, useState } from 'react';
import { Loader2, Check, X, Wrench, Box, Ruler, Camera, FlaskConical, AlertCircle, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ConversationNode } from './use-agent-session';

const CARD_META: Record<
  string,
  { icon: typeof Box; accent: string; bg: string }
> = {
  pdb: { icon: Box, accent: 'text-emerald-600', bg: 'bg-emerald-500/10' },
  measure: { icon: Ruler, accent: 'text-sky-600', bg: 'bg-sky-500/10' },
  screenshot: { icon: Camera, accent: 'text-purple-600', bg: 'bg-purple-500/10' },
  analysis: { icon: FlaskConical, accent: 'text-amber-600', bg: 'bg-amber-500/10' },
  generic: { icon: Wrench, accent: 'text-claude-accent', bg: 'bg-claude-accent/10' },
};

export function ToolCallCard({ node }: { node: Extract<ConversationNode, { kind: 'tool-call' }> }) {
  const meta = CARD_META['generic']!;
  const Icon = meta.icon;
  const status = node.status;
  const [copied, setCopied] = useState(false);

  const handleCopyResult = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!node.result) return;
    try {
      const text = typeof node.result === 'string' ? node.result : JSON.stringify(node.result, null, 2);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="flex justify-start">
      <div className="flex items-start gap-2 max-w-[92%]">
        <div
          className={cn(
            'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-claude-border',
            meta.bg,
          )}
        >
          <Icon className={cn('h-3.5 w-3.5', meta.accent)} />
        </div>
        <div className="rounded-2xl rounded-tl-sm border border-claude-border bg-claude-bg-surface overflow-hidden min-w-0 flex-1">
          {/* Header */}
          <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-claude-bg-elevated/50 border-b border-claude-border">
            <div className="flex items-center gap-1.5 min-w-0">
              <code className={cn('text-xs font-semibold truncate', meta.accent)}>
                {node.name}
              </code>
              <span className="text-[10px] text-claude-text-muted truncate">·</span>
              <span className="text-[10px] text-claude-text-muted truncate">
                {describeArgs(node.name, node.args)}
              </span>
            </div>
            <StatusPill status={status} startedAt={node.startedAt} />
          </div>

          {/* Arguments (collapsible if verbose) */}
          {Object.keys(node.args).length > 0 && (
            <details className="group px-3 py-1.5">
              <summary className="cursor-pointer select-none text-[10px] text-claude-text-muted hover:text-claude-text flex items-center gap-1">
                <span className="inline-block transition-transform group-open:rotate-90">▸</span>
                arguments
              </summary>
              <pre className="mt-1 text-[10px] text-claude-text-muted overflow-x-auto rounded bg-claude-bg-base p-2 font-mono leading-relaxed">
                {JSON.stringify(node.args, null, 2)}
              </pre>
            </details>
          )}

          {/* Result */}
          {status === 'ok' && node.result != null && (
            <div className="group/result px-3 py-2 border-t border-claude-border relative">
              <ResultView name={node.name} result={node.result} />
              <button
                onClick={handleCopyResult}
                className="absolute top-1.5 right-1.5 opacity-0 group-hover/result:opacity-100 transition-opacity flex items-center justify-center h-5 w-5 rounded bg-claude-bg-surface border border-claude-border shadow-sm hover:border-claude-accent/50 hover:text-claude-accent text-claude-text-muted"
                title="复制结果"
              >
                {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
              </button>
            </div>
          )}
          {status === 'error' && (
            <div className="px-3 py-2 border-t border-claude-border bg-red-500/5">
              <div className="flex items-start gap-1.5 text-xs text-red-700 dark:text-red-300">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span className="break-words">{node.error ?? 'execution failed'}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status, startedAt }: { status: string; startedAt?: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (status !== 'running' && status !== 'pending') return;
    if (!startedAt) return;
    setElapsed(Date.now() - startedAt);
    const i = setInterval(() => setElapsed(Date.now() - (startedAt ?? Date.now())), 100);
    return () => clearInterval(i);
  }, [status, startedAt]);
  if (status === 'running' || status === 'pending') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-claude-accent shrink-0 font-mono">
        <Loader2 className="h-3 w-3 animate-spin" />
        {status}
        {startedAt && <span className="tabular-nums">{formatElapsed(elapsed)}</span>}
      </span>
    );
  }
  if (status === 'ok') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-emerald-600 shrink-0">
        <Check className="h-3 w-3" />
        ok
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[10px] text-red-600 shrink-0">
      <X className="h-3 w-3" />
      error
    </span>
  );
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

function ResultView({ name, result }: { name: string; result: unknown }) {
  const text =
    typeof result === 'string'
      ? result
      : JSON.stringify(result, null, 2);
  // Keep it readable — cap at ~1500 chars with a "show more".
  const truncated = text.length > 1500;
  return (
    <div className="text-xs">
      <div className="text-[10px] uppercase tracking-wide text-claude-text-muted mb-1">
        result · {name}
      </div>
      <pre className="whitespace-pre-wrap break-words text-claude-text-muted font-mono leading-relaxed text-[10px] max-h-48 overflow-y-auto">
        {truncated ? text.slice(0, 1500) + '\n…(truncated)' : text}
      </pre>
    </div>
  );
}

function describeArgs(name: string, args: Record<string, unknown>): string {
  const keys = Object.keys(args);
  if (keys.length === 0) return '';
  // Pick the most informative argument.
  const id = args.id ?? args.pdbId ?? args.uniprotId ?? args.emdbId;
  if (id) return String(id);
  const recipe = args.recipe;
  if (recipe) {
    const chain = args.chain1 ?? args.chain;
    return chain ? `${recipe} (${chain})` : String(recipe);
  }
  const preset = args.preset ?? args.theme;
  if (preset) return String(preset);
  const compId = args.compId ?? args.ligandCompId;
  if (compId) return String(compId);
  return keys.slice(0, 3).join(', ');
}
