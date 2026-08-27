/**
 * Interactions helpers — show/clear interaction neighborhood visualizations.
 *
 * Extracted from commands.ts (R138) as part of the module split.
 */

import type { MolstarPlugin } from "../types";
import { getFirstStructureData, isLociEmpty } from "./structure-helpers";

/**
 * R138: Show the interaction neighborhood around a target loci.
 *
 * Creates a ball-and-stick component for all atoms within `radius` Å of the
 * target's center, plus highlights the target itself.
 */
export async function showInteractionsAround(
  plugin: MolstarPlugin,
  loci: unknown,
  radius: number
): Promise<void> {
  try {
    const data = getFirstStructureData(plugin);
    if (!data) {
      console.warn('[showInteractionsAround] No structure data available');
      return;
    }

    // Try to get the boundary (center + radius) of the target loci
    let center: { x: number; y: number; z: number } | null = null;
    try {
      const lociObj = loci as { elements?: Array<{ unit?: { boundary?: { sphere?: { center: { x: number; y: number; z: number }; radius: number } } } }> };
      if (lociObj?.elements && lociObj.elements.length > 0) {
        const boundary = (lociObj.elements[0] as any)?.unit?.boundary;
        if (boundary?.sphere?.center) {
          center = boundary.sphere.center;
        }
      }
    } catch (err) {
      console.warn('[showInteractionsAround] could not extract loci center:', err);
    }

    // If we couldn't get the center from the loci, use the structure's center
    if (!center) {
      try {
        const structs = plugin.managers.structure.hierarchy.current.structures;
        if (structs.length > 0) {
          const structData = structs[0]?.cell?.obj?.data;
          const boundary = (structData as any)?.boundary;
          if (boundary?.sphere?.center) {
            center = boundary.sphere.center;
          }
        }
      } catch (err) {
        console.warn('[showInteractionsAround] could not get structure center:', err);
      }
    }

    if (!center) {
      console.warn('[showInteractionsAround] no center available — skipping neighborhood visualization');
      return;
    }

    // Use MolScript to select atoms within the radius of the center
    const Q = (window as any).molstar?.lib?.molscript;
    if (!Q) {
      console.warn('[showInteractionsAround] MolScript builder not available');
      return;
    }

    const neighborhoodExpr = Q.struct.modifier.union(
      Q.struct.generator.within({
        0: Q.struct.generator.all(),
        target: Q.struct.generator.all(),
        'max-radius': radius,
        center: [center.x, center.y, center.z],
      })
    );

    // Create a ball-and-stick component for the neighborhood
    try {
      const builder = plugin.builders.structure;
      const component = await builder.tryCreateComponentFromExpression(
        data,
        neighborhoodExpr,
        `Neighborhood (${radius} Å)`,
        { tags: ['interactions-neighborhood', 'structure-component-static-polymer'] }
      );
      if (component) {
        try {
          await plugin.managers.structure.component.addRepresentations(
            component,
            'ball-and-stick',
            {}
          );
          console.log(`[showInteractionsAround] Created neighborhood component (${radius} Å radius)`);
        } catch (err) {
          console.warn('[showInteractionsAround] addRepresentations failed:', err);
        }
      }
    } catch (err) {
      console.warn('[showInteractionsAround] tryCreateComponentFromExpression failed:', err);
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
  } catch (err) {
    console.warn('[showInteractionsAround] overall failure:', err);
  }
}

/** R138: Clear all interaction-related state (measurements + neighborhood components). */
export async function clearInteractions(plugin: MolstarPlugin): Promise<void> {
  plugin.managers.structure.measurement.clear();

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
          plugin.managers.structure.component.remove(c);
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
