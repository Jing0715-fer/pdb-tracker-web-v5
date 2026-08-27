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

/**
 * R167 (MOL-M3): Build a StructureElement.Loci covering ALL non-polymer
 * entities (ligands / HETATMs) of the first structure by direct unit
 * traversal.
 *
 * Replaces the previous `selection.getLociFromExpression(...)` call — that
 * method does NOT exist in the prebuilt bundle (verified by grep), so the
 * old code always threw a TypeError straight into the catch block and the
 * component-scan fallback below it was unreachable. This traversal is
 * bundle-safe (uses only StructureElement/StructureProperties, same as
 * buildLociByTraversal) and needs no MolScript builder.
 *
 * Note: Location.create's 3rd argument is the ELEMENT (unit.elements[i]),
 * not the within-unit index — see the R166 multi-chain loci fix.
 */
export function buildNonPolymerLoci(plugin: MolstarPlugin): unknown | null {
  try {
    const bundle = (window as unknown as { molstar?: any }).molstar;
    const SE = bundle?.lib?.structure?.StructureElement;
    const SP = bundle?.lib?.structure?.StructureProperties;
    if (!SE || !SP) return null;

    const structs = plugin.managers.structure.hierarchy.current.structures;
    if (!structs.length) return null;
    const data = structs[0]?.cell?.obj?.data as { units?: Array<any> } | null;
    if (!data?.units) return null;

    const elementsByUnit = new Map<unknown, number[]>();
    for (const unit of data.units) {
      if (unit?.kind !== 0) continue; // atomic units only
      const indices: number[] = [];
      for (let i = 0; i < unit.elements.length; i++) {
        const loc = SE.Location.create(data, unit, unit.elements[i]);
        try {
          if (SP.entity.type(loc) === "non-polymer") indices.push(i);
        } catch {
          /* entity props unavailable for this location — skip atom */
        }
      }
      if (indices.length > 0) elementsByUnit.set(unit, indices);
    }
    if (elementsByUnit.size === 0) return null;

    const elements: Array<{ unit: unknown; indices: number[] }> = [];
    elementsByUnit.forEach((indices, unit) => elements.push({ unit, indices }));
    return new SE.Loci(data, elements);
  } catch (err) {
    console.warn("[structure-helpers] buildNonPolymerLoci failed:", err);
    return null;
  }
}
