/**
 * Session — the append-only event log + surface projection.
 *
 * The session is the single source of truth. Every model-visible fact is
 * reconstructable from the events. `append` validates an event (assigns seq,
 * time, then re-folds the surface) and freezes it. `deriveMessages` projects
 * the model-visible Message[] via the SurfaceManager. `subscribe` lets the
 * agent loop + API + UI observe appends in real time.
 *
 * Persistence: events can be drained to a backend (Prisma / JSONL). This
 * class holds the in-memory authoritative copy; a separate persistence layer
 * mirrors appends.
 */

import { deepFreeze, type Seq } from '../types';
import type { LlmCallConfig } from '../llm/types';
import type { Message } from '../llm/types';
import {
  type SessionEvent,
  type SessionEventType,
  type SessionEventMap,
  type RequestHeader,
  type SessionEventBase,
  type TurnEndReason,
} from './types';
import { SurfaceManager } from './surface';

export type SessionListener = (event: SessionEvent) => void;

export interface SessionOptions {
  id: string;
  title?: string;
  createdAt?: number;
  /** Pre-loaded events (for resume). Must be in seq order. */
  events?: SessionEvent[];
}

export class Session {
  readonly id: string;
  readonly createdAt: number;
  title: string;

  private events: SessionEvent[] = [];
  private eventsBySeq = new Map<Seq, SessionEvent>();
  private readonly surface = new SurfaceManager();
  private readonly listeners = new Set<SessionListener>();
  private currentTurn = 0;
  private currentStep = 0;
  private requestHeader: RequestHeader | null = null;
  private headerLogged = false;

  constructor(opts: SessionOptions) {
    this.id = opts.id;
    this.createdAt = opts.createdAt ?? Date.now();
    this.title = opts.title ?? 'New session';
    if (opts.events) {
      for (const ev of opts.events) {
        this.events.push(ev);
        this.eventsBySeq.set(ev.seq, ev);
        if (ev.type === 'turn/start') this.currentTurn = (ev.data as { turn: number }).turn;
        if (ev.type === 'step/start') this.currentStep = (ev.data as { step: number }).step;
        if (ev.type === 'request/header') this.requestHeader = (ev.data as { header: RequestHeader }).header;
        if (ev.type === 'session/title') this.title = (ev.data as { title: string }).title;
      }
      this.surface.recompute(this.events);
    }
  }

  get eventCount(): number {
    return this.events.length;
  }

  get events_(): readonly SessionEvent[] {
    return this.events;
  }

  get turn(): number {
    return this.currentTurn;
  }

  get step(): number {
    return this.currentStep;
  }

  getRequestHeader(): RequestHeader | null {
    return this.requestHeader;
  }

  /** Append a typed event. Assigns seq + time, folds surface, freezes. */
  append<T extends SessionEventType>(
    type: T,
    data: SessionEventMap[T],
    extra?: Pick<SessionEventBase, 'surfaceOp' | 'sourceEventSeqs'>,
  ): SessionEvent<T> {
    const seq = this.events.length;
    const time = Date.now();
    const event = deepFreeze({
      type,
      seq,
      time,
      data: deepFreeze(data),
      ...extra,
    }) as SessionEvent<T>;
    this.events.push(event);
    this.eventsBySeq.set(seq, event);
    // Track turn/step/header state.
    if (type === 'turn/start') this.currentTurn = (data as { turn: number }).turn;
    if (type === 'step/start') this.currentStep = (data as { step: number }).step;
    if (type === 'request/header') {
      const headerData = data as { header: RequestHeader; reason: 'initial' | 'resume' | 'change' };
      this.requestHeader = headerData.header;
      if (headerData.reason === 'initial' || headerData.reason === 'resume') this.headerLogged = true;
    }
    if (type === 'session/title') this.title = (data as { title: string }).title;
    // Surface only needs recompute when surface-eligible events arrive.
    if (this.isSurfaceEligible(type)) this.surface.recompute(this.events);
    // Notify subscribers.
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // Listener errors are contained — never break the session.
      }
    }
    return event;
  }

  private isSurfaceEligible(type: SessionEventType): boolean {
    return type === 'user/message' || type === 'assistant/message' || type === 'tool/result';
  }

  /** Project the model-visible Message[] from the log. */
  deriveMessages(): Message[] {
    return this.surface.deriveMessages(this.eventsBySeq);
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Serialize for persistence. */
  toJSON(): { id: string; title: string; createdAt: number; events: SessionEvent[] } {
    return {
      id: this.id,
      title: this.title,
      createdAt: this.createdAt,
      events: this.events,
    };
  }

  static fromJSON(data: {
    id: string;
    title: string;
    createdAt: number;
    events: SessionEvent[];
  }): Session {
    return new Session({
      id: data.id,
      title: data.title,
      createdAt: data.createdAt,
      events: data.events,
    });
  }
}

export { type RequestHeader, type TurnEndReason, type LlmCallConfig };
