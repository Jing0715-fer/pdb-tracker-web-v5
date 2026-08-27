/**
 * Round 61: VLM (Vision Language Model) API — Select Best Screenshot
 *
 * POST /api/vlm/select-best
 * Body: {
 *   screenshots: Array<{ dataUri: string; angle: string; label: string }>,
 *   recipe: string,          // e.g. "binding_pocket"
 *   analysisSummary: string,  // text summary of the analysis results
 *   prompt?: string           // optional custom prompt
 * }
 *
 * Uses z-ai-web-dev-sdk's createVision() to analyze each screenshot and
 * select the one that best illustrates the analysis. Returns the index
 * of the best screenshot + a commentary explaining why.
 *
 * R165 hardening: 10 req/min sliding-window rate limit (VLM-006), ≤8
 * screenshots × ≤~3MB each (VLM-006), /tmp debug dump gated behind
 * VLM_DEBUG_DUMP=1 (VLM-004), 55s per-attempt VLM timeout (VLM-005),
 * robust fenced/balanced-brace JSON extraction + vlmSignal field (VLM-007).
 *
 * Backend-only — z-ai-web-dev-sdk MUST NOT be used in client-side code.
 */
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
// R163: raised from 60 — the 429 backoff schedule alone is 5+15+45=65s
export const maxDuration = 300;

/** R165 (VLM-006): max screenshots per request — bounds VLM token spend. */
const MAX_SCREENSHOTS = 8;
/** R165 (VLM-006): max base64 chars per screenshot dataUri (~3MB decoded). */
const MAX_SCREENSHOT_BASE64_CHARS = 4_200_000;
/** R165 (VLM-006): sliding-window rate limit — 10 req/min per client key. */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;
/**
 * R165 (VLM-005): per-attempt timeout for a single createVision call.
 * Budget math: 4 attempts × 55s + backoff 5+15+45s + ≤1s jitter ≈ 286s,
 * safely inside maxDuration=300. (60s would make the worst case 305s+.)
 */
const VLM_SINGLE_CALL_TIMEOUT_MS = 55_000;

/**
 * R165 (VLM-005): combine multiple abort sources into one signal.
 * Prefers AbortSignal.any (Node 20+ / modern browsers) and falls back to
 * manual listener wiring so either source aborting aborts the combined one.
 */
function combineAbortSignals(...signals: AbortSignal[]): AbortSignal {
  const anyFn = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === 'function') {
    return anyFn(signals);
  }
  const combined = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      combined.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => combined.abort(s.reason), { once: true });
  }
  return combined.signal;
}

/**
 * R165 (VLM-006): in-process sliding-window rate limiter state, stashed on
 * globalThis (same pattern as getAgentManager in src/lib/agent/manager.ts —
 * Next.js dev bundles routes separately, so a module-level variable is NOT
 * reliably shared across route module instances).
 * Key: client IP (or 'global' fallback). Value: request timestamps.
 */
type VlmRateLimiter = { hits: Map<string, number[]> };
function getVlmRateLimiter(): VlmRateLimiter {
  const g = globalThis as unknown as { __vlmRateLimiter?: VlmRateLimiter };
  if (!g.__vlmRateLimiter) g.__vlmRateLimiter = { hits: new Map() };
  return g.__vlmRateLimiter;
}

/** R165 (VLM-006): best-effort client key from proxy headers; 'global' fallback. */
function getClientKey(req: NextRequest): string {
  const first = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (first) return first;
  return req.headers.get('x-real-ip')?.trim() || 'global';
}

/**
 * R165 (VLM-006): sliding-window rate check. Timestamps older than the
 * window are lazily pruned on every access; the key set itself is
 * opportunistically pruned past 1000 entries so the Map can't leak.
 */
function checkRateLimit(key: string): { allowed: boolean; retryAfterSec: number } {
  const limiter = getVlmRateLimiter();
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const recent = (limiter.hits.get(key) ?? []).filter((ts) => ts > windowStart);
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    limiter.hits.set(key, recent); // store pruned list even when rejecting
    const oldest = recent[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - now) / 1000));
    return { allowed: false, retryAfterSec };
  }
  recent.push(now);
  limiter.hits.set(key, recent);
  if (limiter.hits.size > 1000) {
    for (const [k, stamps] of limiter.hits) {
      if (!stamps.some((ts) => ts > windowStart)) limiter.hits.delete(k);
    }
  }
  return { allowed: true, retryAfterSec: 0 };
}

/**
 * R165 (VLM-007): balanced-brace scan — extracts the first complete,
 * top-level JSON object starting at the first '{'. Handles braces and
 * escaped quotes inside JSON string literals.
 */
function scanBalancedJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null; // no balanced object found
}

/**
 * R167 (VLM-009): sanitize the analysisSummary before it is interpolated
 * into the VLM prompt. The summary originates from tool results / LLM-shaped
 * text, so it must be treated as untrusted input:
 *   1. all whitespace runs (incl. newlines) flattened to single spaces —
 *      injected text can no longer fake prompt structure by starting a
 *      fresh line,
 *   2. crude instruction-injection patterns scrubbed (case-insensitive
 *      EN + 中文 variants of "ignore previous instructions") — replaced
 *      with a neutral marker, not silently dropped, so tampering is visible,
 *   3. truncated to 800 chars to bound prompt size.
 * This is deliberately rough defense-in-depth — the numeric outputs are
 * already constrained by JSON validation downstream; it does not need to
 * be perfect, just to break obvious payload-crafting.
 */
const MAX_ANALYSIS_SUMMARY_CHARS = 800;
const SUMMARY_INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above|earlier|preceding)\s+(?:instructions?|prompts?|rules?|directives?|context)/gi,
  /disregard\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above|earlier|preceding)\s+(?:instructions?|prompts?|rules?|directives?)/gi,
  /(?:忽略|无视|忽略掉|不理会)(?:以上|之前|上述|前面|先前)(?:的)?(?:所有)?(?:指令|指示|规则|要求|提示)/g,
  /system\s*prompt\s*:/gi,
  /new\s+(?:instructions?|rules?)\s*:/gi,
  /you\s+are\s+now\s+a/gi,
  /must\s+(?:always\s+)?return\s+bestindex\s*=/gi,
];
function sanitizeAnalysisSummary(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0) return '';
  let s = raw.replace(/\s+/g, ' ').trim();
  for (const re of SUMMARY_INJECTION_PATTERNS) {
    s = s.replace(re, '[已过滤]');
  }
  if (s.length > MAX_ANALYSIS_SUMMARY_CHARS) {
    s = s.slice(0, MAX_ANALYSIS_SUMMARY_CHARS) + '…(截断)';
  }
  return s;
}

/**
 * R165 (VLM-007): three-stage JSON extraction from a VLM response:
 * 1. ```json fenced code block (+ balanced scan inside it),
 * 2. failing that, a balanced-brace scan of the raw response.
 * Replaces the old greedy regex /\{[\s\S]*\}/ which spanned the first '{'
 * to the LAST '}' — markdown-wrapped or multi-block responses failed to
 * parse and the route silently returned bestIndex=0 with no VLM signal.
 */
function extractFirstJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const obj = scanBalancedJsonObject(fenced[1]);
    if (obj) return obj;
  }
  return scanBalancedJsonObject(text);
}

export async function POST(req: NextRequest) {
  // R165 (VLM-006): rate limit BEFORE any expensive work (multi-MB body
  // parse, VLM calls). No auth in this sandbox app — this is the only
  // guard against a caller draining the ZAI VLM quota.
  const rate = checkRateLimit(getClientKey(req));
  if (!rate.allowed) {
    return NextResponse.json(
      { error: `Too many VLM select-best requests — retry after ${rate.retryAfterSec}s` },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } },
    );
  }

  try {
    const body = await req.json();
    const { screenshots, recipe, analysisSummary, prompt } = body as {
      screenshots: Array<{ dataUri: string; angle: string; label: string }>;
      recipe: string;
      analysisSummary?: string;
      prompt?: string;
    };

    if (!screenshots || !Array.isArray(screenshots) || screenshots.length === 0) {
      return NextResponse.json({ error: 'screenshots array is required' }, { status: 400 });
    }

    // R165 (VLM-006): cap screenshot count + per-image size. Previously
    // 8+ screenshots × 1MB each passed silently — VLM token spend was
    // unbounded.
    if (screenshots.length > MAX_SCREENSHOTS) {
      return NextResponse.json(
        { error: `screenshots array exceeds the maximum of ${MAX_SCREENSHOTS} entries (got ${screenshots.length})` },
        { status: 400 },
      );
    }
    for (let i = 0; i < screenshots.length; i++) {
      const dataUri = typeof screenshots[i]?.dataUri === 'string' ? screenshots[i].dataUri : '';
      if (!dataUri.startsWith('data:image/')) {
        return NextResponse.json(
          { error: `screenshots[${i}].dataUri must be a data:image/* URI` },
          { status: 400 },
        );
      }
      const b64Len = (dataUri.split(',')[1] ?? '').length;
      if (b64Len > MAX_SCREENSHOT_BASE64_CHARS) {
        return NextResponse.json(
          { error: `screenshots[${i}] exceeds the per-image limit of ${MAX_SCREENSHOT_BASE64_CHARS} base64 chars (~3MB decoded)` },
          { status: 400 },
        );
      }
    }

    // R165 (VLM-004): /tmp debug dump is now gated behind VLM_DEBUG_DUMP=1.
    // Previously it wrote unconditionally on every request — concurrent
    // requests stacked files and could be abused to fill /tmp. Default
    // (env unset): zero filesystem writes.
    let debugDumpPattern: string | null = null;
    if (process.env.VLM_DEBUG_DUMP === '1') {
      try {
        const { writeFileSync, readdirSync, unlinkSync } = await import('node:fs');
        // Keep only the newest batch (R162 bound — at most one batch exists).
        for (const f of readdirSync('/tmp').filter(f => f.startsWith('qa_screenshot_'))) {
          try { unlinkSync('/tmp/' + f); } catch { /* ignore */ }
        }
        const stamp = Date.now();
        for (let i = 0; i < Math.min(screenshots.length, MAX_SCREENSHOTS); i++) {
          const s = screenshots[i];
          if (s?.dataUri?.startsWith('data:image/png;base64,')) {
            const b64 = s.dataUri.split(',')[1] ?? '';
            writeFileSync(`/tmp/qa_screenshot_${stamp}_${i}_${s.angle || 'x'}.png`, Buffer.from(b64, 'base64'));
          }
        }
        writeFileSync(`/tmp/qa_screenshot_${stamp}_meta.json`, JSON.stringify({ recipe, n: screenshots.length }));
        debugDumpPattern = `/tmp/qa_screenshot_${stamp}_*`;
        console.log(`[vlm/select-best] VLM_DEBUG_DUMP=1 — dumped ${Math.min(screenshots.length, MAX_SCREENSHOTS)} screenshots to ${debugDumpPattern}`);
      } catch { /* debug only */ }
    }

    if (screenshots.length === 1) {
      // Only one screenshot — no need to call VLM, just return it
      return NextResponse.json({
        bestIndex: 0,
        commentary: 'Only one screenshot available — auto-selected.',
        recipe,
        vlmSignal: 'skipped',
      });
    }

    // Dynamically import z-ai-web-dev-sdk (backend-only)
    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    const zai = await ZAI.create();

    // Build the VLM prompt based on the recipe type
    const recipeContext = getRecipeContext(recipe);
    // R167 (VLM-009): sanitize the (untrusted, tool-result-shaped) summary
    // BEFORE it touches the prompt or the residue extractor — flattened,
    // injection-scrubbed, and truncated to 800 chars.
    const safeSummary = sanitizeAnalysisSummary(analysisSummary);
    // Round 73: Extract key residues from analysis summary for VLM reference
    const residueInfo = extractResidueInfo(safeSummary);
    const residueText = residueInfo ? `\n\n关键残基信息（请在评语中引用这些残基名称）：\n${residueInfo}` : '';

    const defaultPrompt = `你是一位结构生物学专家。请查看以下${screenshots.length}张蛋白质3D结构截图，它们分别从不同角度（${screenshots.map(s => s.angle).join('、')}）拍摄。

分析背景：${safeSummary || recipeContext}${residueText}

请选择最能清晰展示"${recipeContext}"的那张截图。考虑以下因素：
1. 关键结构特征是否清晰可见
2. 配体/残基/互作是否没有被遮挡
3. 构图是否平衡、视觉上是否易于理解
4. 关键残基（如催化残基、口袋残基）是否在视野中可见

请以JSON格式回复（不要其他内容）：
{"bestIndex": <0-based索引>, "reason": "<简短中文说明为什么选择这张，引用具体残基名称>", "scores": [<截图1分数>, <截图2分数>, ...], "confidence": "<high|medium|low>", "comments": ["<截图1的15-30字中文评语>", "<截图2的评语>", ...], "quality": "<acceptable|degraded|unacceptable>", "issues": ["<截图1的问题>", "<截图2的问题>"], "recaptureHints": {"angles": ["<建议角度>"], "focus": "<interface|ligand|residue|chain>", "zoom": "<in|out>"}}

每张截图的分数为1-10的整数，10分最佳。评分标准：
- 结构特征清晰可见程度 (0-4分)
- 关键信息未被遮挡 (0-3分)
- 构图平衡和视觉清晰度 (0-3分)

confidence表示你对最佳选择的确信程度：
- high: 最佳截图明显优于其他（分数差距 ≥3）
- medium: 最佳截图较好但差距不大（分数差距 1-2）
- low: 截图质量相近，难以区分（分数差距 0）

comments数组必须为每张截图提供一条15-30字的中文评语，描述该截图所展示的具体结构特征（引用残基名称/链/配体），不要泛泛而谈。

quality字段表示截图整体质量：
- "acceptable": 截图清晰展示了分析目标（侧链可见、氢键连线可见、结构未被遮挡）
- "degraded": 截图部分可用但存在问题（如侧链未显示、连线缺失、角度不佳）
- "unacceptable": 截图无法用于分析（黑屏、结构不可见、完全遮挡）

issues数组列出每张截图存在的具体问题（用中文），例如：
- "侧链未显示（ball-and-stick缺失）"
- "氢键连线（虚线）未显示"
- "关键残基被遮挡"
- "结构太远/太近"
- "黑屏或空白"

recaptureHints对象提供重新截图的建议（当quality为degraded或unacceptable时）：
- angles: 建议尝试的角度（如["side","top"]）
- focus: 建议聚焦目标（"interface"/"ligand"/"residue"/"chain"）
- zoom: 建议缩放方向（"in"/"out"）

特别注意：对于互作分析（hbonds/salt_bridges/all_interactions/ligand_interactions），必须验证：
1. 侧链是否以ball-and-stick方式显示（彩色的小球和棍子）
2. 氢键/互作连线是否以虚线显示
3. 关键残基是否有标签标注
如果这些元素缺失，quality应设为degraded或unacceptable，并在issues中说明。

重要：quality、issues和recaptureHints字段是必需的，不能省略：
- quality: 必须为"acceptable"、"degraded"或"unacceptable"之一
- issues: 即使quality为acceptable，也要为每张截图提供一个issue条目（可写"无问题"）
- recaptureHints: 即使quality为acceptable，也要提供（可写默认值{"angles":["front","side","top"],"focus":"ligand","zoom":"in"}）
- 如果截图质量完美，quality设为acceptable，issues每项写"无问题"，recaptureHints写默认值`;

    const userPrompt = prompt || defaultPrompt;

    // Build the VLM message with all screenshots
    const content: Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    > = [{ type: 'text', text: userPrompt }];

    for (let i = 0; i < screenshots.length; i++) {
      const s = screenshots[i];
      content.push({
        type: 'text',
        text: `\n--- 截图 ${i + 1}（角度: ${s.angle}）---`,
      });
      content.push({
        type: 'image_url',
        image_url: { url: s.dataUri },
      });
    }

    // R163: VLM rate-limit handling — on 429 (or transient network failure),
    // retry with exponential backoff 5s / 15s / 45s instead of failing fast.
    // Previously a single 429 aborted the whole visual-verification pass.
    const isRateLimitError = (err: unknown): boolean => {
      const e = err as { status?: number; statusCode?: number; message?: string; code?: number };
      if (e?.status === 429 || e?.statusCode === 429 || e?.code === 429) return true;
      const msg = String(e?.message ?? '');
      return /429|rate.?limit|too many requests/i.test(msg);
    };
    const isTransientError = (err: unknown): boolean => {
      // R165 (VLM-005): aborts from the per-attempt timeout surface as
      // DOMExceptions whose name (not message) carries the signal — they
      // must count as retryable or a single hung call exhausts the budget.
      const name = String((err as { name?: string })?.name ?? '');
      if (name === 'AbortError' || name === 'TimeoutError') return true;
      const msg = String((err as { message?: string })?.message ?? '');
      return /timeout|etimedout|econnreset|econnrefused|socket hang up|network|fetch failed|aborted/i.test(msg);
    };

    const VLM_BACKOFF_SCHEDULE_MS = [5_000, 15_000, 45_000]; // 5s / 15s / 45s
    const vlmStartTime = Date.now();
    let response: Awaited<ReturnType<typeof zai.chat.completions.createVision>> | null = null;
    let lastError: unknown = null;
    // Note: `model` is omitted so the backend picks its default vision model
    // (same behavior as before R163) — hence the `as never` cast below.
    const visionBody = {
      messages: [
        {
          role: 'user' as const,
          content,
        },
      ],
      thinking: { type: 'disabled' as const },
    };
    // R164 (VLM-002): build an inner AbortController chained to the
    // request signal so a client disconnect propagates to BOTH the
    // backoff timer (interruptible sleep) AND the underlying VLM call.
    // Previously the backoff timer used `setTimeout` with no signal and
    // the createVision() call had no AbortSignal — a client that
    // navigated away 30s into the schedule still caused the server to
    // fire up to 4 VLM calls, paying full token cost while the client
    // showed a stale "未经视觉验证" badge.
    const innerController = new AbortController();
    const onReqAbort = () => innerController.abort();
    req.signal.addEventListener('abort', onReqAbort);
    try {
      for (let attempt = 0; attempt <= VLM_BACKOFF_SCHEDULE_MS.length; attempt++) {
        // Check abort BEFORE each attempt — short-circuits the whole
        // retry schedule if the client disconnects mid-backoff.
        if (req.signal.aborted || innerController.signal.aborted) {
          throw new DOMException('Client disconnected — VLM call aborted', 'AbortError');
        }
        // R165 (VLM-005): per-attempt signal = request-level signal (R164
        // innerController, covers client disconnect) + a 55s single-call
        // timeout. Previously a createVision that hung ≥60s per attempt
        // blew the maxDuration=300 budget on the 4th retry; the timeout
        // abort is classified as transient → counts against the same
        // backoff/retry sequence as 429s.
        const attemptSignal = combineAbortSignals(
          innerController.signal,
          AbortSignal.timeout(VLM_SINGLE_CALL_TIMEOUT_MS),
        );
        try {
          // R164 (VLM-002): pass signal to the SDK call. If the SDK
          // respects it, the in-flight HTTP request is cancelled
          // immediately on client disconnect (no token spend).
          response = await (zai.chat.completions.createVision as unknown as (
            (body: unknown, opts?: { signal?: AbortSignal }) => Promise<typeof response>
          ))(visionBody, { signal: attemptSignal });
          break;
        } catch (err) {
          // If the abort signal fired, stop retrying immediately.
          if (innerController.signal.aborted || req.signal.aborted) {
            throw new DOMException('Client disconnected — VLM call aborted', 'AbortError');
          }
          lastError = err;
          const retryable = isRateLimitError(err) || isTransientError(err);
          if (!retryable || attempt === VLM_BACKOFF_SCHEDULE_MS.length) {
            // non-retryable, or backoff schedule exhausted
            throw err;
          }
          const baseMs = VLM_BACKOFF_SCHEDULE_MS[attempt]!;
          // R164 (VLM-008): jitter the backoff by 0-500ms so concurrent
          // captures retrying in lockstep don't thundering-herd the VLM.
          const waitMs = baseMs + Math.floor(Math.random() * 500);
          console.warn(
            `[vlm/select-best] attempt ${attempt + 1} failed (${isRateLimitError(err) ? '429 rate limit' : 'transient error'}) — ` +
            `retrying in ${(waitMs / 1000).toFixed(1)}s (${VLM_BACKOFF_SCHEDULE_MS.length - attempt} retries left)`
          );
          // R164 (VLM-002): interruptible sleep — rejects immediately if
          // the abort signal fires during the wait.
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(() => {
              innerController.signal.removeEventListener('abort', onTimeoutAbort);
              resolve();
            }, waitMs);
            const onTimeoutAbort = () => {
              clearTimeout(t);
              reject(new DOMException('Client disconnected — backoff aborted', 'AbortError'));
            };
            innerController.signal.addEventListener('abort', onTimeoutAbort, { once: true });
          });
        }
      }
    } finally {
      req.signal.removeEventListener('abort', onReqAbort);
      // Don't abort the controller here if response succeeded — the
      // call already completed.
    }
    if (!response) {
      throw lastError ?? new Error('VLM call failed without response');
    }
    if (Date.now() - vlmStartTime > 30_000) {
      console.log(`[vlm/select-best] VLM call took ${((Date.now() - vlmStartTime) / 1000).toFixed(1)}s (incl. backoff retries)`);
    }

    const vlmResponse = response.choices?.[0]?.message?.content || '';

    // Parse the VLM response to extract bestIndex + scores + confidence + comments
    let bestIndex = 0;
    let commentary = vlmResponse;
    let scores: number[] = [];
    let confidence: 'high' | 'medium' | 'low' = 'medium';
    let comments: string[] = [];
    let quality: 'acceptable' | 'degraded' | 'unacceptable' = 'acceptable';
    let issues: string[] = [];
    let recaptureHints: { angles?: string[]; focus?: string; zoom?: 'in' | 'out' } = {};

    // R165 (VLM-007): explicit signal distinguishing "the VLM chose this
    // bestIndex" from "parsing failed and bestIndex defaulted" — previously
    // both cases returned bestIndex=0 with no way for the caller to tell.
    let vlmSignal: 'ok' | 'parse-failed' = 'ok';

    // R165 (VLM-007): robust extraction — ```json fenced block first, then
    // a balanced-brace scan (handles braces inside JSON strings). Replaces
    // the old greedy regex /\{[\s\S]*\}/ which spanned the first '{' to
    // the LAST '}' and broke on markdown-wrapped / multi-block responses.
    const jsonText = extractFirstJsonObject(vlmResponse);
    let parsedOk = false;
    if (jsonText) {
      try {
        const parsed = JSON.parse(jsonText);
        if (typeof parsed.bestIndex === 'number' && parsed.bestIndex >= 0 && parsed.bestIndex < screenshots.length) {
          bestIndex = parsed.bestIndex;
        }
        if (parsed.reason) {
          commentary = parsed.reason;
        }
        // Round 64: Extract quality scores (1-10 per screenshot)
        if (Array.isArray(parsed.scores)) {
          scores = parsed.scores
            .map((s: unknown) => typeof s === 'number' ? s : parseInt(String(s), 10))
            .filter((s: number) => !isNaN(s) && s >= 1 && s <= 10)
            .slice(0, screenshots.length);
        }
        // Round 65: Extract confidence level
        if (typeof parsed.confidence === 'string') {
          const c = parsed.confidence.toLowerCase();
          if (c === 'high' || c === 'medium' || c === 'low') {
            confidence = c;
          }
        }
        // Round 95: Extract per-image comments array
        if (Array.isArray(parsed.comments)) {
          comments = parsed.comments
            .map((c: unknown) => typeof c === 'string' ? c : String(c ?? ''))
            .filter((c: string) => c.length > 0)
            .slice(0, screenshots.length);
        }
        // Round 98: Extract quality assessment
        if (typeof parsed.quality === 'string') {
          const q = parsed.quality.toLowerCase();
          if (q === 'acceptable' || q === 'degraded' || q === 'unacceptable') {
            quality = q;
          }
        }
        // Round 98: Extract per-image issues
        if (Array.isArray(parsed.issues)) {
          issues = parsed.issues
            .map((i: unknown) => typeof i === 'string' ? i : String(i ?? ''))
            .filter((i: string) => i.length > 0)
            .slice(0, screenshots.length);
        }
        // Round 98: Extract recapture hints
        if (parsed.recaptureHints && typeof parsed.recaptureHints === 'object') {
          const rh = parsed.recaptureHints as Record<string, unknown>;
          if (Array.isArray(rh.angles)) {
            recaptureHints.angles = (rh.angles as unknown[])
              .map((a) => String(a ?? ''))
              .filter((a: string) => ['front', 'side', 'top', 'back'].includes(a));
          }
          if (typeof rh.focus === 'string') {
            recaptureHints.focus = rh.focus as string;
          }
          if (typeof rh.zoom === 'string') {
            recaptureHints.zoom = rh.zoom as 'in' | 'out';
          }
        }
        parsedOk = true;
      } catch {
        // JSON.parse (or field extraction) failed — fall through to the
        // parse-failed branch below (same defaults as the old silent catch,
        // but now with an explicit signal + warn log instead of silence).
      }
    }
    if (!parsedOk) {
      vlmSignal = 'parse-failed';
      console.warn(
        `[vlm/select-best] VLM response was not parseable JSON — bestIndex defaulted. ` +
        `Raw response (truncated to 500 chars): ${vlmResponse.slice(0, 500)}`
      );
      // Legacy fallback: try to find a number in the response that could be the index
      const numMatch = vlmResponse.match(/(\d+)/);
      if (numMatch) {
        const num = parseInt(numMatch[1], 10);
        if (num >= 1 && num <= screenshots.length) {
          bestIndex = num - 1; // 1-based to 0-based
        }
      }
    }

    // R101.5: Validate VLM fields — if quality is missing, infer from scores
    if (!quality || quality === 'acceptable') {
      // If we have scores, infer quality from the best score
      if (scores.length > 0) {
        const bestScore = Math.max(...scores);
        const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
        if (bestScore < 3 || avgScore < 3) {
          quality = 'unacceptable';
        } else if (bestScore < 5 || avgScore < 5) {
          quality = 'degraded';
        } else {
          quality = 'acceptable';
        }
      }
    }
    // R101.5: If issues is empty but quality is not acceptable, add a generic issue
    if (quality !== 'acceptable' && issues.length === 0) {
      issues = screenshots.map(() =>
        quality === 'unacceptable'
          ? '截图质量不佳，可能存在显示问题'
          : '截图质量一般，部分元素可能不清晰'
      );
    }
    // R101.5: If issues is empty and quality is acceptable, fill with '无问题'
    if (quality === 'acceptable' && issues.length === 0) {
      issues = screenshots.map(() => '无问题');
    }
    // R101.5: If recaptureHints is empty, provide defaults
    if (Object.keys(recaptureHints).length === 0) {
      recaptureHints = {
        angles: ['front', 'side', 'top'],
        focus: 'ligand',
        zoom: 'in',
      };
    }

    return NextResponse.json({
      bestIndex,
      commentary,
      scores,
      confidence,
      comments,
      quality,
      issues,
      recaptureHints,
      recipe,
      vlmResponse,
      // R165 (VLM-007): 'ok' = VLM chose bestIndex; 'parse-failed' = JSON
      // extraction failed and bestIndex defaulted — callers can surface
      // the difference instead of trusting a silent bestIndex=0.
      vlmSignal,
      // R165 (VLM-004): dump location when VLM_DEBUG_DUMP=1 is set (null otherwise).
      debugDump: debugDumpPattern ?? undefined,
    });
  } catch (error: any) {
    console.error('[vlm/select-best] Error:', error);
    return NextResponse.json(
      {
        error: 'VLM analysis failed: ' + (error?.message || 'unknown'),
        bestIndex: 0, // fallback to first screenshot
        commentary: 'VLM analysis failed — auto-selected first screenshot.',
      },
      { status: 500 }
    );
  }
}

/** Get a human-readable description of what the recipe analyzes. */
function getRecipeContext(recipe: string): string {
  const contexts: Record<string, string> = {
    binding_pocket: '结合口袋分析 — 配体周围的残基、口袋体积和组成',
    druggability: '可成药性评估 — 口袋的药物可及性和成药潜力',
    all_interactions: '全互作分析 — 链间氢键、盐桥和疏水接触',
    hbonds: '氢键分析 — 供体-受体间的氢键网络',
    salt_bridges: '盐桥分析 — 正负电荷残基间的离子相互作用',
    hydrophobic_contacts: '疏水接触分析 — 疏水残基间的相互作用',
    ligand_interactions: '配体互作指纹 — 配体周围的所有接触类型',
    disulfide_bonds: '二硫键分析 — CYS-CYS之间的共价连接',
    metal_coordination: '金属配位分析 — 金属离子与配位残基',
    aromatic_stacking: '芳香堆积分析 — π-π和cation-π堆积',
    water_bridges: '水桥分析 — 蛋白-水-蛋白氢键网络',
    sasa: '溶剂可及面积分析 — 残基的表面暴露程度',
    electrostatic: '静电势分析 — 残基电荷和静电能',
    apbs_electrostatic: 'APBS静电势分析 — Poisson-Boltzmann表面静电',
    virtual_screening: '虚拟筛选结果 — Top命中片段在口袋中的对接构象',
    druglike_screening: '类药性虚拟筛选 — 类药分子对接和ADMET',
    interface_residues: '界面残基分析 — 链间接触面上的残基',
    secondary_structure_simple: '二级结构分析 — α螺旋/β折叠/无规卷曲分布',
    bfactor_stats: 'B因子分析 — 原子温度因子分布',
    rmsd: 'RMSD分析 — 链间结构偏差',
    detect_pockets: '口袋检测 — 网格法检测的所有可及口袋',
    oligomer_analysis: '寡聚体分析 — 组装状态和对称性',
    surface_residues: '表面残基分析 — 表面vs埋藏残基',
    conformational_changes: '构象变化分析 — 柔性区域识别',
    protonation_states: '质子化状态分析 — 可电离残基的质子化',
    summary: '结构摘要 — 链/残基/原子计数和配体列表',
  };
  return contexts[recipe] || `结构分析结果 (${recipe})`;
}

/**
 * Round 73: Extract key residue information from the analysis summary text.
 * The analysis summary is a JSON string containing recipe results. This function
 * parses it and extracts residue names/numbers that the VLM can reference.
 *
 * Extracts:
 * - Pocket residues (from binding_pocket results)
 * - Catalytic residues (CYS/HIS dyads)
 * - Top interaction residues (from hbonds/salt_bridges)
 * - Ligand name
 *
 * Returns a formatted string or null if no residues found.
 */
function extractResidueInfo(summary: string): string | null {
  try {
    // The summary is a JSON string — try to parse it
    let data: any;
    try {
      data = JSON.parse(summary);
    } catch {
      // Not JSON — try to extract residue patterns from plain text.
      // R167 (VLM-010): the old `[A-Z]{3}\d+\([A-Z]\)` regex hard-required a
      // single-character chain suffix, so outputs using other real-world
      // shapes — multi-char auth chain ids like "LEU12(AB)", or bare
      // "GLU35" with no suffix at all — silently fell through to null.
      // Now: chain suffix optional, 1-4 alphanumerics, both
      // "RES123(Chain)" and "RES123" match; results are de-duplicated
      // and capped at 10.
      const residuePattern = /([A-Z]{3})(\d+)(?:\(([A-Za-z0-9]{1,4})\))?/g;
      const seenResidues = new Set<string>();
      const residues: string[] = [];
      for (const m of summary.matchAll(residuePattern)) {
        const formatted = m[3] ? `${m[1]}${m[2]}(${m[3]})` : `${m[1]}${m[2]}`;
        if (!seenResidues.has(formatted)) {
          seenResidues.add(formatted);
          residues.push(formatted);
        }
        if (residues.length >= 10) break;
      }
      if (residues.length > 0) {
        return `检测到的残基: ${residues.join(', ')}`;
      }
      return null;
    }

    const lines: string[] = [];

    // Extract from binding_pocket
    if (data.bindingPocket || data.binding_pocket) {
      const bp = data.bindingPocket || data.binding_pocket;
      if (bp.ligand) lines.push(`配体: ${bp.ligand}`);
      if (bp.topResidues && Array.isArray(bp.topResidues)) {
        lines.push(`口袋残基: ${bp.topResidues.slice(0, 8).join(', ')}`);
      }
      if (bp.catalyticResidues && Array.isArray(bp.catalyticResidues) && bp.catalyticResidues.length > 0) {
        lines.push(`催化残基: ${bp.catalyticResidues.join(', ')}`);
      }
    }

    // Extract from residues array (binding_pocket format)
    if (data.residues && Array.isArray(data.residues)) {
      const topRes = data.residues.slice(0, 8).map((r: any) =>
        `${r.resname || '?'}${r.resno || '?'}(${r.chain || '?'})`
      );
      if (topRes.length > 0) lines.push(`口袋残基: ${topRes.join(', ')}`);
    }

    // Extract from hbonds
    if (data.hbonds && Array.isArray(data.hbonds)) {
      const hbondRes = data.hbonds.slice(0, 5).map((h: any) =>
        `${h.donor_resname || '?'}${h.donor_resno || '?'} → ${h.acceptor_resname || '?'}${h.acceptor_resno || '?'}`
      );
      if (hbondRes.length > 0) lines.push(`氢键残基对: ${hbondRes.join(', ')}`);
    }

    // Extract from salt_bridges
    if (data.salt_bridges && Array.isArray(data.salt_bridges)) {
      const sbRes = data.salt_bridges.slice(0, 5).map((s: any) =>
        `${s.pos_resname || '?'}${s.pos_resno || '?'}(+) ↔ ${s.neg_resname || '?'}${s.neg_resno || '?'}(−)`
      );
      if (sbRes.length > 0) lines.push(`盐桥残基对: ${sbRes.join(', ')}`);
    }

    // Extract from all_interactions
    if (data.interactions && Array.isArray(data.interactions)) {
      const aiRes = data.interactions.slice(0, 5).map((i: any) =>
        `${i.resname1 || '?'}${i.resno1 || '?'} ↔ ${i.resname2 || '?'}${i.resno2 || '?'}`
      );
      if (aiRes.length > 0) lines.push(`互作残基对: ${aiRes.join(', ')}`);
    }

    // Extract ligand name
    if (data.ligand) lines.push(`配体: ${data.ligand}`);

    return lines.length > 0 ? lines.join('\n') : null;
  } catch {
    return null;
  }
}
