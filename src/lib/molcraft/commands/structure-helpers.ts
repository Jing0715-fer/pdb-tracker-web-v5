/**
 * Structure hierarchy helpers — access Molstar's structure/component tree.
 *
 * Extracted from commands.ts (R138) as part of the module split.
 */

import type { MolstarPlugin } from "../types";

/**
 * Get structures from the hierarchy, optionally filtered by index.
 * `which` can be "all", undefined (same as "all"), or a 0-based index.
 */
export function getStructures(
  plugin: MolstarPlugin,
  which: "all" | number | undefined
) {
  const all = plugin.managers.structure.hierarchy.current.structures;
  if (which === undefined || which === "all") return all;
  return all[which] ? [all[which]] : [];
}

/** Collect all components from the given structures. */
export function collectComponents(_plugin: MolstarPlugin, structures: unknown[]) {
  const comps: unknown[] = [];
  for (const s of structures as Array<{ components?: unknown[] }>) {
    if (s?.components) comps.push(...s.components);
  }
  return comps;
}

/** Get the data object of the first loaded structure (or null). */
export function getFirstStructureData(plugin: MolstarPlugin) {
  const s = plugin.managers.structure.hierarchy.current.structures[0];
  return s?.cell?.obj?.data ?? null;
}

/** Check if a Loci is empty (best-effort, structure-dependent). */
export function isLociEmpty(loci: unknown): boolean {
  if (!loci) return true;
  // Loci objects in molstar have an `elements` array; empty means no selection.
  const l = loci as { elements?: unknown[] };
  return !l.elements || l.elements.length === 0;
}
