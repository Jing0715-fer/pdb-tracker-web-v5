/**
 * useAgentSession — React hook that orchestrates one agent session.
 *
 * Responsibilities:
 *   - Create a session on mount (POST /api/agent/sessions)
 *   - Subscribe to the SSE event stream (GET /events)
 *   - Project session events into a list of ConversationNodes for the UI
 *   - sendMessage(content): POST /messages → if toolCalls returned, execute
 *     each against Molstar via executeCommand, POST results back, repeat
 *     until done. Emits approval/asked events for tools needing approval.
 *   - resolveApproval(callId, decision): POST /approval
 *
 * The hook talks ONLY to the new deepseek-harness-inspired agent API. It does
 * not use the legacy molcraft use-agent-loop.
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { executeCommand, __drainCaptureQueue } from '@/lib/molcraft/commands';
import type { CommandResult } from '@/lib/molcraft/commands';
import { clearAllMeasurements } from '@/lib/molcraft/commands/measurement-utils';
import type { VlmResult } from '@/lib/molcraft/vlm-client';
import type { MolstarViewer } from '@/lib/molcraft/types';
import { toolToCommand, requiresApproval, SERVER_SIDE_TOOLS } from '@/lib/agent/pdb-tools';
import type { SessionEvent } from '@/lib/agent/session/types';
import type { ContentBlock, StreamChunk } from '@/lib/agent/llm/types';

export interface SessionListItem {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  eventCount: number;
}

export interface PendingToolCall {
  callId: string;
  name: string;
  arguments: string;
}

export interface ToolExecution {
  callId: string;
  name: string;
  status: 'pending' | 'running' | 'ok' | 'error';
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs?: number; // R113.7: execution time for display
}

export interface PendingApproval {
  callId: string;
  toolName: string;
  summary: string;
  args: unknown;
}

export interface TokenUsageSummary {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
}

export type ConversationNode =
  | { kind: 'user-message'; seq: number; text: string }
  | { kind: 'assistant-message'; seq: number; text: string; reasoning?: string }
  | { kind: 'streaming-assistant'; seq: number; text: string; done: boolean; turn: number; step: number }
  | { kind: 'tool-call'; seq: number; callId: string; name: string; args: Record<string, unknown>; status: 'pending' | 'running' | 'ok' | 'error'; result?: unknown; error?: string; startedAt?: number; durationMs?: number }
  | { kind: 'turn-boundary'; seq: number; turn: number; type: 'start' | 'end'; reason?: string }
  | { kind: 'step-boundary'; seq: number; turn: number; step: number; type: 'start' | 'end' };

/**
 * UI-012 (minimal hardening): screenshot payload shared by every capture
 * path (capture_multi_angle / pdb_analyze auto-capture / recapture).
 * Structurally compatible with vlm-client's ScreenshotData.
 */
export interface CaptureScreenshot {
  dataUri: string;
  angle: string;
  label: string;
  cameraState?: unknown;
}

/** UI-012: progress payload written by the VLM-controlled capture loop. */
export interface AutoCaptureProgress {
  iteration: number;
  maxIterations: number;
  phase: 'capturing' | 'vlm-analyzing' | 'done' | 'error';
  screenshotsCount: number;
}

/** UI-012: summary attached as `autoCapture` after the VLM capture loop ends. */
export interface AutoCaptureSummary {
  ok: boolean;
  detail: string;
  data: { recipe: string; label: string; screenshots: CaptureScreenshot[] };
  captureDurationMs: number;
  vlmResult?: VlmResult;
  vlmDurationMs: number;
  vlmIterations: number;
  vlmAcceptable?: boolean;
  vlmError?: string;
  pairwisePairs?: Array<{ chain1: unknown; chain2: unknown; total: unknown }>;
}

/**
 * UI-012 (minimal): the annotated result of capture-class tool calls.
 * `CommandResult` covers ok/detail/data/analysisResult; the agent path
 * additionally attaches VLM + auto-capture bookkeeping to the SAME object
 * after executeCommand returns. These fields were previously read/written
 * through `as any`, hiding typos (e.g. `vlmEror` vs `vlmError`) from the
 * compiler at exactly the hot mutation sites. Deliberately NO index
 * signature — unknown keys stay compile errors. ToolCallCard keeps its own
 * defensive reads and is unchanged.
 */
export interface AnnotatedCaptureResult extends CommandResult {
  data?: CommandResult['data'] & { screenshots?: CaptureScreenshot[] };
  /** analyze_run shape: { kind, recipe, data: API_BODY } where API_BODY nests
   * the recipe output under its own `data` (see the R166 unwrap chain). */
  analysisResult?: { kind?: string; recipe?: string; data?: { data?: Record<string, unknown> } & Record<string, unknown> };
  vlmResult?: VlmResult | null;
  vlmDurationMs?: number;
  vlmError?: string;
  vlmPending?: boolean;
  autoCapture?: AutoCaptureSummary;
  autoCaptureProgress?: AutoCaptureProgress;
  autoCapturePending?: boolean;
  autoCaptureError?: string;
}

/**
 * UI-013: max POST→tools→POST round-trips per driveLoop call. Was a bare
 * `guard < 12` that exited SILENTLY on long multi-step tasks (the agent just
 * stopped mid-task with no message). Raised to 30 + a user-visible error
 * banner on exhaustion.
 */
const MAX_DRIVE_ITERATIONS = 30;

/**
 * UI-010: max consecutive SSE failures before the stream is declared dead.
 * After this many errors in a row we close the EventSource (instead of
 * letting the browser retry forever) and show a "session lost — refresh"
 * banner. A successful reconnect resets the counter, so a flaky-but-alive
 * network never trips the cap.
 */
const MAX_SSE_RETRY_ERRORS = 10;

/**
 * UI-007: progress ticks re-render the whole conversation (full event walk +
 * node re-projection); throttle them to at most one render per this many ms.
 */
const PROGRESS_REFRESH_MS = 500;

/**
 * UI-014: how long waitForApproval polls an unanswered approval prompt
 * before treating it as rejected (orphaned prompts can never resolve — no
 * drive loop outlives a page reload).
 */
const MAX_APPROVAL_WAIT_MS = 300_000; // 5 minutes

export interface UseAgentSessionOptions {
  viewer: MolstarViewer | null;
}

export interface AgentSessionState {
  sessionId: string | null;
  sessionTitle: string;
  connected: boolean;
  /** UI-010: true once the SSE stream gave up (retry cap / fatal error) —
   * the UI shows a "session lost — refresh" banner and stops pulsing
   * "connecting" forever. */
  sseDead: boolean;
  driving: boolean;
  nodes: ConversationNode[];
  pendingApprovals: PendingApproval[];
  toolExecutions: Map<string, ToolExecution>;
  tokenUsage: TokenUsageSummary;
  feedback: Map<number, 'up' | 'down'>;
  error: string | null;
  startNewSession: () => Promise<void>;
  loadSession: (id: string) => Promise<void>;
  listSessions: () => Promise<SessionListItem[]>;
  regenerate: () => Promise<void>;
  recordFeedback: (messageSeq: number, rating: 'up' | 'down') => Promise<void>;
  getToolStats: () => Promise<Array<{ name: string; callCount: number; successCount: number; errorCount: number; successRate: number }>>;
  forkFromSeq: (fromSeq: number) => Promise<string | null>;
}

function parseArgs(argsStr: string): Record<string, unknown> {
  try {
    return JSON.parse(argsStr || '{}');
  } catch {
    return {};
  }
}

function blocksToText(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

// R140: Three-letter to one-letter amino acid code mapping.
// Used for screenshot labels so the VLM can quickly verify residues.
const THREE_TO_ONE: Record<string, string> = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C',
  GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I',
  LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P',
  SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V',
  // Non-standard / common ligands
  HOH: 'W', MSE: 'M', SEC: 'U', PYL: 'O',
};

/** Convert a 3-letter residue name to 1-letter code. Falls back to the first letter. */
function toOneLetter(resname: string | undefined): string {
  if (!resname) return '?';
  const upper = resname.toUpperCase();
  return THREE_TO_ONE[upper] ?? resname[0]!.toUpperCase();
}

/**
 * R140: Extract interface residue labels from analysis data.
 *
 * Returns an array of { chain, resno, text } where text is "X123" format
 * (one-letter amino acid code + residue number), e.g. "R31" for ARG31.
 *
 * This handles multiple recipe data formats:
 *   - all_interactions: { interactions: [{ chain1, resno1, resname1, chain2, resno2, resname2 }] }
 *   - hbonds: { hbonds: [{ donor_chain, donor_resno, donor_resname, acceptor_chain, ... }] }
 *   - salt_bridges: { salt_bridges: [{ pos_chain, pos_resno, pos_resname, neg_chain, ... }] }
 *   - interface_residues: { chain1_interface_residues: [{ resno, name, contacts: [...] }], ... }
 *
 * Deduplicates by (chain, resno) and limits to 20 labels to avoid clutter.
 */
function extractResidueLabels(
  recipe: string,
  analysisData: Record<string, unknown>
): Array<{ chain: string; resno: number; text: string }> {
  const labels: Array<{ chain: string; resno: number; text: string }> = [];
  const seen = new Set<string>();

  // Helper to add a label (with dedup)
  const add = (chain: string | undefined, resno: number | undefined, resname: string | undefined) => {
    if (!chain || resno === undefined || resno === null) return;
    const key = `${chain}:${resno}`;
    if (seen.has(key)) return;
    seen.add(key);
    labels.push({
      chain,
      resno,
      text: `${toOneLetter(resname)}${resno}`,
    });
  };

  // The actual data may be nested under .data (from runRecipe)
  const data = (analysisData.data as Record<string, unknown> | undefined) ?? analysisData;

  // all_interactions format
  // R163: NO label-count cap (user request) — labels are now small, have no
  // background box, and use anti-overlap spiral placement (see commands.ts
  // R163), so showing every interface residue is no longer occluding.
  const interactions = data.interactions as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(interactions)) {
    for (const c of interactions) {
      add(c.chain1 as string, c.resno1 as number, c.resname1 as string);
      add(c.chain2 as string, c.resno2 as number, c.resname2 as string);
    }
  }

  // hbonds format
  const hbonds = data.hbonds as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(hbonds)) {
    for (const h of hbonds) {
      add(h.donor_chain as string, h.donor_resno as number, h.donor_resname as string);
      add(h.acceptor_chain as string, h.acceptor_resno as number, h.acceptor_resname as string);
    }
  }

  // salt_bridges format
  const saltBridges = data.salt_bridges as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(saltBridges)) {
    for (const s of saltBridges) {
      add(s.pos_chain as string, s.pos_resno as number, s.pos_resname as string);
      add(s.neg_chain as string, s.neg_resno as number, s.neg_resname as string);
    }
  }

  // hydrophobic_contacts format
  const hydrophobic = data.hydrophobic_contacts as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(hydrophobic)) {
    for (const h of hydrophobic) {
      add(h.chain1 as string, h.resno1 as number, h.resname1 as string);
      add(h.chain2 as string, h.resno2 as number, h.resname2 as string);
    }
  }

  // interface_residues format (chain1_interface_residues / chain2_interface_residues)
  const chain1 = data.chain1 as string | undefined;
  const chain2 = data.chain2 as string | undefined;
  const c1Res = data.chain1_interface_residues as Array<Record<string, unknown>> | undefined;
  const c2Res = data.chain2_interface_residues as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(c1Res)) {
    for (const r of c1Res) {
      add(chain1, r.resno as number, r.name as string);
    }
  }
  if (Array.isArray(c2Res)) {
    for (const r of c2Res) {
      add(chain2, r.resno as number, r.name as string);
    }
  }

  // binding_pocket / druggability format
  const pocketResidues = data.residues as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(pocketResidues)) {
    for (const r of pocketResidues) {
      add(r.chain as string, r.resno as number, r.resname as string);
    }
  }

  // R163: no slice cap — every labeled residue is placed on its own
  // anti-overlap spiral slot (commands.ts R163), so more labels no longer
  // means "labels covering the structure".
  const result = labels;
  if (result.length > 0) {
    console.log(`[R140] Extracted ${result.length} residue labels for ${recipe}: ${result.map(l => l.text).join(', ')}`);
  }
  return result;
}

/** Project the session event log into UI conversation nodes. */
function projectNodes(events: SessionEvent[], executions: Map<string, ToolExecution>): ConversationNode[] {
  const nodes: ConversationNode[] = [];
  for (const ev of events) {
    switch (ev.type) {
      case 'user/message': {
        const data = ev.data as { content: ContentBlock[] };
        nodes.push({ kind: 'user-message', seq: ev.seq, text: blocksToText(data.content) });
        break;
      }
      case 'assistant/chunk': {
        const data = ev.data as { turn: number; step: number; chunk: StreamChunk };
        // UI-015: find-or-create the streaming node by (turn, step), then
        // REPLACE it with a new object instead of mutating it in place — the
        // projection stays immutable even if node objects are ever cached
        // across walks.
        let idx = nodes.findIndex(
          (n) => n.kind === 'streaming-assistant' && n.turn === data.turn && n.step === data.step,
        );
        if (idx < 0) {
          nodes.push({ kind: 'streaming-assistant', seq: ev.seq, text: '', done: false, turn: data.turn, step: data.step });
          idx = nodes.length - 1;
        }
        const current = nodes[idx]!;
        if (current.kind !== 'streaming-assistant') break;
        let { text, done } = current;
        // Accumulate text-delta chunks.
        const chunk = data.chunk;
        if (chunk.type === 'text-delta') {
          text += chunk.text;
        } else if (chunk.type === 'block-end' && chunk.block.type === 'text') {
          // block-end carries the authoritative text — but we already
          // accumulated deltas, so only set if empty (block-end is final).
          if (text === '') text = chunk.block.text;
        } else if (chunk.type === 'finish') {
          done = true;
        }
        nodes[idx] = { ...current, text, done };
        break;
      }
      case 'assistant/message': {
        const data = ev.data as { message: { content: ContentBlock[] } };
        // Replace the streaming node with the final message (same turn/step).
        const turn = (ev.data as { turn: number }).turn;
        const step = (ev.data as { step: number }).step;
        const idx = nodes.findIndex(
          (n) => n.kind === 'streaming-assistant' && n.turn === turn && n.step === step,
        );
        const reasoning = data.message.content
          .filter((b): b is Extract<ContentBlock, { type: 'reasoning' }> => b.type === 'reasoning')
          .map((b) => b.text)
          .join('');
        const text = blocksToText(data.message.content);
        const hasToolCalls = data.message.content.some((b) => b.type === 'tool-call');
        // Skip empty assistant messages — these are either:
        // (a) "I'll do X now" preambles before tool calls, or
        // (b) truly empty messages with no text and no tool calls.
        // R110: Also skip when text is empty even without tool calls (fixes 空气泡).
        if (text.trim().length === 0) {
          // Remove the streaming node if it exists — don't add an empty message.
          if (idx >= 0) nodes.splice(idx, 1);
          break;
        }
        const finalNode: ConversationNode = {
          kind: 'assistant-message',
          seq: ev.seq,
          text,
          reasoning: reasoning || undefined,
        };
        if (idx >= 0) {
          nodes[idx] = finalNode;
        } else {
          nodes.push(finalNode);
        }
        break;
      }
      case 'tool/call': {
        const data = ev.data as { callId: string; name: string; arguments: string };
        const exec = executions.get(data.callId);
        nodes.push({
          kind: 'tool-call',
          seq: ev.seq,
          callId: data.callId,
          name: data.name,
          args: parseArgs(data.arguments),
          status: exec?.status ?? 'pending',
          result: exec?.result,
          error: exec?.error,
          startedAt: ev.time,
          durationMs: exec?.durationMs, // R113.7
        });
        break;
      }
      case 'tool/result': {
        const data = ev.data as { message: { content: ContentBlock[]; source: { kind: string; callId?: string } }; error?: { message: string } };
        // Update the matching tool-call node by walking back through the
        // tool-call nodes. UI-015: build a REPLACEMENT node object instead
        // of mutating the found node in place — keeps the projection
        // immutable.
        //
        // FE-01 (R172): the old loop unconditionally `break`-ed at the FIRST
        // tool-call node from the end, whether the callId matched or not.
        // With parallel tool calls the event order is callA, callB, resultA,
        // resultB — processing resultA found callB first, the callId didn't
        // match, and resultA was silently dropped. Live runs self-healed via
        // the executionsRef re-projection, but replayed sessions (reload /
        // history switch / fork — executionsRef empty) left every card except
        // the last of a parallel batch spinning "pending" forever. Now we
        // only stop when the callId matches and keep walking otherwise.
        for (let i = nodes.length - 1; i >= 0; i--) {
          const n = nodes[i]!;
          if (n.kind !== 'tool-call') continue;
          if (data.message.source.kind === 'tool' && data.message.source.callId === n.callId) {
            let result = n.result;
            let durationMs = n.durationMs;

            // R139 / UI-003 (screenshot display): prefer the executions ref
            // result — the live in-memory copy populated by executeToolCall
            // — and fall back to parsing the tool/result event text when the
            // ref has no entry (e.g. a resumed/replayed session after reload).
            //
            // Since the R165 fix in loop.ts, screenshot tool/result events
            // are persisted UNSTRIPPED: the event text is the full JSON of
            // the result, including real data:image/... URIs, so this
            // fallback path renders screenshots correctly on resume. (The
            // LLM never sees the base64 payloads — SurfaceManager projects
            // them out when deriving model-visible history.)
            const exec = executions.get(n.callId);
            if (exec?.result != null) {
              result = exec.result;
              if (exec.durationMs != null) durationMs = exec.durationMs;
            } else {
              // Fall back to parsing the event's result text (full JSON
              // incl. data URIs since R165; non-screenshot results may
              // still be length-truncated server-side, in which case the
              // JSON.parse below degrades gracefully to raw text).
              let rawText = '';
              for (const block of data.message.content) {
                if (block.type === 'tool-result') {
                  for (const inner of block.content) {
                    if (inner.type === 'text') rawText += inner.text;
                  }
                } else if (block.type === 'text') {
                  rawText += block.text;
                }
              }
              try {
                result = JSON.parse(rawText) as unknown;
              } catch {
                result = rawText;
              }
            }
            nodes[i] = {
              ...n,
              status: data.error ? 'error' : 'ok',
              error: data.error?.message,
              result,
              durationMs,
            };
            break; // matched this call's node — stop walking
          }
          // Not this call's node — keep walking to find the right one
          // (parallel tool calls interleave call/call/result/result).
        }
        break;
      }
      case 'turn/start':
        nodes.push({ kind: 'turn-boundary', seq: ev.seq, turn: (ev.data as { turn: number }).turn, type: 'start' });
        break;
      case 'turn/end': {
        const data = ev.data as { turn: number; reason: { kind: string } };
        nodes.push({ kind: 'turn-boundary', seq: ev.seq, turn: data.turn, type: 'end', reason: data.reason.kind });
        break;
      }
      case 'step/start':
        nodes.push({ kind: 'step-boundary', seq: ev.seq, turn: (ev.data as { turn: number; step: number }).turn, step: (ev.data as { step: number }).step, type: 'start' });
        break;
      case 'step/end':
        nodes.push({ kind: 'step-boundary', seq: ev.seq, turn: (ev.data as { turn: number; step: number }).turn, step: (ev.data as { step: number }).step, type: 'end' });
        break;
    }
  }
  return nodes;
}

export function useAgentSession(options: UseAgentSessionOptions): AgentSessionState & {
  sendMessage: (content: string) => Promise<void>;
  resolveApproval: (callId: string, decision: 'allowed-once' | 'rejected' | 'cancelled') => Promise<void>;
  clearError: () => void;
} {
  const { viewer } = options;
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState('New session');
  const [connected, setConnected] = useState(false);
  // UI-010: set once the SSE stream exhausts its retry budget (or hits a
  // fatal error) — drives the "session lost" banner in ChatPanel.
  const [sseDead, setSseDead] = useState(false);
  const [driving, setDriving] = useState(false);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Map<number, 'up' | 'down'>>(new Map());
  const executionsRef = useRef<Map<string, ToolExecution>>(new Map());
  const viewerRef = useRef(viewer);
  const sessionIdRef = useRef<string | null>(null);
  const drivingRef = useRef(false);
  // R164 (VLM-002): AbortController for any in-flight VLM call. Aborted
  // when the user starts a new session, loads a different session, or
  // forks — so the server's req.signal fires and the VLM backoff loop
  // stops retrying instead of paying full token cost for an orphan
  // result nobody will ever see.
  const vlmAbortRef = useRef<AbortController | null>(null);
  // UI-002: AbortController for the in-flight drive loop. Aborted when the
  // user starts a new session / loads a different session / forks while a
  // drive is still running — without this, setSessionId(null) flips
  // sessionIdRef to null and the loop's next POST goes to
  // /api/agent/sessions/null/tool-results → 404 → an error banner stuck on
  // the brand-new empty session. Mirrors the vlmAbortRef pattern above.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    viewerRef.current = viewer;
  }, [viewer]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Create a session on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/agent/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'PDB Tracker Agent Session' }),
        });
        if (!res.ok) throw new Error(`Failed to create session: ${res.status}`);
        const data = (await res.json()) as { sessionId: string };
        if (cancelled) return;
        setSessionId(data.sessionId);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to SSE events.
  // UI-010: EventSource auto-reconnects forever on error. Cap consecutive
  // failures (MAX_SSE_RETRY_ERRORS); once the cap trips (or the browser
  // declares the stream fatally CLOSED, e.g. 404 after a server restart)
  // close it for good and set sseDead so the UI shows a "session lost —
  // refresh" banner instead of an eternally pulsing "connecting" badge.
  // UI-001: approval prompts are only raised for LIVE tool/call events —
  // replayed history can contain approval-required calls that were already
  // decided in a previous page life; re-showing them leaves a phantom prompt
  // that no drive loop will ever consume (waitForApproval only polls while a
  // drive is running).
  useEffect(() => {
    if (!sessionId) return;
    // Clean up cross-session refs when switching sessions.
    executionsRef.current = new Map();
    decisionsRef.current = new Map();
    setPendingApprovals([]);
    setSseDead(false);
    const es = new EventSource(`/api/agent/sessions/${sessionId}/events`);
    // Track seen seqs to deduplicate events on SSE reconnect (EventSource auto-reconnects).
    const seenSeqs = new Set<number>();
    // Flips true once the initial historical replay finished — only then do
    // tool/call events count as "live" for approval prompts (UI-001).
    let replayDone = false;
    let consecutiveErrors = 0;
    let declaredDead = false;
    const declareDead = () => {
      if (declaredDead) return;
      declaredDead = true;
      es.close();
      setSseDead(true);
    };
    es.addEventListener('event', (e) => {
      try {
        const ev = JSON.parse((e as MessageEvent).data) as SessionEvent;
        // Skip duplicates from SSE replay on reconnect.
        if (seenSeqs.has(ev.seq)) return;
        seenSeqs.add(ev.seq);
        setEvents((prev) => [...prev, ev]);
        // Detect approval/asked (live events only — see UI-001 above).
        if (ev.type === 'tool/call' && replayDone) {
          const data = ev.data as { callId: string; name: string; arguments: string };
          if (requiresApproval(data.name)) {
            setPendingApprovals((prev) => [
              ...prev,
              {
                callId: data.callId,
                toolName: data.name,
                summary: data.name,
                args: parseArgs(data.arguments),
              },
            ]);
          }
        }
        // Handle session/title updates (auto-generated titles).
        if (ev.type === 'session/title') {
          const data = ev.data as { title: string };
          setSessionTitle(data.title);
        }
        // Handle feedback events (thumbs up/down on assistant messages).
        if (ev.type === 'feedback/record') {
          const data = ev.data as { messageSeq: number; rating: 'up' | 'down' };
          setFeedback((prev) => {
            const next = new Map(prev);
            next.set(data.messageSeq, data.rating);
            return next;
          });
        }
      } catch {
        /* ignore parse errors */
      }
    });
    es.addEventListener('replay-done', () => {
      replayDone = true;
      consecutiveErrors = 0;
      setConnected(true);
    });
    es.addEventListener('open', () => {
      // A successful (re)connect resets the failure streak (UI-010).
      consecutiveErrors = 0;
      setConnected(true);
    });
    es.addEventListener('error', () => {
      consecutiveErrors += 1;
      setConnected(false);
      // readyState CLOSED = the browser gave up (fatal, e.g. HTTP 404) — no
      // reconnect will ever come; declare dead immediately.
      if (es.readyState === EventSource.CLOSED) {
        declareDead();
        return;
      }
      if (consecutiveErrors >= MAX_SSE_RETRY_ERRORS) declareDead();
    });
    return () => es.close();
  }, [sessionId]);

  // UI-007: progress ticks used to clone the events array on EVERY tick
  // (`setEvents((prev) => [...prev])`), re-walking all events inside
  // projectNodes and re-rendering every conversation node — O(n²) per
  // pdb_analyze over a long session. Throttled here to at most one render
  // per PROGRESS_REFRESH_MS with a trailing-edge timer so the last dropped
  // tick still lands. Terminal writes (autoCapture/autoCaptureError/vlm*)
  // keep calling setEvents directly — completion states render immediately.
  const lastProgressRefreshRef = useRef(0);
  const progressRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestProgressRefresh = useCallback(() => {
    const now = Date.now();
    const since = now - lastProgressRefreshRef.current;
    if (since >= PROGRESS_REFRESH_MS) {
      lastProgressRefreshRef.current = now;
      if (progressRefreshTimerRef.current !== null) {
        clearTimeout(progressRefreshTimerRef.current);
        progressRefreshTimerRef.current = null;
      }
      setEvents((prev) => [...prev]);
      return;
    }
    if (progressRefreshTimerRef.current === null) {
      progressRefreshTimerRef.current = setTimeout(() => {
        progressRefreshTimerRef.current = null;
        lastProgressRefreshRef.current = Date.now();
        setEvents((prev) => [...prev]);
      }, PROGRESS_REFRESH_MS - since);
    }
  }, []);
  // Cancel a pending trailing refresh on unmount.
  useEffect(
    () => () => {
      if (progressRefreshTimerRef.current !== null) clearTimeout(progressRefreshTimerRef.current);
    },
    [],
  );

  // R113.6: Listen for retry events from ToolCallCard
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail as { callId: string; name: string; args: Record<string, unknown> };
      if (!detail || !viewerRef.current) return;
      // Re-execute the failed tool call
      try {
        const { toolToCommand } = await import('@/lib/agent/pdb-tools');
        const cmd = toolToCommand(detail.name, detail.args);
        if (!cmd) return;
        const result = await executeCommand(viewerRef.current, cmd as never);
        // Update the execution status
        executionsRef.current.set(detail.callId, {
          callId: detail.callId,
          name: detail.name,
          status: result.ok ? 'ok' : 'error',
          args: detail.args,
          result: result.ok ? result : undefined,
          error: result.ok ? undefined : result.detail,
          durationMs: 0,
        });
        // Trigger re-render by updating events
        setEvents((prev) => [...prev]);
      } catch (err) {
        console.error('[agent] Retry failed:', err);
      }
    };
    window.addEventListener('agent-retry-tool', handler);
    return () => window.removeEventListener('agent-retry-tool', handler);
  }, []);

  const nodes = useMemo(
    () => projectNodes(events, executionsRef.current),
    [events],
  );

  // Compute token usage from ALL events (works for both live + replayed/resumed
  // sessions — no double-counting because it's derived, not accumulated).
  const tokenUsage = useMemo<TokenUsageSummary>(() => {
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let requestCount = 0;
    for (const ev of events) {
      if (ev.type === 'assistant/message') {
        const data = ev.data as { usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } };
        if (data.usage) {
          promptTokens += data.usage.promptTokens ?? 0;
          completionTokens += data.usage.completionTokens ?? 0;
          totalTokens += data.usage.totalTokens ?? 0;
          requestCount += 1;
        }
      }
    }
    return { promptTokens, completionTokens, totalTokens, requestCount };
  }, [events]);

  /** Execute a client-side tool call against Molstar. */
  const executeToolCall = useCallback(
    async (call: PendingToolCall): Promise<{ ok: boolean; result?: unknown; error?: string }> => {
      const args = parseArgs(call.arguments);
      // AGENT-011 (client half): server-side tools must never execute — or,
      // worse, have their results fabricated — on the client.
      // manager.driveWithServerTools guarantees that returned tool-calls
      // never contain server-side tools; if one reaches here anyway
      // (replayed old session, protocol drift) we REFUSE instead of feeding
      // the LLM fake data. driveLoop additionally skips submitting any
      // result for such calls (see the SERVER_SIDE_TOOLS check there).
      if (SERVER_SIDE_TOOLS.has(call.name)) {
        console.warn(
          `[agent] unexpected server-side tool call reached client (protocol drift): ${call.name} (${call.callId}) — refusing to execute/fabricate`,
        );
        return { ok: false, error: `Server-side tool ${call.name} unexpectedly reached the client` };
      }
      const cmd = toolToCommand(call.name, args);
      if (!cmd) {
        return { ok: false, error: `No Molstar command mapping for tool: ${call.name}` };
      }
      const v = viewerRef.current;
      if (!v) {
        return { ok: false, error: 'Molstar viewer not ready' };
      }
      executionsRef.current.set(call.callId, {
        callId: call.callId,
        name: call.name,
        status: 'running',
        args,
      });
      const startTime = Date.now(); // R113.7: Track execution time
      try {
        const result = await executeCommand(v, cmd as never);
        // For structure loading commands, wait for the viewer to render fully.
        // 2.5s gives Molstar enough time to download + parse + render the structure.
        if (call.name === 'pdb_load' || call.name === 'load_alphafold' || call.name === 'load_emdb' || call.name === 'load_structure_url') {
          // R111: Only update store + wait if the load actually succeeded
          if (result.ok) {
            // R113.5: Verify the structure actually exists in Molstar hierarchy
            // before adding to the store. This prevents ghost entries when
            // load_pdb reports success but the structure didn't actually load.
            try {
              const plugin = v.plugin;
              const structCount = plugin?.managers?.structure?.hierarchy?.current?.structures?.length ?? 0;
              if (structCount === 0) {
                // No structure in hierarchy — load didn't actually work
                console.warn('[agent] load_pdb reported ok but no structure in Molstar hierarchy');
                executionsRef.current.set(call.callId, {
                  callId: call.callId,
                  name: call.name,
                  status: 'error',
                  args,
                  error: 'Structure not found in viewer after load',
                  durationMs: Date.now() - startTime,
                });
                return { ok: false, error: 'Structure not found in viewer after load' };
              }
            } catch (verifyErr) {
              console.warn('[agent] Structure verification failed:', verifyErr);
            }

            // Update the Zustand store so the structure list + UI stays in sync.
            try {
              const { useAppStore } = await import('@/lib/molcraft/store');
              const addStructure = useAppStore.getState().addStructure;
              const pdbId = call.name === 'pdb_load' ? String(args.id || '').toUpperCase()
                : call.name === 'load_alphafold' ? String(args.uniprotId || '')
                : call.name === 'load_emdb' ? String(args.emdbId || '')
                : String(args.url || '');
              if (pdbId) {
                const source = call.name === 'pdb_load' ? 'pdb'
                  : call.name === 'load_alphafold' ? 'alphafold'
                  : call.name === 'load_emdb' ? 'emdb' : 'url';

                // R118: Fetch PDB text + populate metadata (sequences, chains, etc.)
                // This is needed because the agent path bypasses the UI's
                // structure loading logic which normally fetches PDB text from
                // RCSB and parses it for sequence/metadata display.
                let pdbText: string | undefined;
                let metadata: Record<string, unknown> | undefined;
                if (call.name === 'pdb_load') {
                  try {
                    const pdbRes = await fetch(`https://files.rcsb.org/download/${pdbId}.pdb`);
                    if (pdbRes.ok) {
                      pdbText = await pdbRes.text();
                      // Parse PDB for metadata
                      try {
                        const { parsePdb } = await import('@/lib/molcraft/structure-utils');
                        const parsed = parsePdb(pdbText);
                        metadata = {
                          chains: parsed.chains,
                          numAtoms: parsed.numAtoms,
                          numResidues: parsed.numResidues,
                          title: parsed.title || undefined,
                        };
                      } catch {}
                      // Cache PDB text for sequence viewer + interaction analysis
                      try {
                        const { setStructureFileCache } = await import('@/lib/molcraft/store');
                        setStructureFileCache(pdbId, pdbText, 'pdb');
                      } catch {}
                    }
                  } catch { /* RCSB fetch is best-effort */ }
                }

                addStructure({
                  id: pdbId,
                  label: pdbId,
                  source: source as never,
                  loadedAt: Date.now(),
                  pdbText: pdbText || undefined,
                  metadata: metadata as never,
                } as never);
              }
            } catch { /* store update is best-effort */ }
            await new Promise((r) => setTimeout(r, 2500));
          } else {
            // Load failed — don't add to store, return error
            executionsRef.current.set(call.callId, {
              callId: call.callId,
              name: call.name,
              status: 'error',
              args,
              error: result.detail || 'Load failed',
            });
            return { ok: false, error: result.detail || 'Load failed' };
          }
        }
        // For set_color_theme after a load, add extra delay to ensure components exist
        if (call.name === 'set_color_theme' || call.name === 'set_representation') {
          await new Promise((r) => setTimeout(r, 500));
        }
        const durationMs = Date.now() - startTime; // R113.7
        executionsRef.current.set(call.callId, {
          callId: call.callId,
          name: call.name,
          status: 'ok',
          args,
          result,
          durationMs, // R113.7: Store timing for UI display
        });

        // R160: For explicit capture_multi_angle calls, DON'T run VLM separately.
        // The auto-capture path after pdb_analyze already runs the VLM loop.
        // Running VLM again for explicit calls creates duplicate screenshots
        // and confusing UI. Skip VLM entirely for explicit capture_multi_angle
        // when it has vizParams (meaning it was auto-triggered by pdb_analyze).
        // Only run VLM for truly standalone captures (no vizParams at all).
        if (call.name === 'capture_multi_angle' && result.ok) {
          const hasVizParams = args.vizParams && Object.keys(args.vizParams as object).length > 0;
          if (!hasVizParams) {
            const recipeName = String(args.recipe || 'unknown');
            // UI-012: typed read instead of `(result as any).data?.screenshots`.
            const screenshots = (result as AnnotatedCaptureResult).data?.screenshots;
            if (screenshots && Array.isArray(screenshots) && screenshots.length > 0) {
              void (async () => {
                const vlmStartTime = Date.now();
                try {
                  const { selectBestWithRetry } = await import('@/lib/molcraft/vlm-client');
                  const analysisSummary = JSON.stringify(args.vizParams || {}).slice(0, 2000);
                  console.log(`[agent] Starting VLM for explicit capture_multi_angle (${screenshots.length} screenshots, recipe: ${recipeName})`);
                  const vlmResult = await selectBestWithRetry(screenshots, recipeName, analysisSummary);
                  const vlmDuration = Date.now() - vlmStartTime;
                  if (vlmResult) {
                    // UI-012: typed annotations (was `(result as any).x = …`).
                    const annotated = result as AnnotatedCaptureResult;
                    annotated.vlmResult = vlmResult;
                    annotated.vlmDurationMs = vlmDuration;
                    console.log(`[agent] VLM completed for explicit capture: ${vlmDuration}ms quality=${vlmResult.quality} bestIndex=${vlmResult.bestIndex}`);
                  }
                } catch (vlmErr) {
                  console.warn('[agent] VLM failed for explicit capture (non-blocking):', vlmErr);
                  (result as AnnotatedCaptureResult).vlmError = vlmErr instanceof Error ? vlmErr.message : String(vlmErr);
                }
                const exec = executionsRef.current.get(call.callId);
                if (exec?.result != null) {
                  const annotated = exec.result as AnnotatedCaptureResult;
                  const src = result as AnnotatedCaptureResult;
                  annotated.vlmResult = src.vlmResult;
                  annotated.vlmDurationMs = src.vlmDurationMs;
                  annotated.vlmError = src.vlmError;
                  // FE-03 (R172): clear the pending flag on terminal paths —
                  // it was previously never reset, so a failed VLM call left
                  // the "VLM 分析中..." spinner spinning forever and
                  // permanently shadowed the error branch.
                  annotated.vlmPending = false;
                  setEvents((prev) => [...prev]);
                }
              })();
              (result as AnnotatedCaptureResult).vlmPending = true;
            }
          }
        }

        // R115.1: Non-blocking auto-capture + VLM — fire and forget, update later
        if (call.name === 'pdb_analyze' && result.ok) {
          const recipeName = String(args.recipe || '');
          const visualizableRecipes = new Set([
            'binding_pocket', 'druggability', 'all_interactions', 'hbonds',
            'pairwise_interactions',
            'salt_bridges', 'hydrophobic_contacts', 'ligand_interactions',
            'disulfide_bonds', 'metal_coordination', 'aromatic_stacking',
            'water_bridges', 'sasa', 'electrostatic', 'interface_residues',
            'secondary_structure_simple', 'bfactor_stats', 'rmsd',
            'detect_pockets', 'oligomer_analysis', 'surface_residues',
            'conformational_changes', 'protonation_states', 'summary',
          ]);
          if (visualizableRecipes.has(recipeName)) {
            // R115.1: Fire-and-forget — don't block the main analysis
            //
            // R166 (viz regression): unwrap to the RECIPE-OUTPUT level.
            // executeCommand's analyze_run returns
            //   analysisResult = { kind: 'recipe', recipe, data: API_BODY }
            // and the API body itself nests the recipe output one level deeper:
            //   API_BODY = { recipe, ok, pdbId, format, data: RECIPE_OUTPUT, stdout }
            // Previously we stopped at the API-body level, so recipe fields
            // (pairs, chain1/chain2, interactions, hbonds, …) were NEVER found:
            //  - the R163 per-pair capture branch silently skipped
            //    (`Array.isArray(analysisData.pairs)` was false) → generic
            //    whole-structure capture instead of focused interfaces
            //  - applyRecipeVisualization's params.pairs / chain1 / chain2 /
            //    interactions reads all no-op'd → NO camera focus, NO
            //    ball-and-stick sidechains, NO residue labels, NO H-bond lines
            //    (user report on 4HHB: screenshots showed the whole tetramer)
            // extractResidueLabels already knew about the nesting (it does its
            // own `data ?? analysisData` unwrap) — nothing else did. Canonical
            // unwrap (mirrors druggability-chart.tsx): `.data?.data ?? .data`.
            // UI-012: typed read (was `(result as any).analysisResult`).
            const _analysisResult = (result as AnnotatedCaptureResult).analysisResult;
            const analysisData: Record<string, unknown> =
              _analysisResult?.data?.data ?? _analysisResult?.data ?? {};
            void (async () => {
              const captureStartTime = Date.now(); // R116.2: Track auto-capture timing
              // R164 (VLM-002): create a fresh AbortController for this
              // capture/VLM cycle. It gets aborted when the user starts a
              // new session, loads a different session, or forks — so the
              // in-flight fetch is cancelled AND the server's req.signal
              // fires and the VLM backoff loop stops retrying.
              const localController = new AbortController();
              vlmAbortRef.current = localController;
              try {
                // R140: Extract interface residue labels from the analysis data
                const residueLabels = extractResidueLabels(recipeName, analysisData);

                // R142: Use VLM-controlled capture loop (Plan A+B+C+D)
                // Instead of a single capture → VLM → done, this runs an
                // iterative loop: capture → VLM → adjust → re-capture bad
                // angles → VLM → done (up to 2 iterations).
                const { runVlmControlledCaptureLoop } = await import('@/lib/molcraft/vlm-capture-loop');
                const analysisSummary = JSON.stringify(analysisData).slice(0, 2000);

                // ------------------------------------------------------------
                // R163: pairwise_interactions → PER-PAIR focused capture.
                // Instead of one capture of only the best chain pair, capture
                // the TOP-2 significant interfaces (each focused on its own
                // residues/interactions via vizParams._pairIndex) so the VLM
                // report covers the main interfaces. Screenshots from all
                // pairs are merged and analyzed by a single VLM call.
                // ------------------------------------------------------------
                if (recipeName === 'pairwise_interactions' && Array.isArray(analysisData.pairs)) {
                  // UI-012: typed read (was `(analysisData as any).pairs`).
                  const pairs = analysisData.pairs as Array<Record<string, unknown>>;
                  const significant = pairs
                    .filter(p => p.in_contact !== false && (Number(p.total ?? 0) || 0) >= 3)
                    .sort((a, b) => (Number(b.total ?? 0) || 0) - (Number(a.total ?? 0) || 0));
                  const topPairs = (significant.length > 0 ? significant : pairs.filter(p => p.in_contact !== false)).slice(0, 2);

                  const allScreenshots: CaptureScreenshot[] = [];
                  for (let pi = 0; pi < topPairs.length; pi++) {
                    // MOL2-05 (R172): honor the session-change abort signal
                    // BETWEEN per-pair captures — previously only the VLM call
                    // was covered, so switching sessions mid-run kept firing
                    // multi-second captures against a viewer whose structures
                    // had just been removed.
                    if (localController.signal.aborted) {
                      console.log('[agent] pairwise capture aborted (session changed) — stopping after', allScreenshots.length, 'screenshots');
                      break;
                    }
                    const pair = topPairs[pi]!;
                    const pairTag = `${pair.chain1}-${pair.chain2}`;
                    // per-pair labels: surface this pair as top-level fields so
                    // extractResidueLabels picks THIS pair's residues
                    const pairScopedData = { ...analysisData, chain1: pair.chain1, chain2: pair.chain2, interactions: pair.interactions };
                    const pairLabels = extractResidueLabels(recipeName, pairScopedData);
                    // top pair gets 3 angles; second pair gets 2 (keeps the
                    // total screenshot count bounded for the VLM call)
                    const pairAngles = pi === 0 ? ['front', 'side', 'top'] : ['front', 'side'];

                    // progress: show which interface is being captured
                    // (UI-007: throttled refresh — was a per-tick full clone)
                    const progExec = executionsRef.current.get(call.callId);
                    if (progExec?.result != null) {
                      (progExec.result as AnnotatedCaptureResult).autoCaptureProgress = {
                        iteration: pi + 1,
                        maxIterations: topPairs.length,
                        phase: 'capturing',
                        screenshotsCount: allScreenshots.length,
                      };
                      requestProgressRefresh();
                    }

                    const capResult = await executeCommand(v, {
                      type: 'capture_multi_angle',
                      recipe: recipeName,
                      angles: pairAngles as never,
                      // MOL2-07 (R172): pass the selected pair's chains
                      // explicitly so recipe-viz resolves THIS pair by chain
                      // identity instead of re-deriving the pool with a
                      // slightly different fallback rule (client fallback =
                      // in-contact-only unsorted; server fallback = ALL pairs
                      // incl. non-contact) — the two pools could disagree when
                      // no pair reached the significance threshold, focusing
                      // the capture on a different interface than the one the
                      // carousel/VLM report claimed.
                      vizParams: { ...analysisData, _pairIndex: pi, _pairChains: [pair.chain1, pair.chain2] } as never,
                      labels: pairLabels,
                      labelFontSize: 0.5,
                    } as never);
                    // UI-012: typed screenshots read (was `(capResult as any).data?.screenshots`).
                    const capShots = (capResult as AnnotatedCaptureResult).data?.screenshots;
                    if (capResult.ok && Array.isArray(capShots)) {
                      for (const s of capShots) {
                        // tag the angle with the pair so the VLM prompt and
                        // the carousel identify which interface is shown
                        allScreenshots.push({
                          ...s,
                          angle: `${pairTag} ${s.angle}`,
                          label: `界面 ${pairTag} — ${s.angle}`,
                        });
                      }
                    }
                  }

                  // single VLM pass over the merged multi-pair screenshots
                  // UI-012: typed as VlmResult | null (was `null as Awaited<...>`).
                  let vlmResult: VlmResult | null = null;
                  let vlmError: string | undefined;
                  if (allScreenshots.length === 1) {
                    // nothing to select between — mirror the explicit-capture
                    // path's synthetic single-screenshot result (commentary
                    // added so the VlmResult required field is explicit)
                    vlmResult = {
                      bestIndex: 0,
                      commentary: '单张截图自动选择，未进行VLM分析',
                      quality: 'acceptable',
                      issues: ['单张截图，自动选择'],
                      scores: [7],
                      confidence: 'low',
                      comments: ['单张截图自动选择，未进行VLM分析'],
                    };
                  } else if (allScreenshots.length > 1) {
                    const progExec = executionsRef.current.get(call.callId);
                    if (progExec?.result != null) {
                      (progExec.result as AnnotatedCaptureResult).autoCaptureProgress = {
                        iteration: 1, maxIterations: 1, phase: 'vlm-analyzing',
                        screenshotsCount: allScreenshots.length,
                      };
                      requestProgressRefresh();
                    }
                    try {
                      const { selectBestWithRetry } = await import('@/lib/molcraft/vlm-client');
                      // MOL2-05 (R172): forward the abort signal so a session
                      // switch also cancels the in-flight VLM call (previously
                      // only the 90s fetch timeout bounded it).
                      vlmResult = await selectBestWithRetry(allScreenshots, recipeName, analysisSummary, localController.signal);
                      if (!vlmResult) {
                        // R163: VLM unavailable — mark the result explicitly so
                        // the chat UI can flag "未经视觉验证"
                        vlmError = 'VLM 分析失败 — 截图未经视觉验证';
                      }
                    } catch (vlmErr) {
                      console.warn('[agent] pairwise VLM failed (non-blocking):', vlmErr);
                      vlmError = 'VLM 分析失败 — 截图未经视觉验证';
                    }
                  }

                  const captureDuration = Date.now() - captureStartTime;
                  // FE-03 (R172): clear autoCapturePending on EVERY terminal
                  // path of the pairwise branch — success, empty capture, and
                  // error — so the "正在自动截图 + VLM 分析..." spinner can
                  // never outlive the capture cycle.
                  const finishPairwise = (patch: Partial<AnnotatedCaptureResult>) => {
                    const exec = executionsRef.current.get(call.callId);
                    if (exec?.result != null) {
                      Object.assign(exec.result as AnnotatedCaptureResult, patch, { autoCapturePending: false });
                      setEvents((prev) => [...prev]);
                    }
                  };
                  if (allScreenshots.length > 0) {
                    // UI-012: typed summary (was an `as any` literal).
                    const captureResult: AutoCaptureSummary = {
                      ok: true,
                      detail: `Captured ${allScreenshots.length} screenshots covering ${topPairs.length} significant interface(s): ${topPairs.map(p => `${p.chain1}-${p.chain2} (${p.total} interactions)`).join(', ')}`,
                      data: { recipe: recipeName, label: recipeName, screenshots: allScreenshots },
                      captureDurationMs: captureDuration,
                      vlmResult: vlmResult ?? undefined,
                      vlmDurationMs: captureDuration,
                      vlmIterations: 1,
                      vlmAcceptable: vlmResult ? vlmResult.quality === 'acceptable' : undefined,
                      vlmError,
                      pairwisePairs: topPairs.map(p => ({ chain1: p.chain1, chain2: p.chain2, total: p.total })),
                    };
                    finishPairwise({ autoCapture: captureResult });
                  } else {
                    // No screenshots captured (viewer empty / captures failed /
                    // aborted early) — surface it via the error branch instead
                    // of leaving the pending spinner up forever.
                    finishPairwise({ autoCaptureError: localController.signal.aborted ? '会话已切换，截图中止' : '未捕获到截图' });
                  }
                  return; // skip the single-pair loop below
                }

                // Helper: execute capture_multi_angle and return screenshots
                const executeCapture = async (angles: string[], vizParams: Record<string, unknown>) => {
                  const capResult = await executeCommand(v, {
                    type: 'capture_multi_angle',
                    recipe: recipeName,
                    angles: angles as never,
                    vizParams: vizParams as never,
                    labels: residueLabels,
                    labelFontSize: 0.5,  // R163: molstar-native measurement-label size (labels now have no bg box + spiral placement)
                  } as never);
                  // UI-012: typed screenshots read (was `(capResult as any).data?.screenshots`).
                  const capShots = (capResult as AnnotatedCaptureResult).data?.screenshots;
                  if (capResult.ok && capShots && capShots.length > 0) {
                    return {
                      screenshots: capShots,
                      ok: true,
                    };
                  }
                  return { screenshots: [], ok: false };
                };

                const loopResult = await runVlmControlledCaptureLoop(
                  executeCapture,
                  recipeName,
                  analysisSummary,
                  analysisData,
                  {
                    maxIterations: 2,
                    angles: ['front', 'side', 'top', 'back'], // R152: added back for less occlusion
                    vlmTimeoutMs: 150000, // R163: 150s — fits the 5/15/45s 429-backoff schedule
                    // R164 (VLM-002): pass the local AbortController that
                    // gets aborted on session change so the server's
                    // req.signal fires and the VLM backoff loop stops
                    // retrying.
                    signal: localController.signal,
                    onProgress: (progress) => {
                      // R146: Update UI with progress so user sees what's happening
                      // (UI-007: throttled refresh — was a per-tick full events clone)
                      const exec = executionsRef.current.get(call.callId);
                      if (exec?.result != null) {
                        (exec.result as AnnotatedCaptureResult).autoCaptureProgress = progress;
                        requestProgressRefresh();
                      }
                    },
                  }
                );

                const captureDuration = Date.now() - captureStartTime;

                if (loopResult.screenshots.length > 0) {
                  // UI-012: typed summary (was an `as any` literal).
                  const captureResult: AutoCaptureSummary = {
                    ok: true,
                    detail: `Captured ${loopResult.screenshots.length} angles for ${recipeName} (${loopResult.iterations} iterations)`,
                    data: {
                      recipe: recipeName,
                      label: recipeName,
                      screenshots: loopResult.screenshots,
                    },
                    captureDurationMs: captureDuration,
                    vlmResult: loopResult.vlm ?? undefined,
                    vlmDurationMs: captureDuration,
                    vlmIterations: loopResult.iterations,
                    vlmAcceptable: loopResult.acceptable,
                    // R163: VLM never succeeded (timeout/error after retries) —
                    // the chat UI flags these screenshots as 未经视觉验证
                    vlmError: loopResult.vlm ? undefined : 'VLM 分析失败 — 截图未经视觉验证',
                  };

                  if (loopResult.vlm) {
                    console.log(`[agent] VLM loop completed: ${loopResult.iterations} iterations, quality=${loopResult.vlm.quality}, acceptable=${loopResult.acceptable}`);
                  }

                  // Update execution result + trigger UI re-render
                  // FE-03 (R172): clear autoCapturePending alongside the
                  // result so the spinner state can't outlive the capture.
                  const exec = executionsRef.current.get(call.callId);
                  if (exec?.result != null) {
                    (exec.result as AnnotatedCaptureResult).autoCapture = captureResult;
                    (exec.result as AnnotatedCaptureResult).autoCapturePending = false;
                    setEvents((prev) => [...prev]);
                  }
                }
              } catch (captureErr) {
                console.warn('[agent] Auto-capture failed (non-blocking):', captureErr);
                // R115.2: Show error in UI but don't block the main analysis
                const exec = executionsRef.current.get(call.callId);
                if (exec?.result != null) {
                  (exec.result as AnnotatedCaptureResult).autoCaptureError = captureErr instanceof Error ? captureErr.message : String(captureErr);
                  // FE-03 (R172): clear the pending flag on the error path
                  // too — it was dead code while the spinner condition kept
                  // matching autoCapturePending && !autoCapture.
                  (exec.result as AnnotatedCaptureResult).autoCapturePending = false;
                  setEvents((prev) => [...prev]);
                }
              }
            })();
            (result as AnnotatedCaptureResult).autoCapturePending = true;
          }
        }

        return { ok: true, result };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const durationMs = Date.now() - startTime; // R113.7
        executionsRef.current.set(call.callId, {
          callId: call.callId,
          name: call.name,
          status: 'error',
          args,
          error: msg,
          durationMs, // R113.7
        });
        return { ok: false, error: msg };
      }
    },
    [requestProgressRefresh],
  );

  /**
   * Wait for a pending approval to be resolved (polls the pending list).
   * UI-014: bounded wait — an orphaned prompt (e.g. the drive loop died, the
   * tab was backgrounded) can never be answered, so after MAX_APPROVAL_WAIT_MS
   * we treat it as rejected, record the decision, and clean the prompt off
   * the ApprovalPanel instead of letting the interval run forever.
   */
  const waitForApproval = useCallback(async (callId: string): Promise<'allowed-once' | 'rejected' | 'cancelled'> => {
    return await new Promise((resolve) => {
      const POLL_INTERVAL_MS = 300;
      const startedAt = Date.now();
      const interval = setInterval(() => {
        // The resolveApproval handler removes from pendingApprovals and posts.
        // We resolve when the approval disappears with a decision stored.
        const stillPending = pendingApprovalsRef.current.some((p) => p.callId === callId);
        if (!stillPending) {
          clearInterval(interval);
          resolve(decisionsRef.current.get(callId) ?? 'rejected');
          return;
        }
        if (Date.now() - startedAt >= MAX_APPROVAL_WAIT_MS) {
          clearInterval(interval);
          decisionsRef.current.set(callId, 'rejected');
          setPendingApprovals((prev) => prev.filter((p) => p.callId !== callId));
          console.warn(`[agent] UI-014: approval wait for ${callId} timed out after ${MAX_APPROVAL_WAIT_MS / 1000}s — treating as rejected`);
          resolve('rejected');
        }
      }, POLL_INTERVAL_MS);
    });
  }, []);

  const pendingApprovalsRef = useRef<PendingApproval[]>([]);
  const decisionsRef = useRef<Map<string, 'allowed-once' | 'rejected' | 'cancelled'>>(new Map());
  useEffect(() => {
    pendingApprovalsRef.current = pendingApprovals;
  }, [pendingApprovals]);

  /** Drive the loop: send message, execute tool calls, post results, repeat. */
  const driveLoop = useCallback(
    async (url: string, body: Record<string, unknown>) => {
      // UI-002: fresh AbortController per drive. Session switches
      // (startNewSession / loadSession / forkFromSeq) abort it, so the loop
      // can never continue POSTing against a stale/null sessionIdRef.
      const controller = new AbortController();
      abortRef.current = controller;
      drivingRef.current = true;
      setDriving(true);
      try {
        let endpoint = url;
        let payload = body;
        let guard = 0;
        // UI-013: was a silent `guard < 12` exit — long multi-step tasks just
        // stopped with no message. Cap raised to MAX_DRIVE_ITERATIONS and the
        // exhausted case surfaces a visible error (below the loop).
        while (guard < MAX_DRIVE_ITERATIONS) {
          guard += 1;
          // UI-002: a session switch may have aborted the controller while we
          // were between fetches (e.g. waiting on an approval) — exit before
          // touching the network or the viewer again.
          if (controller.signal.aborted) return;
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal, // UI-002: cancellable on session switch
          });
          if (!res.ok) {
            const errText = await res.text().catch(() => res.statusText);
            throw new Error(errText);
          }
          const data = (await res.json()) as {
            done: boolean;
            finalContent?: string;
            toolCalls?: PendingToolCall[];
            turn?: number;
            step?: number;
            assistantText?: string;
            error?: string;
          };
          if (data.error) throw new Error(data.error);
          if (data.done) {
            return;
          }
          if (!data.toolCalls || data.toolCalls.length === 0) {
            return;
          }
          // Execute each tool call client-side (skip approvals not yet decided).
          const results: Array<{ callId: string; name: string; ok: boolean; result?: unknown; error?: string }> = [];
          for (const call of data.toolCalls) {
            // UI-002: abort while a previous tool was executing (or while
            // waiting on its approval) — stop before mutating the viewer or
            // collecting results for a session the user already left.
            if (controller.signal.aborted) return;
            // AGENT-011 (client half): server-side tools are executed inline
            // by the manager and must never be handed back to the client. If
            // one slips through anyway (replayed old session, protocol
            // drift), SKIP it — never fabricate and POST a fake result.
            if (SERVER_SIDE_TOOLS.has(call.name)) {
              console.warn(
                `[agent] unexpected server-side tool call reached client (protocol drift): ${call.name} (${call.callId}) — result not submitted`,
              );
              continue;
            }
            // If approval is required, wait for the user's decision.
            if (requiresApproval(call.name)) {
              const decision = await waitForApproval(call.callId);
              if (decision !== 'allowed-once') {
                results.push({
                  callId: call.callId,
                  name: call.name,
                  ok: false,
                  error: `User ${decision} the tool call`,
                });
                continue;
              }
            }
            const result = await executeToolCall(call);
            results.push({
              callId: call.callId,
              name: call.name,
              ok: result.ok,
              result: result.result,
              error: result.error,
            });
          }
          // AGENT-011: if every call was a skipped server-side tool there is
          // nothing to submit — don't fire an empty POST (the server's
          // orphaned-call recovery handles the dangling turn on next drive).
          if (results.length === 0) {
            return;
          }
          // Post results back, then loop.
          endpoint = `/api/agent/sessions/${sessionIdRef.current}/tool-results`;
          payload = { results };
        }
        // Falling out of the while loop = iteration cap exhausted (every other
        // exit is a `return`). UI-013: never exit silently — tell the user.
        if (!controller.signal.aborted) {
          setError(`任务步骤过多已停止：连续 ${MAX_DRIVE_ITERATIONS} 轮工具调用仍未完成。请尝试拆分任务或简化请求后重试。`);
        }
      } catch (err) {
        // UI-002: an abort is user-initiated (session switch) — never surface
        // it as an error banner over the freshly loaded session.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (err instanceof Error && err.name === 'AbortError') return;
        throw err;
      } finally {
        drivingRef.current = false;
        setDriving(false);
        // Only clear if a newer drive hasn't already replaced this controller.
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [executeToolCall, waitForApproval],
  );

  const sendMessage = useCallback(
    async (content: string) => {
      if (!sessionIdRef.current || !content.trim()) return;
      if (drivingRef.current) return;
      setError(null);
      try {
        await driveLoop(`/api/agent/sessions/${sessionIdRef.current}/messages`, { content });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [driveLoop],
  );

  /** Regenerate the last assistant response (re-drive from last user message). */
  const regenerate = useCallback(async () => {
    if (!sessionIdRef.current || drivingRef.current) return;
    setError(null);
    try {
      await driveLoop(`/api/agent/sessions/${sessionIdRef.current}/regenerate`, {});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [driveLoop]);

  const resolveApproval = useCallback(
    async (callId: string, decision: 'allowed-once' | 'rejected' | 'cancelled') => {
      decisionsRef.current.set(callId, decision);
      setPendingApprovals((prev) => prev.filter((p) => p.callId !== callId));
      try {
        await fetch(`/api/agent/sessions/${sessionIdRef.current}/approval`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callId, decision }),
        });
      } catch {
        /* the polling loop already resolved locally */
      }
    },
    [],
  );

  const clearError = useCallback(() => setError(null), []);

  /** Record user feedback (thumbs up/down) on an assistant message. */
  const recordFeedback = useCallback(async (messageSeq: number, rating: 'up' | 'down') => {
    // Optimistic local update.
    setFeedback((prev) => {
      const next = new Map(prev);
      // Toggle off if clicking the same rating.
      if (next.get(messageSeq) === rating) {
        next.delete(messageSeq);
      } else {
        next.set(messageSeq, rating);
      }
      return next;
    });
    try {
      await fetch(`/api/agent/sessions/${sessionIdRef.current}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageSeq, rating }),
      });
    } catch {
      /* best-effort */
    }
  }, []);

  /**
   * R163: Reset the 3D viewport — remove every structure/trajectory from the
   * Molstar state tree plus measurements/selection visuals.
   *
   * User-reported bug: "新建session时没有清除之前已显示的结构" — startNewSession
   * only cleared the chat state, so the previous session's structure stayed
   * on the canvas. Uses hierarchy.remove(trajectories) (which deletes the
   * whole model/structure/representation subtree) rather than plugin.clear()
   * to keep global plugin state (camera helpers, canvas props) intact.
   */
  const clearViewerStructures = useCallback(async () => {
    const v = viewerRef.current;
    const plugin = v?.plugin as any;
    if (!plugin) return;
    try {
      // R164 (MOL-003 / UI-004): drain the capture mutex + reset camera
      // state BEFORE removing the structure, so:
      //  (a) any capture_multi_angle queued behind `enqueueCapture`
      //      against the OLD (now removed) structure doesn't continue
      //      running and throwing errors against undefined refs.
      //  (b) the next session's first capture_multi_angle doesn't call
      //      restoreUserCameraState() onto a stale snapshot taken
      //      against the OLD structure's coordinate frame (which would
      //      leave the camera at a degenerate angle pointing at empty
      //      space).
      try { __drainCaptureQueue(); } catch { /* non-blocking */ }
      const hier = plugin.managers?.structure?.hierarchy;
      if (hier) {
        const trajectories = hier.current?.trajectories ?? [];
        if (Array.isArray(trajectories) && trajectories.length > 0) {
          await hier.remove(trajectories);
          console.log(`[agent] Cleared ${trajectories.length} previous structure(s) from the viewport`);
        }
      }
      // measurements (distance lines / labels) + selection visuals
      // R170: bundle-safe clear (measurement.clear() is not in the bundle).
      try { await clearAllMeasurements(plugin); } catch { /* ignore */ }
      try {
        plugin.managers.interactivity?.lociSelects?.deselectAll?.();
      } catch { /* ignore */ }
      try { plugin.canvas3d?.requestDraw?.(); } catch { /* ignore */ }
    } catch (err) {
      console.warn('[agent] clearViewerStructures failed (non-blocking):', err);
    }
  }, []);

  /** Start a fresh session (clears the current one). */
  const startNewSession = useCallback(async () => {
    // UI-002: cancel any in-flight drive loop POST first — otherwise the
    // loop keeps running against the old session and its next POST lands
    // on /api/agent/sessions/null/tool-results (404 banner over the new
    // empty session).
    if (drivingRef.current && abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    // R164 (VLM-002): abort any in-flight VLM call so the server's
    // req.signal fires and the backoff loop stops retrying.
    if (vlmAbortRef.current) {
      vlmAbortRef.current.abort();
      vlmAbortRef.current = null;
    }
    setEvents([]);
    setPendingApprovals([]);
    setError(null);
    setSessionId(null);
    setSessionTitle('New session');
    setFeedback(new Map());
    // R163: also clear the 3D viewport so the new session starts empty
    // (previously the previous session's structure stayed on the canvas).
    await clearViewerStructures();
    try {
      const res = await fetch('/api/agent/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New session' }),
      });
      if (!res.ok) throw new Error(`Failed to create session: ${res.status}`);
      const data = (await res.json()) as { sessionId: string };
      setSessionId(data.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  /** Resume an existing (persisted) session by id. */
  const loadSession = useCallback(async (id: string) => {
    // UI-002: cancel any in-flight drive loop POST for the previous session
    // before switching — same rationale as startNewSession.
    if (drivingRef.current && abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    // R164 (VLM-002): abort any in-flight VLM call from the previous session.
    if (vlmAbortRef.current) {
      vlmAbortRef.current.abort();
      vlmAbortRef.current = null;
    }
    setEvents([]);
    setPendingApprovals([]);
    setError(null);
    setSessionId(null);
    setSessionTitle('Loading…');
    setFeedback(new Map());
    try {
      const res = await fetch(`/api/agent/sessions/${id}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(`Failed to resume session: ${res.status}`);
      const data = (await res.json()) as { title?: string };
      setSessionTitle(data.title ?? 'Resumed session');
      setSessionId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  /** List all persisted sessions (for the history sidebar). */
  const listSessions = useCallback(async (): Promise<SessionListItem[]> => {
    try {
      const res = await fetch('/api/agent/sessions');
      if (!res.ok) return [];
      const data = (await res.json()) as { sessions: SessionListItem[] };
      return data.sessions ?? [];
    } catch {
      return [];
    }
  }, []);

  /** Fetch per-tool execution statistics for the current session. */
  const getToolStats = useCallback(async (): Promise<Array<{
    name: string;
    callCount: number;
    successCount: number;
    errorCount: number;
    successRate: number;
  }>> => {
    if (!sessionIdRef.current) return [];
    try {
      const res = await fetch(`/api/agent/sessions/${sessionIdRef.current}/tool-stats`);
      if (!res.ok) return [];
      const data = (await res.json()) as { stats: Array<{ name: string; callCount: number; successCount: number; errorCount: number; successRate: number }> };
      return data.stats ?? [];
    } catch {
      return [];
    }
  }, []);

  /** Fork the session from a specific event seq (creates a new session). */
  const forkFromSeq = useCallback(async (fromSeq: number): Promise<string | null> => {
    if (!sessionIdRef.current) return null;
    // UI-002: cancel any in-flight drive loop POST — forking switches the
    // active session (via loadSession below), so the old loop must not
    // keep POSTing tool-results against the pre-fork session.
    if (drivingRef.current && abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    try {
      const res = await fetch(`/api/agent/sessions/${sessionIdRef.current}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromSeq }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { sessionId: string };
      // Load the forked session.
      await loadSession(data.sessionId);
      return data.sessionId;
    } catch {
      return null;
    }
  }, [loadSession]);

  return {
    sessionId,
    sessionTitle,
    connected,
    sseDead,
    driving,
    nodes,
    pendingApprovals,
    toolExecutions: executionsRef.current,
    tokenUsage,
    feedback,
    error,
    sendMessage,
    resolveApproval,
    clearError,
    startNewSession,
    loadSession,
    listSessions,
    regenerate,
    recordFeedback,
    getToolStats,
    forkFromSeq,
  };
}
