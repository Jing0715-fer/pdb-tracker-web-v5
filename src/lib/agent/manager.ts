/**
 * AgentManager — owns the AgentContext (shared services) and the live
 * AgentLoop instances keyed by sessionId.
 *
 * This is the process-wide entrypoint: API routes call
 * `manager.getOrCreateLoop(sessionId)` to drive one conversation. The manager
 * also wires the approval seam so server-emitted 'approval/asked' events are
 * observed (the API layer holds pending approval promises and resolves them
 * when the client POSTs a decision).
 */

import { AgentContext } from './context';
import { AgentLoop, type AgentOptions, type DriveOutcome, type PendingToolCall } from './loop';
import { Session } from './session';
import { newSessionId, type CallId } from './types';
import { LlmRuntime } from './llm/adapter';
import { ZaiLlmAdapter } from './llm/zai-adapter';
import { ToolRuntime } from './tools/registry';
import { ApprovalService, type ApprovalOutcome } from './tools/approval';
import { SystemPrompt } from './prompt';
import { ALL_PDB_TOOLS, SERVER_SIDE_TOOLS, requiresApproval } from './pdb-tools';
import { PROVIDER_CATALOG, isProviderAvailable, listAllProvidersWithStatus, setProviderConfig, deleteProviderConfig, getDefaultProvider, setDefaultProvider as setDefaultProviderConfig, getProviderConfig, type ProviderProfile } from './providers';
import { OpenAICompatAdapter } from './providers/openai-compat-adapter';
import type { SessionEvent } from './session/types';
import type { StreamChunk } from './llm/types';
import {
  upsertSessionRow,
  appendEventRow,
  listSessionRows,
  loadSessionEvents,
  getSessionRow,
  deleteSessionRow,
} from './persistence';
import { maybeGenerateTitle } from './session-title';

export interface CreateSessionOptions {
  id?: string;
  title?: string;
  agent?: Omit<AgentOptions, never>;
}

/** Pending approval awaiting a client decision. */
interface PendingApproval {
  resolve: (outcome: ApprovalOutcome) => void;
  reject: (err: Error) => void;
  signal: AbortSignal;
}

const AGENT_SYSTEM_PROMPT_SECTIONS = [
  {
    name: 'identity',
    order: -100,
    text: `You are Molcraft AI, a structural-biology research assistant powered by an agent harness inspired by DeepSeek Harness. You drive the Molstar 3D molecular viewer through tools. You conduct all agent activities through the tool registry: every action is a tool call validated by the execution pipeline.`,
  },
  {
    name: 'persona',
    order: 0,
    text: `You help users analyze protein structures. You have access to 37+ tools across structure loading, analysis, visualization, measurement, and screenshot categories. Prefer calling tools over describing what you would do — the harness validates and executes them. After tool results return, read them carefully and explain findings in Chinese (unless the user writes English). Keep explanations concise (2-4 sentences) unless writing a full analysis report.`,
  },
  {
    name: 'tool-guidance',
    order: 100,
    text: `# How to work
1. When the user asks to load or analyze a structure, call the appropriate tools.
2. After pdb_load returns, wait for its result before calling pdb_analyze.
3. IMPORTANT: After pdb_load succeeds, call set_representation and set_color_theme SEPARATELY (not in parallel). Call set_representation first, wait for its result, THEN call set_color_theme. This prevents "No components to color" errors.
4. For multi-step requests, call independent tools in parallel, then wait for results.
5. SCREENSHOTS ARE AUTOMATIC: after every successful pdb_analyze with a visualizable recipe, the harness automatically captures multi-angle screenshots and runs a VLM quality check. Do NOT call capture_multi_angle yourself after pdb_analyze — that would duplicate the screenshots. Only call capture_multi_angle / recapture_screenshot when the user explicitly asks for more screenshots or angles.
6. Tool names and parameters stay in English. Respond to the user in Chinese unless they write in English.
7. When you have enough information to answer, respond with text ONLY (no tool calls) — that ends the turn.

# Multi-chain interaction analysis (IMPORTANT)
- Most interaction recipes (all_interactions, hbonds, salt_bridges, hydrophobic_contacts, interface_residues) analyze ONE chain pair per call (chain1 × chain2).
- When the user asks for chain-chain / chain-pair / inter-chain interactions (链间互作) on a MULTI-chain structure and does not name specific chains, DO NOT analyze just one arbitrary pair. Use the recipe "pairwise_interactions" instead — it automatically enumerates and analyzes EVERY chain pair in the structure and returns per-pair results (with a "pairs" array). This is the correct default for 全面链间互作分析.
- To learn which chains a structure contains first, run pdb_analyze with recipe "summary" (returns chains + entity info) or call fetch_metadata.
- Single-chain structures: for intra-chain analysis set chain1 = chain2 (e.g. both "A").
- When reporting pairwise results, summarize EACH analyzed pair (chain pair, total interactions, salt bridges / H-bonds / hydrophobic counts, key residue pairs with distances), and highlight which interfaces are biologically significant.

# Analysis recipes
hbonds, salt_bridges, hydrophobic_contacts, all_interactions, pairwise_interactions, binding_pocket, druggability, ligand_interactions, disulfide_bonds, metal_coordination, aromatic_stacking, water_bridges, sasa, ramachandran, bfactor_stats, secondary_structure_simple, interface_residues, detect_pockets, oligomer_analysis, surface_residues, rmsd, conformational_changes, protonation_states, summary, electrostatic, virtual_screening, druglike_screening.

# Color themes
chain-id, element-symbol, residue-name, sequence-id, hydrophobicity, uniform, occupancy, uncertainty, bfactor, entity-id, model-index, structure-index, polymer-index.`,
  },
];

export class AgentManager {
  private readonly ctx: AgentContext;
  private readonly loops = new Map<string, AgentLoop>();
  private readonly sessions = new Map<string, Session>();
  private readonly approvals = new Map<CallId, PendingApproval>();
  private readonly eventLog = new Map<string, SessionEvent[]>();
  /** Per-session drive serialization: prevents concurrent drive() calls from corrupting loop state. */
  private readonly driveLocks = new Map<string, Promise<unknown>>();

  constructor() {
    const llm = new LlmRuntime();
    // Always register the ZAI adapter (uses the z-ai SDK's built-in auth).
    llm.registerAdapter(['zai', 'auto'], new ZaiLlmAdapter());

    // Dynamically register all available OpenAI-compatible providers.
    // A provider is "available" if it has an API key configured (in the
    // credentials store or env var). The ZAI adapter is always available.
    for (const profile of PROVIDER_CATALOG) {
      if (profile.id === 'zai') continue; // already registered
      if (isProviderAvailable(profile.id)) {
        try {
          llm.registerAdapter([profile.id], new OpenAICompatAdapter(profile));
        } catch (err) {
          // Duplicate registration — skip silently.
          console.error(`[agent-manager] failed to register provider "${profile.id}":`, err);
        }
      }
    }

    const tools = new ToolRuntime();
    const approval = new ApprovalService();
    const systemPrompt = new SystemPrompt();

    // Register all PDB tools + their system-prompt sections.
    for (const tool of ALL_PDB_TOOLS) {
      tools.register(tool);
    }
    for (const section of AGENT_SYSTEM_PROMPT_SECTIONS) {
      systemPrompt.section(section);
    }
    // Tool schemas provider.
    systemPrompt.tools((_ctx) =>
      tools.schemas().map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    );
    // Variables.
    systemPrompt.variable('provider', () => 'zai');
    systemPrompt.variable('model', () => 'glm-4.6');

    // Wire the approval resolver — parks a pending promise, waits for client.
    //
    // R165 (AGENT-007) reachability audit: with the CURRENT tool set this
    // resolver is never invoked. Server-side dispatch happens only in
    // AgentLoop.executeServerSideTools, which dispatches tools in
    // SERVER_SIDE_TOOLS = { fetch_metadata } — and fetch_metadata is not
    // approval-required. The approval-required tools (export_snapshot,
    // clear_chat) are client-side (Molstar) tools: executeServerSideTools
    // defers them to the client before dispatch, so the usePreExecute 'ask'
    // gate below never fires for them on the server.
    //
    // Kept (not deleted) as defense-in-depth: if a future tool is added to
    // BOTH SERVER_SIDE_TOOLS and APPROVAL_REQUIRED, dispatch would hit the
    // 'ask' gate → ApprovalService.request → this resolver. R165 also fixed
    // the latent callId-mismatch bug that would have broken that path:
    // dispatch() used to generate its own internal callId, so the pending
    // promise here was keyed by an id the client never sees (the
    // approval/asked event + /approval route use the LLM's tool-call id) —
    // the promise could never be resolved and would time out after 5 min.
    // dispatch() now accepts opts.callId and the loop passes the LLM's id
    // through, so this path works if ever triggered.
    approval.setResolver(async (req) => {
      return await new Promise<ApprovalOutcome>((resolve, reject) => {
        this.approvals.set(req.callId, { resolve, reject, signal: req.signal });
        // Auto-reject if the client never responds within 5 minutes.
        const timeout = setTimeout(() => {
          if (this.approvals.has(req.callId)) {
            this.approvals.delete(req.callId);
            resolve('cancelled');
          }
        }, 5 * 60 * 1000);
        // Also reject if the abort signal fires (session cancelled/deleted).
        req.signal.addEventListener('abort', () => {
          clearTimeout(timeout);
          if (this.approvals.has(req.callId)) {
            this.approvals.delete(req.callId);
            resolve('cancelled');
          }
        });
      });
    });

    // Register server-side pre-execute listener for approval-required tools.
    // This ensures the approval gate is enforced server-side, not just client-side.
    tools.usePreExecute((ctx, next) => {
      if (requiresApproval(ctx.name)) {
        return { kind: 'ask', reason: 'destructive action requires approval' };
      }
      return next();
    });

    this.ctx = new AgentContext({ llm, tools, systemPrompt, approval });
  }

  get context(): AgentContext {
    return this.ctx;
  }

  /** List all providers with their availability status (for UI). */
  listProviders() {
    return listAllProvidersWithStatus();
  }

  /** Set/update a provider's config (API key + baseURL + defaultModel). */
  setProviderConfig(providerId: string, config: { apiKey?: string; baseURL?: string; defaultModel?: string; enabled?: boolean }) {
    setProviderConfig(providerId, config);
    // If the provider is now available and not yet registered, register it.
    if (isProviderAvailable(providerId) && providerId !== 'zai') {
      const profile = PROVIDER_CATALOG.find((p) => p.id === providerId);
      if (profile && !this.ctx.llm.getAdapter(providerId)) {
        try {
          this.ctx.llm.registerAdapter([providerId], new OpenAICompatAdapter(profile));
        } catch {
          // Already registered — fine.
        }
      }
    }
  }

  /** Delete a provider's config. */
  deleteProviderConfig(providerId: string) {
    deleteProviderConfig(providerId);
    // If the deleted provider was the default, reset default to 'zai'.
    if (getDefaultProvider() === providerId) {
      setDefaultProviderConfig('zai');
    }
  }

  /** Get the default provider ID. */
  getDefaultProvider(): string {
    return getDefaultProvider() ?? 'zai';
  }

  /** Set the default provider ID. */
  setDefaultProvider(providerId: string) {
    setDefaultProviderConfig(providerId);
  }

  /** Test a provider connection by making a minimal request. */
  async testProvider(providerId: string): Promise<{ ok: boolean; error?: string; model?: string }> {
    if (providerId === 'zai') return { ok: true, model: 'glm-4.6' };
    const profile = PROVIDER_CATALOG.find((p) => p.id === providerId);
    if (!profile) return { ok: false, error: 'Unknown provider' };
    if (!isProviderAvailable(providerId)) {
      return { ok: false, error: 'No API key configured' };
    }
    try {
      // Use the adapter to make a minimal request.
      const adapter = new OpenAICompatAdapter(profile);
      const chunks: StreamChunk[] = [];
      for await (const chunk of adapter.stream({
        provider: providerId,
        model: profile.defaultModel,
        messages: [
          {
            id: 'test' as never,
            role: 'user',
            content: [{ type: 'text', text: 'Hi' }],
            source: { kind: 'user' },
          },
        ],
        system: 'Reply with just "OK".',
        maxTokens: 5,
        signal: AbortSignal.timeout(15_000),
      })) {
        chunks.push(chunk);
      }
      const finish = chunks.find((c) => c.type === 'finish');
      if (finish && finish.type === 'finish') {
        if (finish.reason.kind === 'error') return { ok: false, error: finish.reason.error };
        return { ok: true, model: profile.defaultModel };
      }
      return { ok: true, model: profile.defaultModel };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Create a new session + loop. */
  createSession(opts: CreateSessionOptions = {}): { sessionId: string; session: Session } {
    const id = opts.id ?? newSessionId();
    const session = new Session({ id, title: opts.title ?? 'New session' });
    // Use the default provider if set, otherwise fall back to zai.
    const defaultProviderId = getDefaultProvider() ?? 'zai';
    const defaultProfile = PROVIDER_CATALOG.find((p) => p.id === defaultProviderId);
    const defaultModel = defaultProfile
      ? (getProviderConfig(defaultProviderId).defaultModel ?? defaultProfile.defaultModel)
      : 'glm-4.6';
    const loop = new AgentLoop(this.ctx, session, opts.agent ?? {
      provider: defaultProviderId,
      model: defaultModel,
      maxStepsPerTurn: 10,
    });
    this.sessions.set(id, session);
    this.loops.set(id, loop);
    this.eventLog.set(id, []);

    // Subscribe to session events → buffer + broadcast via ctx events + persist.
    session.subscribe((event) => {
      this.eventLog.get(id)?.push(event);
      this.ctx.emit('session/event', { sessionId: id, event });
      // Best-effort persistence — never block the agent loop.
      void appendEventRow(id, event);
      // Auto-generate a title after the first user message.
      if (event.type === 'user/message') {
        const events = this.eventLog.get(id) ?? [];
        void maybeGenerateTitle(id, events, session.title, (title) => {
          session.append('session/title', { title });
          void upsertSessionRow(id, title, session.createdAt);
        });
      }
    });
    // Persist the session row.
    void upsertSessionRow(id, session.title, session.createdAt);

    return { sessionId: id, session };
  }

  getLoop(sessionId: string): AgentLoop | undefined {
    return this.loops.get(sessionId);
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(): Array<{ id: string; title: string; createdAt: number; eventCount: number }> {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      eventCount: s.eventCount,
    }));
  }

  /** Ensure a session is in memory, auto-resuming from DB if needed. */
  async ensureSession(sessionId: string): Promise<Session | null> {
    const existing = this.getSession(sessionId);
    if (existing) return existing;
    const resumed = await this.resumeSession(sessionId);
    return resumed?.session ?? null;
  }

  deleteSession(sessionId: string): boolean {
    const loop = this.loops.get(sessionId);
    if (loop) loop.cancel('session deleted');
    this.loops.delete(sessionId);
    this.sessions.delete(sessionId);
    this.eventLog.delete(sessionId);
    void deleteSessionRow(sessionId);
    return true;
  }

  /**
   * Resolve a pending approval (called by the API layer when client decides).
   * R164 (AGENT-001): also append an `approval/decided` session event so
   * the tool-results route's security gate (tool-results/route.ts:55-76)
   * can verify the approval happened. Without this event, the gate
   * rejects the tool result with 403 "Tool requires approval before
   * results can be submitted" — even though the user already clicked
   * Allow in the ApprovalPanel.
   *
   * Works for BOTH client-side approval-required tools (export_snapshot,
   * clear_chat — never reach server-side dispatch, so no pending promise
   * exists in `this.approvals`) AND server-side approval-required tools
   * (which DO go through dispatch → ApprovalService.request → resolver
   * → set promise in `this.approvals`). For client-side tools, we just
   * record the decision; for server-side tools, we also resolve the
   * pending promise so the dispatch can continue.
   *
   * @returns true if either a pending promise was resolved OR the
   *   approval/decided event was newly appended (i.e. the callId is
   *   known to require approval). Returns false only if the callId is
   *   unknown AND no event could be appended.
   */
  resolveApproval(callId: CallId, outcome: ApprovalOutcome): boolean {
    const pending = this.approvals.get(callId);
    if (pending) {
      this.approvals.delete(callId);
      pending.resolve(outcome);
    }
    // R164 (AGENT-001): ALWAYS append the approval/decided event so the
    // tool-results route's security gate finds it. Look up the session
    // by scanning the in-memory sessions for one that has this callId
    // in its tool/call events.
    let appended = false;
    for (const [sessionId, session] of this.sessions.entries()) {
      // Check if this session has a tool/call with this callId.
      const hasCall = session.events_.some(
        (ev) => ev.type === 'tool/call' && (ev.data as { callId: string }).callId === callId,
      );
      if (hasCall) {
        session.append('approval/decided', {
          callId,
          decision: outcome,
        });
        appended = true;
        console.log(`[agent-manager] R164 (AGENT-001): appended approval/decided { callId: ${callId}, decision: ${outcome} } to session ${sessionId}`);
        break;
      }
    }
    // Return true if we either resolved a pending promise OR appended
    // the event. The /approval route uses this to decide whether to
    // return 404 (unknown callId) or 200 (resolved).
    return pending !== undefined || appended;
  }

  getEvents(sessionId: string): SessionEvent[] {
    return this.eventLog.get(sessionId) ?? [];
  }

  /**
   * Resume a session from persistence. Loads events from the DB, rebuilds
   * the in-memory Session + AgentLoop, and returns the sessionId. If the
   * session is already live in memory, returns it as-is.
   */
  async resumeSession(sessionId: string): Promise<{ sessionId: string; session: Session } | null> {
    // Already live in memory?
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return { sessionId, session: existing };
    }
    const row = await getSessionRow(sessionId);
    if (!row) return null;
    const events = await loadSessionEvents(sessionId);
    const session = Session.fromJSON({
      id: row.id,
      title: row.title,
      createdAt: row.createdAt.getTime(),
      events,
    });
    const loop = new AgentLoop(this.ctx, session, {
      provider: 'zai',
      model: 'glm-4.6',
      maxStepsPerTurn: 10,
    });
    this.sessions.set(sessionId, session);
    this.loops.set(sessionId, loop);
    this.eventLog.set(sessionId, [...events]);
    // Re-subscribe so future appends broadcast + persist.
    session.subscribe((event) => {
      this.eventLog.get(sessionId)?.push(event);
      this.ctx.emit('session/event', { sessionId, event });
      void appendEventRow(sessionId, event);
    });
    return { sessionId, session };
  }

  /** List all persisted sessions (for the history sidebar). */
  async listPersistedSessions(): Promise<
    Array<{ id: string; title: string; createdAt: number; updatedAt: number; eventCount: number }>
  > {
    const rows = await listSessionRows();
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.createdAt.getTime(),
      updatedAt: r.updatedAt.getTime(),
      eventCount: r._count.events,
    }));
  }

  /**
   * Serialize drive calls per-session to prevent concurrent state corruption.
   *
   * R165 (AGENT-006): the lock entry previously stored `prev.then(() => next)`
   * but the cleanup compared against `next`, which never matched — the
   * driveLocks Map grew forever (one entry per session, never deleted).
   * Now the chained promise is kept in a local and the cleanup compares
   * against the stored chain, so the entry is removed when the last queued
   * drive finishes.
   */
  private async serializedDrive(sessionId: string, fn: () => Promise<DriveOutcome>): Promise<DriveOutcome> {
    const prev = this.driveLocks.get(sessionId) ?? Promise.resolve();
    let resolve!: () => void;
    const next = new Promise<void>((r) => { resolve = r; });
    const chained = prev.then(() => next);
    this.driveLocks.set(sessionId, chained);
    await prev.catch(() => {});
    try {
      return await fn();
    } finally {
      resolve();
      // Clean up if this was the last in chain.
      if (this.driveLocks.get(sessionId) === chained) {
        this.driveLocks.delete(sessionId);
      }
    }
  }

  async drive(sessionId: string): Promise<DriveOutcome> {
    return this.serializedDrive(sessionId, async () => {
      const loop = this.loops.get(sessionId);
      if (!loop) return { kind: 'error', error: `Session not found: ${sessionId}` };
      return await this.driveWithServerTools(loop);
    });
  }

  /** Submit client-side tool results, then drive the next step. */
  async submitResults(sessionId: string, results: Array<{ callId: CallId; name: string; ok: boolean; result?: unknown; error?: string }>): Promise<DriveOutcome> {
    return this.serializedDrive(sessionId, async () => {
      const loop = this.loops.get(sessionId);
      if (!loop) return { kind: 'error', error: `Session not found: ${sessionId}` };
      loop.submitToolResults(results);
      // Shared with drive() — safe to call here because we already hold the
      // per-session drive lock (calling this.drive() would deadlock).
      return await this.driveWithServerTools(loop);
    });
  }

  /**
   * Drive the loop, executing server-side tools inline, until the outcome is
   * either `done`, `error`, or a `tool-calls` batch containing ONLY
   * client-side (Molstar) tools.
   *
   * R165 (AGENT-011) invariant: a returned `{ kind: 'tool-calls' }` outcome
   * NEVER contains server-side tools (fetch_metadata, …). Previously, when
   * the round guard hit 5 the loop fell through and returned the raw outcome
   * — including server-side calls that had NOT been executed — and the
   * client faked them with `{ ok: true, result: { note: 'executed
   * server-side' } }`, feeding the model misleading data
   * (use-agent-session.ts:578).
   *
   * The round guard is defense-in-depth on top of loop.drive()'s own
   * maxStepsPerTurn bound: it counts CONSECUTIVE pure server-side rounds
   * (rounds where every tool call was executed inline and none were
   * deferred to the client).
   */
  private async driveWithServerTools(loop: AgentLoop): Promise<DriveOutcome> {
    const MAX_SERVER_ROUNDS = 5;
    let outcome = await loop.drive();
    let serverRounds = 0;
    while (outcome.kind === 'tool-calls') {
      // Execute every server-side tool in this batch. `deferred` holds only
      // client-side calls — the server-side ones already have their
      // tool/result events appended by executeServerSideTools.
      const { deferred } = await loop.executeServerSideTools(outcome.calls, SERVER_SIDE_TOOLS);
      if (deferred.length > 0) {
        // Client-side tools pending — hand back ONLY those.
        return toClientToolCalls(outcome, deferred);
      }
      // Pure server-side round finished. If the guard is exhausted, give the
      // model ONE final step to see the accumulated results and summarize;
      // if it still wants tools, stop — any tool/call events it just emitted
      // are recovered as synthetic error results by the R164 (AGENT-004)
      // orphan recovery on the next drive().
      if (serverRounds >= MAX_SERVER_ROUNDS) {
        const final = await loop.drive();
        if (final.kind !== 'tool-calls') return final;
        // Execute this batch's server-side tools too so the invariant holds
        // (never return unexecuted server-side calls), then hand back any
        // client-side calls. If there are none, the model is stuck in a
        // fetch-only loop.
        const { deferred: finalDeferred } = await loop.executeServerSideTools(final.calls, SERVER_SIDE_TOOLS);
        if (finalDeferred.length > 0) return toClientToolCalls(final, finalDeferred);
        return {
          kind: 'error',
          error: `Agent exceeded ${MAX_SERVER_ROUNDS} consecutive server-side tool rounds without producing a client tool call or a final answer — aborting to prevent an infinite fetch loop.`,
        };
      }
      outcome = await loop.drive();
      serverRounds += 1;
    }
    return outcome;
  }
}

/** Project a tool-calls outcome down to its client-side (deferred) calls. */
function toClientToolCalls(
  outcome: Extract<DriveOutcome, { kind: 'tool-calls' }>,
  deferred: Array<{ callId: string; name: string; arguments: string }>,
): DriveOutcome {
  return {
    kind: 'tool-calls',
    turn: outcome.turn,
    step: outcome.step,
    calls: deferred.map((c) => ({ callId: c.callId as CallId, name: c.name, arguments: c.arguments })),
    assistantText: outcome.assistantText,
  };
}

// Process-wide singleton. In Next.js dev (webpack) each API route is bundled
// separately, so a module-level `let` is NOT shared across routes — the
// sessions route would create a manager that the messages route cannot see.
// Stashing on globalThis guarantees one instance per Node process.
export function getAgentManager(): AgentManager {
  const g = globalThis as unknown as { __agentManager?: AgentManager };
  if (!g.__agentManager) {
    g.__agentManager = new AgentManager();
  }
  return g.__agentManager;
}

export type { PendingToolCall, ApprovalOutcome };
export { requiresApproval };
