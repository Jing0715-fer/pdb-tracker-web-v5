export interface BlastHit { pdbId: string; uniprotRef: string; description: string; identity: number; evalue: string; queryCoverage: number; targetCoverage?: number; taxonomyId?: string; isParalog?: boolean; }

/// Identity threshold for classifying a BLAST hit as a "direct homolog
/// (paralog)" vs. a "structural homolog (fold-level)" hit. Hits with
/// identity ≥ this value are likely the same protein / a very close
/// paralog and can be treated as direct structural references rather
/// than remote fold matches. Default 95% is the conventional "same
/// protein" cutoff in structural-biology annotation.
export const PARALOG_IDENTITY_THRESHOLD = 95;
const BLAST_URL = 'https://blast.ncbi.nlm.nih.gov/blast/Blast.cgi';

// NCBI BLAST URL — kept identical to BLAST_URL above; deliberately not split
// into per-database endpoints so we don't lose the simpler retry path.

interface BlastDbConfig {
  /** Min ms between polls (the actual sleep is max(this, rtoe*1000)). */
  minPollIntervalMs: number;
  /** Per-attempt fetch timeout, ms. */
  fetchTimeoutMs: number;
  /** Max retries on transient 'fetch failed' / network errors per poll cycle. */
  maxFetchRetries: number;
}

const BLAST_DB_CONFIG: Record<string, BlastDbConfig> = {
  // pdbaa is small (~700 MB) and normally runs in seconds, but NCBI queue
  // times vary wildly — we poll until the result is ready (no attempt cap).
  pdbaa: { minPollIntervalMs: 3000, fetchTimeoutMs: 30_000, maxFetchRetries: 2 },
  // nr is the entire non-redundant protein set (~80 GB); queries against it
  // routinely take 1–3 minutes on NCBI's side, and the server occasionally
  // returns transient network errors / 'fetch failed' under load. We poll
  // patiently with aggressive per-fetch retries until the result is ready.
  nr:    { minPollIntervalMs: 10_000, fetchTimeoutMs: 60_000, maxFetchRetries: 5 },
};

const DEFAULT_DB_CONFIG: BlastDbConfig = { minPollIntervalMs: 5000, fetchTimeoutMs: 30_000, maxFetchRetries: 3 };

/** R196: 信号元数据齐全时毫秒上限墙钟 —— 无 signal 的经典管线调用方
 *  （run/route.ts 四处）在 NCBI 持续 503/429 时旧版会永久轮询；15 分钟
 *  远超真实最长等待（pdbaa 拥挤实测 ~3 分钟），只兑底不死循环。 */
const MAX_POLL_WALL_MS = 15 * 60_000;

/** R196: 可中止 sleep —— Stop 信号即刻生效（旧版 sleep 不感知 signal，
 *  首轮 RTOE 等待可达 10-60s，Stop 延迟远超「一个轮询间隔」的承诺）。 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('aborted', 'AbortError')); return; }
    const onAbort = () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); };
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** R196: 合并调用方 signal 与超时（沿用 llm.ts withSdkTimeout 的手动
 * controller 接线模式 —— 不依赖 Node 20.3+ 的 AbortSignal.any）。
 * 导出供 rcsb.ts / collect.ts / figures.ts 等数据层共用（Stop 全链路即刻生效）。 */
export function combineSignals(callerSignal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException(`timeout after ${timeoutMs}ms`, 'TimeoutError')), timeoutMs);
  const onCallerAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort(callerSignal.reason);
    else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    },
  };
}

/** Fetch a URL with bounded retries on transient 'fetch failed' / network errors. */
async function fetchWithRetry(url: string, opts: RequestInit, cfg: BlastDbConfig, signal?: AbortSignal): Promise<Response> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= cfg.maxFetchRetries; attempt++) {
    // R196: 调用方 Stop 与每请求超时合并 —— 旧版只挂 AbortSignal.timeout，
    // Stop 只能在当前 in-flight fetch 自然结束后才生效（nr 最长 60s）。Stop
    // 中止的 fetch 会抛 AbortError，与重试语义区分后直接上抛。
    const combo = combineSignals(signal, cfg.fetchTimeoutMs);
    try {
      return await fetch(url, { ...opts, signal: combo.signal });
    } catch (err: any) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      lastErr = err;
      // undici / Node fetch wraps network errors as 'fetch failed' (TypeError)
      // or 'network error' / 'aborted'. Treat all as retryable.
      const msg = String(err?.message ?? err);
      const retryable = /fetch failed|network|aborted|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up/i.test(msg);
      if (!retryable || attempt === cfg.maxFetchRetries) throw err;
      const backoff = Math.min(15_000, 1000 * 2 ** attempt);
      await sleep(backoff);
    } finally {
      combo.dispose();
    }
  }
  throw lastErr;
}

/**
 * Run BLASTp against a specified NCBI database.
 * @param sequence Amino acid sequence
 * @param maxHits Maximum number of hits
 * @param database NCBI database name ('pdbaa' for PDB, 'nr' for non-redundant)
 * @param onProgress Optional progress callback
 * @param signal R195: 可选中止信号 —— NCBI 队列拥挤时 pdbaa 可轮询 3+ 分钟，
 *   旧实现 while(true) 无信号检查，Stop 后最长无效数分钟（两段式架构下
 *   Stop 语义明确，此缺口被实测暴露）。每轮轮询前检查一次，延迟 ≤ 一个
 *   轮询间隔（~5s）。
 */
export async function runBlastDb(sequence: string, maxHits = 20, database = 'pdbaa', onProgress?: (msg: string) => void, signal?: AbortSignal): Promise<BlastHit[]> {
  const cfg = BLAST_DB_CONFIG[database] ?? DEFAULT_DB_CONFIG;
  if (!sequence || sequence.length < 30) { onProgress?.('序列过短（<30 aa），跳过 BLAST'); return []; }
  onProgress?.(`提交 BLASTp 任务到 NCBI (数据库: ${database})…`);
  const submitBody = new URLSearchParams({ CMD: 'Put', PROGRAM: 'blastp', DATABASE: database, QUERY: sequence, HITLIST_SIZE: String(maxHits), EXPECT: '1e-5', FILTER: 'F' });
  const submitRes = await fetchWithRetry(BLAST_URL, { method: 'POST', body: submitBody }, cfg, signal);
  if (!submitRes.ok) throw new Error(`BLAST submit ${submitRes.status}`);
  const submitText = await submitRes.text();
  const ridMatch = submitText.match(/RID\s*=\s*(\S+)/);
  const rtoeMatch = submitText.match(/RTOE\s*=\s*(\d+)/);
  if (!ridMatch) throw new Error('BLAST submit: no RID returned');
  const rid = ridMatch[1];
  const rtoe = parseInt(rtoeMatch?.[1] || '10', 10);
  onProgress?.(`BLAST 已提交 (RID=${rid}, 预计 ${rtoe}s)`);
  // Poll indefinitely until NCBI returns a result, a hard error (FAILED /
  // UNKNOWN), or the caller aborts the request. The previous implementation
  // capped at `cfg.maxAttempts` (30 for pdbaa), which caused legitimate
  // long-running queries — NCBI queue congestion can push pdbaa to 3+ min —
  // to be reported as "timed out" even though the job was still running
  // and would have completed. Removing the cap means we wait as long as
  // NCBI keeps the RID alive. Progress messages report elapsed time so the
  // user can see the job is still being polled.
  let attempts = 0;
  const startedAt = Date.now();
  while (true) {
    // R195: Stop 检查点 —— 每轮轮询前检查。
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    // R196: 墙钟上限 —— 无 signal 的调用方（经典管线）在 NCBI 持续
    // 503/429 时旧版永久轮询；有 signal 时由 Stop 端点兜底。
    if (Date.now() - startedAt > MAX_POLL_WALL_MS) {
      throw new Error(`BLAST 轮询超过 ${Math.round(MAX_POLL_WALL_MS / 60000)} 分钟墙钟上限（RID=${rid}）`);
    }
    // First poll: respect RTOE. Subsequent: cap at minPollIntervalMs so we
    // don't hammer NCBI when RTOE was small but the actual job is still running.
    const waitMs = attempts === 0 ? rtoe * 1000 : cfg.minPollIntervalMs;
    // R196: sleep 可中止 —— Stop 在等待期即刻生效（旧版需等完 RTOE/间隔）。
    await sleep(waitMs, signal);
    attempts++;
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    onProgress?.(`轮询 BLAST 结果 (第 ${attempts} 次, 已等待 ${elapsedSec}s)…`);
    let pollRes: Response;
    try {
      pollRes = await fetchWithRetry(`${BLAST_URL}?CMD=Get&FORMAT_TYPE=XML&RID=${rid}`, {}, cfg, signal);
    } catch (err: any) {
      if (signal?.aborted || err?.name === 'AbortError') throw new DOMException('aborted', 'AbortError');
      // Transient network error — log and keep polling. NCBI occasionally
      // returns 'fetch failed' under load; we never give up on these.
      onProgress?.(`轮询网络抖动：${err?.message ?? err}（已等待 ${elapsedSec}s，继续轮询）`);
      continue;
    }
    if (!pollRes.ok) {
      // Non-200 HTTP status — usually transient (503 service unavailable).
      // Keep polling rather than aborting the whole BLAST run.
      onProgress?.(`轮询返回 HTTP ${pollRes.status}（已等待 ${elapsedSec}s，继续轮询）`);
      continue;
    }
    const xml = await pollRes.text();
    if (xml.includes('<BlastOutput>') || xml.includes('<BlastOutput_iterations>')) {
      const totalSec = Math.round((Date.now() - startedAt) / 1000);
      onProgress?.(`BLAST 完成（共 ${totalSec}s，${attempts} 次轮询），解析结果…`);
      const raw = parseBlastXml(xml, database as 'pdbaa' | 'nr');
      // Dedup (same PDB can appear multiple times — one entry per chain
      // / per HSP region) and classify each hit as direct homolog vs
      // structural homolog before returning. Downstream code consumes
      // the cleaned, labeled set.
      const cleaned = dedupBlastHits(raw);
      classifyBlastHits(cleaned);
      return cleaned;
    }
    if (xml.includes('Status=FAILED')) throw new Error('BLAST job failed on NCBI side');
    if (xml.includes('Status=UNKNOWN')) throw new Error(`BLAST RID ${rid} unknown (expired?)`);
    // Status=WAITING (still running) — fall through and keep polling.
  }
}

/** Backward-compatible wrapper: BLASTp against pdbaa (PDB database). */
export async function runBlast(sequence: string, maxHits = 20, onProgress?: (msg: string) => void, signal?: AbortSignal): Promise<BlastHit[]> {
  return runBlastDb(sequence, maxHits, 'pdbaa', onProgress, signal);
}

function parseBlastXml(xml: string, database: 'pdbaa' | 'nr' = 'pdbaa'): BlastHit[] {
  const hits: BlastHit[] = [];
  const hitRe = /<Hit>([\s\S]*?)<\/Hit>/g;
  let m: RegExpExecArray | null;
  while ((m = hitRe.exec(xml))) {
    const h = m[1];
    const def = h.match(/<Hit_def>([\s\S]*?)<\/Hit_def>/)?.[1]?.trim() || '';
    const acc = h.match(/<Hit_accession>([\s\S]*?)<\/Hit_accession>/)?.[1]?.trim() || '';
    if (!acc) continue;
    // PDB IDs are 4 chars: 1 digit + 3 alphanumeric. Only extract from pdbaa
    // (real PDB database). For 'nr' (non-redundant protein), accession is a
    // UniProt ref like XP_044355816 or KAF7035568.1 — extracting the first
    // 4 chars produces FAKE pdbIds (e.g. "XP_0", "KAF7") that pollute the
    // pdbDetails list. So we leave pdbId empty for nr hits and rely on
    // UniProt → PDB lookup downstream.
    let pdbId = '';
    if (database === 'pdbaa') {
      const pdbIdMatch = acc.match(/^([0-9][A-Za-z0-9]{3})([A-Za-z]?)/);
      pdbId = pdbIdMatch ? pdbIdMatch[1] : acc.slice(0, 4);
    }
    const firstHsp = /<Hsp>([\s\S]*?)<\/Hsp>/.exec(h);
    let identity = 0; let evalue = '0'; let queryCoverage = 0;
    if (firstHsp) {
      const hsp = firstHsp[1];
      const identityRaw = parseFloat(hsp.match(/<Hsp_identity>([\s\S]*?)<\/Hsp_identity>/)?.[1] || '0');
      const alignLen = parseFloat(hsp.match(/<Hsp_align-len>([\s\S]*?)<\/Hsp_align-len>/)?.[1] || '1');
      identity = alignLen > 0 ? (identityRaw / alignLen) * 100 : 0;
      evalue = hsp.match(/<Hsp_evalue>([\s\S]*?)<\/Hsp_evalue>/)?.[1]?.trim() || '0';
      const queryFrom = parseInt(hsp.match(/<Hsp_query-from>([\s\S]*?)<\/Hsp_query-from>/)?.[1] || '0', 10);
      const queryTo = parseInt(hsp.match(/<Hsp_query-to>([\s\S]*?)<\/Hsp_query-to>/)?.[1] || '0', 10);
      queryCoverage = queryTo > queryFrom ? queryTo - queryFrom + 1 : 0;
    }
    hits.push({ pdbId, uniprotRef: acc, description: def, identity: Math.round(identity * 10) / 10, evalue, queryCoverage });
  }
  return hits;
}

/**
 * Deduplicate BLAST hits by (pdbId, uniprotRef). The same PDB can appear
 * multiple times in a single BLAST report — one entry per chain / per
 * HSP region / per alternative transcript — and we only want to keep
 * the best (highest-identity) hit per unique key. If a hit has no
 * pdbId (nr database hits, e.g. an uniprot accession only), we fall
 * back to uniprotRef.
 */
export function dedupBlastHits(hits: BlastHit[]): BlastHit[] {
  const seen = new Map<string, BlastHit>();
  for (const h of hits) {
    const key = (h.pdbId && h.pdbId.length >= 4 ? h.pdbId : h.uniprotRef) || `idx-${seen.size}`;
    const existing = seen.get(key);
    if (!existing || h.identity > existing.identity) {
      seen.set(key, h);
    }
  }
  return [...seen.values()].sort((a, b) => b.identity - a.identity);
}

/**
 * Mark each hit with isParalog = (identity ≥ PARALOG_IDENTITY_THRESHOLD).
 * Mutates the hits in place and returns the same array for chaining.
 */
export function classifyBlastHits(hits: BlastHit[]): BlastHit[] {
  for (const h of hits) {
    h.isParalog = h.identity >= PARALOG_IDENTITY_THRESHOLD;
  }
  return hits;
}
export async function fetchUniprotSequence(uniprotId: string, signal?: AbortSignal): Promise<string> {
  // R196: signal 透传 —— Phase A 收集期的 Stop 即刻生效（与 blast/RCSB 同口径）。
  const combo = combineSignals(signal, 15_000);
  try {
    const res = await fetch(`https://rest.uniprot.org/uniprotkb/${uniprotId}.fasta`, { signal: combo.signal });
    if (!res.ok) throw new Error(`UniProt fetch ${res.status} for ${uniprotId}`);
    const fasta = await res.text();
    const seq = fasta.split('\n').slice(1).join('');
    if (!seq || seq.length < 30) throw new Error(`UniProt sequence too short for ${uniprotId}`);
    return seq;
  } finally {
    combo.dispose();
  }
}
