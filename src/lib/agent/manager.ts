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
import type { SessionEvent } from './session/types';
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
    text: `You help users analyze protein structures. You have access to 37 tools across structure loading, analysis, visualization, measurement, and screenshot categories. Prefer calling tools over describing what you would do — the harness validates and executes them. After tool results return, read them carefully and explain findings in Chinese (unless the user writes English). Keep explanations concise (2-4 sentences) unless writing a full analysis report.`,
  },
  {
    name: 'tool-guidance',
    order: 100,
    text: `# How to work
1. When the user asks to load or analyze a structure, call the appropriate tools.
2. After pdb_load returns, wait for its result before calling pdb_analyze.
3. For multi-step requests, call independent tools in parallel, then wait for results.
4. After a successful pdb_analyze for a visualizable recipe (hbonds, salt_bridges, all_interactions, binding_pocket, etc.), ALWAYS call capture_multi_angle next to capture screenshots.
5. Tool names and parameters stay in English. Respond to the user in Chinese unless they write in English.
6. When you have enough information to answer, respond with text ONLY (no tool calls) — that ends the turn.

# Analysis recipes
hbonds, salt_bridges, hydrophobic_contacts, all_interactions, binding_pocket, druggability, ligand_interactions, disulfide_bonds, metal_coordination, aromatic_stacking, water_bridges, sasa, ramachandran, bfactor_stats, secondary_structure_simple, interface_residues, detect_pockets, oligomer_analysis, surface_residues, rmsd, conformational_changes, protonation_states, summary, electrostatic, virtual_screening, druglike_screening.

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

  constructor() {
    const llm = new LlmRuntime();
    llm.registerAdapter(['zai', 'auto'], new ZaiLlmAdapter());
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

    // Wire the approval resolver — emits 'approval/asked', waits for client.
    approval.setResolver(async (req) => {
      return await new Promise<ApprovalOutcome>((resolve, reject) => {
        this.approvals.set(req.callId, { resolve, reject, signal: req.signal });
        // Broadcast to listeners (the SSE layer) so the UI shows the card.
        // We can't know sessionId here cheaply; the loop emits the session event.
      });
    });

    this.ctx = new AgentContext({ llm, tools, systemPrompt, approval });
  }

  get context(): AgentContext {
    return this.ctx;
  }

  /** Create a new session + loop. */
  createSession(opts: CreateSessionOptions = {}): { sessionId: string; session: Session } {
    const id = opts.id ?? newSessionId();
    const session = new Session({ id, title: opts.title ?? 'New session' });
    const loop = new AgentLoop(this.ctx, session, opts.agent ?? {
      provider: 'zai',
      model: 'glm-4.6',
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

  deleteSession(sessionId: string): boolean {
    const loop = this.loops.get(sessionId);
    if (loop) loop.cancel('session deleted');
    this.loops.delete(sessionId);
    this.sessions.delete(sessionId);
    this.eventLog.delete(sessionId);
    void deleteSessionRow(sessionId);
    return true;
  }

  /** Resolve a pending approval (called by the API layer when client decides). */
  resolveApproval(callId: CallId, outcome: ApprovalOutcome): boolean {
    const pending = this.approvals.get(callId);
    if (!pending) return false;
    this.approvals.delete(callId);
    pending.resolve(outcome);
    return true;
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

  /** Drive the loop one step; execute server-side tools inline; return tool calls or done. */
  async drive(sessionId: string): Promise<DriveOutcome> {
    const loop = this.loops.get(sessionId);
    if (!loop) return { kind: 'error', error: `Session not found: ${sessionId}` };
    let outcome = await loop.drive();
    // If the step produced tool calls, execute server-side ones inline and re-drive.
    let guard = 0;
    while (outcome.kind === 'tool-calls' && guard < 5) {
      const calls = outcome.calls;
      const { executed, deferred } = await loop.executeServerSideTools(calls, SERVER_SIDE_TOOLS);
      if (deferred.length === 0) {
        // All server-side — drive the next step.
        outcome = await loop.drive();
        guard += 1;
        continue;
      }
      // Some tools need client-side execution — return them.
      return {
        kind: 'tool-calls',
        turn: outcome.turn,
        step: outcome.step,
        calls: deferred.map((c) => ({ callId: c.callId as CallId, name: c.name, arguments: c.arguments })),
        assistantText: outcome.assistantText,
      };
    }
    return outcome;
  }

  /** Submit client-side tool results, then drive the next step. */
  async submitResults(sessionId: string, results: Array<{ callId: CallId; name: string; ok: boolean; result?: unknown; error?: string }>): Promise<DriveOutcome> {
    const loop = this.loops.get(sessionId);
    if (!loop) return { kind: 'error', error: `Session not found: ${sessionId}` };
    loop.submitToolResults(results);
    return await this.drive(sessionId);
  }
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
