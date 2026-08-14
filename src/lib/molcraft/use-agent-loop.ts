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
import { getToolDefinition } from './tool-definitions';
import { normalizeInteractions, extractResidueLabels, selectBestWithRetry, needsRecapture, buildRecaptureInstruction } from './vlm-client';

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
  /** Round 102: Selected LLM provider (e.g. 'cli:hermes', 'cli:codex', 'zai').
   *  If omitted, defaults to z.ai SDK (the only provider that natively supports
   *  OpenAI-style function calling for tool-calling). */
  provider?: string;
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

/** Map agent tool calls to LlmCommand objects expected by executeCommand.
 * Round 97: Expanded to support all 36 tools. */
function toolCallToCommand(name: string, args: Record<string, unknown>): Record<string, unknown> | null {
  switch (name) {
    // Structure loading
    case 'pdb_load':
      return { type: 'load_pdb', id: args.id };
    case 'load_alphafold':
      return { type: 'load_alphafold', uniprotId: args.uniprotId };
    case 'load_emdb':
      return { type: 'load_emdb', id: args.emdbId, detail: args.detail ?? 3 };
    case 'load_structure_url':
      return { type: 'load_structure_url', url: args.url, format: args.format ?? 'mmcif', isBinary: args.isBinary ?? false };
    // Analysis
    case 'pdb_analyze': {
      const params: Record<string, unknown> = { chain1: args.chain1, chain2: args.chain2 };
      if (args.ligandCompId) params.ligandCompId = args.ligandCompId;
      if (args.radius) params.radius = args.radius;
      return { type: 'analyze_run', pdbId: args.pdbId || '', recipe: args.recipe, params };
    }
    case 'fetch_metadata':
      return { type: 'analyze_metadata', id: args.id, includeInterfaces: args.includeInterfaces ?? true };
    case 'fetch_interface':
      return { type: 'analyze_interface', id: args.id, assembly: args.assembly ?? 1 };
    case 'show_interactions': {
      const cmd: Record<string, unknown> = { type: 'show_interactions', radius: args.radius ?? 8 };
      if (args.target_compId) cmd.target = args.target_compId;
      else if (args.target_chain && args.target_resno) cmd.target = { chain: args.target_chain, resno: args.target_resno };
      else cmd.target = 'ligand';
      return cmd;
    }
    case 'align_structures':
      return { type: 'align_structures', ref: args.ref, mobile: args.mobile, method: args.method ?? 'superpose' };
    case 'show_electrostatic_surface':
      return { type: 'show_electrostatic_surface', chain: args.chain, ionicStrength: args.ionicStrength };
    case 'show_druggable_pocket':
      return { type: 'show_druggable_pocket', ligandCompId: args.ligandCompId, radius: args.radius ?? 8 };
    case 'run_virtual_screening':
      return { type: 'run_virtual_screening', ligandCompId: args.ligandCompId, fragmentSet: args.fragmentSet ?? 'druglike' };
    case 'detect_pockets':
      return { type: 'detect_pockets', minDepth: args.minDepth ?? 100 };
    // Visualization
    case 'set_representation':
      return { type: 'set_representation', preset: args.preset, structures: 'all' };
    case 'set_color_theme':
      return { type: 'set_color_theme', theme: args.theme, structures: 'all' };
    case 'set_uniform_color':
      return { type: 'set_uniform_color', color: args.color, structures: 'all' };
    case 'focus_ligand':
      return { type: 'focus_ligand', compId: args.compId };
    case 'focus_residue':
      return { type: 'focus_residue', chain: args.chain, resno: args.resno };
    case 'focus_chain':
      return { type: 'focus_chain', chain: args.chain };
    case 'reset_camera':
      return { type: 'reset_camera' };
    case 'set_background':
      return { type: 'set_background', color: args.color };
    case 'toggle_spin':
      return { type: 'toggle_spin', speed: args.speed ?? 0.1 };
    case 'toggle_rock':
      return { type: 'toggle_rock' };
    case 'toggle_component_visibility':
      return { type: 'toggle_component_visibility', component: args.component, action: args.action ?? 'toggle' };
    case 'select': {
      const cmd: Record<string, unknown> = { type: 'select', action: args.action ?? 'set' };
      if (args.target_compId) cmd.target = args.target_compId;
      else if (args.target_chain && args.target_resno) cmd.target = { chain: args.target_chain, resno: args.target_resno };
      else cmd.target = 'all';
      return cmd;
    }
    case 'clear_selection':
      return { type: 'clear_selection' };
    case 'clear_interactions':
      return { type: 'clear_interactions' };
    case 'label_residue':
      return { type: 'label_residue', chain: args.chain, resno: args.resno, text: args.text };
    // Measurement
    case 'measure_distance':
      return { type: 'measure_distance', a: { chain: args.a_chain, resno: args.a_resno, atom: args.a_atom || 'CA' }, b: { chain: args.b_chain, resno: args.b_resno, atom: args.b_atom || 'CA' } };
    case 'measure_angle':
      return { type: 'measure_angle', a: { chain: args.a_chain, resno: args.a_resno, atom: args.a_atom || 'CA' }, b: { chain: args.b_chain, resno: args.b_resno, atom: args.b_atom || 'CA' }, c: { chain: args.c_chain, resno: args.c_resno, atom: args.c_atom || 'CA' } };
    case 'measure_dihedral':
      return { type: 'measure_dihedral', a: { chain: args.a_chain, resno: args.a_resno, atom: args.a_atom || 'CA' }, b: { chain: args.b_chain, resno: args.b_resno, atom: args.b_atom || 'CA' }, c: { chain: args.c_chain, resno: args.c_resno, atom: args.c_atom || 'CA' }, d: { chain: args.d_chain, resno: args.d_resno, atom: args.d_atom || 'CA' } };
    case 'clear_measurements':
      return { type: 'clear_measurements' };
    // Screenshot
    case 'capture_multi_angle': {
      const vizParams: Record<string, unknown> = {};
      if (args.ligandCompId) vizParams.ligandCompId = args.ligandCompId;
      if (args.chain1) vizParams.chain1 = args.chain1;
      if (args.chain2) vizParams.chain2 = args.chain2;
      if (args.interactions) vizParams.interactions = args.interactions;
      const cmd: Record<string, unknown> = {
        type: 'capture_multi_angle',
        recipe: args.recipe,
        angles: args.angles || ['front', 'side', 'top'],
      };
      if (Object.keys(vizParams).length > 0) cmd.vizParams = vizParams;
      if (args.labels) cmd.labels = args.labels;
      if (args.labelFontSize) cmd.labelFontSize = args.labelFontSize;
      return cmd;
    }
    case 'recapture_screenshot': {
      const vizParams2: Record<string, unknown> = {};
      if (args.ligandCompId) vizParams2.ligandCompId = args.ligandCompId;
      if (args.chain1) vizParams2.chain1 = args.chain1;
      if (args.chain2) vizParams2.chain2 = args.chain2;
      if (args.interactions) vizParams2.interactions = args.interactions;
      const cmd2: Record<string, unknown> = {
        type: 'capture_multi_angle',
        recipe: args.recipe,
        angles: args.angles || ['front', 'side', 'top'],
      };
      if (Object.keys(vizParams2).length > 0) cmd2.vizParams = vizParams2;
      if (args.labels) cmd2.labels = args.labels;
      if (args.labelFontSize) cmd2.labelFontSize = args.labelFontSize;
      return cmd2;
    }
    case 'capture_snapshot':
      return { type: 'capture_snapshot', label: args.label };
    case 'export_snapshot':
      return { type: 'export_snapshot' };
    // Session
    case 'clear_chat':
      return { type: 'clear_chat' };
    default:
      return null;
  }
}

/** Generate a human-readable summary for the permission UI.
 * Round 97: Expanded for all tools. */
function summarizeToolCall(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'pdb_load': return `加载 PDB 结构: ${args.id || '未知'}`;
    case 'load_alphafold': return `加载 AlphaFold 结构: ${args.uniprotId || '未知'}`;
    case 'load_emdb': return `加载 EMDB 体积图: ${args.emdbId || '未知'}`;
    case 'load_structure_url': return `从 URL 加载结构`;
    case 'pdb_analyze': return `运行分析: ${args.recipe || '未知'} (链 ${args.chain1}/${args.chain2})`;
    case 'fetch_metadata': return `获取 PDB 元数据: ${args.id || '未知'}`;
    case 'fetch_interface': return `获取界面数据: ${args.id || '未知'}`;
    case 'show_interactions': return `显示互作环境`;
    case 'align_structures': return `对齐结构`;
    case 'show_electrostatic_surface': return `显示静电势表面`;
    case 'show_druggable_pocket': return `显示可成药口袋: ${args.ligandCompId || ''}`;
    case 'run_virtual_screening': return `运行虚拟筛选`;
    case 'detect_pockets': return `检测口袋`;
    case 'set_representation': return `设置表示方式: ${args.preset || '默认'}`;
    case 'set_color_theme': return `设置颜色主题: ${args.theme || '默认'}`;
    case 'set_uniform_color': return `设置统一颜色: ${args.color || ''}`;
    case 'focus_ligand': return `聚焦配体: ${args.compId || '全部'}`;
    case 'focus_residue': return `聚焦残基: ${args.chain}${args.resno}`;
    case 'focus_chain': return `聚焦链: ${args.chain}`;
    case 'reset_camera': return `重置相机`;
    case 'set_background': return `设置背景色: ${args.color || ''}`;
    case 'toggle_spin': return `切换旋转动画`;
    case 'toggle_rock': return `切换摇摆动画`;
    case 'toggle_component_visibility': return `切换组件可见性: ${args.component || ''}`;
    case 'select': return `选择残基`;
    case 'clear_selection': return `清除选择`;
    case 'clear_interactions': return `清除互作显示`;
    case 'label_residue': return `标记残基: ${args.chain}${args.resno}`;
    case 'measure_distance': return `测量距离: ${args.a_chain}${args.a_resno} ↔ ${args.b_chain}${args.b_resno}`;
    case 'measure_angle': return `测量角度`;
    case 'measure_dihedral': return `测量二面角`;
    case 'clear_measurements': return `清除所有测量`;
    case 'capture_multi_angle': return `多角度截图`;
    case 'capture_snapshot': return `截取当前视图`;
    case 'export_snapshot': return `导出 PNG 截图`;
    case 'clear_chat': return `清空聊天记录`;
    default: return `执行: ${toolName}`;
  }
}

/** Check if a tool requires user approval before execution.
 * Round 97: Now consults the shared tool definitions instead of hardcoding. */
function requiresApproval(toolName: string): boolean {
  const def = getToolDefinition(toolName);
  return def?.requiresApproval === true;
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
      // Round 102: Pass the user's selected provider. Default to z.ai SDK
      // when none is specified, because that's the only provider that
      // natively supports OpenAI-style function calling. If the user picked
      // hermes/codex, the route will fall back to z.ai internally.
      const providerFromOptions = options.provider || 'zai';
      // R98.6: Track the last pdb_analyze result so we can auto-inject
      // interactions/labels into subsequent capture_multi_angle calls
      let lastAnalysisData: Record<string, unknown> | undefined = undefined;
      // R100.2: Track recapture count per recipe to prevent infinite loops
      const recaptureCount = new Map<string, number>();
      const MAX_RECAPTURES = 2;

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
                  // Round 102: Pass the selected chat provider so the route
                  // can route to the correct LLM (e.g. cli:hermes, cli:codex).
                  provider: providerFromOptions,
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

            // R100.2: Check recapture limit — if exceeded, skip the call and
            // tell the LLM we've hit the max
            if (call.name === 'recapture_screenshot') {
              const recipeKey = (call.arguments.recipe as string) || 'unknown';
              const count = recaptureCount.get(recipeKey) || 0;
              if (count >= MAX_RECAPTURES) {
                const result: AgentToolResult = {
                  callId: call.id,
                  name: call.name,
                  ok: false,
                  error: `已达到最大重截图次数 (${MAX_RECAPTURES})。请基于现有截图继续分析，或手动调整视角后重试。`,
                };
                allToolResults.push(result);
                options.onProgress?.({ type: 'tool_error', toolCall: call, error: result.error! });
                continue;
              }
              recaptureCount.set(recipeKey, count + 1);
            }

            // R98.6: For capture_multi_angle/recapture_screenshot, auto-inject
            // interactions + labels from the last pdb_analyze result if the
            // LLM didn't pass them explicitly
            if ((call.name === 'capture_multi_angle' || call.name === 'recapture_screenshot') && lastAnalysisData) {
              if (!call.arguments.interactions) {
                const interactions = normalizeInteractions(lastAnalysisData);
                if (interactions.length > 0) call.arguments.interactions = interactions;
              }
              if (!call.arguments.labels) {
                const labels = extractResidueLabels(lastAnalysisData, 12);
                if (labels.length > 0) call.arguments.labels = labels;
              }
              if (!call.arguments.ligandCompId) {
                const ligand = (lastAnalysisData.ligand as string | undefined) ||
                  ((lastAnalysisData.bindingPocket as Record<string, unknown> | undefined)?.ligand as string | undefined);
                if (ligand) call.arguments.ligandCompId = ligand;
              }
              if (!call.arguments.chain1 && (lastAnalysisData.allInteractions as Record<string, unknown> | undefined)?.chain1) {
                call.arguments.chain1 = (lastAnalysisData.allInteractions as Record<string, unknown>).chain1;
              }
              if (!call.arguments.chain2 && (lastAnalysisData.allInteractions as Record<string, unknown> | undefined)?.chain2) {
                call.arguments.chain2 = (lastAnalysisData.allInteractions as Record<string, unknown>).chain2;
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
              // R104.2: Retry mechanism for pdb_analyze (up to 2 attempts)
              let execResult: CommandResult;
              const MAX_TOOL_RETRIES = call.name === 'pdb_analyze' ? 2 : 1;
              let lastToolError: string | null = null;
              for (let toolAttempt = 0; toolAttempt < MAX_TOOL_RETRIES; toolAttempt++) {
                execResult = await executeCommand(options.viewer, cmd as any);
                if (execResult.ok || toolAttempt >= MAX_TOOL_RETRIES - 1) break;
                lastToolError = execResult.detail || 'Failed';
                // Wait with exponential backoff (0.5s, 1s)
                await new Promise(r => setTimeout(r, 500 * Math.pow(2, toolAttempt)));
              }
              // execResult is guaranteed to be set here (loop runs at least once)

              const durationMs = Date.now() - startTime;
              const result: AgentToolResult = {
                callId: call.id,
                name: call.name,
                ok: execResult.ok,
                result: execResult.ok
                  ? {
                      detail: execResult.detail,
                      analysisResult: execResult.analysisResult,
                      data: (execResult as any).data,
                    }
                  : undefined,
                error: execResult.ok ? undefined : execResult.detail,
                durationMs,
              };
              allToolResults.push(result);

              // R98.6: Store analysis data from pdb_analyze for later use
              // by capture_multi_angle (auto-inject interactions/labels)
              if (call.name === 'pdb_analyze' && execResult.ok) {
                const ar = (execResult as any).analysisResult;
                lastAnalysisData = (ar?.data as Record<string, unknown> | undefined) || (ar as Record<string, unknown> | undefined);
              }

              // R99.2: For capture_multi_angle/recapture_screenshot, call VLM
              // and append quality feedback to the tool result so the LLM can
              // decide whether to call recapture_screenshot
              if ((call.name === 'capture_multi_angle' || call.name === 'recapture_screenshot') && execResult.ok) {
                const screenshots = (execResult as any).data?.screenshots || [];
                if (screenshots.length > 0) {
                  const recipe = (call.arguments.recipe as string) || 'unknown';
                  const analysisSummary = JSON.stringify(lastAnalysisData || {}).slice(0, 2000);
                  try {
                    // R100.4: Emit progress event while VLM is analyzing
                    options.onProgress?.({
                      type: 'tool_result',
                      toolResult: {
                        callId: call.id,
                        name: 'vlm_analyzing',
                        ok: true,
                        result: { detail: `VLM 正在分析 ${screenshots.length} 张截图...`, recipe },
                      },
                    });
                    const vlmData = await selectBestWithRetry(screenshots, recipe, analysisSummary);
                    if (vlmData) {
                      // Attach VLM result to the tool result
                      (result as any).vlmResult = vlmData;
                      // If quality is unacceptable, append feedback to the result detail
                      if (needsRecapture(vlmData)) {
                        const instruction = buildRecaptureInstruction(vlmData, recipe);
                        (result as any).error = instruction;
                        (result as any).ok = true; // capture succeeded, but VLM flagged issues
                        // Override the result content sent to LLM
                        (result as any).result = {
                          detail: `Captured ${screenshots.length} screenshots. VLM quality: ${vlmData.quality}. ${instruction}`,
                          vlmFeedback: instruction,
                          quality: vlmData.quality,
                          issues: vlmData.issues,
                          recaptureHints: vlmData.recaptureHints,
                        };
                      } else {
                        (result as any).result = {
                          detail: `Captured ${screenshots.length} screenshots. VLM quality: ${vlmData.quality}. Best: angle ${screenshots[vlmData.bestIndex]?.angle || 'unknown'}.`,
                          vlmQuality: vlmData.quality,
                          bestIndex: vlmData.bestIndex,
                          scores: vlmData.scores,
                        };
                      }
                    }
                  } catch (vlmErr) {
                    console.warn('[agent] VLM analysis failed:', vlmErr);
                  }
                }
              }

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
