/**
 * GET  /api/agent/providers — list all providers with availability status
 * POST /api/agent/providers — set/update a provider's config (API key + baseURL)
 * DELETE /api/agent/providers?providerId=xxx — delete a provider's config
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentManager } from '@/lib/agent/manager';
import { PROVIDER_CATALOG } from '@/lib/agent/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const manager = getAgentManager();
  return NextResponse.json({
    providers: manager.listProviders(),
    defaultProvider: manager.getDefaultProvider(),
  });
}

export async function POST(request: NextRequest) {
  let body: { providerId?: string; apiKey?: string; baseURL?: string; defaultModel?: string; enabled?: boolean; setDefault?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
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
