/**
 * useAgentLoop — Client-side orchestrator for the tool-calling agent loop.
 *
 * This hook replaces the legacy ReAct-in-prompt loop (where the LLM returns a
 * JSON {reply, commands} object that is parsed and executed). Instead, it uses
 * the new /api/llm/agent/round endpoint which supports native function-calling.
 *
 * Flow:
 *   1. User sends a message -> POST /api/llm/agent/round (messages)
 *   2. Server returns { done, content, toolCalls }
 *   3. If !done: execute each toolCall via executeCommand (client-side Molstar)
 *      - Check permissionStore for tools requiring approval
 *      - Log to sessionManager
 *      - POST /api/llm/agent/round again with toolResults
 *   4. Repeat until done=true, then display the final content
 *
 * The hook exposes progress events so the UI can show:
 *   - "Calling LLM…" / "Executing tool: pdb_load" / "Tool result: OK"
 *   - Permission request cards (when a tool needs approval)
 */

'use client';

import { useCallback, useRef, useState } from 'react';
import { executeCommand, type CommandResult } from './commands';
import type { MolstarViewer } from './types';
import { permissionStore, type PermissionDecision } from './permission';
import { sessionManager } from './session-manager';
import { backgroundTaskManager } from './background-tasks';

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentToolResult {
  callId: string;
  name: string;
  ok: boolean;
  result?: unknown;
  error?: string;
  durationMs?: number;
}

export interface AgentProgressEvent {
  type: 'llm_start' | 'llm_response' | 'tool_start' | 'tool_result' | 'tool_error' | 'permission_request' | 'permission_response' | 'done' | 'error';
  round?: number;
  content?: string;
  toolCall?: AgentToolCall;
  toolResult?: AgentToolResult;
  toolName?: string;
  summary?: string;
  decision?: PermissionDecision;
  error?: string;
  finalContent?: string;
  rounds?: number;
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
}

export interface UseAgentLoopOptions {
  viewer: MolstarViewer | null;
  sessionId?: string;
  onProgress?: (event: AgentProgressEvent) => void;
  /** Called when a tool requires approval — the UI should show a permission card */
  onPermissionRequest?: (request: {
    id: string;
    toolName: string;
    summary: string;
    args: Record<string, unknown>;
  }) => void;
  /** Signal to abort the loop */
  signal?: AbortSignal;
}

export interface AgentLoopResult {
  ok: boolean;
  finalContent: string;
  toolResults: AgentToolResult[];
  rounds: number;
  error?: string;
}

/** Map agent tool calls to LlmCommand objects expected by executeCommand */
function toolCallToCommand(name: string, args: Record<string, unknown>): Record<string, unknown> | null {
  switch (name) {
    case 'pdb_load':
      return { type: 'load_pdb', id: args.id };
    case 'pdb_analyze': {
      const params: Record<string, unknown> = {
        chain1: args.chain1,
        chain2: args.chain2,
      };
      if (args.ligandCompId) params.ligandCompId = args.ligandCompId;
      if (args.radius) params.radius = args.radius;
      return {
        type: 'analyze_run',
        pdbId: args.pdbId || '',
        recipe: args.recipe,
        params,
      };
    }
    case 'set_representation':
      return { type: 'set_representation', preset: args.preset, structures: 'all' };
    case 'set_color_theme':
      return { type: 'set_color_theme', theme: args.theme, structures: 'all' };
    case 'focus_ligand':
      return { type: 'focus_ligand', compId: args.compId };
    case 'focus_residue':
      return { type: 'focus_residue', chain: args.chain, resno: args.resno };
    case 'capture_multi_angle':
      return {
        type: 'capture_multi_angle',
        angles: args.angles || ['front', 'side', 'top'],
      };
    case 'measure_distance':
      return {
        type: 'measure_distance',
        a: { chain: args.a_chain, resno: args.a_resno, atom: args.a_atom || 'CA' },
        b: { chain: args.b_chain, resno: args.b_resno, atom: args.b_atom || 'CA' },
      };
    case 'clear_chat':
      return { type: 'clear_chat' };
    default:
      return null;
  }
}

/** Generate a human-readable summary for the permission UI */
function summarizeToolCall(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'pdb_load':
      return `加载 PDB 结构: ${args.id || '未知'}`;
    case 'pdb_analyze':
      return `运行分析: ${args.recipe || '未知'} (链 ${args.chain1}/${args.chain2})`;
    case 'set_representation':
      return `设置表示方式: ${args.preset || '默认'}`;
    case 'set_color_theme':
      return `设置颜色主题: ${args.theme || '默认'}`;
    case 'focus_ligand':
      return `聚焦配体: ${args.compId || '全部'}`;
    case 'focus_residue':
      return `聚焦残基: ${args.chain}${args.resno}`;
    case 'capture_multi_angle':
      return `多角度截图`;
    case 'measure_distance':
      return `测量距离: ${args.a_chain}${args.a_resno} ↔ ${args.b_chain}${args.b_resno}`;
    case 'clear_chat':
      return `清空聊天记录`;
    default:
      return `执行: ${toolName}`;
  }
}

/** Check if a tool requires user approval before execution */
function requiresApproval(toolName: string): boolean {
  return toolName === 'clear_chat';
}

export function useAgentLoop() {
  const [isRunning, setIsRunning] = useState(false);
  const [currentRound, setCurrentRound] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsRunning(false);
  }, []);

  const run = useCallback(
    async (
      userText: string,
      history: Array<{ role: 'user' | 'assistant'; content: string }>,
      options: UseAgentLoopOptions,
    ): Promise<AgentLoopResult> => {
      if (!options.viewer) {
        return { ok: false, finalContent: '', toolResults: [], rounds: 0, error: 'No viewer available' };
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setIsRunning(true);

      const MAX_ROUNDS = 10;
      const allToolResults: AgentToolResult[] = [];
      const sessionId = options.sessionId || `agent-${Date.now()}`;

      // Build the initial message array (include history + new user message)
      const messages: AgentMessage[] = [
        ...history.map((m) => ({ role: m.role, content: m.content }) as AgentMessage),
        { role: 'user' as const, content: userText },
      ];

      // Log the user message to the session manager
      sessionManager.append(sessionId, {
        type: 'user_message',
        data: { content: userText },
      });

      try {
        for (let round = 0; round < MAX_ROUNDS; round++) {
          setCurrentRound(round);
          options.onProgress?.({ type: 'llm_start', round });

          if (controller.signal.aborted) {
            break;
          }

          // Call the agent round API
          let resp: Response | null = null;
          let lastErr: string | null = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              resp = await fetch('/api/llm/agent/round', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  messages,
                  toolResults: round > 0 ? allToolResults.slice(-4) : undefined,
                  sessionId,
                }),
                signal: controller.signal,
              });
              if (resp.ok) break;
              const errBody = await resp.json().catch(() => ({}));
              lastErr = errBody.error || `HTTP ${resp.status}`;
              if (resp.status === 400) break;
            } catch (e: unknown) {
              if (controller.signal.aborted) break;
              lastErr = e instanceof Error ? e.message : String(e);
            }
            if (attempt < 2) {
              await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
            }
          }

          if (!resp || !resp.ok) {
            const error = lastErr || 'Agent round failed';
            options.onProgress?.({ type: 'error', error });
            return { ok: false, finalContent: '', toolResults: allToolResults, rounds: round, error };
          }

          const data = await resp.json();
          const { done, content, toolCalls } = data;

          // If the LLM returned text only, we're done
          if (done) {
            messages.push({ role: 'assistant', content });
            sessionManager.append(sessionId, {
              type: 'assistant_message',
              data: { content, round },
            });
            options.onProgress?.({ type: 'done', finalContent: content, rounds: round + 1 });
            setIsRunning(false);
            return { ok: true, finalContent: content, toolResults: allToolResults, rounds: round + 1 };
          }

          // LLM returned tool calls — add the assistant message with tool_calls
          messages.push({
            role: 'assistant',
            content: content || '',
            tool_calls: toolCalls.map((tc: AgentToolCall) => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
            })),
          });

          options.onProgress?.({ type: 'llm_response', content: content || '', round });

          // Execute each tool call
          for (const call of toolCalls as AgentToolCall[]) {
            if (controller.signal.aborted) break;

            options.onProgress?.({ type: 'tool_start', toolCall: call });

            // Log the tool call to session manager
            sessionManager.append(sessionId, {
              type: 'tool_call',
              data: { name: call.name, arguments: call.arguments, callId: call.id },
            });

            // Check permissions
            if (requiresApproval(call.name)) {
              if (!permissionStore.isApproved(call.name)) {
                const summary = summarizeToolCall(call.name, call.arguments);
                options.onProgress?.({
                  type: 'permission_request',
                  toolName: call.name,
                  summary,
                });

                // Notify the UI to show a permission card
                if (options.onPermissionRequest) {
                  options.onPermissionRequest({
                    id: call.id,
                    toolName: call.name,
                    summary,
                    args: call.arguments,
                  });
                }

                // Wait for the user's decision via the permission store
                const response = await permissionStore.requestApproval(
                  call.name,
                  summarizeToolCall(call.name, call.arguments),
                  call.arguments,
                  summary,
                );

                options.onProgress?.({
                  type: 'permission_response',
                  decision: response.decision,
                  toolName: call.name,
                });

                sessionManager.append(sessionId, {
                  type: 'permission_response',
                  data: { callId: call.id, decision: response.decision, note: response.note },
                });

                if (response.decision === 'deny') {
                  const result: AgentToolResult = {
                    callId: call.id,
                    name: call.name,
                    ok: false,
                    error: `User denied: ${response.note || 'Permission denied'}`,
                  };
                  allToolResults.push(result);
                  continue;
                }
              }
            }

            // Convert the tool call to an LlmCommand and execute
            const cmd = toolCallToCommand(call.name, call.arguments);
            if (!cmd) {
              const result: AgentToolResult = {
                callId: call.id,
                name: call.name,
                ok: false,
                error: `Unknown tool: ${call.name}`,
              };
              allToolResults.push(result);
              options.onProgress?.({ type: 'tool_error', toolCall: call, error: result.error! });
              continue;
            }

            const startTime = Date.now();
            try {
              // Execute via the existing Molstar command executor
              const execResult: CommandResult = await executeCommand(
                options.viewer,
                cmd as any,
              );

              const durationMs = Date.now() - startTime;
              const result: AgentToolResult = {
                callId: call.id,
                name: call.name,
                ok: execResult.ok,
                result: execResult.ok
                  ? {
                      detail: execResult.detail,
                      analysisResult: execResult.analysisResult,
                    }
                  : undefined,
                error: execResult.ok ? undefined : execResult.detail,
                durationMs,
              };
              allToolResults.push(result);

              options.onProgress?.({ type: 'tool_result', toolResult: result });

              sessionManager.append(sessionId, {
                type: 'tool_result',
                data: {
                  callId: call.id,
                  name: call.name,
                  ok: result.ok,
                  durationMs,
                  detail: execResult.detail,
                },
              });

              // If this was a long-running analysis, track it as a background task
              if (call.name === 'pdb_analyze' && execResult.ok) {
                backgroundTaskManager.enqueue({
                  module: 'analysis',
                  title: summarizeToolCall(call.name, call.arguments),
                  execute: async () => execResult,
                });
              }
            } catch (err: any) {
              const durationMs = Date.now() - startTime;
              const error = err?.message || String(err);
              const result: AgentToolResult = {
                callId: call.id,
                name: call.name,
                ok: false,
                error,
                durationMs,
              };
              allToolResults.push(result);
              options.onProgress?.({ type: 'tool_error', toolCall: call, error });

              sessionManager.append(sessionId, {
                type: 'tool_result',
                data: { callId: call.id, name: call.name, ok: false, error },
              });
            }
          }

          // Continue to the next round — the API will receive the toolResults
        }

        // Max rounds reached
        const finalContent = '已达到最大工具调用轮次 (10)。以上是已完成的分析结果。';
        options.onProgress?.({ type: 'done', finalContent, rounds: MAX_ROUNDS });
        setIsRunning(false);
        return { ok: true, finalContent, toolResults: allToolResults, rounds: MAX_ROUNDS };
      } catch (err: any) {
        const error = err?.message || String(err);
        options.onProgress?.({ type: 'error', error });
        setIsRunning(false);
        return { ok: false, finalContent: '', toolResults: allToolResults, rounds: 0, error };
      }
    },
    [],
  );

  return { run, stop, isRunning, currentRound };
}
