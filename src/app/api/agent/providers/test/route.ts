/**
 * POST /api/agent/providers/test
 *
 * Test that a provider's API key works by sending a minimal request.
 *
 * Body: { providerId: string }
 * Response: { ok: boolean, error?: string, models?: number }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProviderProfile, resolveApiKey, resolveBaseURL } from '@/lib/agent/providers/credentials';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let providerId: string;
  try {
    const body = await request.json();
    providerId = body?.providerId;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!providerId) {
    return NextResponse.json({ ok: false, error: 'providerId is required' }, { status: 400 });
  }

  // zai uses the z-ai SDK — always works
  if (providerId === 'zai') {
    return NextResponse.json({ ok: true, models: 0, note: 'z.ai SDK — no API key needed' });
  }

  const profile = getProviderProfile(providerId);
  if (!profile) {
    return NextResponse.json({ ok: false, error: `Unknown provider: ${providerId}` }, { status: 404 });
  }

  const apiKey = resolveApiKey(providerId);
  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      error: `No API key configured for ${profile.displayName}. Set it in the provider settings.`,
    });
  }

  const baseURL = resolveBaseURL(providerId) ?? profile.baseURL;
  const authHeader = profile.authHeader ?? 'Authorization';
  const authPrefix = profile.authPrefix ?? 'Bearer ';
  const extraHeaders = profile.extraHeaders ?? {};

  const headers: Record<string, string> = {
    [authHeader]: `${authPrefix}${apiKey}`,
    'Content-Type': 'application/json',
    ...extraHeaders,
  };

  // Use a short timeout (8s) — if the provider doesn't respond in 8s,
  // it's likely down or the URL is wrong
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    // Strategy: Try GET /models first (cheapest, most providers support it)
    const modelsUrl = `${baseURL}/models`;
    const modelsResp = await fetch(modelsUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    // Read the response body ONCE as text
    const rawText = await modelsResp.text();

    if (modelsResp.ok) {
      // Check if HTML (wrong URL)
      if (rawText.trimStart().startsWith('<')) {
        return NextResponse.json({
          ok: false,
          error: `${profile.displayName} API returned HTML. Check the base URL: ${baseURL}`,
        });
      }
      // Try to parse as JSON
      try {
        const data = JSON.parse(rawText);
        const modelCount = Array.isArray(data?.data) ? data.data.length : 0;
        return NextResponse.json({ ok: true, models: modelCount });
      } catch {
        // JSON parse failed but HTTP 200 — key likely works
        return NextResponse.json({ ok: true, models: 0, note: 'API key valid' });
      }
    }

    // /models returned non-200
    if (modelsResp.status === 401 || modelsResp.status === 403) {
      // Auth error — API key is invalid
      let errMsg = `${profile.displayName} API key is invalid (HTTP ${modelsResp.status})`;
      if (rawText && !rawText.trimStart().startsWith('<')) {
        try {
          const errJson = JSON.parse(rawText);
          errMsg = `${profile.displayName}: ${errJson?.error?.message || errJson?.error?.type || rawText.slice(0, 150)}`;
        } catch {
          errMsg = `${profile.displayName}: ${rawText.slice(0, 150)}`;
        }
      }
      return NextResponse.json({ ok: false, error: errMsg });
    }

    // /models returned 404 or other — try POST /chat/completions as fallback
    // Reset timeout for the second request
    clearTimeout(timeout);
    const controller2 = new AbortController();
    const timeout2 = setTimeout(() => controller2.abort(), 12000);

    try {
      const chatResp = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: profile.defaultModel,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 1,
          stream: false,
        }),
        signal: controller2.signal,
      });

      const chatRaw = await chatResp.text();

      if (chatResp.ok) {
        clearTimeout(timeout2);
        return NextResponse.json({ ok: true, models: 0, note: 'API key valid (chat test)' });
      }

      // Chat failed — extract error
      let errMsg: string;
      if (chatRaw.trimStart().startsWith('<')) {
        errMsg = `${profile.displayName} returned HTML (HTTP ${chatResp.status}). Base URL may be wrong: ${baseURL}`;
      } else {
        try {
          const errJson = JSON.parse(chatRaw);
          errMsg = `${profile.displayName} (${chatResp.status}): ${errJson?.error?.message || JSON.stringify(errJson?.error || errJson).slice(0, 200)}`;
        } catch {
          errMsg = `${profile.displayName} (${chatResp.status}): ${chatRaw.slice(0, 200)}`;
        }
      }
      clearTimeout(timeout2);
      return NextResponse.json({ ok: false, error: errMsg });
    } finally {
      clearTimeout(timeout2);
    }
  } catch (err: any) {
    clearTimeout(timeout);
    const msg = err?.message || String(err);
    if (msg.includes('aborted') || msg.includes('timeout') || msg.includes('Timeout')) {
      return NextResponse.json({
        ok: false,
        error: `${profile.displayName} request timed out (8s). Check if the base URL is correct: ${baseURL}`,
      });
    }
    return NextResponse.json({
      ok: false,
      error: `Connection failed: ${msg.slice(0, 200)}`,
    });
  }
}
