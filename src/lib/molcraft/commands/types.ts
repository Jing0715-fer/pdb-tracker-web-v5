/**
 * Shared types for the Molstar command executor.
 *
 * Extracted from commands.ts (R138) as part of the module split.
 */

export interface CommandResult {
  ok: boolean;
  detail?: string;
  /** Optional data to return to the UI (e.g. measurement values, analysis results). */
  data?: Record<string, unknown>;
  /** For analyze_* commands: the raw analysis result to feed back to the LLM. */
  analysisResult?: unknown;
}
