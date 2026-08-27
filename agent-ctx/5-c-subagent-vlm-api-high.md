# Task 5-c — subagent (vlm-api-high)

Task: Fix 4 High-severity VLM API-layer issues (VLM-004/005/006/007) in
`src/app/api/vlm/select-best/route.ts` + `src/lib/molcraft/vlm-client.ts`.
(Files owned by other agents — NOT touched: `src/lib/molcraft/vlm-capture-loop.ts`
[Task 5-b], `src/lib/agent/**` [Task 5-a].)

## What was fixed

### VLM-004 — debug dump wrote /tmp unconditionally
- route.ts: dump block (was at R162, now ~L208-232) gated behind
  `process.env.VLM_DEBUG_DUMP === '1'`. Default: zero filesystem writes.
- When enabled: keeps the R162 "delete previous batch first" bound (only the
  newest batch exists), `console.log`s the dump pattern, and the success
  response now carries `debugDump: "/tmp/qa_screenshot_<stamp>_*"`.
- Verified: with env unset → 0 files written; with `VLM_DEBUG_DUMP=1` + two
  back-to-back requests → only the newest batch (single stamp) remains.

### VLM-005 — single VLM call had no inner timeout
- route.ts: new `combineAbortSignals(...signals)` helper (prefers
  `AbortSignal.any` [Node 20+, present in Node v24 runtime + TS 5.9 lib],
  manual listener wiring fallback). Each createVision attempt now gets
  `combineAbortSignals(innerController.signal, AbortSignal.timeout(55_000))`.
- 55s not 60s: worst case = 4×55 + backoff 5+15+45 + ≤1s jitter ≈ 286s,
  inside maxDuration=300 (60s would give 305s+).
- Timeout aborts are retryable: `isTransientError` now also matches on the
  DOMException `name` ('AbortError'/'TimeoutError') because aborts surface
  their signal via name, not always via message.
- vlm-client.ts: `selectBestScreenshot` fetch now bounded by default
  `AbortSignal.timeout(90_000)` combined with the caller signal (caller
  signal takes precedence in reporting; either firing aborts). Same
  any-or-manual combinator (`combineFetchSignal`). Catch block now
  distinguishes client-disconnect vs 90s-timeout in logs (TimeoutError is a
  different DOMException name than AbortError).
- Verified: combinator unit-smoked (2nd-source abort, pre-aborted source,
  timeout-fire → all abort the combined signal).

### VLM-006 — no rate limit, no screenshot count/size caps
- route.ts POST entry (L157-206): 10 req/min sliding-window limiter keyed by
  client IP (`x-forwarded-for` first entry → `x-real-ip` → 'global'),
  429 + `Retry-After` when exceeded. State on `globalThis.__vlmRateLimiter`
  (getAgentManager pattern — module-level vars aren't shared across dev route
  bundles). Timestamps lazily pruned per access; key set opportunistically
  pruned past 1000 entries (no unbounded Map growth).
- Body validation: `screenshots.length ≤ 8` → 400; each `dataUri` must be
  `data:image/*` → 400; base64 payload ≤ 4_200_000 chars (~3MB decoded) → 400.
- Verified by direct module invocation (bun): 9 shots → 400; bad URI → 400;
  4.3M-char payload → 400; 11th request in-window → 429 + Retry-After=60.

### VLM-007 — greedy JSON regex failed silently
- route.ts: new `extractFirstJsonObject` = ```json fenced block (balanced
  scan inside it) → fallback balanced-brace scan of the raw text
  (`scanBalancedJsonObject` handles braces/escaped quotes inside strings).
  Replaces `vlmResponse.match(/\{[\s\S]*\}/)`.
- Parse failures now: `console.warn` with the raw response truncated to 500
  chars + response field `vlmSignal: 'parse-failed'` (vs `'ok'`; single
  screenshot short-circuit returns `'skipped'`). bestIndex still falls back
  to 0/number-fallback (behavior preserved) but is now distinguishable from
  a real VLM choice.
- vlm-client.ts: `VlmResult.vlmSignal?: 'ok' | 'parse-failed' | 'skipped'`
  added to the interface; `selectBestScreenshot` warns in the browser console
  when the server reports parse-failed (field rides along in the JSON
  response automatically — not dropped); `applyVlmResultToImages` prefixes
  comments with `[VLM输出解析失败] ` when parse-failed so the UI shows the
  signal instead of presenting a defaulted bestIndex as a real selection.
- Verified: 8 extraction cases PASS (markdown-wrapped, two JSON blocks,
  braces in strings, escaped quotes, prose inside fence, no JSON → null,
  unbalanced → null, nested objects).

## Verification
- Lint: 99 errors / 6493 warnings before AND after — identical to the
  baseline (all pre-existing molstar prebuilt-bundle noise). No new issues.
- Functional smoke via `bun` direct-module invocation (dev server was
  OOM-dead during this window; no test code committed — temp scripts deleted):
  all cases above PASS. One 2-screenshot request with a fake PNG even
  exercised the real ZAI SDK path end-to-end (API 400 image-format error →
  route's 500 fallback shape intact).
- `bun run build` NOT run (sandbox OOM), dev server NOT started/stopped
  (managed externally).

## Notes for other agents
- Task 5-b (vlm-capture-loop.ts): `VlmResult` now has an optional
  `vlmSignal` field — safe to ignore, or use it to annotate the
  "未经视觉验证" badge with a parse-failure variant.
- The route response additionally carries `debugDump` (string | undefined)
  — harmless extra field.
