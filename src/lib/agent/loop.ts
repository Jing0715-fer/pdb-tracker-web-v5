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

import { deepFreeze, newMessageId, type CallId, type Seq } from './types';
import { truncateMarked } from './truncate';
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
// R164 (AGENT-001): used in drive() to emit approval/asked events for
// approval-required tools so the client UI + tool-results gate both
// see the approval decision.
import { requiresApproval, SCREENSHOT_TOOLS } from './pdb-tools';
import { extractSessionSettings } from './session/settings';

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
  // R169 (AGENT-L1): last logged provider/model — suppresses repeat logs.
  private lastLoggedProvider: string | null = null;
  private lastLoggedModel: string | null = null;

  constructor(ctx: AgentContext, session: Session, options: AgentOptions) {
    this.ctx = ctx;
    this.session = session;
    this.options = options;
    this.inbox = new Inbox();
    // R168 (AGENT-M2): rehydrate turn/step from the session log. A fresh loop
    // over a RESUMED session previously started at turn=0/step=0, so
    // needsTurnStart's `this.turn === 0` clause always fired and appended a
    // DUPLICATE turn/start {turn:1} even when the log already had turns 1..N
    // (and mid-turn, right after a tool/result) — colliding turn numbers and
    // mislabeled turn/step metadata corrupted UI grouping and the audit trail.
    // Session reconstructs these from the event log (see Session constructor).
    this.turn = session.turn;
    this.step = session.step;
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
    );
  }

  /**
   * R164 (AGENT-003): Regenerate — re-send the last user message but mark it
   * with surfaceOp.replace so the loop, when it appends this claimed message,
   * drops the previous assistant turn + tool results from the model-visible
   * surface (while preserving them in the durable event log for audit).
   */
  followupWithReplace(content: string, replaceStart: Seq, replaceEnd: Seq): void {
    this.inbox.send(
      {
        content: [{ type: 'text', text: content }],
        inboxKind: 'user',
        surfaceOp: { op: 'replace', start: replaceStart, end: replaceEnd },
      },
      'next-turn',
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
    );
  }

  /**
   * Drive one step. If no turn is owed, opens a turn. Returns either a final
   * assistant message (done) or a batch of tool calls for the client to
   * execute. The caller posts tool results back via submitToolResults(), then
   * calls drive() again.
   */
  async drive(): Promise<DriveOutcome> {
    // R164 (AGENT-004): Orphan tool-call recovery. When the client drops
    // mid-turn (network loss, page close, user navigates away), the server
    // persists `tool/call` events (loop.ts:317-323) but no `tool/result`
    // ever follows. The next drive() previously saw lastEvent.type !==
    // 'tool/result' → midTurnContinuation=false → returned done, leaving
    // the surface with an assistant message containing `tool_calls`
    // blocks but NO matching tool-result messages — a wire-format
    // contract violation that breaks the next LLM call (OpenAI/ZAI both
    // require every assistant tool_calls message to be followed by tool
    // messages for each call_id, returning 400 otherwise).
    //
    // Fix: at drive() entry, walk the surface for any assistant/message
    // whose tool-call callIds have no matching tool/result event, and
    // synthesize tool/result events with `error: 'client did not return
    // result (session recovered)'` for each orphan callId. Also close
    // the orphaned turn with turn/end { kind: 'interrupted' } so the new
    // user message opens a fresh turn.
    this.recoverOrphanedToolCalls();

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
    // R164 (AGENT-003): honor an optional surfaceOp carried on the inbox
    // message (used by regenerate to drop the previous assistant turn).
    for (const m of claimed) {
      const { surfaceOp: carriedOp, ...msgWithoutOp } = m;
      this.session.append('user/message', msgWithoutOp, {
        surfaceOp: carriedOp ?? { op: 'append' },
      });
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
    // R169 (AGENT-L1): the R117 provider log fired on EVERY step of EVERY
    // session. Log only when the resolved provider/model pair CHANGES from
    // the previous request — the useful signal, without the noise.
    if (effectiveProvider !== this.lastLoggedProvider || effectiveModel !== this.lastLoggedModel) {
      console.log(`[agent-loop] Provider: ${effectiveProvider} | Model: ${effectiveModel} | settings.providerId: ${settings.providerId ?? 'none'} | settings.model: ${settings.model ?? 'none'}`);
      this.lastLoggedProvider = effectiveProvider;
      this.lastLoggedModel = effectiveModel;
    }

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
    // R164 (AGENT-005): retry the LLM stream on 429 / transient network
    // errors with 5s / 15s / 45s backoff (mirroring the VLM route's
    // schedule). Previously a single 429 from GLM-4.6 killed the whole
    // turn — the legacy /api/llm/agent/round route had a 2-retry 5s·2^n
    // backoff, but the new agent path had zero retries.
    const prepared = this.ctx.llm.prepareCall({
      provider: effectiveProvider,
      model: effectiveModel,
      temperature: settings.temperature ?? this.options.temperature,
      maxTokens: this.options.maxTokens,
    });
    let assembler = new BlockAssembler();
    let chunkSeqs: number[] = [];
    const LLM_BACKOFF_SCHEDULE_MS = [5_000, 15_000, 45_000];
    const isRateLimitError = (err: unknown): boolean => {
      const e = err as { status?: number; statusCode?: number; message?: string; code?: number };
      if (e?.status === 429 || e?.statusCode === 429 || e?.code === 429) return true;
      const msg = String(e?.message ?? '');
      return /429|rate.?limit|too many requests/i.test(msg);
    };
    const isTransientError = (err: unknown): boolean => {
      const msg = String((err as { message?: string })?.message ?? '');
      return /timeout|etimedout|econnreset|econnrefused|socket hang up|network|fetch failed|aborted/i.test(msg);
    };
    try {
      let attempt = 0;
      while (true) {
        // Check abort BEFORE each attempt — if the user cancelled the
        // session or the controller aborted, stop retrying.
        if (this.controller.signal.aborted) {
          throw new DOMException('Agent loop aborted', 'AbortError');
        }
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
          break; // success — exit retry loop
        } catch (err) {
          // If the abort signal fired during streaming, don't retry.
          if (this.controller.signal.aborted) throw err;
          const retryable = isRateLimitError(err) || isTransientError(err);
          if (!retryable || attempt >= LLM_BACKOFF_SCHEDULE_MS.length) {
            // Non-retryable or schedule exhausted — rethrow to outer catch.
            throw err;
          }
          const baseMs = LLM_BACKOFF_SCHEDULE_MS[attempt]!;
          // R164 (VLM-008 mirror): jitter by 0-500ms so concurrent
          // sessions retrying in lockstep don't thundering-herd the LLM.
          const waitMs = baseMs + Math.floor(Math.random() * 500);
          console.warn(
            `[agent-loop] LLM stream attempt ${attempt + 1} failed ` +
            `(${isRateLimitError(err) ? '429 rate limit' : 'transient error'}) — ` +
            `retrying in ${(waitMs / 1000).toFixed(1)}s ` +
            `(${LLM_BACKOFF_SCHEDULE_MS.length - attempt} retries left). error: ${err instanceof Error ? err.message : String(err)}`,
          );
          // R164: reset the assembler + chunkSeqs so the retry's chunks
          // don't concatenate with the failed attempt's partial chunks
          // (which would produce garbled assistant/message content).
          // The old chunk events stay in the durable log for audit but
          // are NOT surface-eligible, so the LLM never sees them.
          assembler = new BlockAssembler();
          chunkSeqs = [];
          // Interruptible sleep — if abort fires during the wait, exit
          // immediately instead of waiting the full backoff.
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(() => {
              this.controller.signal.removeEventListener('abort', onAbort);
              resolve();
            }, waitMs);
            const onAbort = () => {
              clearTimeout(t);
              reject(new DOMException('Agent loop aborted during backoff', 'AbortError'));
            };
            this.controller.signal.addEventListener('abort', onAbort, { once: true });
          }).catch((e) => {
            // If the abort fired during the sleep, re-throw to the outer
            // catch block so turn/end { kind: 'aborted' } is emitted.
            throw e;
          });
          attempt += 1;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isAborted = (err as { name?: string })?.name === 'AbortError' || this.controller.signal.aborted;
      this.session.append('turn/end', {
        turn: this.turn,
        reason: isAborted
          ? { kind: 'aborted', reason: msg }
          : { kind: 'error', error: msg },
      });
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

    // R164 (AGENT-008): use the effective provider/model resolved from
    // per-session settings, not the constructor-time options. Previously
    // switching provider mid-session mis-attributed the assistant message
    // source (loop.ts:269 used this.options.provider instead of the
    // effectiveProvider resolved at lines 197-200). This broke the audit
    // trail and downstream provider-aware logic.
    const message = assembler.buildMessage(effectiveProvider, effectiveModel);
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
    // R164 (AGENT-001): for approval-required tools (export_snapshot,
    // clear_chat — client-side tools), also append an `approval/asked`
    // event so the client UI can render the ApprovalPanel from the
    // session event stream (not just from the drive() return value).
    // Without this, resumed sessions don't see the pending approval
    // (the ApprovalPanel only renders from live drive() tool-calls,
    // not from replayed events).
    for (const tc of toolCalls) {
      this.session.append('tool/call', {
        turn: this.turn,
        step: this.step,
        callId: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      });
      if (requiresApproval(tc.name)) {
        this.session.append('approval/asked', {
          callId: tc.id as CallId,
          toolName: tc.name,
          summary: `Tool ${tc.name} requires approval before execution`,
        });
      }
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
      // R165 (UI-003): screenshot results (capture_multi_angle,
      // capture_snapshot, recapture_screenshot) are persisted UNSTRIPPED —
      // the full data URIs must survive in the tool/result event so resumed
      // sessions can render the images (the client's in-memory executionsRef
      // is lost on reload; previously the R128 stripping replaced every
      // dataUri with "[image data omitted — front]", which broke <img src>
      // after a resume). The LLM never sees the base64 payloads: the
      // SurfaceManager replaces long data URIs with placeholders when
      // projecting the model-visible history (session/surface.ts).
      const isScreenshot = SCREENSHOT_TOOLS.has(r.name); // R169 (AGENT-L7): single source of truth
      let resultToSend = r.result;
      let maxLen = 3000;
      // R126: For pdb_analyze, strip the raw interaction list to keep only summary
      if (r.name === 'pdb_analyze' && r.ok && resultToSend) {
        try {
          const parsed = typeof resultToSend === 'string' ? JSON.parse(resultToSend) : resultToSend;
          const analysisData = parsed?.analysisResult?.data?.data || parsed?.analysisResult?.data || parsed?.data;
          if (analysisData) {
            // Keep only summary fields, not the full interaction list
            const summary: Record<string, unknown> = {};
            for (const key of ['total', 'hbonds', 'salt_bridges', 'hydrophobic', 'chain1', 'chain2', 'ligand', 'recipe',
              // R161: pairwise_interactions summary fields
              'n_chains', 'chains', 'n_pairs', 'n_contact_pairs', 'significant_pairs', 'best_pair', 'note', 'intra_chain']) {
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
            // R161: For pairwise_interactions, include a compact per-pair summary
            // so the LLM can report on EVERY chain pair (this is the whole point
            // of the recipe — the LLM must see per-pair counts).
            if (Array.isArray(analysisData.pairs)) {
              summary.pairs = analysisData.pairs.map((p: any) => ({
                chain1: p.chain1, chain2: p.chain2,
                in_contact: p.in_contact, intra_chain: p.intra_chain,
                total: p.total, salt_bridges: p.salt_bridges,
                hbonds: p.hbonds, hydrophobic: p.hydrophobic,
                min_distance_A: p.min_distance_A,
                top_interactions: Array.isArray(p.interactions)
                  ? p.interactions.slice(0, 3).map((i: any) => ({
                      type: i.type, resname1: i.resname1, resno1: i.resno1,
                      resname2: i.resname2, resno2: i.resno2,
                      chain1: i.chain1, chain2: i.chain2, distance_A: i.distance_A,
                    }))
                  : [],
              }));
            }
            // R161: Tell the LLM screenshots are automatic — prevents it from
            // calling capture_multi_angle again and duplicating the capture.
            summary._screenshot_note = 'Multi-angle screenshots + VLM quality check are running automatically in the background. Do NOT call capture_multi_angle / recapture_screenshot for this analysis.';
            // Replace the full data with the summary
            if (parsed?.analysisResult?.data?.data) {
              parsed.analysisResult.data.data = summary;
            } else if (parsed?.analysisResult?.data) {
              parsed.analysisResult.data = summary;
            }
            resultToSend = parsed;
            // R161: pairwise summaries carry per-pair data — allow more chars
            if (Array.isArray(analysisData.pairs)) {
              maxLen = Math.max(maxLen, 12000);
            }
          }
        } catch { /* keep original if parsing fails */ }
      }
      const content: ContentBlock[] = r.ok
        ? [{
            type: 'text',
            // R165 (UI-003): screenshot results are NOT length-truncated at
            // this layer — truncation for the LLM happens in
            // SurfaceManager.deriveMessages (data-URI placeholders), so the
            // persisted event keeps the full image payload.
            text: isScreenshot
              ? JSON.stringify(resultToSend ?? {})
              // R169 (AGENT-L6): marked truncation — the LLM now sees an
              // explicit …(truncated) suffix instead of silently cut JSON.
              : truncateMarked(JSON.stringify(resultToSend ?? {}), maxLen),
          }]
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
        // R165 (AGENT-007): thread the LLM's tool-call id through dispatch so
        // a hypothetical approval-required server-side tool would key its
        // pending approval promise by the SAME id the client sees in the
        // approval/asked event / uses on the /approval route.
        callId: call.callId,
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
   * R164 (AGENT-004): Recover from orphaned tool/call events.
   *
   * When the client drops mid-turn (network loss, page close, user
   * navigates away), the server persists `tool/call` events but no
   * `tool/result` ever follows. The next LLM call sees the assistant
   * message with `tool_calls` blocks but no matching tool messages →
   * 400 "messages with tool_calls must be followed by tool messages".
   *
   * This method walks the event log, collects all `tool/call` callIds
   * with no matching `tool/result`, and synthesizes a `tool/result`
   * event for each with `error: 'client did not return result
   * (session recovered)'`. If any orphans were recovered, also closes
   * the orphaned turn with `turn/end { kind: 'interrupted' }` so the
   * next drive() opens a fresh turn for the new user message.
   *
   * Idempotent — safe to call on every drive(). No-op if no orphans.
   */
  private recoverOrphanedToolCalls(): void {
    const events = this.session.events_;
    if (events.length === 0) return;

    // Collect all callIds that already have a tool/result event.
    const resolvedCallIds = new Set<string>();
    // Collect all (callId, name, turn, step) tuples from tool/call events.
    const toolCallTuples: Array<{ callId: string; name: string; turn: number; step: number }> = [];
    for (const ev of events) {
      if (ev.type === 'tool/result') {
        const data = ev.data as { message?: { content?: Array<{ callId?: string }> } };
        // The tool-result message's content[0].callId is the canonical id.
        const callId = data.message?.content?.[0]?.callId;
        if (callId) resolvedCallIds.add(callId);
      } else if (ev.type === 'tool/call') {
        const data = ev.data as { callId: string; name: string; turn: number; step: number };
        toolCallTuples.push({
          callId: data.callId,
          name: data.name,
          turn: data.turn,
          step: data.step,
        });
      }
    }

    // Find orphans = toolCallTuples whose callId is not in resolvedCallIds.
    // Also: a callId may appear in multiple tool/call events if the LLM
    // called the same tool twice with the same id (rare but possible).
    // The recovery synthesizes ONE tool/result per orphaned callId.
    const seenOrphans = new Set<string>();
    const orphans = toolCallTuples.filter((t) => {
      if (resolvedCallIds.has(t.callId)) return false;
      if (seenOrphans.has(t.callId)) return false;
      seenOrphans.add(t.callId);
      return true;
    });

    if (orphans.length === 0) return;

    console.warn(
      `[agent-loop] R164 (AGENT-004): recovering ${orphans.length} orphaned tool/call event(s) ` +
      `— synthesizing tool/result with error for each. orphans: ${orphans.map((o) => o.name + ':' + o.callId).join(', ')}`,
    );

    // Synthesize a tool/result for each orphan. Use submitToolResults so the
    // surface manager and persistence layer both stay consistent. Each
    // recovery result is marked as an error so the LLM knows the tool call
    // didn't complete and can retry or move on.
    this.submitToolResults(
      orphans.map((o) => ({
        callId: o.callId as CallId,
        name: o.name,
        ok: false,
        error: 'client did not return result (session recovered) — tool call was abandoned when the client disconnected mid-turn',
      })),
    );

    // If the last event is now a tool/result (we just synthesized some) but
    // the surface also contains the orphaned assistant/message with tool_calls
    // followed by these new tool/results, the turn is logically closed. Emit
    // turn/end { kind: 'interrupted' } so the next user message opens a fresh
    // turn instead of treating the synthesized tool/results as a mid-turn
    // continuation (which would skip the inbox claim and re-stream without
    // the user's new message).
    const lastEv = this.session.events_[this.session.events_.length - 1];
    if (lastEv && lastEv.type === 'tool/result') {
      // Only close if there's an open turn (no turn/end after the last turn/start).
      let hasOpenTurn = false;
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        if (ev.type === 'turn/end') break;
        if (ev.type === 'turn/start') { hasOpenTurn = true; break; }
      }
      if (hasOpenTurn) {
        this.session.append('turn/end', {
          turn: this.turn,
          reason: { kind: 'interrupted' },
        });
        console.log('[agent-loop] R164: closed orphaned turn with turn/end { interrupted }');
      }
    }
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
    // R169 (AGENT-L8): delegate to the shared single source of truth
    // (previously duplicated inline here + in the settings API route).
    return extractSessionSettings(this.session.events_);
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
