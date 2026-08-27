/**
 * SurfaceManager — folds the append-only event log into the model-visible
 * "surface": an ordered list of seqs that project to Message[].
 *
 * Only surface-eligible events (user/message, assistant/message, tool/result)
 * carry a `surfaceOp`. `append` rewrites the surface; `deriveMessages` walks
 * the surface and projects the messages the model sees next turn.
 *
 * R167 (AGENT-009 residual): recompute() used to re-walk the ENTIRE event
 * log on every append — O(n²) cumulative over a long session (one full walk
 * per surface-eligible append). The fold is a plain left fold, so when the
 * log is unchanged except for appended tail events we can fold JUST the
 * tail onto the existing surface. "Unchanged prefix" is verified by
 * reference identity of the boundary event: the log is append-only and
 * events are frozen, so a fresh array (fork / reload / rewrite) fails the
 * check and falls back to the one-shot full rebuild. Correctness first,
 * then incrementality.
 *
 * R165 (AGENT-009 partial / UI-003): tool/result events persist screenshot
 * data URIs verbatim (needed so resumed sessions can render images — the
 * client's in-memory executionsRef does not survive a reload). The LLM must
 * never see those multi-MB base64 payloads, so deriveMessages replaces
 * oversized data URIs with a short placeholder IN THE MODEL-VISIBLE
 * PROJECTION ONLY. The durable event log is never mutated.
 */

import { deepFreeze } from '../types';
import type { Seq } from '../types';
import type { SessionEvent, SessionEventType } from './types';
import { isSurfaceEligible } from './types';
import type { Message, AssistantMessage, ToolResultMessage, UserMessage, ContentBlock } from '../llm/types';

interface SurfaceEntry {
  seq: Seq;
  type: SessionEventType;
}

/**
 * Embedded data URI long enough to blow up the model context. ~2048 base64
 * chars ≈ 1.5KB binary — small inline icons survive, screenshot payloads
 * (hundreds of KB to several MB) do not.
 */
const DATA_URI_PATTERN = /data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]{2048,})/g;
/** Cheap probe so the regex only runs on strings that can contain a URI. */
const DATA_URI_PROBE = 'data:image/';

/**
 * Replace oversized embedded image data URIs with a compact placeholder.
 * Returns the input unchanged when there is nothing to strip.
 */
function stripDataUrisForLlm(text: string): string {
  if (!text.includes(DATA_URI_PROBE)) return text;
  let replaced = false;
  const out = text.replace(DATA_URI_PATTERN, (_match: string, _b64: string, offset: number): string => {
    replaced = true;
    // Best-effort label: screenshot payloads are shaped like
    // {"angle":"front","label":"…","dataUri":"data:image/png;base64,…"} —
    // take the nearest "angle"/"label" field within the 200 chars before
    // the URI so the placeholder still tells the model WHAT was captured.
    const before = text.slice(Math.max(0, offset - 200), offset);
    const labels = [...before.matchAll(/"(?:angle|label)"\s*:\s*"([^"]{0,48})"/g)];
    const tag = labels.length > 0 ? labels[labels.length - 1]![1] : null;
    return tag
      ? `[screenshot ${tag} omitted from LLM context — user has seen it]`
      : `[screenshot omitted from LLM context — user has seen it]`;
  });
  return replaced ? out : text;
}

/**
 * Project a persisted ToolResultMessage into its model-visible form: long
 * data URIs inside the text content become placeholders. Returns the ORIGINAL
 * (already-frozen) message object when nothing changes so the common path is
 * allocation-free; otherwise a shallow sanitized copy. Never mutates the
 * durable event.
 */
function projectToolResultMessage(message: ToolResultMessage): ToolResultMessage {
  let anyChanged = false;
  const blocks: ContentBlock[] = message.content.map((block) => {
    if (block.type !== 'tool-result') return block;
    let blockChanged = false;
    const inner: ContentBlock[] = block.content.map((b): ContentBlock => {
      if (b.type !== 'text') return b;
      const text = stripDataUrisForLlm(b.text);
      if (text === b.text) return b;
      blockChanged = true;
      anyChanged = true;
      return { type: 'text', text };
    });
    return blockChanged ? { ...block, content: inner } : block;
  });
  if (!anyChanged) return message;
  return { ...message, content: blocks };
}

export class SurfaceManager {
  private surface: SurfaceEntry[] = [];
  private derivedCache: Message[] | null = null;
  /** R167: # of log events already folded into `surface`. */
  private foldedCount = 0;
  /** R167: reference to the last folded event — prefix-identity probe. */
  private boundaryEvent: SessionEvent | null = null;

  /**
   * Fold one event into the surface (shared by full rebuild + incremental
   * tail fold). Non-surface events are no-ops; `replace` ops splice their
   * [start, end] range out of the surface before appending.
   */
  private fold(ev: SessionEvent): void {
    if (!isSurfaceEligible(ev.type)) return;
    if (!ev.surfaceOp || ev.surfaceOp.op === 'append') {
      this.surface.push({ seq: ev.seq, type: ev.type });
      return;
    }
    const { start, end } = ev.surfaceOp;
    for (let i = this.surface.length - 1; i >= 0; i--) {
      if (this.surface[i]!.seq >= start && this.surface[i]!.seq <= end) this.surface.splice(i, 1);
    }
    this.surface.push({ seq: ev.seq, type: ev.type });
  }

  /** Rebuild the surface from the event log. Called after appends. */
  recompute(events: readonly SessionEvent[]): void {
    const n = events.length;
    // R167 fast path: the previously folded prefix is reference-identical
    // (boundary event matches) and the log only grew — fold the tail onto
    // the existing surface instead of re-walking from seq 0. `n < foldedCount`
    // (shrink) or a different event at the boundary (rewrite/fork/reload)
    // falls through to the full rebuild below.
    if (
      this.boundaryEvent !== null &&
      n >= this.foldedCount &&
      n > 0 &&
      events[this.foldedCount - 1] === this.boundaryEvent
    ) {
      for (let i = this.foldedCount; i < n; i++) {
        this.fold(events[i]!);
      }
      this.foldedCount = n;
      this.boundaryEvent = events[n - 1]!;
      this.derivedCache = null;
      return;
    }
    // Full rebuild (first call, shrunk log, or rewritten prefix). `fold`
    // pushes into `this.surface`, so reset it before walking.
    this.surface = [];
    for (const ev of events) {
      this.fold(ev);
    }
    this.foldedCount = n;
    this.boundaryEvent = n > 0 ? events[n - 1]! : null;
    this.derivedCache = null;
  }

  get surfaceSeqs(): readonly Seq[] {
    return this.surface.map((s) => s.seq);
  }

  /** Project the model-visible messages from the event log. */
  deriveMessages(eventsBySeq: ReadonlyMap<Seq, SessionEvent>): Message[] {
    if (this.derivedCache) return this.derivedCache;
    const out: Message[] = [];
    for (const entry of this.surface) {
      const ev = eventsBySeq.get(entry.seq);
      if (!ev) continue;
      if (ev.type === 'user/message') {
        out.push(ev.data as UserMessage);
      } else if (ev.type === 'assistant/message') {
        const data = ev.data as { message: AssistantMessage };
        // Skip empty-content assistant messages (usage-only / max-tokens).
        if (data.message.content.length > 0) out.push(data.message);
      } else if (ev.type === 'tool/result') {
        const data = ev.data as { message: ToolResultMessage };
        // R165 (UI-003): the event keeps the full data URIs (for UI replay);
        // the model sees placeholders instead of multi-MB base64 payloads.
        out.push(projectToolResultMessage(data.message));
      }
    }
    this.derivedCache = deepFreeze(out);
    return this.derivedCache;
  }
}
