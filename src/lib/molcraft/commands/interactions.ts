/**
 * Interactions helpers — show/clear interaction neighborhood visualizations.
 *
 * Extracted from commands.ts (R138) as part of the module split.
 */

import type { MolstarPlugin } from "../types";
import { isLociEmpty } from "./structure-helpers";
import { clearAllMeasurements } from "./measurement-utils";
import { getLociCenter } from "./label-sizing";

/**
 * R138→MOL2-04: Show the interaction neighborhood around a target loci.
 *
 * Creates a ball-and-stick component for all atoms within `radius` Å of the
 * target's center, plus highlights the target itself.
 *
 * The old implementation built the neighborhood with the MolScript builder
 * (`Q.struct.generator.within`) — which is NOT exposed on the prebuilt
 * bundle — so it always bailed out early while the caller still reported
 * ok:true ("Showing neighborhood within X Å"). This version builds a
 * StructureElement.Loci via each unit's `lookup3d` spatial index (the same
 * unit-traversal family as buildResidueLoci/buildChainLoci in recipe-viz.ts,
 * R170-proven on the bundle) and converts it with SE.Loci.toExpression.
 *
 * @returns whether the neighborhood component was actually created (the
 * caller reports an honest ok:false otherwise).
 */
export async function showInteractionsAround(
  plugin: MolstarPlugin,
  loci: unknown,
  radius: number
): Promise<boolean> {
  try {
    const bundle = (window as any).molstar;
    const SE = bundle?.lib?.structure?.StructureElement;
    if (!SE) {
      console.warn('[showInteractionsAround] StructureElement not available on the bundle');
      return false;
    }

    const structs = plugin.managers.structure.hierarchy.current.structures;
    if (!structs.length) {
      console.warn('[showInteractionsAround] No structure data available');
      return false;
    }
    const sr = structs[0] as any;
    const data = sr?.cell?.obj?.data;
    if (!data) {
      console.warn('[showInteractionsAround] No structure data available');
      return false;
    }

    // Center of the target. `loci` may be a whole Structure (the interactions
    // target resolver returns the raw structure when no target/selection was
    // given) — use its boundary sphere in that case; otherwise prefer the
    // bundle's Loci.getCenter (the same helper the R171 label sizing uses),
    // with the first loci element's unit boundary as the last-resort
    // approximation (the pre-MOL2-04 heuristic).
    let center: [number, number, number] | null = null;
    try {
      const asStructure = loci as {
        boundary?: { sphere?: { center?: { x: number; y: number; z: number } } };
      };
      const sc = asStructure?.boundary?.sphere?.center;
      if (sc && typeof sc.x === 'number' && typeof sc.y === 'number' && typeof sc.z === 'number') {
        center = [sc.x, sc.y, sc.z];
      }
    } catch { /* fall through */ }
    if (!center) center = getLociCenter(loci);
    if (!center) {
      try {
        const lociObj = loci as {
          elements?: Array<{ unit?: { boundary?: { sphere?: { center?: { x: number; y: number; z: number } } } } }>;
        };
        const b = lociObj?.elements?.[0]?.unit?.boundary?.sphere?.center;
        if (b && typeof b.x === 'number' && typeof b.y === 'number' && typeof b.z === 'number') {
          center = [b.x, b.y, b.z];
        }
      } catch { /* fall through */ }
    }
    if (!center) {
      const sb = data?.boundary?.sphere?.center;
      if (sb && typeof sb.x === 'number' && typeof sb.y === 'number' && typeof sb.z === 'number') {
        center = [sb.x, sb.y, sb.z];
      }
    }

    if (!center) {
      console.warn('[showInteractionsAround] no center available — skipping neighborhood visualization');
      return false;
    }

    // MOL2-04: neighborhood loci via per-unit `lookup3d` spatial queries —
    // the bundle-safe replacement for the unavailable MolScript `within`
    // query. `lookup3d.find(x, y, z, radius)` returns element indices as
    // positions WITHIN unit.elements, exactly what StructureElement.Loci
    // expects (same convention as buildResidueLoci).
    const elements: Array<{ unit: unknown; indices: number[] }> = [];
    for (const unit of data.units ?? []) {
      if (unit?.kind !== 0) continue; // atomic units only
      const lookup = unit.lookup3d;
      if (!lookup || typeof lookup.find !== 'function') continue;
      const found = lookup.find(center[0], center[1], center[2], radius);
      if (!found || !found.count) continue;
      const indices: number[] = [];
      for (let j = 0; j < found.count; j++) indices.push(found.indices[j]);
      if (indices.length > 0) elements.push({ unit, indices });
    }
    if (elements.length === 0) {
      console.warn(`[showInteractionsAround] no atoms within ${radius} Å of the target center`);
      return false;
    }

    const neighborhoodLoci = new SE.Loci(data, elements);
    const expr = SE.Loci.toExpression(neighborhoodLoci);

    // Remove any previous neighborhood component first — re-running the
    // command (e.g. with a different radius) must not leave the old one
    // behind.
    for (const c of [...(sr.components ?? [])]) {
      const tags = c?.cell?.transform?.tags;
      if (Array.isArray(tags) && tags.includes('interactions-neighborhood')) {
        try { (plugin.managers.structure.hierarchy as any).remove([c], true); } catch { /* ignore */ }
      }
    }

    // NOTE: pass the structure CELL (not the raw structure data) — the state
    // builder resolves StateObjectRefs, and a raw Structure object has no
    // `.cell` (the old code passed `data`, which could never resolve).
    // Custom tags kept to 'interactions-neighborhood' only: the old extra
    // 'structure-component-static-polymer' tag made this component masquerade
    // as the polymer component in every tag-based polymer lookup.
    const component = await (plugin.builders.structure as any).tryCreateComponentFromExpression(
      sr.cell, expr, 'interactions-neighborhood',
      { tags: ['interactions-neighborhood'] }
    );
    if (!component) {
      console.warn('[showInteractionsAround] neighborhood component was not created');
      return false;
    }
    try {
      await plugin.builders.structure.representation.addRepresentation(component, {
        type: 'ball-and-stick',
        typeParams: { sizeFactor: 0.2, bondScale: 0.15, bondSpacing: 0.05, ignoreHydrogens: true },
        color: 'element-symbol',
      });
      console.log(`[showInteractionsAround] Created neighborhood component (${radius} Å radius, ${elements.length} unit(s))`);
    } catch (err) {
      console.warn('[showInteractionsAround] addRepresentation failed:', err);
      return false;
    }

    // Highlight the original target loci (R161: lociSelects has no .highlight
    // method in the prebuilt bundle — the real hover-highlight API lives on
    // lociHighlights. Use highlightOnly so it doesn't stack marks.)
    try {
      if (loci && !isLociEmpty(loci)) {
        plugin.managers.interactivity.lociHighlights.highlightOnly(loci as any);
      }
    } catch (err) {
      console.debug('[showInteractionsAround] highlight failed (best-effort):', err);
    }
    return true;
  } catch (err) {
    console.warn('[showInteractionsAround] overall failure:', err);
    return false;
  }
}

/** R138: Clear all interaction-related state (measurements + neighborhood components). */
export async function clearInteractions(plugin: MolstarPlugin): Promise<void> {
  // R170: `measurement.clear()` does not exist on the prebuilt bundle —
  // state-tree group deletion is the bundle-safe equivalent.
  await clearAllMeasurements(plugin);

  // Remove neighborhood components tagged with 'interactions-neighborhood'
  try {
    const structs = plugin.managers.structure.hierarchy.current.structures;
    for (const s of structs) {
      const toRemove: any[] = [];
      const components = s.components ?? [];
      for (const c of components) {
        const tags = c?.cell?.transform?.tags;
        if (Array.isArray(tags) && tags.includes('interactions-neighborhood')) {
          toRemove.push(c);
        }
      }
      for (const c of toRemove) {
        try {
          // R167: `structure.component.remove` does not exist in the prebuilt
          // bundle — use hierarchy.remove (bundle-verified API).
          plugin.managers.structure.hierarchy.remove([c], true);
        } catch (err) {
          console.warn('[clearInteractions] failed to remove neighborhood component:', err);
        }
      }
    }
  } catch (err) {
    console.warn('[clearInteractions] neighborhood cleanup failed:', err);
  }

  // Clear any highlights (R161: hover highlights live on lociHighlights;
  // green selection boxes are cleared via lociSelects.deselectAll()).
  try {
    plugin.managers.interactivity.lociHighlights.clearHighlights();
  } catch (err) {
    console.debug('[clearInteractions] clearHighlights failed (best-effort):', err);
  }
  try {
    plugin.managers.interactivity.lociSelects.deselectAll();
  } catch (err) {
    console.debug('[clearInteractions] deselectAll failed (best-effort):', err);
  }
}
