/**
 * POST /api/agent/sessions/[sessionId]/tool-results
 *
 * Submit client-side (Molstar) tool execution results, then drive the next
 * step. The body is a list of { callId, name, ok, result?, error? }. The
 * manager appends tool/result events to the session log and continues the
 * loop.
 *
 * Gates (in order):
 *   - AG2-10: ≤32 results per request; each result ≤4MB serialized.
 *   - R168 (AGENT-M5) + AG2-04: every callId must match an UNRESOLVED
 *     tool/call; a callId may appear at most once per request body.
 *   - AG2-03: the submitted name must match the RECORDED tool/call name;
 *     approval + screenshot gating key off the recorded name.
 *   - R164 (AGENT-001): approval-required tools need an approval/decided
 *     event before their results are accepted.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentManager } from '@/lib/agent/manager';
import type { CallId } from '@/lib/agent/types';

export const runtime = 'nodejs';
// R164 (AGENT-005): raised from 60 to match the messages route —
// submitResults calls loop.drive() which now retries on 429 with
// 5s / 15s / 45s backoff, so a single submit can take up to 65s of
// backoff + 60s+ of streaming per attempt.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

interface ToolResultInput {
  callId: string;
  name: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const manager = getAgentManager();
  // If the session isn't in memory, try to resume it from the DB.
  let loop = manager.getLoop(sessionId);
  if (!loop) {
    const resumed = await manager.resumeSession(sessionId);
    if (!resumed) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    loop = manager.getLoop(sessionId);
    if (!loop) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
  }

  let body: { results?: ToolResultInput[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.results || !Array.isArray(body.results)) {
    return NextResponse.json({ error: 'results array is required' }, { status: 400 });
  }

  // AG2-10: server-side payload caps. A single request previously had NO
  // bound on the number of results or the size of each result payload
  // (screenshot results bypass truncation entirely by design), so one POST
  // could balloon the SQLite rows, the in-memory event log, and the LLM
  // context.
  const MAX_RESULTS_PER_REQUEST = 32;
  const MAX_RESULT_JSON_CHARS = 4 * 1024 * 1024; // 4MB serialized
  if (body.results.length > MAX_RESULTS_PER_REQUEST) {
    return NextResponse.json(
      {
        error: `results: too many items (${body.results.length}); the maximum is ${MAX_RESULTS_PER_REQUEST} per request`,
      },
      { status: 400 },
    );
  }
  for (const r of body.results) {
    let serialized: string;
    try {
      serialized = JSON.stringify(r.result ?? null);
    } catch {
      serialized = String(r.result);
    }
    if (serialized.length > MAX_RESULT_JSON_CHARS) {
      return NextResponse.json(
        {
          error: `result for callId "${r.callId}" is too large (${serialized.length} chars serialized; the maximum is ${MAX_RESULT_JSON_CHARS} chars)`,
        },
        { status: 400 },
      );
    }
  }

  // R168 (AGENT-M5): every submitted callId must match an UNRESOLVED
  // tool/call of this session. Previously any callId was accepted — a
  // fabricated or double-submitted result produced tool messages without
  // (or doubled against) their assistant tool_calls blocks, a wire-format
  // violation that breaks the next LLM call (OpenAI/ZAI require every
  // tool_calls message to be followed by exactly one tool message per id).
  //
  // AG2-03: build a callId → RECORDED tool name map (from tool/call
  // events) instead of a bare id set. The approval gate below and the
  // loop's screenshot/pdb_analyze handling must key off the RECORDED name,
  // never the client-submitted one — a forged name ('pdb_analyze') could
  // otherwise bypass the export_snapshot/clear_chat approval gate, and a
  // forged 'capture_multi_angle' could bypass the 3000-char truncation.
  const events = manager.getEvents(sessionId);
  const pendingCalls = new Map<string, string>(); // callId → recorded tool name
  for (const ev of events) {
    if (ev.type === 'tool/call') {
      const data = ev.data as { callId?: string; name?: string };
      if (data.callId) pendingCalls.set(data.callId, data.name ?? '');
    } else if (ev.type === 'tool/result') {
      const callId = (ev.data as { message?: { source?: { callId?: string } } })?.message?.source?.callId;
      if (callId) pendingCalls.delete(callId);
    }
  }
  const recordedNames = new Map<string, string>();
  for (const r of body.results) {
    const recorded = pendingCalls.get(r.callId);
    if (recorded === undefined) {
      return NextResponse.json(
        {
          error: `callId "${r.callId}" does not match a pending tool call (unknown, already resolved, or duplicated)`,
        },
        { status: 409 },
      );
    }
    if (r.name !== recorded) {
      return NextResponse.json(
        {
          error: `submitted tool name "${String(r.name)}" does not match the recorded tool call name "${recorded}" for callId "${r.callId}"`,
        },
        { status: 409 },
      );
    }
    // AG2-04: consume the pending entry IN this loop — a duplicate callId
    // within the SAME request body fails the lookup above (the wire format
    // allows exactly one tool message per tool_call_id).
    pendingCalls.delete(r.callId);
    recordedNames.set(r.callId, recorded);
  }

  // Security gate: verify approval-required tools have a corresponding
  // approval/decided event before accepting the result. This prevents a
  // malicious client from bypassing approval by POSTing tool-results directly.
  //
  // R164 (AGENT-001): previously the gate only accepted
  // `decision: 'allowed-once'` events, which meant a REJECTED approval
  // couldn't submit a synthetic "rejected by user" tool result — the
  // gate would 403 and the LLM history would be stuck with an orphan
  // tool/call (the AGENT-004 recovery would later synthesize a generic
  // error, but losing the user's explicit rejection reason). Now the
  // gate also accepts `decision: 'rejected'` events when the submitted
  // result is an error (ok: false) — this lets the rejection flow
  // cleanly without bypassing approval for SUCCESS results.
  const { requiresApproval } = await import('@/lib/agent/pdb-tools');
  const allowedCallIds = new Set<string>();
  const rejectedCallIds = new Set<string>();
  for (const ev of events) {
    if (ev.type === 'approval/decided') {
      const data = ev.data as { callId: string; decision: string };
      if (data.decision === 'allowed-once') {
        allowedCallIds.add(data.callId);
      } else if (data.decision === 'rejected' || data.decision === 'cancelled') {
        rejectedCallIds.add(data.callId);
      }
    }
  }
  for (const r of body.results) {
    // AG2-03: gate on the RECORDED name (validated above to match the
    // submitted one) — never trust the client-submitted field.
    const recordedName = recordedNames.get(r.callId) ?? r.name;
    if (requiresApproval(recordedName)) {
      if (allowedCallIds.has(r.callId)) continue; // approved → any result OK
      if (rejectedCallIds.has(r.callId) && !r.ok) continue; // rejected → only error results OK
      return NextResponse.json(
        { error: `Tool "${recordedName}" requires approval before results can be submitted (or, for a rejected approval, submit an error result)` },
        { status: 403 },
      );
    }
  }

  try {
    const outcome = await manager.submitResults(
      sessionId,
      body.results.map((r) => ({
        callId: r.callId as CallId,
        // AG2-03: pass the RECORDED name (not the client's) so the loop's
        // SCREENSHOT_TOOLS / pdb_analyze handling can't be spoofed either.
        name: recordedNames.get(r.callId) ?? r.name,
        ok: r.ok,
        result: r.result,
        error: r.error,
      })),
    );
    if (outcome.kind === 'error') {
      return NextResponse.json({ error: outcome.error }, { status: 500 });
    }
    if (outcome.kind === 'done') {
      return NextResponse.json({
        done: true,
        finalContent: outcome.finalContent,
        turn: outcome.turn,
        steps: outcome.steps,
      });
    }
    return NextResponse.json({
      done: false,
      turn: outcome.turn,
      step: outcome.step,
      assistantText: outcome.assistantText,
      toolCalls: outcome.calls.map((c) => ({
        callId: c.callId,
        name: c.name,
        arguments: c.arguments,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
