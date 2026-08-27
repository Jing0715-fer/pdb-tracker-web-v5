/**
 * VLM Client — Shared VLM (Vision Language Model) screenshot analysis.
 *
 * Extracted from chat-tab.tsx (Round 98) so both the legacy ReAct loop and
 * the tool-calling agent loop can invoke VLM analysis with the same logic.
 *
 * Flow:
 *   1. capture_multi_angle returns screenshots[]
 *   2. Store images immediately (without VLM) so user sees them right away
 *   3. Call /api/vlm/select-best in the background (with retry)
 *   4. On success: update images with best/score/confidence/comments/quality
 *   5. On quality='degraded'|'unacceptable': trigger recapture feedback
 */

import type { AnalysisImage } from "./store";

/**
 * Normalize interaction data from different recipe schemas to a unified format.
 *
 * Different recipes return interactions in different shapes:
 * - all_interactions: { interactions: [{chain1, resno1, atom1, chain2, resno2, atom2}] }
 * - hbonds: { hbonds: [{donor_chain, donor_resno, donor_atom, acceptor_chain, acceptor_resno, acceptor_atom, donor_resname, acceptor_resname}] }
 * - salt_bridges: { salt_bridges: [{pos_chain, pos_resno, pos_atom, neg_chain, neg_resno, neg_atom, pos_resname, neg_resname}] }
 * - hydrophobic_contacts: { hydrophobic_contacts: [{chain1, resno1, chain2, resno2}] } (no atom-level data)
 *
 * This normalizer converts all of them to: [{chain1, resno1, atom1, chain2, resno2, atom2}]
 * so that applyRecipeVisualization can draw side chains + dashed lines consistently.
 */
export function normalizeInteractions(analysisData: Record<string, unknown> | undefined): Array<{
  chain1: string;
  resno1: number;
  atom1?: string;
  chain2: string;
  resno2: number;
  atom2?: string;
  resname1?: string;
  resname2?: string;
}> {
  if (!analysisData) return [];
  const result: Array<Record<string, unknown>> = [];

  // all_interactions: already in the right format
  const interactions = analysisData.interactions as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(interactions)) {
    for (const i of interactions) {
      if (i.chain1 && i.resno1 && i.chain2 && i.resno2) {
        result.push({
          chain1: i.chain1, resno1: i.resno1, atom1: i.atom1,
          chain2: i.chain2, resno2: i.resno2, atom2: i.atom2,
          resname1: i.resname1, resname2: i.resname2,
        });
      }
    }
  }

  // hbonds: donor_* / acceptor_* → chain1/chain2
  const hbonds = analysisData.hbonds as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(hbonds)) {
    for (const h of hbonds) {
      const dChain = h.donor_chain as string | undefined;
      const dResno = h.donor_resno as number | undefined;
      const aChain = h.acceptor_chain as string | undefined;
      const aResno = h.acceptor_resno as number | undefined;
      if (dChain && dResno && aChain && aResno) {
        result.push({
          chain1: dChain, resno1: dResno, atom1: h.donor_atom,
          resname1: h.donor_resname,
          chain2: aChain, resno2: aResno, atom2: h.acceptor_atom,
          resname2: h.acceptor_resname,
        });
      }
    }
  }

  // salt_bridges: pos_* / neg_* → chain1/chain2
  const saltBridges = analysisData.salt_bridges as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(saltBridges)) {
    for (const s of saltBridges) {
      const pChain = s.pos_chain as string | undefined;
      const pResno = s.pos_resno as number | undefined;
      const nChain = s.neg_chain as string | undefined;
      const nResno = s.neg_resno as number | undefined;
      if (pChain && pResno && nChain && nResno) {
        result.push({
          chain1: pChain, resno1: pResno, atom1: s.pos_atom,
          resname1: s.pos_resname,
          chain2: nChain, resno2: nResno, atom2: s.neg_atom,
          resname2: s.neg_resname,
        });
      }
    }
  }

  // hydrophobic_contacts: may have chain1/resno1/chain2/resno2 directly
  const hydrophobic = analysisData.hydrophobic_contacts as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(hydrophobic)) {
    for (const h of hydrophobic) {
      if (h.chain1 && h.resno1 && h.chain2 && h.resno2) {
        result.push({
          chain1: h.chain1, resno1: h.resno1,
          chain2: h.chain2, resno2: h.resno2,
          resname1: h.resname1, resname2: h.resname2,
        });
      }
    }
  }

  // all_interactions fallback: also check allInteractions nested object
  const ai = analysisData.allInteractions as Record<string, unknown> | undefined;
  if (ai?.interactions && Array.isArray(ai.interactions)) {
    for (const i of ai.interactions as Array<Record<string, unknown>>) {
      if (i.chain1 && i.resno1 && i.chain2 && i.resno2) {
        result.push({
          chain1: i.chain1, resno1: i.resno1, atom1: i.atom1,
          chain2: i.chain2, resno2: i.resno2, atom2: i.atom2,
        });
      }
    }
  }

  return result as Array<{ chain1: string; resno1: number; atom1?: string; chain2: string; resno2: number; atom2?: string; resname1?: string; resname2?: string; }>;
}

/**
 * Extract residue labels from analysis data for screenshot annotation.
 * Uses one-letter amino acid codes (C145 instead of CYS145).
 *
 * R163: NO label-count cap (user request). Labels are rendered small,
 * without background boxes, and with anti-overlap spiral placement
 * (see commands.ts R163), so all residues can be labeled.
 */
export function extractResidueLabels(
  analysisData: Record<string, unknown> | undefined,
  maxLabels: number = Number.POSITIVE_INFINITY,
): Array<{ text: string; chain?: string; resno?: number; fullResidue?: string }> {
  if (!analysisData) return [];
  const THREE_TO_ONE: Record<string, string> = {
    ALA: "A", ARG: "R", ASN: "N", ASP: "D", CYS: "C", GLN: "Q", GLU: "E",
    GLY: "G", HIS: "H", ILE: "I", LEU: "L", LYS: "K", MET: "M", PHE: "F",
    PRO: "P", SER: "S", THR: "T", TRP: "W", TYR: "Y", VAL: "V",
  };
  const ONE_TO_THREE: Record<string, string> = {
    A: "ALA", R: "ARG", N: "ASN", D: "ASP", C: "CYS", Q: "GLN", E: "GLU",
    G: "GLY", H: "HIS", I: "ILE", L: "LEU", K: "LYS", M: "MET", F: "PHE",
    P: "PRO", S: "SER", T: "THR", W: "TRP", Y: "TYR", V: "VAL",
  };
  const formatLabel = (resname: string, resno: number) => {
    const one = THREE_TO_ONE[resname] || "?";
    return `${one}${resno}`;
  };
  // R101.6: Build full residue name for tooltip (e.g. "CYS145 (Cysteine)")
  const RESNAME_FULL: Record<string, string> = {
    ALA: "Alanine", ARG: "Arginine", ASN: "Asparagine", ASP: "Aspartate",
    CYS: "Cysteine", GLN: "Glutamine", GLU: "Glutamate", GLY: "Glycine",
    HIS: "Histidine", ILE: "Isoleucine", LEU: "Leucine", LYS: "Lysine",
    MET: "Methionine", PHE: "Phenylalanine", PRO: "Proline", SER: "Serine",
    THR: "Threonine", TRP: "Tryptophan", TYR: "Tyrosine", VAL: "Valine",
  };
  const formatFull = (resname: string, resno: number, chain?: string) => {
    const full = RESNAME_FULL[resname] || resname;
    return chain ? `${resname}${resno} (${full}, Chain ${chain})` : `${resname}${resno} (${full})`;
  };
  const labels: Array<{ text: string; chain?: string; resno?: number; fullResidue?: string }> = [];
  const seen = new Set<string>();

  // From binding_pocket residues
  const residues = analysisData.residues as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(residues)) {
    for (const r of residues) {
      const chain = r.chain as string | undefined;
      const resno = r.resno as number | undefined;
      const resname = r.resname as string | undefined;
      if (chain && resno && resname) {
        const key = `${chain}:${resno}`;
        if (!seen.has(key)) {
          seen.add(key);
          labels.push({
            text: formatLabel(resname, resno),
            chain,
            resno,
            fullResidue: formatFull(resname, resno, chain),
          });
        }
      }
    }
  }

  // From normalized interactions (covers hbonds, salt_bridges, all_interactions)
  const interactions = normalizeInteractions(analysisData);
  for (const i of interactions) {
    if (labels.length >= maxLabels) break;
    const key1 = `${i.chain1}:${i.resno1}`;
    if (!seen.has(key1) && i.resname1) {
      seen.add(key1);
      labels.push({
        text: formatLabel(i.resname1, i.resno1),
        chain: i.chain1,
        resno: i.resno1,
        fullResidue: formatFull(i.resname1, i.resno1, i.chain1),
      });
    }
    const key2 = `${i.chain2}:${i.resno2}`;
    if (!seen.has(key2) && i.resname2) {
      seen.add(key2);
      labels.push({
        text: formatLabel(i.resname2, i.resno2),
        chain: i.chain2,
        resno: i.resno2,
        fullResidue: formatFull(i.resname2, i.resno2, i.chain2),
      });
    }
  }

  // slice(0, Infinity) returns the whole array — callers may still pass an
  // explicit cap for special cases (legacy use-agent-loop passes none now).
  return labels.slice(0, maxLabels);
}

export interface VlmResult {
  bestIndex: number;
  commentary: string;
  scores?: number[];
  confidence?: "high" | "medium" | "low";
  comments?: string[];
  /** Round 98: Overall quality assessment */
  quality?: "acceptable" | "degraded" | "unacceptable";
  /** Round 98: Per-image issues (e.g. "侧链未显示", "氢键连线缺失") */
  issues?: string[];
  /** Round 98: Recapture hints when quality is degraded/unacceptable */
  recaptureHints?: {
    angles?: string[];
    focus?: string;
    zoom?: "in" | "out";
  };
  recipe?: string;
  /**
   * R165 (VLM-007): server-side parse outcome —
   * - 'ok': the VLM response parsed and the VLM chose bestIndex.
   * - 'parse-failed': the server could NOT parse the VLM response as JSON;
   *   bestIndex fell back to a default — do not present it as a real VLM
   *   selection.
   * - 'skipped': only one screenshot was sent, VLM never ran.
   */
  vlmSignal?: "ok" | "parse-failed" | "skipped";
}

export interface ScreenshotData {
  dataUri: string;
  angle: string;
  label: string;
}

// R108.4: VLM result cache — avoids re-analyzing identical screenshots.
// Key: hash of screenshot data URIs + recipe + analysisSummary
// Value: VlmResult
// TTL: 5 minutes (300000ms) — old entries are evicted on access
const vlmCache = new Map<string, { result: VlmResult; timestamp: number }>();
const VLM_CACHE_TTL = 300_000; // 5 minutes

/** Generate a cache key from screenshots + recipe + summary */
function getVlmCacheKey(screenshots: ScreenshotData[], recipe: string, analysisSummary: string): string {
  // R167 (VLM-011): fingerprint = dataUri length + head 128 + tail 128.
  // The old head-100-only fingerprint keyed on the deterministic
  // `data:image/png;base64,` + PNG-header prefix: two UNRELATED captures
  // with coincidentally equal length + equal first ~78 base64 chars
  // collided (wrong VLM verdict reused), while the same screenshot with
  // a tiny tail-side difference (PNG chunk padding, IEND region) still
  // missed. Length + head + tail keeps the key short (~280 chars per
  // screenshot) while anchoring both ends of the payload: identical
  // screenshots re-hit the cache, unrelated ones no longer collide.
  const fingerprint = screenshots
    .map((s) => {
      const len = s.dataUri.length;
      const head = s.dataUri.slice(0, 128);
      const tail = len > 256 ? s.dataUri.slice(len - 128) : "";
      return `${len}:${head}${tail}`;
    })
    .join("|");
  return `${recipe}:${analysisSummary.slice(0, 200)}:${fingerprint}`;
}

/** Check cache for a valid (non-expired) entry */
function getCachedVlm(key: string): VlmResult | null {
  const entry = vlmCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > VLM_CACHE_TTL) {
    vlmCache.delete(key); // expired
    return null;
  }
  return entry.result;
}

/** Store a VLM result in cache */
function setCachedVlm(key: string, result: VlmResult): void {
  // Evict expired entries when cache grows large
  if (vlmCache.size > 50) {
    const now = Date.now();
    for (const [k, v] of vlmCache.entries()) {
      if (now - v.timestamp > VLM_CACHE_TTL) vlmCache.delete(k);
    }
  }
  vlmCache.set(key, { result, timestamp: Date.now() });
}

/** R165 (VLM-005): default fetch timeout — defense-in-depth against a hung
 * request. The route retries 429s internally (5+15+45s backoff), so this
 * only fires when the request is genuinely stuck. */
const VLM_FETCH_TIMEOUT_MS = 90_000;

/**
 * R165 (VLM-005): combine the caller's abort signal with a default timeout
 * (caller signal takes precedence in reporting; either firing aborts the
 * fetch). Prefers AbortSignal.any and falls back to manual wiring on older
 * browsers.
 */
function combineFetchSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  const anyFn = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === "function") {
    return anyFn(signal ? [signal, timeout] : [timeout]);
  }
  const combined = new AbortController();
  const wire = (s: AbortSignal) => {
    if (s.aborted) {
      combined.abort(s.reason);
      return;
    }
    s.addEventListener("abort", () => combined.abort(s.reason), { once: true });
  };
  if (signal) wire(signal);
  wire(timeout);
  return combined.signal;
}

/**
 * Call /api/vlm/select-best to analyze screenshots.
 * Returns null on failure (caller can retry).
 * R108.4: Results are cached for 5 minutes to avoid re-analysis.
 * R164 (VLM-002): optional AbortSignal — when the caller aborts (e.g.
 * the user navigated away mid-VLM), the fetch is cancelled AND the
 * server-side req.signal fires, so the server stops retrying the VLM
 * call instead of paying full token cost for an orphan result.
 * R165 (VLM-005): the fetch is also bounded by a default 90s timeout —
 * previously a hung request (no internal timeout in the SDK/route path)
 * could stall the capture loop indefinitely.
 */
export async function selectBestScreenshot(
  screenshots: ScreenshotData[],
  recipe: string,
  analysisSummary: string,
  signal?: AbortSignal,
): Promise<VlmResult | null> {
  // R108.4: Check cache first
  const cacheKey = getVlmCacheKey(screenshots, recipe, analysisSummary);
  const cached = getCachedVlm(cacheKey);
  if (cached) {
    console.log("[vlm-client] Cache hit — skipping VLM call");
    return cached;
  }

  try {
    const vlmResponse = await fetch("/api/vlm/select-best", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        screenshots,
        recipe,
        analysisSummary,
      }),
      // R164 (VLM-002): propagate the abort signal so the fetch is
      // cancelled when the caller aborts. Next.js's route handler
      // picks this up via req.signal, which the route's inner
      // AbortController is chained to.
      // R165 (VLM-005): combined with a default 90s timeout so a hung
      // request can't stall the capture loop forever.
      signal: combineFetchSignal(signal, VLM_FETCH_TIMEOUT_MS),
    });
    if (vlmResponse.ok) {
      const result = (await vlmResponse.json()) as VlmResult;
      // R165 (VLM-007): surface the parse-failed signal instead of
      // swallowing it — the caller's logs can now distinguish "VLM chose
      // #0" from "parse failure defaulted to #0".
      if (result.vlmSignal === "parse-failed") {
        console.warn(
          "[vlm-client] Server failed to parse the VLM response as JSON — " +
            "bestIndex fell back to a default (see [vlm/select-best] server log)."
        );
      }
      // R108.4: Cache the result
      setCachedVlm(cacheKey, result);
      return result;
    }
    return null;
  } catch (err) {
    // If the abort signal fired, return null gracefully — caller
    // will show the "未经视觉验证" badge instead of orphan results.
    const errName = (err as { name?: string })?.name ?? "";
    if (signal?.aborted) {
      console.log("[vlm-client] fetch aborted — client disconnected");
    } else if (errName === "AbortError" || errName === "TimeoutError") {
      // R165 (VLM-005): the 90s default timeout fired (AbortSignal.timeout
      // rejects with a TimeoutError DOMException, not an AbortError).
      console.warn(
        `[vlm-client] fetch timed out after ${VLM_FETCH_TIMEOUT_MS / 1000}s — returning null (caller may retry)`
      );
    }
    return null;
  }
}

/** R108.4: Clear the VLM cache (for testing or when structure changes) */
export function clearVlmCache(): void {
  vlmCache.clear();
}

/**
 * R163: Run VLM selection with exponential backoff (5s / 15s / 45s).
 *
 * The server route (/api/vlm/select-best) also retries 429s internally with
 * the same schedule; these client-side retries cover HTTP-level failures
 * (route 500s after its own retries, network drops, proxies timing out).
 * Previously a single failure after one 5s retry aborted visual verification.
 *
 * R164 (VLM-002): optional AbortSignal — when aborted (e.g. user navigates
 * away mid-VLM), the in-flight fetch is cancelled AND the backoff timer
 * is interrupted, so the client stops paying attention instead of running
 * the full 65s schedule against a disconnected UI.
 */
export async function selectBestWithRetry(
  screenshots: ScreenshotData[],
  recipe: string,
  analysisSummary: string,
  signal?: AbortSignal,
): Promise<VlmResult | null> {
  const BACKOFF_SCHEDULE_MS = [5_000, 15_000, 45_000];
  let result = await selectBestScreenshot(screenshots, recipe, analysisSummary, signal);
  for (let attempt = 0; attempt < BACKOFF_SCHEDULE_MS.length && !result; attempt++) {
    // R164 (VLM-002): if aborted, return null immediately instead of
    // continuing the retry schedule.
    if (signal?.aborted) {
      console.log('[vlm-client] retry schedule aborted — client disconnected');
      return null;
    }
    const waitMs = BACKOFF_SCHEDULE_MS[attempt]!;
    console.warn(`[vlm-client] attempt ${attempt + 1} failed — retrying in ${waitMs / 1000}s…`);
    // R164 (VLM-002): interruptible sleep — rejects immediately if the
    // abort signal fires during the wait.
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, waitMs);
      const onAbort = () => {
        clearTimeout(t);
        reject(new DOMException('Client disconnected — retry aborted', 'AbortError'));
      };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
    }).catch(() => { /* treat abort as failure → exit loop */ });
    if (signal?.aborted) return null;
    result = await selectBestScreenshot(screenshots, recipe, analysisSummary, signal);
  }
  if (!result) {
    console.warn('[vlm-client] All VLM attempts failed — caller should mark results as 未经视觉验证');
  }
  return result;
}

/**
 * Apply VLM result to a list of AnalysisImages for a specific recipe.
 * Returns the updated images (with best/score/confidence/comments/quality).
 */
export function applyVlmResultToImages(
  images: AnalysisImage[],
  recipe: string,
  vlm: VlmResult,
): AnalysisImage[] {
  // R165 (VLM-007): prefix comments when the server couldn't parse the VLM
  // response — the UI then shows an explicit "parse failed" signal instead
  // of presenting a defaulted bestIndex as a real VLM selection.
  const parseFailedPrefix = vlm.vlmSignal === "parse-failed" ? "[VLM输出解析失败] " : "";
  return images.map((img) => {
    if (img.recipe !== recipe) return img;
    // Find the index of this image within the recipe's images
    const recipeImages = images.filter((i) => i.recipe === recipe);
    const idx = recipeImages.indexOf(img);
    return {
      ...img,
      best: idx === vlm.bestIndex,
      vlmComment:
        vlm.comments && idx < vlm.comments.length
          ? parseFailedPrefix + vlm.comments[idx]
          : idx === vlm.bestIndex
            ? parseFailedPrefix + vlm.commentary
            : undefined,
      score: vlm.scores && idx < vlm.scores.length ? vlm.scores[idx] : undefined,
      confidence: vlm.confidence,
      // R100.3: Set quality + issues from VLM result
      quality: vlm.quality,
      issues:
        vlm.issues && idx < vlm.issues.length
          ? [vlm.issues[idx]]
          : undefined,
    };
  });
}

/**
 * Check if VLM quality indicates the screenshots need to be recaptured.
 */
export function needsRecapture(vlm: VlmResult | null): boolean {
  if (!vlm?.quality) return false;
  return vlm.quality === "degraded" || vlm.quality === "unacceptable";
}

/**
 * Build a recapture instruction message for the agent loop.
 * This is appended to the tool result so the LLM knows to call recapture_screenshot.
 */
export function buildRecaptureInstruction(vlm: VlmResult, recipe: string): string {
  const issues = vlm.issues?.filter((i) => i.length > 0).slice(0, 5) || [];
  const hints = vlm.recaptureHints || {};
  const parts: string[] = [
    `VLM评估: 截图质量为 "${vlm.quality}"`,
  ];
  if (issues.length > 0) {
    parts.push(`问题: ${issues.join("; ")}`);
  }
  if (hints.angles && hints.angles.length > 0) {
    parts.push(`建议角度: ${hints.angles.join(", ")}`);
  }
  if (hints.focus) {
    parts.push(`建议聚焦: ${hints.focus}`);
  }
  if (hints.zoom) {
    parts.push(`建议缩放: ${hints.zoom === "in" ? "放大" : "缩小"}`);
  }
  parts.push(`请调用 recapture_screenshot 工具重新截图，传入 recipe="${recipe}" 和上述建议参数。`);
  return parts.join("\n");
}
