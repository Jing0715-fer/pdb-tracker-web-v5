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
  Send, Loader2, Trash2, Sparkles, User, Bot, ChevronDown, RefreshCw, Check, X, Square, Download, Copy, Search, BarChart3, Pencil, ThumbsUp, ThumbsDown, Pin, Bookmark, History, Volume2, VolumeX, Bold, Code, List, Upload, LayoutGrid, FileText, Mic, Star, Plus, Eye, EyeOff, Tag, Bell, MessageSquare, FolderOpen,
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
import { useAppStore, type ChatMessage, type AnalysisImage } from "@/lib/molcraft/store";
import { executeCommand } from "@/lib/molcraft/commands";
import type { LlmCommand } from "@/lib/molcraft/command-schema";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  formatAnalysisResults,
  describeCommand,
} from "./chat-helpers";
import { MessageBubble, analyzeSentiment,
  RETRY_EVENT, REEXEC_EVENT, EDIT_EVENT, REACTION_EVENT,
  PIN_EVENT, BOOKMARK_EVENT, FOLDER_EVENT, BRANCH_EVENT,
  TAG_EVENT, PIN_NOTE_EVENT,
} from "./message-bubble";

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
 * Round 61: Determine if a recipe should have an automatic screenshot taken.
 * Only recipes that produce 3D-visualizable results get screenshots — pure
 * data recipes (sequence alignment, Ramachandran plot, etc.) are skipped.
 */
function shouldCaptureScreenshot(recipeId: string): boolean {
  const visualizable = new Set([
    "binding_pocket", "druggability", "all_interactions", "hbonds",
    "salt_bridges", "hydrophobic_contacts", "ligand_interactions",
    "disulfide_bonds", "metal_coordination", "aromatic_stacking",
    "water_bridges", "sasa", "electrostatic", "apbs_electrostatic",
    "virtual_screening", "druglike_screening", "interface_residues",
    "secondary_structure_simple", "bfactor_stats", "rmsd",
    "detect_pockets", "oligomer_analysis", "surface_residues",
    "conformational_changes", "protonation_states", "summary",
  ]);
  return visualizable.has(recipeId);
}

/**
 * Round 61: Get a human-readable Chinese label for a recipe (for screenshot annotation).
 */
function getRecipeLabel(recipeId: string): string {
  const labels: Record<string, string> = {
    binding_pocket: "结合口袋",
    druggability: "可成药性",
    all_interactions: "全互作",
    hbonds: "氢键",
    salt_bridges: "盐桥",
    hydrophobic_contacts: "疏水接触",
    ligand_interactions: "配体互作",
    disulfide_bonds: "二硫键",
    metal_coordination: "金属配位",
    aromatic_stacking: "芳香堆积",
    water_bridges: "水桥",
    sasa: "溶剂可及面积",
    electrostatic: "静电势",
    apbs_electrostatic: "APBS静电势",
    virtual_screening: "虚拟筛选",
    druglike_screening: "类药性筛选",
    interface_residues: "界面残基",
    secondary_structure_simple: "二级结构",
    bfactor_stats: "B因子",
    rmsd: "RMSD",
    detect_pockets: "口袋检测",
    oligomer_analysis: "寡聚体",
    surface_residues: "表面残基",
    conformational_changes: "构象变化",
    protonation_states: "质子化状态",
    summary: "结构摘要",
  };
  return labels[recipeId] || recipeId;
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
  // Round 33: Chat session management
  const chatSessions = useAppStore((s) => s.chatSessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const createChatSession = useAppStore((s) => s.createChatSession);
  const switchChatSession = useAppStore((s) => s.switchChatSession);
  const deleteChatSession = useAppStore((s) => s.deleteChatSession);
  const renameChatSession = useAppStore((s) => s.renameChatSession);
  const toggleChatSessionPin = useAppStore((s) => s.toggleChatSessionPin);
  const setChatSessionTags = useAppStore((s) => s.setChatSessionTags);
  const saveCurrentSession = useAppStore((s) => s.saveCurrentSession);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionSearch, setSessionSearch] = useState("");

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
  // Round 20: Tag filter + tag colors
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [tagColors, setTagColors] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem("pdb-tracker:tag-colors");
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  // Round 24: Bookmark folder filter
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
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
  // Round 22: Auto-tag toggle state
  const [autoTagEnabled, setAutoTagEnabled] = useState(() => {
    try { return localStorage.getItem("pdb-tracker:auto-tag") !== "off"; }
    catch { return true; }
  });
  // Round 23: Desktop notification toggle state
  const [desktopNotifEnabled, setDesktopNotifEnabled] = useState(() => {
    try { return localStorage.getItem("pdb-tracker:desktop-notif") === "on"; }
    catch { return false; }
  });
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

  // Round 33: Auto-save current session when messages change (debounced)
  useEffect(() => {
    if (!activeSessionId || messages.length === 0) return;
    const timer = setTimeout(() => {
      saveCurrentSession();
    }, 2000); // 2s debounce
    return () => clearTimeout(timer);
  }, [messages, activeSessionId, saveCurrentSession]);

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

  // Round 23: Desktop notifications when agent responds while chat not visible
  useEffect(() => {
    if (!desktopNotifEnabled) return;
    if (unreadCount > 0 && !isChatVisible && "Notification" in window) {
      if (Notification.permission === "granted") {
        const lastAssistant = [...messages].reverse().find(m => m.role === "assistant" && !m.pending);
        const preview = lastAssistant?.content?.slice(0, 100) || "Response received";
        const notif = new Notification("Molcraft AI Agent", {
          body: `${preview}${preview.length >= 100 ? "..." : ""}`,
          icon: "/logo.svg",
          tag: "chat-response",
        });
        notif.onclick = () => {
          window.focus();
          notif.close();
        };
      }
    }
  }, [unreadCount, isChatVisible, messages, desktopNotifEnabled]);

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

  // Round 22: Auto-assign suggested tags to new assistant messages
  useEffect(() => {
    if (!autoTagEnabled) return;
    messages.forEach((m) => {
      if (m.role === "assistant" && !m.pending && m.content && (!m.tags || m.tags.length === 0)) {
        const content = m.content.toLowerCase();
        const cmdTypes = (m.commands || [] as unknown[]).map((c: any) => c.type);
        const autoTags: string[] = [];
        if (cmdTypes.includes("load_pdb")) autoTags.push("loaded");
        if (cmdTypes.includes("analyze_run")) autoTags.push("analysis");
        if (content.includes("error") || content.includes("fail")) autoTags.push("issue");
        if (content.includes("ligand") || content.includes("pocket")) autoTags.push("drug-discovery");
        if (content.includes("report") || content.includes("summary")) autoTags.push("report");
        if (autoTags.length > 0) {
          updateMessage(m.id, { tags: autoTags.slice(0, 3) });
        }
      }
    });
  }, [messages, updateMessage, autoTagEnabled]);

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
          // Round 62: tag translate with a separate session so it doesn't
          // pollute the main chat session, but repeats stay consistent.
          sessionId: activeSessionId ? `translate-${activeSessionId}` : undefined,
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
          // Round 62: tag summarize with a separate session
          sessionId: activeSessionId ? `summarize-${activeSessionId}` : undefined,
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
    // Round 20: Apply tag filter
    if (tagFilter) {
      result = result.filter((m) => m.tags?.includes(tagFilter));
    }
    // Round 24: Apply bookmark folder filter
    if (folderFilter) {
      result = result.filter((m) => m.bookmarked && m.bookmarkFolder === folderFilter);
    }
    // Apply search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((m) =>
        m.content?.toLowerCase().includes(q) ||
        m.commands?.some((cmd) => {
          const c = cmd as { type?: string; recipe?: string; id?: string; compId?: string; theme?: string; preset?: string };
          return c.type?.toLowerCase().includes(q) ||
            c.recipe?.toLowerCase().includes(q) ||
            c.id?.toLowerCase().includes(q) ||
            c.compId?.toLowerCase().includes(q) ||
            c.theme?.toLowerCase().includes(q) ||
            c.preset?.toLowerCase().includes(q) ||
            describeCommand(c as unknown as LlmCommand).toLowerCase().includes(q);
        }) ||
        m.tags?.some((t) => t.toLowerCase().includes(q)) ||
        m.provider?.toLowerCase().includes(q) ||
        m.model?.toLowerCase().includes(q)
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
  }, [messages, searchQuery, filterMode, sortMode, cmdTypeFilter, tagFilter, folderFilter]);

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

  // Round 20: Collect all unique tags from messages for filter chips
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    messages.forEach(m => m.tags?.forEach(t => tagSet.add(t)));
    return Array.from(tagSet).sort();
  }, [messages]);

  // Round 24: Collect all bookmark folders
  const allBookmarkFolders = useMemo(() => {
    const folderSet = new Set<string>();
    messages.forEach(m => { if (m.bookmarked && m.bookmarkFolder) folderSet.add(m.bookmarkFolder); });
    return Array.from(folderSet).sort();
  }, [messages]);

  // Round 20: Get color for a tag (default cycle if not customized)
  const TAG_COLOR_CYCLE = ["#c96442", "#2d8f8f", "#7c5cbf", "#c9872e", "#16a34a", "#ea580c", "#0891b2", "#db2777"];
  const getTagColor = useCallback((tag: string) => {
    return tagColors[tag] || TAG_COLOR_CYCLE[tag.charCodeAt(0) % TAG_COLOR_CYCLE.length];
  }, [tagColors]);

  // Round 20: Set custom color for a tag
  const setTagColor = useCallback((tag: string, color: string) => {
    setTagColors(prev => {
      const updated = { ...prev, [tag]: color };
      try { localStorage.setItem("pdb-tracker:tag-colors", JSON.stringify(updated)); } catch { /* ignore */ }
      return updated;
    });
  }, []);

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

  /** Round 31: Export chat as JSON (full data for re-import). */
  const handleExportJson = useCallback(() => {
    if (messages.length === 0) {
      toast("No messages to export", "error");
      return;
    }
    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      provider: providerLabel,
      messageCount: messages.length,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        ts: m.ts,
        provider: m.provider,
        model: m.model,
        durationMs: m.durationMs,
        commands: m.commands,
        isError: m.isError,
        retryable: m.retryable,
        pinned: m.pinned,
        bookmarked: m.bookmarked,
        reaction: m.reaction,
        tags: m.tags,
        agentStep: m.agentStep,
      })),
    };
    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: "application/json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${messages.length} messages as JSON`, "success");
  }, [messages, providerLabel, toast]);

  /** Round 32: Import chat from JSON (restore a previously exported conversation). */
  const handleImportJson = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data || !Array.isArray(data.messages)) {
          toast("Invalid JSON: missing messages array", "error");
          return;
        }
        // Validate each message has the required fields
        const validMessages: ChatMessage[] = [];
        let skipped = 0;
        for (const m of data.messages) {
          if (!m.id || !m.role || typeof m.content !== "string" || typeof m.ts !== "number") {
            skipped++;
            continue;
          }
          validMessages.push({
            id: m.id,
            role: m.role === "user" ? "user" : "assistant",
            content: m.content,
            ts: m.ts,
            commands: m.commands,
            provider: m.provider,
            model: m.model,
            durationMs: m.durationMs,
            isError: m.isError,
            retryable: m.retryable,
            pinned: m.pinned,
            bookmarked: m.bookmarked,
            reaction: m.reaction,
            tags: m.tags,
            agentStep: m.agentStep,
            pending: false, // Never restore as pending
          });
        }
        if (validMessages.length === 0) {
          toast("No valid messages found in JSON", "error");
          return;
        }
        // Confirm before replacing current chat
        if (messages.length > 0) {
          const ok = window.confirm(
            `Import ${validMessages.length} messages? This will replace your current ${messages.length} messages.`
          );
          if (!ok) return;
        }
        // Clear current chat and add imported messages
        clearChat();
        for (const m of validMessages) {
          addMessage(m);
        }
        toast(
          skipped > 0
            ? `Imported ${validMessages.length} messages (${skipped} skipped due to missing fields)`
            : `Imported ${validMessages.length} messages from ${file.name}`,
          "success"
        );
      } catch (err) {
        toast(`Import failed: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
    };
    input.click();
  }, [messages.length, clearChat, addMessage, toast]);

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
                  // Round 62: Pass the active session id so the LLM CLI
                  // (hermes/codex/codebuddy) reuses its captured session
                  // across turns. Falls back to server-side hash when
                  // activeSessionId is null (no saved session yet).
                  sessionId: activeSessionId ?? undefined,
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
          let streamRetryable = false;
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
                    streamRetryable = !!data.retryable;
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
              retryable: streamRetryable,
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
                  ...cmd, // Copy ALL fields (type, id, recipe, compId, params, pdbId, etc.)
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

                    // Round 61/62: After a successful analyze_run, automatically
                    // capture multi-angle screenshots and use VLM to select the
                    // best one. This gives the user a visual illustration of
                    // the analysis results.
                    // Round 62: Recipe-specific visualization is now applied
                    // inside capture_multi_angle (via applyRecipeVisualization).
                    // Images are stored IMMEDIATELY (even if VLM fails), then
                    // VLM selection runs in the background and updates the
                    // best flag + commentary when it completes.
                    if (cmd.type === "analyze_run" && result.ok) {
                      const recipeId = (cmd as { recipe?: string }).recipe;
                      if (recipeId && shouldCaptureScreenshot(recipeId)) {
                        try {
                          // Extract viz params from the analysis result
                          const analysisData = (result as { analysisResult?: unknown }).analysisResult as Record<string, unknown> | undefined;
                          const vizParams: Record<string, unknown> = {};
                          if (analysisData) {
                            // Extract ligand compId for pocket-related recipes
                            const bp = analysisData.bindingPocket as Record<string, unknown> | undefined;
                            const ligand = bp?.ligand as string | undefined;
                            if (ligand) vizParams.ligandCompId = ligand;
                            // Extract chain info for interaction recipes
                            const ai = analysisData.allInteractions as Record<string, unknown> | undefined;
                            if (ai?.chain1) vizParams.chain1 = ai.chain1;
                            if (ai?.chain2) vizParams.chain2 = ai.chain2;
                          }

                          const captureResult = await executeCommand(viewer, {
                            type: "capture_multi_angle",
                            recipe: recipeId,
                            label: getRecipeLabel(recipeId),
                            angles: ["front", "side", "top"],
                            width: 1200,
                            height: 800,
                            vizParams: Object.keys(vizParams).length > 0 ? vizParams : undefined,
                          });
                          if (captureResult.ok && captureResult.data) {
                            const data = captureResult.data as {
                              screenshots: Array<{ dataUri: string; angle: string; label: string }>;
                              recipe: string;
                            };

                            // Round 62: Store images IMMEDIATELY (without VLM
                            // selection) so the user sees them right away.
                            // VLM selection runs in the background.
                            const initialImages: AnalysisImage[] = data.screenshots.map((s) => ({
                              dataUri: s.dataUri,
                              recipe: recipeId,
                              angle: s.angle as "front" | "side" | "top" | "back",
                              label: s.label,
                              // No best flag yet — VLM will set it
                            }));
                            const existingMsg = useAppStore.getState().messages.find(m => m.id === pendingId);
                            const existingImages = existingMsg?.analysisImages || [];
                            updateMessage(pendingId, {
                              analysisImages: [...existingImages, ...initialImages],
                            } as Partial<ChatMessage>);

                            // Round 62: Run VLM selection in the background.
                            // When it completes, update the images with the
                            // best flag + commentary. If it fails, the images
                            // are still visible (just without the best highlight).
                            // Round 63: Retry once after 5s if the first attempt fails.
                            if (data.screenshots.length > 1) {
                              // Don't await — fire and forget
                              (async () => {
                                const fetchVlm = async (): Promise<{ bestIndex: number; commentary: string; scores?: number[]; confidence?: "high" | "medium" | "low" } | null> => {
                                  try {
                                    const vlmResponse = await fetch("/api/vlm/select-best", {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({
                                        screenshots: data.screenshots,
                                        recipe: recipeId,
                                        analysisSummary: JSON.stringify(
                                          (result as { analysisResult?: unknown }).analysisResult
                                        ).slice(0, 2000),
                                      }),
                                    });
                                    if (vlmResponse.ok) {
                                      return await vlmResponse.json() as { bestIndex: number; commentary: string; scores?: number[]; confidence?: "high" | "medium" | "low" };
                                    }
                                    return null;
                                  } catch {
                                    return null;
                                  }
                                };

                                let vlmData = await fetchVlm();
                                // Round 63: Retry once after 5s if the first attempt failed
                                if (!vlmData) {
                                  console.warn("[auto-capture] VLM first attempt failed, retrying in 5s…");
                                  await new Promise(r => setTimeout(r, 5000));
                                  vlmData = await fetchVlm();
                                }

                                if (vlmData) {
                                  try {
                                    // Update the images with VLM selection + scores
                                    const msg = useAppStore.getState().messages.find(m => m.id === pendingId);
                                    const currentImages = msg?.analysisImages || [];
                                    // Find the images for this recipe
                                    const recipeImages = currentImages.filter(img => img.recipe === recipeId);
                                    const otherImages = currentImages.filter(img => img.recipe !== recipeId);
                                    const updatedRecipeImages = recipeImages.map((img, i) => ({
                                      ...img,
                                      best: i === vlmData!.bestIndex,
                                      vlmComment: i === vlmData!.bestIndex ? vlmData!.commentary : undefined,
                                      // Round 64: Store VLM quality score (1-10)
                                      score: vlmData!.scores && i < vlmData!.scores.length ? vlmData!.scores[i] : undefined,
                                      // Round 65: Store VLM confidence level
                                      confidence: vlmData!.confidence,
                                    }));
                                    updateMessage(pendingId, {
                                      analysisImages: [...otherImages, ...updatedRecipeImages],
                                    } as Partial<ChatMessage>);
                                  } catch (updateErr) {
                                    console.warn("[auto-capture] VLM update failed:", updateErr);
                                  }
                                } else {
                                  console.warn("[auto-capture] VLM selection failed after retry (images still visible)");
                                }
                              })();
                            }
                          }
                        } catch (captureErr) {
                          console.warn("[auto-capture] Capture failed:", captureErr);
                        }
                      }
                    }
                  }
                  // Round 26: After load_pdb, wait 2s for structure to fully load
                  // before executing subsequent commands (analyze_run, focus_ligand, etc.)
                  if (cmd.type === "load_pdb" && result.ok && ci < commands.length - 1) {
                    await new Promise(r => setTimeout(r, 2000));
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
          // Round 26: If LLM returned no commands but user's request mentions
          // loading/analysis keywords, add a helpful note
          let finalReply = reply || "Done.";
          if (commands.length === 0 && allCommands.length === 0) {
            const userLower = trimmed.toLowerCase();
            const needsAction = userLower.includes("load") || userLower.includes("analyze") ||
              userLower.includes("run") || userLower.includes("show") || userLower.includes("focus");
            if (needsAction) {
              finalReply += "\n\n⚠️ **No commands were generated.** The LLM may not have returned commands in the expected JSON format. Try rephrasing your request or switching to a different provider (e.g., 'Auto' instead of 'cli:hermes').";
            }
          }
          // Round 27: Append formatted analysis results to the reply
          if (allAnalysisResults.length > 0) {
            const resultsSummary = formatAnalysisResults(allAnalysisResults);
            if (resultsSummary) {
              finalReply += `\n\n---\n\n${resultsSummary}`;
            }
          }
          updateMessage(pendingId, {
            content: finalReply,
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

  // Round 17: Quick reply listener — sends the reply as a new message (must be after send is defined)
  useEffect(() => {
    const handler = (e: Event) => {
      const reply = (e as CustomEvent<string>).detail;
      if (reply && !sendingRef.current) send(reply);
    };
    window.addEventListener("chat-quick-reply", handler);
    return () => window.removeEventListener("chat-quick-reply", handler);
  }, [send]);

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

  // Round 24: Listen for bookmark folder events
  useEffect(() => {
    const handler = (e: Event) => {
      const { messageId, folder } = (e as CustomEvent<{ messageId: string; folder: string | undefined }>).detail;
      if (!messageId) return;
      updateMessage(messageId, { bookmarkFolder: folder });
      toast(folder ? `📁 Moved to folder: ${folder}` : "Removed from folder", "info");
    };
    window.addEventListener(FOLDER_EVENT, handler);
    return () => window.removeEventListener(FOLDER_EVENT, handler);
  }, [updateMessage, toast]);

  // Round 25: Listen for branch events — saves current conversation and starts fresh
  useEffect(() => {
    const handler = (e: Event) => {
      const { messageId } = (e as CustomEvent<{ messageId: string }>).detail;
      if (!messageId) return;
      const allMsgs = useAppStore.getState().chatMessages;
      const branchIndex = allMsgs.findIndex(m => m.id === messageId);
      if (branchIndex === -1) return;
      // Save current conversation as a named branch
      const branchName = `Branch ${new Date().toLocaleTimeString()}`;
      try {
        const branches = JSON.parse(localStorage.getItem("pdb-tracker:chat-branches") || "[]");
        branches.push({
          name: branchName,
          messages: allMsgs.slice(0, branchIndex + 1).filter(m => !m.pending),
          createdAt: Date.now(),
        });
        localStorage.setItem("pdb-tracker:chat-branches", JSON.stringify(branches.slice(-10))); // Keep last 10
      } catch { /* ignore */ }
      // Truncate to the branched message + clear its response
      const keptMsgs = allMsgs.slice(0, branchIndex + 1);
      useAppStore.setState({ chatMessages: keptMsgs });
      try {
        localStorage.setItem("pdb-tracker:chat-messages:v1", JSON.stringify(keptMsgs.filter(m => !m.pending).slice(-50)));
      } catch { /* ignore */ }
      toast(`🌿 Branched from message ${branchIndex + 1} — "${branchName}" saved`, "success");
    };
    window.addEventListener(BRANCH_EVENT, handler);
    return () => window.removeEventListener(BRANCH_EVENT, handler);
  }, [toast]);

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

  // Round 22: Rename a tag across all messages
  const handleRenameTag = useCallback((oldTag: string, newTag: string) => {
    const sanitized = newTag.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "");
    if (!sanitized || sanitized === oldTag) return;
    const allMsgs = useAppStore.getState().chatMessages;
    let count = 0;
    const updated = allMsgs.map((m) => {
      if (m.tags && m.tags.includes(oldTag)) {
        const newTags = m.tags.includes(sanitized)
          ? m.tags.filter(t => t !== oldTag) // merge: remove old if new already exists
          : m.tags.map(t => t === oldTag ? sanitized : t);
        count++;
        return { ...m, tags: newTags };
      }
      return m;
    });
    useAppStore.setState({ chatMessages: updated });
    try {
      const toSave = updated.filter((m) => !m.pending).slice(-50);
      localStorage.setItem("pdb-tracker:chat-messages:v1", JSON.stringify(toSave));
    } catch { /* ignore */ }
    toast(`🏷️ Renamed #${oldTag} → #${sanitized} (${count} messages)`, "success");
  }, [toast]);

  // Round 22: Delete a tag from all messages
  const handleDeleteTag = useCallback((tag: string) => {
    const allMsgs = useAppStore.getState().chatMessages;
    let count = 0;
    const updated = allMsgs.map((m) => {
      if (m.tags && m.tags.includes(tag)) {
        count++;
        return { ...m, tags: m.tags.filter(t => t !== tag) };
      }
      return m;
    });
    useAppStore.setState({ chatMessages: updated });
    try {
      const toSave = updated.filter((m) => !m.pending).slice(-50);
      localStorage.setItem("pdb-tracker:chat-messages:v1", JSON.stringify(toSave));
    } catch { /* ignore */ }
    toast(`🏷️ Deleted #${tag} from ${count} messages`, "info");
  }, [toast]);

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
        {/* Round 32: Provider status indicator — shows available count + rate-limit warning */}
        {providersLoading ? (
          <Loader2 className="h-2.5 w-2.5 text-claude-text-muted/40 animate-spin" />
        ) : providers.length > 0 ? (
          <span
            className="flex items-center gap-0.5 text-[8px] text-claude-text-muted/60"
            title={`${providers.filter(p => p.available).length} of ${providers.length} providers available`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${providers.some(p => p.available) ? "bg-green-500" : "bg-red-500"}`} />
            {providers.filter(p => p.available).length}/{providers.length}
          </span>
        ) : (
          <span
            className="flex items-center gap-0.5 text-[8px] text-amber-600/80"
            title="No CLI providers detected — using built-in ZAI SDK (may be rate-limited)"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            ZAI only
          </span>
        )}

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
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-claude-text-muted hover:text-claude-accent"
                    title="Export / Import chat"
                  >
                    <Download className="h-3 w-3" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-1" align="end">
                  <div className="px-2 py-1 text-[7px] font-semibold uppercase tracking-wide text-claude-text-muted/60">
                    Export
                  </div>
                  <button
                    onClick={handleExportMarkdown}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[10px] text-claude-text hover:bg-claude-accent-light/30 transition-colors"
                  >
                    <FileText className="h-3 w-3 text-claude-accent" />
                    Export as Markdown
                  </button>
                  <button
                    onClick={handleExportJson}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[10px] text-claude-text hover:bg-claude-accent-light/30 transition-colors"
                  >
                    <Code className="h-3 w-3 text-claude-accent" />
                    Export as JSON
                  </button>
                  <button
                    onClick={handleExportCommandCsv}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[10px] text-claude-text hover:bg-claude-accent-light/30 transition-colors"
                  >
                    <History className="h-3 w-3 text-claude-accent" />
                    Export commands CSV
                  </button>
                  <div className="my-1 border-t border-claude-border-light/30 dark:border-[#3d3832]/30" />
                  <div className="px-2 py-1 text-[7px] font-semibold uppercase tracking-wide text-claude-text-muted/60">
                    Import
                  </div>
                  <button
                    onClick={handleImportJson}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[10px] text-claude-text hover:bg-claude-accent-light/30 transition-colors"
                  >
                    <Upload className="h-3 w-3 text-claude-accent" />
                    Import from JSON
                  </button>
                </PopoverContent>
              </Popover>
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
                className={`h-7 w-7 p-0 ${autoTagEnabled ? "text-claude-accent" : "text-claude-text-muted hover:text-claude-accent"}`}
                onClick={() => {
                  const newVal = !autoTagEnabled;
                  setAutoTagEnabled(newVal);
                  try { localStorage.setItem("pdb-tracker:auto-tag", newVal ? "on" : "off"); } catch { /* ignore */ }
                  toast(newVal ? "Auto-tag enabled" : "Auto-tag disabled", "info");
                }}
                title={autoTagEnabled ? "Auto-tag on — click to disable" : "Auto-tag off — click to enable"}
              >
                <Tag className="h-3 w-3" />
              </Button>
              {/* Round 23: Desktop notification toggle */}
              <Button
                variant="ghost"
                size="sm"
                className={`h-7 w-7 p-0 ${desktopNotifEnabled ? "text-claude-accent" : "text-claude-text-muted hover:text-claude-accent"}`}
                onClick={async () => {
                  if (!desktopNotifEnabled && "Notification" in window) {
                    if (Notification.permission !== "granted") {
                      const perm = await Notification.requestPermission();
                      if (perm !== "granted") {
                        toast("Desktop notification permission denied", "error");
                        return;
                      }
                    }
                  }
                  const newVal = !desktopNotifEnabled;
                  setDesktopNotifEnabled(newVal);
                  try { localStorage.setItem("pdb-tracker:desktop-notif", newVal ? "on" : "off"); } catch { /* ignore */ }
                  toast(newVal ? "Desktop notifications enabled" : "Desktop notifications disabled", "info");
                }}
                title={desktopNotifEnabled ? "Desktop notifications on — click to disable" : "Desktop notifications off — click to enable"}
              >
                <Bell className="h-3 w-3" />
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
                className={`h-7 w-7 p-0 ${sessionOpen ? "text-claude-accent bg-claude-accent-light/30" : "text-claude-text-muted hover:text-claude-accent"}`}
                onClick={() => setSessionOpen(!sessionOpen)}
                title="Chat sessions"
              >
                <MessageSquare className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-claude-text-muted hover:text-claude-accent"
                onClick={() => {
                  // Save current session before creating a new one
                  if (activeSessionId && messages.length > 0) {
                    saveCurrentSession();
                  }
                  createChatSession();
                  // Round 69: Auto-open session panel so user can see history
                  setSessionOpen(true);
                  toast("New chat session created", "success");
                }}
                title="New chat session"
              >
                <Plus className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-claude-text-muted hover:text-destructive"
                onClick={() => {
                  if (activeSessionId && messages.length > 0) {
                    saveCurrentSession();
                    toast("Session saved", "success");
                  }
                  clearChat();
                  toast("Chat cleared", "info");
                }}
                title="Clear chat"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Round 33/46: Chat sessions panel (collapsible) with search filter */}
      {sessionOpen && (
        <div className="shrink-0 border-b border-claude-border-light/40 dark:border-[#3d3832]/40 px-2 py-1.5 bg-claude-bg/40 dark:bg-[#1a1917]/40 max-h-64 overflow-y-auto sa-scroll">
          <div className="flex items-center gap-1 mb-1">
            <MessageSquare className="h-2.5 w-2.5 text-claude-accent" />
            <span className="text-[8px] font-semibold uppercase tracking-wide text-claude-text-muted">
              Chat Sessions ({chatSessions.length})
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-5 px-1.5 text-[8px] gap-0.5 text-claude-accent hover:bg-claude-accent-light/30"
              onClick={() => {
                if (activeSessionId && messages.length > 0) saveCurrentSession();
                createChatSession();
                // Round 69: Keep panel open
                setSessionOpen(true);
                toast("New chat session created", "success");
              }}
            >
              <Plus className="h-2.5 w-2.5" />
              New
            </Button>
          </div>
          {/* Round 46: Session search filter */}
          {chatSessions.length > 3 && (
            <div className="relative mb-1">
              <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-claude-text-muted/50" />
              <input
                type="text"
                value={sessionSearch}
                onChange={(e) => setSessionSearch(e.target.value)}
                placeholder="Search sessions…"
                className="w-full h-6 pl-6 pr-6 rounded-md border border-claude-border-light/60 dark:border-[#3d3832]/60 bg-claude-surface dark:bg-[#242220] text-[9px] text-claude-text placeholder:text-claude-text-muted/50 focus:outline-none focus:border-claude-accent/40"
              />
              {sessionSearch && (
                <button
                  onClick={() => setSessionSearch("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-claude-text-muted hover:text-destructive"
                  title="Clear search"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          )}
          {chatSessions.length === 0 ? (
            <div className="text-[9px] text-claude-text-muted text-center py-3">
              No saved sessions yet. Click "New" to start a new conversation.
            </div>
          ) : (
            <div className="space-y-0.5">
              {chatSessions
                .filter((s) => {
                  if (!sessionSearch.trim()) return true;
                  const q = sessionSearch.toLowerCase();
                  return s.title.toLowerCase().includes(q) ||
                    s.tags?.some(t => t.toLowerCase().includes(q)) ||
                    s.messages.some((m: any) => m.content?.toLowerCase().includes(q));
                })
                .map((s) => (
                <div
                  key={s.id}
                  className={`group/sess flex items-center gap-1 rounded px-1.5 py-1 text-[10px] cursor-pointer transition-colors ${
                    s.id === activeSessionId
                      ? "bg-claude-accent-light/30 text-claude-accent"
                      : "text-claude-text hover:bg-claude-accent-light/20"
                  }`}
                  onClick={() => {
                    switchChatSession(s.id);
                    // Round 69: Keep panel open so user can switch back easily
                    toast(`Switched to "${s.title}"`, "info");
                  }}
                >
                  <MessageSquare className="h-2.5 w-2.5 shrink-0 opacity-60" />
                  {s.pinned && (
                    <Pin className="h-2 w-2 shrink-0 text-claude-accent fill-claude-accent" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{s.title}</div>
                    <div className="text-[7px] text-claude-text-muted/60">
                      {s.messages.length} msgs · {new Date(s.updatedAt).toLocaleDateString()} {new Date(s.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                    {/* Round 69: Last message preview so user can identify the conversation */}
                    {s.messages.length > 0 && (() => {
                      const lastMsg = s.messages[s.messages.length - 1];
                      const preview = lastMsg.content?.replace(/[#*`>\-]/g, '').trim().substring(0, 50) || '';
                      if (!preview) return null;
                      return (
                        <div className="text-[7px] text-claude-text-muted/40 truncate mt-0.5 italic">
                          {lastMsg.role === 'user' ? '👤' : '🤖'} {preview}{preview.length >= 50 ? '…' : ''}
                        </div>
                      );
                    })()}
                    {/* Round 47: Session tags */}
                    {s.tags && s.tags.length > 0 && (
                      <div className="flex flex-wrap gap-0.5 mt-0.5">
                        {s.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="px-1 py-0 rounded text-[7px] bg-claude-accent-light/30 text-claude-accent font-medium">
                            {tag}
                          </span>
                        ))}
                        {s.tags.length > 3 && (
                          <span className="text-[7px] text-claude-text-muted/50">+{s.tags.length - 3}</span>
                        )}
                      </div>
                    )}
                  </div>
                  {/* Pin button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleChatSessionPin(s.id);
                      toast(s.pinned ? "Session unpinned" : "Session pinned to top", "info");
                    }}
                    className={`grid h-4 w-4 place-items-center rounded transition-opacity shrink-0 ${
                      s.pinned
                        ? "text-claude-accent opacity-100"
                        : "text-claude-text-muted/40 hover:text-claude-accent hover:bg-claude-accent-light/40 opacity-0 group-hover/sess:opacity-100"
                    }`}
                    title={s.pinned ? "Unpin session" : "Pin session to top"}
                  >
                    <Pin className={`h-2 w-2 ${s.pinned ? "fill-current" : ""}`} />
                  </button>
                  {/* Round 47: Tag button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const currentTags = s.tags?.join(", ") || "";
                      const input = window.prompt("Edit tags (comma-separated):", currentTags);
                      if (input !== null) {
                        const newTags = input.split(",").map(t => t.trim()).filter(Boolean);
                        setChatSessionTags(s.id, newTags);
                        toast(newTags.length > 0 ? `Tags updated: ${newTags.join(", ")}` : "Tags cleared", "info");
                      }
                    }}
                    className={`grid h-4 w-4 place-items-center rounded transition-opacity shrink-0 ${
                      s.tags && s.tags.length > 0
                        ? "text-claude-accent opacity-100"
                        : "text-claude-text-muted/40 hover:text-claude-accent hover:bg-claude-accent-light/40 opacity-0 group-hover/sess:opacity-100"
                    }`}
                    title="Edit tags"
                  >
                    <Tag className="h-2 w-2" />
                  </button>
                  {/* Rename button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const newTitle = window.prompt("Rename session:", s.title);
                      if (newTitle && newTitle.trim()) {
                        renameChatSession(s.id, newTitle.trim());
                        toast("Session renamed", "success");
                      }
                    }}
                    className="grid h-4 w-4 place-items-center rounded text-claude-text-muted/40 hover:text-claude-accent hover:bg-claude-accent-light/40 opacity-0 group-hover/sess:opacity-100 transition-opacity shrink-0"
                    title="Rename session"
                  >
                    <Pencil className="h-2 w-2" />
                  </button>
                  {/* Delete button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Delete session "${s.title}"? This cannot be undone.`)) {
                        deleteChatSession(s.id);
                        toast("Session deleted", "info");
                      }
                    }}
                    className="grid h-4 w-4 place-items-center rounded text-claude-text-muted/40 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover/sess:opacity-100 transition-opacity shrink-0"
                    title="Delete session"
                  >
                    <Trash2 className="h-2 w-2" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
            <div className="mt-1 flex items-center justify-between text-[9px] text-claude-text-muted">
              <span>
                {filteredMessages.length} of {messages.length} messages {filterMode !== "all" ? `(${filterMode})` : "match"}
              </span>
              {searchQuery && filteredMessages.length > 0 && (
                <span className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      // Scroll to the first matching message
                      const firstMatch = filteredMessages[0];
                      if (firstMatch) {
                        const el = document.getElementById(`msg-${firstMatch.id}`);
                        el?.scrollIntoView({ behavior: "smooth", block: "center" });
                      }
                    }}
                    className="px-1.5 py-0.5 rounded bg-claude-text-muted/10 hover:bg-claude-accent-light/30 text-claude-text-muted hover:text-claude-accent transition-colors"
                    title="Jump to first match"
                  >
                    ↑ First
                  </button>
                  <button
                    onClick={() => {
                      // Scroll to the last matching message
                      const lastMatch = filteredMessages[filteredMessages.length - 1];
                      if (lastMatch) {
                        const el = document.getElementById(`msg-${lastMatch.id}`);
                        el?.scrollIntoView({ behavior: "smooth", block: "center" });
                      }
                    }}
                    className="px-1.5 py-0.5 rounded bg-claude-text-muted/10 hover:bg-claude-accent-light/30 text-claude-text-muted hover:text-claude-accent transition-colors"
                    title="Jump to last match"
                  >
                    ↓ Last
                  </button>
                </span>
              )}
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
          {/* Round 20: Tag filter chips */}
          {allTags.length > 0 && (
            <div className="mt-1 flex items-center gap-0.5 flex-wrap">
              <span className="text-[8px] font-semibold uppercase tracking-wide text-claude-text-muted/70 mr-0.5">Tags:</span>
              {allTags.map((tag) => {
                const color = getTagColor(tag);
                const isActive = tagFilter === tag;
                return (
                  <button
                    key={tag}
                    onClick={() => setTagFilter(isActive ? null : tag)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      const c = window.prompt(`Set color for #${tag} (hex, e.g. #ff6600):`, getTagColor(tag));
                      if (c) setTagColor(tag, c);
                    }}
                    className="px-1 py-0.5 rounded text-[8px] font-mono transition-all"
                    style={{
                      backgroundColor: isActive ? color : `${color}20`,
                      color: isActive ? "#fff" : color,
                      borderColor: `${color}40`,
                      border: "1px solid",
                    }}
                    title={isActive ? `Remove filter: #${tag}` : `Filter by #${tag} (right-click to set color)`}
                  >
                    #{tag}
                  </button>
                );
              })}
              {tagFilter && (
                <button
                  onClick={() => setTagFilter(null)}
                  className="px-1 py-0.5 rounded text-[8px] text-destructive hover:bg-destructive/10 transition-colors ml-1"
                  title="Clear tag filter"
                >
                  ✕ Clear
                </button>
              )}
            </div>
          )}
          {/* Round 24: Bookmark folder filter chips */}
          {allBookmarkFolders.length > 0 && (
            <div className="mt-1 flex items-center gap-0.5 flex-wrap">
              <span className="text-[8px] font-semibold uppercase tracking-wide text-claude-text-muted/70 mr-0.5">Folders:</span>
              {allBookmarkFolders.map((folder) => (
                <button
                  key={folder}
                  onClick={() => setFolderFilter(folderFilter === folder ? null : folder)}
                  className={`px-1 py-0.5 rounded text-[8px] font-mono transition-colors ${
                    folderFilter === folder
                      ? "bg-amber-500 text-white"
                      : "bg-amber-500/10 text-amber-600 hover:bg-amber-500/20"
                  }`}
                  title={folderFilter === folder ? `Remove filter: ${folder}` : `Filter by folder: ${folder}`}
                >
                  📁 {folder}
                </button>
              ))}
              {folderFilter && (
                <button
                  onClick={() => setFolderFilter(null)}
                  className="px-1 py-0.5 rounded text-[8px] text-destructive hover:bg-destructive/10 transition-colors ml-1"
                  title="Clear folder filter"
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
          {/* Round 21+22: Tag statistics with rename/delete */}
          {allTags.length > 0 && (
            <div className="mt-1.5 pt-1 border-t border-claude-border-light/30 dark:border-[#3d3832]/30">
              <div className="text-[8px] font-semibold uppercase tracking-wide text-claude-text-muted mb-0.5">Tags ({allTags.length})</div>
              <div className="space-y-0.5">
                {allTags.map(tag => {
                  const count = messages.filter(m => m.tags?.includes(tag)).length;
                  const color = getTagColor(tag);
                  return (
                    <div key={tag} className="flex items-center gap-1 text-[9px] group/tag">
                      <span
                        className="inline-flex items-center rounded px-1 py-0 text-[8px] font-mono"
                        style={{ backgroundColor: `${color}20`, color, border: `1px solid ${color}40` }}
                      >
                        #{tag}
                      </span>
                      <span className="ml-auto font-mono font-semibold text-claude-text">{count}</span>
                      <span className="text-[7px] text-claude-text-muted">msg{count > 1 ? "s" : ""}</span>
                      {/* Round 22: Rename/delete tag buttons */}
                      <button
                        onClick={() => {
                          const newName = window.prompt(`Rename tag #${tag} to:`, tag);
                          if (newName && newName.trim() && newName !== tag) handleRenameTag(tag, newName);
                        }}
                        className="opacity-0 group-hover/tag:opacity-100 text-claude-text-muted/40 hover:text-claude-accent transition-opacity"
                        title="Rename tag"
                      >
                        <Pencil className="h-2 w-2" />
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`Delete tag #${tag} from all ${count} messages?`)) handleDeleteTag(tag);
                        }}
                        className="opacity-0 group-hover/tag:opacity-100 text-claude-text-muted/40 hover:text-destructive transition-opacity"
                        title="Delete tag from all messages"
                      >
                        <Trash2 className="h-2 w-2" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {/* Round 25: Bookmark folder statistics */}
          {allBookmarkFolders.length > 0 && (
            <div className="mt-1.5 pt-1 border-t border-claude-border-light/30 dark:border-[#3d3832]/30">
              <div className="text-[8px] font-semibold uppercase tracking-wide text-claude-text-muted mb-0.5">Bookmark Folders ({allBookmarkFolders.length})</div>
              <div className="space-y-0.5">
                {allBookmarkFolders.map(folder => {
                  const count = messages.filter(m => m.bookmarked && m.bookmarkFolder === folder).length;
                  return (
                    <div key={folder} className="flex items-center gap-1 text-[9px]">
                      <span className="inline-flex items-center rounded px-1 py-0 text-[8px] font-mono bg-amber-500/10 text-amber-600 border border-amber-500/20">
                        📁 {folder}
                      </span>
                      <span className="ml-auto font-mono font-semibold text-claude-text">{count}</span>
                      <span className="text-[7px] text-claude-text-muted">msg{count > 1 ? "s" : ""}</span>
                    </div>
                  );
                })}
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
          filteredMessages.map((m) => (
            <div key={m.id} id={`msg-${m.id}`}>
              <MessageBubble
                message={m}
                searchQuery={searchQuery}
                translatingId={translatingId}
                onTranslate={handleTranslate}
                messageSentiment={messageSentiment}
              />
            </div>
          ))
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

