/**
 * LLM signal utilities — combine caller cancellation with a hard timeout.
 *
 * R168 (AGENT-M6): neither LLM adapter had any time bound — only the loop's
 * controller signal (aborted solely by cancel()) was passed to the SDK call /
 * fetch. A hung provider connection blocked the drive indefinitely
 * (`maxDuration = 300` is a host hint a self-hosted dev server does not
 * enforce), wedging the session. The VLM route got per-attempt timeouts in
 * R165 (VLM-005); this brings the main LLM calls to parity.
 *
 * `AbortSignal.any` is Node 20+; this helper works on Node 18 by composing
 * controllers manually and — critically — exposing dispose() so callers can
 * clear the timer and detach listeners in a finally block (no leaks across
 * a long-lived process).
 */

/** Hard per-attempt timeout for one LLM request (ms). */
export const LLM_REQUEST_TIMEOUT_MS = 120_000;

export interface TimeoutSignal {
  /** Combined signal — aborts when the caller aborts OR the timeout fires. */
  signal: AbortSignal;
  /** True when the last abort came from the timeout (vs caller cancel). */
  timedOut: () => boolean;
  /** MUST be called in a finally block: clears the timer, detaches listeners. */
  dispose: () => void;
}

export function withTimeoutSignal(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number = LLM_REQUEST_TIMEOUT_MS,
): TimeoutSignal {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(
      typeof DOMException === 'function'
        ? new DOMException(`LLM request timed out after ${timeoutMs}ms`, 'TimeoutError')
        : new Error(`LLM request timed out after ${timeoutMs}ms`)
    );
  }, timeoutMs);
  const onCallerAbort = () => {
    controller.abort(callerSignal?.reason);
  };
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort(callerSignal.reason);
    } else {
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
  }
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
    },
  };
}
