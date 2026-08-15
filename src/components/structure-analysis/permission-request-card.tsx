'use client';

/**
 * PermissionRequestCard — Inline card shown in chat when a tool requires
 * user approval before execution.
 *
 * The card listens to `tool-permission-request` window events (dispatched by
 * the permissionStore) and renders Approve / Deny / Always-Approve buttons.
 * When the user clicks a button, it calls `permissionStore.respond()` which
 * resolves the pending Promise in the agent loop.
 */

import { useEffect, useState } from 'react';
import { permissionStore, type PermissionRequest, type PermissionDecision } from '@/lib/molcraft/permission';
import { ShieldCheck, ShieldX, ShieldPlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function PermissionRequestCard() {
  const [requests, setRequests] = useState<PermissionRequest[]>([]);

  useEffect(() => {
    // Sync pending requests from the store
    const sync = () => setRequests(permissionStore.getPending());
    sync();

    const handleRequest = () => sync();
    const handleResponse = () => sync();

    if (typeof window !== 'undefined') {
      window.addEventListener('tool-permission-request', handleRequest);
      window.addEventListener('tool-permission-response', handleResponse);
    }

    // Poll every 500ms as a fallback (the event might fire before listener attaches)
    const interval = setInterval(sync, 500);

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('tool-permission-request', handleRequest);
        window.removeEventListener('tool-permission-response', handleResponse);
      }
      clearInterval(interval);
    };
  }, []);

  const respond = (req: PermissionRequest, decision: PermissionDecision) => {
    permissionStore.respond({ requestId: req.id, decision });
    setRequests((prev) => prev.filter((r) => r.id !== req.id));
  };

  if (requests.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      {requests.map((req) => (
        <Card key={req.id} className="border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 shadow-sm">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-start gap-2 mb-2">
              <div className="mt-0.5 flex-shrink-0 p-1.5 rounded-full bg-amber-100 dark:bg-amber-900/50">
                <ShieldCheck className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                    需要权限确认
                  </span>
                  <Badge variant="outline" className="text-[10px] h-5 border-amber-400 text-amber-700 dark:text-amber-300">
                    {req.toolName}
                  </Badge>
                </div>
                <p className="text-sm text-amber-800 dark:text-amber-300 break-words">
                  {req.summary}
                </p>
                {Object.keys(req.arguments).length > 0 && (
                  <details className="mt-2 group">
                    <summary className="text-xs text-amber-700 dark:text-amber-400 cursor-pointer hover:underline select-none">
                      查看参数
                    </summary>
                    <pre className="mt-1 text-[11px] bg-amber-100/50 dark:bg-amber-900/30 rounded p-2 overflow-x-auto max-h-32">
                      {JSON.stringify(req.arguments, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <Button
                size="sm"
                variant="default"
                className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => respond(req, 'approve')}
              >
                <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                批准
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-emerald-500 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
                onClick={() => respond(req, 'approve_always')}
              >
                <ShieldPlus className="h-3.5 w-3.5 mr-1" />
                本次会话自动批准
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-red-400 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                onClick={() => respond(req, 'deny')}
              >
                <ShieldX className="h-3.5 w-3.5 mr-1" />
                拒绝
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Compact inline permission prompt (used inside a single chat message bubble) */
export function InlinePermissionPrompt({
  request,
  onRespond,
}: {
  request: PermissionRequest;
  onRespond: (decision: PermissionDecision) => void;
}) {
  return (
    <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 shadow-sm my-2">
      <CardContent className="p-3">
        <div className="flex items-start gap-2 mb-2">
          <div className="mt-0.5 flex-shrink-0 p-1 rounded-full bg-amber-100 dark:bg-amber-900/50">
            <ShieldCheck className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <span className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                需要确认
              </span>
              <Badge variant="outline" className="text-[9px] h-4 px-1 border-amber-400 text-amber-700 dark:text-amber-300">
                {request.toolName}
              </Badge>
            </div>
            <p className="text-xs text-amber-800 dark:text-amber-300 break-words">
              {request.summary}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
            onClick={() => onRespond('approve')}
          >
            <ShieldCheck className="h-3 w-3 mr-1" />
            批准
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-emerald-500 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300"
            onClick={() => onRespond('approve_always')}
          >
            <ShieldPlus className="h-3 w-3 mr-1" />
            自动
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-red-400 text-red-600 hover:bg-red-50 dark:text-red-400"
            onClick={() => onRespond('deny')}
          >
            <ShieldX className="h-3 w-3 mr-1" />
            拒绝
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
