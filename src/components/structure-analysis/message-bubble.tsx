"use client";

/**
 * MessageBubble component + related event-bus dispatchers.
 *
 * Extracted from chat-tab.tsx (Round 30) to reduce webpack compilation
 * memory pressure in the 4GB sandbox. This is the single largest chunk
 * (~950 lines) — extracting it drops chat-tab.tsx from ~3800 to ~2860 lines.
 *
 * The component uses a global window event bus for communication back to
 * ChatTab (retry, reexec, edit, reaction, pin, bookmark, branch, tag, etc.)
 * so no callbacks need to be passed as props — only the message + a few
 * display-related props.
 */

import { useState, useCallback, useMemo, useRef } from "react";
import {
  User, Bot, Check, X, Clock, Loader2, Terminal, Brain, Cog, Timer,
  AlertCircle, Copy, Play, RotateCcw, Pencil, ThumbsUp, ThumbsDown,
  Pin, Bookmark, History, Volume2, VolumeX, Languages, CornerDownRight,
  ExternalLink, Tag, StickyNote, GitCompare, Bell, Share2, Folder,
  GitBranch, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Download, Star,
  Maximize2, ZoomIn, ZoomOut,
} from "lucide-react";
import { useAppStore, type ChatMessage } from "@/lib/molcraft/store";
import type { LlmCommand } from "@/lib/molcraft/command-schema";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  describeCommand, highlightSearch, CodeBlockCopyButton, STEP_LABELS,
} from "./chat-helpers";

// ============================================================
// Message bubble
// ============================================================

/** Improvement #3: Global event bus for retry — the MessageBubble dispatches a
 *  custom event that the ChatTab listens for, avoiding the need to pass the
 *  send callback through props or the store. */
export const RETRY_EVENT = "chat-retry";
function dispatchRetry(prompt: string) {
  window.dispatchEvent(new CustomEvent(RETRY_EVENT, { detail: prompt }));
}

/** Round 3: Global event bus for command re-execution. */
export const REEXEC_EVENT = "chat-reexec-command";
function dispatchReexec(cmd: LlmCommand) {
  window.dispatchEvent(new CustomEvent(REEXEC_EVENT, { detail: cmd }));
}

/** Round 4: Global event bus for message editing — re-sends an edited user message. */
export const EDIT_EVENT = "chat-edit-message";
function dispatchEdit(messageId: string, newContent: string) {
  window.dispatchEvent(new CustomEvent(EDIT_EVENT, { detail: { messageId, newContent } }));
}

/** Round 5: Global event bus for message reactions (👍/👎). */
export const REACTION_EVENT = "chat-reaction";
function dispatchReaction(messageId: string, reaction: "thumbs-up" | "thumbs-down" | null) {
  window.dispatchEvent(new CustomEvent(REACTION_EVENT, { detail: { messageId, reaction } }));
}

/** Round 5: Global event bus for message pinning. */
export const PIN_EVENT = "chat-pin";
function dispatchPin(messageId: string, pinned: boolean) {
  window.dispatchEvent(new CustomEvent(PIN_EVENT, { detail: { messageId, pinned } }));
}

/** Round 5: Global event bus for message bookmarks. */
export const BOOKMARK_EVENT = "chat-bookmark";
function dispatchBookmark(messageId: string, bookmarked: boolean) {
  window.dispatchEvent(new CustomEvent(BOOKMARK_EVENT, { detail: { messageId, bookmarked } }));
}

/** Round 24: Bookmark folder event bus. */
export const FOLDER_EVENT = "chat-bookmark-folder";
function dispatchFolder(messageId: string, folder: string | undefined) {
  window.dispatchEvent(new CustomEvent(FOLDER_EVENT, { detail: { messageId, folder } }));
}

/** Round 25: Conversation branch event bus. */
export const BRANCH_EVENT = "chat-branch";
function dispatchBranch(messageId: string) {
  window.dispatchEvent(new CustomEvent(BRANCH_EVENT, { detail: { messageId } }));
}

/** Round 19: Tag management event bus. */
export const TAG_EVENT = "chat-tag";
function dispatchTag(messageId: string, tags: string[]) {
  window.dispatchEvent(new CustomEvent(TAG_EVENT, { detail: { messageId, tags } }));
}

/** Round 19: Pin with note event bus. */
export const PIN_NOTE_EVENT = "chat-pin-note";
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
export function analyzeSentiment(text: string): "positive" | "neutral" | "negative" {
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

export function MessageBubble({
  message,
  searchQuery = "",
  translatingId,
  onTranslate,
  messageSentiment,
}: {
  message: ChatMessage;
  searchQuery?: string;
  translatingId: string | null;
  onTranslate: (messageId: string, content: string) => void;
  messageSentiment: Record<string, "positive" | "neutral" | "negative">;
}) {
  const isUser = message.role === "user";
  const updateMessage = useAppStore((s) => s.updateChatMessage);
  const toast = useAppStore((s) => s.toast);
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
                {/* Round 61/62: Render analysis screenshots as a carousel */}
                {!isUser && message.analysisImages && message.analysisImages.length > 0 && (
                  <AnalysisImageCarousel images={message.analysisImages} />
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
                    const hasError = status === "error" && c.error;
                    return (
                      <div
                        key={i}
                        className={`group/cmd rounded border ${statusColor} ${hasError ? "overflow-hidden" : ""}`}
                      >
                        <div className="flex items-center gap-1 px-1 py-0.5 text-[9px]">
                          <span className="font-mono text-[8px] opacity-60 shrink-0">{i + 1}.</span>
                          <span className="truncate flex-1" title={desc}>{desc}</span>
                          {/* Round 3: Show execution duration for done/error commands */}
                          {(status === "done" || status === "error") && c.durationMs != null && (
                            <span className="flex items-center gap-0.5 text-[7px] font-mono opacity-50 shrink-0" title={`Execution time: ${c.durationMs}ms`}>
                              <Timer className="h-2 w-2" />
                              {formatDuration(c.durationMs)}
                            </span>
                          )}
                          {statusIcon}
                          {/* Round 28: Prominent retry button for FAILED commands (always visible, not just hover) */}
                          {hasError && !sending && (
                            <button
                              onClick={() => dispatchReexec(c as unknown as LlmCommand)}
                              className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[7px] font-medium text-destructive hover:bg-destructive/10 hover:text-destructive transition-colors shrink-0"
                              title="Retry this command"
                            >
                              <RotateCcw className="h-2.5 w-2.5" />
                              Retry
                            </button>
                          )}
                          {/* Round 28: Copy error detail button for failed commands */}
                          {hasError && (
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(c.error || "");
                                toast("Error detail copied", "success");
                              }}
                              className="grid h-3.5 w-3.5 place-items-center rounded text-destructive/60 hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                              title="Copy error detail"
                            >
                              <Copy className="h-2 w-2" />
                            </button>
                          )}
                          {/* Round 3: Re-execute button — appears on hover for done commands */}
                          {status === "done" && !sending && (
                            <button
                              onClick={() => dispatchReexec(c as unknown as LlmCommand)}
                              className="grid h-3.5 w-3.5 place-items-center rounded text-claude-text-muted/40 hover:text-claude-accent hover:bg-claude-accent-light/40 opacity-0 group-hover/cmd:opacity-100 transition-opacity shrink-0"
                              title="Re-execute this command"
                            >
                              <Play className="h-2 w-2" />
                            </button>
                          )}
                        </div>
                        {/* Round 28: Inline error detail for failed commands */}
                        {hasError && (
                          <div className="px-1.5 pb-1 pt-0.5 border-t border-destructive/15 bg-destructive/5">
                            <div className="flex items-start gap-1 text-[8px] text-destructive/90 font-mono leading-tight">
                              <AlertCircle className="h-2.5 w-2.5 shrink-0 mt-px" />
                              <span className="break-words">{c.error}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {/* Round 50: Command execution timeline (Gantt-style) */}
                {message.commands && message.commands.length > 1 && message.commands.some((cmd: any) => cmd.durationMs != null) && (() => {
                  const cmds = message.commands as Array<{ durationMs?: number; status?: string; type?: string }>;
                  const completed = cmds.filter(c => c.durationMs != null && (c.status === "done" || c.status === "error"));
                  if (completed.length < 2) return null;
                  const totalMs = completed.reduce((sum, c) => sum + (c.durationMs || 0), 0);
                  if (totalMs === 0) return null;
                  const maxMs = Math.max(...completed.map(c => c.durationMs || 0));
                  return (
                    <div className="mt-1 rounded border border-claude-border-light/30 dark:border-[#3d3832]/30 bg-claude-bg/40 dark:bg-[#1a1917]/40 p-1.5">
                      <div className="flex items-center gap-1 mb-1">
                        <Terminal className="h-2 w-2 text-claude-accent" />
                        <span className="text-[7px] font-semibold uppercase tracking-wide text-claude-text-muted">
                          Execution Timeline
                        </span>
                        <span className="text-[7px] text-claude-text-muted/60 ml-auto">
                          Total: {(totalMs / 1000).toFixed(1)}s
                        </span>
                      </div>
                      <div className="space-y-0.5">
                        {completed.map((c, i) => {
                          const pct = ((c.durationMs || 0) / maxMs) * 100;
                          const isError = c.status === "error";
                          const color = isError
                            ? "bg-destructive/60"
                            : (c.durationMs || 0) > maxMs * 0.5
                              ? "bg-claude-accent/60"
                              : "bg-green-500/40";
                          return (
                            <div key={i} className="flex items-center gap-1 text-[7px]">
                              <span className="font-mono text-claude-text-muted/60 w-4 shrink-0">{i + 1}.</span>
                              <span className="text-claude-text-muted truncate w-20 shrink-0" title={c.type}>{c.type || "?"}</span>
                              <div className="flex-1 h-2 bg-claude-text-muted/10 rounded-sm overflow-hidden">
                                <div
                                  className={`h-full ${color} rounded-sm transition-all`}
                                  style={{ width: `${Math.max(pct, 2)}%` }}
                                  title={`${c.type}: ${(c.durationMs || 0)}ms`}
                                />
                              </div>
                              <span className="font-mono text-claude-text-muted/60 w-10 text-right shrink-0">
                                {c.durationMs! < 1000 ? `${c.durationMs}ms` : `${(c.durationMs! / 1000).toFixed(1)}s`}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
            {/* Improvement #3: Retry button for error messages */}
            {!isUser && message.isError && message.retryPrompt && !sending && (
              <div className="mt-2 flex items-center gap-2 border-t border-destructive/20 pt-1.5">
                <button
                  onClick={() => dispatchRetry(message.retryPrompt!)}
                  className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors ${
                    message.retryable
                      ? "bg-destructive text-white hover:bg-destructive/90 animate-pulse"
                      : "bg-claude-accent text-white hover:bg-claude-accent-hover"
                  }`}
                  title={message.retryable ? "Retry now — this was a transient error" : "Re-send the last message"}
                >
                  <RotateCcw className="h-3 w-3" />
                  {message.retryable ? "Retry now" : "Retry"}
                </button>
                <span className="text-[8px] text-claude-text-muted">
                  {message.retryable
                    ? "Transient error — retrying usually works"
                    : "Re-send the original request"}
                </span>
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
            {/* Round 19+20: Tags display with custom colors */}
            {message.tags && message.tags.length > 0 && !message.pending && (
              <div className="mt-1 flex flex-wrap gap-0.5">
                {message.tags.map((tag, i) => {
                  // Round 20: Read custom color from localStorage, fallback to hash-based color
                  let color = "#888888";
                  try {
                    const raw = localStorage.getItem("pdb-tracker:tag-colors");
                    const colors = raw ? JSON.parse(raw) : {};
                    if (colors[tag]) { color = colors[tag]; }
                    else {
                      const cycle = ["#c96442", "#2d8f8f", "#7c5cbf", "#c9872e", "#16a34a", "#ea580c", "#0891b2", "#db2777"];
                      color = cycle[tag.charCodeAt(0) % cycle.length];
                    }
                  } catch { /* ignore */ }
                  return (
                    <span
                      key={i}
                      className="inline-flex items-center gap-0.5 rounded px-1 py-0 text-[8px] font-mono"
                      style={{ backgroundColor: `${color}20`, color, border: `1px solid ${color}40` }}
                    >
                      #{tag}
                    </span>
                  );
                })}
              </div>
            )}
            {/* Round 19+21: Tag + Pin-note action buttons with tag suggestions (hover) */}
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
                {/* Round 21: Auto-suggested tags based on content */}
                {(() => {
                  const content = (message.content || "").toLowerCase();
                  const cmdTypes = (message.commands || [] as unknown[]).map((c: any) => c.type);
                  const suggestions: string[] = [];
                  if (cmdTypes.includes("load_pdb")) suggestions.push("loaded");
                  if (cmdTypes.includes("analyze_run")) suggestions.push("analysis");
                  if (content.includes("error") || content.includes("fail")) suggestions.push("issue");
                  if (content.includes("ligand") || content.includes("pocket")) suggestions.push("drug-discovery");
                  if (content.includes("report") || content.includes("summary")) suggestions.push("report");
                  if (content.includes("hydrogen bond") || content.includes("hbond")) suggestions.push("interactions");
                  if (content.includes("ramachandran")) suggestions.push("quality");
                  if (content.includes("sasa") || content.includes("surface")) suggestions.push("surface");
                  const currentTags = message.tags || [];
                  const newSuggestions = suggestions.filter(s => !currentTags.includes(s)).slice(0, 3);
                  if (newSuggestions.length === 0) return null;
                  return (
                    <div className="flex items-center gap-0.5">
                      <span className="text-[7px] text-claude-text-muted/40">suggested:</span>
                      {newSuggestions.map(s => (
                        <button
                          key={s}
                          onClick={() => dispatchTag(message.id, [...currentTags, s])}
                          className="px-1 py-0 rounded text-[7px] text-claude-accent/60 hover:text-claude-accent hover:bg-claude-accent-light/20 transition-colors font-mono"
                          title={`Add suggested tag: #${s}`}
                        >
                          +{s}
                        </button>
                      ))}
                    </div>
                  );
                })()}
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
                {/* Round 24: Move to bookmark folder */}
                {message.bookmarked && (
                  <button
                    onClick={() => {
                      const folder = window.prompt("Move to folder (empty to remove):", message.bookmarkFolder || "");
                      if (folder !== null) dispatchFolder(message.id, folder.trim() || undefined);
                    }}
                    className="flex items-center gap-0.5 text-[8px] text-claude-text-muted/50 hover:text-amber-600 transition-colors"
                    title={message.bookmarkFolder ? `Folder: ${message.bookmarkFolder} (click to change)` : "Move to folder"}
                  >
                    <Folder className="h-2.5 w-2.5" />
                    {message.bookmarkFolder || "Folder"}
                  </button>
                )}
                {/* Round 25: Branch conversation from this message */}
                <button
                  onClick={() => dispatchBranch(message.id)}
                  className="flex items-center gap-0.5 text-[8px] text-claude-text-muted/50 hover:text-green-600 transition-colors"
                  title="Branch conversation from here (saves current + starts fresh)"
                >
                  <GitBranch className="h-2.5 w-2.5" />
                  Branch
                </button>
              </div>
            )}
            {/* Round 19+20: Diff view for edited messages (word-level highlighting) */}
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
                {showDiff && (() => {
                  // Round 20: Word-level diff
                  const origWords = (message.originalContent || "").split(/(\s+)/);
                  const newWords = (message.content || "").split(/(\s+)/);
                  // Simple LCS-based word diff
                  const origSet = new Set(origWords.filter(w => w.trim()));
                  const newSet = new Set(newWords.filter(w => w.trim()));
                  return (
                    <div className="mt-0.5 rounded border border-claude-border/30 p-1.5 bg-claude-bg/40 dark:bg-[#1a1917]/40">
                      <div className="text-[7px] font-semibold uppercase text-red-600/70 mb-0.5">- Original</div>
                      <div className="text-[9px] whitespace-pre-wrap mb-1">
                        {origWords.map((word, i) => {
                          const isRemoved = word.trim() && !newSet.has(word);
                          return (
                            <span key={i} className={isRemoved ? "bg-red-500/20 text-red-600 line-through rounded px-0.5" : "text-claude-text-muted/60"}>
                              {word}
                            </span>
                          );
                        })}
                      </div>
                      <div className="text-[7px] font-semibold uppercase text-green-600/70 mb-0.5">+ Edited</div>
                      <div className="text-[9px] whitespace-pre-wrap">
                        {newWords.map((word, i) => {
                          const isAdded = word.trim() && !origSet.has(word);
                          return (
                            <span key={i} className={isAdded ? "bg-green-500/20 text-green-600 rounded px-0.5" : "text-claude-text"}>
                              {word}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
                {/* Round 21: Export diff as patch file */}
                {showDiff && (
                  <button
                    onClick={() => {
                      const orig = message.originalContent || "";
                      const edited = message.content || "";
                      const patch = `--- original\n+++ edited\n@@ -1 +1 @@\n-${orig}\n+${edited}\n`;
                      const blob = new Blob([patch], { type: "text/plain;charset=utf-8;" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `message-diff-${message.id}.patch`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="mt-1 flex items-center gap-0.5 text-[8px] text-claude-text-muted/50 hover:text-claude-accent transition-colors"
                    title="Export diff as patch file"
                  >
                    <Download className="h-2.5 w-2.5" />
                    Export patch
                  </button>
                )}
              </div>
            )}
            {/* Round 17: Quick reply suggestions after assistant responses */}
            {!isUser && !message.pending && !message.needsConfirmation && !message.isError && message.content && (
              <QuickReplies message={message} />
            )}
            {/* Round 17+23: Translate + Sentiment + Share buttons */}
            {!isUser && !message.pending && !message.needsConfirmation && !message.isError && message.content && (
              <div className="mt-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => onTranslate(message.id, message.content || "")}
                  disabled={translatingId === message.id}
                  className="flex items-center gap-0.5 text-[8px] text-claude-text-muted/50 hover:text-claude-accent transition-colors disabled:opacity-40"
                  title="Translate to English"
                >
                  {translatingId === message.id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Languages className="h-2.5 w-2.5" />}
                  {translatingId === message.id ? "Translating..." : "Translate"}
                </button>
                {/* Round 23: Share message (copy as markdown) */}
                <button
                  onClick={() => {
                    const text = message.content || "";
                    navigator.clipboard.writeText(text).then(
                      () => toast("Message copied to clipboard", "success"),
                      () => toast("Copy failed", "error"),
                    );
                  }}
                  className="flex items-center gap-0.5 text-[8px] text-claude-text-muted/50 hover:text-claude-accent transition-colors"
                  title="Copy message content"
                >
                  <Share2 className="h-2.5 w-2.5" />
                  Share
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

/**
 * Round 62: AnalysisImageCarousel — displays analysis screenshots in a
 * swipeable carousel with thumbnail navigation.
 *
 * Features:
 * - Main image view with label + VLM commentary overlay
 * - Thumbnail strip at the bottom for quick navigation
 * - VLM-selected best image is auto-selected and highlighted with star
 * - Click main image to open full-size in new tab
 * - Keyboard navigation (left/right arrows) when focused
 */
function AnalysisImageCarousel({ images }: { images: import("@/lib/molcraft/store").AnalysisImage[] }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [downloaded, setDownloaded] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Round 63: Keyboard navigation — left/right arrows to navigate,
  // but only when the carousel container is focused or hovered.
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setActiveIdx(i => Math.max(0, i - 1));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setActiveIdx(i => Math.min(images.length - 1, i + 1));
    }
  }, [images.length]);

  // Round 63: Download the current screenshot as a PNG file.
  const handleDownload = useCallback(() => {
    // We read currentImg from the closure — it's computed below, but
    // useCallback needs to be called unconditionally (before any early return).
    const bestIdx = images.findIndex(img => img.best);
    const currentIdx = bestIdx >= 0 ? bestIdx : Math.min(activeIdx, images.length - 1);
    const img = images[currentIdx];
    if (!img) return;
    const a = document.createElement("a");
    a.href = img.dataUri;
    a.download = `${img.recipe}-${img.angle}-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 1500);
  }, [images, activeIdx]);

  // Round 62: Auto-select the best image when VLM selection completes.
  // Instead of using useEffect + setState (which triggers lint warning),
  // we compute the effective index directly during render.
  const bestIdx = images.findIndex(img => img.best);
  // If there's a best image and the user hasn't manually navigated away,
  // show the best image. Otherwise show the activeIdx.
  const currentIdx = bestIdx >= 0 ? bestIdx : Math.min(activeIdx, images.length - 1);
  const currentImg = images[currentIdx];
  if (!currentImg) return null;

  const goToPrev = () => setActiveIdx(i => Math.max(0, i - 1));
  const goToNext = () => setActiveIdx(i => Math.min(images.length - 1, i + 1));

  return (
    <div
      ref={containerRef}
      className="mt-3 rounded-lg border border-claude-border-light/40 dark:border-[#3d3832]/40 overflow-hidden bg-claude-bg dark:bg-[#1a1917] focus:outline-none"
      tabIndex={0}
      onKeyDown={images.length > 1 ? handleKeyDown : undefined}
    >
      {/* Main image area */}
      <div className="relative group">
        {/* Label badge (top-left) */}
        <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/70 backdrop-blur-sm text-white text-[10px] font-medium">
          {currentImg.best && <Star className="h-3 w-3 text-claude-accent" />}
          <span>{currentImg.label}</span>
          <span className="text-white/50 ml-1">{currentIdx + 1}/{images.length}</span>
        </div>

        {/* Score badge (top-left, below label) — Round 64 */}
        {currentImg.score != null && (
          <div className={`absolute top-9 left-2 z-10 flex items-center gap-1 px-2 py-0.5 rounded-md backdrop-blur-sm text-[9px] font-bold ${
            currentImg.score >= 8 ? 'bg-emerald-500/80 text-white' :
            currentImg.score >= 5 ? 'bg-amber-500/80 text-white' :
            'bg-red-500/80 text-white'
          }`}>
            <span>★ {currentImg.score}/10</span>
          </div>
        )}

        {/* Download button (top-right) — Round 63 */}
        <button
          type="button"
          onClick={handleDownload}
          className="absolute top-2 right-2 z-10 h-7 w-7 rounded-full bg-black/60 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/80 transition-colors"
          title={downloaded ? "已下载" : "下载截图"}
        >
          {downloaded ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Download className="h-3.5 w-3.5" />}
        </button>

        {/* VLM commentary overlay (bottom) */}
        {currentImg.vlmComment && (
          <div className="absolute bottom-2 left-2 right-2 z-10 px-3 py-1.5 rounded-md bg-black/70 backdrop-blur-sm text-white/95 text-[10px] leading-relaxed">
            <span className="text-claude-accent font-medium">VLM: </span>
            {currentImg.vlmComment}
          </div>
        )}

        {/* Navigation arrows (only if >1 image) */}
        {images.length > 1 && (
          <>
            <button
              type="button"
              onClick={goToPrev}
              disabled={currentIdx === 0}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-10 h-7 w-7 rounded-full bg-black/60 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/80 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Previous (←)"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={goToNext}
              disabled={currentIdx === images.length - 1}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-10 h-7 w-7 rounded-full bg-black/60 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/80 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Next (→)"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}

        {/* The image */}
        <img
          src={currentImg.dataUri}
          alt={currentImg.label}
          className="w-full h-auto max-h-80 object-contain"
          loading="lazy"
          onClick={() => {
            // Round 64: Open in full-screen lightbox instead of new tab
            setZoom(1);
            setPanX(0);
            setPanY(0);
            setLightboxOpen(true);
          }}
          style={{ cursor: 'pointer' }}
        />
      </div>

      {/* Thumbnail strip (only if >1 image) */}
      {images.length > 1 && (
        <div className="flex gap-1 p-1.5 bg-claude-surface/60 dark:bg-[#242220]/60 overflow-x-auto thin-scroll">
          {images.map((img, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setActiveIdx(idx)}
              className={`relative shrink-0 h-12 w-16 rounded overflow-hidden border-2 transition-all ${
                idx === currentIdx
                  ? "border-claude-accent opacity-100"
                  : "border-transparent opacity-60 hover:opacity-100"
              }`}
              title={img.label}
            >
              <img
                src={img.dataUri}
                alt={img.label}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              {img.best && (
                <div className="absolute top-0 right-0 bg-claude-accent rounded-bl px-0.5">
                  <Star className="h-2 w-2 text-white" />
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Action bar — Round 64: batch download + expand */}
      <div className="flex items-center justify-between px-2 py-1 bg-claude-surface/40 dark:bg-[#242220]/40 border-t border-claude-border-light/20 dark:border-[#3d3832]/20">
        <button
          type="button"
          onClick={() => {
            // Round 64: Batch download all screenshots
            images.forEach((img, i) => {
              setTimeout(() => {
                const a = document.createElement("a");
                a.href = img.dataUri;
                a.download = `${img.recipe}-${img.angle}-${Date.now()}-${i}.png`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
              }, i * 200); // 200ms delay between downloads to avoid browser blocking
            });
          }}
          className="flex items-center gap-1 text-[9px] text-claude-text-muted hover:text-claude-accent transition-colors"
          title="下载所有截图"
        >
          <Download className="h-2.5 w-2.5" />
          下载全部 ({images.length})
        </button>
        <button
          type="button"
          onClick={() => {
            setZoom(1);
            setPanX(0);
            setPanY(0);
            setLightboxOpen(true);
          }}
          className="flex items-center gap-1 text-[9px] text-claude-text-muted hover:text-claude-accent transition-colors"
          title="全屏查看"
        >
          <Maximize2 className="h-2.5 w-2.5" />
          全屏
        </button>
      </div>

      {/* Keyboard hint (only if >1 image) — Round 63 */}
      {images.length > 1 && (
        <div className="px-2 py-1 text-[8px] text-claude-text-muted/50 text-center border-t border-claude-border-light/20 dark:border-[#3d3832]/20">
          ← → 键切换 · 点击图片全屏查看 · 点击下载按钮保存
        </div>
      )}

      {/* Round 64: Full-screen lightbox with zoom/pan */}
      {lightboxOpen && currentImg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setLightboxOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setLightboxOpen(false);
            if (e.key === "ArrowLeft" && images.length > 1) {
              e.stopPropagation();
              setActiveIdx(i => Math.max(0, i - 1));
              setZoom(1); setPanX(0); setPanY(0);
            }
            if (e.key === "ArrowRight" && images.length > 1) {
              e.stopPropagation();
              setActiveIdx(i => Math.min(images.length - 1, i + 1));
              setZoom(1); setPanX(0); setPanY(0);
            }
          }}
          tabIndex={0}
          style={{ outline: 'none' }}
        >
          {/* Top toolbar */}
          <div className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-black/60 backdrop-blur-sm text-white text-xs">
              {currentImg.best && <Star className="h-3 w-3 text-claude-accent" />}
              <span className="font-medium">{currentImg.label}</span>
              {images.length > 1 && <span className="text-white/50 ml-1">{currentIdx + 1}/{images.length}</span>}
              {currentImg.score != null && (
                <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  currentImg.score >= 8 ? 'bg-emerald-500/30 text-emerald-300' :
                  currentImg.score >= 5 ? 'bg-amber-500/30 text-amber-300' :
                  'bg-red-500/30 text-red-300'
                }`}>
                  ★ {currentImg.score}/10
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {/* Zoom controls */}
              <button
                type="button"
                onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}
                className="h-8 w-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
                title="缩小"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="text-white text-xs w-12 text-center font-mono">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                onClick={() => setZoom(z => Math.min(4, z + 0.25))}
                className="h-8 w-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
                title="放大"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => { setZoom(1); setPanX(0); setPanY(0); }}
                className="h-8 w-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors ml-1"
                title="重置"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleDownload}
                className="h-8 w-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors ml-1"
                title="下载"
              >
                <Download className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setLightboxOpen(false)}
                className="h-8 w-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors ml-1"
                title="关闭 (Esc)"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Navigation arrows */}
          {images.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setActiveIdx(i => Math.max(0, i - 1)); setZoom(1); setPanX(0); setPanY(0); }}
                disabled={currentIdx === 0}
                className="absolute left-4 top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="上一张 (←)"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setActiveIdx(i => Math.min(images.length - 1, i + 1)); setZoom(1); setPanX(0); setPanY(0); }}
                disabled={currentIdx === images.length - 1}
                className="absolute right-4 top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="下一张 (→)"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          )}

          {/* The zoomable image */}
          <img
            src={currentImg.dataUri}
            alt={currentImg.label}
            className="max-w-[90vw] max-h-[85vh] object-contain transition-transform"
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => {
              e.preventDefault();
              const delta = e.deltaY > 0 ? -0.1 : 0.1;
              setZoom(z => Math.max(0.5, Math.min(4, z + delta)));
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setZoom(z => z === 1 ? 2 : 1);
              setPanX(0);
              setPanY(0);
            }}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
            }}
            onDrag={(e) => {
              if (e.clientX !== 0 || e.clientY !== 0) {
                setPanX(x => x + e.movementX);
                setPanY(y => y + e.movementY);
              }
            }}
            style={{
              transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
              cursor: zoom > 1 ? 'move' : 'pointer',
              transition: 'transform 0.1s ease-out',
            }}
          />

          {/* VLM commentary in lightbox */}
          {currentImg.vlmComment && (
            <div className="absolute bottom-4 left-4 right-4 z-10 px-4 py-2 rounded-md bg-black/70 backdrop-blur-sm text-white/95 text-xs leading-relaxed max-w-2xl mx-auto" onClick={(e) => e.stopPropagation()}>
              <span className="text-claude-accent font-medium">VLM: </span>
              {currentImg.vlmComment}
            </div>
          )}

          {/* Bottom hint */}
          <div className="absolute bottom-2 left-0 right-0 text-center text-white/40 text-[10px]" onClick={(e) => e.stopPropagation()}>
            滚轮缩放 · 双击切换 100%/200% · 拖拽平移 · ← → 切换 · Esc 关闭
          </div>
        </div>
      )}
    </div>
  );
}
