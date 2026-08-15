/**
 * ApprovalService — the permission seam.
 *
 * Tools escalate via pre-execute returning {kind:'ask'}. The registry looks up
 * ctx.approval and calls request(). If no ApprovalService is mounted, the call
 * degrades to 'unavailable' (treated as deny).
 *
 * In the web app, the approval flow is: server emits an 'approval/asked'
 * session event, the client renders an ApprovalPanel, the user clicks Allow /
 * Reject, the client POSTs the decision, the server resolves the pending
 * promise with 'allowed-once' | 'rejected' | 'cancelled'.
 */

import type { CallId } from '../types';

export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';

export interface ApprovalRequest {
  callId: CallId;
  toolName: string;
  /** A human-readable summary of what the tool will do. */
  summary: string;
  /** Raw arguments (for the UI to show the command). */
  args: unknown;
  signal: AbortSignal;
}

export type ApprovalResolver = (request: ApprovalRequest) => Promise<ApprovalOutcome>;

export class ApprovalService {
  private resolver: ApprovalResolver | null = null;

  /** Mount the resolver (typically the agent-loop / API layer). */
  setResolver(resolver: ApprovalResolver | null): void {
    this.resolver = resolver;
  }

  isAvailable(): boolean {
    return this.resolver !== null;
  }

  async request(req: ApprovalRequest): Promise<ApprovalOutcome> {
    if (!this.resolver) return 'unavailable';
    try {
      return await this.resolver(req);
    } catch {
      return 'cancelled';
    }
  }
}
