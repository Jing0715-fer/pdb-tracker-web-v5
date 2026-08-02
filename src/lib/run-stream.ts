/**
 * Shared SSE (Server-Sent Events) helper for long-running skill invocations.
 *
 * Used by the three Settings & Run Panel modules (literature / eval / weekly)
 * to surface progress to the front-end without resorting to polling.
 *
 * Protocol (server → client):
 *   event: progress
 *   data:  {"stage":"cycle1","detail":"cryoem: Generator","ts":1700000000}
 *
 *   event: chunk        (optional — emitted when caller wants partial text)
 *   data:  {"stage":"cycle1","chunk":"first 100 chars...","ts":...}
 *
 *   event: done
 *   data:  {"ok":true,"result":{...}}   // full RunXxxResult
 *
 *   event: error
 *   data:  {"message":"..."}
 *
 * Each event is terminated by a blank line. The client-side `useRunStream`
 * hook in `use-run-stream.ts` parses them back into a structured log.
 */

import { NextRequest } from 'next/server';
import { ReadableStream } from 'node:stream/web';
import { spawn } from 'node:child_process';

export type StreamEvent =
  | { kind: 'progress'; stage: string; detail?: string; ts?: number }
  | { kind: 'chunk'; stage: string; chunk: string; ts?: number }
  | { kind: 'log'; message: string; level?: 'info' | 'warn' | 'error'; ts?: number }
  | { kind: 'done'; ok: boolean; result?: unknown; error?: string }
  | { kind: 'error'; message: string; stack?: string };

/** Encode a single event as SSE wire format (UTF-8). */
export function sseEncode(ev: StreamEvent): string {
  const lines: string[] = [];
  lines.push(`event: ${ev.kind}`);
  // Single-line JSON keeps the wire format simple — no multi-line `data:`.
  lines.push(`data: ${JSON.stringify(ev)}`);
  lines.push('');
  lines.push('');
  return lines.join('\n');
}

/** Wrap a progress-emitting async function in an SSE stream. */
export function wrapSse<T>(
  fn: (emit: (ev: StreamEvent) => void) => Promise<T>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (ev: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(sseEncode(ev)));
        } catch { /* closed */ }
      };
      try {
        const result = await fn(emit);
        emit({ kind: 'done', ok: true, result });
      } catch (e: any) {
        emit({ kind: 'error', message: e?.message || String(e), stack: e?.stack });
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });
}

/**
 * Run a child_process with streamed stdout/stderr progress events.
 * Use this when the underlying tool is a CLI / Python script that emits
 * helpful progress on stderr.
 */
export function spawnStreamed(
  cmd: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; label?: string } = {},
  emit: (ev: StreamEvent) => void,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const label = options.label || `${cmd} ${args[0] || ''}`;
  return new Promise((resolve, reject) => {
    emit({ kind: 'progress', stage: 'exec', detail: `${label}: ${cmd} ${args.join(' ')}` });
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env || {}) },
    });
    let stdout = '';
    let stderr = '';
    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error(`${label} timed out after ${options.timeoutMs! / 1000}s`));
        }, options.timeoutMs)
      : null;
    child.stdout.on('data', (b) => {
      const chunk = b.toString();
      stdout += chunk;
      // Forward to SSE consumers — chunk events get the raw bytes so they
      // can render partial output if needed.
      emit({ kind: 'chunk', stage: 'exec-stdout', chunk });
    });
    child.stderr.on('data', (b) => {
      const chunk = b.toString();
      stderr += chunk;
      emit({ kind: 'chunk', stage: 'exec-stderr', chunk });
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      emit({ kind: 'progress', stage: 'exec-done', detail: `${label} exit=${code}` });
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** Convenience: detect client capability (browser EventSource vs fetch stream). */
export function clientWantsSse(req: NextRequest): boolean {
  const accept = req.headers.get('accept') || '';
  return accept.includes('text/event-stream');
}