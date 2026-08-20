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
  | { kind: 'streaming-assistant'; seq: number; text: string; done: boolean }
  | { kind: 'tool-call'; seq: number; callId: string; name: string; args: Record<string, unknown>; status: 'pending' | 'running' | 'ok' | 'error'; result?: unknown; error?: string; startedAt?: number; durationMs?: number }
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
  const data = (analysisData as any).data ?? analysisData;

  // all_interactions format
  const interactions = data.interactions as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(interactions)) {
    for (const c of interactions.slice(0, 20)) {
      add(c.chain1 as string, c.resno1 as number, c.resname1 as string);
      add(c.chain2 as string, c.resno2 as number, c.resname2 as string);
    }
  }

  // hbonds format
  const hbonds = data.hbonds as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(hbonds)) {
    for (const h of hbonds.slice(0, 15)) {
      add(h.donor_chain as string, h.donor_resno as number, h.donor_resname as string);
      add(h.acceptor_chain as string, h.acceptor_resno as number, h.acceptor_resname as string);
    }
  }

  // salt_bridges format
  const saltBridges = data.salt_bridges as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(saltBridges)) {
    for (const s of saltBridges.slice(0, 15)) {
      add(s.pos_chain as string, s.pos_resno as number, s.pos_resname as string);
      add(s.neg_chain as string, s.neg_resno as number, s.neg_resname as string);
    }
  }

  // hydrophobic_contacts format
  const hydrophobic = data.hydrophobic_contacts as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(hydrophobic)) {
    for (const h of hydrophobic.slice(0, 15)) {
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
    for (const r of c1Res.slice(0, 10)) {
      add(chain1, r.resno as number, r.name as string);
    }
  }
  if (Array.isArray(c2Res)) {
    for (const r of c2Res.slice(0, 10)) {
      add(chain2, r.resno as number, r.name as string);
    }
  }

  // binding_pocket / druggability format
  const pocketResidues = data.residues as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(pocketResidues)) {
    for (const r of pocketResidues.slice(0, 10)) {
      add(r.chain as string, r.resno as number, r.resname as string);
    }
  }

  // Limit total labels to 20 to avoid cluttering the screenshot
  const result = labels.slice(0, 20);
  if (result.length > 0) {
    console.log(`[R140] Extracted ${result.length} residue labels for ${recipe}: ${result.map(l => l.text).join(', ')}`);
  }
  return result;
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
          durationMs: exec?.durationMs, // R113.7
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

              // R139 (screenshot display fix): Prefer the executions ref result
              // over the session event's stripped version.
              //
              // The R128 optimization in loop.ts strips screenshot data URIs
              // (replacing them with "[image data omitted — front]") before
              // storing the tool/result in the session event log, to prevent
              // 2MB base64 strings from blowing up the LLM context window.
              //
              // However, the UI reads from the session event to display
              // screenshots, so it was getting the stripped version and the
              // <img> tags couldn't load "[image data omitted]" as a src.
              //
              // The executions ref (populated client-side in executeToolCall)
              // has the FULL unstripped result with real data URIs. We prefer
              // it for display, falling back to the event's parsed text only
              // when the executions ref doesn't have data (e.g. resumed sessions).
              const exec = executions.get(n.callId);
              if (exec?.result != null) {
                n.result = exec.result;
                if (exec.durationMs != null) n.durationMs = exec.durationMs;
              } else {
                // Fall back to parsing the event's result text (stripped version)
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
                  n.result = JSON.parse(rawText);
                } catch {
                  n.result = rawText;
                }
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

        // R140: For explicit capture_multi_angle calls, also run VLM analysis
        // (non-blocking). Previously only the auto-capture path after pdb_analyze
        // ran VLM, so explicit capture_multi_angle had no commentary. Now both
        // paths get VLM analysis for consistency.
        if (call.name === 'capture_multi_angle' && result.ok) {
          const recipeName = String(args.recipe || 'unknown');
          const screenshots = (result as any).data?.screenshots;
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
                  (result as any).vlmResult = vlmResult;
                  (result as any).vlmDurationMs = vlmDuration;
                  console.log(`[agent] VLM completed for explicit capture: ${vlmDuration}ms quality=${vlmResult.quality} bestIndex=${vlmResult.bestIndex}`);
                }
              } catch (vlmErr) {
                console.warn('[agent] VLM failed for explicit capture (non-blocking):', vlmErr);
                (result as any).vlmError = vlmErr instanceof Error ? vlmErr.message : String(vlmErr);
              }
              // Update execution result + trigger UI re-render
              const exec = executionsRef.current.get(call.callId);
              if (exec) {
                (exec.result as any).vlmResult = (result as any).vlmResult;
                (exec.result as any).vlmDurationMs = (result as any).vlmDurationMs;
                (exec.result as any).vlmError = (result as any).vlmError;
                setEvents((prev) => [...prev]);
              }
            })();
            (result as any).vlmPending = true;
          }
        }

        // R115.1: Non-blocking auto-capture + VLM — fire and forget, update later
        if (call.name === 'pdb_analyze' && result.ok) {
          const recipeName = String(args.recipe || '');
          const visualizableRecipes = new Set([
            'binding_pocket', 'druggability', 'all_interactions', 'hbonds',
            'salt_bridges', 'hydrophobic_contacts', 'ligand_interactions',
            'disulfide_bonds', 'metal_coordination', 'aromatic_stacking',
            'water_bridges', 'sasa', 'electrostatic', 'interface_residues',
            'secondary_structure_simple', 'bfactor_stats', 'rmsd',
            'detect_pockets', 'oligomer_analysis', 'surface_residues',
            'conformational_changes', 'protonation_states', 'summary',
          ]);
          if (visualizableRecipes.has(recipeName)) {
            // R115.1: Fire-and-forget — don't block the main analysis
            const analysisData = (result as any).analysisResult?.data || {};
            void (async () => {
              const captureStartTime = Date.now(); // R116.2: Track auto-capture timing
              try {
                // R140: Extract interface residue labels from the analysis data
                const residueLabels = extractResidueLabels(recipeName, analysisData);

                // R142: Use VLM-controlled capture loop (Plan A+B+C+D)
                // Instead of a single capture → VLM → done, this runs an
                // iterative loop: capture → VLM → adjust → re-capture bad
                // angles → VLM → done (up to 2 iterations).
                const { runVlmControlledCaptureLoop } = await import('@/lib/molcraft/vlm-capture-loop');
                const analysisSummary = JSON.stringify(analysisData).slice(0, 2000);

                // Helper: execute capture_multi_angle and return screenshots
                const executeCapture = async (angles: string[], vizParams: Record<string, unknown>) => {
                  const capResult = await executeCommand(v, {
                    type: 'capture_multi_angle',
                    recipe: recipeName,
                    angles: angles as never,
                    vizParams: vizParams as never,
                    labels: residueLabels,
                    labelFontSize: 0.8,
                  } as never);
                  if (capResult.ok && (capResult as any).data?.screenshots) {
                    return {
                      screenshots: (capResult as any).data.screenshots,
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
                  { maxIterations: 2, angles: ['front', 'side', 'top'] }
                );

                const captureDuration = Date.now() - captureStartTime;

                if (loopResult.screenshots.length > 0) {
                  const captureResult = {
                    ok: true,
                    detail: `Captured ${loopResult.screenshots.length} angles for ${recipeName} (${loopResult.iterations} iterations)`,
                    data: {
                      recipe: recipeName,
                      label: recipeName,
                      screenshots: loopResult.screenshots,
                    },
                    captureDurationMs: captureDuration,
                    vlmResult: loopResult.vlm,
                    vlmDurationMs: captureDuration,
                    vlmIterations: loopResult.iterations,
                    vlmAcceptable: loopResult.acceptable,
                  } as any;

                  if (loopResult.vlm) {
                    console.log(`[agent] VLM loop completed: ${loopResult.iterations} iterations, quality=${loopResult.vlm.quality}, acceptable=${loopResult.acceptable}`);
                  }

                  // Update execution result + trigger UI re-render
                  const exec = executionsRef.current.get(call.callId);
                  if (exec) {
                    (exec.result as any).autoCapture = captureResult;
                    setEvents((prev) => [...prev]);
                  }
                }
              } catch (captureErr) {
                console.warn('[agent] Auto-capture failed (non-blocking):', captureErr);
                // R115.2: Show error in UI but don't block the main analysis
                const exec = executionsRef.current.get(call.callId);
                if (exec) {
                  (exec.result as any).autoCaptureError = captureErr instanceof Error ? captureErr.message : String(captureErr);
                  setEvents((prev) => [...prev]);
                }
              }
            })();
            (result as any).autoCapturePending = true;
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
