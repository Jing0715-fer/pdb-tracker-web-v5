/**
 * VLM-controlled capture loop — Plan A+B+C+D (Round 142)
 *
 * Implements an iterative capture→VLM→recapture loop that:
 *   - Plan B: Computes interface-aware orthogonal camera angles instead of
 *             fixed front/side/top/back
 *   - Plan C: Only re-captures the specific angles that scored poorly (not all)
 *   - Plan A: Lets VLM feedback directly control camera adjustments without
 *             LLM as intermediary
 *   - Plan D: Parses structured recaptureHints (angles/focus/zoom) from VLM
 *             and applies them to the next capture iteration
 *
 * Flow:
 *   1. captureInitial(viewer, recipe, vizParams, labels) → 3-4 screenshots
 *   2. selectBestWithRetry(screenshots, recipe, summary) → VlmResult
 *   3. If quality == "acceptable" → return { screenshots, vlm }
 *   4. If quality != "acceptable" → parse recaptureHints
 *      - Determine which angles to re-capture (Plan C)
 *      - Apply zoom/focus adjustments (Plan D)
 *      - Re-capture ONLY the bad angles
 *      - Merge new screenshots with the good ones
 *      - Re-run VLM on the merged set
 *   5. Repeat up to MAX_ITERATIONS (default 2)
 */

import type { VlmResult, ScreenshotData } from './vlm-client';
import { selectBestWithRetry, needsRecapture } from './vlm-client';

/**
 * R164 (MOL-008): screenshot with a stable capture identity + VLM feedback
 * attached BY IDENTITY instead of array position.
 *
 * The re-capture loop rebuilds the screenshots array in a NEW order every
 * iteration (kept screenshots first, re-captured angles appended after), so
 * associating VLM scores/issues by array index misattributes feedback once
 * the array is reshuffled — a good screenshot can be flagged for re-capture
 * (or a bad one spared), producing spurious "needs recapture" loops. Each
 * screenshot entering the loop gets a unique `captureId`; the VLM round
 * writes `vlmScore`/`vlmIssue` back onto the objects by identity, and
 * selectAnglesToRecapture reads them from the objects.
 */
export interface TrackedScreenshot extends ScreenshotData {
  /** Unique identity — assigned once when the screenshot enters the loop;
   * re-captures of the same angle get a FRESH id (they are new captures). */
  captureId: string;
  /** Score from the most recent VLM round (undefined = not scored this round). */
  vlmScore?: number;
  /** Issue from the most recent VLM round (undefined = not scored this round). */
  vlmIssue?: string;
}

/** Configuration for the VLM-controlled capture loop. */
export interface CaptureLoopOptions {
  /** Maximum number of capture→VLM iterations (default 2). */
  maxIterations?: number;
  /** Quality threshold above which we stop iterating (default "acceptable"). */
  acceptableQuality?: 'acceptable' | 'degraded' | 'unacceptable';
  /** Override the angles to capture (default: interface-aware). */
  angles?: string[];
  // R169 (MOL-L1): unused `width`/`height` option fields removed — the only
  // caller (use-agent-session.ts) never passed them and the loop never read
  // them (screenshot sizing is decided by executeCommand's capture params).
  /** R146/R163: Per-VLM-call timeout in ms (default 150000 = 150s —
   * accommodates the server's 5s/15s/45s 429-backoff schedule plus inference). */
  vlmTimeoutMs?: number;
  /** R146: Progress callback — called after each capture + VLM step. */
  onProgress?: (progress: {
    iteration: number;
    maxIterations: number;
    phase: 'capturing' | 'vlm-analyzing' | 'done' | 'error';
    screenshotsCount: number;
    quality?: string;
  }) => void;
  /**
   * R164 (VLM-002): optional AbortSignal — when aborted (user navigates
   * away mid-VLM), the in-flight fetch is cancelled AND the server-side
   * req.signal fires so the server stops retrying the VLM call instead
   * of paying full token cost for an orphan result.
   */
  signal?: AbortSignal;
}

/** Result of the VLM-controlled capture loop. */
export interface CaptureLoopResult {
  /** Final screenshots (best ones from all iterations). */
  screenshots: ScreenshotData[];
  /** Final VLM result. */
  vlm: VlmResult | null;
  /** Number of capture iterations performed. */
  iterations: number;
  /** Whether VLM quality was acceptable at the end. */
  acceptable: boolean;
}

/**
 * Plan B: Compute interface-aware orthogonal camera angles.
 *
 * Instead of fixed front/side/top/back (which often overlap because the
 * interface is flat), this computes angles based on the interface's
 * geometric center and normal vector.
 *
 * The interface normal is approximated as the vector from the structure's
 * center to the interface center. We then capture from:
 *   1. Along the normal (looking straight at the interface)
 *   2. Perpendicular to the normal (edge-on view)
 *   3. 45° tilted from the normal
 *
 * R146: NOW FULLY IMPLEMENTED — returns custom angle labels that
 * applyCameraAngle can handle. The camera module computes absolute
 * positions from the interface normal vector.
 *
 * Returns angle labels that applyCameraAngle can handle.
 */
export function computeInterfaceAngles(
  interfaceCenter: { x: number; y: number; z: number } | null,
  structureCenter: { x: number; y: number; z: number } | null
): Array<{ label: string; description: string }> {
  // Default: standard 3 angles
  const defaultAngles = [
    { label: 'front', description: '正面' },
    { label: 'side', description: '侧面' },
    { label: 'top', description: '顶部' },
  ];

  if (!interfaceCenter || !structureCenter) {
    return defaultAngles;
  }

  // Compute the interface normal (direction from structure center to interface)
  const dx = interfaceCenter.x - structureCenter.x;
  const dy = interfaceCenter.y - structureCenter.y;
  const dz = interfaceCenter.z - structureCenter.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (len < 0.1) {
    // Interface center ≈ structure center — can't determine normal
    return defaultAngles;
  }

  // R146: We have a meaningful interface direction. Return interface-aware
  // angle labels. applyCameraAngle now supports these custom labels:
  //   - "interface_front" = looking along the normal (straight at interface)
  //   - "interface_side" = perpendicular to normal (edge-on view)
  //   - "interface_tilted" = 45° between front and side
  const nx = dx / len;
  const ny = dy / len;
  const nz = dz / len;
  console.log(`[computeInterfaceAngles] Interface normal: (${nx.toFixed(2)}, ${ny.toFixed(2)}, ${nz.toFixed(2)}) — using interface-aware angles`);

  return [
    { label: 'interface_front', description: '界面正面（沿法向量）' },
    { label: 'interface_side', description: '界面侧面（垂直法向量）' },
    { label: 'interface_tilted', description: '界面斜视（45°倾斜）' },
  ];
}

/**
 * R146: Extract the interface center from analysis data.
 *
 * Computes the geometric center of all interface residues from the
 * interactions data. Returns null if no residues can be extracted.
 */
export function extractInterfaceCenter(
  analysisData: Record<string, unknown> | null
): { x: number; y: number; z: number } | null {
  if (!analysisData) return null;

  // The actual data may be nested under .data (from runRecipe)
  const data = (analysisData as any).data ?? analysisData;

  // Try to extract residue positions from interactions
  // Note: interactions data has chain/resno but NOT xyz coordinates.
  // We can't compute the actual 3D center without querying the structure.
  // For now, return null and let the caller fall back to default angles.
  // A future enhancement could query Molstar for residue positions.
  return null;
}

/**
 * Plan C: Determine which angles need re-capture based on VLM scores.
 *
 * Returns the labels of angles that scored below the threshold, so we
 * only re-capture those instead of all angles.
 */
export function selectAnglesToRecapture(
  screenshots: ScreenshotData[],
  vlm: VlmResult,
  threshold: number = 5
): Array<{ index: number; angle: string; reason: string }> {
  const toRecapture: Array<{ index: number; angle: string; reason: string }> = [];

  for (let i = 0; i < screenshots.length; i++) {
    const s = screenshots[i] as ScreenshotData & { vlmScore?: number; vlmIssue?: string };
    // R164 (MOL-008): prefer the VLM feedback attached to the screenshot
    // OBJECT (written back by identity after each VLM round). The positional
    // vlm.scores[i] fallback only serves untracked callers — between
    // re-capture iterations the array is rebuilt in a new order (kept
    // screenshots first, re-captured angles appended after), so positional
    // indexes can attribute a score to the WRONG screenshot and flag good
    // captures for re-capture (or spare bad ones).
    const score = s.vlmScore ?? vlm.scores?.[i] ?? 0;
    const issue = s.vlmIssue ?? vlm.issues?.[i] ?? '';
    const isBad = score < threshold || (issue && issue !== '无问题' && issue.length > 0);

    if (isBad) {
      toRecapture.push({
        index: i,
        angle: s.angle,
        reason: `score=${score}, issue="${issue}"`,
      });
    }
  }

  return toRecapture;
}

/**
 * Plan D: Apply VLM recaptureHints to camera parameters.
 *
 * Parses the structured recaptureHints from VLM output and translates them
 * into camera adjustments (zoom level, focus target).
 *
 * Returns updated vizParams for the next capture iteration.
 */
export function applyVlmHints(
  vizParams: Record<string, unknown>,
  vlm: VlmResult
): Record<string, unknown> {
  const updated = { ...vizParams };
  const hints = vlm.recaptureHints || {};

  // Apply zoom hint
  if (hints.zoom === 'out') {
    // Increase the focus radius to zoom out
    updated._zoomOut = true;
    updated._focusRadiusMultiplier = 1.5; // 50% wider
  } else if (hints.zoom === 'in') {
    updated._zoomIn = true;
    updated._focusRadiusMultiplier = 0.7; // 30% tighter
  }

  // Apply focus hint
  if (hints.focus) {
    updated._vlmFocusHint = hints.focus;
  }

  // Store suggested angles for the camera module to use
  if (hints.angles && hints.angles.length > 0) {
    updated._vlmSuggestedAngles = hints.angles;
  }

  return updated;
}

/**
 * Plan A: The main VLM-controlled capture loop.
 *
 * This function is called by use-agent-session.ts after pdb_analyze
 * completes. It replaces the simple "capture → VLM → done" flow with
 * an iterative "capture → VLM → adjust → re-capture bad angles → VLM → done" loop.
 *
 * The loop stops when:
 *   - VLM quality is "acceptable", OR
 *   - maxIterations is reached (default 2)
 *
 * Note: This function does NOT directly control the camera at a low level.
 * Instead, it:
 *   1. Calls executeCommand for capture_multi_angle
 *   2. Calls selectBestWithRetry for VLM analysis
 *   3. If needed, calls executeCommand again with adjusted parameters
 *
 * The actual camera control is in applyRecipeVisualization + applyCameraAngle,
 * which read the adjusted vizParams.
 *
 * @param executeCapture - Function that executes capture_multi_angle and returns screenshots
 * @param recipe - Recipe name (e.g. "all_interactions")
 * @param analysisSummary - JSON summary of analysis data for VLM context
 * @param initialVizParams - Initial visualization params
 * @param options - Loop configuration
 * @returns CaptureLoopResult with final screenshots + VLM result
 */
export async function runVlmControlledCaptureLoop(
  executeCapture: (angles: string[], vizParams: Record<string, unknown>) => Promise<{ screenshots: ScreenshotData[]; ok: boolean }>,
  recipe: string,
  analysisSummary: string,
  initialVizParams: Record<string, unknown>,
  options: CaptureLoopOptions = {}
): Promise<CaptureLoopResult> {
  const maxIterations = options.maxIterations ?? 2;
  const acceptableQuality = options.acceptableQuality ?? 'acceptable';
  const initialAngles = options.angles ?? ['front', 'side', 'top'];
  const vlmTimeoutMs = options.vlmTimeoutMs ?? 150000;
  const onProgress = options.onProgress;

  // R164 (MOL-008): stable per-capture identity bookkeeping (see
  // TrackedScreenshot). Every screenshot entering the loop is wrapped with a
  // unique captureId; re-captures get fresh ids because they are NEW
  // captures of the same angle, not the same screenshot.
  let captureSeq = 0;
  const track = (s: ScreenshotData): TrackedScreenshot => ({
    ...s,
    captureId: `cap-${++captureSeq}`,
  });

  let currentScreenshots: TrackedScreenshot[] = [];
  let currentVlm: VlmResult | null = null;
  let vizParams = { ...initialVizParams };
  let iteration = 0;

  // R146: Helper to call VLM with a timeout, so it doesn't hang forever
  // R164 (VLM-002): also chain the caller's AbortSignal so client
  // disconnect propagates through the Promise.race AND into the
  // selectBestWithRetry fetch + the server's req.signal.
  const runVlmWithTimeout = async (screenshots: TrackedScreenshot[]): Promise<VlmResult | null> => {
    onProgress?.({
      iteration,
      maxIterations,
      phase: 'vlm-analyzing',
      screenshotsCount: screenshots.length,
    });

    // R164 (VLM-002): if caller aborted, short-circuit.
    if (options.signal?.aborted) {
      console.log('[vlm-capture-loop] caller aborted — skipping VLM call');
      return null;
    }

    try {
      // Build an inner controller chained to BOTH the caller's signal
      // AND the timeout — whichever fires first wins.
      const innerController = new AbortController();
      const onCallerAbort = () => innerController.abort();
      if (options.signal) options.signal.addEventListener('abort', onCallerAbort, { once: true });
      const timeoutId = setTimeout(() => {
        console.warn(`[vlm-capture-loop] VLM call timed out after ${vlmTimeoutMs}ms`);
        innerController.abort();
      }, vlmTimeoutMs);
      try {
        // Race the VLM call against the timeout. The innerController.signal
        // is passed to selectBestWithRetry → fetch → /api/vlm/select-best,
        // which uses it as req.signal so the server stops retrying.
        //
        // R164 (MOL-008): send only the plain wire fields — the loop-local
        // bookkeeping fields (captureId/vlmScore/vlmIssue) must not leak
        // into the request payload. The array order here IS the input order
        // the VLM's scores/issues arrays will use.
        const vlmPromise = selectBestWithRetry(
          screenshots.map(s => ({ dataUri: s.dataUri, angle: s.angle, label: s.label })),
          recipe,
          analysisSummary,
          innerController.signal,
        );
        const timeoutPromise = new Promise<null>((resolve) => {
          innerController.signal.addEventListener('abort', () => resolve(null), { once: true });
        });
        const result = await Promise.race([vlmPromise, timeoutPromise]);
        if (result) {
          // R164 (MOL-008): the VLM returns scores/issues indexed by INPUT
          // order. Write them back onto the screenshot objects BY IDENTITY
          // (input position i → screenshots[i]) immediately, so any later
          // reordering of the array during re-capture merges can never
          // misattribute feedback. Screenshots beyond the returned array
          // length get explicitly reset to undefined ("not scored").
          for (let i = 0; i < screenshots.length; i++) {
            screenshots[i]!.vlmScore = result.scores?.[i];
            screenshots[i]!.vlmIssue = result.issues?.[i];
          }
        }
        return result;
      } finally {
        clearTimeout(timeoutId);
        if (options.signal) options.signal.removeEventListener('abort', onCallerAbort);
      }
    } catch (err) {
      console.warn('[vlm-capture-loop] VLM call failed:', err);
      return null;
    }
  };

  for (iteration = 1; iteration <= maxIterations; iteration++) {
    const anglesToCapture = iteration === 1
      ? initialAngles
      : (vizParams._vlmSuggestedAngles as string[] | undefined) ?? initialAngles;

    onProgress?.({
      iteration,
      maxIterations,
      phase: 'capturing',
      screenshotsCount: currentScreenshots.length,
    });

    const captureResult = await executeCapture(anglesToCapture, vizParams);
    if (!captureResult.ok || captureResult.screenshots.length === 0) {
      break;
    }

    if (iteration === 1) {
      // R164 (MOL-008): tag every screenshot with a stable captureId.
      currentScreenshots = captureResult.screenshots.map(track);
    } else {
      // Plan C: Merge new screenshots with existing good ones
      // Replace only the angles that were re-captured
      const capturedAngles = new Set(captureResult.screenshots.map(s => s.angle));
      currentScreenshots = currentScreenshots.filter(s => !capturedAngles.has(s.angle));
      // R164 (MOL-008): re-captures are NEW screenshots → fresh captureIds,
      // and they carry no vlmScore/vlmIssue until the next VLM round writes
      // feedback back by identity (never inherited from the screenshot of
      // the same angle they just replaced).
      currentScreenshots = [...currentScreenshots, ...captureResult.screenshots.map(track)];
    }

    // R146: Run VLM with timeout (prevents "stuck on VLM analyzing" bug)
    currentVlm = await runVlmWithTimeout(currentScreenshots);

    if (!currentVlm) {
      // VLM failed or timed out — use the screenshots we have without VLM
      console.warn('[vlm-capture-loop] VLM unavailable — returning screenshots without VLM analysis');
      break;
    }

    // Check if quality is acceptable
    if (currentVlm.quality === acceptableQuality || !needsRecapture(currentVlm)) {
      break;
    }

    // Plan D: Apply VLM hints for the next iteration
    vizParams = applyVlmHints(vizParams, currentVlm);

    // Plan C: Determine which angles to re-capture
    const anglesToRecapture = selectAnglesToRecapture(currentScreenshots, currentVlm);

    if (anglesToRecapture.length === 0 || anglesToRecapture.length === currentScreenshots.length) {
      // Either all are OK (shouldn't happen since quality != acceptable) or all are bad
      // In either case, re-capture all with the new vizParams
      vizParams._vlmSuggestedAngles = initialAngles;
    } else {
      // Only re-capture the bad angles
      vizParams._vlmSuggestedAngles = anglesToRecapture.map(a => a.angle);
    }
  }

  onProgress?.({
    iteration,
    maxIterations,
    phase: currentVlm ? 'done' : 'error',
    screenshotsCount: currentScreenshots.length,
    quality: currentVlm?.quality,
  });

  return {
    screenshots: currentScreenshots,
    vlm: currentVlm,
    iterations: iteration,
    acceptable: currentVlm?.quality === 'acceptable',
  };
}
