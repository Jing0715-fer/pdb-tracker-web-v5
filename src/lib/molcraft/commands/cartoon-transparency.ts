/**
 * Cartoon transparency — makes the cartoon representation semi-transparent
 * during interface analyses so the element-colored sidechain sticks behind
 * it remain visible ("给cartoon加一些透明度" fix).
 *
 * Implementation notes (verified against molstar 5.11.0 sources — the same
 * version as public/molstar.js):
 *   - `updateRepresentationsTheme` only carries color/size themes; transparency
 *     is a SEPARATE state transform: `StateTransforms.Representation
 *     .TransparencyStructureRepresentation3DFromBundle`, applied as a CHILD of
 *     a Representation3D cell (this is what the official
 *     `setStructureTransparency` helper in mol-plugin-state does).
 *   - The transform's layer needs a StructureElement.Bundle — built from a
 *     loci covering ALL atoms of the first structure (unit traversal, the same
 *     bundle-safe pattern as buildChainLoci/buildResidueLoci — no MolScript Q,
 *     which the prebuilt bundle does not expose).
 *   - `applyOrUpdateTagged` keeps the application idempotent: re-running the
 *     viz (e.g. VLM recapture iterations) UPDATES the tagged cell instead of
 *     stacking sibling transparency cells.
 *   - The prebuilt viewer runs with Canvas3D transparency mode 'wboit'
 *     (explicitly passed in molstar-viewer.tsx), so translucent cartoons
 *     render correctly in screenshots.
 *
 * Cleanup: every created cell is tagged `viz-transparency`;
 * `clearVizTransparency` deletes all tagged cells (cells whose parent
 * representation/component was removed are already gone — state children
 * cascade-delete with their parent).
 */

import type { MolstarPlugin } from "../types";

const VIZ_TRANSPARENCY_TAG = "viz-transparency";

interface StateLike {
  build?: () => BuilderLike;
  cells?: Iterable<[string, { transform?: { ref?: string; tags?: unknown } }]>;
}
interface BuilderLike {
  to(ref: string): {
    applyOrUpdateTagged(tag: string | string[], transformer: unknown, params: unknown): unknown;
  };
  delete(ref: string): unknown;
  commit(opts?: unknown): Promise<unknown>;
}

function buildStateBuilder(state: StateLike): BuilderLike | null {
  try {
    const builder = state.build!() as BuilderLike;
    if (
      typeof builder?.to !== "function" ||
      typeof builder?.delete !== "function" ||
      typeof builder?.commit !== "function"
    ) {
      return null;
    }
    return builder;
  } catch {
    return null;
  }
}

function getState(plugin: MolstarPlugin): StateLike | null {
  const state = (plugin as unknown as { state?: { data?: StateLike } }).state?.data;
  if (!state || typeof state.build !== "function" || !state.cells) return null;
  return state;
}

/** Build a StructureElement.Loci covering ALL atomic elements of the first structure. */
function buildAllAtomsLoci(plugin: MolstarPlugin): unknown | null {
  const bundle = (window as unknown as { molstar?: any }).molstar;
  const SE = bundle?.lib?.structure?.StructureElement;
  if (!SE) return null;
  const structs = plugin.managers.structure.hierarchy.current.structures;
  if (!structs.length) return null;
  const data = (structs[0] as { cell?: { obj?: { data?: any } } })?.cell?.obj?.data;
  if (!data) return null;

  const elements: Array<{ unit: unknown; indices: number[] }> = [];
  for (const unit of data.units) {
    if (unit.kind !== 0) continue; // atomic only
    const n = unit.elements.length;
    if (n === 0) continue;
    const indices = new Array<number>(n);
    for (let i = 0; i < n; i++) indices[i] = i;
    elements.push({ unit, indices });
  }
  if (elements.length === 0) return null;
  return new SE.Loci(data, elements);
}

/**
 * Apply `value` transparency (0 = opaque, 1 = invisible) to every CARTOON
 * representation of non-sidechain components. Ball-and-stick sidechain
 * components (tagged 'interface-sidechain') stay solid — they are the point
 * of the transparent cartoon.
 *
 * Returns the number of representations the layer was applied to.
 */
export async function applyCartoonTransparency(
  plugin: MolstarPlugin,
  value: number
): Promise<number> {
  try {
    const bundle = (window as unknown as { molstar?: any }).molstar;
    const SE = bundle?.lib?.structure?.StructureElement;
    const TransparencyT = bundle?.lib?.plugin?.StateTransforms?.Representation
      ?.TransparencyStructureRepresentation3DFromBundle;
    const state = getState(plugin);
    if (!SE || !TransparencyT || !state) {
      console.warn("[viz:transparency] bundle APIs unavailable — skipping");
      return 0;
    }

    const allLoci = buildAllAtomsLoci(plugin);
    if (!allLoci) return 0;
    const layerBundle = SE.Bundle.fromLoci(allLoci);
    if (!layerBundle) return 0;

    const structs = plugin.managers.structure.hierarchy.current.structures;
    let applied = 0;
    for (const s of structs) {
      for (const c of (s as any).components ?? []) {
        const tags: unknown = c?.cell?.transform?.tags;
        if (Array.isArray(tags) && tags.includes("interface-sidechain")) continue;
        for (const r of (c as any).representations ?? []) {
          // Only cartoons — ligand/water ball-and-stick etc. stay opaque.
          const typeName: string = r?.cell?.transform?.params?.type?.name ?? "";
          if (!typeName.includes("cartoon")) continue;
          try {
            const builder = buildStateBuilder(state);
            if (!builder) continue;
            builder
              .to(r.cell.transform.ref)
              .applyOrUpdateTagged(VIZ_TRANSPARENCY_TAG, TransparencyT, {
                layers: [{ bundle: layerBundle, value }],
              });
            await builder.commit();
            applied++;
          } catch (err) {
            console.warn("[viz:transparency] one representation failed:", err);
          }
        }
      }
    }
    if (applied > 0) {
      console.log(`[viz:transparency] ${applied} cartoon representation(s) at ${value} transparency`);
    }
    return applied;
  } catch (err) {
    console.warn("[viz:transparency] applyCartoonTransparency failed:", err);
    return 0;
  }
}

/**
 * Remove every viz-added transparency layer. Safe to call when none exist.
 * Returns the number of deleted cells.
 */
export async function clearVizTransparency(plugin: MolstarPlugin): Promise<number> {
  try {
    const state = getState(plugin);
    if (!state) return 0;
    const toDelete: string[] = [];
    for (const [ref, cell] of state.cells!) {
      const tags = cell?.transform?.tags;
      if (Array.isArray(tags) && tags.includes(VIZ_TRANSPARENCY_TAG)) {
        toDelete.push(ref);
      }
    }
    if (toDelete.length === 0) return 0;
    const builder = buildStateBuilder(state);
    if (!builder) return 0;
    for (const ref of toDelete) {
      try { builder.delete(ref); } catch { /* already gone */ }
    }
    await builder.commit();
    return toDelete.length;
  } catch (err) {
    console.warn("[viz:transparency] clearVizTransparency failed:", err);
    return 0;
  }
}
