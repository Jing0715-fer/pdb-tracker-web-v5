/**
 * AgentLoop — the turn/step driver.
 *
 * Phase machine: idle | running. A turn opens before its first claim and
 * closes once nothing is owed. A step is one model request + the tools it
 * calls. The loop:
 *   claim input → assemble prompt → llm.stream → append assistant/chunk +
 *   assistant/message → if tool calls: executeToolCalls → append tool/call +
 *   tool/result → next step. Repeat until no tool calls → step/end, turn/end.
 *
 * In this Next.js adaptation, the loop runs ONE step per "drive" invocation
 * (because tool execution for Molstar happens client-side — the server emits
 * tool/call, the client executes + posts results, then the server drives the
 * next step). Server-side tools (pure data fetches) execute inline during the
 * step. The phase machine still holds: running while a step is in flight,
 * idle when waiting on tool results from the client.
 */

import { deepFreeze, newMessageId, type CallId } from './types';
import { BlockAssembler } from './llm/assembler';
import type {
  AssistantMessage,
  ContentBlock,
  GenerateOptions,
  StreamChunk,
  ToolResultBlock,
} from './llm/types';
import type { SessionEvent, TurnEndReason, StepEndReason } from './session/types';
import { Session } from './session';
import { Inbox, type InboxMessage } from './inbox';
import { AgentContext } from './context';
import type { ToolDefinition } from './tools/types';

export type AgentStatus = 'idle' | 'running';

export interface AgentOptions {
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  /** Max steps per turn (safety). */
  maxStepsPerTurn?: number;
}

export interface PendingToolCall {
  callId: CallId;
  name: string;
  arguments: string;
}

/** Result of one drive() — what the caller should do next. */
export type DriveOutcome =
  | { kind: 'done'; finalContent: string; turn: number; steps: number }
  | { kind: 'tool-calls'; turn: number; step: number; calls: PendingToolCall[]; assistantText: string }
  | { kind: 'error'; error: string };

export class AgentLoop {
  readonly ctx: AgentContext;
  readonly session: Session;
  readonly inbox: Inbox;
  readonly options: AgentOptions;
  private status: AgentStatus = 'idle';
  private turn = 0;
  private step = 0;
  private readonly controller = new AbortController();

  constructor(ctx: AgentContext, session: Session, options: AgentOptions) {
    this.ctx = ctx;
    this.session = session;
    this.options = options;
    this.inbox = new Inbox();
    // Default request header logging on first step.
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  /** Send a user follow-up (opens a new turn). */
  followup(content: string): void {
    this.inbox.send(
      {
        content: [{ type: 'text', text: content }],
        inboxKind: 'user',
      },
      'next-turn',
      true,
    );
  }

  /** Steer mid-turn (wakes the next step). */
  steer(content: string): void {
    this.inbox.send(
      {
        content: [{ type: 'text', text: content }],
        inboxKind: 'steering',
      },
      'next-step',
      true,
    );
  }

  /** Inject context (no wake). */
  inject(content: string): void {
    this.inbox.send(
      {
        content: [{ type: 'text', text: content }],
        inboxKind: 'context',
      },
      'next-step',
      false,
    );
  }

  /**
   * Drive one step. If no turn is owed, opens a turn. Returns either a final
   * assistant message (done) or a batch of tool calls for the client to
   * execute. The caller posts tool results back via submitToolResults(), then
   * calls drive() again.
   */
  async drive(): Promise<DriveOutcome> {
    // Detect mid-turn continuation: the last event is a tool/result (the turn
    // is still open, waiting for the next step after the client executed a
    // tool). In that case we drive the next step WITHOUT requiring new inbox
    // input — the tool results ARE the input.
    const lastEvent = this.session.events_[this.session.events_.length - 1];
    const midTurnContinuation = !!lastEvent && lastEvent.type === 'tool/result';

    if (!this.inbox.hasPending && !midTurnContinuation) {
      return { kind: 'done', finalContent: '', turn: this.turn, steps: this.step };
    }

    this.status = 'running';
    this.ctx.emit('agent/status', { sessionId: this.session.id, status: 'running' });

    // Open a turn if the previous one closed (or this is the first).
    const needsTurnStart =
      !lastEvent || lastEvent.type === 'turn/end' || this.turn === 0;
    if (needsTurnStart) {
      this.turn += 1;
      this.step = 0;
      this.session.append('turn/start', { turn: this.turn });
    }

    // Claim input (drain next-step, take one turn-opener).
    const claimed = this.inbox.claim(true);
    if (claimed.length === 0 && !midTurnContinuation) {
      this.session.append('turn/end', { turn: this.turn, reason: { kind: 'completed' } });
      this.setStatusIdle();
      return { kind: 'done', finalContent: '', turn: this.turn, steps: this.step };
    }

    this.step += 1;
    this.session.append('step/start', { turn: this.turn, step: this.step });

    // Append claimed user messages.
    for (const m of claimed) {
      this.session.append('user/message', m, { surfaceOp: { op: 'append' } });
    }

    // Assemble prompt.
    const assembly = this.ctx.systemPrompt.assemble({
      scope: this.session.id,
      signal: this.controller.signal,
    });
    const system = this.ctx.systemPrompt.renderPrompt(assembly);
    const tools = assembly.tools;

    // Log request header (initial on first step of the session).
    const header = {
      provider: this.options.provider,
      model: this.options.model,
      system,
      tools: tools.map((t) => t.name),
      temperature: this.options.temperature,
      maxTokens: this.options.maxTokens,
    };
    const existingHeader = this.session.getRequestHeader();
    if (!existingHeader) {
      this.session.append('request/header', { header, reason: 'initial' });
    } else if (!headersEqual(existingHeader, header)) {
      this.session.append('request/header', { header, reason: 'change' });
    }

    // Build the LLM request.
    const derivedMessages = this.session.deriveMessages();
    const request: GenerateOptions = {
      provider: this.options.provider,
      model: this.options.model,
      messages: derivedMessages,
      system,
      tools,
      temperature: this.options.temperature,
      maxTokens: this.options.maxTokens,
      signal: this.controller.signal,
    };

    // Stream + accumulate.
    const prepared = this.ctx.llm.prepareCall({
      provider: this.options.provider,
      model: this.options.model,
      temperature: this.options.temperature,
      maxTokens: this.options.maxTokens,
    });
    const assembler = new BlockAssembler();
    const chunkSeqs: number[] = [];
    try {
      for await (const chunk of prepared.stream(request)) {
        const ev = this.session.append('assistant/chunk', {
          turn: this.turn,
          step: this.step,
          chunk,
        });
        chunkSeqs.push(ev.seq);
        assembler.push(chunk);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.session.append('turn/end', { turn: this.turn, reason: { kind: 'error', error: msg } });
      this.setStatusIdle();
      return { kind: 'error', error: msg };
    }

    const finish = assembler.finish;
    if (finish.kind === 'error') {
      this.session.append('turn/end', { turn: this.turn, reason: { kind: 'error', error: finish.error } });
      this.setStatusIdle();
      return { kind: 'error', error: finish.error };
    }
    if (finish.kind === 'aborted') {
      this.session.append('turn/end', { turn: this.turn, reason: { kind: 'aborted', reason: finish.reason } });
      this.setStatusIdle();
      return { kind: 'error', error: finish.reason };
    }

    const message = assembler.buildMessage(this.options.provider, this.options.model);
    this.session.append(
      'assistant/message',
      {
        turn: this.turn,
        step: this.step,
        message,
        usage: assembler.usage ?? undefined,
      },
      { surfaceOp: { op: 'append' }, sourceEventSeqs: chunkSeqs },
    );

    // Extract tool calls.
    const toolCalls = message.content.filter(
      (b): b is Extract<ContentBlock, { type: 'tool-call' }> => b.type === 'tool-call',
    );

    // Append tool/call events for each.
    for (const tc of toolCalls) {
      this.session.append('tool/call', {
        turn: this.turn,
        step: this.step,
        callId: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      });
    }

    const assistantText = message.content
      .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const stepEnd: StepEndReason =
      finish.kind === 'max-tokens'
        ? { kind: 'max-tokens' }
        : toolCalls.length === 0
          ? { kind: 'completed' }
          : { kind: 'completed' };

    this.session.append('step/end', { turn: this.turn, step: this.step });

    if (toolCalls.length === 0) {
      // No tool calls — turn is complete.
      const turnEnd: TurnEndReason = { kind: 'completed' };
      this.session.append('turn/end', { turn: this.turn, reason: turnEnd });
      this.setStatusIdle();
      return {
        kind: 'done',
        finalContent: assistantText,
        turn: this.turn,
        steps: this.step,
      };
    }

    // Tool calls pending — return them to the caller (client executes Molstar).
    this.setStatusIdle();
    return {
      kind: 'tool-calls',
      turn: this.turn,
      step: this.step,
      calls: toolCalls.map((tc) => ({ callId: tc.id, name: tc.name, arguments: tc.arguments })),
      assistantText,
    };
  }

  /**
   * Submit tool results from the client (or from inline server-side
   * execution). Appends tool/result events for each, then the caller drives
   * the next step.
   */
  submitToolResults(
    results: Array<{
      callId: CallId;
      name: string;
      ok: boolean;
      result?: unknown;
      error?: string;
      meta?: unknown;
    }>,
  ): void {
    for (const r of results) {
      const content: ContentBlock[] = r.ok
        ? [{ type: 'text', text: JSON.stringify(r.result ?? {}).slice(0, 8000) }]
        : [{ type: 'text', text: r.error || 'Tool execution failed' }];
      const toolResultBlock: ToolResultBlock = {
        type: 'tool-result',
        callId: r.callId,
        content,
        isError: r.ok ? undefined : true,
      };
      const message = deepFreeze({
        id: newMessageId(),
        role: 'assistant' as const,
        content: [toolResultBlock],
        source: { kind: 'tool' as const, callId: r.callId },
      });
      this.session.append(
        'tool/result',
        {
          turn: this.turn,
          step: this.step,
          message,
          error: r.ok
            ? undefined
            : { name: r.name, code: 'execution', message: r.error || 'failed' },
          meta: (r.meta as never) ?? undefined,
        },
        { surfaceOp: { op: 'append' } },
      );
    }
  }

  /** Execute server-side tools inline (pure data fetches, no Molstar). */
  async executeServerSideTools(
    calls: PendingToolCall[],
    serverSideTools: Set<string>,
  ): Promise<{ executed: CallId[]; deferred: PendingToolCall[] }> {
    const executed: CallId[] = [];
    const deferred: PendingToolCall[] = [];
    for (const call of calls) {
      if (!serverSideTools.has(call.name)) {
        deferred.push(call);
        continue;
      }
      const tool = this.ctx.tools.get(call.name);
      if (!tool) {
        this.submitToolResults([
          {
            callId: call.callId,
            name: call.name,
            ok: false,
            error: `Unknown tool: ${call.name}`,
          },
        ]);
        executed.push(call.callId);
        continue;
      }
      let args: unknown;
      try {
        args = JSON.parse(call.arguments || '{}');
      } catch {
        args = {};
      }
      const result = await this.ctx.tools.dispatch(call.name, args, {
        approval: this.ctx.approval,
        preExecute: [],
        postExecute: [],
        guards: [],
        onDeferContext: (msg) => this.inject(msg),
      });
      this.submitToolResults([
        {
          callId: call.callId,
          name: call.name,
          ok: !result.isError,
          result: result.value,
          error: result.isError ? result.error?.message : undefined,
          meta: result.meta,
        },
      ]);
      executed.push(call.callId);
    }
    return { executed, deferred };
  }

  private setStatusIdle(): void {
    this.status = 'idle';
    this.ctx.emit('agent/status', { sessionId: this.session.id, status: 'idle' });
  }

  cancel(reason = 'cancelled'): void {
    this.controller.abort(reason);
    this.inbox.clear();
  }
}

function headersEqual(a: { provider: string; model: string; system?: string; tools?: string[] }, b: { provider: string; model: string; system?: string; tools?: string[] }): boolean {
  if (a.provider !== b.provider || a.model !== b.model) return false;
  if ((a.system ?? '') !== (b.system ?? '')) return false;
  const at = (a.tools ?? []).join(',');
  const bt = (b.tools ?? []).join(',');
  return at === bt;
}

export type { SessionEvent, ToolDefinition, StreamChunk };
