/**
 * Permission System — Approval/permission control for tool execution.
 *
 * Tools can declare `requiresApproval: true` in their definition. When the
 * agent loop encounters such a tool, it pauses execution and asks the user
 * for approval. The user can:
 * - Approve (proceed with execution)
 * - Deny (skip the tool, report denial to the LLM)
 * - Approve all (remember the decision for the session)
 *
 * This replaces the current unconditional execution model where every
 * command from the LLM is executed without user review.
 */

export type PermissionDecision = "approve" | "deny" | "approve_always";

export interface PermissionRequest {
  id: string;
  toolName: string;
  toolDescription: string;
  arguments: Record<string, unknown>;
  /** Human-readable summary of what the tool will do */
  summary: string;
  /** When the request was created */
  createdAt: number;
}

export interface PermissionResponse {
  requestId: string;
  decision: PermissionDecision;
  /** Optional user note explaining the decision */
  note?: string;
}

/**
 * Session-level permission store. Tracks which tools have been
 * approved "always" so they don't need re-approval.
 */
class PermissionStore {
  private alwaysApproved = new Set<string>();
  private pendingRequests = new Map<string, PermissionRequest>();
  private responseHandlers = new Map<string, (response: PermissionResponse) => void>();

  /** Check if a tool has been approved "always" in this session */
  isApproved(toolName: string): boolean {
    return this.alwaysApproved.has(toolName);
  }

  /** Mark a tool as approved "always" */
  approveAlways(toolName: string): void {
    this.alwaysApproved.add(toolName);
  }

  /** Remove "always" approval for a tool */
  revokeAlways(toolName: string): void {
    this.alwaysApproved.delete(toolName);
  }

  /** Create a permission request and wait for user response */
  requestApproval(
    toolName: string,
    toolDescription: string,
    args: Record<string, unknown>,
    summary: string,
  ): Promise<PermissionResponse> {
    const id = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const request: PermissionRequest = {
      id,
      toolName,
      toolDescription,
      arguments: args,
      summary,
      createdAt: Date.now(),
    };
    this.pendingRequests.set(id, request);

    return new Promise<PermissionResponse>((resolve) => {
      this.responseHandlers.set(id, resolve);
      // Emit an event that the UI can listen for
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("tool-permission-request", { detail: request }));
      }
    });
  }

  /** Respond to a permission request (called by the UI) */
  respond(response: PermissionResponse): void {
    const handler = this.responseHandlers.get(response.requestId);
    if (handler) {
      handler(response);
      this.responseHandlers.delete(response.requestId);
      this.pendingRequests.delete(response.requestId);
    }
    if (response.decision === "approve_always") {
      this.alwaysApproved.add(this.pendingRequests.get(response.requestId)?.toolName || "");
    }
  }

  /** Get all pending permission requests (for UI display) */
  getPending(): PermissionRequest[] {
    return Array.from(this.pendingRequests.values());
  }

  /** Clear all permissions (for session reset) */
  clear(): void {
    this.alwaysApproved.clear();
    this.pendingRequests.clear();
    this.responseHandlers.clear();
  }

  /** Generate a human-readable summary of what a tool will do */
  static summarizeTool(toolName: string, args: Record<string, unknown>): string {
    switch (toolName) {
      case "pdb_load":
        return `Load PDB structure: ${args.id || "unknown"}`;
      case "pdb_analyze":
        return `Run ${args.recipe || "analysis"} on ${args.pdbId || "current structure"}`;
      case "set_representation":
        return `Change representation to: ${args.preset || "default"}`;
      case "set_color_theme":
        return `Change color theme to: ${args.theme || "default"}`;
      case "focus_ligand":
        return `Focus camera on ligand: ${args.compId || "all"}`;
      case "capture_multi_angle":
        return `Capture ${args.angles?.length || 3} screenshots from different angles`;
      case "clear_chat":
        return `Clear all chat messages`;
      case "delete_session":
        return `Delete chat session`;
      default:
        return `Execute tool: ${toolName}`;
    }
  }
}

export const permissionStore = new PermissionStore();
