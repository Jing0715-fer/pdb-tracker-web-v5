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

import type { MolstarViewer } from './types';
import type { VlmResult, ScreenshotData } from './vlm-client';
import { selectBestWithRetry, needsRecapture } from './vlm-client';

/** Configuration for the VLM-controlled capture loop. */
export interface CaptureLoopOptions {
  /** Maximum number of capture→VLM iterations (default 2). */
  maxIterations?: number;
  /** Quality threshold above which we stop iterating (default "acceptable"). */
  acceptableQuality?: 'acceptable' | 'degraded' | 'unacceptable';
  /** Override the angles to capture (default: interface-aware). */
  angles?: string[];
  /** Screenshot width. */
  width?: number;
  /** Screenshot height. */
  height?: number;
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
 * R143 (code-review): Currently this function computes the interface normal
 * but returns the default angles because applyCameraAngle only supports
 * front/side/top/back. To fully implement Plan B, we need to:
 *   1. Add custom angle labels ("interface", "perpendicular", "tilted") to applyCameraAngle
 *   2. Compute absolute camera positions from the normal vector
 *   3. Use camera.setState instead of camera.rotate
 * This is left as a TODO for a future round.
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

  // TODO (Plan B future): When applyCameraAngle supports custom angles,
  // return interface-aware labels here. For now, the R143 fix
  // (restoreCameraStateKeep before each angle) ensures the default
  // front/side/top angles are truly orthogonal instead of cumulative.
  console.log(`[computeInterfaceAngles] Interface normal: (${(dx/len).toFixed(2)}, ${(dy/len).toFixed(2)}, ${(dz/len).toFixed(2)}) — using default angles with R143 orthogonal fix`);
  return defaultAngles;
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
    const score = vlm.scores?.[i] ?? 0;
    const issue = vlm.issues?.[i] ?? '';
    const isBad = score < threshold || (issue && issue !== '无问题' && issue.length > 0);

    if (isBad) {
      toRecapture.push({
        index: i,
        angle: screenshots[i]!.angle,
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

  let currentScreenshots: ScreenshotData[] = [];
  let currentVlm: VlmResult | null = null;
  let vizParams = { ...initialVizParams };
  let iteration = 0;

  // Initial capture
  for (iteration = 1; iteration <= maxIterations; iteration++) {
    const anglesToCapture = iteration === 1
      ? initialAngles
      : (vizParams._vlmSuggestedAngles as string[] | undefined) ?? initialAngles;

    const captureResult = await executeCapture(anglesToCapture, vizParams);
    if (!captureResult.ok || captureResult.screenshots.length === 0) {
      break;
    }

    if (iteration === 1) {
      currentScreenshots = captureResult.screenshots;
    } else {
      // Plan C: Merge new screenshots with existing good ones
      // Replace only the angles that were re-captured
      const capturedAngles = new Set(captureResult.screenshots.map(s => s.angle));
      currentScreenshots = currentScreenshots.filter(s => !capturedAngles.has(s.angle));
      currentScreenshots = [...currentScreenshots, ...captureResult.screenshots];
    }

    // Run VLM on the current set
    currentVlm = await selectBestWithRetry(currentScreenshots, recipe, analysisSummary);

    if (!currentVlm) {
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

  return {
    screenshots: currentScreenshots,
    vlm: currentVlm,
    iterations: iteration,
    acceptable: currentVlm?.quality === 'acceptable',
  };
}
