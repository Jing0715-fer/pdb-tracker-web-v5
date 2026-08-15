/**
 * Tool Registry — Core infrastructure for the tool-calling agent loop.
 *
 * This replaces the ReAct-in-prompt approach where the LLM returns JSON
 * commands that are parsed and executed. Instead, tools are registered
 * with typed schemas, the LLM calls them via function calling, and
 * results are fed back through a structured pipeline.
 *
 * Each tool has:
 * - name: unique identifier (e.g. "pdb_load", "pdb_analyze")
 * - description: what the tool does (shown to the LLM)
 * - parameters: JSON schema for input validation
 * - execute: the function that runs when the tool is called
 * - requiresApproval: whether the tool needs user approval before running
 * - category: grouping for UI display
 */

export type ToolCategory = "structure" | "analysis" | "visualization" | "measurement" | "session" | "system";

export interface ToolParameter {
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  enum?: string[];
  default?: unknown;
  required?: boolean;
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  category: ToolCategory;
  parameters: Record<string, ToolParameter>;
  requiresApproval?: boolean;
  timeoutMs?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  callId: string;
  name: string;
  ok: boolean;
  result?: unknown;
  error?: string;
  durationMs?: number;
  approved?: boolean;
}

export type ToolExecutor = (
  args: Record<string, unknown>,
  context: ToolExecutionContext,
) => Promise<unknown>;

export interface ToolExecutionContext {
  /** The Molstar viewer instance (available in browser) */
  viewer?: unknown;
  /** The current PDB ID */
  pdbId?: string;
  /** Session ID for context sharing */
  sessionId?: string;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

export interface RegisteredTool {
  definition: ToolDefinition;
  executor: ToolExecutor;
}

/**
 * The global tool registry. Tools are registered at module load time
 * and can be looked up by name at runtime.
 */
class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(definition: ToolDefinition, executor: ToolExecutor): void {
    if (this.tools.has(definition.name)) {
      console.warn(`[tool-registry] Tool "${definition.name}" is already registered — overwriting`);
    }
    this.tools.set(definition.name, { definition, executor });
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  list(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  listByCategory(category: ToolCategory): RegisteredTool[] {
    return this.list().filter((t) => t.definition.category === category);
  }

  /** Returns tool definitions in the format expected by LLM function calling */
  toFunctionDefinitions(): Array<{
    name: string;
    description: string;
    parameters: { type: "object"; properties: Record<string, unknown>; required: string[] };
  }> {
    return this.list().map(({ definition }) => {
      const required: string[] = [];
      const properties: Record<string, unknown> = {};
      for (const [key, param] of Object.entries(definition.parameters)) {
        properties[key] = {
          type: param.type,
          description: param.description,
          ...(param.enum ? { enum: param.enum } : {}),
          ...(param.default !== undefined ? { default: param.default } : {}),
          ...(param.items ? { items: param.items } : {}),
          ...(param.properties ? { properties: param.properties } : {}),
        };
        if (param.required) required.push(key);
      }
      return {
        name: definition.name,
        description: definition.description,
        parameters: { type: "object" as const, properties, required },
      };
    });
  }

  /** Validate tool call arguments against the definition */
  validate(name: string, args: Record<string, unknown>): { ok: boolean; errors: string[] } {
    const tool = this.get(name);
    if (!tool) return { ok: false, errors: [`Unknown tool: ${name}`] };
    const errors: string[] = [];
    for (const [key, param] of Object.entries(tool.definition.parameters)) {
      if (param.required && !(key in args)) {
        errors.push(`Missing required parameter: ${key}`);
      }
      if (key in args) {
        const val = args[key];
        if (param.type === "string" && typeof val !== "string") {
          errors.push(`Parameter "${key}" must be a string, got ${typeof val}`);
        } else if (param.type === "number" && typeof val !== "number") {
          errors.push(`Parameter "${key}" must be a number, got ${typeof val}`);
        } else if (param.type === "boolean" && typeof val !== "boolean") {
          errors.push(`Parameter "${key}" must be a boolean, got ${typeof val}`);
        } else if (param.enum && !param.enum.includes(String(val))) {
          errors.push(`Parameter "${key}" must be one of: ${param.enum.join(", ")}`);
        }
      }
    }
    return { ok: errors.length === 0, errors };
  }

  clear(): void {
    this.tools.clear();
  }
}

export const toolRegistry = new ToolRegistry();
