/**
 * Inbox — the agent's input queue.
 *
 * Two pending lists:
 *   - nextTurn[]: messages that each open a new turn (a step claims at most
 *     one per turn).
 *   - nextStep[]: steering + injected context, drained at the next step
 *     boundary.
 *
 * send(message, target, wakeup):
 *   - followup(m)  = send(m, 'next-turn', true)   — user follow-up
 *   - steer(m)     = send(m, 'next-step', true)    — mid-turn steering (wakes)
 *   - inject(m)    = send(m, 'next-step', false)   — context injection (no wake)
 *
 * A step claims: the next-step batch, plus (if target='next-turn') the first
 * queued turn-opening message.
 */

import { newMessageId, type Json, type Seq } from './types';
import type { UserMessage } from './llm/types';
import type { SurfaceOp } from './session/types';

export type InboxTarget = 'next-turn' | 'next-step';

export interface InboxMessage extends UserMessage {
  /** A free-form label for UI display (e.g. "user", "steering", "context"). */
  inboxKind?: 'user' | 'steering' | 'context';
  time: number;
  /**
   * R164 (AGENT-003): Optional surface operation for the loop to apply when
   * appending this message. Used by regenerate to drop the previous
   * assistant turn from the model-visible surface (op='replace') while
   * preserving the full event log for audit. Defaults to { op: 'append' }.
   */
  surfaceOp?: SurfaceOp;
}

export class Inbox {
  private nextTurn: InboxMessage[] = [];
  private nextStep: InboxMessage[] = [];

  get hasPending(): boolean {
    return this.nextTurn.length > 0 || this.nextStep.length > 0;
  }

  get pendingTurnCount(): number {
    return this.nextTurn.length;
  }

  get pendingStepCount(): number {
    return this.nextStep.length;
  }

  send(message: Omit<InboxMessage, 'id' | 'source' | 'role' | 'time'>, target: InboxTarget, _wakeup: boolean): void {
    const full: InboxMessage = {
      id: newMessageId(),
      role: 'user',
      source: { kind: 'user' },
      time: Date.now(),
      ...message,
    };
    if (target === 'next-turn') this.nextTurn.push(full);
    else this.nextStep.push(full);
  }

  /** Claim a step's input: drain next-step, optionally take one turn-opener. */
  claim(takeTurn: boolean): InboxMessage[] {
    const claimed = [...this.nextStep];
    this.nextStep = [];
    if (takeTurn && this.nextTurn.length > 0) {
      claimed.push(this.nextTurn.shift()!);
    }
    return claimed;
  }

  clear(): void {
    this.nextTurn = [];
    this.nextStep = [];
  }

  /** Snapshot for UI display of pending input. */
  pending(): { nextTurn: InboxMessage[]; nextStep: InboxMessage[] } {
    return {
      nextTurn: [...this.nextTurn],
      nextStep: [...this.nextStep],
    };
  }
}

export type { Json };
