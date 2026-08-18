/**
 * POST /api/agent/providers/test
 *
 * Test that a provider's API key works by sending a minimal request to the
 * provider's /models endpoint (or /chat/completions as fallback).
 *
 * Body: { providerId: string }
 *
 * Response: { ok: boolean, error?: string, models?: number }
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getProviderProfile,
  resolveApiKey,
  resolveBaseURL,
} from '@/lib/agent/providers/credentials';

export const runtime = 'nodejs';
export const maxDuration = 15;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { providerId } = body as { providerId?: string };

  if (!providerId) {
    return NextResponse.json({ ok: false, error: 'providerId is required' }, { status: 400 });
  }

  // zai uses the z-ai SDK — always works if the SDK is available
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

  const headers: Record<string, string> = {
    [authHeader]: `${authPrefix}${apiKey}`,
    'Content-Type': 'application/json',
    ...profile.extraHeaders,
  };

  // Strategy: Try GET /models first (cheapest, most providers support it).
  // If that fails with 404, try POST /chat/completions with a minimal request.
  try {
    // Attempt 1: GET /models
    const modelsUrl = `${baseURL}/models`;
    const modelsResp = await fetch(modelsUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10_000),
    });

    if (modelsResp.ok) {
      const raw = await modelsResp.text();
      // Check if HTML (wrong URL)
      if (raw.trimStart().startsWith('<')) {
        return NextResponse.json({
          ok: false,
          error: `${profile.displayName} API returned HTML instead of JSON. Check the base URL: ${baseURL}`,
        });
      }
      try {
        const data = JSON.parse(raw);
        const modelCount = Array.isArray(data?.data)
          ? data.data.length
          : Array.isArray(data?.models)
            ? data.models.length
            : 0;
        return NextResponse.json({ ok: true, models: modelCount });
      } catch {
        // JSON parse failed — but HTTP 200, so the key likely works
        return NextResponse.json({ ok: true, models: 0, note: 'API key valid (could not parse model list)' });
      }
    }

    // /models returned non-200 — check if it's an auth error
    if (modelsResp.status === 401 || modelsResp.status === 403) {
      const errText = await modelsResp.text().catch(() => '');
      const isHtml = errText.trimStart().startsWith('<');
      return NextResponse.json({
        ok: false,
        error: isHtml
          ? `${profile.displayName} API key is invalid (HTTP ${modelsResp.status})`
          : `${profile.displayName} API key is invalid: ${errText.slice(0, 200)}`,
      });
    }

    // /models returned 404 or other — try POST /chat/completions as fallback
    const chatUrl = `${baseURL}/chat/completions`;
    const chatResp = await fetch(chatUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: profile.defaultModel,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1,
        stream: false,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (chatResp.ok) {
      return NextResponse.json({ ok: true, models: 0, note: 'API key valid (tested via chat)' });
    }

    // Chat also failed — check error type
    const errText = await chatResp.text().catch(() => chatResp.statusText);
    const isHtml = errText.trimStart().startsWith('<');

    if (isHtml) {
      return NextResponse.json({
        ok: false,
        error: `${profile.displayName} API returned HTML (HTTP ${chatResp.status}). Base URL may be wrong: ${baseURL}`,
      });
    }

    // Try to parse as JSON error
    try {
      const errJson = JSON.parse(errText);
      const errMsg = errJson?.error?.message || errJson?.error || errJson?.message || errText.slice(0, 300);
      return NextResponse.json({
        ok: false,
        error: `${profile.displayName} API error (${chatResp.status}): ${typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg)}`.slice(0, 500),
      });
    } catch {
      // Plain text error
      return NextResponse.json({
        ok: false,
        error: `${profile.displayName} API error (${chatResp.status}): ${errText.slice(0, 200)}`,
      });
    }
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (msg.includes('timeout') || msg.includes('Timeout')) {
      return NextResponse.json({
        ok: false,
        error: `${profile.displayName} API request timed out. Check if the base URL is correct: ${baseURL}`,
      });
    }
    return NextResponse.json({
      ok: false,
      error: `Connection failed: ${msg}`,
    });
  }
}
