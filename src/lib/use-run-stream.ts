'use client';

/**
 * useRunStream — client-side SSE consumer for long-running skill invocations.
 *
 * Faithful, slightly cleaned-up port of the pdb-tracker-web-v3 hook. Drives
 * the live progress feeds inside the Skills & Manual Run panel.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface StreamEvent {
  ts: string;            // ISO timestamp
  stage?: string;        // short stage label e.g. "fetch-pubmed"
  level?: 'info' | 'warn' | 'error' | 'success';
  message?: string;      // headline
  detail?: string;       // verbose payload
  progress?: number;     // 0..100 (optional)
  /** Chapter streaming: id of the chapter this event refers to. */
  chapter?: string;
  /** 1-based chapter index within the report. */
  chapterIndex?: number;
  /** Total chapters in the report. */
  chapterTotal?: number;
  /** Streamed chapter text (set on `chapter_done` events). */
  chapterContent?: string;
  /** Error message for the chapter (set on `chapter_done` failure). */
  chapterError?: string;
  /** Per-chapter generation duration (ms). */
  chapterDurationMs?: number;
  /** Caller-defined extras — forward-compatible. */
  [key: string]: unknown;
}

export interface StreamState {
  log: StreamEvent[];
  running: boolean;
  done: boolean;
  ok: boolean;
  error?: string;
  result?: any;
}

const INITIAL: StreamState = {
  log: [],
  running: false,
  done: false,
  ok: false,
};

export function useRunStream() {
  const [state, setState] = useState<StreamState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);
  // Buffer for incoming log events — flushed to state on an interval to
  // avoid re-rendering on every single SSE frame (which can be 10+/second
  // during chapter streaming and causes UI jank / perceived "page refresh").
  const logBufRef = useRef<StreamEvent[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startFlushTimer = useCallback(() => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setInterval(() => {
      if (logBufRef.current.length === 0) return;
      const batch = logBufRef.current;
      logBufRef.current = [];
      setState(s => ({ ...s, log: [...s.log, ...batch].slice(-300) }));
    }, 120); // ~8 fps — smooth enough for progress, light on React
  }, []);
  const stopFlushTimer = useCallback(() => {
    if (flushTimerRef.current) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    // Final flush
    if (logBufRef.current.length > 0) {
      const batch = logBufRef.current;
      logBufRef.current = [];
      setState(s => ({ ...s, log: [...s.log, ...batch].slice(-300) }));
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    logBufRef.current = [];
    stopFlushTimer();
    setState(INITIAL);
  }, [stopFlushTimer]);

  const start = useCallback((url: string, body?: any) => {
    // cancel any in-flight stream first
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    logBufRef.current = [];
    setState({ ...INITIAL, running: true });
    startFlushTimer();

    (async () => {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify(body ?? {}),
          signal: ctrl.signal,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          stopFlushTimer();
          setState(s => ({
            ...s,
            running: false,
            done: true,
            ok: false,
            error: `HTTP ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 300)}` : ''}`,
          }));
          return;
        }

        if (!res.body) {
          stopFlushTimer();
          setState(s => ({ ...s, running: false, done: true, ok: false, error: 'No response body' }));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';

        // Parse SSE frames separated by a blank line.
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          let idx: number;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);

            // Each frame consists of `event:` and `data:` lines.
            let eventName = 'message';
            const dataLines: string[] = [];
            for (const line of frame.split('\n')) {
              if (line.startsWith('event:')) eventName = line.slice(6).trim();
              else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
            }
            const dataStr = dataLines.join('\n');
            let payload: any = dataStr;
            try { payload = JSON.parse(dataStr); } catch { /* keep as string */ }

            if (eventName === 'progress' || eventName === 'log' || eventName === 'message') {
              // Strip the noise (ts is generated server-side; everything else from payload).
              // R179 (Task 2-b): spread the raw payload FIRST so caller-defined
              // extras (dshRelevance / dshOutline / dshFigure on DSH-mode eval
              // progress events) survive into state.log entries — the explicit
              // field list below used to silently drop them.
              const base = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
              const ev: StreamEvent = {
                ...base,
                ts: (base.ts as string | undefined) || new Date().toISOString(),
                stage: base.stage as string | undefined,
                level: base.level as StreamEvent['level'],
                message: base.message as string | undefined,
                detail: base.detail as string | undefined,
                progress: typeof base.progress === 'number' ? base.progress : undefined,
                chapter: base.chapter as string | undefined,
                chapterIndex: base.chapterIndex as number | undefined,
                chapterTotal: base.chapterTotal as number | undefined,
                chapterContent: base.chapterContent as string | undefined,
                chapterError: base.chapterError as string | undefined,
                chapterDurationMs: base.chapterDurationMs as number | undefined,
              };
              // Buffer — flushed by interval to avoid per-event re-renders.
              logBufRef.current.push(ev);
            } else if (eventName === 'done' || eventName === 'result') {
              stopFlushTimer();
              setState(s => ({
                ...s,
                running: false,
                done: true,
                ok: true,
                result: payload,
              }));
              return;
            } else if (eventName === 'error') {
              stopFlushTimer();
              setState(s => ({
                ...s,
                running: false,
                done: true,
                ok: false,
                error: (typeof payload === 'string' ? payload : payload?.message) || 'stream error',
              }));
              return;
            }
          }
        }

        // Stream ended without explicit done/error — treat as success.
        stopFlushTimer();
        setState(s => ({ ...s, running: false, done: true, ok: true }));
      } catch (err: any) {
        stopFlushTimer();
        if (err?.name === 'AbortError') {
          setState(s => ({ ...s, running: false, done: true, ok: false, error: 'cancelled' }));
        } else {
          // Friendly error message for common server-crash scenarios.
          // "Failed to fetch" / "network error" / "Load failed" all indicate
          // the server crashed (OOM) during the LLM run — the SSE connection
          // was severed. Tell the user to retry.
          const msg = err?.message || String(err);
          const isNetworkError = /failed to fetch|network error|load failed|err_connection/i.test(msg);
          setState(s => ({
            ...s,
            running: false,
            done: true,
            ok: false,
            error: isNetworkError
              ? '服务器连接中断（可能因内存不足崩溃）。请稍候重试 — 服务器会自动重启。'
              : msg,
          }));
        }
      }
    })();
  }, [startFlushTimer, stopFlushTimer]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (flushTimerRef.current) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  return { state, start, reset, cancel };
}
