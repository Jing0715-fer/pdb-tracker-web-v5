"use client";

/**
 * use-atom-picking
 *
 * Replicates Molcraft's click-to-pick atom selection pattern.
 *
 * When `measureMode` is "distance" or "angle", this hook:
 *  1. Sets interactivity granularity to "element" (atom-level picking)
 *  2. Disables Molstar's default click-to-focus (prevents sidechain disappearing)
 *  3. Subscribes to `plugin.behaviors.interactivity.click` (with `events.interactivity.click` fallback)
 *  4. Accumulates clicked loci (2 for distance, 3 for angle)
 *  5. Calls `plugin.managers.structure.measurement.addDistance/addAngle`
 *  6. Stores a readable label via `plugin.managers.lociLabels.getLabel`
 *
 * When `measureMode` is "off", restores default behavior.
 */

import { useEffect, useRef, useCallback } from "react";
import { useAppStore } from "@/lib/molcraft/store";
import type { MolstarViewer, MolstarPlugin } from "@/lib/molcraft/types";

interface PickedAtom {
  loci: unknown;
  label: string;
}

/**
 * Extract a human-readable label from a click event payload.
 * Molstar's click event payload shape: { current: { loci: StructureElement.Loci }, ... }
 * Fallback event payload shape: { state: { loci: ... } } or { loci: ... }
 */
function extractLoci(evt: unknown): unknown | null {
  const e = evt as Record<string, unknown>;
  // Primary: behaviors.interactivity.click → { current: { loci } }
  if (e?.current && typeof e.current === "object") {
    const current = e.current as Record<string, unknown>;
    if (current.loci) return current.loci;
  }
  // Fallback: events.interactivity.click → { state: { loci } }
  if (e?.state && typeof e.state === "object") {
    const state = e.state as Record<string, unknown>;
    if (state.loci) return state.loci;
  }
  // Direct loci
  if (e?.loci) return e.loci;
  return null;
}

/**
 * Check if a loci is empty (no elements selected).
 */
function isLociEmpty(loci: unknown): boolean {
  if (!loci) return true;
  const l = loci as { elements?: unknown[] };
  if (l.elements && Array.isArray(l.elements)) {
    return l.elements.length === 0;
  }
  return false;
}

/**
 * Get a readable label for a loci using Molstar's lociLabels manager.
 *
 * The prebuilt Molstar bundle's `LociLabelsManager` does NOT expose a
 * `getLabel(loci)` method (the previous code silently fell back to "atom").
 * Instead it exposes `getLabels()` which returns the labels currently being
 * highlighted. We trigger a highlight on the picked loci, read the labels,
 * then clear the highlight so the UI doesn't show a persistent marker.
 */
function getLociLabel(plugin: MolstarPlugin, loci: unknown): string {
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
        // Labels can be rich text; coerce to string and trim.
        const text = String(labels[0]).trim();
        if (text) return text;
      }
    }
  } catch {
    // ignore — fall through to loci-based fallback
  }
  // Fallback: best-effort label from the loci's first element residue info.
  try {
    const l = loci as {
      elements?: Array<{
        unit?: {
          residues?: Array<{ name?: string; seq?: { auth_seq_number?: number } }>;
        };
      }>;
    };
    const el = l?.elements?.[0];
    const residue = el?.unit?.residues?.[0];
    if (residue?.name && residue?.seq?.auth_seq_number !== undefined) {
      return `${residue.name} ${residue.seq.auth_seq_number}`;
    }
    if (residue?.name) return residue.name;
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
    // Return a restore function
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

export function useAtomPicking() {
  const viewer = useAppStore((s) => s.viewer);
  const measureMode = useAppStore((s) => s.measureMode);
  const setMeasureMode = useAppStore((s) => s.setMeasureMode);
  const addMeasurement = useAppStore((s) => s.addMeasurement);
  const toast = useAppStore((s) => s.toast);
  const pendingRef = useRef<PickedAtom[]>([]);
  const restoreFocusRef = useRef<(() => void) | null>(null);

  // Clear pending atoms when mode changes
  useEffect(() => {
    pendingRef.current = [];
  }, [measureMode]);

  // Main effect: subscribe to clicks when in measure mode
  useEffect(() => {
    if (!viewer || measureMode === "off") {
      // Restore default behavior
      if (restoreFocusRef.current) {
        try {
          restoreFocusRef.current();
        } catch {
          // ignore
        }
        restoreFocusRef.current = null;
      }
      return;
    }

    let sub: { unsubscribe(): void } | null = null;
    try {
      const plugin = viewer.plugin;
      if (!plugin) return;

    // 1. Set granularity to element (atom-level)
    try {
      plugin.managers.interactivity.setProps({ granularity: "element" });
    } catch {
      // ignore
    }

    // 2. Clear any existing selection
    try {
      plugin.managers.structure.selection.clear();
      plugin.managers.interactivity.lociSelects.deselectAll();
    } catch {
      // ignore
    }

    // 3. Disable click-to-focus
    restoreFocusRef.current = disableClickFocus(plugin);

    // 4. Subscribe to clicks
    // Try behaviors.interactivity.click first (Molcraft pattern), fallback to events.interactivity.click
    const clickObs =
      (plugin as any)?.behaviors?.interaction?.click ??
      (plugin as any)?.events?.interactivity?.click;

    if (!clickObs?.subscribe) {
      toast("Atom picking not available in this viewer version", "error");
      return;
    }

    const needed = measureMode === "distance" ? 2 : 3;

    const sub_obj = clickObs.subscribe((evt: unknown) => {
      try {
        const loci = extractLoci(evt);
        if (!loci || isLociEmpty(loci)) {
          // Click landed on empty space (no atom hit). The canvas3d hit-test
          // returns empty-loci when input.width/height is 0 (canvas not sized
          // correctly) OR when the click truly missed all geometry. Either
          // way, ignore — don't count it toward the measurement.
          return;
        }

        // Highlight for visual feedback
        try {
          plugin.managers.interactivity.lociHighlights.highlightOnly({ loci });
        } catch {
          // ignore
        }

        const label = getLociLabel(plugin, loci);
        pendingRef.current.push({ loci, label });

        if (pendingRef.current.length < needed) {
          toast(
            `Picked ${pendingRef.current.length}/${needed}: ${label}`,
            "info"
          );
        } else {
          // We have enough atoms — perform the measurement
          const picked = pendingRef.current;
          pendingRef.current = [];

          const mm = plugin.managers.structure.measurement;
          if (measureMode === "distance" && picked.length >= 2) {
            mm.addDistance(picked[0].loci, picked[1].loci)
              .then(() => {
                addMeasurement({
                  mode: "distance",
                  label: `${picked[0].label} ↔ ${picked[1].label}`,
                  detail: "measured",
                });
                toast("Distance measurement added", "success");
              })
              .catch(() => toast("Distance measurement failed", "error"));
          } else if (measureMode === "angle" && picked.length >= 3) {
            mm.addAngle(picked[0].loci, picked[1].loci, picked[2].loci)
              .then(() => {
                addMeasurement({
                  mode: "angle",
                  label: `${picked[0].label} ∠ ${picked[1].label} ∠ ${picked[2].label}`,
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
        // Silently ignore click processing errors to prevent UI crashes
        console.warn("[atom-picking] click handler error:", err);
      }
    });
    sub = sub_obj;
    } catch (err) {
      // If anything goes wrong setting up the subscription, log and return
      console.warn("[atom-picking] setup error:", err);
      toast("Atom picking setup failed — check console", "error");
      return;
    }

    return () => {
      try {
        sub?.unsubscribe();
      } catch {
        // ignore
      }
      pendingRef.current = [];
      // Restore default behavior
      if (restoreFocusRef.current) {
        try {
          restoreFocusRef.current();
        } catch {
          // ignore
        }
        restoreFocusRef.current = null;
      }
      // Clear highlights
      try {
        viewer.plugin.managers.interactivity.lociHighlights.clearHighlights();
      } catch {
        // ignore
      }
    };
  }, [viewer, measureMode, addMeasurement, setMeasureMode, toast]);

  // Cancel picking (exposed for UI buttons)
  const cancelPicking = useCallback(() => {
    pendingRef.current = [];
    setMeasureMode("off");
  }, [setMeasureMode]);

  return { cancelPicking };
}
