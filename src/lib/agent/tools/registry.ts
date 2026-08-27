/**
 * ToolRuntime — the tool registry + execution pipeline.
 *
 * Pipeline (per call):
 *   resolve(name) → pre-execute (waterfall: allow | deny | ask)
 *                → ask ? approval.request : (allow)
 *                → guard (monotonic deny, runs AFTER pre-execute)
 *                → execute (the tool body, with timeout + fused abort signal)
 *                → post-execute (waterfall: accept | block)
 *                → finalizeContent + emit tools/result
 *
 * Results commit in MODEL ORDER (not dispatch order) when dispatched in
 * parallel: a slot's result is appended only when every earlier slot has
 * committed, so tool/call + tool/result stay model-visible-ordered.
 *
 * Monotonic guards: a ToolGuard runs after pre-execute and can ONLY deny — it
 * cannot turn a denial back into permission. Listener ordering cannot weaken
 * security.
 */

import { deepFreeze, newCallId, snapshotJson, type CallId, type Json } from '../types';
import type { ContentBlock } from '../llm/types';
import { ApprovalService } from './approval';
import type {
  PostToolDecision,
  PreToolDecision,
  ToolDefinition,
  ToolExecutionResult,
  ToolRunContext,
} from './types';

export type PreExecuteListener = (
  ctx: ToolRunContext,
  next: () => PreToolDecision | Promise<PreToolDecision>,
) => PreToolDecision | Promise<PreToolDecision>;

export type PostExecuteListener = (
  ctx: ToolRunContext,
  result: ToolExecutionResult,
  next: () => PostToolDecision | Promise<PostToolDecision>,
) => PostToolDecision | Promise<PostToolDecision>;

export type ToolGuard = (ctx: ToolRunContext) => string | null;

export interface DispatchOptions {
  agent?: unknown;
  parentSignal?: AbortSignal;
  approval: ApprovalService;
  preExecute: PreExecuteListener[];
  postExecute: PostExecuteListener[];
  guards: ToolGuard[];
  /** Called when a tool defers context for the next step boundary. */
  onDeferContext?: (message: string) => void;
  /**
   * R165 (AGENT-007): external call id (e.g. the LLM's tool-call id) to use
   * for this dispatch. When omitted an internal id is generated. Threading
   * the external id matters for approvals: ApprovalService.request keys the
   * pending promise by ctx.callId, and the client resolves approvals by the
   * LLM's tool-call id (from approval/asked events + the /approval route) —
   * a mismatch would leave the promise unresolvable.
   */
  callId?: CallId;
}

export class ToolRuntime {
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly restrictions = new Map<string, { allow?: Set<string>; deny?: Set<string> }>();
  private preExecute: PreExecuteListener[] = [];
  private postExecute: PostExecuteListener[] = [];
  private guards: ToolGuard[] = [];
  private approval: ApprovalService = new ApprovalService();

  register(definition: ToolDefinition): () => void {
    this.tools.set(definition.name, definition);
    return () => {
      const cur = this.tools.get(definition.name);
      if (cur === definition) this.tools.delete(definition.name);
    };
  }

  get(name: string): ToolDefinition | undefined {
    const tool = this.tools.get(name);
    if (!tool) return undefined;
    // Apply per-agent restrictions.
    for (const r of this.restrictions.values()) {
      if (r.deny?.has(name)) return undefined;
      if (r.allow && !r.allow.has(name)) return undefined;
    }
    return tool;
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()].filter((t) => this.get(t.name));
  }

  schemas(): ToolDefinition[] {
    return this.list();
  }

  restrict(scope: string, opts: { allow?: string[]; deny?: string[] }): () => void {
    this.restrictions.set(scope, {
      allow: opts.allow ? new Set(opts.allow) : undefined,
      deny: opts.deny ? new Set(opts.deny) : undefined,
    });
    return () => this.restrictions.delete(scope);
  }

  usePreExecute(listener: PreExecuteListener): () => void {
    this.preExecute.push(listener);
    return () => {
      const i = this.preExecute.indexOf(listener);
      if (i >= 0) this.preExecute.splice(i, 1);
    };
  }

  usePostExecute(listener: PostExecuteListener): () => void {
    this.postExecute.push(listener);
    return () => {
      const i = this.postExecute.indexOf(listener);
      if (i >= 0) this.postExecute.splice(i, 1);
    };
  }

  addGuard(guard: ToolGuard): () => void {
    this.guards.push(guard);
    return () => {
      const i = this.guards.indexOf(guard);
      if (i >= 0) this.guards.splice(i, 1);
    };
  }

  setApproval(service: ApprovalService): void {
    this.approval = service;
  }

  getApproval(): ApprovalService {
    return this.approval;
  }

  /** Execute one tool call through the full pipeline. */
  async dispatch(
    name: string,
    args: unknown,
    opts: DispatchOptions,
  ): Promise<ToolExecutionResult> {
    // R165 (AGENT-007): prefer the caller-provided (external) call id.
    const callId = opts.callId ?? newCallId();
    const callerSignal = opts.parentSignal ?? new AbortController().signal;
    const controller = new AbortController();
    // Fuse caller signal + this dispatch's signal.
    const onAbort = () => controller.abort(callerSignal.reason);
    if (callerSignal.aborted) onAbort();
    else callerSignal.addEventListener('abort', onAbort, { once: true });
    try {
      return await this.runDispatch(name, args, opts, callId, controller, callerSignal);
    } finally {
      // R168 (AGENT-M8): detach the abort-bridge listener on EVERY exit
      // path. {once:true} only auto-removed it on an actual abort — on
      // normal completion it stayed attached to the long-lived loop
      // controller forever, so every server-side tool call permanently
      // accumulated one more listener (unbounded growth in long sessions).
      callerSignal.removeEventListener('abort', onAbort);
    }
  }

  /** Inner dispatch pipeline — see dispatch() for the signal plumbing. */
  private async runDispatch(
    name: string,
    args: unknown,
    opts: DispatchOptions,
    callId: CallId,
    controller: AbortController,
    callerSignal: AbortSignal,
  ): Promise<ToolExecutionResult> {
    const deferred: string[] = [];
    let concluded = false;
    const ctx: ToolRunContext = {
      callId,
      name,
      arguments: args,
      signal: controller.signal,
      deferContext: (msg: string) => deferred.push(msg),
      concludeTurn: () => {
        concluded = true;
      },
    };

    const tool = this.get(name);
    if (!tool) {
      return this.errorResult(callId, name, 'ToolNotFoundError', 'not-found', `Unknown tool: ${name}`);
    }
    if (callerSignal.aborted) {
      return this.errorResult(callId, name, 'Aborted', 'aborted', 'Aborted before dispatch');
    }

    // 1. pre-execute waterfall.
    let gate: PreToolDecision = { kind: 'allow' };
    const preListeners = [...opts.preExecute, ...this.preExecute];
    if (preListeners.length) {
      type Next = () => PreToolDecision | Promise<PreToolDecision>;
      const seed: Next = () => Promise.resolve({ kind: 'allow' } as PreToolDecision);
      let chain: Next = seed;
      for (let i = preListeners.length - 1; i >= 0; i--) {
        const listener = preListeners[i]!;
        const next = chain;
        chain = () => listener(ctx, next);
      }
      gate = await chain();
    }

    // 2. ask → approval.
    if (gate.kind === 'ask') {
      const outcome = await opts.approval.request({
        callId,
        toolName: name,
        summary: summarizeArgs(name, args),
        args,
        signal: controller.signal,
      });
      if (outcome === 'allowed-once') {
        gate = { kind: 'allow' };
      } else if (outcome === 'rejected') {
        gate = { kind: 'deny', reason: 'User rejected the tool call' };
      } else {
        gate = { kind: 'deny', reason: `Approval ${outcome}` };
      }
    }

    // 3. guard (monotonic deny, AFTER pre-execute).
    if (gate.kind === 'allow') {
      for (const guard of [...opts.guards, ...this.guards]) {
        const reason = guard(ctx);
        if (reason) {
          gate = { kind: 'deny', reason };
          break;
        }
      }
    }

    if (gate.kind === 'deny') {
      return this.errorResult(callId, name, 'Denied', 'denied', gate.reason);
    }

    // 4. execute (with timeout).
    let value: Json;
    try {
      const execPromise = tool.execute(args, ctx);
      // R168 (AGENT-M8): clear the timer when the tool wins the race (it
      // previously stayed scheduled for timeoutMs) AND abort the tool's
      // controller when the timeout wins (the execution previously kept
      // running in the background against an aborted-intent signal). The
      // losing promise's late rejection is swallowed so it cannot surface
      // as an unhandled rejection.
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeout = tool.timeoutMs
        ? new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
              controller.abort(
                typeof DOMException === 'function'
                  ? new DOMException(`Tool "${name}" timed out after ${tool.timeoutMs}ms`, 'TimeoutError')
                  : new Error(`Tool "${name}" timed out after ${tool.timeoutMs}ms`),
              );
              reject(new Error(`Tool "${name}" timed out after ${tool.timeoutMs}ms`));
            }, tool.timeoutMs);
          })
        : null;
      try {
        value = timeout ? (await Promise.race([execPromise, timeout])) : await execPromise;
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      }
      void Promise.resolve(execPromise).catch(() => undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.errorResult(callId, name, 'ExecutionError', 'execution', msg);
    }

    // 5. post-execute waterfall.
    let result: ToolExecutionResult = {
      isError: false,
      value: snapshotJson(value),
      content: tool.output.render(args, snapshotJson(value)),
      meta: tool.output.presentationMeta?.(args, snapshotJson(value)),
      concludesTurn: concluded ? true : undefined,
    };

    const postListeners = [...opts.postExecute, ...this.postExecute];
    if (postListeners.length) {
      type Next = () => PostToolDecision | Promise<PostToolDecision>;
      const seed: Next = () => Promise.resolve({ kind: 'accept' } as PostToolDecision);
      let chain: Next = seed;
      for (let i = postListeners.length - 1; i >= 0; i--) {
        const listener = postListeners[i]!;
        const next = chain;
        chain = () => listener(ctx, result, next);
      }
      const decision = await chain();
      if (decision.kind === 'block') {
        result = {
          isError: true,
          error: { name: 'Blocked', code: 'blocked', message: decision.feedback },
          content: [{ type: 'text', text: `Error: ${decision.feedback}` }],
        };
      } else if (decision.kind === 'accept') {
        if (decision.content) result.content = decision.content;
        if (decision.value !== undefined) {
          result.value = decision.value;
          result.content = tool.output.render(args, decision.value);
        }
      }
    }

    // 6. finalizeContent.
    if (tool.finalizeContent && !result.isError) {
      result.content = tool.finalizeContent(ctx, result);
    }

    // Flush deferred context.
    if (opts.onDeferContext && deferred.length) {
      for (const msg of deferred) opts.onDeferContext(msg);
    }

    return deepFreeze(result);
  }

  private errorResult(
    callId: CallId,
    name: string,
    errorName: string,
    code: string,
    message: string,
  ): ToolExecutionResult {
    return deepFreeze({
      isError: true,
      error: { name: errorName, code, message },
      content: [{ type: 'text', text: `Error: ${message}` }] as ContentBlock[],
      meta: undefined,
    });
  }
}

function summarizeArgs(name: string, args: unknown): string {
  if (args && typeof args === 'object') {
    const a = args as Record<string, unknown>;
    const id = a.id ?? a.pdbId ?? a.pdb_id;
    if (id) return `${name}(${JSON.stringify(id)})`;
    const recipe = a.recipe;
    if (recipe) return `${name}(${JSON.stringify(recipe)})`;
  }
  return name;
}
