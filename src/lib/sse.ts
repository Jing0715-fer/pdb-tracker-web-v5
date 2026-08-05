/**
 * Shared helpers for emitting Server-Sent Events from Next.js route handlers.
 * Mirrors the contract expected by `useRunStream` on the client.
 */

export interface SseEvent {
  stage?: string;
  level?: 'info' | 'warn' | 'error' | 'success';
  message?: string;
  detail?: string;
  progress?: number;
  /** Caller-defined extras — e.g. chapter content for streaming SSE chapter events. */
  [key: string]: unknown;
}

/**
 * Wrap a route's `emit` (or `progress`) function so that every event the
 * route emits is also appended to a `logAccumulator` array, formatted as
 * NDJSON (one JSON object per line). The route hands the array to
 * `db.skillRunRecord.create({ data: { ..., log: logAccumulator.join('\n') } })`
 * so the Run Center can show the full SSE log for a past run instead of
 * only the short summary.
 *
 *   const log: string[] = [];
 *   const emit = withLog(progress, log);
 *   ...
 *   await db.skillRunRecord.create({ data: { ..., log: log.join('\n') } });
 */
export function withLog<T extends (ev: SseEvent) => void>(
  origEmit: T,
  log: string[],
): T {
  return ((ev: SseEvent) => {
    try {
      log.push(JSON.stringify({ ts: new Date().toISOString(), ...ev }));
    } catch {
      // never let logging break the route
    }
    origEmit(ev);
  }) as T;
}

export function sseStream() {
  const encoder = new TextEncoder();

  // `send` carries the stream's controller as an attached property so the
  // `start(controller)` callback (which runs synchronously during ReadableStream
  // construction) can hand it off to the closure created below.
  type SendFn = {
    (eventName: string, data: unknown): void;
    __controller?: ReadableStreamDefaultController<Uint8Array>;
  };

  const send: SendFn = (eventName: string, data: unknown) => {
    const ctrl = send.__controller;
    if (!ctrl) return;
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    const frame = `event: ${eventName}\ndata: ${payload}\n\n`;
    try {
      ctrl.enqueue(encoder.encode(frame));
    } catch {
      /* controller already closed */
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      send.__controller = controller;
    },
  });

  function progress(ev: SseEvent) {
    send('progress', { ts: new Date().toISOString(), ...ev });
  }

  function done(result: unknown) {
    send('done', result);
    const ctrl = send.__controller;
    try { ctrl?.close(); } catch { /* ignore */ }
  }

  function error(message: string) {
    send('error', { message });
    const ctrl = send.__controller;
    try { ctrl?.close(); } catch { /* ignore */ }
  }

  return { stream, send, progress, done, error };
}

/** Promise-based sleep that doesn't block the event loop. */
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
