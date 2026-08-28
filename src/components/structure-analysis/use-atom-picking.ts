"use client";

/**
 * use-atom-picking — click-to-pick atom selection for measurement.
 *
 * Faithfully replicates Molcraft's MeasureToolbar click-to-pick path:
 *  - Uses `disableFocusBehaviors` from `@/lib/molcraft/measure` which
 *    snapshots Molstar's click-focus props, sets interactivity granularity
 *    to "element", and overlays a semi-transparent ball-and-stick repr so
 *    individual atoms are clickable without losing the cartoon overview.
 *  - Subscribes to `plugin.behaviors.interaction.click`.
 *  - Accumulates clicked loci (2 for distance, 3 for angle, 4 for dihedral,
 *    1 for label).
 *  - Extracts 3D coords + a readable label via `extractAtomInfoFromLoci`.
 *  - Computes distance (Å) / angle (°) / dihedral (°) client-side and
 *    pushes an `interactionLine` (per-item removable) + a `measurement`
 *    entry linked by `lineId`.
 *  - Calls `setPendingAtoms` so the MeasureOverlay canvas can render the
 *    `#1`/`#2`/… spheres between React commits.
 *  - On exit, restores the original representation via the cleanup fn
 *    returned by `disableFocusBehaviors`.
 */

import { useEffect, useRef, useCallback } from "react";
import { useAppStore } from "@/lib/molcraft/store";
import {
  extractAtomInfoFromLoci,
  disableFocusBehaviors,
  clearAllMeasurementsAndFocus,
  type AtomInfo,
} from "@/lib/molcraft/measure";
import { setPendingAtoms } from "@/components/molcraft-molstar/measure-overlay";
import { addAgentLabel, countAgentLabels } from "@/lib/molcraft/commands/label-lifecycle";
import { getLociCenter } from "@/lib/molcraft/commands/label-sizing";

const DIST_COLOR = "#f59e0b"; // amber-500 — matches Molcraft distance lines
const ANGLE_COLOR = "#8b5cf6"; // violet-500 — matches Molcraft angle lines
const DIHEDRAL_COLOR = "#06b6d4"; // cyan-500

function extractLoci(evt: unknown): unknown | null {
  const e = evt as Record<string, unknown>;
  if (e?.current && typeof e.current === "object") {
    const current = e.current as Record<string, unknown>;
    if (current.loci) return current.loci;
  }
  if (e?.loci) return e.loci;
  return null;
}

function isLociEmpty(loci: unknown): boolean {
  if (!loci) return true;
  const l = loci as { elements?: unknown[]; kind?: string };
  if (l.kind === "empty-loci") return true;
  if (l.elements && Array.isArray(l.elements)) {
    return l.elements.length === 0;
  }
  return false;
}

function dist3(a: AtomInfo, b: AtomInfo): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

/** Angle (degrees) at vertex `b` formed by points a–b–c. */
function angleDeg(a: AtomInfo, b: AtomInfo, c: AtomInfo): number {
  const v1 = [a.x - b.x, a.y - b.y, a.z - b.z];
  const v2 = [c.x - b.x, c.y - b.y, c.z - b.z];
  const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
  const n1 = Math.hypot(...v1);
  const n2 = Math.hypot(...v2);
  if (n1 === 0 || n2 === 0) return 0;
  const cos = Math.max(-1, Math.min(1, dot / (n1 * n2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Dihedral angle (degrees) along bond b–c, with a attached to b and d to c. */
function dihedralDeg(a: AtomInfo, b: AtomInfo, c: AtomInfo, d: AtomInfo): number {
  const vsub = (p: AtomInfo, q: AtomInfo) => [p.x - q.x, p.y - q.y, p.z - q.z];
  const cross = (u: number[], v: number[]) => [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const b1 = vsub(b, a);
  const b2 = vsub(c, b);
  const b3 = vsub(d, c);
  const n1 = cross(b1, b2);
  const n2 = cross(b2, b3);
  const m1 = cross(n1, b2);
  const x = dot(n1, n2);
  const y = dot(m1, n2);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function fmtLabel(a: AtomInfo): string {
  const parts: string[] = [];
  if (a.resname) parts.push(a.resname);
  if (a.resno !== undefined) parts.push(String(a.resno));
  if (a.chain) parts.push(`.${a.chain}`);
  if (a.atomName) parts.push(`/${a.atomName}`);
  return parts.length ? parts.join("") : a.label || "atom";
}

export function useAtomPicking() {
  const viewer = useAppStore((s) => s.viewer);
  const measureMode = useAppStore((s) => s.measureMode);
  const setMeasureMode = useAppStore((s) => s.setMeasureMode);
  const setMeasureProgress = useAppStore((s) => s.setMeasureProgress);
  const setPickedAtoms = useAppStore((s) => s.setPickedAtoms);
  const addMeasurement = useAppStore((s) => s.addMeasurement);
  const addInteractionLine = useAppStore((s) => s.addInteractionLine);
  const clearInteractionLines = useAppStore((s) => s.clearInteractionLines);
  const toast = useAppStore((s) => s.toast);

  const pendingRef = useRef<AtomInfo[]>([]);
  const restoreFocusRef = useRef<(() => void) | null>(null);

  // Reset pending picks when mode changes
  useEffect(() => {
    pendingRef.current = [];
    setPendingAtoms([]);
  }, [measureMode]);

  // Main effect: subscribe to clicks when in measure mode
  useEffect(() => {
    if (!viewer || measureMode === "off") {
      // Restore default behavior
      if (restoreFocusRef.current) {
        try { restoreFocusRef.current(); } catch { /* ignore */ }
        restoreFocusRef.current = null;
      }
      return;
    }

    const plugin = viewer.plugin;
    if (!plugin) return;

    let sub: { unsubscribe(): void } | null = null;
    let entryGuardUntil = 0;

    // 1. Disable focus behaviors + overlay ball-and-stick so atoms are clickable.
    //    Save camera state before and restore after to prevent re-framing.
    let cameraSnapshot: unknown = null;
    try {
      const cam = (plugin as any)?.canvas3d?.camera;
      if (cam?.getSnapshot) cameraSnapshot = cam.getSnapshot();
    } catch { /* ignore */ }

    disableFocusBehaviors(plugin)
      .then((restore) => {
        restoreFocusRef.current = restore;
        if (cameraSnapshot) {
          try {
            const cam = (plugin as any)?.canvas3d?.camera;
            if (cam?.setState) cam.setState(cameraSnapshot);
          } catch { /* ignore */ }
        }
      })
      .catch(() => {
        // best-effort — atoms may still be clickable via Molstar's default granularity
      });

    // 2. Clear any existing selection + highlights so user starts fresh at 0/N.
    try {
      plugin.managers.structure.selection.clear();
      plugin.managers.interactivity.lociSelects.deselectAll();
      plugin.managers.interactivity.lociHighlights.clearHighlights();
    } catch { /* ignore */ }

    // 3. Subscribe to clicks — behaviors.interaction.click is the working
    //    observable in the prebuilt bundle.
    const clickObs = (plugin as any)?.behaviors?.interaction?.click;
    if (!clickObs?.subscribe) {
      toast("Atom picking not available in this viewer version", "error");
      return;
    }

    const needed =
      measureMode === "distance" ? 2 :
      measureMode === "angle" ? 3 :
      measureMode === "dihedral" ? 4 :
      measureMode === "label" ? 1 : 0;
    setMeasureProgress({ picked: 0, needed });

    // 500ms entry guard — ignore stale click events from before measure mode.
    entryGuardUntil = Date.now() + 500;

    const commitMeasurement = (atoms: AtomInfo[]) => {
      const mm = plugin.managers.structure.measurement;
      if (measureMode === "distance" && atoms.length >= 2) {
        const [a0, a1] = atoms;
        const d = dist3(a0, a1);
        const lineId = `ml-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        addInteractionLine({
          id: lineId,
          from: { x: a0.x, y: a0.y, z: a0.z, label: fmtLabel(a0) },
          to: { x: a1.x, y: a1.y, z: a1.z, label: fmtLabel(a1) },
          color: DIST_COLOR,
          label: `${d.toFixed(2)} Å`,
        });
        addMeasurement({
          mode: "distance",
          label: `${fmtLabel(a0)} ↔ ${fmtLabel(a1)}`,
          detail: `${d.toFixed(2)} Å`,
          atoms: [
            { x: a0.x, y: a0.y, z: a0.z, label: fmtLabel(a0) },
            { x: a1.x, y: a1.y, z: a1.z, label: fmtLabel(a1) },
          ],
          lineId,
        });
        toast(`Distance: ${d.toFixed(2)} Å`, "success");
      } else if (measureMode === "angle" && atoms.length >= 3) {
        const [a0, a1, a2] = atoms;
        const ang = angleDeg(a0, a1, a2);
        const lineId = `ml-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        addInteractionLine({
          id: lineId,
          from: { x: a0.x, y: a0.y, z: a0.z, label: fmtLabel(a0) },
          to: { x: a1.x, y: a1.y, z: a1.z, label: fmtLabel(a1) },
          color: ANGLE_COLOR,
        });
        const lineId2 = `ml-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-b`;
        addInteractionLine({
          id: lineId2,
          from: { x: a1.x, y: a1.y, z: a1.z, label: fmtLabel(a1) },
          to: { x: a2.x, y: a2.y, z: a2.z, label: fmtLabel(a2) },
          color: ANGLE_COLOR,
          label: `${ang.toFixed(1)}°`,
        });
        addMeasurement({
          mode: "angle",
          label: `${fmtLabel(a0)} ∠ ${fmtLabel(a1)} ∠ ${fmtLabel(a2)}`,
          detail: `${ang.toFixed(1)}°`,
          atoms: [
            { x: a0.x, y: a0.y, z: a0.z, label: fmtLabel(a0) },
            { x: a1.x, y: a1.y, z: a1.z, label: fmtLabel(a1) },
            { x: a2.x, y: a2.y, z: a2.z, label: fmtLabel(a2) },
          ],
          lineId: lineId,
        });
        toast(`Angle: ${ang.toFixed(1)}°`, "success");
      } else if (measureMode === "dihedral" && atoms.length >= 4) {
        const [a0, a1, a2, a3] = atoms;
        const dih = Math.abs(dihedralDeg(a0, a1, a2, a3));
        const lineId = `ml-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        addInteractionLine({
          id: lineId,
          from: { x: a0.x, y: a0.y, z: a0.z, label: fmtLabel(a0) },
          to: { x: a1.x, y: a1.y, z: a1.z, label: fmtLabel(a1) },
          color: DIHEDRAL_COLOR,
        });
        const lineId2 = `ml-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-b`;
        addInteractionLine({
          id: lineId2,
          from: { x: a1.x, y: a1.y, z: a1.z, label: fmtLabel(a1) },
          to: { x: a2.x, y: a2.y, z: a2.z, label: fmtLabel(a2) },
          color: DIHEDRAL_COLOR,
        });
        const lineId3 = `ml-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-c`;
        addInteractionLine({
          id: lineId3,
          from: { x: a2.x, y: a2.y, z: a2.z, label: fmtLabel(a2) },
          to: { x: a3.x, y: a3.y, z: a3.z, label: fmtLabel(a3) },
          color: DIHEDRAL_COLOR,
          label: `${dih.toFixed(1)}°`,
        });
        addMeasurement({
          mode: "dihedral",
          label: `${fmtLabel(a0)}–${fmtLabel(a1)}–${fmtLabel(a2)}–${fmtLabel(a3)}`,
          detail: `${dih.toFixed(1)}°`,
          atoms: [
            { x: a0.x, y: a0.y, z: a0.z, label: fmtLabel(a0) },
            { x: a1.x, y: a1.y, z: a1.z, label: fmtLabel(a1) },
            { x: a2.x, y: a2.y, z: a2.z, label: fmtLabel(a2) },
            { x: a3.x, y: a3.y, z: a3.z, label: fmtLabel(a3) },
          ],
          lineId,
        });
        toast(`Dihedral: ${dih.toFixed(1)}°`, "success");
      } else if (measureMode === "label" && atoms.length >= 1) {
        const a0 = atoms[0];
        // Use Molstar's native label (drawn in 3D, no per-item overlay line).
        // R173: the bundle's addLabel only reads labelParams/visualParams — the
        // old flat { customText } was silently DROPPED (default loci text
        // rendered instead), and the default placement (middle-center, no
        // tether, offsetZ 0) rendered the text half-buried in the cartoon,
        // which read as "label 偏移" while rotating. Floating placement + the
        // agent tag (toolbar show/hide toggle) fixes both.
        // R175: addAgentLabel also registers the anchor for live
        // distance-compensated resizing (same screen size at every angle).
        try {
          void addAgentLabel(plugin, a0.loci, {
            text: fmtLabel(a0),
            slot: countAgentLabels(plugin),
            center: getLociCenter(a0.loci),
          });
        } catch { /* ignore */ }
        addMeasurement({
          mode: "label",
          label: fmtLabel(a0),
          detail: "labeled",
        });
        toast(`Label added: ${fmtLabel(a0)}`, "success");
      }
    };

    const sub_obj = clickObs.subscribe((evt: unknown) => {
      if (Date.now() < entryGuardUntil) return; // ignore stale events
      try {
        const loci = extractLoci(evt);
        if (!loci || isLociEmpty(loci)) return;

        // Highlight for visual feedback
        try {
          plugin.managers.interactivity.lociHighlights.highlightOnly({ loci });
        } catch { /* ignore */ }

        const info = extractAtomInfoFromLoci(plugin, loci);
        if (!info) {
          toast("Could not read atom — try clicking another atom", "info");
          return;
        }
        pendingRef.current.push(info);
        setPickedAtoms(pendingRef.current.map(fmtLabel));
        setPendingAtoms(
          pendingRef.current.map((a) => ({ x: a.x, y: a.y, z: a.z, label: fmtLabel(a) }))
        );

        const picked = pendingRef.current.length;
        setMeasureProgress({ picked, needed });

        if (picked < needed) {
          toast(`Picked ${picked}/${needed}: ${fmtLabel(info)}`, "info");
        } else {
          // Enough atoms — perform the measurement.
          const done = pendingRef.current;
          pendingRef.current = [];
          setPendingAtoms([]);
          commitMeasurement(done);
          // Reset for the next measurement — stay in measure mode so the
          // user can make multiple measurements without re-clicking the button.
          pendingRef.current = [];
          setMeasureProgress({ picked: 0, needed });
          setPickedAtoms([]);
        }
      } catch (err) {
        console.warn("[atom-picking] click handler error:", err);
      }
    });
    sub = sub_obj;
    // no-op reference to satisfy linter for `mm` usage below
    void clearInteractionLines;

    return () => {
      try { sub?.unsubscribe(); } catch { /* ignore */ }
      pendingRef.current = [];
      setPendingAtoms([]);
      if (restoreFocusRef.current) {
        try { restoreFocusRef.current(); } catch { /* ignore */ }
        restoreFocusRef.current = null;
      }
      try {
        plugin.managers.interactivity.lociHighlights.clearHighlights();
      } catch { /* ignore */ }
    };
  }, [viewer, measureMode, addMeasurement, addInteractionLine, setMeasureProgress, setPickedAtoms, toast]);

  // Clear ALL measurements + interaction lines + focus when the viewer unmounts.
  useEffect(() => {
    return () => {
      if (viewer) {
        try { clearAllMeasurementsAndFocus(viewer.plugin); } catch { /* ignore */ }
      }
      clearInteractionLines();
    };
  }, [viewer, clearInteractionLines]);

  const cancelPicking = useCallback(() => {
    pendingRef.current = [];
    setPendingAtoms([]);
    setMeasureMode("off");
  }, [setMeasureMode]);

  return { cancelPicking };
}
