/**
 * Distance-compensated label sizing — fixes "有一些比较远的氨基酸的label
 * 很小看不清楚": Molstar text labels are true 3D geometry whose screen size
 * scales ~1/view-distance (the text vertex shader applies the corner offset in
 * clip space divided by the label center's view depth), so residues at the
 * BACK of a focused interface render much smaller text than front ones.
 *
 * Strategy: at label-creation time (the camera is already at the focused
 * interface view) measure each label anchor's distance to the camera and scale
 * textSize/sizeFactor by the ratio of its effective depth to the MEAN depth —
 * far labels grow, near labels shrink slightly, overall readability evens out.
 *
 * The constant toward-camera `offsetZ` (which every call site already uses to
 * defeat cartoon occlusion) is subtracted from the measured distance because
 * the label actually renders at (anchor distance − offsetZ).
 */

import type { MolstarPlugin } from "../types";

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Anchor center of a loci via the bundle's Loci.getCenter (Vec3). */
export function getLociCenter(loci: unknown): [number, number, number] | null {
  try {
    const Loci = (window as unknown as { molstar?: any }).molstar?.lib?.loci?.Loci;
    if (Loci && typeof Loci.getCenter === "function") {
      const c = Loci.getCenter(loci);
      if (c && typeof c[0] === "number" && typeof c[1] === "number" && typeof c[2] === "number") {
        return [c[0], c[1], c[2]];
      }
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** Live camera position (Vec3) — null when the camera is unavailable. */
export function getCameraPosition(plugin: MolstarPlugin): [number, number, number] | null {
  try {
    const p = (plugin as unknown as { canvas3d?: { camera?: { position?: unknown } } })
      ?.canvas3d?.camera?.position as unknown;
    if (p && typeof (p as ArrayLike<number>)[0] === "number") {
      return [(p as ArrayLike<number>)[0], (p as ArrayLike<number>)[1], (p as ArrayLike<number>)[2]];
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Per-label size ratio (dimensionless multiplier for textSize AND sizeFactor).
 *
 * @param plugin   viewer plugin (reads the live camera position)
 * @param centers  per-label anchor centers (null entries → ratio 1)
 * @param offsetZ  the constant toward-camera offset the labels render with (Å)
 * @returns ratios clamped to [0.85, 2.6]; all 1 when the camera or every
 *          center is unavailable (degrades gracefully, never throws).
 */
export function getLabelSizeRatios(
  plugin: MolstarPlugin,
  centers: Array<[number, number, number] | null>,
  offsetZ: number
): number[] {
  const n = centers.length;
  if (n === 0) return [];
  const ones = centers.map(() => 1);

  const camPos = getCameraPosition(plugin);
  if (!camPos) return ones;

  const dists: Array<number | null> = centers.map((c) => {
    if (!c) return null;
    const dx = c[0] - camPos![0];
    const dy = c[1] - camPos![1];
    const dz = c[2] - camPos![2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  });
  const valid = dists.filter((d): d is number => d != null);
  if (valid.length === 0) return ones;

  const mean = valid.reduce((s, d) => s + d, 0) / valid.length;
  const effMean = Math.max(mean - offsetZ, 1);
  return dists.map((d) => {
    if (d == null) return 1;
    const eff = Math.max(d - offsetZ, 1);
    return clamp(eff / effMean, 0.85, 2.6);
  });
}
