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
import { PROVIDER_CATALOG } from './providers/catalog';
import { isProviderAvailable, getProviderConfig } from './providers/credentials';
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

    // Read the latest per-session settings BEFORE the step guard so
    // maxStepsPerTurn is honored.
    const settings = this.extractSettings();
    const maxSteps = settings.maxStepsPerTurn ?? this.options.maxStepsPerTurn ?? 10;

    // Step guard: if we've hit the max steps for this turn, stop.
    if (this.step >= maxSteps) {
      this.session.append('turn/end', {
        turn: this.turn,
        reason: { kind: 'interrupted' },
      });
      this.setStatusIdle();
      return {
        kind: 'done',
        finalContent: '(达到最大步数限制，已停止)',
        turn: this.turn,
        steps: this.step,
      };
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
    let system = this.ctx.systemPrompt.renderPrompt(assembly);
    // Override system prompt if the user set one in settings.
    if (settings.systemPromptOverride?.trim()) {
      system = settings.systemPromptOverride.trim();
    }
    const tools = assembly.tools;

    // Resolve the effective provider + model from settings.
    // Priority: explicit providerId in settings → model-based lookup → default.
    const effectiveModel = settings.model ?? this.options.model;
    const effectiveProvider = settings.providerId ?? this.resolveProvider(effectiveModel);
    // R117: Log the resolved provider for debugging
    console.log(`[agent-loop] Provider: ${effectiveProvider} | Model: ${effectiveModel} | settings.providerId: ${settings.providerId ?? 'none'} | settings.model: ${settings.model ?? 'none'}`);

    // Log request header (initial on first step of the session).
    const header = {
      provider: effectiveProvider,
      model: effectiveModel,
      system,
      tools: tools.map((t) => t.name),
      temperature: settings.temperature ?? this.options.temperature,
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
      provider: effectiveProvider,
      model: effectiveModel,
      messages: derivedMessages,
      system,
      tools,
      temperature: settings.temperature ?? this.options.temperature,
      maxTokens: this.options.maxTokens,
      signal: this.controller.signal,
    };

    // Stream + accumulate.
    const prepared = this.ctx.llm.prepareCall({
      provider: effectiveProvider,
      model: effectiveModel,
      temperature: settings.temperature ?? this.options.temperature,
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

    // R137 (code-review): Simplified — max-tokens propagates, otherwise completed.
    const stepEnd: StepEndReason =
      finish.kind === 'max-tokens'
        ? { kind: 'max-tokens' }
        : { kind: 'completed' };

    this.session.append('step/end', { turn: this.turn, step: this.step, reason: stepEnd });

    if (toolCalls.length === 0) {
      // No tool calls — turn is complete.
      // R137 (code-review): Preserve the max-tokens reason instead of
      // always reporting 'completed'. When the model hit maxTokens without
      // emitting a finish_reason of 'stop', the turn was truncated and the
      // user deserves to see that in the turn-end reason.
      const turnEnd: TurnEndReason = finish.kind === 'max-tokens'
        ? { kind: 'max-tokens' }
        : { kind: 'completed' };
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
      // For screenshot results (capture_multi_angle, capture_snapshot),
      // the dataUri fields are large base64 strings. Don't truncate them —
      // the full data is needed for the UI to render images.
      // Use a larger limit (2MB) for these, normal limit (8000) for others.
      const isScreenshot = r.name === 'capture_multi_angle' || r.name === 'capture_snapshot' || r.name === 'recapture_screenshot';
      // R128: For screenshot results, DON'T send the actual base64 data URIs
      // to the LLM — they're huge (2MB each) and blow up the context window.
      // The LLM can't see images via tool results anyway. Just send a summary.
      // The full data is still stored in the session events for the UI.
      let resultToSend = r.result;
      if (isScreenshot && r.ok && resultToSend) {
        try {
          const parsed = typeof resultToSend === 'string' ? JSON.parse(resultToSend) : JSON.parse(JSON.stringify(resultToSend));
          // Strip dataUri from screenshots — replace with placeholder
          if (parsed?.data?.screenshots && Array.isArray(parsed.data.screenshots)) {
            const angles = parsed.data.screenshots.map((s: any) => s.angle || s.label || 'unknown');
            parsed.data.screenshots = parsed.data.screenshots.map((s: any) => ({
              angle: s.angle || '',
              label: s.label || '',
              dataUri: `[image data omitted — ${s.angle || s.label || 'screenshot'}]`,
            }));
            parsed.detail = `Captured ${angles.length} screenshots (${angles.join(', ')})`;
          }
          resultToSend = parsed;
        } catch { /* keep original if parsing fails */ }
      }
      const maxLen = isScreenshot ? 500 : 3000; // R128: Screenshots only need 500 chars (no image data)
      // R126: For pdb_analyze, strip the raw interaction list to keep only summary
      if (r.name === 'pdb_analyze' && r.ok && resultToSend) {
        try {
          const parsed = typeof resultToSend === 'string' ? JSON.parse(resultToSend) : resultToSend;
          const analysisData = parsed?.analysisResult?.data?.data || parsed?.analysisResult?.data || parsed?.data;
          if (analysisData) {
            // Keep only summary fields, not the full interaction list
            const summary: Record<string, unknown> = {};
            for (const key of ['total', 'hbonds', 'salt_bridges', 'hydrophobic', 'chain1', 'chain2', 'ligand', 'recipe']) {
              if (analysisData[key] !== undefined) summary[key] = analysisData[key];
            }
            // Include only top 5 interactions (not all 17+)
            if (Array.isArray(analysisData.interactions)) {
              summary.interactions = analysisData.interactions.slice(0, 5).map((i: any) => ({
                type: i.type, chain1: i.chain1, resno1: i.resno1, resname1: i.resname1,
                chain2: i.chain2, resno2: i.resno2, resname2: i.resname2,
                distance_A: i.distance_A,
              }));
              summary.total_interactions = analysisData.interactions.length;
            }
            // Replace the full data with the summary
            if (parsed?.analysisResult?.data?.data) {
              parsed.analysisResult.data.data = summary;
            } else if (parsed?.analysisResult?.data) {
              parsed.analysisResult.data = summary;
            }
            resultToSend = parsed;
          }
        } catch { /* keep original if parsing fails */ }
      }
      const content: ContentBlock[] = r.ok
        ? [{ type: 'text', text: JSON.stringify(resultToSend ?? {}).slice(0, maxLen) }]
        : [{ type: 'text', text: (r.error || 'Tool execution failed').slice(0, 500) }]; // R126: Truncate error too
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
        parentSignal: this.controller.signal,
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

  /**
   * Resolve which provider to use for a given model.
   * Checks if any configured provider's model list contains the model id,
   * or if a provider's defaultModel override matches.
   * Falls back to this.options.provider (default: 'zai').
   */
  private resolveProvider(modelId: string): string {
    for (const profile of PROVIDER_CATALOG) {
      // Check if the model is in the provider's catalog
      if (profile.models.some((m) => m.id === modelId)) {
        // Check if this provider is available (has API key or is zai)
        if (isProviderAvailable(profile.id)) {
          return profile.id;
        }
      }
      // Check if a provider has a custom defaultModel override matching
      const config = getProviderConfig(profile.id);
      if (config.defaultModel === modelId && isProviderAvailable(profile.id)) {
        return profile.id;
      }
    }
    return this.options.provider;
  }

  /** Read the latest per-session settings from the event log. */
  private extractSettings(): {
    model?: string;
    providerId?: string;
    temperature?: number;
    maxStepsPerTurn?: number;
    systemPromptOverride?: string;
  } {
    const events = this.session.events_;
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i]!;
      if (ev.type === ('session/settings' as string)) {
        return ev.data as {
          model?: string;
          providerId?: string;
          temperature?: number;
          maxStepsPerTurn?: number;
          systemPromptOverride?: string;
        };
      }
    }
    return {};
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
