/**
 * Agent Loop — Real tool-calling agent loop (replaces ReAct-in-prompt).
 *
 * This module implements a proper agent loop where:
 * 1. The LLM is given tool definitions (function calling schema)
 * 2. The LLM responds with either text or tool calls
 * 3. Tool calls are validated, permission-checked, and executed
 * 4. Results are fed back to the LLM for the next turn
 * 5. The loop continues until the LLM produces a final text response
 *
 * This replaces the current approach where the LLM returns a JSON object
 * with {reply, commands, continueAfterAnalysis} that is parsed and
 * executed. The tool-calling approach is more robust because:
 * - No JSON parsing failures
 * - No hallucinated field names
 * - Proper tool schemas with validation
 * - Permission gating for destructive operations
 * - Structured error handling
 */

import { toolRegistry, type ToolCall, type ToolResult, type ToolExecutionContext } from "./tool-registry";
import { permissionStore, type PermissionDecision } from "./permission";

export interface AgentMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
}

export interface AgentLoopOptions {
  /** Maximum number of tool-calling rounds (default: 10) */
  maxRounds?: number;
  /** The LLM function to call (wraps generateText) */
  llmCall: (messages: AgentMessage[], tools: unknown[]) => Promise<{
    content?: string;
    toolCalls?: ToolCall[];
  }>;
  /** The execution context passed to tool executors */
  context: ToolExecutionContext;
  /** Callback for streaming progress events */
  onProgress?: (event: AgentProgressEvent) => void;
  /** Whether to auto-approve all tools (for testing) */
  autoApprove?: boolean;
}

export type AgentProgressEvent =
  | { type: "llm_start"; round: number }
  | { type: "llm_response"; content: string; toolCalls?: ToolCall[] }
  | { type: "tool_start"; call: ToolCall }
  | { type: "permission_request"; toolName: string; summary: string }
  | { type: "permission_response"; decision: PermissionDecision }
  | { type: "tool_result"; result: ToolResult }
  | { type: "tool_error"; call: ToolCall; error: string }
  | { type: "done"; finalContent: string; rounds: number }
  | { type: "error"; error: string };

export interface AgentLoopResult {
  ok: boolean;
  finalContent: string;
  toolResults: ToolResult[];
  rounds: number;
  error?: string;
}

/**
 * Execute the agent loop.
 *
 * @param initialMessages - The conversation history (user messages + previous assistant responses)
 * @param options - Configuration for the loop
 * @returns The final result with the assistant's last text response
 */
export async function executeAgentLoop(
  initialMessages: AgentMessage[],
  options: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const { maxRounds = 10, llmCall, context, onProgress, autoApprove = false } = options;
  const messages = [...initialMessages];
  const toolResults: ToolResult[] = [];
  const tools = toolRegistry.toFunctionDefinitions();

  for (let round = 0; round < maxRounds; round++) {
    onProgress?.({ type: "llm_start", round });

    let llmResponse;
    try {
      llmResponse = await llmCall(messages, tools);
    } catch (err: any) {
      const error = `LLM call failed: ${err?.message || String(err)}`;
      onProgress?.({ type: "error", error });
      return { ok: false, finalContent: "", toolResults, rounds: round, error };
    }

    const { content, toolCalls } = llmResponse;

    // If no tool calls, the LLM is done — return the final content
    if (!toolCalls || toolCalls.length === 0) {
      const finalContent = content || "";
      messages.push({ role: "assistant", content: finalContent });
      onProgress?.({ type: "done", finalContent, rounds: round + 1 });
      return { ok: true, finalContent, toolResults, rounds: round + 1 };
    }

    // Add the assistant message with tool calls to the conversation
    messages.push({
      role: "assistant",
      content: content || "",
      toolCalls,
    });

    onProgress?.({ type: "llm_response", content: content || "", toolCalls });

    // Execute each tool call
    for (const call of toolCalls) {
      onProgress?.({ type: "tool_start", call });

      const tool = toolRegistry.get(call.name);
      if (!tool) {
        const error = `Unknown tool: ${call.name}`;
        onProgress?.({ type: "tool_error", call, error });
        const result: ToolResult = {
          callId: call.id,
          name: call.name,
          ok: false,
          error,
        };
        toolResults.push(result);
        messages.push({
          role: "tool",
          content: JSON.stringify({ error }),
          toolCallId: call.id,
          toolName: call.name,
        });
        continue;
      }

      // Validate arguments
      const validation = toolRegistry.validate(call.name, call.arguments);
      if (!validation.ok) {
        const error = `Invalid arguments: ${validation.errors.join("; ")}`;
        onProgress?.({ type: "tool_error", call, error });
        const result: ToolResult = {
          callId: call.id,
          name: call.name,
          ok: false,
          error,
        };
        toolResults.push(result);
        messages.push({
          role: "tool",
          content: JSON.stringify({ error }),
          toolCallId: call.id,
          toolName: call.name,
        });
        continue;
      }

      // Check permissions
      if (tool.definition.requiresApproval && !autoApprove) {
        if (!permissionStore.isApproved(call.name)) {
          const summary = permissionStore.constructor.name === "PermissionStore"
            ? summarizeToolCall(call.name, call.arguments)
            : call.name;
          onProgress?.({ type: "permission_request", toolName: call.name, summary });

          const response = await permissionStore.requestApproval(
            call.name,
            tool.definition.description,
            call.arguments,
            summary,
          );

          onProgress?.({ type: "permission_response", decision: response.decision });

          if (response.decision === "deny") {
            const result: ToolResult = {
              callId: call.id,
              name: call.name,
              ok: false,
              error: `User denied: ${response.note || "Permission denied"}`,
              approved: false,
            };
            toolResults.push(result);
            messages.push({
              role: "tool",
              content: JSON.stringify({ error: "Permission denied by user" }),
              toolCallId: call.id,
              toolName: call.name,
            });
            continue;
          }
        }
      }

      // Execute the tool
      const startTime = Date.now();
      try {
        // Check for timeout
        const timeoutMs = tool.definition.timeoutMs || 60_000;
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool "${call.name}" timed out after ${timeoutMs}ms`)), timeoutMs),
        );

        const result = await Promise.race([
          tool.executor(call.arguments, context),
          timeoutPromise,
        ]);

        const durationMs = Date.now() - startTime;
        const toolResult: ToolResult = {
          callId: call.id,
          name: call.name,
          ok: true,
          result,
          durationMs,
          approved: true,
        };
        toolResults.push(toolResult);
        onProgress?.({ type: "tool_result", result: toolResult });

        // Truncate large results to avoid context overflow
        const resultStr = typeof result === "string" ? result : JSON.stringify(result);
        const truncated = resultStr.length > 4000
          ? resultStr.substring(0, 4000) + "...[truncated]"
          : resultStr;

        messages.push({
          role: "tool",
          content: truncated,
          toolCallId: call.id,
          toolName: call.name,
        });
      } catch (err: any) {
        const durationMs = Date.now() - startTime;
        const error = err?.message || String(err);
        onProgress?.({ type: "tool_error", call, error });
        const result: ToolResult = {
          callId: call.id,
          name: call.name,
          ok: false,
          error,
          durationMs,
        };
        toolResults.push(result);
        messages.push({
          role: "tool",
          content: JSON.stringify({ error }),
          toolCallId: call.id,
          toolName: call.name,
        });
      }
    }
  }

  // Max rounds reached — return what we have
  const finalContent = messages[messages.length - 1]?.content || "Maximum tool-calling rounds reached.";
  onProgress?.({ type: "done", finalContent, rounds: maxRounds });
  return { ok: true, finalContent, toolResults, rounds: maxRounds };
}

/** Generate a human-readable summary of what a tool call will do */
function summarizeToolCall(toolName: string, args: Record<string, unknown>): string {
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
      return `Capture screenshots from different angles`;
    case "clear_chat":
      return `Clear all chat messages`;
    default:
      return `Execute: ${toolName}`;
  }
}
