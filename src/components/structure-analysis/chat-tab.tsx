"use client";

/**
 * ChatTab — the agent chat panel for Structure Analysis.
 *
 * Ported from Molcraft's chat-panel.tsx, adapted to:
 *   - Use pdb-tracker-web-v5's run-center LLM provider system (GET /api/llm/providers)
 *     instead of Molcraft's CLI agent detection (/api/llm/agents).
 *   - Store chat messages in the Zustand store (chatMessages/addChatMessage/etc).
 *   - Call POST /api/llm/chat (our new endpoint that wraps src/lib/llm.ts).
 *
 * Features:
 *   - Provider selector pills (fetched from /api/llm/providers, shared with run center
 *     via the same localStorage key)
 *   - Message list with user/assistant bubbles (markdown rendering)
 *   - Input textarea (Enter to send, Shift+Enter for newline)
 *   - Suggestion chips for quick prompts
 *   - Agent loop: sends message → LLM returns commands → executes commands via
 *     executeCommand on the Molstar viewer → feeds results back → loops until
 *     the agent stops requesting continuation (ReAct pattern, up to 8 rounds)
 *   - Clear chat button
 */

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send, Loader2, Trash2, Sparkles, User, Bot, ChevronDown, RefreshCw, Zap, Check, X, Square, RotateCcw, Terminal, Brain, Cog, Clock, Download, AlertCircle, Copy, Play, Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAppStore, type ChatMessage } from "@/lib/molcraft/store";
import { executeCommand } from "@/lib/molcraft/commands";
import type { LlmCommand } from "@/lib/molcraft/command-schema";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface LlmProviderInfo {
  provider: string;
  bin: string | null;
  icon: string;
  iconUrl?: string | null;
  label: string;
  available: boolean;
  description?: string;
}

/**
 * Wait for the user to confirm or deny a destructive command execution.
 * Polls the store for the `confirmationResult` field on the message.
 * Times out after 60 seconds (defaults to "skip" = false).
 */
async function waitForConfirmation(
  messageId: string,
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void
): Promise<boolean> {
  const MAX_WAIT = 60_000;
  const POLL_INTERVAL = 200;
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT) {
    const msg = useAppStore.getState().chatMessages.find((m) => m.id === messageId);
    if (msg?.confirmationResult !== undefined) {
      const result = msg.confirmationResult;
      // Clear the confirmation state
      updateMessage(messageId, { needsConfirmation: false, confirmationResult: undefined });
      return result;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  // Timeout — default to skip
  updateMessage(messageId, { needsConfirmation: false, confirmationResult: undefined });
  return false;
}

const SUGGESTIONS = [
  {
    icon: "🔬",
    title: "Analyze complex",
    prompt:
      "Load 1CBS and analyze its structure: get metadata, run hydrogen bond and salt bridge analysis on chain A, and summarize the key interactions.",
  },
  {
    icon: "🧪",
    title: "Active site analysis",
    prompt:
      "Load 6LU7 (SARS-CoV-2 Mpro) and analyze the ligand binding pocket — run hydrogen bonds and salt bridges between chain A and the ligand, then focus the camera on the ligand.",
  },
  {
    icon: "🧬",
    title: "Oligomer analysis",
    prompt:
      "Load 4HHB (hemoglobin) and analyze all chain-chain interactions. Set the representation to cartoon with chain coloring.",
  },
  {
    icon: "🎨",
    title: "Visualize",
    prompt:
      "Load 1CBS, set the representation to ball-and-stick, color by element, then focus on residue ARG30.",
  },
];

/**
 * Improvement #5: Convert a command object to a human-readable description.
 * Used in the command preview panel before execution.
 */
function describeCommand(cmd: LlmCommand): string {
  switch (cmd.type) {
    case "load_pdb": return `Load PDB ${cmd.id}`;
    case "load_alphafold": return `Load AlphaFold ${cmd.uniprotId}`;
    case "load_emdb": return `Load EMDB ${cmd.emdbId}`;
    case "load_structure_url": return `Load structure from URL`;
    case "load_structure_data": return `Load structure data`;
    case "set_representation": return `Set representation: ${cmd.preset}`;
    case "set_color_theme": return `Color by ${cmd.theme}`;
    case "set_uniform_color": return `Set uniform color ${cmd.color}`;
    case "focus_residue": return `Focus on residue ${cmd.chain || ""}${cmd.resno || ""}`;
    case "focus_ligand": return `Focus on ligand ${cmd.compId}`;
    case "focus_chain": return `Focus on chain ${cmd.chain}`;
    case "focus_selection": return `Focus on selection`;
    case "reset_camera": return `Reset camera`;
    case "measure_distance": return `Measure distance`;
    case "measure_angle": return `Measure angle`;
    case "measure_dihedral": return `Measure dihedral`;
    case "label_residue": return `Label residue`;
    case "show_interactions": return `Show interactions`;
    case "clear_measurements": return `Clear measurements`;
    case "clear_interactions": return `Clear interactions`;
    case "toggle_spin": return `Toggle spin`;
    case "toggle_rock": return `Toggle rock`;
    case "stop_animation": return `Stop animation`;
    case "export_snapshot": return `Export snapshot`;
    case "capture_snapshot": return `Capture snapshot${cmd.label ? ": " + cmd.label : ""}`;
    case "select": return `Select`;
    case "clear_selection": return `Clear selection`;
    case "toggle_component_visibility": return `Toggle ${cmd.component} visibility`;
    case "load_volume_url": return `Load volume`;
    case "align_structures": return `Align structures`;
    case "set_background": return `Set background ${cmd.color}`;
    case "set_granularity": return `Set granularity: ${cmd.granularity}`;
    case "analyze_metadata": return `Get metadata for ${cmd.id}`;
    case "analyze_interface": return `Analyze interface (assembly ${cmd.assembly || 1})`;
    case "analyze_cli_list": return `List available CLI tools`;
    case "analyze_run": {
      const p = cmd.params as Record<string, unknown> | undefined;
      const chainInfo = p?.chain1 && p?.chain2 ? ` (${p.chain1}↔${p.chain2})` : "";
      return `Run ${cmd.recipe}${chainInfo}`;
    }
    case "show_electrostatic_surface": return `Show electrostatic surface`;
    case "show_druggable_pocket": return `Show druggable pocket (${cmd.ligandCompId})`;
    case "run_virtual_screening": return `Run virtual screening (${cmd.fragmentSet || "druglike"})`;
    case "detect_pockets": return `Detect pockets`;
    default: return cmd.type || "unknown";
  }
}

/** Improvement #2: Map an agentStep to a human-readable label + icon. */
const STEP_LABELS: Record<string, { label: string; icon: typeof Brain }> = {
  "thinking": { label: "Thinking…", icon: Brain },
  "calling-llm": { label: "Calling LLM…", icon: Brain },
  "parsing": { label: "Parsing response…", icon: Cog },
  "executing": { label: "Executing commands…", icon: Terminal },
  "done": { label: "Done", icon: Check },
  "error": { label: "Error", icon: X },
};

export function ChatTab() {
  const [input, setInput] = useState("");
  const messages = useAppStore((s) => s.chatMessages);
  const addMessage = useAppStore((s) => s.addChatMessage);
  const updateMessage = useAppStore((s) => s.updateChatMessage);
  const clearChat = useAppStore((s) => s.clearChat);
  const chatProvider = useAppStore((s) => s.chatProvider);
  const setChatProvider = useAppStore((s) => s.setChatProvider);
  const viewer = useAppStore((s) => s.viewer);
  const structures = useAppStore((s) => s.structures);
  const toast = useAppStore((s) => s.toast);
  const logCommand = useAppStore((s) => s.logCommand);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Improvement #3: Retry handler — re-sends the last user message.
  const handleRetry = useCallback(
    (retryPrompt: string) => {
      if (!retryPrompt.trim() || sendingRef.current) return;
      send(retryPrompt);
    },
    // send is defined below via useCallback; we use a ref to avoid stale closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Improvement #3: Listen for retry events from MessageBubble
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail) handleRetry(detail);
    };
    window.addEventListener(RETRY_EVENT, handler);
    return () => window.removeEventListener(RETRY_EVENT, handler);
  }, [handleRetry]);

  // Round 3: Listen for command re-execution events from MessageBubble
  useEffect(() => {
    const handler = async (e: Event) => {
      const cmd = (e as CustomEvent<LlmCommand>).detail;
      if (!cmd || !viewer || sendingRef.current) return;
      try {
        const result = await executeCommand(viewer, cmd);
        toast(
          result.ok
            ? `✓ Re-executed: ${describeCommand(cmd)}`
            : `✗ Failed: ${result.detail || "Unknown error"}`,
          result.ok ? "success" : "error"
        );
        logCommand({ type: cmd.type, ok: result.ok, detail: result.detail });
      } catch (err) {
        toast(`✗ Error: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
    };
    window.addEventListener(REEXEC_EVENT, handler);
    return () => window.removeEventListener(REEXEC_EVENT, handler);
  }, [viewer, toast, logCommand]);

  // Abort any in-flight SSE stream on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  // Provider list (from run center's /api/llm/providers)
  const [providers, setProviders] = useState<LlmProviderInfo[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providerOpen, setProviderOpen] = useState(false);

  const refreshProviders = useCallback(async () => {
    setProvidersLoading(true);
    try {
      const res = await fetch("/api/llm/providers");
      if (res.ok) {
        const data = await res.json();
        const all = (data.available || []) as LlmProviderInfo[];
        setProviders(all);
      }
    } catch {
      /* ignore */
    } finally {
      setProvidersLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshProviders();
  }, [refreshProviders]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  const activeProviderInfo = providers.find((p) => p.provider === chatProvider);
  const providerLabel = chatProvider === "" || chatProvider === "auto"
    ? "Auto"
    : activeProviderInfo?.label || chatProvider;

  /** Improvement #3 (round 2): Export chat history as Markdown. */
  const handleExportMarkdown = useCallback(() => {
    if (messages.length === 0) {
      toast("No messages to export", "error");
      return;
    }
    const lines: string[] = [
      `# Chat Export — ${new Date().toLocaleString()}`,
      "",
      `**Provider:** ${providerLabel}`,
      `**Messages:** ${messages.length}`,
      "",
      "---",
      "",
    ];
    for (const m of messages) {
      if (m.role === "user") {
        lines.push(`## 👤 User`);
        lines.push("");
        lines.push(m.content);
        lines.push("");
      } else {
        const modelInfo = [m.provider, m.model].filter(Boolean).join(" · ");
        const durationInfo = m.durationMs != null
          ? ` · ${m.durationMs < 1000 ? `${m.durationMs}ms` : `${(m.durationMs / 1000).toFixed(1)}s`}`
          : "";
        lines.push(`## 🤖 Assistant${modelInfo ? ` (${modelInfo}${durationInfo})` : ""}`);
        lines.push("");
        if (m.content) {
          lines.push(m.content);
          lines.push("");
        }
        if (m.commands && Array.isArray(m.commands) && m.commands.length > 0) {
          lines.push(`**Commands executed (${m.commands.length}):**`);
          lines.push("");
          m.commands.forEach((cmd, i) => {
            const c = cmd as { type?: string; status?: string; error?: string; durationMs?: number };
            const desc = describeCommand(c as unknown as LlmCommand);
            const status = c.status || (c.error ? "error" : "done");
            const icon = status === "error" ? "❌" : status === "done" ? "✅" : "⏳";
            const time = c.durationMs != null
              ? ` (${c.durationMs < 1000 ? `${c.durationMs}ms` : `${(c.durationMs / 1000).toFixed(1)}s`})`
              : "";
            lines.push(`${i + 1}. ${icon} ${desc}${time}${c.error ? ` — _${c.error}_` : ""}`);
          });
          lines.push("");
        }
        if (m.isError) {
          lines.push(`> ⚠️ **Error** — click Retry in the chat to re-send this request.`);
          lines.push("");
        }
      }
      lines.push("---");
      lines.push("");
    }
    const markdown = lines.join("\n");
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat-export-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${messages.length} messages as Markdown`, "success");
  }, [messages, providerLabel, toast]);

  /**
   * Core send function. Implements the agent ReAct loop:
   * 1. Send user message + history to /api/llm/chat
   * 2. Parse response → { reply, commands, continueAfterAnalysis }
   * 3. Execute commands sequentially; collect analysis results
   * 4. If continueAfterAnalysis, feed results back and loop (up to 8 rounds)
   */
  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sendingRef.current || !viewer) {
        if (!viewer) toast("Load a structure first to use the agent", "error");
        return;
      }
      sendingRef.current = true;
      stopRequestedRef.current = false;

      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        content: trimmed,
        ts: Date.now(),
      };
      const pendingId = `a-${Date.now()}`;
      const pendingMsg: ChatMessage = {
        id: pendingId,
        role: "assistant",
        content: "",
        ts: Date.now(),
        pending: true,
        agentStep: "thinking",
        retryPrompt: trimmed, // Improvement #3: store the prompt for retry
      };
      addMessage(userMsg);
      addMessage(pendingMsg);
      setInput("");

      try {
        const history: Array<{ role: "user" | "assistant"; content: string }> = [
          ...messages.map((m) => ({ role: m.role, content: m.content })),
          { role: "user" as const, content: trimmed },
        ];

        const MAX_ROUNDS = 8;
        const allCommands: unknown[] = [];
        const allAnalysisResults: Array<{ type: string; ok: boolean; detail?: string; data?: unknown }> = [];

        for (let round = 0; round < MAX_ROUNDS; round++) {
          // P1: For rounds 2+, show a brief "continuing analysis" hint before
          // the streaming text arrives. This is overwritten as soon as the
          // first SSE chunk arrives (accumulatedReply replaces it).
          if (round > 0) {
            updateMessage(pendingId, {
              content: `🔍 Round ${round + 1}: continuing analysis (${allCommands.length} commands executed, ${allAnalysisResults.length} results so far)…`,
              commands: allCommands,
              pending: true,
              agentStep: "calling-llm",
            });
          } else {
            // Improvement #2: First round — show "Calling LLM…" step
            updateMessage(pendingId, {
              agentStep: "calling-llm",
              pending: true,
            });
          }

          // P2: Check if the user clicked "Stop" — abort the loop early.
          if (stopRequestedRef.current) {
            updateMessage(pendingId, {
              content: `⏹️ Stopped by user after round ${round}.`,
              commands: allCommands.length > 0 ? allCommands : undefined,
              pending: false,
            });
            break;
          }

          // Call the LLM streaming chat endpoint (SSE)
          let res: Response | null = null;
          let lastErr: string | null = null;
          // Create an AbortController for this round so the Stop button
          // can abort the current SSE stream (not just prevent the next round).
          const controller = new AbortController();
          abortRef.current = controller;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              res = await fetch("/api/llm/chat/stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  messages: history,
                  context: {
                    loadedStructures: structures.map((s) => ({ id: s.id, label: s.label })),
                    analysisResults: allAnalysisResults.slice(-5),
                  },
                  provider: chatProvider,
                }),
                signal: controller.signal,
              });
              if (res.ok) break;
              const err = await res.json().catch(() => ({}));
              lastErr = err.error || err.details || `HTTP ${res.status}`;
              if (res.status === 400 || res.status === 404) break;
            } catch (e: unknown) {
              lastErr = e instanceof Error ? e.message : String(e);
            }
            if (attempt < 2) {
              updateMessage(pendingId, {
                content: `⚠️ Retrying… (attempt ${attempt + 2}/3)`,
                pending: true,
              });
              await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
            }
          }

          if (!res || !res.ok) {
            // Improvement #3: Mark as error so the Retry button shows
            updateMessage(pendingId, {
              content: `❌ LLM call failed: ${lastErr || "unknown error"}`,
              pending: false,
              agentStep: "error",
              isError: true,
            });
            break;
          }

          // Parse the SSE stream: read chunks, accumulate the reply text,
          // and update the pending message incrementally (typewriter effect).
          const reader = res.body?.getReader();
          const decoder = new TextDecoder();
          let accumulatedReply = "";
          let commands: LlmCommand[] = [];
          let continueAfter = false;
          let provider: string | undefined;
          let model: string | undefined; // Round 3: model name (e.g. "glm-4.6")
          let streamError: string | null = null;
          let buffer = "";
          const llmStartTime = Date.now(); // Round 3: track LLM response time

          if (reader) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              // SSE events are separated by \n\n
              const events = buffer.split("\n\n");
              buffer = events.pop() || ""; // keep the last partial event
              for (const evt of events) {
                const line = evt.trim();
                if (!line.startsWith("data: ")) continue;
                const jsonStr = line.slice(6);
                try {
                  const data = JSON.parse(jsonStr);
                  if (data.type === "chunk") {
                    accumulatedReply += data.text;
                    updateMessage(pendingId, {
                      content: accumulatedReply,
                      pending: true,
                    });
                  } else if (data.type === "done") {
                    commands = Array.isArray(data.commands) ? data.commands : [];
                    continueAfter = !!data.continueAfterAnalysis;
                    provider = data.provider;
                    model = data.model; // Round 3: capture model name
                  } else if (data.type === "error") {
                    streamError = data.error;
                  }
                } catch {
                  // ignore parse errors for partial chunks
                }
              }
            }
          }

          if (streamError) {
            // Improvement #3: Mark as error so the Retry button shows
            updateMessage(pendingId, {
              content: `❌ ${streamError}`,
              pending: false,
              agentStep: "error",
              isError: true,
            });
            break;
          }

          const reply = accumulatedReply;

          // If the LLM requested commands, execute them
          if (commands.length > 0) {
            // Improvement #5: Command preview — show human-readable descriptions
            // of each command before executing them.
            const cmdSummary = commands.map((c) => describeCommand(c as LlmCommand)).join(", ");

            // Improvement #2: Switch to "executing" step
            updateMessage(pendingId, {
              agentStep: "executing",
              pending: true,
            });

            // Check for destructive commands (require user confirmation)
            const DESTRUCTIVE_TYPES = ["clear_measurements", "clear_interactions", "clear_selection"];
            const hasDestructive = commands.some((c) => DESTRUCTIVE_TYPES.includes((c as LlmCommand).type));

            if (hasDestructive) {
              updateMessage(pendingId, {
                content: `${reply || ""}\n\n⚠️ **Confirmation required** — the agent wants to execute: ${cmdSummary}\n\nClick ✓ to proceed or ✗ to skip these commands.`,
                commands: [...allCommands, ...commands],
                pending: true,
                provider,
                needsConfirmation: true,
              });

              // Wait for user confirmation (the MessageBubble renders confirm/deny buttons
              // when needsConfirmation is set; we poll the store for the resolution)
              const confirmed = await waitForConfirmation(pendingId, updateMessage);
              if (!confirmed) {
                updateMessage(pendingId, {
                  content: `${reply || ""}\n\n⏭️ Skipped destructive commands: ${cmdSummary}`,
                  commands: allCommands.length > 0 ? allCommands : undefined,
                  pending: false,
                  provider,
                  needsConfirmation: false,
                });
                break;
              }
            } else {
              // Improvement #5: Show command preview with human-readable descriptions
              // Improvement #2 (round 2): Push all commands with "pending" status first
              const pendingCmds = commands.map((c) => {
                const cmd = c as LlmCommand;
                return {
                  type: cmd.type,
                  ...("id" in cmd ? { id: cmd.id } : {}),
                  status: "pending" as const,
                };
              });
              allCommands.push(...pendingCmds);
              updateMessage(pendingId, {
                content: `${reply || `⚡ Executing ${commands.length} command(s)…`}`,
                commands: [...allCommands],
                pending: true,
                provider,
                agentStep: "executing",
              });

              // Execute commands one by one, updating status in real-time
              for (let ci = 0; ci < commands.length; ci++) {
                const cmd = commands[ci];
                const cmdIndex = allCommands.length - commands.length + ci;

                // Set this command to "running"
                (allCommands[cmdIndex] as Record<string, unknown>).status = "running";
                updateMessage(pendingId, { commands: [...allCommands] });

                const cmdStartTime = Date.now(); // Round 3: per-command timing
                try {
                  const result = await executeCommand(viewer, cmd);
                  (allCommands[cmdIndex] as Record<string, unknown>).status = result.ok ? "done" : "error";
                  (allCommands[cmdIndex] as Record<string, unknown>).durationMs = Date.now() - cmdStartTime;
                  if (!result.ok) {
                    (allCommands[cmdIndex] as Record<string, unknown>).error = result.detail || "Failed";
                  }
                  logCommand({ type: cmd.type, ok: result.ok, detail: result.detail });
                  if (cmd.type === "analyze_run" || cmd.type === "analyze_metadata" || cmd.type === "analyze_interface") {
                    allAnalysisResults.push({
                      type: cmd.type,
                      ok: result.ok,
                      detail: result.detail,
                      data: (result as { analysisResult?: unknown }).analysisResult,
                    });
                  }
                } catch (err) {
                  (allCommands[cmdIndex] as Record<string, unknown>).status = "error";
                  (allCommands[cmdIndex] as Record<string, unknown>).durationMs = Date.now() - cmdStartTime;
                  (allCommands[cmdIndex] as Record<string, unknown>).error = err instanceof Error ? err.message : String(err);
                  logCommand({ type: cmd.type, ok: false, detail: "Execution error" });
                }

                // Update the message to show the new status
                updateMessage(pendingId, { commands: [...allCommands] });
              }
            }
          }

          // If the agent wants to continue (ReAct), feed results back and loop
          if (continueAfter && commands.length > 0 && round < MAX_ROUNDS - 1) {
            history.push({ role: "assistant", content: reply || JSON.stringify({ commands, reply }) });
            history.push({
              role: "user",
              content: `[Command execution results]\n${allAnalysisResults
                .slice(-commands.length)
                .map((r) => `${r.type}: ${r.ok ? "OK" : "FAILED"}${r.detail ? ` — ${r.detail}` : ""}${r.data ? `\n${JSON.stringify(r.data).slice(0, 1500)}` : ""}`)
                .join("\n")}\n\nContinue your analysis based on these results. If you have enough data, provide the final summary (set continueAfterAnalysis=false).`,
            });
            continue;
          }

          // Done — finalize the message
          updateMessage(pendingId, {
            content: reply || "Done.",
            commands: allCommands.length > 0 ? allCommands : undefined,
            pending: false,
            provider,
            model, // Round 3: model name
            durationMs: Date.now() - llmStartTime, // Round 3: LLM response time
            agentStep: "done",
            isError: false,
          });
          break;
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // Aborted by user (Stop button or unmount) — don't show error
          updateMessage(pendingId, {
            content: `⏹️ Stopped by user.`,
            commands: allCommands.length > 0 ? allCommands : undefined,
            pending: false,
            agentStep: "done",
          });
        } else {
          // Improvement #3: Mark as error so the Retry button shows
          updateMessage(pendingId, {
            content: `❌ Error: ${err instanceof Error ? err.message : String(err)}`,
            pending: false,
            agentStep: "error",
            isError: true,
          });
        }
      } finally {
        abortRef.current = null;
        sendingRef.current = false;
        stopRequestedRef.current = false;
      }
    },
    [viewer, messages, structures, chatProvider, addMessage, updateMessage, logCommand, toast]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Provider selector + clear button */}
      <div className="flex shrink-0 items-center gap-1 border-b border-claude-border-light/40 dark:border-[#3d3832]/40 px-2 py-1.5 bg-claude-bg/40 dark:bg-[#1a1917]/40">
        <Popover open={providerOpen} onOpenChange={setProviderOpen}>
          <PopoverTrigger asChild>
            <button
              className="flex items-center gap-1 rounded-md border border-claude-border-light/60 dark:border-[#3d3832]/60 bg-claude-surface dark:bg-[#242220] px-2 py-1 text-[10px] font-medium text-claude-text hover:border-claude-accent/40 transition-colors"
              title="Select LLM provider"
            >
              {activeProviderInfo?.iconUrl ? (
                <img src={activeProviderInfo.iconUrl} alt="" className="h-3 w-3" />
              ) : (
                <Bot className="h-3 w-3 text-claude-accent" />
              )}
              <span className="max-w-[80px] truncate">{providerLabel}</span>
              <ChevronDown className="h-2.5 w-2.5 text-claude-text-muted" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-1" align="start">
            <div className="space-y-0.5">
              <button
                onClick={() => { setChatProvider(""); setProviderOpen(false); }}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] hover:bg-claude-accent-light/40 transition-colors ${
                  chatProvider === "" ? "bg-claude-accent-light/30 text-claude-accent" : "text-claude-text"
                }`}
              >
                <Sparkles className="h-3 w-3" />
                <div className="flex-1 text-left">
                  <div className="font-medium">Auto</div>
                  <div className="text-[9px] text-claude-text-muted">Use run center's default</div>
                </div>
              </button>
              {providers.map((p) => (
                <button
                  key={p.provider}
                  onClick={() => { setChatProvider(p.provider); setProviderOpen(false); }}
                  disabled={!p.available}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] hover:bg-claude-accent-light/40 transition-colors disabled:opacity-40 ${
                    chatProvider === p.provider ? "bg-claude-accent-light/30 text-claude-accent" : "text-claude-text"
                  }`}
                >
                  {p.iconUrl ? (
                    <img src={p.iconUrl} alt="" className="h-3 w-3" />
                  ) : (
                    <span className="text-sm">{p.icon}</span>
                  )}
                  <div className="flex-1 text-left min-w-0">
                    <div className="font-medium truncate">{p.label}</div>
                    {p.description && (
                      <div className="text-[9px] text-claude-text-muted truncate">{p.description}</div>
                    )}
                  </div>
                  {p.available && (
                    <Badge variant="outline" className="h-3.5 px-1 text-[7px] bg-green-500/10 text-green-600 border-green-500/30">
                      ✓
                    </Badge>
                  )}
                </button>
              ))}
              <div className="border-t border-claude-border-light/40 dark:border-[#3d3832]/40 mt-1 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full h-7 text-[10px] gap-1"
                  onClick={refreshProviders}
                  disabled={providersLoading}
                >
                  <RefreshCw className={`h-3 w-3 ${providersLoading ? "animate-spin" : ""}`} />
                  Refresh providers
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <div className="ml-auto flex items-center gap-0.5">
          {messages.length > 0 && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-claude-text-muted hover:text-claude-accent"
                onClick={handleExportMarkdown}
                title="Export chat as Markdown"
              >
                <Download className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-claude-text-muted hover:text-destructive"
                onClick={() => { clearChat(); toast("Chat cleared", "info"); }}
                title="Clear chat"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto sa-scroll p-2 space-y-2">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
            <div className="rounded-full bg-claude-accent-light/40 p-3">
              <Sparkles className="h-5 w-5 text-claude-accent" />
            </div>
            <div>
              <p className="text-xs font-medium text-claude-text">Molcraft AI Agent</p>
              <p className="text-[10px] text-claude-text-muted mt-0.5 leading-relaxed">
                Ask me to analyze structures, run analyses, or change visualizations.
              </p>
            </div>
            <div className="w-full space-y-1 mt-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.title}
                  onClick={() => send(s.prompt)}
                  className="flex w-full items-start gap-2 rounded-md border border-claude-border-light/40 dark:border-[#3d3832]/40 bg-claude-bg/40 dark:bg-[#1a1917]/40 px-2 py-1.5 text-left hover:border-claude-accent/40 hover:bg-claude-accent-light/20 transition-colors"
                >
                  <span className="text-sm shrink-0">{s.icon}</span>
                  <div className="min-w-0">
                    <div className="text-[10px] font-medium text-claude-text">{s.title}</div>
                    <div className="text-[9px] text-claude-text-muted truncate">{s.prompt}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-claude-border-light/40 dark:border-[#3d3832]/40 p-2">
        <div className="relative">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask the agent to analyze a structure…"
            className="min-h-[44px] max-h-32 resize-none pr-20 text-[11px] leading-relaxed"
            rows={2}
            disabled={sendingRef.current}
          />
          {sendingRef.current && (
            <button
              onClick={() => {
                stopRequestedRef.current = true;
                // Abort the current SSE stream immediately
                if (abortRef.current) {
                  abortRef.current.abort();
                  abortRef.current = null;
                }
              }}
              className="absolute bottom-1.5 right-9 grid h-7 w-7 place-items-center rounded-md bg-destructive text-white hover:bg-destructive/90 transition-colors"
              title="Stop generation"
            >
              <Square className="h-3 w-3 fill-current" />
            </button>
          )}
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || sendingRef.current}
            className="absolute bottom-1.5 right-1.5 grid h-7 w-7 place-items-center rounded-md bg-claude-accent text-white hover:bg-claude-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Send (Enter)"
          >
            {sendingRef.current ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
        <div className="mt-1 flex items-center justify-between text-[8px] text-claude-text-muted">
          <span>Enter to send · Shift+Enter for newline</span>
          <span className="flex items-center gap-1">
            <Zap className="h-2.5 w-2.5" />
            Agent mode
          </span>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Message bubble
// ============================================================

/** Improvement #3: Global event bus for retry — the MessageBubble dispatches a
 *  custom event that the ChatTab listens for, avoiding the need to pass the
 *  send callback through props or the store. */
const RETRY_EVENT = "chat-retry";
function dispatchRetry(prompt: string) {
  window.dispatchEvent(new CustomEvent(RETRY_EVENT, { detail: prompt }));
}

/** Round 3: Global event bus for command re-execution. */
const REEXEC_EVENT = "chat-reexec-command";
function dispatchReexec(cmd: LlmCommand) {
  window.dispatchEvent(new CustomEvent(REEXEC_EVENT, { detail: cmd }));
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const updateMessage = useAppStore((s) => s.updateChatMessage);
  // Improvement #3: Check if any message is currently pending (to disable retry)
  const sending = useAppStore((s) => s.chatMessages.some((m) => m.pending));
  const [copied, setCopied] = useState(false);

  // Round 3: Copy message content to clipboard
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content || "").then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => { /* ignore */ }
    );
  }, [message.content]);

  // Improvement #2: Render the agent step indicator
  const stepInfo = message.agentStep ? STEP_LABELS[message.agentStep] : null;
  const showStepIndicator = !isUser && message.pending && stepInfo && message.agentStep !== "done";

  return (
    <div className={`flex gap-1.5 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          isUser
            ? "bg-claude-accent text-white"
            : message.isError
            ? "bg-destructive/20 text-destructive border border-destructive/30"
            : "bg-claude-accent-light text-claude-accent border border-claude-accent/30"
        }`}
      >
        {isUser ? <User className="h-2.5 w-2.5" /> : message.isError ? <X className="h-2.5 w-2.5" /> : <Bot className="h-2.5 w-2.5" />}
      </div>
      <div
        className={`group relative flex-1 min-w-0 rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed ${
          isUser
            ? "bg-claude-accent text-white"
            : message.isError
            ? "bg-destructive/5 dark:bg-destructive/10 border border-destructive/30 text-claude-text"
            : "bg-claude-bg dark:bg-[#1a1917] border border-claude-border-light/40 dark:border-[#3d3832]/40 text-claude-text"
        }`}
      >
        {message.pending && !message.content ? (
          // Improvement #2: Show step-specific loading indicator
          <div className="flex items-center gap-1.5 text-claude-text-muted">
            {stepInfo ? (
              <>
                <stepInfo.icon className={`h-3 w-3 ${message.agentStep === "calling-llm" || message.agentStep === "parsing" ? "animate-pulse" : "animate-spin"}`} />
                <span className="text-[10px] font-medium">{stepInfo.label}</span>
                {message.agentStep === "calling-llm" && (
                  <span className="text-[8px] text-claude-text-muted/60 ml-1">(this can take 10-30s)</span>
                )}
              </>
            ) : (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="text-[10px]">Thinking…</span>
              </>
            )}
          </div>
        ) : (
          <>
            {isUser ? (
              <div className="whitespace-pre-wrap">{message.content}</div>
            ) : (
              <div className="sa-chat-markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.content || ""}
                </ReactMarkdown>
              </div>
            )}
            {/* Round 3: Copy button — appears on hover for non-pending messages */}
            {!message.pending && message.content && (
              <button
                onClick={handleCopy}
                className="absolute top-1 right-1 grid h-5 w-5 place-items-center rounded text-claude-text-muted/40 hover:text-claude-accent hover:bg-claude-accent-light/30 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Copy message"
              >
                {copied ? <Check className="h-2.5 w-2.5 text-green-600" /> : <Copy className="h-2.5 w-2.5" />}
              </button>
            )}
            {/* Improvement #2: Inline step indicator while content is streaming */}
            {showStepIndicator && (
              <div className="mt-1.5 flex items-center gap-1.5 border-t border-claude-border-light/30 dark:border-[#3d3832]/30 pt-1">
                <stepInfo.icon className={`h-2.5 w-2.5 text-claude-accent ${message.agentStep === "executing" ? "animate-spin" : "animate-pulse"}`} />
                <span className="text-[9px] font-medium text-claude-accent">{stepInfo.label}</span>
              </div>
            )}
            {/* P3: Confirmation buttons for destructive commands */}
            {!isUser && message.needsConfirmation && (
              <div className="mt-2 flex items-center gap-2 border-t border-claude-border-light/30 dark:border-[#3d3832]/30 pt-1.5">
                <button
                  onClick={() => updateMessage(message.id, { needsConfirmation: false, confirmationResult: true })}
                  className="flex items-center gap-1 rounded-md bg-green-600 text-white px-2 py-1 text-[10px] font-medium hover:bg-green-700 transition-colors"
                >
                  <Check className="h-3 w-3" />
                  Confirm
                </button>
                <button
                  onClick={() => updateMessage(message.id, { needsConfirmation: false, confirmationResult: false })}
                  className="flex items-center gap-1 rounded-md bg-destructive text-white px-2 py-1 text-[10px] font-medium hover:bg-destructive/90 transition-colors"
                >
                  <X className="h-3 w-3" />
                  Skip
                </button>
                <span className="text-[8px] text-claude-text-muted ml-auto">Auto-skip in 60s</span>
              </div>
            )}
            {/* Improvement #5: Commands preview with human-readable descriptions */}
            {!isUser && message.commands && Array.isArray(message.commands) && message.commands.length > 0 && !message.needsConfirmation && (
              <div className="mt-1.5 border-t border-claude-border-light/30 dark:border-[#3d3832]/30 pt-1">
                <div className="flex items-center gap-1 mb-0.5">
                  <Terminal className="h-2.5 w-2.5 text-claude-accent" />
                  <span className="text-[8px] font-semibold uppercase tracking-wide text-claude-text-muted">
                    Commands ({message.commands.length})
                  </span>
                </div>
                <div className="space-y-0.5">
                  {message.commands.map((cmd, i) => {
                    const c = cmd as { type?: string; error?: string; status?: string; durationMs?: number; id?: string; recipe?: string; compId?: string; chain?: string; resno?: number; preset?: string; theme?: string };
                    // Improvement #5: Use human-readable description
                    const desc = describeCommand(c as unknown as LlmCommand);
                    // Improvement #2 (round 2): Real-time status icons
                    const status = c.status || (c.error ? "error" : "done");
                    const statusIcon = status === "pending" ? (
                      <Clock className="h-2.5 w-2.5 text-claude-text-muted/60 shrink-0" />
                    ) : status === "running" ? (
                      <Loader2 className="h-2.5 w-2.5 text-claude-accent animate-spin shrink-0" />
                    ) : status === "error" ? (
                      <X className="h-2.5 w-2.5 text-destructive shrink-0" />
                    ) : (
                      <Check className="h-2.5 w-2.5 text-green-600 shrink-0" />
                    );
                    const statusColor = status === "pending"
                      ? "bg-claude-text-muted/5 text-claude-text-muted border-claude-border/20"
                      : status === "running"
                      ? "bg-claude-accent/10 text-claude-accent border-claude-accent/20"
                      : status === "error"
                      ? "bg-destructive/10 text-destructive border-destructive/20"
                      : "bg-green-500/10 text-green-700 dark:text-green-500 border-green-500/20";
                    // Round 3: Format duration for display
                    const formatDuration = (ms: number) => {
                      if (ms < 1000) return `${ms}ms`;
                      return `${(ms / 1000).toFixed(1)}s`;
                    };
                    return (
                      <div
                        key={i}
                        className={`group/cmd flex items-center gap-1 rounded px-1 py-0.5 text-[9px] border ${statusColor}`}
                        title={c.error || (status === "done" ? "executed successfully" : status)}
                      >
                        <span className="font-mono text-[8px] opacity-60 shrink-0">{i + 1}.</span>
                        <span className="truncate flex-1">{desc}</span>
                        {/* Round 3: Show execution duration for done/error commands */}
                        {(status === "done" || status === "error") && c.durationMs != null && (
                          <span className="flex items-center gap-0.5 text-[7px] font-mono opacity-50 shrink-0" title={`Execution time: ${c.durationMs}ms`}>
                            <Timer className="h-2 w-2" />
                            {formatDuration(c.durationMs)}
                          </span>
                        )}
                        {statusIcon}
                        {/* Round 3: Re-execute button — appears on hover for done/error commands */}
                        {(status === "done" || status === "error") && !sending && (
                          <button
                            onClick={() => dispatchReexec(c as unknown as LlmCommand)}
                            className="grid h-3.5 w-3.5 place-items-center rounded text-claude-text-muted/40 hover:text-claude-accent hover:bg-claude-accent-light/40 opacity-0 group-hover/cmd:opacity-100 transition-opacity shrink-0"
                            title="Re-execute this command"
                          >
                            <Play className="h-2 w-2" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {/* Improvement #3: Retry button for error messages */}
            {!isUser && message.isError && message.retryPrompt && !sending && (
              <div className="mt-2 flex items-center gap-2 border-t border-destructive/20 pt-1.5">
                <button
                  onClick={() => dispatchRetry(message.retryPrompt!)}
                  className="flex items-center gap-1 rounded-md bg-claude-accent text-white px-2 py-1 text-[10px] font-medium hover:bg-claude-accent-hover transition-colors"
                  title="Re-send the last message"
                >
                  <RotateCcw className="h-3 w-3" />
                  Retry
                </button>
                <span className="text-[8px] text-claude-text-muted">Re-send the original request</span>
              </div>
            )}
            {/* Provider badge with model + duration (Round 3) */}
            {!isUser && message.provider && !message.needsConfirmation && !message.isError && (
              <div className="mt-1 flex items-center gap-1.5 text-[8px] text-claude-text-muted/70">
                <span>via {message.provider}</span>
                {message.model && (
                  <span className="font-mono text-[7px] bg-claude-accent-light/30 text-claude-accent px-1 py-0.5 rounded">
                    {message.model}
                  </span>
                )}
                {message.durationMs != null && (
                  <span className="flex items-center gap-0.5 text-[7px] font-mono">
                    <Timer className="h-2 w-2" />
                    {message.durationMs < 1000 ? `${message.durationMs}ms` : `${(message.durationMs / 1000).toFixed(1)}s`}
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
