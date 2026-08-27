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
 * R170: TWO more bundle-API mismatches discovered while diagnosing the
 * "labels point to wrong positions" user report:
 *   1. MeasurementManager.state has NO `items` array — it is
 *      `{ labels, distances, angles, dihedrals, orientations, planes,
 *         options }` (each an array of state cells). The R167
 *      `snapshotMeasurementRefs` read `state.items`, always got undefined,
 *      returned null — so the capture cleanup NEVER removed the drawn
 *      labels/lines and they LEAKED into every later screenshot.
 *   2. `measurement.clear()` does NOT exist either — every "clear
 *      measurements" button and agent cleanup silently no-op'd (TypeError
 *      swallowed by try/catch). The bundle-safe equivalent is deleting the
 *      whole 'measurement-group' tagged subtree from the state tree.
 *
 * All measurement cells (distances, labels, angles, dihedrals) live under a
 * single state-tree group tagged 'measurement-group'. Snapshotting the cell
 * refs before a visualization and deleting only the ADDED refs afterwards
 * removes exactly what we drew — user measurements survive.
 */

import type { MolstarPlugin } from "../types";

/** The per-kind arrays the bundle's MeasurementManager.state actually has. */
const MEASUREMENT_STATE_KEYS = [
  "labels",
  "distances",
  "angles",
  "dihedrals",
  "orientations",
  "planes",
] as const;

function cellRef(cell: unknown): string | null {
  const c = cell as { transform?: { ref?: string }; ref?: string } | null | undefined;
  const ref = c?.transform?.ref ?? c?.ref;
  return typeof ref === "string" && ref.length > 0 ? ref : null;
}

/**
 * Snapshot the state-cell refs of all current measurement items.
 *
 * Returns:
 *   - string[] (possibly empty) — refs of every current measurement cell
 *     across all six state arrays (labels/distances/angles/…).
 *   - null when the state shape is unexpected (bundle change) — callers
 *     should fall back rather than assume "no items".
 */
export function snapshotMeasurementRefs(plugin: MolstarPlugin): string[] | null {
  try {
    const meas = plugin.managers.structure.measurement as unknown as {
      state?: Record<string, unknown>;
    };
    const state = meas?.state;
    if (!state || typeof state !== "object") return null;
    // R170: the bundle state has per-kind arrays — require at least one
    // recognizable key so a completely different shape still yields null.
    const known = MEASUREMENT_STATE_KEYS.filter((k) => Array.isArray(state[k]));
    if (known.length === 0) return null;
    const refs: string[] = [];
    for (const key of known) {
      for (const cell of state[key] as unknown[]) {
        const ref = cellRef(cell);
        if (ref) refs.push(ref);
      }
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
    // R170 bugfix: `const build = data?.build; build()` DETACHES the method
    // from its owner — `this.tree` inside becomes undefined and every call
    // threw (silently caught, "removed 0/N" forever). Call it as a METHOD.
    const data = (plugin as unknown as { state?: { data?: { build?: () => unknown } } })
      .state?.data;
    if (typeof data?.build !== "function") return 0;
    const builder = data.build() as {
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

/**
 * R170: bundle-safe "clear all measurements" — deletes the whole
 * 'measurement-group' subtree from the state tree. This is the replacement
 * for the non-existent `measurement.clear()` API (10 call sites used it and
 * silently no-op'd). Returns the deleted group ref, or null when no
 * measurement group exists.
 */
export async function clearAllMeasurements(plugin: MolstarPlugin): Promise<string | null> {
  try {
    // R170 bugfix: call build() as a METHOD (see removeMeasurementCells).
    const data = (plugin as unknown as {
      state?: {
        data?: {
          cells?: Iterable<[string, { transform?: { tags?: unknown } }]>;
          build?: () => unknown;
        };
      };
    }).state?.data;
    const cells = data?.cells;
    if (!cells || typeof data?.build !== "function") return null;
    const builder = data.build() as {
      delete?: (ref: string) => unknown;
      commit?: () => Promise<unknown>;
    } | undefined;
    if (typeof builder?.delete !== "function" || typeof builder.commit !== "function") {
      return null;
    }
    let groupRef: string | null = null;
    for (const [ref, cell] of cells) {
      const tags = cell?.transform?.tags;
      if (Array.isArray(tags) && tags.includes("measurement-group")) {
        groupRef = ref;
        break;
      }
    }
    if (!groupRef) return null;
    builder.delete(groupRef);
    await builder.commit();
    return groupRef;
  } catch (err) {
    console.warn("[measurement-utils] clearAllMeasurements failed:", err);
    return null;
  }
}
