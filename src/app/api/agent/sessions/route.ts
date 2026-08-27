/**
 * POST /api/agent/sessions — create a new agent session.
 * GET  /api/agent/sessions — list sessions (merged: in-memory + persisted).
 *
 * A session is an append-only event log + an AgentLoop. Sessions are persisted
 * to a Prisma AgentSessionEvent table (best-effort) so they survive server
 * restarts; resume via POST /api/agent/sessions/[id]/resume.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentManager } from '@/lib/agent/manager';
import { validateSettingsBody } from '@/lib/agent/session/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const manager = getAgentManager();
    // AG2-06: body.agent previously passed straight through to AgentOptions
    // with ZERO validation — a garbage provider/model/temperature became the
    // session's request configuration (and its persisted request headers).
    // Validate with the shared R168-M10 validator (body.agent.provider maps
    // onto the settings validator's providerId) and whitelist ONLY the
    // validated fields; anything else in body.agent is dropped.
    let agent: {
      provider?: string;
      model?: string;
      temperature?: number;
      maxStepsPerTurn?: number;
    } | undefined;
    if (body?.agent && typeof body.agent === 'object' && !Array.isArray(body.agent)) {
      const a = body.agent as Record<string, unknown>;
      const validated = validateSettingsBody({
        providerId: a.provider as string | undefined,
        model: a.model as string | undefined,
        temperature: a.temperature as number | undefined,
        maxStepsPerTurn: a.maxStepsPerTurn as number | undefined,
      });
      if (!validated.ok) {
        return NextResponse.json({ error: `agent: ${validated.error}` }, { status: 400 });
      }
      // Map the validator's settings field names onto AgentOptions field
      // names (providerId → provider). createSession fills any missing
      // field with the manager defaults.
      agent = {
        provider: validated.value.providerId,
        model: validated.value.model,
        temperature: validated.value.temperature,
        maxStepsPerTurn: validated.value.maxStepsPerTurn,
      };
    }
    const { sessionId, session } = manager.createSession({
      title: body?.title,
      agent,
    });
    return NextResponse.json({
      sessionId,
      title: session.title,
      createdAt: session.createdAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  const manager = getAgentManager();
  // R169 (AGENT-L10): comment now matches the code — this returns ONLY the
  // persisted sessions (the old comment claimed an in-memory merge that the
  // implementation never performed).
  const persisted = await manager.listPersistedSessions();
  return NextResponse.json({
    sessions: persisted,
  });
}
