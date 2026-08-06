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
  Send, Loader2, Trash2, Sparkles, User, Bot, ChevronDown, RefreshCw, Zap,
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
          if (round > 0) {
            updateMessage(pendingId, {
              content: `🔍 Analyzing… (round ${round + 1}, executed ${allCommands.length} commands, got ${allAnalysisResults.length} results)`,
              commands: allCommands,
              pending: true,
            });
          }

          // Call the LLM chat endpoint
          let res: Response | null = null;
          let lastErr: string | null = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              res = await fetch("/api/llm/chat", {
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
            updateMessage(pendingId, {
              content: `❌ LLM call failed: ${lastErr || "unknown error"}`,
              pending: false,
            });
            break;
          }

          const data = await res.json();
          const reply: string = data.reply || "";
          const commands: LlmCommand[] = Array.isArray(data.commands) ? data.commands : [];
          const continueAfter = !!data.continueAfterAnalysis;
          const provider = data.provider;

          // If the LLM requested commands, execute them
          if (commands.length > 0) {
            updateMessage(pendingId, {
              content: reply || `⚡ Executing ${commands.length} command(s)…`,
              commands: [...allCommands, ...commands],
              pending: true,
              provider,
            });

            for (const cmd of commands) {
              try {
                const result = await executeCommand(viewer, cmd);
                allCommands.push({ type: cmd.type, ...("id" in cmd ? { id: cmd.id } : {}) });
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
                allCommands.push({ type: cmd.type, error: err instanceof Error ? err.message : String(err) });
                logCommand({ type: cmd.type, ok: false, detail: "Execution error" });
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
          });
          break;
        }
      } catch (err) {
        updateMessage(pendingId, {
          content: `❌ Error: ${err instanceof Error ? err.message : String(err)}`,
          pending: false,
        });
      } finally {
        sendingRef.current = false;
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
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-claude-text-muted hover:text-destructive"
              onClick={() => { clearChat(); toast("Chat cleared", "info"); }}
              title="Clear chat"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
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
            className="min-h-[44px] max-h-32 resize-none pr-10 text-[11px] leading-relaxed"
            rows={2}
            disabled={sendingRef.current}
          />
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
function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex gap-1.5 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          isUser
            ? "bg-claude-accent text-white"
            : "bg-claude-accent-light text-claude-accent border border-claude-accent/30"
        }`}
      >
        {isUser ? <User className="h-2.5 w-2.5" /> : <Bot className="h-2.5 w-2.5" />}
      </div>
      <div
        className={`flex-1 min-w-0 rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed ${
          isUser
            ? "bg-claude-accent text-white"
            : "bg-claude-bg dark:bg-[#1a1917] border border-claude-border-light/40 dark:border-[#3d3832]/40 text-claude-text"
        }`}
      >
        {message.pending && !message.content ? (
          <div className="flex items-center gap-1.5 text-claude-text-muted">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="text-[10px]">Thinking…</span>
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
            {/* Commands executed by the agent */}
            {!isUser && message.commands && Array.isArray(message.commands) && message.commands.length > 0 && (
              <div className="mt-1.5 border-t border-claude-border-light/30 dark:border-[#3d3832]/30 pt-1">
                <div className="text-[8px] font-semibold uppercase tracking-wide text-claude-text-muted mb-0.5">
                  Commands ({message.commands.length})
                </div>
                <div className="flex flex-wrap gap-0.5">
                  {message.commands.map((cmd, i) => {
                    const c = cmd as { type?: string; error?: string };
                    return (
                      <Badge
                        key={i}
                        variant="outline"
                        className={`text-[8px] font-mono h-3.5 px-1 ${
                          c.error
                            ? "bg-destructive/10 text-destructive border-destructive/30"
                            : "bg-green-500/10 text-green-600 border-green-500/30"
                        }`}
                        title={c.error || "executed"}
                      >
                        {c.type || "unknown"}
                        {c.error ? " ✗" : " ✓"}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}
            {/* Provider badge */}
            {!isUser && message.provider && (
              <div className="mt-1 text-[8px] text-claude-text-muted/70">
                via {message.provider}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
