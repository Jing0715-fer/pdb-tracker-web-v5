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

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Send, Loader2, Trash2, Sparkles, User, Bot, ChevronDown, ChevronUp, RefreshCw, Zap, Check, X, Square, RotateCcw, Terminal, Brain, Cog, Clock, Download, AlertCircle, Copy, Play, Timer, Search, BarChart3, Pencil, ThumbsUp, ThumbsDown, Pin, Bookmark, History, Volume2, VolumeX, Bold, Code, List, Upload, LayoutGrid, FileText, Mic, Star, Plus, Eye, EyeOff, Languages, CornerDownRight, ExternalLink, Tag, StickyNote, GitCompare,
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
 * Round 12: Extended chat template library — categorized prompt templates
 * for common structural biology analysis tasks.
 */
interface ChatTemplate {
  icon: string;
  title: string;
  prompt: string;
  category: string;
}

const TEMPLATE_LIBRARY: ChatTemplate[] = [
  // ── Structure Loading ──
  { icon: "📥", title: "Load PDB", prompt: "Load PDB structure {ID} and show its basic information.", category: "Loading" },
  { icon: "🧬", title: "Load AlphaFold", prompt: "Load AlphaFold model for UniProt ID {UNIPROT_ID} and analyze its confidence.", category: "Loading" },
  { icon: "📦", title: "Load EMDB", prompt: "Load EMDB volume {EMDB_ID} at detail level 3.", category: "Loading" },

  // ── Visualization ──
  { icon: "🎨", title: "Cartoon + Chain", prompt: "Load {ID}, set representation to cartoon, color by chain.", category: "Visualization" },
  { icon: "⚛️", title: "Ball & Stick", prompt: "Load {ID}, set representation to ball-and-stick, color by element.", category: "Visualization" },
  { icon: "🌈", title: "Surface + Hydrophobicity", prompt: "Load {ID}, set representation to molecular-surface, color by hydrophobicity.", category: "Visualization" },
  { icon: "🎯", title: "Focus Residue", prompt: "Load {ID} and focus the camera on residue {CHAIN}{RESNO}.", category: "Visualization" },
  { icon: "💊", title: "Focus Ligand", prompt: "Load {ID} and focus the camera on ligand {COMPID}.", category: "Visualization" },

  // ── Analysis ──
  { icon: "📊", title: "Metadata", prompt: "Get metadata for PDB {ID} including resolution, chains, and ligands.", category: "Analysis" },
  { icon: "🤝", title: "H-bonds", prompt: "Load {ID} and run hydrogen bond analysis on chain {CHAIN}.", category: "Analysis" },
  { icon: "⚡", title: "Salt Bridges", prompt: "Load {ID} and run salt bridge analysis on chain {CHAIN}.", category: "Analysis" },
  { icon: "💧", title: "Hydrophobic", prompt: "Load {ID} and run hydrophobic contacts analysis on chain {CHAIN}.", category: "Analysis" },
  { icon: "🔄", title: "All Interactions", prompt: "Load {ID} and run all_interactions analysis on chain {CHAIN}.", category: "Analysis" },
  { icon: "📐", title: "Ramachandran", prompt: "Load {ID} and run Ramachandran analysis to check structure quality.", category: "Analysis" },
  { icon: "🌡️", title: "B-factor", prompt: "Load {ID} and run B-factor analysis to identify flexible regions.", category: "Analysis" },
  { icon: "🌐", title: "SASA", prompt: "Load {ID} and run SASA (solvent accessible surface area) analysis.", category: "Analysis" },
  { icon: "🧩", title: "Secondary Structure", prompt: "Load {ID} and run secondary structure analysis.", category: "Analysis" },
  { icon: "🔗", title: "Disulfide Bonds", prompt: "Load {ID} and detect all disulfide bonds.", category: "Analysis" },
  { icon: "⚛️", title: "Aromatic Stacking", prompt: "Load {ID} and detect aromatic stacking interactions.", category: "Analysis" },
  { icon: "💧", title: "Water Bridges", prompt: "Load {ID} and detect water-bridged hydrogen bonds.", category: "Analysis" },

  // ── Drug Discovery ──
  { icon: "💊", title: "Binding Pocket", prompt: "Load {ID} and analyze the binding pocket around ligand {COMPID}.", category: "Drug Discovery" },
  { icon: "🎯", title: "Druggability", prompt: "Load {ID} and predict the druggability of the binding pocket around ligand {COMPID}.", category: "Drug Discovery" },
  { icon: "🔍", title: "Detect Pockets", prompt: "Load {ID} and detect all binding pockets on the protein surface.", category: "Drug Discovery" },
  { icon: "🧪", title: "Virtual Screening", prompt: "Load {ID} and run virtual screening on the binding pocket around ligand {COMPID}.", category: "Drug Discovery" },
  { icon: "⚡", title: "Electrostatic Surface", prompt: "Load {ID} and show the electrostatic surface potential.", category: "Drug Discovery" },

  // ── Comprehensive ──
  { icon: "📋", title: "Full Report", prompt: "Load {ID} and generate a comprehensive analysis report: metadata, quality, interactions, and binding pocket analysis.", category: "Comprehensive" },
  { icon: "🔬", title: "Enzyme Analysis", prompt: "Load {ID} (enzyme) and analyze: active site residues, catalytic mechanism, ligand interactions, and generate a report.", category: "Comprehensive" },
  { icon: "🦠", title: "Antibody Analysis", prompt: "Load {ID} (antibody) and analyze: CDR regions, antigen-binding interface, and paratope characterization.", category: "Comprehensive" },
];

/**
 * Round 13: Custom template storage helpers (persisted to localStorage).
 * Users can save their own templates and mark built-in templates as favorites.
 */
const STORAGE_KEY_CUSTOM_TEMPLATES = "pdb-tracker:custom-templates:v1";
const STORAGE_KEY_FAVORITE_TEMPLATES = "pdb-tracker:favorite-templates:v1";

function loadCustomTemplates(): ChatTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CUSTOM_TEMPLATES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveCustomTemplates(templates: ChatTemplate[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_CUSTOM_TEMPLATES, JSON.stringify(templates));
  } catch { /* ignore */ }
}

function loadFavoriteTemplates(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FAVORITE_TEMPLATES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveFavoriteTemplates(titles: string[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_FAVORITE_TEMPLATES, JSON.stringify(titles));
  } catch { /* ignore */ }
}

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

/**
 * Round 11: Highlight search matches in text.
 * Returns an array of text segments with match flags for rendering.
 */
function highlightSearch(text: string, query: string): Array<{ text: string; match: boolean }> {
  if (!query.trim()) return [{ text, match: false }];
  const q = query.trim();
  const lowerText = text.toLowerCase();
  const lowerQ = q.toLowerCase();
  const segments: Array<{ text: string; match: boolean }> = [];
  let lastIndex = 0;
  let idx = lowerText.indexOf(lowerQ);
  while (idx !== -1) {
    if (idx > lastIndex) {
      segments.push({ text: text.slice(lastIndex, idx), match: false });
    }
    segments.push({ text: text.slice(idx, idx + q.length), match: true });
    lastIndex = idx + q.length;
    idx = lowerText.indexOf(lowerQ, lastIndex);
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), match: false });
  }
  return segments.length > 0 ? segments : [{ text, match: false }];
}

/**
 * Round 14: Copy button for code blocks in assistant messages.
 * Shows a Copy icon, changes to Check for 1.5s after copying.
 */
function CodeBlockCopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => { /* ignore */ }
    );
  }, [code]);
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-0.5 text-[8px] text-claude-text-muted hover:text-claude-accent transition-colors"
      title="Copy code"
    >
      {copied ? <Check className="h-2.5 w-2.5 text-green-600" /> : <Copy className="h-2.5 w-2.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

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

  // Round 4: Chat search state
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  // Round 4: Chat statistics state
  const [showStats, setShowStats] = useState(false);
  // Round 6: Filter + sort state
  const [filterMode, setFilterMode] = useState<"all" | "bookmarked" | "reactions">("all");
  const [sortMode, setSortMode] = useState<"default" | "reactions" | "recent">("default");
  // Round 6: Command history sidebar state
  const [showCmdHistory, setShowCmdHistory] = useState(false);
  // Round 7: Command type quick filter
  const [cmdTypeFilter, setCmdTypeFilter] = useState<string | null>(null);
  // Round 12: Template library state
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateCategory, setTemplateCategory] = useState<string>("All");
  // Round 12: Multi-file upload state
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ name: string; content: string; format: string }>>([]);
  // Round 11: Drag-and-drop state
  const [isDragging, setIsDragging] = useState(false);
  // Round 13: Custom templates + favorites
  const [customTemplates, setCustomTemplates] = useState<ChatTemplate[]>(() => loadCustomTemplates());
  const [favoriteTemplates, setFavoriteTemplates] = useState<string[]>(() => loadFavoriteTemplates());
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [newTemplateTitle, setNewTemplateTitle] = useState("");
  const [newTemplateIcon, setNewTemplateIcon] = useState("📝");
  // Round 13: Voice input state
  const [isListening, setIsListening] = useState(false);
  // Round 15: Markdown preview + unread badge state
  const [showPreview, setShowPreview] = useState(false);
  // Round 15: Unread message count (messages received while chat tab not visible)
  const [unreadCount, setUnreadCount] = useState(0);
  const [isChatVisible, setIsChatVisible] = useState(false);
  const prevMessageCountRef = useRef(0);
  // Round 16: Auto-save indicator state
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Round 17: Translation + sentiment state
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [messageSentiment, setMessageSentiment] = useState<Record<string, "positive" | "neutral" | "negative">>({});
  // Round 18: Summarization state
  const [summarizing, setSummarizing] = useState(false);
  // Round 14: Voice input language selector
  const [voiceLang, setVoiceLang] = useState(() => {
    try { return localStorage.getItem("pdb-tracker:voice-lang") || "en-US"; }
    catch { return "en-US"; }
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null); // Round 10: for markdown toolbar

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

  // Round 10: Auto-scroll toggle — when off, don't auto-scroll on new messages
  // (lets the user read old messages without being pulled to the bottom)
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll to bottom on new messages (only if autoScroll is enabled)
  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages, autoScroll]);

  // Round 15: Track unread messages when chat is not visible
  // Uses IntersectionObserver to detect if the chat container is visible
  useEffect(() => {
    const el = scrollRef.current?.parentElement;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsChatVisible(entry.isIntersecting);
        if (entry.isIntersecting) {
          setUnreadCount(0);
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Round 15: Count new assistant messages when not visible
  useEffect(() => {
    const currentCount = messages.length;
    const prevCount = prevMessageCountRef.current;
    if (currentCount > prevCount && !isChatVisible) {
      // New messages arrived while chat not visible
      const newMsgs = messages.slice(prevCount);
      const newAssistantMsgs = newMsgs.filter(m => m.role === "assistant" && !m.pending);
      if (newAssistantMsgs.length > 0) {
        setUnreadCount(c => c + newAssistantMsgs.length);
      }
    }
    prevMessageCountRef.current = currentCount;
  }, [messages, isChatVisible]);

  // Round 15: Dispatch unread count event for external badge display
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("chat-unread-count", { detail: unreadCount }));
  }, [unreadCount]);

  // Round 16: Auto-save indicator — show "Saving..." then "Saved" when messages persist
  useEffect(() => {
    if (messages.length === 0) {
      setSaveStatus("idle");
      return;
    }
    setSaveStatus("saving");
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      setSaveStatus("saved");
      // Clear "Saved" after 2 seconds
      setTimeout(() => setSaveStatus("idle"), 2000);
    }, 500);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [messages]);

  // Round 17: Auto-compute sentiment for new assistant messages
  useEffect(() => {
    messages.forEach((m) => {
      if (m.role === "assistant" && !m.pending && m.content && !messageSentiment[m.id]) {
        const sentiment = analyzeSentiment(m.content);
        setMessageSentiment(prev => ({ ...prev, [m.id]: sentiment }));
      }
    });
  }, [messages, messageSentiment]);

  // Round 17: Quick reply listener — sends the reply as a new message
  useEffect(() => {
    const handler = (e: Event) => {
      const reply = (e as CustomEvent<string>).detail;
      if (reply && !sendingRef.current) send(reply);
    };
    window.addEventListener("chat-quick-reply", handler);
    return () => window.removeEventListener("chat-quick-reply", handler);
  }, [send]);

  // Round 17: Translate message via /api/llm/chat/stream
  const handleTranslate = useCallback(async (messageId: string, content: string) => {
    if (!content.trim()) return;
    setTranslatingId(messageId);
    try {
      const res = await fetch("/api/llm/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "user", content: `Translate the following text to English. Output ONLY the translation, no explanation:\n\n${content}` },
          ],
          provider: chatProvider,
        }),
      });
      if (!res.ok) throw new Error("Translation failed");
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let translated = "";
      let buffer = "";
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() || "";
          for (const evt of events) {
            const line = evt.trim();
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "chunk") translated += data.text;
            } catch { /* ignore */ }
          }
        }
      }
      if (translated.trim()) {
        updateMessage(messageId, { content: translated });
        toast("Message translated to English", "success");
      }
    } catch (err) {
      toast(`Translation failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setTranslatingId(null);
    }
  }, [chatProvider, updateMessage, toast]);

  // Round 18: Summarize chat conversation
  const handleSummarize = useCallback(async () => {
    if (messages.length < 2 || summarizing) return;
    setSummarizing(true);
    try {
      // Build conversation text for summarization
      const conversationText = messages
        .filter(m => !m.pending)
        .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n\n");
      const res = await fetch("/api/llm/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "user", content: `Summarize the following chat conversation in bullet points (max 5 key points). Output ONLY the summary:\n\n${conversationText}` },
          ],
          provider: chatProvider,
        }),
      });
      if (!res.ok) throw new Error("Summarization failed");
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let summary = "";
      let buffer = "";
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() || "";
          for (const evt of events) {
            const line = evt.trim();
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "chunk") summary += data.text;
            } catch { /* ignore */ }
          }
        }
      }
      if (summary.trim()) {
        // Add summary as a new assistant message
        addMessage({
          id: `a-summary-${Date.now()}`,
          role: "assistant",
          content: `📋 **Chat Summary**\n\n${summary.trim()}`,
          ts: Date.now(),
          provider: chatProvider,
        });
        toast("Chat summary generated", "success");
      }
    } catch (err) {
      toast(`Summarization failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setSummarizing(false);
    }
  }, [messages, summarizing, chatProvider, addMessage, toast]);

  // Round 10: Detect when user scrolls up — auto-disable auto-scroll
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    if (!isAtBottom && autoScroll) {
      setAutoScroll(false);
    } else if (isAtBottom && !autoScroll) {
      setAutoScroll(true);
    }
  }, [autoScroll]);

  // Round 10: Sound notifications — play a beep when the agent finishes or errors
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try {
      return localStorage.getItem("pdb-tracker:chat-sound") !== "off";
    } catch { return true; }
  });

  const playSound = useCallback((type: "done" | "error") => {
    if (!soundEnabled) return;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      // Different tones for success vs error
      oscillator.frequency.value = type === "done" ? 800 : 400;
      oscillator.type = "sine";
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.3);
      // Close context after sound finishes
      setTimeout(() => ctx.close(), 500);
    } catch { /* ignore audio errors */ }
  }, [soundEnabled]);

  const toggleSound = useCallback(() => {
    const newVal = !soundEnabled;
    setSoundEnabled(newVal);
    try {
      localStorage.setItem("pdb-tracker:chat-sound", newVal ? "on" : "off");
    } catch { /* ignore */ }
  }, [soundEnabled]);

  const activeProviderInfo = providers.find((p) => p.provider === chatProvider);
  const providerLabel = chatProvider === "" || chatProvider === "auto"
    ? "Auto"
    : activeProviderInfo?.label || chatProvider;

  // Round 4: Filter messages by search query
  // Round 5: Pinned messages always appear at the top
  // Round 6: Added filterMode (all/bookmarked/reactions) and sortMode (default/reactions/recent)
  // Round 7: Added cmdTypeFilter (filter messages containing a specific command type)
  const filteredMessages = useMemo(() => {
    let result = messages;
    // Apply filter mode
    if (filterMode === "bookmarked") {
      result = result.filter((m) => m.bookmarked);
    } else if (filterMode === "reactions") {
      result = result.filter((m) => m.reaction !== undefined);
    }
    // Round 7: Apply command type filter
    if (cmdTypeFilter) {
      result = result.filter((m) =>
        m.commands?.some((cmd) => (cmd as { type?: string }).type === cmdTypeFilter)
      );
    }
    // Apply search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((m) =>
        m.content?.toLowerCase().includes(q) ||
        m.commands?.some((cmd) => {
          const c = cmd as { type?: string };
          return c.type?.toLowerCase().includes(q) || describeCommand(c as unknown as LlmCommand).toLowerCase().includes(q);
        })
      );
    }
    // Apply sort mode
    const sorted = [...result];
    if (sortMode === "reactions") {
      // Sort by reaction: thumbs-up first, then thumbs-down, then no reaction
      sorted.sort((a, b) => {
        const aScore = a.reaction === "thumbs-up" ? 2 : a.reaction === "thumbs-down" ? 1 : 0;
        const bScore = b.reaction === "thumbs-up" ? 2 : b.reaction === "thumbs-down" ? 1 : 0;
        return bScore - aScore;
      });
    } else if (sortMode === "recent") {
      // Sort by timestamp descending (most recent first)
      sorted.sort((a, b) => b.ts - a.ts);
    } else {
      // Default: pinned messages first, then by original order
      sorted.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return 0;
      });
    }
    return sorted;
  }, [messages, searchQuery, filterMode, sortMode, cmdTypeFilter]);

  // Round 4: Calculate chat statistics
  const chatStats = useMemo(() => {
    const userMessages = messages.filter((m) => m.role === "user").length;
    const assistantMessages = messages.filter((m) => m.role === "assistant").length;
    const allCommands = messages.flatMap((m) => (Array.isArray(m.commands) ? m.commands : []) as Array<Record<string, unknown>>);
    const totalCommands = allCommands.length;
    const successfulCommands = allCommands.filter((c) => c.status === "done" || (!c.status && !c.error)).length;
    const failedCommands = allCommands.filter((c) => c.status === "error" || c.error).length;
    const commandDurations = allCommands
      .map((c) => (typeof c.durationMs === "number" ? c.durationMs : null))
      .filter((d): d is number => d !== null);
    const avgCommandMs = commandDurations.length > 0
      ? Math.round(commandDurations.reduce((s, d) => s + d, 0) / commandDurations.length)
      : 0;
    const llmDurations = messages
      .map((m) => (typeof m.durationMs === "number" ? m.durationMs : null))
      .filter((d): d is number => d !== null);
    const avgLlmMs = llmDurations.length > 0
      ? Math.round(llmDurations.reduce((s, d) => s + d, 0) / llmDurations.length)
      : 0;
    // Command type breakdown
    const commandTypes: Record<string, number> = {};
    const commandTypeStats: Record<string, { total: number; success: number; failed: number }> = {};
    allCommands.forEach((c) => {
      const t = String(c.type || "unknown");
      commandTypes[t] = (commandTypes[t] || 0) + 1;
      if (!commandTypeStats[t]) commandTypeStats[t] = { total: 0, success: 0, failed: 0 };
      commandTypeStats[t].total++;
      const status = String(c.status || (c.error ? "error" : "done"));
      if (status === "error" || c.error) commandTypeStats[t].failed++;
      else if (status === "done") commandTypeStats[t].success++;
    });
    // Providers used
    const providers: Record<string, number> = {};
    messages.forEach((m) => {
      if (m.provider) {
        providers[m.provider] = (providers[m.provider] || 0) + 1;
      }
    });
    // Round 5: Reaction + bookmark + pin counts
    const thumbsUp = messages.filter((m) => m.reaction === "thumbs-up").length;
    const thumbsDown = messages.filter((m) => m.reaction === "thumbs-down").length;
    const bookmarked = messages.filter((m) => m.bookmarked).length;
    const pinned = messages.filter((m) => m.pinned).length;
    return {
      userMessages,
      assistantMessages,
      totalCommands,
      successfulCommands,
      failedCommands,
      avgCommandMs,
      avgLlmMs,
      commandTypes,
      commandTypeStats, // Round 9: per-type success/failed counts
      providers,
      thumbsUp,
      thumbsDown,
      bookmarked,
      pinned,
      // Round 8: Reaction summary — which command types got the most reactions
      reactedCommands: (() => {
        const cmdReactions: Record<string, { up: number; down: number }> = {};
        messages.forEach((m) => {
          if (m.reaction && Array.isArray(m.commands)) {
            m.commands.forEach((cmd) => {
              const c = cmd as { type?: string };
              const t = String(c.type || "unknown");
              if (!cmdReactions[t]) cmdReactions[t] = { up: 0, down: 0 };
              if (m.reaction === "thumbs-up") cmdReactions[t].up++;
              else if (m.reaction === "thumbs-down") cmdReactions[t].down++;
            });
          }
        });
        return cmdReactions;
      })(),
    };
  }, [messages]);

  // Round 6: Build command history list from all messages
  const commandHistory = useMemo(() => {
    const history: Array<{
      messageId: string;
      messageTs: number;
      cmdIndex: number;
      type: string;
      status: string;
      durationMs?: number;
      error?: string;
      desc: string;
    }> = [];
    messages.forEach((m) => {
      if (Array.isArray(m.commands)) {
        m.commands.forEach((cmd, i) => {
          const c = cmd as Record<string, unknown>;
          history.push({
            messageId: m.id,
            messageTs: m.ts,
            cmdIndex: i,
            type: String(c.type || "unknown"),
            status: String(c.status || (c.error ? "error" : "done")),
            durationMs: typeof c.durationMs === "number" ? c.durationMs : undefined,
            error: typeof c.error === "string" ? c.error : undefined,
            desc: describeCommand(c as unknown as LlmCommand),
          });
        });
      }
    });
    // Sort by timestamp descending (most recent first)
    return history.sort((a, b) => b.messageTs - a.messageTs);
  }, [messages]);

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
        // Round 5: Export reaction/pin/bookmark status
        const meta: string[] = [];
        if (m.pinned) meta.push("📌 Pinned");
        if (m.bookmarked) meta.push("🔖 Bookmarked");
        if (m.reaction === "thumbs-up") meta.push("👍 Liked");
        if (m.reaction === "thumbs-down") meta.push("👎 Disliked");
        if (meta.length > 0) {
          lines.push(`> ${meta.join(" · ")}`);
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

  /** Round 8: Export command history as CSV. */
  const handleExportCommandCsv = useCallback(() => {
    if (commandHistory.length === 0) {
      toast("No commands to export", "error");
      return;
    }
    const header = "timestamp,type,description,status,duration_ms,error\n";
    const rows = commandHistory.map((cmd) => {
      const ts = new Date(cmd.messageTs).toISOString();
      const type = `"${cmd.type.replace(/"/g, '""')}"`;
      const desc = `"${cmd.desc.replace(/"/g, '""')}"`;
      const status = cmd.status;
      const duration = cmd.durationMs ?? "";
      const error = cmd.error ? `"${cmd.error.replace(/"/g, '""')}"` : "";
      return `${ts},${type},${desc},${status},${duration},${error}`;
    });
    const csv = header + rows.join("\n") + "\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `command-history-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${commandHistory.length} commands as CSV`, "success");
  }, [commandHistory, toast]);

  // Round 13: Save current input as a custom template
  const handleSaveTemplate = useCallback(() => {
    const trimmedInput = input.trim();
    const trimmedTitle = newTemplateTitle.trim();
    if (!trimmedInput || !trimmedTitle) {
      toast("Enter a prompt and title to save template", "error");
      return;
    }
    const newTemplate: ChatTemplate = {
      icon: newTemplateIcon || "📝",
      title: trimmedTitle,
      prompt: trimmedInput,
      category: "Custom",
    };
    const updated = [...customTemplates, newTemplate];
    setCustomTemplates(updated);
    saveCustomTemplates(updated);
    setShowSaveTemplate(false);
    setNewTemplateTitle("");
    setNewTemplateIcon("📝");
    toast(`Template "${trimmedTitle}" saved`, "success");
  }, [input, newTemplateTitle, newTemplateIcon, customTemplates, toast]);

  // Round 13: Delete a custom template
  const handleDeleteTemplate = useCallback((title: string) => {
    const updated = customTemplates.filter(t => t.title !== title);
    setCustomTemplates(updated);
    saveCustomTemplates(updated);
    toast(`Template "${title}" deleted`, "info");
  }, [customTemplates, toast]);

  // Round 13: Toggle favorite for a template
  const handleToggleFavorite = useCallback((title: string) => {
    const updated = favoriteTemplates.includes(title)
      ? favoriteTemplates.filter(t => t !== title)
      : [...favoriteTemplates, title];
    setFavoriteTemplates(updated);
    saveFavoriteTemplates(updated);
  }, [favoriteTemplates]);

  // Round 14: Template import/export
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportTemplates = useCallback(() => {
    if (customTemplates.length === 0) {
      toast("No custom templates to export", "error");
      return;
    }
    const data = {
      exportedAt: new Date().toISOString(),
      version: 1,
      templates: customTemplates,
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat-templates-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${customTemplates.length} custom templates`, "success");
  }, [customTemplates, toast]);

  const handleImportTemplates = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        const imported: ChatTemplate[] = Array.isArray(data) ? data : data.templates;
        if (!Array.isArray(imported)) {
          toast("Invalid template file format", "error");
          return;
        }
        // Filter valid templates and avoid duplicates by title
        const existingTitles = new Set(customTemplates.map(t => t.title));
        const newTemplates = imported
          .filter(t => t && typeof t.title === "string" && typeof t.prompt === "string")
          .filter(t => !existingTitles.has(t.title))
          .map(t => ({
            icon: typeof t.icon === "string" ? t.icon : "📝",
            title: t.title,
            prompt: t.prompt,
            category: typeof t.category === "string" ? t.category : "Custom",
          }));
        if (newTemplates.length === 0) {
          toast("No new templates to import (all already exist)", "info");
          return;
        }
        const updated = [...customTemplates, ...newTemplates];
        setCustomTemplates(updated);
        saveCustomTemplates(updated);
        toast(`Imported ${newTemplates.length} template(s)`, "success");
      } catch {
        toast("Failed to parse JSON file", "error");
      }
    };
    reader.onerror = () => toast("Failed to read file", "error");
    reader.readAsText(file);
    // Reset input so the same file can be imported again
    e.target.value = "";
  }, [customTemplates, toast]);

  // Round 13: Voice input via Web Speech API
  const recognitionRef = useRef<any>(null);
  const handleVoiceInput = useCallback(() => {
    if (isListening) {
      // Stop listening
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast("Voice input not supported in this browser", "error");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = voiceLang; // Round 14: configurable language
    recognitionRef.current = recognition;
    let finalTranscript = '';
    recognition.onresult = (event: any) => {
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }
      // Update input with final + interim
      if (finalTranscript) {
        setInput(finalTranscript + (interimTranscript ? ' ' + interimTranscript : ''));
      } else if (interimTranscript) {
        setInput(interimTranscript);
      }
    };
    recognition.onerror = (event: any) => {
      toast(`Voice input error: ${event.error}`, "error");
      setIsListening(false);
    };
    recognition.onend = () => {
      setIsListening(false);
    };
    recognition.start();
    setIsListening(true);
    toast("Listening... speak now", "info");
  }, [isListening, toast, voiceLang]);

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
          playSound("done"); // Round 10: notification sound
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
          playSound("error"); // Round 10: error notification sound
        }
      } finally {
        abortRef.current = null;
        sendingRef.current = false;
        stopRequestedRef.current = false;
      }
    },
    [viewer, messages, structures, chatProvider, addMessage, updateMessage, logCommand, toast, playSound]
  );

  // Round 4: Listen for message edit events from MessageBubble (must be after send is defined)
  useEffect(() => {
    const handler = (e: Event) => {
      const { messageId, newContent } = (e as CustomEvent<{ messageId: string; newContent: string }>).detail;
      if (!messageId || !newContent || sendingRef.current) return;
      // Round 19: Save original content for diff view before updating
      const allMsgsBefore = useAppStore.getState().chatMessages;
      const msgBefore = allMsgsBefore.find(m => m.id === messageId);
      if (msgBefore && msgBefore.content !== newContent && !msgBefore.originalContent) {
        updateMessage(messageId, { content: newContent, originalContent: msgBefore.content });
      } else {
        updateMessage(messageId, { content: newContent });
      }
      // Truncate messages after the edited one (remove old responses)
      const allMsgs = useAppStore.getState().chatMessages;
      const editIndex = allMsgs.findIndex((m) => m.id === messageId);
      if (editIndex === -1) return;
      const keptMsgs = allMsgs.slice(0, editIndex + 1);
      // Update the store to remove messages after the edited one
      useAppStore.setState({ chatMessages: keptMsgs });
      // Persist the updated messages
      try {
        const toSave = keptMsgs.filter((m) => !m.pending).slice(-50);
        localStorage.setItem("pdb-tracker:chat-messages:v1", JSON.stringify(toSave));
      } catch { /* ignore */ }
      // Send the edited content as a new agent turn
      send(newContent);
      toast("Message edited and re-sent", "info");
    };
    window.addEventListener(EDIT_EVENT, handler);
    return () => window.removeEventListener(EDIT_EVENT, handler);
  }, [updateMessage, toast, send]);

  // Round 5: Listen for reaction events (👍/👎)
  useEffect(() => {
    const handler = (e: Event) => {
      const { messageId, reaction } = (e as CustomEvent<{ messageId: string; reaction: "thumbs-up" | "thumbs-down" | null }>).detail;
      if (!messageId) return;
      updateMessage(messageId, { reaction: reaction ?? undefined });
    };
    window.addEventListener(REACTION_EVENT, handler);
    return () => window.removeEventListener(REACTION_EVENT, handler);
  }, [updateMessage]);

  // Round 5+16: Listen for pin events — now supports multiple pinned messages
  useEffect(() => {
    const handler = (e: Event) => {
      const { messageId, pinned } = (e as CustomEvent<{ messageId: string; pinned: boolean }>).detail;
      if (!messageId) return;
      // Round 16: Allow multiple pinned messages (no longer unpin others)
      const allMsgs = useAppStore.getState().chatMessages;
      const updated = allMsgs.map((m) =>
        m.id === messageId ? { ...m, pinned } : m
      );
      useAppStore.setState({ chatMessages: updated });
      // Persist
      try {
        const toSave = updated.filter((m) => !m.pending).slice(-50);
        localStorage.setItem("pdb-tracker:chat-messages:v1", JSON.stringify(toSave));
      } catch { /* ignore */ }
      const pinCount = updated.filter(m => m.pinned).length;
      toast(pinned ? `📌 Message pinned (${pinCount} total)` : "Message unpinned", "info");
    };
    window.addEventListener(PIN_EVENT, handler);
    return () => window.removeEventListener(PIN_EVENT, handler);
  }, [toast]);

  // Round 5: Listen for bookmark events
  useEffect(() => {
    const handler = (e: Event) => {
      const { messageId, bookmarked } = (e as CustomEvent<{ messageId: string; bookmarked: boolean }>).detail;
      if (!messageId) return;
      updateMessage(messageId, { bookmarked });
      toast(bookmarked ? "🔖 Message bookmarked" : "Bookmark removed", "info");
    };
    window.addEventListener(BOOKMARK_EVENT, handler);
    return () => window.removeEventListener(BOOKMARK_EVENT, handler);
  }, [updateMessage, toast]);

  // Round 19: Listen for tag events
  useEffect(() => {
    const handler = (e: Event) => {
      const { messageId, tags } = (e as CustomEvent<{ messageId: string; tags: string[] }>).detail;
      if (!messageId) return;
      updateMessage(messageId, { tags });
      toast(tags.length > 0 ? `🏷️ Tagged: ${tags.join(", ")}` : "Tags cleared", "info");
    };
    window.addEventListener(TAG_EVENT, handler);
    return () => window.removeEventListener(TAG_EVENT, handler);
  }, [updateMessage, toast]);

  // Round 19: Listen for pin-note events
  useEffect(() => {
    const handler = (e: Event) => {
      const { messageId, note } = (e as CustomEvent<{ messageId: string; note: string }>).detail;
      if (!messageId) return;
      updateMessage(messageId, { pinNote: note || undefined });
      toast(note ? `📌 Pin note: ${note}` : "Pin note cleared", "info");
    };
    window.addEventListener(PIN_NOTE_EVENT, handler);
    return () => window.removeEventListener(PIN_NOTE_EVENT, handler);
  }, [updateMessage, toast]);

  // Round 10: Insert markdown formatting around selection or at cursor
  const insertMarkdown = useCallback((before: string, after: string, placeholder: string) => {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selectedText = input.slice(start, end);
    const insertText = selectedText || placeholder;
    const newText = input.slice(0, start) + before + insertText + after + input.slice(end);
    setInput(newText);
    // Restore cursor position after React updates
    requestAnimationFrame(() => {
      if (el) {
        const newCursorPos = start + before.length + insertText.length + after.length;
        el.focus();
        el.setSelectionRange(start + before.length, start + before.length + insertText.length);
        // If no selection, place cursor between the markers
        if (!selectedText) {
          el.setSelectionRange(start + before.length, start + before.length + insertText.length);
        }
        void newCursorPos; // suppress unused
      }
    });
  }, [input]);

  // Round 10: Add Ctrl+B and Ctrl+` shortcuts for bold and code
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault();
      insertMarkdown("**", "**", "bold text");
    } else if ((e.ctrlKey || e.metaKey) && e.key === '`') {
      e.preventDefault();
      insertMarkdown("`", "`", "code");
    }
  };

  // Round 9: Global keyboard shortcuts for the chat panel
  // Ctrl+K / Cmd+K → toggle search
  // Ctrl+E / Cmd+E → export Markdown
  // Ctrl+H / Cmd+H → toggle command history
  // Ctrl+S / Cmd+S → toggle statistics
  // Esc → close any open panel (search/stats/history)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only handle when chat is the focused area (check if target is within chat)
      const target = e.target as HTMLElement;
      if (!target?.closest('.sa-chat-container') && !target?.closest('[data-chat-input]')) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowSearch(v => !v);
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault();
        if (messages.length > 0) handleExportMarkdown();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
        e.preventDefault();
        setShowCmdHistory(v => !v);
      } else if ((e.ctrlKey || e.metaKey) && e.key === 's' && !e.shiftKey) {
        e.preventDefault();
        setShowStats(v => !v);
      } else if (e.key === 'Escape' && !((e.ctrlKey || e.metaKey))) {
        // Only close panels if not editing a message (Esc is used for edit cancel)
        if (showSearch) { setShowSearch(false); setSearchQuery(""); }
        else if (showStats) setShowStats(false);
        else if (showCmdHistory) setShowCmdHistory(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [messages.length, showSearch, showStats, showCmdHistory, handleExportMarkdown]);

  // Round 11: Drag-and-drop file upload handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set isDragging to false if we're leaving the container (not entering a child)
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    // Round 12: Support multiple files
    const validFiles: File[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const name = file.name.toLowerCase();
      const isPdb = name.endsWith('.pdb') || name.endsWith('.cif') ||
                    name.endsWith('.mmcif') || name.endsWith('.ent') ||
                    file.type === 'chemical/x-pdb' || file.type === 'chemical/x-cif';
      if (isPdb) validFiles.push(file);
    }

    if (validFiles.length === 0) {
      toast("Please drop .pdb, .cif, or .ent files", "error");
      return;
    }

    // Read all valid files
    const readPromises = validFiles.map(file => {
      return new Promise<{ name: string; content: string; format: string }>((resolve, reject) => {
        const reader = new FileReader();
        const name = file.name.toLowerCase();
        reader.onload = () => {
          resolve({
            name: file.name,
            content: (reader.result as string).slice(0, 500000),
            format: name.endsWith('.cif') || name.endsWith('.mmcif') ? 'cif' : 'pdb',
          });
        };
        reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
        reader.readAsText(file);
      });
    });

    Promise.all(readPromises).then(fileData => {
      // Add to uploaded files list
      setUploadedFiles(prev => [...prev, ...fileData]);

      // Store all files in sessionStorage
      try {
        sessionStorage.setItem('pdb-tracker:uploaded-files', JSON.stringify(fileData));
      } catch { /* ignore quota errors */ }

      if (fileData.length === 1) {
        const f = fileData[0];
        send(`I've uploaded a structure file: ${f.name}. Please load it and analyze its structure.`);
        toast(`File "${f.name}" uploaded — analyzing...`, "success");
      } else {
        const names = fileData.map(f => f.name).join(", ");
        send(`I've uploaded ${fileData.length} structure files: ${names}. Please load them and compare their structures.`);
        toast(`${fileData.length} files uploaded — analyzing...`, "success");
      }
    }).catch(err => {
      toast(err.message || "Failed to read files", "error");
    });
  }, [send, toast]);

  return (
    <div
      className="flex h-full flex-col sa-chat-container relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Round 15: Unread messages indicator (shown when returning to chat) */}
      {unreadCount > 0 && isChatVisible && (
        <div className="absolute top-1 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 rounded-full bg-claude-accent text-white px-2 py-0.5 text-[9px] font-medium shadow-md animate-pulse">
          <span>{unreadCount} new message{unreadCount > 1 ? "s" : ""}</span>
        </div>
      )}
      {/* Round 11: Drag-and-drop overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-claude-accent/10 backdrop-blur-sm border-2 border-dashed border-claude-accent rounded-lg pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-claude-accent">
            <Upload className="h-8 w-8" />
            <span className="text-sm font-semibold">Drop PDB file to load</span>
            <span className="text-[10px] text-claude-text-muted">.pdb, .cif, .ent supported</span>
          </div>
        </div>
      )}
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
                className={`h-7 w-7 p-0 ${showSearch ? "text-claude-accent bg-claude-accent-light/30" : "text-claude-text-muted hover:text-claude-accent"}`}
                onClick={() => { setShowSearch(!showSearch); if (showSearch) setSearchQuery(""); }}
                title="Search messages"
              >
                <Search className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={`h-7 w-7 p-0 ${showStats ? "text-claude-accent bg-claude-accent-light/30" : "text-claude-text-muted hover:text-claude-accent"}`}
                onClick={() => setShowStats(!showStats)}
                title="Chat statistics"
              >
                <BarChart3 className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={`h-7 w-7 p-0 ${showCmdHistory ? "text-claude-accent bg-claude-accent-light/30" : "text-claude-text-muted hover:text-claude-accent"}`}
                onClick={() => setShowCmdHistory(!showCmdHistory)}
                title="Command history"
              >
                <History className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-claude-text-muted hover:text-claude-accent"
                onClick={handleExportMarkdown}
                title="Export chat as Markdown"
              >
                <Download className="h-3 w-3" />
              </Button>
              {/* Round 18: Summarize chat button */}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-claude-text-muted hover:text-claude-accent"
                onClick={handleSummarize}
                disabled={summarizing || messages.length < 2}
                title="Summarize chat conversation"
              >
                {summarizing ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={`h-7 w-7 p-0 ${soundEnabled ? "text-claude-accent" : "text-claude-text-muted hover:text-claude-accent"}`}
                onClick={toggleSound}
                title={soundEnabled ? "Sound on — click to mute" : "Sound off — click to enable"}
              >
                {soundEnabled ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />}
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

      {/* Round 4: Search bar (collapsible) */}
      {showSearch && messages.length > 0 && (
        <div className="shrink-0 border-b border-claude-border-light/40 dark:border-[#3d3832]/40 px-2 py-1.5 bg-claude-bg/40 dark:bg-[#1a1917]/40">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-claude-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search messages and commands…"
              className="w-full h-7 pl-7 pr-7 rounded-md border border-claude-border-light/60 dark:border-[#3d3832]/60 bg-claude-surface dark:bg-[#242220] text-[10px] text-claude-text placeholder:text-claude-text-muted/50 focus:outline-none focus:border-claude-accent/40"
              autoFocus
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-claude-text-muted hover:text-destructive"
                title="Clear search"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          {/* Round 6: Filter + Sort controls */}
          <div className="mt-1 flex items-center gap-1 flex-wrap">
            <span className="text-[8px] font-semibold uppercase tracking-wide text-claude-text-muted/70">Filter:</span>
            {(["all", "bookmarked", "reactions"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setFilterMode(mode)}
                className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors ${
                  filterMode === mode
                    ? "bg-claude-accent text-white"
                    : "bg-claude-text-muted/10 text-claude-text-muted hover:bg-claude-accent-light/30"
                }`}
                title={mode === "all" ? "Show all messages" : mode === "bookmarked" ? "Show only bookmarked" : "Show only reacted"}
              >
                {mode === "all" ? "All" : mode === "bookmarked" ? "🔖 Bookmarked" : "👍👎 Reacted"}
              </button>
            ))}
            <span className="text-[8px] font-semibold uppercase tracking-wide text-claude-text-muted/70 ml-2">Sort:</span>
            {(["default", "reactions", "recent"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setSortMode(mode)}
                className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors ${
                  sortMode === mode
                    ? "bg-claude-accent text-white"
                    : "bg-claude-text-muted/10 text-claude-text-muted hover:bg-claude-accent-light/30"
                }`}
                title={mode === "default" ? "Pinned first, then chronological" : mode === "reactions" ? "Most liked first" : "Most recent first"}
              >
                {mode === "default" ? "Default" : mode === "reactions" ? "👍 Reactions" : "Recent"}
              </button>
            ))}
          </div>
          {(searchQuery || filterMode !== "all") && (
            <div className="mt-1 text-[9px] text-claude-text-muted">
              {filteredMessages.length} of {messages.length} messages {filterMode !== "all" ? `(${filterMode})` : "match"}
            </div>
          )}
          {/* Round 7: Quick filter chips for command types */}
          {Object.keys(chatStats.commandTypes).length > 0 && (
            <div className="mt-1 flex items-center gap-0.5 flex-wrap">
              <span className="text-[8px] font-semibold uppercase tracking-wide text-claude-text-muted/70 mr-0.5">Cmd:</span>
              {Object.entries(chatStats.commandTypes)
                .sort((a, b) => b[1] - a[1])
                .map(([type, count]) => (
                  <button
                    key={type}
                    onClick={() => setCmdTypeFilter(cmdTypeFilter === type ? null : type)}
                    className={`px-1 py-0.5 rounded text-[8px] font-mono transition-colors ${
                      cmdTypeFilter === type
                        ? "bg-claude-accent text-white"
                        : "bg-claude-text-muted/10 text-claude-text-muted hover:bg-claude-accent-light/30"
                    }`}
                    title={cmdTypeFilter === type ? `Remove filter: ${type}` : `Filter by: ${type} (${count} commands)`}
                  >
                    {type} ×{count}
                  </button>
                ))}
              {cmdTypeFilter && (
                <button
                  onClick={() => setCmdTypeFilter(null)}
                  className="px-1 py-0.5 rounded text-[8px] text-destructive hover:bg-destructive/10 transition-colors ml-1"
                  title="Clear command filter"
                >
                  ✕ Clear
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Round 4: Statistics panel (collapsible) */}
      {showStats && messages.length > 0 && (
        <div className="shrink-0 border-b border-claude-border-light/40 dark:border-[#3d3832]/40 px-2 py-1.5 bg-claude-bg/40 dark:bg-[#1a1917]/40 max-h-48 overflow-y-auto sa-scroll">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[9px]">
            <div className="flex justify-between">
              <span className="text-claude-text-muted">User msgs:</span>
              <span className="font-mono font-semibold text-claude-text">{chatStats.userMessages}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-claude-text-muted">Assistant msgs:</span>
              <span className="font-mono font-semibold text-claude-text">{chatStats.assistantMessages}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-claude-text-muted">Total commands:</span>
              <span className="font-mono font-semibold text-claude-text">{chatStats.totalCommands}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-claude-text-muted">Success rate:</span>
              <span className="font-mono font-semibold text-green-600">
                {chatStats.totalCommands > 0
                  ? `${Math.round((chatStats.successfulCommands / chatStats.totalCommands) * 100)}%`
                  : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-claude-text-muted">Avg cmd time:</span>
              <span className="font-mono font-semibold text-claude-text">
                {chatStats.avgCommandMs > 0
                  ? (chatStats.avgCommandMs < 1000 ? `${chatStats.avgCommandMs}ms` : `${(chatStats.avgCommandMs / 1000).toFixed(1)}s`)
                  : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-claude-text-muted">Avg LLM time:</span>
              <span className="font-mono font-semibold text-claude-text">
                {chatStats.avgLlmMs > 0
                  ? (chatStats.avgLlmMs < 1000 ? `${chatStats.avgLlmMs}ms` : `${(chatStats.avgLlmMs / 1000).toFixed(1)}s`)
                  : "—"}
              </span>
            </div>
            {/* Round 5: Reaction + bookmark + pin stats */}
            <div className="flex justify-between">
              <span className="text-claude-text-muted flex items-center gap-0.5">
                <ThumbsUp className="h-2 w-2 text-green-600" /> / <ThumbsDown className="h-2 w-2 text-red-600" />
              </span>
              <span className="font-mono font-semibold text-claude-text">
                {chatStats.thumbsUp} / {chatStats.thumbsDown}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-claude-text-muted flex items-center gap-0.5">
                <Pin className="h-2 w-2 text-claude-accent" /> / <Bookmark className="h-2 w-2 text-amber-600" />
              </span>
              <span className="font-mono font-semibold text-claude-text">
                {chatStats.pinned} / {chatStats.bookmarked}
              </span>
            </div>
          </div>
          {Object.keys(chatStats.commandTypes).length > 0 && (
            <div className="mt-1.5 pt-1 border-t border-claude-border-light/30 dark:border-[#3d3832]/30">
              <div className="text-[8px] font-semibold uppercase tracking-wide text-claude-text-muted mb-0.5">Command Types</div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(chatStats.commandTypes)
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, count]) => (
                    <Badge key={type} variant="outline" className="text-[8px] font-mono h-3.5 px-1 bg-claude-accent-light/20 text-claude-accent border-claude-accent/20">
                      {type} ×{count}
                    </Badge>
                  ))}
              </div>
              {/* Round 9: Per-type success rate */}
              {Object.entries(chatStats.commandTypeStats).some(([, s]) => s.failed > 0) && (
                <div className="mt-1 space-y-0.5">
                  <div className="text-[7px] font-semibold uppercase tracking-wide text-claude-text-muted/60">Success Rate by Type</div>
                  {Object.entries(chatStats.commandTypeStats)
                    .sort((a, b) => b[1].total - a[1].total)
                    .map(([type, s]) => {
                      const rate = s.total > 0 ? Math.round((s.success / s.total) * 100) : 0;
                      const color = rate === 100 ? "text-green-600" : rate >= 50 ? "text-amber-600" : "text-red-600";
                      return (
                        <div key={type} className="flex items-center gap-1 text-[8px]">
                          <span className="font-mono text-claude-text truncate flex-1">{type}</span>
                          <span className={`font-mono font-semibold ${color}`}>{rate}%</span>
                          <span className="text-claude-text-muted/60 text-[7px]">({s.success}/{s.total})</span>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}
          {Object.keys(chatStats.providers).length > 0 && (
            <div className="mt-1.5 pt-1 border-t border-claude-border-light/30 dark:border-[#3d3832]/30">
              <div className="text-[8px] font-semibold uppercase tracking-wide text-claude-text-muted mb-0.5">Providers</div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(chatStats.providers).map(([prov, count]) => (
                  <Badge key={prov} variant="outline" className="text-[8px] font-mono h-3.5 px-1 bg-claude-text-muted/10 text-claude-text-muted border-claude-border/20">
                    {prov} ×{count}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {/* Round 8: Reaction summary — which command types got the most reactions */}
          {Object.keys(chatStats.reactedCommands).length > 0 && (
            <div className="mt-1.5 pt-1 border-t border-claude-border-light/30 dark:border-[#3d3832]/30">
              <div className="text-[8px] font-semibold uppercase tracking-wide text-claude-text-muted mb-0.5">Reactions by Command Type</div>
              <div className="space-y-0.5">
                {Object.entries(chatStats.reactedCommands)
                  .sort((a, b) => (b[1].up + b[1].down) - (a[1].up + a[1].down))
                  .map(([type, r]) => (
                    <div key={type} className="flex items-center gap-1 text-[9px]">
                      <span className="font-mono text-claude-text truncate flex-1">{type}</span>
                      {r.up > 0 && (
                        <span className="flex items-center gap-0.5 text-green-600">
                          <ThumbsUp className="h-2 w-2" />{r.up}
                        </span>
                      )}
                      {r.down > 0 && (
                        <span className="flex items-center gap-0.5 text-red-600">
                          <ThumbsDown className="h-2 w-2" />{r.down}
                        </span>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Round 6: Command history sidebar (collapsible) */}
      {showCmdHistory && messages.length > 0 && (
        <div className="shrink-0 border-b border-claude-border-light/40 dark:border-[#3d3832]/40 px-2 py-1.5 bg-claude-bg/40 dark:bg-[#1a1917]/40 max-h-56 overflow-y-auto sa-scroll">
          <div className="flex items-center gap-1 mb-1">
            <History className="h-3 w-3 text-claude-accent" />
            <span className="text-[8px] font-semibold uppercase tracking-wide text-claude-text-muted">
              Command History ({commandHistory.length})
            </span>
            {commandHistory.length > 0 && (
              <button
                onClick={handleExportCommandCsv}
                className="ml-auto flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] text-claude-text-muted hover:text-claude-accent hover:bg-claude-accent-light/30 transition-colors"
                title="Export command history as CSV"
              >
                <Download className="h-2.5 w-2.5" />
                CSV
              </button>
            )}
          </div>
          {commandHistory.length === 0 ? (
            <p className="text-[9px] text-claude-text-muted/60 py-2 text-center">No commands executed yet</p>
          ) : (
            <div className="space-y-0.5">
              {commandHistory.map((cmd, i) => {
                const statusIcon = cmd.status === "pending" ? "⏳" : cmd.status === "running" ? "🔄" : cmd.status === "error" ? "❌" : "✅";
                const time = cmd.durationMs != null
                  ? (cmd.durationMs < 1000 ? `${cmd.durationMs}ms` : `${(cmd.durationMs / 1000).toFixed(1)}s`)
                  : "";
                const timeStr = new Date(cmd.messageTs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                return (
                  <div
                    key={`${cmd.messageId}-${cmd.cmdIndex}`}
                    className={`flex items-center gap-1 rounded px-1 py-0.5 text-[9px] border ${
                      cmd.status === "error"
                        ? "bg-destructive/5 text-destructive border-destructive/15"
                        : cmd.status === "running"
                        ? "bg-claude-accent/5 text-claude-accent border-claude-accent/15"
                        : "bg-claude-text-muted/5 text-claude-text border-claude-border/15"
                    }`}
                    title={cmd.error || `Executed at ${timeStr}`}
                  >
                    <span className="text-[8px] shrink-0">{statusIcon}</span>
                    <span className="font-mono text-[7px] text-claude-text-muted/60 shrink-0">{timeStr}</span>
                    <span className="truncate flex-1">{cmd.desc}</span>
                    {time && <span className="font-mono text-[7px] text-claude-text-muted/50 shrink-0">{time}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative flex-1 min-h-0 overflow-y-auto sa-scroll p-2 space-y-2"
      >
        {/* Round 10: Scroll-to-bottom button when auto-scroll is off */}
        {!autoScroll && messages.length > 0 && (
          <button
            onClick={() => {
              setAutoScroll(true);
              const el = scrollRef.current;
              if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
            }}
            className="sticky bottom-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 rounded-full bg-claude-accent text-white px-3 py-1 text-[9px] font-medium shadow-md hover:bg-claude-accent-hover transition-colors"
            title="Scroll to bottom and resume auto-scroll"
          >
            <ChevronDown className="h-2.5 w-2.5" />
            New messages ↓
          </button>
        )}
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
            {/* Round 12: Template library toggle */}
            <button
              onClick={() => setShowTemplates(!showTemplates)}
              className="mt-2 flex items-center gap-1 text-[10px] text-claude-accent hover:underline"
            >
              <LayoutGrid className="h-3 w-3" />
              {showTemplates ? "Hide" : "Show"} template library ({TEMPLATE_LIBRARY.length + customTemplates.length} templates{customTemplates.length > 0 ? ` (${customTemplates.length} custom)` : ""})
            </button>
            {/* Round 12+13: Template library panel with favorites + custom templates */}
            {showTemplates && (
              <div className="w-full mt-1 max-h-56 overflow-y-auto sa-scroll rounded-md border border-claude-border-light/40 dark:border-[#3d3832]/40 bg-claude-bg/60 dark:bg-[#1a1917]/60 p-1.5">
                {/* Round 13: Save template form */}
                {showSaveTemplate ? (
                  <div className="mb-1.5 p-1.5 rounded border border-claude-accent/30 bg-claude-accent-light/10">
                    <div className="text-[8px] font-semibold uppercase tracking-wide text-claude-accent mb-1">Save as Template</div>
                    <div className="flex items-center gap-1 mb-1">
                      <input
                        type="text"
                        value={newTemplateIcon}
                        onChange={(e) => setNewTemplateIcon(e.target.value)}
                        className="w-8 h-6 text-center rounded border border-claude-border-light/60 bg-claude-surface dark:bg-[#242220] text-[12px]"
                        maxLength={2}
                      />
                      <input
                        type="text"
                        value={newTemplateTitle}
                        onChange={(e) => setNewTemplateTitle(e.target.value)}
                        placeholder="Template title..."
                        className="flex-1 h-6 px-2 rounded border border-claude-border-light/60 bg-claude-surface dark:bg-[#242220] text-[10px] text-claude-text placeholder:text-claude-text-muted/50 focus:outline-none focus:border-claude-accent/40"
                        autoFocus
                      />
                    </div>
                    <div className="text-[8px] text-claude-text-muted truncate mb-1">Prompt: {input.slice(0, 80)}{input.length > 80 ? "..." : ""}</div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={handleSaveTemplate}
                        disabled={!input.trim() || !newTemplateTitle.trim()}
                        className="flex items-center gap-1 rounded bg-claude-accent text-white px-2 py-0.5 text-[9px] font-medium hover:bg-claude-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        <Check className="h-2.5 w-2.5" />
                        Save
                      </button>
                      <button
                        onClick={() => { setShowSaveTemplate(false); setNewTemplateTitle(""); }}
                        className="flex items-center gap-1 rounded bg-claude-text-muted/20 text-claude-text-muted px-2 py-0.5 text-[9px] font-medium hover:bg-claude-text-muted/30 transition-colors"
                      >
                        <X className="h-2.5 w-2.5" />
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 mb-1.5">
                    <button
                      onClick={() => setShowSaveTemplate(true)}
                      disabled={!input.trim()}
                      className="flex-1 flex items-center justify-center gap-1 rounded border border-dashed border-claude-accent/30 text-[9px] text-claude-accent hover:bg-claude-accent-light/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors py-1"
                      title="Save current input as a custom template"
                    >
                      <Plus className="h-2.5 w-2.5" />
                      Save as template
                    </button>
                    {/* Round 14: Template import/export */}
                    {customTemplates.length > 0 && (
                      <button
                        onClick={handleExportTemplates}
                        className="flex items-center justify-center gap-1 rounded border border-claude-border-light/40 text-[9px] text-claude-text-muted hover:text-claude-accent hover:border-claude-accent/30 transition-colors px-2 py-1"
                        title="Export custom templates as JSON"
                      >
                        <Download className="h-2.5 w-2.5" />
                      </button>
                    )}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center justify-center gap-1 rounded border border-claude-border-light/40 text-[9px] text-claude-text-muted hover:text-claude-accent hover:border-claude-accent/30 transition-colors px-2 py-1"
                      title="Import templates from JSON"
                    >
                      <Upload className="h-2.5 w-2.5" />
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json"
                      className="hidden"
                      onChange={handleImportTemplates}
                    />
                  </div>
                )}
                {/* Category filter */}
                <div className="flex items-center gap-0.5 flex-wrap mb-1.5 pb-1 border-b border-claude-border-light/30 dark:border-[#3d3832]/30">
                  {["All", "★ Favorites", ...Array.from(new Set([...TEMPLATE_LIBRARY.map(t => t.category), ...customTemplates.map(t => t.category)]))].map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setTemplateCategory(cat)}
                      className={`px-1.5 py-0.5 rounded text-[8px] font-medium transition-colors ${
                        templateCategory === cat
                          ? "bg-claude-accent text-white"
                          : "bg-claude-text-muted/10 text-claude-text-muted hover:bg-claude-accent-light/30"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
                {/* Template grid — includes built-in + custom templates */}
                <div className="grid grid-cols-2 gap-1">
                  {[...TEMPLATE_LIBRARY, ...customTemplates]
                    .filter(t => {
                      if (templateCategory === "All") return true;
                      if (templateCategory === "★ Favorites") return favoriteTemplates.includes(t.title);
                      return t.category === templateCategory;
                    })
                    .map((t, i) => {
                      const isCustom = customTemplates.includes(t);
                      const isFav = favoriteTemplates.includes(t.title);
                      return (
                        <div
                          key={`${t.title}-${i}`}
                          className="flex items-start gap-1 rounded px-1.5 py-1 hover:bg-claude-accent-light/30 transition-colors group relative"
                        >
                          <button
                            onClick={() => {
                              setInput(t.prompt);
                              inputRef.current?.focus();
                            }}
                            className="flex items-start gap-1 flex-1 min-w-0 text-left"
                            title={t.prompt}
                          >
                            <span className="text-xs shrink-0">{t.icon}</span>
                            <div className="min-w-0">
                              <div className="text-[9px] font-medium text-claude-text truncate group-hover:text-claude-accent">{t.title}</div>
                              <div className="text-[7px] text-claude-text-muted truncate">{t.category}</div>
                            </div>
                          </button>
                          {/* Round 13: Favorite toggle */}
                          <button
                            onClick={() => handleToggleFavorite(t.title)}
                            className={`shrink-0 opacity-0 group-hover:opacity-100 transition-opacity ${
                              isFav ? "text-amber-500 opacity-100" : "text-claude-text-muted/40 hover:text-amber-500"
                            }`}
                            title={isFav ? "Remove from favorites" : "Add to favorites"}
                          >
                            <Star className="h-2.5 w-2.5" />
                          </button>
                          {/* Round 13: Delete custom template */}
                          {isCustom && (
                            <button
                              onClick={() => handleDeleteTemplate(t.title)}
                              className="shrink-0 opacity-0 group-hover:opacity-100 text-claude-text-muted/40 hover:text-destructive transition-opacity"
                              title="Delete custom template"
                            >
                              <Trash2 className="h-2.5 w-2.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                </div>
                {/* Round 12: Uploaded files list */}
                {uploadedFiles.length > 0 && (
                  <div className="mt-1.5 pt-1 border-t border-claude-border-light/30 dark:border-[#3d3832]/30">
                    <div className="text-[8px] font-semibold uppercase tracking-wide text-claude-text-muted mb-0.5">
                      Uploaded Files ({uploadedFiles.length})
                    </div>
                    {uploadedFiles.map((f, i) => (
                      <div key={i} className="flex items-center gap-1 text-[9px] py-0.5">
                        <FileText className="h-2.5 w-2.5 text-claude-accent shrink-0" />
                        <span className="truncate flex-1 font-mono">{f.name}</span>
                        <span className="text-[7px] text-claude-text-muted">{f.format}</span>
                        <button
                          onClick={() => setUploadedFiles(prev => prev.filter((_, idx) => idx !== i))}
                          className="text-claude-text-muted hover:text-destructive shrink-0"
                          title="Remove file"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : searchQuery && filteredMessages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
            <Search className="h-5 w-5 text-claude-text-muted/40" />
            <p className="text-[10px] text-claude-text-muted">
              No messages match "{searchQuery}"
            </p>
            <button
              onClick={() => setSearchQuery("")}
              className="text-[10px] text-claude-accent hover:underline"
            >
              Clear search
            </button>
          </div>
        ) : (
          filteredMessages.map((m) => <MessageBubble key={m.id} message={m} searchQuery={searchQuery} />)
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-claude-border-light/40 dark:border-[#3d3832]/40 p-2">
        {/* Round 10: Markdown formatting toolbar */}
        <div className="flex items-center gap-0.5 mb-1">
          <button
            onClick={() => insertMarkdown("**", "**", "bold")}
            disabled={sendingRef.current}
            className="grid h-5 w-5 place-items-center rounded text-claude-text-muted hover:text-claude-accent hover:bg-claude-accent-light/30 disabled:opacity-40 transition-colors"
            title="Bold (Ctrl+B)"
          >
            <Bold className="h-3 w-3" />
          </button>
          <button
            onClick={() => insertMarkdown("`", "`", "code")}
            disabled={sendingRef.current}
            className="grid h-5 w-5 place-items-center rounded text-claude-text-muted hover:text-claude-accent hover:bg-claude-accent-light/30 disabled:opacity-40 transition-colors"
            title="Inline code (Ctrl+`)"
          >
            <Code className="h-3 w-3" />
          </button>
          <button
            onClick={() => insertMarkdown("- ", "", "list item")}
            disabled={sendingRef.current}
            className="grid h-5 w-5 place-items-center rounded text-claude-text-muted hover:text-claude-accent hover:bg-claude-accent-light/30 disabled:opacity-40 transition-colors"
            title="List item"
          >
            <List className="h-3 w-3" />
          </button>
          {/* Round 15: Markdown preview toggle */}
          <button
            onClick={() => setShowPreview(!showPreview)}
            disabled={sendingRef.current || !input.trim()}
            className={`grid h-5 w-5 place-items-center rounded transition-colors disabled:opacity-40 ${
              showPreview ? "text-claude-accent bg-claude-accent-light/30" : "text-claude-text-muted hover:text-claude-accent hover:bg-claude-accent-light/30"
            }`}
            title={showPreview ? "Hide preview" : "Show markdown preview"}
          >
            {showPreview ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </button>
        </div>
        {/* Round 15: Markdown live preview */}
        {showPreview && input.trim() && (
          <div className="mb-1 max-h-32 overflow-y-auto sa-scroll rounded-md border border-claude-border-light/40 dark:border-[#3d3832]/40 bg-claude-bg/60 dark:bg-[#1a1917]/60 p-1.5">
            <div className="text-[7px] font-semibold uppercase tracking-wide text-claude-text-muted mb-0.5">Preview</div>
            <div className="sa-chat-markdown text-[10px]">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {input}
              </ReactMarkdown>
            </div>
          </div>
        )}
        <div className="relative">
          <Textarea
            ref={inputRef}
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
              className="absolute bottom-1.5 right-[7rem] grid h-7 w-7 place-items-center rounded-md bg-destructive text-white hover:bg-destructive/90 transition-colors"
              title="Stop generation"
            >
              <Square className="h-3 w-3 fill-current" />
            </button>
          )}
          {/* Round 13+14: Voice input button + language selector */}
          <button
            onClick={handleVoiceInput}
            disabled={sendingRef.current}
            className={`absolute bottom-1.5 right-9 grid h-7 w-7 place-items-center rounded-md transition-colors ${
              isListening
                ? "bg-red-500 text-white animate-pulse"
                : "bg-claude-text-muted/20 text-claude-text-muted hover:text-claude-accent hover:bg-claude-accent-light/30"
            } disabled:opacity-40 disabled:cursor-not-allowed`}
            title={isListening ? "Stop voice input" : "Voice input (speak)"}
          >
            <Mic className="h-3.5 w-3.5" />
          </button>
          {/* Round 14: Voice language selector */}
          <select
            value={voiceLang}
            onChange={(e) => {
              setVoiceLang(e.target.value);
              try { localStorage.setItem("pdb-tracker:voice-lang", e.target.value); } catch { /* ignore */ }
            }}
            disabled={isListening || sendingRef.current}
            className="absolute bottom-1.5 right-[4.5rem] h-7 rounded-md border border-claude-border-light/60 dark:border-[#3d3832]/60 bg-claude-surface dark:bg-[#242220] text-[8px] text-claude-text focus:outline-none disabled:opacity-40 cursor-pointer px-1"
            title="Voice input language"
          >
            <option value="en-US">🇺🇸 EN</option>
            <option value="en-GB">🇬🇧 EN</option>
            <option value="zh-CN">🇨🇳 中文</option>
            <option value="ja-JP">🇯🇵 日本語</option>
            <option value="ko-KR">🇰🇷 한국어</option>
            <option value="es-ES">🇪🇸 Español</option>
            <option value="fr-FR">🇫🇷 Français</option>
            <option value="de-DE">🇩🇪 Deutsch</option>
          </select>
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
          <span className="flex items-center gap-2">
            {/* Round 16: Word/character count */}
            {input.trim() && (
              <span className="font-mono text-claude-text-muted/60">
                {input.trim().split(/\s+/).filter(Boolean).length} words · {input.length} chars
              </span>
            )}
            {/* Round 16: Auto-save indicator */}
            {saveStatus === "saving" && (
              <span className="flex items-center gap-0.5 text-claude-text-muted/50">
                <Loader2 className="h-2 w-2 animate-spin" />
                Saving...
              </span>
            )}
            {saveStatus === "saved" && (
              <span className="flex items-center gap-0.5 text-green-600/60">
                <Check className="h-2 w-2" />
                Saved
              </span>
            )}
            <kbd className="font-mono px-0.5 rounded bg-claude-bg dark:bg-[#1a1917] border border-claude-border/40">⌘K</kbd>
            <span>search</span>
            <kbd className="font-mono px-0.5 rounded bg-claude-bg dark:bg-[#1a1917] border border-claude-border/40">⌘E</kbd>
            <span>export</span>
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

/** Round 4: Global event bus for message editing — re-sends an edited user message. */
const EDIT_EVENT = "chat-edit-message";
function dispatchEdit(messageId: string, newContent: string) {
  window.dispatchEvent(new CustomEvent(EDIT_EVENT, { detail: { messageId, newContent } }));
}

/** Round 5: Global event bus for message reactions (👍/👎). */
const REACTION_EVENT = "chat-reaction";
function dispatchReaction(messageId: string, reaction: "thumbs-up" | "thumbs-down" | null) {
  window.dispatchEvent(new CustomEvent(REACTION_EVENT, { detail: { messageId, reaction } }));
}

/** Round 5: Global event bus for message pinning. */
const PIN_EVENT = "chat-pin";
function dispatchPin(messageId: string, pinned: boolean) {
  window.dispatchEvent(new CustomEvent(PIN_EVENT, { detail: { messageId, pinned } }));
}

/** Round 5: Global event bus for message bookmarks. */
const BOOKMARK_EVENT = "chat-bookmark";
function dispatchBookmark(messageId: string, bookmarked: boolean) {
  window.dispatchEvent(new CustomEvent(BOOKMARK_EVENT, { detail: { messageId, bookmarked } }));
}

/** Round 19: Tag management event bus. */
const TAG_EVENT = "chat-tag";
function dispatchTag(messageId: string, tags: string[]) {
  window.dispatchEvent(new CustomEvent(TAG_EVENT, { detail: { messageId, tags } }));
}

/** Round 19: Pin with note event bus. */
const PIN_NOTE_EVENT = "chat-pin-note";
function dispatchPinNote(messageId: string, note: string) {
  window.dispatchEvent(new CustomEvent(PIN_NOTE_EVENT, { detail: { messageId, note } }));
}

/**
 * Round 17: Generate contextual quick reply suggestions based on the assistant's message.
 */
function generateQuickReplies(message: ChatMessage): string[] {
  const content = (message.content || "").toLowerCase();
  const commands = (message.commands || []) as Array<{ type?: string; id?: string; recipe?: string }>;
  const replies: string[] = [];

  // Check what commands were executed
  const hasLoadPdb = commands.some(c => c.type === "load_pdb");
  const hasAnalyze = commands.some(c => c.type === "analyze_run");
  const hasMetadata = commands.some(c => c.type === "analyze_metadata");
  const pdbId = commands.find(c => c.type === "load_pdb")?.id;

  if (hasLoadPdb && !hasAnalyze) {
    replies.push("Analyze hydrogen bonds");
    replies.push("Show Ramachandran plot");
    replies.push("Run B-factor analysis");
  }
  if (hasAnalyze) {
    const recipes = commands.filter(c => c.type === "analyze_run").map(c => c.recipe);
    if (recipes.includes("hbonds") && !recipes.includes("salt_bridges")) {
      replies.push("Also check salt bridges");
    }
    if (recipes.includes("hbonds") || recipes.includes("salt_bridges")) {
      replies.push("Show hydrophobic contacts");
    }
    if (!recipes.includes("ramachandran")) {
      replies.push("Check Ramachandran quality");
    }
    if (!recipes.includes("sasa")) {
      replies.push("Calculate SASA");
    }
  }
  if (hasMetadata && !hasLoadPdb) {
    replies.push("Load this structure");
  }
  // Generic follow-ups
  if (content.includes("report") || content.includes("summary")) {
    replies.push("Export as Markdown");
  }
  if (content.includes("ligand") || content.includes("pocket")) {
    replies.push("Analyze druggability");
    replies.push("Detect all pockets");
  }
  // Always-available
  if (replies.length < 3) {
    replies.push("Generate full report");
  }
  if (replies.length < 4) {
    replies.push("Set representation to cartoon");
  }

  return replies.slice(0, 4); // Max 4 suggestions
}

/** Round 17: Quick reply suggestion chips component. */
function QuickReplies({ message }: { message: ChatMessage }) {
  const replies = useMemo(() => generateQuickReplies(message), [message]);
  const dispatchQuickReply = useCallback((reply: string) => {
    window.dispatchEvent(new CustomEvent("chat-quick-reply", { detail: reply }));
  }, []);
  if (replies.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {replies.map((reply, i) => (
        <button
          key={i}
          onClick={() => dispatchQuickReply(reply)}
          className="flex items-center gap-0.5 rounded-full border border-claude-border-light/40 dark:border-[#3d3832]/40 bg-claude-bg/40 dark:bg-[#1a1917]/40 px-2 py-0.5 text-[9px] text-claude-text-muted hover:border-claude-accent/40 hover:bg-claude-accent-light/20 hover:text-claude-accent transition-colors"
          title={`Send: ${reply}`}
        >
          <CornerDownRight className="h-2 w-2" />
          {reply}
        </button>
      ))}
    </div>
  );
}

/**
 * Round 17: Simple sentiment analysis based on keywords.
 */
function analyzeSentiment(text: string): "positive" | "neutral" | "negative" {
  const lower = text.toLowerCase();
  const positiveWords = ["success", "stable", "good", "excellent", "high quality", "well-defined", "strong", "complete", "found", "detected"];
  const negativeWords = ["error", "fail", "failed", "missing", "unstable", "poor", "low quality", "cannot", "unable", "not found", "invalid"];
  let score = 0;
  positiveWords.forEach(w => { if (lower.includes(w)) score++; });
  negativeWords.forEach(w => { if (lower.includes(w)) score--; });
  if (score > 0) return "positive";
  if (score < 0) return "negative";
  return "neutral";
}

function MessageBubble({ message, searchQuery = "" }: { message: ChatMessage; searchQuery?: string }) {
  const isUser = message.role === "user";
  const updateMessage = useAppStore((s) => s.updateChatMessage);
  // Improvement #3: Check if any message is currently pending (to disable retry)
  const sending = useAppStore((s) => s.chatMessages.some((m) => m.pending));
  const [copied, setCopied] = useState(false);
  // Round 4: Editing state for user messages
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content || "");
  // Round 15: Long message collapse state
  const COLLAPSE_THRESHOLD = 500; // characters
  const isLongMessage = !isUser && !message.pending && (message.content || "").length > COLLAPSE_THRESHOLD;
  const [isCollapsed, setIsCollapsed] = useState(true);
  // Round 19: Diff view state for edited messages
  const [showDiff, setShowDiff] = useState(false);
  const displayedContent = isLongMessage && isCollapsed
    ? (message.content || "").slice(0, COLLAPSE_THRESHOLD) + "..."
    : message.content || "";

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

  // Round 4: Save edit — dispatch the edit event
  const handleSaveEdit = useCallback(() => {
    const trimmed = editContent.trim();
    if (!trimmed || trimmed === message.content) {
      setIsEditing(false);
      return;
    }
    dispatchEdit(message.id, trimmed);
    setIsEditing(false);
  }, [editContent, message.id, message.content]);

  // Round 4: Cancel edit
  const handleCancelEdit = useCallback(() => {
    setEditContent(message.content || "");
    setIsEditing(false);
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
          // Round 11: Enhanced typing indicator with animated dots
          <div className="flex flex-col gap-1.5">
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
            {/* Round 11: Animated typing dots */}
            <div className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-claude-accent/60 animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="h-1.5 w-1.5 rounded-full bg-claude-accent/60 animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="h-1.5 w-1.5 rounded-full bg-claude-accent/60 animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        ) : (
          <>
            {isUser ? (
              isEditing ? (
                // Round 4: Edit mode for user messages
                <div className="space-y-1.5">
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full min-h-[60px] max-h-32 resize-none rounded-md border border-claude-accent/40 bg-claude-surface dark:bg-[#1a1917] px-2 py-1 text-[11px] text-claude-text focus:outline-none focus:border-claude-accent"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSaveEdit(); }
                      else if (e.key === "Escape") { e.preventDefault(); handleCancelEdit(); }
                    }}
                  />
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={handleSaveEdit}
                      disabled={!editContent.trim() || editContent.trim() === message.content}
                      className="flex items-center gap-1 rounded-md bg-claude-accent text-white px-2 py-0.5 text-[9px] font-medium hover:bg-claude-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      title="Save and re-send (Enter)"
                    >
                      <Check className="h-2.5 w-2.5" />
                      Save & Re-send
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="flex items-center gap-1 rounded-md bg-claude-text-muted/20 text-claude-text-muted px-2 py-0.5 text-[9px] font-medium hover:bg-claude-text-muted/30 transition-colors"
                      title="Cancel (Esc)"
                    >
                      <X className="h-2.5 w-2.5" />
                      Cancel
                    </button>
                    <span className="text-[8px] text-claude-text-muted ml-auto">Enter to save · Esc to cancel</span>
                  </div>
                </div>
              ) : (
                <div className="whitespace-pre-wrap">
                  {searchQuery.trim()
                    ? highlightSearch(message.content || "", searchQuery).map((seg, i) =>
                        seg.match
                          ? <mark key={i} className="bg-claude-accent/30 text-claude-accent rounded px-0.5">{seg.text}</mark>
                          : <span key={i}>{seg.text}</span>
                      )
                    : message.content
                  }
                </div>
              )
            ) : (
              <div className="sa-chat-markdown">
                {searchQuery.trim() ? (
                  <div className="whitespace-pre-wrap">
                    {highlightSearch(displayedContent, searchQuery).map((seg, i) =>
                      seg.match
                        ? <mark key={i} className="bg-claude-accent/30 text-claude-accent rounded px-0.5">{seg.text}</mark>
                        : <span key={i}>{seg.text}</span>
                    )}
                  </div>
                ) : (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      // Round 14: Enhanced code block rendering with language label + copy button
                      code({ node, className, children, ...props }: any) {
                        const match = /language-(\w+)/.exec(className || "");
                        const codeText = String(children).replace(/\n$/, "");
                        const isInline = !className && !codeText.includes("\n");
                        if (isInline) {
                          return (
                            <code className="px-1 py-0.5 rounded bg-claude-text-muted/15 text-claude-accent text-[10px] font-mono" {...props}>
                              {children}
                            </code>
                          );
                        }
                        return (
                          <div className="relative group/code my-1.5 rounded-md border border-claude-border-light/40 dark:border-[#3d3832]/40 overflow-hidden">
                            {match && (
                              <div className="flex items-center justify-between px-2 py-0.5 bg-claude-text-muted/10 border-b border-claude-border-light/30 dark:border-[#3d3832]/30">
                                <span className="text-[8px] font-mono text-claude-text-muted uppercase">{match[1]}</span>
                                <CodeBlockCopyButton code={codeText} />
                              </div>
                            )}
                            {!match && (
                              <div className="absolute top-1 right-1 opacity-0 group-hover/code:opacity-100 transition-opacity">
                                <CodeBlockCopyButton code={codeText} />
                              </div>
                            )}
                            <pre className="p-2 overflow-x-auto text-[10px] leading-relaxed">
                              <code className={className} {...props}>{children}</code>
                            </pre>
                          </div>
                        );
                      },
                      // Round 18: URL link preview — render links with external icon
                      a({ href, children, ...props }: any) {
                        const isExternal = href && (href.startsWith("http://") || href.startsWith("https://"));
                        return (
                          <a
                            href={href}
                            target={isExternal ? "_blank" : undefined}
                            rel={isExternal ? "noopener noreferrer" : undefined}
                            className="text-claude-accent underline hover:text-claude-accent-hover inline-flex items-center gap-0.5"
                            {...props}
                          >
                            {children}
                            {isExternal && <ExternalLink className="h-2 w-2 inline shrink-0" />}
                          </a>
                        );
                      },
                      // Round 18: Code block Run button for Python/JSON
                      pre({ children, ...props }: any) {
                        const codeEl = Array.isArray(children) ? children[0] : children;
                        const codeProps = codeEl?.props || {};
                        const className = codeProps.className || "";
                        const match = /language-(\w+)/.exec(className);
                        const lang = match?.[1];
                        const codeText = String(codeProps.children || "").replace(/\n$/, "");
                        const isRunnable = lang === "python" || lang === "json" || lang === "bash";
                        return (
                          <div {...props}>
                            {children}
                            {isRunnable && (
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(codeText).then(
                                    () => {
                                      // Insert into chat input for the user to use
                                      window.dispatchEvent(new CustomEvent("chat-quick-reply", { detail: `Run this code:\n\`\`\`${lang}\n${codeText}\n\`\`\`` }));
                                    },
                                    () => { /* ignore */ }
                                  );
                                }}
                                className="mt-1 flex items-center gap-0.5 text-[8px] text-claude-text-muted hover:text-claude-accent transition-colors"
                                title="Copy code and send as a chat message"
                              >
                                <Play className="h-2 w-2" />
                                Run in chat
                              </button>
                            )}
                          </div>
                        );
                      },
                    }}
                  >
                    {displayedContent}
                  </ReactMarkdown>
                )}
                {/* Round 15: Show more/less button for long messages */}
                {isLongMessage && (
                  <button
                    onClick={() => setIsCollapsed(!isCollapsed)}
                    className="mt-1 flex items-center gap-1 text-[9px] text-claude-accent hover:underline"
                    title={isCollapsed ? "Show full message" : "Collapse message"}
                  >
                    {isCollapsed ? (
                      <>
                        <ChevronDown className="h-2.5 w-2.5" />
                        Show more ({(message.content || "").length - COLLAPSE_THRESHOLD} chars hidden)
                      </>
                    ) : (
                      <>
                        <ChevronUp className="h-2.5 w-2.5" />
                        Show less
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
            {/* Round 3: Copy button — appears on hover for non-pending messages */}
            {!message.pending && message.content && !isEditing && (
              <button
                onClick={handleCopy}
                className="absolute top-1 right-1 grid h-5 w-5 place-items-center rounded text-claude-text-muted/40 hover:text-claude-accent hover:bg-claude-accent-light/30 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Copy message"
              >
                {copied ? <Check className="h-2.5 w-2.5 text-green-600" /> : <Copy className="h-2.5 w-2.5" />}
              </button>
            )}
            {/* Round 9: Timestamp — shown on hover for non-pending messages */}
            {!message.pending && (
              <span
                className={`absolute bottom-0.5 ${
                  isUser ? "left-1.5 text-white/50" : "right-1.5 text-claude-text-muted/40"
                } text-[7px] font-mono opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none`}
                title={new Date(message.ts).toLocaleString()}
              >
                {new Date(message.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            {/* Round 4: Edit button for user messages — appears on hover */}
            {isUser && !message.pending && !isEditing && !sending && (
              <button
                onClick={() => { setEditContent(message.content || ""); setIsEditing(true); }}
                className="absolute bottom-1 right-1 grid h-5 w-5 place-items-center rounded text-claude-text-muted/40 hover:text-claude-accent hover:bg-claude-accent-light/30 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Edit and re-send"
              >
                <Pencil className="h-2.5 w-2.5" />
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
                {/* Round 5: Reaction + Pin + Bookmark buttons for assistant messages */}
                {!message.pending && (
                  <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => dispatchReaction(message.id, message.reaction === "thumbs-up" ? null : "thumbs-up")}
                      className={`grid h-4 w-4 place-items-center rounded transition-colors ${
                        message.reaction === "thumbs-up"
                          ? "text-green-600 bg-green-500/10"
                          : "text-claude-text-muted/50 hover:text-green-600 hover:bg-green-500/10"
                      }`}
                      title="Good response"
                    >
                      <ThumbsUp className="h-2.5 w-2.5" />
                    </button>
                    <button
                      onClick={() => dispatchReaction(message.id, message.reaction === "thumbs-down" ? null : "thumbs-down")}
                      className={`grid h-4 w-4 place-items-center rounded transition-colors ${
                        message.reaction === "thumbs-down"
                          ? "text-red-600 bg-red-500/10"
                          : "text-claude-text-muted/50 hover:text-red-600 hover:bg-red-500/10"
                      }`}
                      title="Poor response"
                    >
                      <ThumbsDown className="h-2.5 w-2.5" />
                    </button>
                    <button
                      onClick={() => dispatchPin(message.id, !message.pinned)}
                      className={`grid h-4 w-4 place-items-center rounded transition-colors ${
                        message.pinned
                          ? "text-claude-accent bg-claude-accent-light/30"
                          : "text-claude-text-muted/50 hover:text-claude-accent hover:bg-claude-accent-light/30"
                      }`}
                      title={message.pinned ? "Unpin from top" : "Pin to top"}
                    >
                      <Pin className="h-2.5 w-2.5" />
                    </button>
                    <button
                      onClick={() => dispatchBookmark(message.id, !message.bookmarked)}
                      className={`grid h-4 w-4 place-items-center rounded transition-colors ${
                        message.bookmarked
                          ? "text-amber-600 bg-amber-500/10"
                          : "text-claude-text-muted/50 hover:text-amber-600 hover:bg-amber-500/10"
                      }`}
                      title={message.bookmarked ? "Remove bookmark" : "Bookmark this message"}
                    >
                      <Bookmark className="h-2.5 w-2.5" />
                    </button>
                  </div>
                )}
              </div>
            )}
            {/* Round 5+19: Show pinned/bookmarked indicators + pin note + tags on the message bubble */}
            {(message.pinned || message.bookmarked) && !message.pending && (
              <div className="absolute -top-1.5 -left-1.5 flex items-center gap-0.5">
                {message.pinned && (
                  <span className="grid h-3.5 w-3.5 place-items-center rounded-full bg-claude-accent text-white shadow-sm" title={`Pinned to top${message.pinNote ? `: ${message.pinNote}` : ""}`}>
                    <Pin className="h-2 w-2" />
                  </span>
                )}
                {message.bookmarked && (
                  <span className="grid h-3.5 w-3.5 place-items-center rounded-full bg-amber-500 text-white shadow-sm" title="Bookmarked">
                    <Bookmark className="h-2 w-2" />
                  </span>
                )}
              </div>
            )}
            {/* Round 19: Pin note display */}
            {message.pinned && message.pinNote && !message.pending && (
              <div className="mt-1 flex items-center gap-1 rounded bg-claude-accent/10 border border-claude-accent/20 px-1.5 py-0.5">
                <Pin className="h-2 w-2 text-claude-accent shrink-0" />
                <span className="text-[9px] text-claude-accent font-medium truncate">{message.pinNote}</span>
              </div>
            )}
            {/* Round 19: Tags display */}
            {message.tags && message.tags.length > 0 && !message.pending && (
              <div className="mt-1 flex flex-wrap gap-0.5">
                {message.tags.map((tag, i) => (
                  <span key={i} className="inline-flex items-center gap-0.5 rounded bg-claude-text-muted/10 border border-claude-border/20 px-1 py-0 text-[8px] text-claude-text-muted font-mono">
                    #{tag}
                  </span>
                ))}
              </div>
            )}
            {/* Round 19: Tag + Pin-note action buttons (hover) */}
            {!isUser && !message.pending && !message.needsConfirmation && !message.isError && message.content && (
              <div className="mt-0.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => {
                    const tag = window.prompt("Add a tag (single word, no #):");
                    if (tag && tag.trim()) {
                      const currentTags = message.tags || [];
                      const newTag = tag.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "");
                      if (newTag && !currentTags.includes(newTag)) {
                        dispatchTag(message.id, [...currentTags, newTag]);
                      }
                    }
                  }}
                  className="flex items-center gap-0.5 text-[8px] text-claude-text-muted/50 hover:text-claude-accent transition-colors"
                  title="Add a tag"
                >
                  <Tag className="h-2.5 w-2.5" />
                  Tag
                </button>
                {message.tags && message.tags.length > 0 && (
                  <button
                    onClick={() => dispatchTag(message.id, [])}
                    className="text-[8px] text-claude-text-muted/50 hover:text-destructive transition-colors"
                    title="Clear all tags"
                  >
                    Clear tags
                  </button>
                )}
                {message.pinned && (
                  <button
                    onClick={() => {
                      const note = window.prompt("Edit pin note:", message.pinNote || "");
                      if (note !== null) dispatchPinNote(message.id, note.trim());
                    }}
                    className="flex items-center gap-0.5 text-[8px] text-claude-text-muted/50 hover:text-claude-accent transition-colors"
                    title="Edit pin note"
                  >
                    <StickyNote className="h-2.5 w-2.5" />
                    Note
                  </button>
                )}
              </div>
            )}
            {/* Round 19: Diff view for edited messages */}
            {isUser && message.originalContent && !message.pending && !isEditing && (
              <div className="mt-1">
                <button
                  onClick={() => setShowDiff(!showDiff)}
                  className="flex items-center gap-0.5 text-[8px] text-claude-text-muted/50 hover:text-claude-accent transition-colors"
                  title={showDiff ? "Hide diff" : "Show original (diff)"}
                >
                  <GitCompare className="h-2.5 w-2.5" />
                  {showDiff ? "Hide diff" : "Edited — show diff"}
                </button>
                {showDiff && (
                  <div className="mt-0.5 rounded border border-claude-border/30 p-1.5 bg-claude-bg/40 dark:bg-[#1a1917]/40">
                    <div className="text-[7px] font-semibold uppercase text-red-600/70 mb-0.5">- Original</div>
                    <div className="text-[9px] text-claude-text-muted/60 whitespace-pre-wrap line-through mb-1">{message.originalContent}</div>
                    <div className="text-[7px] font-semibold uppercase text-green-600/70 mb-0.5">+ Edited</div>
                    <div className="text-[9px] text-claude-text whitespace-pre-wrap">{message.content}</div>
                  </div>
                )}
              </div>
            )}
            {/* Round 17: Quick reply suggestions after assistant responses */}
            {!isUser && !message.pending && !message.needsConfirmation && !message.isError && message.content && (
              <QuickReplies message={message} />
            )}
            {/* Round 17: Translate + Sentiment buttons */}
            {!isUser && !message.pending && !message.needsConfirmation && !message.isError && message.content && (
              <div className="mt-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handleTranslate(message.id, message.content || "")}
                  disabled={translatingId === message.id}
                  className="flex items-center gap-0.5 text-[8px] text-claude-text-muted/50 hover:text-claude-accent transition-colors disabled:opacity-40"
                  title="Translate to English"
                >
                  {translatingId === message.id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Languages className="h-2.5 w-2.5" />}
                  {translatingId === message.id ? "Translating..." : "Translate"}
                </button>
                {/* Round 17: Sentiment indicator */}
                {messageSentiment[message.id] && (
                  <span className="flex items-center gap-0.5 text-[8px]" title={`Sentiment: ${messageSentiment[message.id]}`}>
                    {messageSentiment[message.id] === "positive" && <span className="text-green-600">😊 positive</span>}
                    {messageSentiment[message.id] === "neutral" && <span className="text-claude-text-muted">😐 neutral</span>}
                    {messageSentiment[message.id] === "negative" && <span className="text-red-600">😟 negative</span>}
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
