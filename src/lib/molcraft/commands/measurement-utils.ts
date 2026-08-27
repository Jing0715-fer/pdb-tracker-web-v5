/**
 * Measurement utilities — selective (ref-based) measurement cell management.
 *
 * R167 (MOL-M4): the previous capture cleanup used a COUNT-delta +
 * `measurement.removeLast()` strategy, but `removeLast` does NOT exist on
 * the prebuilt bundle's MeasurementManager (the only `removeLast` in
 * molstar.js belongs to an internal linked-list). The fallback therefore
 * always ran `measurement.clear()` — wiping USER-added distances/labels
 * along with the viz-added ones. `cleanup_previous` in recipe-viz.ts also
 * called `measurement.clear()` unconditionally, destroying user
 * measurements even when nothing had leaked.
 *
 * All measurement cells (distances, labels, angles, dihedrals) live under a
 * single state-tree group tagged 'measurement-group'. Each item in
 * `measurement.state.items` carries the state cell, whose `transform.ref`
 * identifies it in the state tree. Snapshotting the ref set before a
 * visualization and deleting only the ADDED refs afterwards removes exactly
 * what we drew — user measurements survive.
 */

import type { MolstarPlugin } from "../types";

/**
 * Snapshot the state-cell refs of all current measurement items.
 *
 * Returns:
 *   - string[] (possibly empty) when `state.items` is an array — the refs of
 *     every current measurement cell.
 *   - null when the state shape is unexpected (bundle change) — callers
 *     should fall back to legacy behavior rather than assume "no items".
 */
export function snapshotMeasurementRefs(plugin: MolstarPlugin): string[] | null {
  try {
    const meas = plugin.managers.structure.measurement as unknown as {
      state?: { items?: unknown };
    };
    const items = meas?.state?.items;
    if (!Array.isArray(items)) return null;
    const refs: string[] = [];
    for (const it of items as Array<Record<string, unknown>>) {
      const cell = it?.cell as
        | { transform?: { ref?: string }; ref?: string }
        | undefined;
      const ref = cell?.transform?.ref ?? cell?.ref;
      if (typeof ref === "string" && ref.length > 0) refs.push(ref);
    }
    return refs;
  } catch {
    return null;
  }
}

/** Compute the refs present in `after` but absent from `before`. */
export function diffMeasurementRefs(before: string[] | null, after: string[] | null): string[] {
  if (!after) return [];
  if (!before) return after;
  const beforeSet = new Set(before);
  return after.filter((r) => !beforeSet.has(r));
}

/**
 * Remove specific measurement cells from the state tree.
 * Cells not found (already removed) are skipped silently.
 */
export async function removeMeasurementCells(
  plugin: MolstarPlugin,
  refs: string[]
): Promise<number> {
  if (!refs || refs.length === 0) return 0;
  try {
    const state = (plugin as unknown as {
      state?: { data?: { build?: () => unknown } };
    }).state;
    const build = state?.data?.build;
    if (typeof build !== "function") return 0;
    const builder = build() as {
      delete?: (ref: string) => unknown;
      commit?: () => Promise<unknown>;
    } | undefined;
    if (typeof builder?.delete !== "function" || typeof builder.commit !== "function") {
      return 0;
    }
    let removed = 0;
    for (const ref of refs) {
      try {
        builder.delete(ref);
        removed++;
      } catch {
        /* ref no longer valid — skip */
      }
    }
    if (removed > 0) await builder.commit();
    return removed;
  } catch (err) {
    console.warn("[measurement-utils] removeMeasurementCells failed:", err);
    return 0;
  }
}
