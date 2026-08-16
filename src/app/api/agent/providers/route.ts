/**
 * GET  /api/agent/providers — list all providers with availability status
 * POST /api/agent/providers — set/update a provider's config (API key + baseURL)
 * DELETE /api/agent/providers?providerId=xxx — delete a provider's config
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentManager } from '@/lib/agent/manager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const manager = getAgentManager();
  return NextResponse.json({ providers: manager.listProviders() });
}

export async function POST(request: NextRequest) {
  let body: { providerId?: string; apiKey?: string; baseURL?: string; defaultModel?: string; enabled?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.providerId) {
    return NextResponse.json({ error: 'providerId is required' }, { status: 400 });
  }
  const manager = getAgentManager();
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
