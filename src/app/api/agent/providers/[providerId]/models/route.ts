/**
 * GET /api/agent/providers/[providerId]/models
 *
 * Fetch the list of available models from a provider's API.
 * Most providers support the OpenAI-compatible GET /v1/models endpoint.
 *
 * Query params:
 *   - apiKey: optional API key (if not provided, uses the configured key)
 *
 * Response:
 *   { models: [{ id, name?, owned_by? }] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProviderProfile, resolveApiKey, resolveBaseURL } from '@/lib/agent/providers/credentials';

export const runtime = 'nodejs';
export const maxDuration = 15;
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ providerId: string }> },
) {
  const { providerId } = await params;

  // zai uses the z-ai SDK, not a standard /models endpoint
  if (providerId === 'zai') {
    const profile = getProviderProfile('zai');
    return NextResponse.json({
      models: profile?.models.map((m) => ({ id: m.id, name: m.name })) ?? [],
    });
  }

  const profile = getProviderProfile(providerId);
  if (!profile) {
    return NextResponse.json(
      { error: `Unknown provider: ${providerId}` },
      { status: 404 },
    );
  }

  // Resolve API key: query param → configured key → env var
  const { searchParams } = new URL(request.url);
  const queryApiKey = searchParams.get('apiKey');
  const apiKey = queryApiKey || resolveApiKey(providerId);

  if (!apiKey) {
    // Return the catalog models as fallback
    return NextResponse.json({
      models: profile.models.map((m) => ({ id: m.id, name: m.name })),
      warning: 'No API key configured — showing catalog models only. Set an API key to fetch live models.',
    });
  }

  const baseURL = resolveBaseURL(providerId) ?? profile.baseURL;
  const url = `${baseURL}/models`;

  // Build auth headers
  const authHeader = profile.authHeader ?? 'Authorization';
  const authPrefix = profile.authPrefix ?? 'Bearer ';
  const headers: Record<string, string> = {
    [authHeader]: `${authPrefix}${apiKey}`,
    ...profile.extraHeaders,
  };

  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => resp.statusText);
      return NextResponse.json({
        models: profile.models.map((m) => ({ id: m.id, name: m.name })),
        error: `API returned ${resp.status}: ${errText.slice(0, 200)}`,
      });
    }

    const raw = await resp.text();

    // Check if HTML (wrong URL)
    if (raw.trimStart().startsWith('<')) {
      return NextResponse.json({
        models: profile.models.map((m) => ({ id: m.id, name: m.name })),
        error: 'API returned HTML instead of JSON — check the base URL',
      });
    }

    const data = JSON.parse(raw);

    // OpenAI-compatible format: { data: [{ id, object, owned_by, ... }] }
    const models = Array.isArray(data?.data)
      ? data.data.map((m: any) => ({
          id: m.id,
          name: m.id,
          owned_by: m.owned_by,
        }))
      : Array.isArray(data?.models)
        ? data.models.map((m: any) => ({
            id: typeof m === 'string' ? m : m.id,
            name: typeof m === 'string' ? m : (m.name ?? m.id),
          }))
        : [];

    return NextResponse.json({ models });
  } catch (err: any) {
    return NextResponse.json({
      models: profile.models.map((m) => ({ id: m.id, name: m.name })),
      error: `Failed to fetch models: ${err?.message || String(err)}`,
    });
  }
}
