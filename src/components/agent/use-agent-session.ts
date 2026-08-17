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
import { executeCommand } from '@/lib/molcraft/commands';
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
  | { kind: 'streaming-assistant'; seq: number; text: string; done: boolean }
  | { kind: 'tool-call'; seq: number; callId: string; name: string; args: Record<string, unknown>; status: 'pending' | 'running' | 'ok' | 'error'; result?: unknown; error?: string; startedAt?: number }
  | { kind: 'turn-boundary'; seq: number; turn: number; type: 'start' | 'end'; reason?: string }
  | { kind: 'step-boundary'; seq: number; turn: number; step: number; type: 'start' | 'end' };

export interface UseAgentSessionOptions {
  viewer: MolstarViewer | null;
}

export interface AgentSessionState {
  sessionId: string | null;
  sessionTitle: string;
  connected: boolean;
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

/** Project the session event log into UI conversation nodes. */
function projectNodes(events: SessionEvent[], executions: Map<string, ToolExecution>): ConversationNode[] {
  const nodes: ConversationNode[] = [];
  // Track the streaming-assistant node by (turn, step) so chunks accumulate.
  let streamingKey: string | null = null;
  for (const ev of events) {
    switch (ev.type) {
      case 'user/message': {
        const data = ev.data as { content: ContentBlock[] };
        nodes.push({ kind: 'user-message', seq: ev.seq, text: blocksToText(data.content) });
        break;
      }
      case 'assistant/chunk': {
        const data = ev.data as { turn: number; step: number; chunk: StreamChunk };
        const key = `${data.turn}:${data.step}`;
        // Find or create the streaming node.
        let node = nodes.find((n) => n.kind === 'streaming-assistant' && `${(n as { turn?: number }).turn ?? ''}:${(n as { step?: number }).step ?? ''}` === key) as
          | { kind: 'streaming-assistant'; seq: number; text: string; done: boolean; turn: number; step: number }
          | undefined;
        if (!node) {
          node = { kind: 'streaming-assistant', seq: ev.seq, text: '', done: false, turn: data.turn, step: data.step } as never;
          nodes.push(node as never);
          streamingKey = key;
        }
        // Accumulate text-delta chunks.
        const chunk = data.chunk;
        if (chunk.type === 'text-delta') {
          node.text += chunk.text;
        } else if (chunk.type === 'block-end' && chunk.block.type === 'text') {
          // block-end carries the authoritative text — but we already
          // accumulated deltas, so only set if empty (block-end is final).
          if (node.text === '') node.text = chunk.block.text;
        } else if (chunk.type === 'finish') {
          node.done = true;
        }
        break;
      }
      case 'assistant/message': {
        const data = ev.data as { message: { content: ContentBlock[] } };
        // Replace the streaming node with the final message (same turn/step).
        const turn = (ev.data as { turn: number }).turn;
        const step = (ev.data as { step: number }).step;
        const key = `${turn}:${step}`;
        const idx = nodes.findIndex((n) => n.kind === 'streaming-assistant' && `${(n as { turn?: number }).turn ?? ''}:${(n as { step?: number }).step ?? ''}` === key);
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
          streamingKey = null;
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
        streamingKey = null;
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
        });
        break;
      }
      case 'tool/result': {
        const data = ev.data as { message: { content: ContentBlock[]; source: { kind: string; callId?: string } }; error?: { message: string } };
        // Update the matching tool-call node by walking back.
        for (let i = nodes.length - 1; i >= 0; i--) {
          const n = nodes[i]!;
          if (n.kind === 'tool-call') {
            if (data.message.source.kind === 'tool' && data.message.source.callId === n.callId) {
              n.status = data.error ? 'error' : 'ok';
              n.error = data.error?.message;
              // The message content is [ToolResultBlock{ type: 'tool-result', content: [TextBlock{ type: 'text', text: '...' }] }]
              // Extract the inner text from the tool-result block's content.
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
              // Parse the result JSON string back into an object.
              try {
                n.result = JSON.parse(rawText);
              } catch {
                n.result = rawText;
              }
            }
            break;
          }
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
  const [driving, setDriving] = useState(false);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Map<number, 'up' | 'down'>>(new Map());
  const executionsRef = useRef<Map<string, ToolExecution>>(new Map());
  const viewerRef = useRef(viewer);
  const sessionIdRef = useRef<string | null>(null);
  const drivingRef = useRef(false);

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
  useEffect(() => {
    if (!sessionId) return;
    // Clean up cross-session refs when switching sessions.
    executionsRef.current = new Map();
    decisionsRef.current = new Map();
    setPendingApprovals([]);
    const es = new EventSource(`/api/agent/sessions/${sessionId}/events`);
    // Track seen seqs to deduplicate events on SSE reconnect (EventSource auto-reconnects).
    const seenSeqs = new Set<number>();
    es.addEventListener('event', (e) => {
      try {
        const ev = JSON.parse((e as MessageEvent).data) as SessionEvent;
        // Skip duplicates from SSE replay on reconnect.
        if (seenSeqs.has(ev.seq)) return;
        seenSeqs.add(ev.seq);
        setEvents((prev) => [...prev, ev]);
        // Detect approval/asked.
        if (ev.type === 'tool/call') {
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
    es.addEventListener('replay-done', () => setConnected(true));
    es.addEventListener('open', () => setConnected(true));
    es.addEventListener('error', () => setConnected(false));
    return () => es.close();
  }, [sessionId]);

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
      // Server-side tools never reach here (they execute inline).
      if (SERVER_SIDE_TOOLS.has(call.name)) {
        return { ok: true, result: { note: 'executed server-side' } };
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
      try {
        const result = await executeCommand(v, cmd as never);
        // For structure loading commands, wait for the viewer to render fully.
        // 2.5s gives Molstar enough time to download + parse + render the structure.
        if (call.name === 'pdb_load' || call.name === 'load_alphafold' || call.name === 'load_emdb' || call.name === 'load_structure_url') {
          // R111: Only update store + wait if the load actually succeeded
          if (result.ok) {
            // Update the Zustand store so the structure list + UI stays in sync.
            // Without this, the structure disappears when the store re-renders
            // (the store doesn't know about the loaded structure).
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
                addStructure({ id: pdbId, label: pdbId, source: source as never, loadedAt: Date.now() });
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
        executionsRef.current.set(call.callId, {
          callId: call.callId,
          name: call.name,
          status: 'ok',
          args,
          result,
        });
        return { ok: true, result };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        executionsRef.current.set(call.callId, {
          callId: call.callId,
          name: call.name,
          status: 'error',
          args,
          error: msg,
        });
        return { ok: false, error: msg };
      }
    },
    [],
  );

  /** Wait for a pending approval to be resolved (polls the pending list). */
  const waitForApproval = useCallback(async (callId: string): Promise<'allowed-once' | 'rejected' | 'cancelled'> => {
    return await new Promise((resolve) => {
      const check = () => {
        // The resolveApproval handler removes from pendingApprovals and posts.
        // We resolve when the approval disappears with a decision stored.
        const interval = setInterval(() => {
          const stillPending = pendingApprovalsRef.current.some((p) => p.callId === callId);
          if (!stillPending) {
            clearInterval(interval);
            const decision = decisionsRef.current.get(callId) ?? 'rejected';
            resolve(decision);
          }
        }, 300);
      };
      check();
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
      drivingRef.current = true;
      setDriving(true);
      try {
        let endpoint = url;
        let payload = body;
        let guard = 0;
        while (guard < 12) {
          guard += 1;
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
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
          // Post results back, then loop.
          endpoint = `/api/agent/sessions/${sessionIdRef.current}/tool-results`;
          payload = { results };
        }
      } finally {
        drivingRef.current = false;
        setDriving(false);
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

  /** Start a fresh session (clears the current one). */
  const startNewSession = useCallback(async () => {
    setEvents([]);
    setPendingApprovals([]);
    setError(null);
    setSessionId(null);
    setSessionTitle('New session');
    setFeedback(new Map());
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
