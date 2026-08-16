/**
 * Session title generation — auto-generates a short title from the first user
 * message of a session, using the z-ai SDK (GLM-4.6).
 *
 * Mirrors dsh's session-title-llm plugin pattern: a lightweight LLM call with
 * a constrained prompt that returns ≤20 chars. Falls back to a heuristic
 * (truncated first message) on any failure — title generation must never break
 * the agent loop.
 */

import type { SessionEvent } from './session/types';

const TITLE_SYSTEM_PROMPT = `你是一个会话标题生成器。根据用户的第一条消息，生成一个简短的中文标题（不超过15个字）。

要求：
- 只返回标题文本，不要加引号、不要加标点
- 概括用户意图，不要照抄原文
- 如果是英文消息，翻译成中文标题
- 示例：用户"请加载PDB 4HHB并分析氢键" → "4HHB氢键分析"
- 示例：用户"hello" → "打招呼"
- 示例：用户"分析6LU7的配体相互作用" → "6LU7配体相互作用"`;

const FALLBACK_MAX_LEN = 20;

/** Extract the first user message text from a session event log. */
export function extractFirstUserMessage(events: SessionEvent[]): string | null {
  for (const ev of events) {
    if (ev.type === 'user/message') {
      const data = ev.data as { content: Array<{ type: string; text?: string }> };
      const text = data.content
        .filter((b) => b.type === 'text' && b.text)
        .map((b) => b.text!)
        .join(' ')
        .trim();
      if (text) return text;
    }
  }
  return null;
}

/** Heuristic fallback: truncate the first user message. */
export function fallbackTitle(firstMessage: string): string {
  const cleaned = firstMessage.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= FALLBACK_MAX_LEN) return cleaned;
  return cleaned.slice(0, FALLBACK_MAX_LEN) + '…';
}

/**
 * Generate a session title from the first user message via the z-ai SDK.
 * Returns null if the SDK call fails (caller falls back to heuristic).
 */
export async function generateSessionTitle(firstMessage: string): Promise<string | null> {
  try {
    const mod = await import('z-ai-web-dev-sdk');
    const ZAI = (mod as unknown as { default: { create: () => Promise<unknown> } }).default;
    const zai = await ZAI.create();
    const completion = await (
      zai as {
        chat: {
          completions: {
            create: (opts: Record<string, unknown>) => Promise<{
              choices?: Array<{ message?: { content?: string } }>;
            }>;
          };
        };
      }
    ).chat.completions.create({
      model: 'glm-4.6',
      messages: [
        { role: 'system', content: TITLE_SYSTEM_PROMPT },
        { role: 'user', content: firstMessage.slice(0, 500) },
      ],
      thinking: { type: 'disabled' as const },
      temperature: 0.3,
      max_tokens: 30,
    });
    const title = completion.choices?.[0]?.message?.content?.trim();
    if (!title) return null;
    // Sanitize: strip quotes, newlines, limit length.
    const clean = title
      .replace(/^["'""「」『』]+|["'""「」『』]+$/g, '')
      .replace(/\n+/g, ' ')
      .trim();
    if (clean.length === 0) return null;
    return clean.length > 30 ? clean.slice(0, 30) + '…' : clean;
  } catch (err) {
    console.error('[session-title] generation failed:', err);
    return null;
  }
}

/**
 * Generate a title for a session if it doesn't have a meaningful one yet.
 * Called after the first user message is appended. Updates the DB row + the
 * in-memory session title + emits a session/title event.
 */
export async function maybeGenerateTitle(
  sessionId: string,
  events: SessionEvent[],
  currentTitle: string,
  onUpdate: (title: string) => void,
): Promise<void> {
  // Only generate if the current title is the default placeholder.
  const isDefaultTitle =
    !currentTitle ||
    currentTitle === 'New session' ||
    currentTitle === 'PDB Tracker Agent Session' ||
    currentTitle.startsWith('Session ');
  if (!isDefaultTitle) return;
  const firstMessage = extractFirstUserMessage(events);
  if (!firstMessage) return;
  // Immediate heuristic fallback so the sidebar updates fast.
  const fallback = fallbackTitle(firstMessage);
  onUpdate(fallback);
  // Then try the LLM (async, best-effort).
  const generated = await generateSessionTitle(firstMessage);
  if (generated) onUpdate(generated);
}
