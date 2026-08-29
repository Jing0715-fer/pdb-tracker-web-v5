/**
 * GET  /api/agent/providers — list all providers with availability status,
 *      plus (R181) locally detected CLI agents (`cliAgents`) and the Run
 *      Center provider override (`runDefault`).
 * POST /api/agent/providers — set/update a provider's config (API key + baseURL)
 *      or (R181) set/clear the Run Center CLI-agent override (`setRunDefault`
 *      with a `cli:*` id / `clearRunDefault`).
 * DELETE /api/agent/providers?providerId=xxx — delete a provider's config
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentManager } from '@/lib/agent/manager';
import { PROVIDER_CATALOG } from '@/lib/agent/providers';
import { getRunProviderOverride, setRunProviderOverride, clearRunProviderOverride } from '@/lib/agent/run-provider';
import { scanCliAgents, CLI_AGENT_PROVIDER_IDS } from '@/lib/cli-agent-scan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const manager = getAgentManager();
  // R181: agent 检测 — locally installed CLI agents + the Run Center override.
  const [scan] = await Promise.all([scanCliAgents()]);
  return NextResponse.json({
    providers: manager.listProviders(),
    defaultProvider: manager.getDefaultProvider(),
    // The restored "agent detection" list (binary-presence scan, 60s cached).
    cliAgents: scan.agents,
    // Run Center CLI-agent override (null = follows the shared default).
    runDefault: getRunProviderOverride(),
  });
}

export async function POST(request: NextRequest) {
  let body: { providerId?: string; apiKey?: string; baseURL?: string; defaultModel?: string; enabled?: boolean; setDefault?: boolean; setRunDefault?: boolean; clearRunDefault?: boolean; model?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // R181: Run Center CLI-agent override actions — `cli:*` ids are validated
  // against the scanned agent list (NOT the API catalog).
  if (body.clearRunDefault) {
    clearRunProviderOverride();
    return NextResponse.json({ ok: true, runDefault: null });
  }
  if (body.setRunDefault) {
    if (!body.providerId || !CLI_AGENT_PROVIDER_IDS.has(body.providerId)) {
      return NextResponse.json(
        { error: `setRunDefault requires a CLI agent providerId (one of: ${[...CLI_AGENT_PROVIDER_IDS].join(', ')})` },
        { status: 400 },
      );
    }
    const ok = setRunProviderOverride(body.providerId, body.model);
    if (!ok) {
      return NextResponse.json({ error: 'Failed to persist run provider override' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, runDefault: getRunProviderOverride() });
  }

  const manager = getAgentManager();

  // AG2-06: validate providerId against the catalog BEFORE anything is
  // persisted. Previously {setDefault:true, providerId:'<arbitrary string>'}
  // wrote garbage into .hermes/agent-default-provider.json — every NEW
  // session then resolved a provider with no registered adapter (fatal on
  // first drive once combined with the AG2-05 path). The config branch had
  // the same hole: the credentials store is keyed by catalog ids. The UI
  // only ever sends catalog ids, so this breaks no legitimate flow.
  if (body.providerId !== undefined && !PROVIDER_CATALOG.some((p) => p.id === body.providerId)) {
    return NextResponse.json(
      { error: `providerId must be one of: ${PROVIDER_CATALOG.map((p) => p.id).join(', ')}` },
      { status: 400 },
    );
  }

  // Handle "set as default" action
  if (body.setDefault && body.providerId) {
    manager.setDefaultProvider(body.providerId);
    return NextResponse.json({ ok: true });
  }

  if (!body.providerId) {
    return NextResponse.json({ error: 'providerId is required' }, { status: 400 });
  }
  manager.setProviderConfig(body.providerId, {
    apiKey: body.apiKey,
    baseURL: body.baseURL,
    defaultModel: body.defaultModel,
    enabled: body.enabled,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const providerId = request.nextUrl.searchParams.get('providerId');
  if (!providerId) {
    return NextResponse.json({ error: 'providerId query param is required' }, { status: 400 });
  }
  const manager = getAgentManager();
  manager.deleteProviderConfig(providerId);
  return NextResponse.json({ ok: true });
}
