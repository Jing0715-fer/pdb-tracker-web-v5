/**
 * Analysis view — full-state restore & persistence for analysis screenshots.
 *
 * WHY THIS MODULE EXISTS (user report R176: "点击图片上的恢复视角，没有恢复
 * label等信息。互作的氨基酸还是没有以stick形式显示（且执行该操作前需要
 * 执行隐藏全部stick）"):
 *
 *   The "恢复视角" button on a screenshot used to restore ONLY the camera
 *   (position/target/up). But the screenshot was taken inside a full analysis
 *   visualization (hidden non-interface chains, semi-transparent cartoon,
 *   ball-and-stick interface residues, H-bond distance lines, per-residue
 *   labels) that `cleanupCapture` removes right after the capture — so the
 *   "restored" view looked nothing like the screenshot: no labels, no sticks,
 *   all chains visible, opaque cartoon.
 *
 *   Two entry points now share one implementation:
 *     - `restoreAnalysisView` — the 恢复视角 button re-applies the ENTIRE
 *       analysis state for THAT screenshot's interface (viz + labels +
 *       camera), via `applyRecipeVisualization` + `persistAnalysisLabels`
 *       + `restoreCameraViewState`.
 *     - the `show_analysis_viz` command — after the pairwise analysis
 *       completes, the same viz + labels are persisted in the live viewer
 *       (camera untouched, R163) so the interacting residues stay visible
 *       as ball-and-stick.
 */

import type { MolstarViewer, MolstarPlugin } from "../types";
import type { CameraViewState } from "./camera";
import { restoreCameraViewState } from "./camera";
import { applyRecipeVisualization, buildResidueLoci } from "./recipe-viz";
import { lociFromResidue } from "./loci";
import { getChainColorMap, getChainLabelColor } from "./chain-colors";
import { getLociCenter, getLabelSizeRatios } from "./label-sizing";
import {
  addAgentLabel,
  refreshAgentLabelSizes,
  removeAgentLabels,
} from "./label-lifecycle";
import { nextFrame } from "./screenshot-utils";

/** R176: request a canvas redraw without tripping the (incomplete) canvas3d type. */
function requestCanvasDraw(plugin: MolstarPlugin): void {
  try {
    (plugin.canvas3d as unknown as { requestDraw?: () => void } | undefined)?.requestDraw?.();
  } catch {
    /* ignore */
  }
}

/** A residue label spec (same shape the capture pipeline's cmd.labels uses). */
export interface AnalysisViewLabel {
  text: string;
  chain?: string;
  resno?: number;
  compId?: string;
}

/**
 * Everything needed to re-create one analysis screenshot's view state.
 * Attached to each pairwise screenshot by the client capture loop.
 */
export interface AnalysisViewSpec {
  /** The recipe whose visualization the screenshot shows (e.g. pairwise_interactions). */
  recipe: string;
  /** The interface pair that was focused (pairwise recipes). */
  chain1?: string;
  chain2?: string;
  /** The pair's interaction list (drives sticks/lines/focus). */
  interactions?: Array<Record<string, unknown>>;
  /** The pair's residue labels (re-added via the agent-label pipeline). */
  labels?: AnalysisViewLabel[];
  labelFontSize?: number;
  /** The screenshot's camera — restored last. */
  cameraState?: CameraViewState;
}

/**
 * Persist residue labels in the live viewer via the agent-label pipeline
 * (R173 tag + R175 live distance-compensated sizing). Shared by the
 * show_analysis_labels / show_analysis_viz commands and restoreAnalysisView.
 *
 * Replaces any previously persisted agent labels first. Returns the number
 * of labels actually created.
 */
export async function persistAnalysisLabels(
  viewer: MolstarViewer,
  labels: AnalysisViewLabel[],
  fontSize = 0.55
): Promise<number> {
  const plugin = (viewer as unknown as { plugin?: MolstarPlugin }).plugin;
  if (!plugin || labels.length === 0) return 0;

  // Replace any previous agent labels (single source of truth for what the
  // post-analysis view shows — show_analysis_labels semantics).
  await removeAgentLabels(plugin);
  const chainColorMap = getChainColorMap(plugin);

  // R175: distance-compensated sizing — resolve every loci first, measure
  // anchor-camera distances, then create with per-label ratios (same
  // pipeline as the capture-time labels).
  interface PreparedLabel {
    lbl: AnalysisViewLabel;
    loci: unknown;
    center: [number, number, number] | null;
  }
  const preparedLabels: PreparedLabel[] = [];
  for (const lbl of labels) {
    try {
      if (lbl.chain === undefined || lbl.resno === undefined) continue;
      let loci: unknown = null;
      const singleResult = buildResidueLoci(plugin, [{ chain: lbl.chain, resno: lbl.resno }]);
      if (singleResult) loci = singleResult.loci;
      if (!loci) loci = await lociFromResidue(viewer, { chain: lbl.chain, resno: lbl.resno });
      if (loci) preparedLabels.push({ lbl, loci, center: getLociCenter(loci) });
    } catch (err) {
      console.warn(`[analysis-view] label "${lbl.text}" failed:`, err);
    }
  }
  const ratios = getLabelSizeRatios(plugin, preparedLabels.map((p) => p.center), 12);
  let added = 0;
  let slot = 0;
  for (let idx = 0; idx < preparedLabels.length; idx++) {
    const { lbl, loci, center } = preparedLabels[idx]!;
    const color = getChainLabelColor(plugin, lbl.chain, chainColorMap);
    // addAgentLabel registers the anchor → live re-sizing keeps every label
    // the same screen size while the user rotates/zooms.
    const created = await addAgentLabel(plugin, loci, {
      text: lbl.text ?? "",
      color,
      slot: slot++,
      fontSize,
      sizeRatio: ratios[idx] ?? 1,
      center,
    });
    if (created) added++;
  }
  // Normalize sizes for the CURRENT camera right away (also validates the
  // registry + watcher state).
  try {
    await refreshAgentLabelSizes(plugin);
  } catch {
    /* non-blocking */
  }
  requestCanvasDraw(plugin);
  return added;
}

/**
 * R176: restore a screenshot's FULL analysis view into the live viewer —
 * the visualization (hidden chains, hidden non-polymer, ball-and-stick
 * interface residues — after hiding every other ball-and-stick — distance
 * lines, cartoon transparency, chain-id colors), that screenshot's pair
 * labels, and finally the camera state captured with the screenshot.
 *
 * Best-effort per stage: each failure is logged and the next stage still
 * runs (a failed viz step must not prevent the camera restore).
 */
export async function restoreAnalysisView(
  viewer: MolstarViewer,
  spec: AnalysisViewSpec
): Promise<{ ok: boolean; detail: string }> {
  const plugin = (viewer as unknown as { plugin?: MolstarPlugin }).plugin;
  if (!plugin) return { ok: false, detail: "Viewer not available" };

  // 1. Full visualization re-application. cleanup_previous inside resets
  //    whatever the previous analysis/restore left behind (old sticks,
  //    lines, transparency, hidden chains, labels); _skipFocus keeps the
  //    camera untouched — the screenshot's own cameraState is applied below.
  const vizParams: Record<string, unknown> = { _skipFocus: true };
  if (spec.chain1 !== undefined) vizParams.chain1 = spec.chain1;
  if (spec.chain2 !== undefined) vizParams.chain2 = spec.chain2;
  if (Array.isArray(spec.interactions)) vizParams.interactions = spec.interactions;
  try {
    await applyRecipeVisualization(viewer, spec.recipe, vizParams);
  } catch (err) {
    console.warn("[analysis-view] applyRecipeVisualization failed:", err);
  }

  // 2. This screenshot's pair labels (tagged agent-label → toolbar toggle).
  let labelCount = 0;
  if (Array.isArray(spec.labels) && spec.labels.length > 0) {
    try {
      labelCount = await persistAnalysisLabels(viewer, spec.labels, spec.labelFontSize ?? 0.55);
    } catch (err) {
      console.warn("[analysis-view] persistAnalysisLabels failed:", err);
    }
  }

  // 3. The screenshot's camera — restored LAST so nothing moves it after.
  if (spec.cameraState) {
    restoreCameraViewState(plugin, spec.cameraState);
  }

  // 4. Flush the render pipeline so the restored view is visible at once.
  try {
    await nextFrame();
    requestCanvasDraw(plugin);
  } catch {
    /* ignore */
  }

  const parts = [
    `viz for ${spec.recipe}`,
    spec.chain1 && spec.chain2 ? `pair ${spec.chain1}-${spec.chain2}` : null,
    labelCount > 0 ? `${labelCount} labels` : null,
    spec.cameraState ? "camera" : null,
  ].filter(Boolean);
  return { ok: true, detail: `Restored analysis view (${parts.join(", ")})` };
}
