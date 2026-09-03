'use client';

/**
 * useRunStream — client-side SSE consumer for long-running skill invocations.
 *
 * Faithful, slightly cleaned-up port of the pdb-tracker-web-v3 hook. Drives
 * the live progress feeds inside the Skills & Manual Run panel.
 *
 * R195 additions (two-phase run architecture, DSH only — classic endpoints
 * don't send the X-Run-Id header and keep their legacy behavior untouched):
 *   - captures the `X-Run-Id` response header into `state.runId`;
 *   - tracks per-event `seq` so a dropped connection can re-attach with
 *     `{ runId, after }` and resume without duplicate or lost events;
 *   - on network errors (NOT user cancellation) auto re-attaches up to 3
 *     times — the run keeps executing server-side, only the view reconnects.
 *
 * R196 fixes:
 *   - generation token (genRef): a superseded stream's async teardown can no
 *     longer clobber the successor run's state or kill its flush timer
 *     (start() while an old stream is mid-flight used to leave the new run
 *     showing a spurious "cancelled" error with a frozen live log);
 *   - re-attach works before the first parsed frame (after=0 full replay —
 *     a drop between response headers and frame #1 used to terminate with
 *     "多次中断" after zero attempts);
 *   - fetch()-level rejections (server restart blip) consume the same 3-attempt
 *     re-attach budget instead of falling straight to a terminal OOM message;
 *   - the budget resets whenever a frame (incl. server heartbeat pings) is
 *     successfully received — long runs survive >3 scattered drops;
 *   - classic-pipeline reader failures are reported as errors instead of a
 *     bogus green "done" with no result.
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
  /** R195: monotonic event index from the server run registry (re-attach cursor). */
  seq?: number;
  /** Caller-defined extras — forward-compatible. */
  [key: string]: unknown;
}

export interface StreamState {
  log: StreamEvent[];
  running: boolean;
  done: boolean;
  ok: boolean;
  error?: string;
  /** R212: 启动响应非 OK 时的解析后 JSON 体（如 409 重复启动守卫的
   *  { duplicate, runId }）—— 调用方可据此提供结构化恢复动作（如
   *  「停止该后台运行并重启」），而不必从错误字符串里正则扒 runId。 */
  errorPayload?: Record<string, unknown>;
  result?: any;
  /** R195: server-side run id (X-Run-Id header; DSH endpoints only). */
  runId?: string;
}

const INITIAL: StreamState = {
  log: [],
  running: false,
  done: false,
  ok: false,
};

/** Max auto re-attach attempts after a dropped connection (R195).
 * R196: budget resets on every successfully received frame, so this is
 * effectively "3 *consecutive* failures" — not 3 total per run. */
const MAX_REATTACH = 3;

export function useRunStream() {
  const [state, setState] = useState<StreamState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);
  // R195: server run id + consumed-event cursor for re-attach.
  const runIdRef = useRef<string | null>(null);
  const lastSeqRef = useRef<number>(-1);
  // R196: generation token — bumped by start()/reset(). The async loop (and
  // its teardown paths) capture the token and must silently exit once it no
  // longer matches: their setState/stopFlushTimer calls would otherwise land
  // on the NEW run's state/timer (the old-run teardown bug).
  const genRef = useRef(0);
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
    genRef.current++; // R196: supersede any in-flight stream's teardown.
    abortRef.current?.abort();
    abortRef.current = null;
    runIdRef.current = null;
    lastSeqRef.current = -1;
    logBufRef.current = [];
    stopFlushTimer();
    setState(INITIAL);
  }, [stopFlushTimer]);

  /**
   * R195: pump one SSE response body to completion.
   * Returns 'done' | 'error' (terminal frame received), 'ended' (stream
   * closed without a terminal frame) or 'network' (reader threw).
   *
   * R196 options:
   *   - isStale: when the owning start() generation has been superseded, the
   *     pump stops writing to the shared log buffer / state (late frames from
   *     an aborted old connection would otherwise pollute the new run's log)
   *     and skips state mutations in terminal branches;
   *   - onFrame: invoked per parsed frame (heartbeat pings included) so the
   *     caller can reset its re-attach budget on evidence the connection is
   *     alive.
   */
  const pump = useCallback(async (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    ctrl: AbortController,
    opts?: { isStale?: () => boolean; onFrame?: () => void },
  ): Promise<'done' | 'error' | 'ended' | 'network'> => {
    const decoder = new TextDecoder();
    let buf = '';
    const isStale = opts?.isStale ?? (() => false);

    const handleFrame = (eventName: string, payload: any): 'done' | 'error' | 'continue' => {
      if (eventName === 'progress' || eventName === 'log' || eventName === 'message') {
        if (isStale()) return 'continue'; // R196: superseded stream — no writes.
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
          seq: typeof base.seq === 'number' ? base.seq : undefined,
        };
        // R195: advance the re-attach cursor.
        if (typeof ev.seq === 'number' && ev.seq > lastSeqRef.current) {
          lastSeqRef.current = ev.seq;
        }
        // Buffer — flushed by interval to avoid per-event re-renders.
        logBufRef.current.push(ev);
        return 'continue';
      }
      if (eventName === 'done' || eventName === 'result') {
        if (isStale()) return 'done'; // R196: report outcome only — no state writes.
        stopFlushTimer();
        setState(s => ({
          ...s,
          running: false,
          done: true,
          ok: true,
          result: payload,
        }));
        return 'done';
      }
      if (eventName === 'error') {
        if (isStale()) return 'error';
        stopFlushTimer();
        setState(s => ({
          ...s,
          running: false,
          done: true,
          ok: false,
          error: (typeof payload === 'string' ? payload : payload?.message) || 'stream error',
        }));
        return 'error';
      }
      return 'continue';
    };

    // Parse SSE frames separated by a blank line.
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return 'ended';
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

          const r = handleFrame(eventName, payload);
          opts?.onFrame?.(); // R196: any parsed frame (pings included) = alive connection.
          if (r !== 'continue') return r;
        }
      }
    } catch (err: any) {
      if (ctrl.signal.aborted) return 'ended'; // treat as clean end on cancel
      return 'network';
    }
  }, [stopFlushTimer]);

  const start = useCallback((url: string, body?: any) => {
    // cancel any in-flight stream first
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const gen = ++genRef.current; // R196: this loop's generation token.
    runIdRef.current = null;
    lastSeqRef.current = -1;

    logBufRef.current = [];
    setState({ ...INITIAL, running: true });
    startFlushTimer();

    (async () => {
      let reattachAttempts = 0;
      let currentBody = body;
      try {
        // R195: loop supports auto re-attach — first iteration is the normal
        // POST; later iterations POST { runId, after } to resume.
        while (true) {
          let res: Response;
          try {
            res = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
              body: JSON.stringify(currentBody ?? {}),
              signal: ctrl.signal,
            });
          } catch (fetchErr: any) {
            // R196: fetch()-level rejection (server restart / network blip —
            // "TypeError: Failed to fetch") previously bypassed the re-attach
            // budget entirely and terminated with a misleading OOM-crash
            // message while the DSH run was still alive server-side. Route it
            // through the same budget.
            if (fetchErr?.name === 'AbortError' || ctrl.signal.aborted) throw fetchErr;
            if (runIdRef.current && ++reattachAttempts <= MAX_REATTACH) {
              await new Promise(r => setTimeout(r, 800));
              continue;
            }
            throw fetchErr;
          }

          if (!res.ok) {
            const text = await res.text().catch(() => '');
            // R195: JSON 错误体（如配额预检 503）只展示其中的 message 字段，
            // 不把整个 JSON 包络砸给用户。
            let friendly = text;
            // R212: 结构化错误体整体保留 —— 调方可读取 duplicate/runId 等
            // 字段提供恢复动作（如 409 重复启动时一键停止旧运行）。
            let payload: Record<string, unknown> | undefined;
            try {
              const j = JSON.parse(text);
              if (j && typeof j.error === 'string') friendly = j.error;
              if (j && typeof j === 'object' && !Array.isArray(j)) payload = j;
            } catch { /* not JSON — keep raw */ }
            if (gen !== genRef.current) return; // R196: superseded — stay silent.
            stopFlushTimer();
            setState(s => ({
              ...s,
              running: false,
              done: true,
              ok: false,
              error: `HTTP ${res.status} ${res.statusText}${friendly ? ` — ${friendly.slice(0, 300)}` : ''}`,
              errorPayload: payload,
            }));
            return;
          }

          if (!res.body) {
            if (gen !== genRef.current) return;
            stopFlushTimer();
            setState(s => ({ ...s, running: false, done: true, ok: false, error: 'No response body' }));
            return;
          }

          // R195: capture the server-side run id (DSH endpoints send
          // X-Run-Id; classic endpoints don't — runIdRef stays null).
          const rid = res.headers.get('x-run-id');
          if (rid && !runIdRef.current) {
            runIdRef.current = rid;
            setState(s => (s.runId === rid ? s : { ...s, runId: rid }));
          }

          const outcome = await pump(res.body.getReader(), ctrl, {
            isStale: () => gen !== genRef.current,
            onFrame: () => { reattachAttempts = 0; }, // R196: frames received → budget resets.
          });

          if (gen !== genRef.current) return; // R196: superseded — exit silently.

          if (outcome === 'done' || outcome === 'error') return; // terminal frame

          // Stream ended / dropped without a terminal frame.
          if (ctrl.signal.aborted) {
            // user cancellation — mirror legacy semantics
            stopFlushTimer();
            setState(s => ({ ...s, running: false, done: true, ok: false, error: 'cancelled' }));
            return;
          }
          // R196: re-attach also when no frame was parsed yet (lastSeq=-1 →
          // after=0 full replay — nothing was consumed, so nothing repeats).
          // Previously the `lastSeqRef.current >= 0` guard made a drop between
          // response headers and frame #1 fall straight through to the
          // "多次中断" error with zero re-attach attempts.
          if (runIdRef.current && ++reattachAttempts <= MAX_REATTACH) {
            // R195: run continues server-side — re-attach from the cursor.
            currentBody = { runId: runIdRef.current, after: Math.max(0, lastSeqRef.current + 1) };
            continue;
          }
          if (runIdRef.current) {
            // re-attach budget exhausted / attach failed repeatedly
            stopFlushTimer();
            setState(s => ({
              ...s,
              running: false,
              done: true,
              ok: false,
              error: '服务器连接多次中断。评估仍在后台运行，可稍后在 Run Center 历史中查看结果。',
            }));
            return;
          }
          if (outcome === 'network') {
            // R196: classic pipelines — a reader-level network failure used to
            // be reported as a bogus green success with no result; only a
            // clean close without a terminal frame keeps the legacy
            // implicit-success semantics.
            stopFlushTimer();
            setState(s => ({
              ...s,
              running: false,
              done: true,
              ok: false,
              error: '服务器连接中断（可能因内存不足崩溃）。请稍候重试 — 服务器会自动重启。',
            }));
            return;
          }
          // Legacy semantics (classic pipeline): stream ended cleanly without
          // explicit done/error — treat as success.
          stopFlushTimer();
          setState(s => ({ ...s, running: false, done: true, ok: true }));
          return;
        }
      } catch (err: any) {
        if (gen !== genRef.current) return; // R196: superseded — exit silently.
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
  }, [startFlushTimer, stopFlushTimer, pump]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /**
   * R196: stable accessor for the CURRENT runId (ref-based — immune to the
   * stale-render-closure problem that made the old 600ms Stop retry read a
   * dead state object). Used by the panel's Stop flow to outlast the LLM
   * quota-probe window (up to ~15s) before the id arrives.
   */
  const getRunId = useCallback((): string | null => runIdRef.current, []);

  useEffect(() => () => {
    genRef.current++; // R196: unmount supersedes any in-flight loop.
    abortRef.current?.abort();
    if (flushTimerRef.current) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  return { state, start, reset, cancel, getRunId };
}
