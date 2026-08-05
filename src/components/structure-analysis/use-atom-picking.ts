"use client";

/**
 * use-atom-picking
 *
 * Click-to-pick atom selection for distance/angle measurement.
 *
 * When `measureMode` is "distance" or "angle":
 *  1. Snapshots the current representation, then switches to "atomic-detail"
 *     (ball-and-stick) so individual atoms are easily clickable.
 *  2. Sets interactivity granularity to "element" (atom-level picking).
 *  3. Disables Molstar's default click-to-focus (prevents camera jumps).
 *  4. Subscribes to `plugin.behaviors.interaction.click` (the only working
 *     click observable in the prebuilt bundle — `events.interactivity.click`
 *     does NOT exist and was a dead fallback).
 *  5. Accumulates clicked loci (2 for distance, 3 for angle), updating a
 *     live `measureProgress` state in the store for the UI indicator.
 *  6. Extracts a readable residue/atom label directly from the
 *     StructureElement.Loci's `elements[0]` — NOT via the fragile
 *     `lociLabels.getLabels()` round-trip.
 *  7. Calls `plugin.managers.structure.measurement.addDistance/addAngle`.
 *  8. On exit, restores the original representation.
 */

import { useEffect, useRef, useCallback } from "react";
import { useAppStore } from "@/lib/molcraft/store";
import type { MolstarViewer, MolstarPlugin } from "@/lib/molcraft/types";

interface PickedAtom {
  loci: unknown;
  label: string;
}

/**
 * Extract the loci from a click event payload.
 * Molstar's `behaviors.interaction.click` emits:
 *   { current: { loci: StructureElement.Loci }, buttons, button, modifiers }
 * The `current.loci` is `Empty` when the click missed all geometry.
 */
function extractLoci(evt: unknown): unknown | null {
  const e = evt as Record<string, unknown>;
  if (e?.current && typeof e.current === "object") {
    const current = e.current as Record<string, unknown>;
    if (current.loci) return current.loci;
  }
  if (e?.loci) return e.loci;
  return null;
}

/**
 * Check if a loci is empty (no elements selected).
 */
function isLociEmpty(loci: unknown): boolean {
  if (!loci) return true;
  const l = loci as { elements?: unknown[]; kind?: string };
  if (l.kind === "empty-loci") return true;
  if (l.elements && Array.isArray(l.elements)) {
    return l.elements.length === 0;
  }
  return false;
}

/**
 * Get a readable label for a picked atom by directly introspecting the
 * StructureElement.Loci's first element.
 *
 * Verified loci shape (from the prebuilt bundle's click event):
 *   {
 *     kind: "element-loci",
 *     structure: Structure,
 *     elements: Array<{ unit: Unit; indices: number | Int32Array }>
 *   }
 *
 * `unit` has:
 *   - `residueIndex`: Int32Array (atom index → residue index)
 *   - `chainIndex`: Int32Array (atom index → chain index)
 *   - `model.atomicHierarchy.atoms.label_comp_id`: { value(i) → "PRO" }
 *   - `model.atomicHierarchy.atoms.label_atom_id`: { value(i) → "CA" }
 *   - `model.atomicHierarchy.residues.auth_seq_id`: { value(i) → 1 }
 *   - `model.atomicHierarchy.chains.auth_asym_id`: { value(i) → "A" }
 */
function getLociLabel(plugin: MolstarPlugin, loci: unknown): string {
  try {
    const l = loci as {
      elements?: Array<{
        unit?: {
          residueIndex?: Int32Array;
          chainIndex?: Int32Array;
          model?: {
            atomicHierarchy?: {
              atoms?: {
                label_comp_id?: { value?: (i: number) => string };
                label_atom_id?: { value?: (i: number) => string };
              };
              residues?: {
                auth_seq_id?: { value?: (i: number) => number };
              };
              chains?: {
                auth_asym_id?: { value?: (i: number) => string };
                label_asym_id?: { value?: (i: number) => string };
              };
            };
          };
        };
        indices?: number | Int32Array | { size: number; valueAt: (i: number) => number };
      }>;
    };
    const el = l?.elements?.[0];
    if (!el?.unit) return "atom";
    const unit = el.unit as any;
    const indices = el.indices as any;

    // Resolve the atom index.
    // In the prebuilt bundle, `el.indices` is stored as a float64-encoded
    // packed reference: the low 32 bits contain the atom index. We unpack
    // it via a Float64Array → Uint32Array view.
    let atomIdx: number;
    if (typeof indices === "number") {
      const buf = new ArrayBuffer(8);
      const f64 = new Float64Array(buf);
      const u32 = new Uint32Array(buf);
      f64[0] = indices;
      atomIdx = u32[0];
    } else if (indices?.valueAt) {
      atomIdx = indices.valueAt(0);
    } else if (Array.isArray(indices) || indices?.length !== undefined) {
      atomIdx = indices[0];
    } else {
      return "atom";
    }

    const ri = unit.residueIndex;
    const ci = unit.chainIndex;
    if (!ri || typeof atomIdx !== "number") return "atom";

    const resIdx = ri[atomIdx];
    if (resIdx === undefined) return "atom";

    const hierarchy = unit.model?.atomicHierarchy;
    if (!hierarchy) return "atom";

    const atoms = hierarchy.atoms;
    const residues = hierarchy.residues;
    const chains = hierarchy.chains;

    const resName = atoms?.label_comp_id?.value?.(resIdx);
    const atomName = atoms?.label_atom_id?.value?.(resIdx);
    const seqId = residues?.auth_seq_id?.value?.(resIdx);

    // Chain index: `chainIndex` is an Int32Array keyed by atom index
    let chainId: string | undefined;
    if (ci) {
      const chainIdx = ci[atomIdx];
      if (chainIdx !== undefined) {
        chainId = chains?.auth_asym_id?.value?.(chainIdx)
          ?? chains?.label_asym_id?.value?.(chainIdx);
      }
    }

    // Build label: "PRO A1 CA" or "PRO 1 CA" or "PRO A1" etc.
    const parts: string[] = [];
    if (resName) parts.push(resName);
    if (chainId) parts.push(chainId);
    if (seqId !== undefined) parts.push(String(seqId));
    if (atomName) parts.push(atomName);
    if (parts.length > 0) return parts.join(" ");
  } catch {
    // fall through to secondary path
  }

  // Secondary: lociLabels.getLabels() after a highlight round-trip
  try {
    const ll = plugin.managers.lociLabels as
      | { getLabels?: () => string[] | unknown[] }
      | undefined;
    const interactivity = plugin.managers.interactivity as
      | {
          lociHighlights?: { highlightOnly?: (args: { loci: unknown }) => void; clearHighlights?: () => void };
        }
      | undefined;
    if (ll?.getLabels && interactivity?.lociHighlights?.highlightOnly) {
      interactivity.lociHighlights.highlightOnly({ loci });
      const labels = ll.getLabels() as string[];
      if (interactivity.lociHighlights.clearHighlights) {
        interactivity.lociHighlights.clearHighlights();
      }
      if (labels && labels.length > 0) {
        const text = String(labels[0]).trim();
        if (text && text !== "[object Object]") return text;
      }
    }
  } catch {
    // ignore
  }

  return "atom";
}

/**
 * Disable Molstar's default click-to-focus behavior so that clicking an atom
 * in measure mode doesn't zoom/focus the camera.
 */
function disableClickFocus(plugin: MolstarPlugin): () => void {
  try {
    const interaction = (plugin.canvas3d as any)?.interaction;
    if (!interaction?.props || !interaction.setProps) return () => {};
    const oldProps = { ...interaction.props };
    const oldClickCenterFocus = oldProps.clickCenterFocus
      ? { ...oldProps.clickCenterFocus }
      : undefined;
    const oldClickFocus = oldProps.clickFocus
      ? { ...oldProps.clickFocus }
      : undefined;
    interaction.setProps({
      ...oldProps,
      clickCenterFocus: { ...(oldProps.clickCenterFocus || {}), isDisabled: true },
      clickFocus: { ...(oldProps.clickFocus || {}), isDisabled: true },
    });
    return () => {
      try {
        interaction.setProps({
          ...oldProps,
          clickCenterFocus: oldClickCenterFocus || { isDisabled: false },
          clickFocus: oldClickFocus || { isDisabled: false },
        });
      } catch {
        // ignore
      }
    };
  } catch {
    return () => {};
  }
}

/**
 * Add a ball-and-stick representation ON TOP of the existing cartoon,
 * without removing the cartoon. This makes individual atoms clickable
 * while preserving the cartoon overview. Returns a restore function
 * that removes the added representation.
 *
 * Uses plugin.builders.structure.representation.addRepresentation which
 * is the correct API (NOT managers.structure.component.addRepresentation
 * which doesn't exist in the prebuilt bundle).
 */
async function overlaySticks(plugin: MolstarPlugin): Promise<() => void> {
  try {
    const structs = plugin.managers.structure.hierarchy.current.structures;
    if (!structs || structs.length === 0) return () => {};

    const addedRepresentations: Array<{ component: any; repr: any }> = [];
    const reprBuilder = (plugin as any)?.builders?.structure?.representation;
    const reprRegistry = (plugin as any)?.representation?.structure?.registry;

    if (!reprBuilder?.addRepresentation) return () => {};

    for (const struct of structs as any[]) {
      const components = struct?.components ?? [];
      for (const comp of components) {
        try {
          // Only add sticks to polymer components (skip water/ligands)
          const label = comp?.cell?.obj?.label || "";
          const tags = comp?.cell?.transform?.tags || [];
          if (
            !tags.includes("structure-component-static-polymer") &&
            label !== "Polymer"
          ) {
            continue;
          }
          // Build the representation params. The addRepresentation API
          // expects {type: registry.get("ball-and-stick")} as the 2nd arg.
          const reprType = reprRegistry?.get
            ? reprRegistry.get("ball-and-stick")
            : "ball-and-stick";
          const repr = await reprBuilder.addRepresentation(comp, {
            type: reprType,
          });
          if (repr) {
            addedRepresentations.push({ component: comp, repr });
          }
        } catch {
          // ignore individual component errors
        }
      }
    }

    return () => {
      for (const { component, repr } of addedRepresentations) {
        try {
          if (repr) {
            // Remove via the state builder
            const build = (plugin as any)?.state?.data?.build();
            if (build && repr.cell?.transform?.ref) {
              build.delete(repr.cell.transform.ref).commit();
            }
          }
        } catch {
          // ignore
        }
      }
    };
  } catch {
    return () => {};
  }
}

export function useAtomPicking() {
  const viewer = useAppStore((s) => s.viewer);
  const measureMode = useAppStore((s) => s.measureMode);
  const setMeasureMode = useAppStore((s) => s.setMeasureMode);
  const setMeasureProgress = useAppStore((s) => s.setMeasureProgress);
  const addMeasurement = useAppStore((s) => s.addMeasurement);
  const toast = useAppStore((s) => s.toast);
  const pendingRef = useRef<PickedAtom[]>([]);
  const restoreFocusRef = useRef<(() => void) | null>(null);
  const restoreReprRef = useRef<(() => void) | null>(null);

  // Clear pending atoms when mode changes
  useEffect(() => {
    pendingRef.current = [];
  }, [measureMode]);

  // Main effect: subscribe to clicks when in measure mode
  useEffect(() => {
    if (!viewer || measureMode === "off") {
      // Restore default behavior
      if (restoreFocusRef.current) {
        try { restoreFocusRef.current(); } catch { /* ignore */ }
        restoreFocusRef.current = null;
      }
      if (restoreReprRef.current) {
        try { restoreReprRef.current(); } catch { /* ignore */ }
        restoreReprRef.current = null;
      }
      return;
    }

    let sub: { unsubscribe(): void } | null = null;
    try {
      const plugin = viewer.plugin;
      if (!plugin) return;

    // 1. Overlay ball-and-stick on top of the existing cartoon so individual
    //    atoms are clickable without losing the cartoon overview.
    overlaySticks(plugin).then((restore) => {
      restoreReprRef.current = restore;
    }).catch(() => {
      // ignore — sticks overlay is best-effort
    });

    // 2. Set granularity to element (atom-level)
    try {
      plugin.managers.interactivity.setProps({ granularity: "element" });
    } catch { /* ignore */ }

    // 3. Clear any existing selection AND highlights so that the user
    //    starts fresh at 0/2. Without this, a previously-highlighted atom
    //    (from hovering or a prior click) gets counted as the first pick.
    try {
      plugin.managers.structure.selection.clear();
      plugin.managers.interactivity.lociSelects.deselectAll();
      plugin.managers.interactivity.lociHighlights.clearHighlights();
    } catch { /* ignore */ }

    // 4. Disable click-to-focus
    restoreFocusRef.current = disableClickFocus(plugin);

    // 5. Subscribe to clicks — ONLY behaviors.interaction.click works
    //    (events.interactivity.click does NOT exist in the prebuilt bundle)
    const clickObs = (plugin as any)?.behaviors?.interaction?.click;
    if (!clickObs?.subscribe) {
      toast("Atom picking not available in this viewer version", "error");
      return;
    }

    const needed = measureMode === "distance" ? 2 : 3;
    setMeasureProgress({ picked: 0, needed });

    const sub_obj = clickObs.subscribe((evt: unknown) => {
      try {
        const loci = extractLoci(evt);
        if (!loci || isLociEmpty(loci)) {
          return;
        }

        // Highlight for visual feedback
        try {
          plugin.managers.interactivity.lociHighlights.highlightOnly({ loci });
        } catch { /* ignore */ }

        const label = getLociLabel(plugin, loci);
        pendingRef.current.push({ loci, label });

        const picked = pendingRef.current.length;
        setMeasureProgress({ picked, needed });

        if (picked < needed) {
          toast(`Picked ${picked}/${needed}: ${label}`, "info");
        } else {
          // We have enough atoms — perform the measurement
          const done = pendingRef.current;
          pendingRef.current = [];

          const mm = plugin.managers.structure.measurement;
          if (measureMode === "distance" && done.length >= 2) {
            mm.addDistance(done[0].loci, done[1].loci)
              .then(() => {
                addMeasurement({
                  mode: "distance",
                  label: `${done[0].label} ↔ ${done[1].label}`,
                  detail: "measured",
                });
                toast("Distance measurement added", "success");
              })
              .catch(() => toast("Distance measurement failed", "error"));
          } else if (measureMode === "angle" && done.length >= 3) {
            mm.addAngle(done[0].loci, done[1].loci, done[2].loci)
              .then(() => {
                addMeasurement({
                  mode: "angle",
                  label: `${done[0].label} ∠ ${done[1].label} ∠ ${done[2].label}`,
                  detail: "measured",
                });
                toast("Angle measurement added", "success");
              })
              .catch(() => toast("Angle measurement failed", "error"));
          }

          // Auto-exit pick mode after measurement
          setMeasureMode("off");
        }
      } catch (err) {
        console.warn("[atom-picking] click handler error:", err);
      }
    });
    sub = sub_obj;
    } catch (err) {
      console.warn("[atom-picking] setup error:", err);
      toast("Atom picking setup failed — check console", "error");
      return;
    }

    return () => {
      try { sub?.unsubscribe(); } catch { /* ignore */ }
      pendingRef.current = [];
      if (restoreFocusRef.current) {
        try { restoreFocusRef.current(); } catch { /* ignore */ }
        restoreFocusRef.current = null;
      }
      if (restoreReprRef.current) {
        try { restoreReprRef.current(); } catch { /* ignore */ }
        restoreReprRef.current = null;
      }
      try {
        viewer.plugin.managers.interactivity.lociHighlights.clearHighlights();
      } catch { /* ignore */ }
    };
  }, [viewer, measureMode, addMeasurement, setMeasureMode, setMeasureProgress, toast]);

  const cancelPicking = useCallback(() => {
    pendingRef.current = [];
    setMeasureMode("off");
  }, [setMeasureMode]);

  return { cancelPicking };
}
