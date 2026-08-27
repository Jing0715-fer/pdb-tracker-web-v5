/**
 * Selection utils — centralized clearing of Molstar selection visuals.
 *
 * R161 (green-box bug fix):
 *
 * The prebuilt Molstar bundle (public/molstar.js) exposes:
 *   - LociSelectManager: select / selectOnly / deselect / deselectAll / toggleSel
 *       → NO `clearHighlights()` method!
 *   - LociHighlightManager: highlight / highlightOnly / clearHighlights
 *
 * Previous code called `plugin.managers.interactivity.lociSelects.clearHighlights()`
 * which THROWS a TypeError (method does not exist). Because every call site
 * wrapped it in try/catch "best-effort", the error was silently swallowed and
 * the green selection boxes (canvas3d interactivity marks, action=select)
 * were NEVER cleared — they stayed visible in every screenshot.
 *
 * The correct API to clear the green boxes is `lociSelects.deselectAll()`:
 *   deselectAll() { this.sel.clear(); this.mark({ loci: EmptyLoci }, 8); }
 * The `mark(..., 8)` call is what actually removes the green rendering from
 * the canvas. `plugin.managers.structure.selection.clear()` alone only clears
 * the underlying selection DATA — it does not touch the canvas marks.
 *
 * All clearing should go through `clearAllSelectionVisuals()` below so the
 * behavior is consistent everywhere (before/after capture, between analyses).
 */

import type { MolstarPlugin } from "../types";

/**
 * Clear every source of selection/hover visuals in the viewer:
 *   1. lociSelects.deselectAll()  — removes green selection boxes (canvas marks)
 *   2. structure.selection.clear() — clears selection state/data
 *   3. lociSelects.deselectAll() again — belt & braces after data clear
 *   4. lociHighlights.clearHighlights() — removes hover highlight tint
 *
 * Safe to call at any time; every step is best-effort.
 */
export function clearAllSelectionVisuals(plugin: MolstarPlugin): void {
  try {
    plugin.managers.interactivity.lociSelects.deselectAll();
  } catch (err) {
    console.warn("[selection-utils] lociSelects.deselectAll failed:", err);
  }
  try {
    plugin.managers.structure.selection.clear();
  } catch (err) {
    console.warn("[selection-utils] selection.clear failed:", err);
  }
  // Deselect again AFTER clearing data — order matters for mark propagation.
  try {
    plugin.managers.interactivity.lociSelects.deselectAll();
  } catch { /* best-effort */ }
  try {
    plugin.managers.interactivity.lociHighlights.clearHighlights();
  } catch (err) {
    console.warn("[selection-utils] lociHighlights.clearHighlights failed:", err);
  }
}

/**
 * Clear selection visuals and wait for the renderer to flush the change so the
 * next screenshot frame does not contain a stale green box.
 */
export async function clearAllSelectionVisualsAndWait(
  plugin: MolstarPlugin,
  ms = 120
): Promise<void> {
  clearAllSelectionVisuals(plugin);
  await new Promise((r) => setTimeout(r, ms));
}
