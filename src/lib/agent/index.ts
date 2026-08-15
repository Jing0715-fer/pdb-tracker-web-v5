/**
 * Agent subsystem — public API.
 *
 * A DeepSeek-Harness-inspired agent layer for the PDB Tracker:
 *   - Append-only session log of durable events (the single source of truth)
 *   - Turn/step agent loop with idle/running phase machine
 *   - Tool registry with pre/execute/post pipeline + permission gating
 *   - LLM adapter seam (ZAI SDK / GLM-4.6 adapter shipped)
 *   - Composable system-prompt assembly (sections / contexts / tools / vars)
 *   - 37 PDB tools bridging to the Molstar 3D viewer (client-side) + RCSB
 *     metadata fetch (server-side)
 *
 * Architecture follows dsh's "everything is a plugin" philosophy: every
 * capability registers on a shared AgentContext and is replaceable. No Cordis
 * dependency — a minimal service registry + EventEmitter stands in.
 */

export * from './types';
export * from './session/types';
export { Session } from './session';
export { SurfaceManager } from './session/surface';
export { Inbox, type InboxMessage, type InboxTarget } from './inbox';
export type {
  Role,
  TextBlock,
  ReasoningBlock,
  ImageBlock,
  ToolCallBlock,
  ToolResultBlock,
  ContentBlock,
  MessageSource,
  BaseMessage,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  Message,
  FinishReason,
  TokenUsage,
  StreamChunk,
  ToolSchema,
  GenerateOptions,
  LlmCallConfig,
  PreparedLlmCall,
  LlmAdapter,
} from './llm/types';
export { BlockAssembler } from './llm/assembler';
export { LlmRuntime, type AdapterHandle } from './llm/adapter';
export type { StreamMiddleware } from './llm/adapter';
export { ZaiLlmAdapter } from './llm/zai-adapter';
export * from './tools/types';
export { ToolRuntime, type PreExecuteListener, type PostExecuteListener, type ToolGuard, type DispatchOptions } from './tools/registry';
export { ApprovalService, type ApprovalOutcome, type ApprovalRequest, type ApprovalResolver } from './tools/approval';
export { SystemPrompt, type PromptAssembly, type PromptContext, type AssembledSection } from './prompt';
export { AgentContext, type AgentContextServices, type AgentEventMap } from './context';
export { AgentLoop, type AgentOptions, type DriveOutcome, type PendingToolCall, type AgentStatus } from './loop';
export { AgentManager, getAgentManager, type CreateSessionOptions, requiresApproval } from './manager';
export {
  upsertSessionRow,
  appendEventRow,
  listSessionRows,
  loadSessionEvents,
  getSessionRow,
  deleteSessionRow,
} from './persistence';
export {
  PDB_TOOLS,
  FETCH_METADATA_TOOL,
  ALL_PDB_TOOLS,
  SERVER_SIDE_TOOLS,
  APPROVAL_REQUIRED,
  ANALYSIS_RECIPES,
  COLOR_THEMES,
  REPRESENTATION_PRESETS,
  CAMERA_ANGLES,
  toolToCommand,
} from './pdb-tools';
