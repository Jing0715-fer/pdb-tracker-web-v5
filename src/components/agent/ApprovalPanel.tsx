/**
 * ApprovalPanel — composer-takeover shown when a tool requires approval.
 *
 * Replaces the input bar while one or more approval/asked requests are pending.
 * Shows the tool name, a friendly justification summary, the raw args, and an
 * Allow-once / Reject action row. One-shot latch: buttons disable after click.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { ShieldAlert, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PendingApproval } from './use-agent-session';

export function ApprovalPanel({
  approvals,
  onResolve,
}: {
  approvals: PendingApproval[];
  onResolve: (callId: string, decision: 'allowed-once' | 'rejected' | 'cancelled') => void;
}) {
  return (
    <div className="border-t border-amber-500/40 bg-amber-500/5 px-3 py-2 space-y-2">
      {approvals.map((a) => (
        <ApprovalRow key={a.callId} approval={a} onResolve={onResolve} />
      ))}
    </div>
  );
}

function ApprovalRow({
  approval,
  onResolve,
}: {
  approval: PendingApproval;
  onResolve: (callId: string, decision: 'allowed-once' | 'rejected' | 'cancelled') => void;
}) {
  const [decided, setDecided] = useState<'allowed-once' | 'rejected' | null>(null);
  const allowRef = useRef<HTMLButtonElement>(null);

  // UI-017: the approval prompt takes over the composer when it appears —
  // autofocus the primary (Allow) action so keyboard users land on it
  // instead of tabbing through the page to find the panel.
  useEffect(() => {
    allowRef.current?.focus();
  }, []);

  const handle = (decision: 'allowed-once' | 'rejected') => {
    if (decided) return;
    setDecided(decision);
    onResolve(approval.callId, decision);
  };

  return (
    <div className={cn('rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2', decided && 'opacity-60')}>
      <div className="flex items-start gap-2">
        <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
              权限请求
            </span>
            <code className="text-[11px] font-mono text-amber-700 dark:text-amber-300 bg-amber-500/20 px-1.5 py-0.5 rounded">
              {approval.toolName}
            </code>
          </div>
          <p className="mt-1 text-[11px] text-amber-700/80 dark:text-amber-200/80">
            {approval.summary} — 该工具需要您明确批准后才能执行。
          </p>
          {(() => {
            const args = approval.args as Record<string, unknown> | null;
            if (!args || typeof args !== 'object' || Object.keys(args).length === 0) return null;
            return (
              <pre className="mt-1.5 text-[10px] text-amber-700/70 dark:text-amber-200/70 bg-amber-500/10 rounded p-1.5 font-mono overflow-x-auto">
                {JSON.stringify(args, null, 2)}
              </pre>
            );
          })()}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={decided !== null}
          onClick={() => handle('rejected')}
          className="h-7 px-2.5 text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-500/20"
        >
          <X className="h-3.5 w-3.5 mr-1" />
          拒绝
        </Button>
        <Button
          ref={allowRef}
          size="sm"
          disabled={decided !== null}
          onClick={() => handle('allowed-once')}
          className="h-7 px-2.5 text-xs bg-amber-600 hover:bg-amber-700 text-white"
        >
          <Check className="h-3.5 w-3.5 mr-1" />
          {decided === 'allowed-once' ? '已批准' : '批准一次'}
        </Button>
      </div>
    </div>
  );
}
