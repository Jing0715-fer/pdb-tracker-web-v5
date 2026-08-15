/**
 * AgentContext — a minimal service registry ("the context").
 *
 * In dsh this is Cordis' Context; here it's a plain object map of
 * service name → instance, plus a typed EventEmitter. Plugins register their
 * services on it and subscribe to events. The agent loop reads ctx.llm,
 * ctx.tools, ctx.systemPrompt.
 */

import type { LlmRuntime } from './llm/adapter';
import type { ToolRuntime } from './tools/registry';
import type { SystemPrompt } from './prompt';
import type { ApprovalService } from './tools/approval';

export interface AgentContextServices {
  llm: LlmRuntime;
  tools: ToolRuntime;
  systemPrompt: SystemPrompt;
  approval: ApprovalService;
  /** Free-form key/value bag for plugin-specific state. */
  [key: string]: unknown;
}

export type AgentEventMap = {
  'session/event': { sessionId: string; event: unknown };
  'approval/asked': { sessionId: string; callId: string; toolName: string; summary: string; args: unknown };
  'agent/status': { sessionId: string; status: 'idle' | 'running' };
};

type Listener<T> = (payload: T) => void;

export class AgentContext {
  readonly services: AgentContextServices;
  private readonly listeners = new Map<string, Set<Listener<unknown>>>();

  constructor(services: AgentContextServices) {
    this.services = services;
  }

  get llm(): LlmRuntime {
    return this.services.llm;
  }
  get tools(): ToolRuntime {
    return this.services.tools;
  }
  get systemPrompt(): SystemPrompt {
    return this.services.systemPrompt;
  }
  get approval(): ApprovalService {
    return this.services.approval;
  }

  on<K extends keyof AgentEventMap>(event: K, listener: Listener<AgentEventMap[K]>): () => void {
    const key = event as string;
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener as Listener<unknown>);
    return () => set!.delete(listener as Listener<unknown>);
  }

  emit<K extends keyof AgentEventMap>(event: K, payload: AgentEventMap[K]): void {
    const set = this.listeners.get(event as string);
    if (!set) return;
    for (const l of set) {
      try {
        (l as Listener<AgentEventMap[K]>)(payload);
      } catch {
        // Contained.
      }
    }
  }
}
