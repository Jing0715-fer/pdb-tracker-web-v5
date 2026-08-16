/**
 * Session Manager — Persistent, forkable, replayable chat sessions.
 *
 * Enhances the existing ChatSession with:
 * - Fork: create a new session from a specific point in the conversation
 * - Replay: re-execute tool calls from a session (with same or different tools)
 * - Export: serialize a session for external storage/sharing
 * - Import: load a previously exported session
 *
 * Session events are stored in an append-only log, enabling:
 * - Full conversation replay
 * - Tool call audit trail
 * - Branching/forking from any point
 */

export interface SessionEvent {
  id: string;
  sessionId: string;
  type: "user_message" | "assistant_message" | "tool_call" | "tool_result" | "permission_request" | "permission_response" | "session_fork";
  timestamp: number;
  data: Record<string, unknown>;
  /** For forked sessions: the parent session and event index */
  parentSessionId?: string;
  parentEventIndex?: number;
}

export interface ForkOptions {
  /** The event index to fork from (exclusive — fork starts after this event) */
  fromEventIndex?: number;
  /** Title for the forked session */
  title?: string;
}

export interface ReplayResult {
  ok: boolean;
  toolResults: Array<{ name: string; ok: boolean; result?: unknown; error?: string }>;
  events: SessionEvent[];
  error?: string;
}

class SessionManager {
  private events = new Map<string, SessionEvent[]>();

  /** Append an event to a session's log */
  append(sessionId: string, event: Omit<SessionEvent, "id" | "sessionId" | "timestamp">): SessionEvent {
    const fullEvent: SessionEvent = {
      ...event,
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      timestamp: Date.now(),
    };
    let log = this.events.get(sessionId);
    if (!log) {
      log = [];
      this.events.set(sessionId, log);
    }
    log.push(fullEvent);
    return fullEvent;
  }

  /** Get all events for a session */
  getEvents(sessionId: string): SessionEvent[] {
    return this.events.get(sessionId) || [];
  }

  /** Fork a session from a specific point */
  fork(
    parentSessionId: string,
    options: ForkOptions = {},
  ): { newSessionId: string; events: SessionEvent[] } {
    const parentEvents = this.getEvents(parentSessionId);
    const forkIndex = options.fromEventIndex ?? parentEvents.length - 1;
    const newSessionId = `session-fork-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Copy events up to the fork point
    const copiedEvents: SessionEvent[] = [];
    for (let i = 0; i <= forkIndex && i < parentEvents.length; i++) {
      const evt = parentEvents[i];
      const newEvent: SessionEvent = {
        ...evt,
        id: `evt-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
        sessionId: newSessionId,
        parentSessionId,
        parentEventIndex: i,
      };
      copiedEvents.push(newEvent);
    }

    this.events.set(newSessionId, copiedEvents);

    // Record the fork event in the parent
    this.append(parentSessionId, {
      type: "session_fork",
      data: { newSessionId, fromEventIndex: forkIndex, title: options.title },
    });

    return { newSessionId, events: copiedEvents };
  }

  /** Export a session for external storage */
  exportSession(sessionId: string): { sessionId: string; events: SessionEvent[]; exportedAt: string } {
    return {
      sessionId,
      events: this.getEvents(sessionId),
      exportedAt: new Date().toISOString(),
    };
  }

  /** Import a previously exported session */
  importSession(data: { sessionId: string; events: SessionEvent[] }): string {
    const sessionId = data.sessionId || `session-imported-${Date.now()}`;
    this.events.set(sessionId, data.events);
    return sessionId;
  }

  /** Replay tool calls from a session */
  async replay(
    sessionId: string,
    toolExecutor: (name: string, args: Record<string, unknown>) => Promise<unknown>,
    options: { fromEventIndex?: number; toEventIndex?: number } = {},
  ): Promise<ReplayResult> {
    const events = this.getEvents(sessionId);
    const from = options.fromEventIndex ?? 0;
    const to = options.toEventIndex ?? events.length - 1;
    const results: ReplayResult["toolResults"] = [];
    const replayEvents: SessionEvent[] = [];

    for (let i = from; i <= to && i < events.length; i++) {
      const evt = events[i];
      replayEvents.push(evt);

      if (evt.type === "tool_call") {
        const { name, arguments: args } = evt.data as { name: string; arguments: Record<string, unknown> };
        try {
          const result = await toolExecutor(name, args);
          results.push({ name, ok: true, result });
        } catch (err: any) {
          results.push({ name, ok: false, error: err?.message || String(err) });
        }
      }
    }

    return { ok: true, toolResults: results, events: replayEvents };
  }

  /** Get a summary of tool calls in a session */
  getToolCallSummary(sessionId: string): Array<{ name: string; timestamp: number; ok: boolean }> {
    const events = this.getEvents(sessionId);
    const toolCalls = events.filter((e) => e.type === "tool_call");
    const toolResults = events.filter((e) => e.type === "tool_result");
    return toolCalls.map((tc, i) => ({
      name: (tc.data as { name: string }).name,
      timestamp: tc.timestamp,
      ok: toolResults[i] ? (toolResults[i].data as { ok: boolean }).ok : false,
    }));
  }

  /** Clear all events for a session */
  clear(sessionId: string): void {
    this.events.delete(sessionId);
  }

  /** Clear all sessions */
  clearAll(): void {
    this.events.clear();
  }
}

export const sessionManager = new SessionManager();
