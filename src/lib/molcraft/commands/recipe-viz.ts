/**
 * Recipe visualization — apply recipe-specific 3D visualizations before capture.
 *
 * Extracted from commands.ts (R138) as part of the module split.
 *
 * This function inspects the recipe ID and the analysis result data to
 * determine the best visualization, then applies it via the Molstar API.
 * For example:
 *   - binding_pocket → focus on ligand + set representation to show pocket
 *   - all_interactions → show interactions + focus on interface
 *   - druggability → show druggable pocket surface
 *   - hbonds → show interactions (H-bonds)
 *   - virtual_screening → show top hit pose
 *
 * The function is best-effort — if any visualization step fails, it logs a
 * warning and continues. The screenshot will still be captured even if
 * visualization is not applied.
 */

import type { MolstarViewer, MolstarPlugin } from "../types";
import { getStructures, collectComponents, getFirstStructureData, isLociEmpty, buildNonPolymerLoci } from "./structure-helpers";
import { lociFromResidue } from "./loci";
import { normalizeColorTheme } from "./color-theme";
import { nextFrame } from "./screenshot-utils";
import { clearAllSelectionVisuals } from "./selection-utils";
import { normalizeInteractions } from "../vlm-client";
import {
  snapshotMeasurementRefs,
  diffMeasurementRefs,
  removeMeasurementCells,
} from "./measurement-utils";
import { applyCartoonTransparency, clearVizTransparency } from "./cartoon-transparency";
import { getLociCenter, getLabelSizeRatios } from "./label-sizing";
import { AGENT_LABEL_TAG, removeAgentLabels } from "./label-lifecycle";

/**
 * R167 (MOL-M4): measurement cells added by the interactions-family viz
 * (draw_interaction_lines distances). Tracked so that (a) cleanupCapture can
 * remove exactly what this analysis drew, and (b) the NEXT analysis's
 * cleanup_previous removes leaked leftovers WITHOUT touching user-added
 * measurements (the old unconditional measurement.clear() wiped both).
 */
let vizAddedMeasurementRefs: string[] = [];

/**
 * R154: Build a StructureElement.Loci for a specific residue (and optionally atom)
 * by directly traversing structure units — NOT using MolScript builder (which is
 * not available in the prebuilt bundle).
 *
 * This mirrors the approach in measure.ts showResidueSidechain: iterate all
 * atomic units, find elements matching the residue spec, build a loci.
 *
 * Returns { loci, expr } where loci is the StructureElement.Loci and expr is
 * the Expression (via SE.Loci.toExpression) for use with tryCreateComponentFromExpression.
 */
export function buildResidueLoci(
  plugin: MolstarPlugin,
  refs: Array<{ chain: string; resno: number; atomName?: string }>
): { loci: unknown; expr: unknown } | null {
  const bundle = (window as any).molstar;
  const SE = bundle?.lib?.structure?.StructureElement;
  const SP = bundle?.lib?.structure?.StructureProperties;
  if (!SE || !SP) {
    console.warn("[buildResidueLoci] StructureElement/Properties not available");
    return null;
  }

  const structs = plugin.managers.structure.hierarchy.current.structures;
  if (!structs.length) return null;
  const sr = structs[0];
  const data = sr?.cell?.obj?.data;
  if (!data) return null;

  // Build a set of residue keys for fast lookup
  const refSet = new Set<string>();
  const atomMap = new Map<string, string | undefined>(); // key -> atomName
  for (const ref of refs) {
    const key = `${ref.chain}:${ref.resno}`;
    refSet.add(key);
    if (ref.atomName) {
      atomMap.set(key, ref.atomName);
    }
  }

  // Find ALL elements matching any of the residue specs
  const elementsByUnit = new Map<unknown, number[]>();
  for (const unit of data.units) {
    if (unit.kind !== 0) continue; // atomic only
    const indices: number[] = [];
    for (let i = 0; i < unit.elements.length; i++) {
      // R166 (multi-chain loci bug): Location.create's 3rd arg is the
      // ELEMENT (model atom index, i.e. unit.elements[i]) — NOT the position
      // `i` within the unit. Passing `i` read the WRONG atoms' properties:
      // for single-chain structures the first unit's elements start at 0 so
      // it appeared to work, but on multi-chain structures (4HHB A/B/C/D)
      // chain B/D atoms reported chain A → every chain:resno lookup missed →
      // no interface focus, no sidechain sticks, no labels, no H-bond lines.
      // NOTE: the indices collected below still use `i` — StructureElement
      // .Loci's `indices` ARE positions within unit.elements (that part was
      // always correct).
      const loc = SE.Location.create(data, unit, unit.elements[i]);
      const chainId = SP.chain.auth_asym_id(loc) || SP.chain.label_asym_id(loc);
      const resno = SP.residue.auth_seq_id(loc);
      const key = `${chainId}:${resno}`;
      if (!refSet.has(key)) continue;

      // If atomName is specified, filter by atom name
      const atomName = atomMap.get(key);
      if (atomName) {
        const atomId = SP.atom.label_atom_id(loc);
        if (atomId !== atomName) continue;
      }

      indices.push(i);
    }
    if (indices.length > 0) {
      elementsByUnit.set(unit, indices);
    }
  }

  if (elementsByUnit.size === 0) return null;

  // Build the elements array for the loci
  const elements: Array<{ unit: unknown; indices: number[] }> = [];
  elementsByUnit.forEach((indices, unit) => {
    elements.push({ unit, indices });
  });

  // Create a StructureElement.Loci and convert to expression
  const loci = new SE.Loci(data, elements);
  const expr = SE.Loci.toExpression(loci);
  return { loci, expr };
}

// ============================================================================
// R170: per-pair chain visibility — hide chains that do not participate in
// the analyzed interface (e.g. 4HHB A-B analysis hides C/D).
//
// The default Molstar preset renders ALL polymer chains through a single
// "Polymer" component, so per-chain hiding requires: (1) hiding the polymer
// component and (2) creating stand-in per-chain components (chain loci →
// expression → component + cartoon/chain-id representation) for the kept
// chains. `restoreHiddenChains` (called from cleanupCapture) reverses both.
//
// NOTE: the R169 (MOL-L4) toggle_component_visibility path cannot be reused
// here — it relies on the MolScript `Q` builder, which is NOT exposed on the
// prebuilt bundle's `window.molstar.lib` (only structure/volume/shape/loci/
// math/plugin/extensions are). The loci → SE.Loci.toExpression route below
// is bundle-verified.
// ============================================================================
let vizChainsHidden = false;

/** Build a loci covering every element of `chainId` (auth, label fallback). */
function buildChainLoci(plugin: MolstarPlugin, chainId: string): unknown | null {
  const bundle = (window as any).molstar;
  const SE = bundle?.lib?.structure?.StructureElement;
  const SP = bundle?.lib?.structure?.StructureProperties;
  if (!SE || !SP) return null;
  const structs = plugin.managers.structure.hierarchy.current.structures;
  if (!structs.length) return null;
  const data = structs[0]?.cell?.obj?.data as any;
  if (!data) return null;

  const elementsByUnit = new Map<unknown, number[]>();
  for (const unit of data.units) {
    if (unit.kind !== 0) continue; // atomic only
    const indices: number[] = [];
    for (let i = 0; i < unit.elements.length; i++) {
      const loc = SE.Location.create(data, unit, unit.elements[i]);
      const cid = SP.chain.auth_asym_id(loc) || SP.chain.label_asym_id(loc);
      if (cid === chainId) indices.push(i);
    }
    if (indices.length > 0) elementsByUnit.set(unit, indices);
  }
  if (elementsByUnit.size === 0) return null;
  const elements: Array<{ unit: unknown; indices: number[] }> = [];
  elementsByUnit.forEach((indices, unit) => elements.push({ unit, indices }));
  const loci = new SE.Loci(data, elements);
  return SE.Loci.toExpression(loci);
}

/** Distinct auth chain ids present in the first structure's atomic units. */
export function collectChainIds(plugin: MolstarPlugin): string[] {
  const bundle = (window as any).molstar;
  const SP = bundle?.lib?.structure?.StructureProperties;
  const SE = bundle?.lib?.structure?.StructureElement;
  if (!SE || !SP) return [];
  const structs = plugin.managers.structure.hierarchy.current.structures;
  if (!structs.length) return [];
  const data = structs[0]?.cell?.obj?.data as any;
  if (!data) return [];
  const ids = new Set<string>();
  for (const unit of data.units) {
    if (unit.kind !== 0) continue;
    for (let i = 0; i < unit.elements.length; i++) {
      const loc = SE.Location.create(data, unit, unit.elements[i]);
      const cid = SP.chain.auth_asym_id(loc) || SP.chain.label_asym_id(loc);
      if (cid) ids.add(cid);
    }
  }
  return Array.from(ids);
}

/**
 * Hide every chain except `keep` (per-pair view). No-op for structures with
 * ≤2 chains (unless `force`) or when the polymer component can't be found.
 * Best-effort: any failure rolls the polymer visibility back so the view is
 * never left blank.
 */
export async function hideOtherChains(plugin: MolstarPlugin, keep: string[], force = false): Promise<void> {
  const structs = getStructures(plugin, undefined);
  if (structs.length === 0) return;
  const sr = structs[0] as any;
  const polymer = (sr.components ?? []).find(
    (c: any) => Array.isArray(c?.cell?.transform?.tags) &&
      c.cell.transform.tags.includes("structure-component-static-polymer")
  );
  if (!polymer) return;

  const allChains = collectChainIds(plugin);
  const others = allChains.filter((c) => !keep.includes(c));
  // Only worth hiding when the structure has more chains than the pair
  // (a 2-chain A/B structure has nothing to hide) — unless forced (the
  // agent's explicit toggle_component_visibility tool may hide 1 of 2).
  if ((!force && allChains.length <= 2) || others.length === 0) return;

  try {
    // Remove any previous viz-chain stand-ins first so `keep` fully
    // determines what is visible (the agent may hide chain C then chain D —
    // stale stand-ins from the first call would resurrect C/D).
    for (const c of [...(sr.components ?? [])]) {
      const tags = c?.cell?.transform?.tags;
      if (Array.isArray(tags) && tags.includes("viz-chain")) {
        try { (plugin.managers.structure.hierarchy as any).remove([c], true); } catch { /* ignore */ }
      }
    }
    plugin.managers.structure.hierarchy.toggleVisibility([polymer], "hide");
    await nextFrame();
    let made = 0;
    for (const chain of keep) {
      const expr = buildChainLoci(plugin, chain);
      if (!expr) continue;
      try {
        const component = await (plugin.builders.structure as any).tryCreateComponentFromExpression(
          sr.cell, expr, `viz-chain-${chain}`,
          { tags: ["viz-chain", `structure-component-viz-chain-${chain}`] }
        );
        if (component) {
          await plugin.builders.structure.representation.addRepresentation(component, {
            type: "cartoon",
            color: "chain-id",
          });
          made++;
        }
      } catch (err) {
        console.warn(`[viz:hide_chains] per-chain component for ${chain} failed:`, err);
      }
    }
    if (made === 0) {
      // Nothing could be created — restore the polymer so the view is not blank.
      plugin.managers.structure.hierarchy.toggleVisibility([polymer], "show");
      return;
    }
    vizChainsHidden = true;
    console.log(`[viz:hide_chains] Hidden chains ${others.join(",")} for the ${keep.join("-")} interface view (${made} stand-in components)`);
  } catch (err) {
    console.warn("[viz:hide_chains] failed — restoring polymer visibility:", err);
    try { plugin.managers.structure.hierarchy.toggleVisibility([polymer], "show"); } catch { /* ignore */ }
  }
}

/**
 * Reverse `hideOtherChains`: remove the viz stand-in components and un-hide
 * the polymer component. Safe to call when nothing was hidden.
 */
export async function restoreHiddenChains(plugin: MolstarPlugin): Promise<void> {
  if (!vizChainsHidden) return;
  vizChainsHidden = false;
  try {
    const structs = getStructures(plugin, undefined);
    for (const s of structs) {
      const sr = s as any;
      const toRemove: any[] = [];
      let polymer: any = null;
      for (const c of (sr.components ?? [])) {
        const tags = c?.cell?.transform?.tags;
        if (Array.isArray(tags) && tags.includes("viz-chain")) toRemove.push(c);
        if (Array.isArray(tags) && tags.includes("structure-component-static-polymer")) polymer = c;
      }
      for (const c of toRemove) {
        try { (plugin.managers.structure.hierarchy as any).remove([c], true); } catch { /* ignore */ }
      }
      if (polymer) plugin.managers.structure.hierarchy.toggleVisibility([polymer], "show");
    }
    await nextFrame();
  } catch (err) {
    console.warn("[viz:hide_chains] restore failed:", err);
  }
}

// ============================================================================
// MOL2-01: non-polymer (water/ligand) visibility lifecycle.
//
// The default representation preset creates its OWN static water/ligand
// components (with ball-and-stick representations attached, and labeled
// "Water"/"Ligand" by the StructureComponent transform itself). The old
// R156 hide step passed `tags: ['water-hide'/'ligand-hide']` to
// tryCreateComponentStatic — applyOrUpdateTagged(keyTag) MERGED those tags
// into the preset's own component, and cleanup_previous then deleted cells
// BY TAG (and by the "Water"/"Ligand" labels), destroying the preset
// components entirely. A rebuilt static component carries NO
// representations, so after one interactions-family analysis the ligands
// (HEM!) vanished from the live view and could never be re-shown.
//
// Now: hide the EXISTING component in place (hierarchy.toggleVisibility +
// snapshot of its previous isHidden — same pattern as snapshotMeasurementRefs
// / the viz-chain stand-ins above), and only create a TAG-LESS stand-in when
// the preset has no such component (tracked by ref for deletion). Restore
// (restoreHiddenNonPolymer) is the exact mirror image and NEVER deletes
// preset cells.
// ============================================================================
interface HiddenNonPolymerEntry {
  /** State-tree ref of the component we hid. */
  ref: string;
  /** Whether the component was already hidden BEFORE we touched it. */
  wasHidden: boolean;
  /** True when WE created the component (stand-in) — deleted on restore. */
  created: boolean;
}
let vizHiddenNonPolymer: HiddenNonPolymerEntry[] = [];

/**
 * MOL2-01: restore the water/ligand components hidden by the hide_non_polymer
 * step — un-hide the preset's own components (respecting their pre-analysis
 * isHidden snapshot) and remove the stand-ins we created. Safe no-op when
 * nothing was hidden; drains the tracking list either way so stale entries
 * never accumulate across structures/sessions.
 */
export async function restoreHiddenNonPolymer(plugin: MolstarPlugin): Promise<void> {
  if (vizHiddenNonPolymer.length === 0) return;
  const tracked = vizHiddenNonPolymer;
  vizHiddenNonPolymer = [];
  try {
    const structs = getStructures(plugin, undefined);
    for (const s of structs) {
      const sr = s as any;
      // Collect FIRST, act AFTER — removing from sr.components while
      // iterating it would skip entries (array shifts under for...of).
      const toRemove: any[] = [];
      const toShow: any[] = [];
      for (const c of (sr.components ?? [])) {
        const ref = c?.cell?.transform?.ref;
        if (!ref) continue;
        const entry = tracked.find((t) => t.ref === ref);
        if (!entry) continue;
        if (entry.created) {
          // Stand-in we created because the preset had no such component —
          // remove it so the state tree returns to its pre-analysis shape.
          toRemove.push(c);
        } else if (!entry.wasHidden) {
          // Preset component we hid — bring back its representations.
          toShow.push(c);
        }
      }
      for (const c of toRemove) {
        try { (plugin.managers.structure.hierarchy as any).remove([c], true); } catch { /* ignore */ }
      }
      if (toShow.length > 0) {
        plugin.managers.structure.hierarchy.toggleVisibility(toShow, "show");
      }
    }
    await nextFrame();
  } catch (err) {
    console.warn("[viz:hide] non-polymer restore failed:", err);
  }
}

/**
 * MOL2-08: clear the viz-added measurement ref tracking. Called by
 * cleanupCapture after the refs were successfully removed and by
 * __drainCaptureQueue on structure clear — without this, the next run's
 * cleanup_previous re-counted already-dead refs as "leaked" cells.
 */
export function __resetVizMeasurementRefs(): void {
  vizAddedMeasurementRefs = [];
}

/**
 * R164 (MOL-005): deep-clone viz params before use.
 *
 * applyRecipeVisualization mutates its `params` argument in two places:
 *   1. the R140 nested-`.data` merge (lifts inner keys to the top level)
 *   2. the R163 pairwise pair selection (overwrites chain1/chain2/interactions)
 *
 * Previously these mutations hit the CALLER's object — the caller's vizParams
 * was silently polluted across VLM re-capture iterations (e.g. pair #2's
 * chain1/chain2 sticking around when pair #1 was re-visualized). Recipe
 * analysis payloads are pure JSON, so structuredClone (or a JSON round-trip)
 * fully isolates the caller; the shallow-copy fallback is a last resort for
 * exotic non-cloneable values.
 */
function cloneVizParams(params: Record<string, unknown>): Record<string, unknown> {
  try {
    if (typeof structuredClone === 'function') {
      return structuredClone(params) as Record<string, unknown>;
    }
  } catch { /* non-cloneable value inside — fall through to JSON clone */ }
  try {
    return JSON.parse(JSON.stringify(params)) as Record<string, unknown>;
  } catch (err) {
    console.warn('[applyRecipeVisualization] deep clone failed — falling back to shallow copy:', err);
    return { ...params };
  }
}

export async function applyRecipeVisualization(
  viewer: MolstarViewer,
  recipe: string,
  params?: Record<string, unknown>
): Promise<void> {
  // R164 (MOL-005): work on a deep clone — every mutation below (the nested
  // `.data` merge and the pairwise chain1/chain2/interactions overwrites)
  // must stay local to this call and never leak into the caller's params.
  if (params && typeof params === 'object') {
    params = cloneVizParams(params);
  }
  try {
    const plugin = (viewer as unknown as { plugin?: MolstarPlugin }).plugin;
    if (!plugin) return;

    // Helper: safely execute a visualization step, logging errors
    const safe = async (fn: () => Promise<void>, label: string) => {
      try {
        await fn();
      } catch (err) {
        console.warn(`[viz:${recipe}] ${label} failed:`, err);
      }
    };

    // R140: Normalize the vizParams data structure.
    //
    // The auto-capture path passes `analysisData = result.analysisResult.data`
    // which has the shape: { recipe, ok, pdbId, format, data: { chain1, chain2, interactions, ... } }
    //
    // But applyRecipeVisualization expects params.chain1, params.interactions, etc.
    // at the TOP LEVEL. Without this normalization, the interaction data is
    // nested under params.data and never read, so the camera doesn't focus on
    // the interface and side chains aren't shown.
    //
    // This step unwraps the nested .data so all the recipe cases can access
    // chain1/chain2/interactions directly from `params`.
    if (params && typeof params === 'object') {
      const innerData = (params as any).data;
      if (innerData && typeof innerData === 'object') {
        // Merge inner data keys to the top level (without overwriting existing top-level keys)
        for (const key of Object.keys(innerData)) {
          if ((params as any)[key] === undefined) {
            (params as any)[key] = innerData[key];
          }
        }
        console.log(`[viz:${recipe}] Normalized nested data — keys: ${Object.keys(params).join(', ')}`);
      }
    }

    // R143: Read VLM hints from the capture loop (Plan D integration).
    // These are set by applyVlmHints() in vlm-capture-loop.ts and control
    // camera zoom/focus for re-capture iterations.
    const vlmZoomMultiplier = (params as any)?._focusRadiusMultiplier as number | undefined;
    const vlmFocusHint = (params as any)?._vlmFocusHint as string | undefined;
    if (vlmZoomMultiplier || vlmFocusHint) {
      console.log(`[viz:${recipe}] VLM hints: zoomMultiplier=${vlmZoomMultiplier ?? 'none'}, focusHint=${vlmFocusHint ?? 'none'}`);
    }

    // Helper to apply a representation preset (cartoon, surface, etc.)
    // R89: Only apply if the current representation is different —
    // re-applying the same preset can cause a brief structure removal.
    const applyPreset = async (preset: string) => {
      const structs = getStructures(plugin);
      if (structs.length === 0) return;
      try {
        const components = collectComponents(plugin, structs);
        if (components.length > 0) {
          const currentTypes = components.map((c: any) =>
            c?.cell?.transform?.params?.type ||
            c?.cell?.obj?.data?.type ||
            c?.cell?.obj?.label?.toLowerCase() || ''
          );
          const presetLower = preset.toLowerCase();
          const alreadyApplied = currentTypes.some((t: string) =>
            t.includes(presetLower) || (presetLower === 'cartoon' && t.includes('cartoon')) ||
            (presetLower === 'surface' && t.includes('surface')) ||
            (presetLower === 'putty' && t.includes('putty')) ||
            (presetLower === 'ball-and-stick' && t.includes('ball'))
          );
          if (alreadyApplied) return;
        }
      } catch (err) { console.warn('[applyPreset] representation check failed, falling through:', err); }
      await plugin.managers.structure.component.applyPreset(structs, preset);
      await nextFrame();
      await nextFrame();
    };

    // Helper to apply a color theme
    const applyColorTheme = async (theme: string) => {
      const structs = getStructures(plugin);
      const components = collectComponents(plugin, structs);
      if (components.length === 0) return;
      // R171: EXCLUDE the interface-sidechain component — re-theming it with
      // chain-id (or any global theme) silently overrode the element-symbol
      // coloring of the sidechain sticks ("侧链的stick没有按照不同原子染色"
      // root cause #2). The sticks must keep per-atom CPK coloring.
      const themedComponents = components.filter((c: any) => {
        const tags = c?.cell?.transform?.tags;
        return !(Array.isArray(tags) && tags.includes("interface-sidechain"));
      });
      if (themedComponents.length === 0) return;
      const normalized = normalizeColorTheme(theme);
      if (normalized) {
        plugin.managers.structure.component.updateRepresentationsTheme(
          themedComponents,
          { color: normalized }
        );
      } else {
        console.warn(`[applyColorTheme] unknown theme "${theme}" — skipping`);
      }
    };

    switch (recipe) {
      case "binding_pocket":
      case "ligand_interactions": {
        const ligandCompId = params?.ligandCompId as string | undefined;
        if (ligandCompId) {
          await safe(async () => {
            // R161: lociFromResidue is now non-destructive (unit traversal),
            // so focusing a ligand no longer leaves a green selection box.
            const loci = await lociFromResidue(viewer, { compId: ligandCompId });
            if (loci) plugin.managers.camera.focusLoci(loci, { minRadius: 15 });
          }, "focus_ligand");
        } else {
          await safe(async () => {
            // R167 (MOL-M3): `selection.getLociFromExpression` does NOT exist
            // in the prebuilt bundle — the previous MolScript-expression code
            // always threw a TypeError into safe() and never focused. Use the
            // bundle-safe non-polymer traversal instead.
            const loci = buildNonPolymerLoci(plugin);
            if (loci && !isLociEmpty(loci)) {
              plugin.managers.camera.focusLoci(loci, { minRadius: 15 });
              console.log('[viz:focus_all_ligands] Focused non-polymer entities via unit traversal');
            }
          }, "focus_all_ligands");
        }
        await safe(async () => { await applyColorTheme("chain-id"); }, "color_chain");
        break;
      }

      case "all_interactions":
      case "hbonds":
      case "salt_bridges":
      case "hydrophobic_contacts":
      case "interface_residues":
      case "oligomer_analysis":
      case "pairwise_interactions": {
        // R161: For pairwise_interactions, normalize the payload first: the
        // recipe returns per-pair results; pick the pair to visualize and
        // surface its chain1/chain2/interactions so the focus/sidechain/line
        // logic below visualizes THAT interface.
        //
        // R163: vizParams._pairIndex selects WHICH significant pair to show
        // (0 = most significant, 1 = second, …). The client auto-capture flow
        // captures the top-2 interfaces separately so the VLM report covers
        // the main interfaces, not just the single best one.
        if (recipe === "pairwise_interactions") {
          const pairs = (params as any)?.pairs as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(pairs) && pairs.length > 0) {
            // significant pairs sorted by interaction count (desc) — same
            // ordering as the recipe's significant_pairs field
            const significant = pairs
              .filter(p => p.in_contact !== false && (Number(p.total ?? 0) || 0) > 0)
              .sort((a, b) => (Number(b.total ?? 0) || 0) - (Number(a.total ?? 0) || 0));
            const pool = significant.length > 0 ? significant : pairs;
            // MOL2-07 (R172): prefer resolving the pair by EXPLICIT chain
            // identity (_pairChains from the client's own pool). The client
            // fallback pool (in-contact-only, unsorted) and this server pool
            // (ALL pairs incl. non-contact, sorted) could disagree when no
            // pair reached the significance threshold — index-based selection
            // then focused the capture on a DIFFERENT interface than the one
            // the carousel/VLM report claimed. Chain identity is unambiguous.
            const requestedChains = (params as any)?._pairChains as [string, string] | undefined;
            let best: Record<string, unknown> | undefined;
            let matchedBy = "index";
            if (Array.isArray(requestedChains) && requestedChains.length === 2
                && requestedChains[0] != null && requestedChains[1] != null) {
              best = pairs.find(p =>
                String(p.chain1) === String(requestedChains[0]) &&
                String(p.chain2) === String(requestedChains[1]));
              if (best) matchedBy = "chains";
            }
            if (!best) {
              const pairIndex = Number((params as any)?._pairIndex ?? 0);
              best = pool[Math.min(Math.max(pairIndex, 0), pool.length - 1)]!;
            }
            const bestInteractions = best.interactions as Array<Record<string, unknown>> | undefined;
            // R163: always overwrite chain1/chain2/interactions for the
            // selected pair (previously only set when missing, so a stale
            // top-level best-pair field could pin the viz to the wrong pair)
            if (best.chain1) (params as any).chain1 = best.chain1;
            if (best.chain2) (params as any).chain2 = best.chain2;
            if (Array.isArray(bestInteractions)) {
              (params as any).interactions = bestInteractions;
            }
            console.log(
              `[viz:pairwise] Visualizing pair ${best.chain1}-${best.chain2} ` +
              `(matched by ${matchedBy}, ${best.total ?? 0} interactions of ${pairs.length} pairs analyzed, ` +
              `${pool.length} in contact)`
            );
          }
        }

        // R167 (MOL-M1/M2): normalize recipe-specific interaction shapes into
        // the unified {chain1, resno1, atom1, chain2, resno2, atom2} list that
        // the focus/sidechain/lines steps below expect.
        //
        // Before this, only all_interactions and pairwise payloads matched —
        // standalone hbonds (donor_*/acceptor_* fields) and salt_bridges
        // (pos_*/neg_*) never populated params.interactions, so their captures
        // showed NO interface focus, NO ball-and-stick sidechains and NO
        // dashed H-bond lines. `normalizeInteractions` existed for exactly
        // this purpose but was only ever imported by the (now deleted) legacy
        // use-agent-loop.
        if (!Array.isArray((params as any).interactions) || (params as any).interactions.length === 0) {
          // (1) interface_residues: contacts → cross-pairs. Previously this
          // conversion was duplicated inside two safe() blocks, and the copy
          // in show_sidechains referenced chain1/chain2 OUT OF SCOPE (MOL-M2,
          // ReferenceError swallowed by safe()).
          const c1Res = (params as any)?.chain1_interface_residues as Array<Record<string, unknown>> | undefined;
          const c2Res = (params as any)?.chain2_interface_residues as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(c1Res) && Array.isArray(c2Res)) {
            const pChain1 = (params as any)?.chain1 as string | undefined;
            const pChain2 = (params as any)?.chain2 as string | undefined;
            const converted: Array<Record<string, unknown>> = [];
            if (pChain1 && pChain2) {
              for (const r of c1Res) {
                if (Array.isArray(r.contacts)) {
                  for (const c of r.contacts) {
                    converted.push({
                      chain1: pChain1, resno1: r.resno, resname1: r.name,
                      chain2: c.to_chain, resno2: c.to_res, resname2: c.to_name,
                      atom1: c.atom, atom2: undefined,
                    });
                  }
                }
              }
            }
            if (converted.length > 0) {
              (params as any).interactions = converted;
              console.log(`[viz:${recipe}] Converted interface_residues data: ${converted.length} interactions`);
            }
          }

          // (2) hbonds / salt_bridges / hydrophobic_contacts / nested
          // allInteractions → unified shape via the shared normalizer.
          if (!Array.isArray((params as any).interactions) || (params as any).interactions.length === 0) {
            const normalized = normalizeInteractions(params);
            if (normalized.length > 0) {
              // R167 follow-up: tag the entries with their interaction type —
              // normalizeInteractions preserves no type field, so draw_lines'
              // filter (type === 'hbond' | 'salt_bridge') would otherwise
              // match nothing and draw 0 dashed lines.
              const typeTag = recipe === 'hbonds' ? 'hbond'
                : recipe === 'salt_bridges' ? 'salt_bridge'
                : undefined;
              const tagged = typeTag
                ? normalized.map((n) => ({ ...n, type: typeTag }))
                : normalized;
              (params as any).interactions = tagged;
              console.log(`[viz:${recipe}] Normalized ${tagged.length} interactions (donor_*/pos_*/hydrophobic shape)`);
            }
          }

          // (3) hydrophobic_contacts aggregate fallback: the recipe emits only
          // top_residue_pairs strings like "A:VAL12 <-> B:LEU45" — parse those
          // into residue pairs (atomless: sidechains + focus only, no lines).
          if (!Array.isArray((params as any).interactions) || (params as any).interactions.length === 0) {
            const topPairs = (params as any)?.top_residue_pairs as Array<Record<string, unknown>> | undefined;
            if (Array.isArray(topPairs) && topPairs.length > 0) {
              const parsed: Array<Record<string, unknown>> = [];
              const pairRe = /^([A-Za-z0-9]):([A-Z]{3})(\d+)\s*<->\s*([A-Za-z0-9]):([A-Z]{3})(\d+)$/;
              for (const tp of topPairs) {
                const m = pairRe.exec(String(tp.pair ?? ""));
                if (m) {
                  parsed.push({
                    chain1: m[1], resno1: parseInt(m[3], 10), resname1: m[2],
                    chain2: m[4], resno2: parseInt(m[6], 10), resname2: m[5],
                  });
                }
              }
              if (parsed.length > 0) {
                (params as any).interactions = parsed;
                console.log(`[viz:${recipe}] Parsed ${parsed.length} hydrophobic residue pairs`);
              }
            }
          }

          // (4) Derive chain1/chain2 when the recipe output omits them (e.g.
          // whole-structure hbonds without chain restriction) — the focus
          // step requires both. Pick the most frequent interacting pair.
          if (!(params as any)?.chain1 || !(params as any)?.chain2) {
            const ints = (params as any).interactions as Array<Record<string, unknown>> | undefined;
            if (Array.isArray(ints) && ints.length > 0) {
              const counts = new Map<string, number>();
              for (const i of ints) {
                if (i.chain1 && i.chain2) {
                  const k = `${i.chain1}|${i.chain2}`;
                  counts.set(k, (counts.get(k) ?? 0) + 1);
                }
              }
              let bestK = "";
              let bestN = 0;
              for (const [k, n] of counts) if (n > bestN) { bestK = k; bestN = n; }
              if (bestK) {
                const [c1, c2] = bestK.split("|");
                if (!(params as any).chain1) (params as any).chain1 = c1;
                if (!(params as any).chain2) (params as any).chain2 = c2;
                console.log(`[viz:${recipe}] Derived focus chains ${c1}-${c2} (${bestN} interactions)`);
              }
            }
          }
        }

          // R157: Clean up ALL previous visualization artifacts before applying new one.
        // This prevents label/line/sidechain accumulation across analyses.
        await safe(async () => {
          // R167 (MOL-M4): remove only measurement cells WE added in a previous
          // analysis (tracked in vizAddedMeasurementRefs) — NOT the user's own
          // distances/labels. The old unconditional measurement.clear() here
          // destroyed user measurements even when nothing had leaked.
          // cleanupCapture normally removes our cells after each capture; this
          // is the safety net for leaked leftovers (e.g. pre-R167 sessions or
          // a failed cleanup).
          if (vizAddedMeasurementRefs.length > 0) {
            const removed = await removeMeasurementCells(plugin, vizAddedMeasurementRefs);
            console.log(`[viz:cleanup] Removed ${removed} leaked measurement cells from a previous analysis`);
            vizAddedMeasurementRefs = [];
          }
          // R173: remove the previous analysis's PERSISTED agent labels (tag
          // `agent-label`) — they were deliberately kept after the last
          // capture so the user could rotate/toggle them; a NEW analysis
          // replaces them with its own. This runs BEFORE this capture's
          // labels are added, so the new screenshots only show new labels.
          const removedLabels = await removeAgentLabels(plugin);
          if (removedLabels > 0) {
            console.log(`[viz:cleanup] Removed ${removedLabels} persisted agent label(s) from the previous analysis`);
          }
          // R170: also restore chains left hidden by a previous interrupted
          // run (cleanupCapture is the normal restore path).
          await restoreHiddenChains(plugin);
          // MOL2-01: restore water/ligand components left hidden by a previous
          // interrupted run (unhide the preset's own components, remove our
          // stand-ins). This REPLACES the old tag/label-based DELETION of
          // water/ligand components below — the preset's own components must
          // survive analyses, otherwise they can never be re-displayed (a
          // rebuilt static component has no representations).
          await restoreHiddenNonPolymer(plugin);
          // R171: remove leaked cartoon transparency layers from a previous
          // interrupted run (cleanupCapture is the normal restore path).
          const clearedT = await clearVizTransparency(plugin);
          if (clearedT > 0) console.log(`[viz:cleanup] Cleared ${clearedT} leaked transparency layer(s)`);
          // R161: Clear selection + green boxes (deselectAll is the real API;
          // the old lociSelects.clearHighlights() was a silent no-op).
          clearAllSelectionVisuals(plugin);
          // Remove previous components (interface sidechains and other
          // viz-created stand-ins).
          const structs = getStructures(plugin);
          let removedCount = 0;
          for (const s of structs) {
            const toRemove: any[] = [];
            for (const c of (s.components ?? [])) {
              const tags = c?.cell?.transform?.tags;
              const label = c?.cell?.obj?.label;
              // R159→MOL2-01: remove components that carry OUR viz tags.
              // Water/ligand components are deliberately NO LONGER matched
              // here — they belong to the representation preset (the
              // StructureComponent transform itself labels them "Water"/
              // "Ligand") and their visibility is managed by
              // restoreHiddenNonPolymer above, never by deletion.
              const hasTag = Array.isArray(tags) && (
                tags.includes('interface-sidechain') ||
                tags.some((t: string) => t.startsWith('structure-component-sidechain') ||
                         t.startsWith('structure-component-interface-sidechains'))
              );
              const hasLabel = label && (
                label.includes("Interface ") ||
                label.includes("sidechain")
              );
              if (hasTag || hasLabel) {
                toRemove.push(c);
              }
            }
            for (const c of toRemove) {
              // R167: `structure.component.remove` does NOT exist in the
              // prebuilt bundle (silent TypeError each call → "Removed 0
              // previous components"). hierarchy.remove([ref], true) is the
              // bundle-verified API (same one the bundle itself uses).
              try { plugin.managers.structure.hierarchy.remove([c], true); removedCount++; } catch (err) { console.warn('[viz:cleanup] remove failed:', err); }
            }
          }
          console.log(`[viz:cleanup] Removed ${removedCount} previous components`);
        }, "cleanup_previous");

        // R156→MOL2-01: Hide water AND ligand for the capture — IN PLACE.
        //
        // The old approach passed `{ label, tags: ['water-hide'/'ligand-hide'] }`
        // to tryCreateComponentStatic: applyOrUpdateTagged(keyTag) then UPDATED
        // the preset's OWN water/ligand component (merging our tags into it),
        // and the tag/label-based cleanup_previous DELETED those components
        // afterwards — after one interactions-family analysis the ligands
        // (HEM!) vanished from the live view and could never be re-shown
        // (a rebuilt static component has no representations). Instead:
        //   - preset component exists → hide it via toggleVisibility and
        //     snapshot its previous isHidden (restored by
        //     restoreHiddenNonPolymer from cleanupCapture);
        //   - no preset component → create a TAG-LESS stand-in (tracked by
        //     ref, deleted on restore) so the hide still applies.
        await safe(async () => {
          const structs = getStructures(plugin);
          if (structs.length === 0) return;
          const sr = structs[0] as any;

          for (const type of ["water", "ligand"] as const) {
            try {
              // Same keyTag tryCreateComponentStatic itself uses
              // (`structure-component-static-${key}`, key = `static-${type}`).
              const keyTag = `structure-component-static-${type}`;
              const existing = (sr.components ?? []).find(
                (c: any) => Array.isArray(c?.cell?.transform?.tags) &&
                  c.cell.transform.tags.includes(keyTag)
              );
              if (existing) {
                // Hide the preset's own component in place — no state update,
                // no tag merge; the isHidden snapshot lets the restore bring
                // back exactly the previous visibility.
                const wasHidden = !!existing?.cell?.state?.isHidden;
                vizHiddenNonPolymer.push({ ref: existing.cell.transform.ref, wasHidden, created: false });
                if (!wasHidden) {
                  plugin.managers.structure.hierarchy.toggleVisibility([existing], 'hide');
                }
                console.log(`[viz:hide] Hidden ${type} (preset static component — restored after capture)`);
              } else {
                // No preset component (e.g. polymer-cartoon / atomic-detail
                // presets don't create one) — create a stand-in. Deliberately
                // NO custom tags or label: custom tags would merge into a
                // later preset component via applyOrUpdateTagged and
                // re-introduce the MOL2-01 deletion path. The stand-in is
                // tracked by ref and removed by restoreHiddenNonPolymer.
                const standIn = await (plugin.builders.structure as any).tryCreateComponentStatic(sr.cell, type);
                if (standIn) {
                  vizHiddenNonPolymer.push({ ref: standIn.ref as string, wasHidden: false, created: true });
                  plugin.managers.structure.hierarchy.toggleVisibility([standIn], 'hide');
                  console.log(`[viz:hide] Hidden ${type} (stand-in component)`);
                }
              }
            } catch (err) { console.warn(`[viz:hide] ${type} failed:`, err); }
          }
        }, "hide_non_polymer");

        // R170: per-pair chain visibility — for multi-chain structures, hide
        // the chains that do not participate in this interface (e.g. 4HHB
        // A-B analysis hides C/D) so the captured view shows ONLY the pair.
        // Restored by cleanupCapture → restoreHiddenChains.
        await safe(async () => {
          const chain1 = params?.chain1 as string | undefined;
          const chain2 = params?.chain2 as string | undefined;
          if (chain1 && chain2 && chain1 !== chain2) {
            await hideOtherChains(plugin, [chain1, chain2]);
          }
        }, "hide_other_chains");

        await safe(async () => {
          let interactions = params?.interactions as Array<Record<string, unknown>> | undefined;
          const chain1 = params?.chain1 as string | undefined;
          const chain2 = params?.chain2 as string | undefined;
          // R132: Normalize interface_residues data format
          if (!Array.isArray(interactions) || interactions.length === 0) {
            const c1Res = params ? (params as any).chain1_interface_residues as Array<Record<string, unknown>> : undefined;
            const c2Res = params ? (params as any).chain2_interface_residues as Array<Record<string, unknown>> : undefined;
            if (Array.isArray(c1Res) && Array.isArray(c2Res)) {
              interactions = [];
              for (const r of c1Res) {
                if (r.contacts && Array.isArray(r.contacts)) {
                  for (const c of r.contacts) {
                    interactions.push({
                      chain1: chain1, resno1: r.resno, resname1: r.name,
                      chain2: c.to_chain, resno2: c.to_res, resname2: c.to_name,
                      atom1: c.atom, atom2: undefined,
                    });
                  }
                }
              }
              console.log(`[viz] Converted interface_residues data: ${interactions.length} interactions`);
            }
          }

          if (chain1 && chain2 && Array.isArray(interactions) && interactions.length > 0) {
            const residueSet = new Set<string>();
            const residueList: Array<{ chain: string; resno: number }> = [];
            for (const c of interactions) {
              const ch1 = c.chain1 as string;
              const rn1 = c.resno1 as number;
              const ch2 = c.chain2 as string;
              const rn2 = c.resno2 as number;
              if (ch1 && rn1) {
                const key = `${ch1}:${rn1}`;
                if (!residueSet.has(key)) {
                  residueSet.add(key);
                  residueList.push({ chain: ch1, resno: rn1 });
                }
              }
              if (ch2 && rn2) {
                const key = `${ch2}:${rn2}`;
                if (!residueSet.has(key)) {
                  residueSet.add(key);
                  residueList.push({ chain: ch2, resno: rn2 });
                }
              }
            }

            console.log(`[viz:focus] ${residueList.length} interface residues for ${chain1}-${chain2}`);

            if (residueList.length > 0) {
              // R158: Use buildResidueLoci to get loci, then focusLoci (official API)
              // This avoids selection.add() (green box) and getBoundary issues.
              const focusRefs = residueList.map(r => ({ chain: r.chain, resno: r.resno }));
              const focusResult = buildResidueLoci(plugin, focusRefs);

              if (focusResult && focusResult.loci) {
                // R158: Use focusLoci — Molstar's official API for focusing a loci.
                // It computes the bounding sphere internally and animates the camera.
                // R151: Use minRadius for wider view + VLM zoom multiplier
                // R170: 40 Å was too far — at that distance interface
                // sidechain sticks and labels were a few pixels each (user:
                // "focus到互作界面进行截图（远近适中）"). 20 Å frames the
                // interface residues + their sticks comfortably (VLM-verified
                // on the label-qa harness with real 4HHB A-B data).
                const baseMinRadius = 20;
                const minRadius = vlmZoomMultiplier ? baseMinRadius * vlmZoomMultiplier : baseMinRadius;
                plugin.managers.camera.focusLoci(focusResult.loci, { minRadius });
                console.log(`[viz:focus] focusLoci called with minRadius=${minRadius}`);
                await new Promise(r => setTimeout(r, 500)); // R158: wait for camera animation
              } else {
                console.warn('[viz:focus] buildResidueLoci returned null, falling back to camera.reset');
                plugin.managers.camera.reset();
                await new Promise(r => setTimeout(r, 200));
              }
            }
          } else if (chain1 && chain2) {
            plugin.managers.camera.reset();
            await new Promise(r => setTimeout(r, 100));
          }
        }, "focus_interface");

        await safe(async () => {
          let interactions = params?.interactions as Array<Record<string, unknown>> | undefined;
          if (!Array.isArray(interactions) || interactions.length === 0) {
            // R167 (MOL-M2): fallback conversion — chain1/chain2 were previously
            // referenced OUT OF SCOPE here (ReferenceError swallowed by safe()).
            // The main normalization at case start now handles interface_residues,
            // so this only runs as a last-resort fallback.
            const c1Res = params ? (params as any).chain1_interface_residues as Array<Record<string, unknown>> : undefined;
            const c2Res = params ? (params as any).chain2_interface_residues as Array<Record<string, unknown>> : undefined;
            const fbChain1 = params?.chain1 as string | undefined;
            const fbChain2 = params?.chain2 as string | undefined;
            if (Array.isArray(c1Res) && Array.isArray(c2Res) && fbChain1 && fbChain2) {
              interactions = [];
              // Degenerate self-pairs are sufficient here: this block only
              // consumes the residue SET (chain1/resno1 + chain2/resno2 keys).
              for (const r of c1Res) interactions.push({ chain1: fbChain1, resno1: r.resno, chain2: fbChain2, resno2: r.resno });
              for (const r of c2Res) interactions.push({ chain1: fbChain1, resno1: r.resno, chain2: fbChain2, resno2: r.resno });
            }
          }
          if (!Array.isArray(interactions) || interactions.length === 0) return;

          const structs = getStructures(plugin);
          if (structs.length === 0) return;
          const sr = structs[0];
          const data = sr?.cell?.obj?.data;
          if (!data) return;

          // R152: Collect ALL interface residues for side chain display
          const residueSet = new Set<string>();
          for (const c of interactions) {
            const ch1 = c.chain1 as string;
            const rn1 = c.resno1 as number;
            const ch2 = c.chain2 as string;
            const rn2 = c.resno2 as number;
            if (ch1 && rn1) residueSet.add(`${ch1}:${rn1}`);
            if (ch2 && rn2) residueSet.add(`${ch2}:${rn2}`);
          }

          if (residueSet.size === 0) return;

          const residueList = Array.from(residueSet);
          console.log(`[viz:show_sidechains] Showing ${residueList.length} interface residue side chains`);

          // R154: Use buildResidueLoci (StructureElement-based, NOT MolScript Q)
          // to build loci for ALL interface residues at once, then create a
          // single component with ball-and-stick representation.
          // R167 (MOL-M8): cap raised 30 → 60 and truncation is now LOGGED —
          // large interfaces used to silently show partial sticks.
          const MAX_SIDECHAIN_RESIDUES = 60;
          const refs = residueList.slice(0, MAX_SIDECHAIN_RESIDUES).map(key => {
            const [chain, resnoStr] = key.split(":");
            return { chain, resno: parseInt(resnoStr, 10) };
          });
          if (residueList.length > MAX_SIDECHAIN_RESIDUES) {
            console.warn(`[viz:show_sidechains] ${residueList.length} interface residues exceed cap ${MAX_SIDECHAIN_RESIDUES} — showing first ${MAX_SIDECHAIN_RESIDUES}`);
          }

          const result = buildResidueLoci(plugin, refs);
          if (result) {
            const structs = getStructures(plugin);
            const sr = structs[0];
            const tag = `interface-sidechains-${Date.now()}`;
            const component = await plugin.builders.structure.tryCreateComponentFromExpression(
              sr.cell, result.expr, tag, { tags: ['interface-sidechain'] }
            );
            if (component) {
              // R157: Even smaller ball-and-stick for clean side chain display
              await plugin.builders.structure.representation.addRepresentation(component, {
                type: "ball-and-stick",
                typeParams: {
                  sizeFactor: 0.2,       // R157: much smaller balls (was 0.3)
                  bondScale: 0.15,       // R157: much thinner bonds (was 0.25)
                  bondSpacing: 0.05,
                  aromaticBonds: true,
                  multipleBonds: true,
                  ignoreHydrogens: true,
                },
                // R171: `colorTheme: { name, params }` was silently IGNORED —
                // createStructureRepresentationParams' string-type path only
                // reads `color`/`colorParams` (verified against molstar 5.11.0
                // helpers/structure-representation-params.js). With the WRONG
                // prop the sticks fell back to the representation default and
                // were then re-themed to chain-id by applyColorTheme (see the
                // exclusion added there). `color` is the correct prop.
                color: "element-symbol",
              });
              console.log(`[viz:show_sidechains] Created ball-and-stick component for ${refs.length} residues`);
            } else {
              console.warn('[viz:show_sidechains] tryCreateComponentFromExpression returned undefined');
            }
          } else {
            console.warn('[viz:show_sidechains] buildResidueLoci returned null — no matching residues found');
          }
        }, "show_sidechains");

        await safe(async () => {
          let interactions = params?.interactions as Array<Record<string, unknown>> | undefined;
          if (!Array.isArray(interactions) || interactions.length === 0) return;

          // R148: ONLY draw distance lines for H-bonds and salt bridges
          const hbondInteractions = interactions.filter(c => {
            const type = (c.type as string | undefined)?.toLowerCase() ?? '';
            const hasAtoms = c.atom1 && c.atom2;
            return (type === 'hbond' || type === 'salt_bridge' || type === 'salt-bridge') && hasAtoms;
          });

          // R167 (MOL-M8): cap interaction lines (was uncapped — a 100+ H-bond
          // interface added 100+ distance measurements, cluttering the view
          // and degrading perf). Distances sort by availability — keep input
          // order (recipes already rank by significance).
          const MAX_INTERACTION_LINES = 60;
          const linesToDraw = hbondInteractions.slice(0, MAX_INTERACTION_LINES);
          if (hbondInteractions.length > MAX_INTERACTION_LINES) {
            console.warn(`[viz:draw_lines] ${hbondInteractions.length} H-bond/salt-bridge lines exceed cap ${MAX_INTERACTION_LINES} — drawing first ${MAX_INTERACTION_LINES}`);
          }

          console.log(`[viz:draw_lines] Drawing ${linesToDraw.length} distance lines`);

          // R167 (MOL-M4b): snapshot measurement refs before/after so the
          // capture cleanup (and the next analysis's cleanup_previous) can
          // remove exactly the cells added here — user measurements survive.
          const measBefore = snapshotMeasurementRefs(plugin);

          // R154: Use buildResidueLoci for atom-level loci (NOT MolScript Q)
          for (const c of linesToDraw) {
            try {
              const chain1 = c.chain1 as string;
              const resno1 = c.resno1 as number;
              const atom1 = c.atom1 as string;
              const chain2 = c.chain2 as string;
              const resno2 = c.resno2 as number;
              const atom2 = c.atom2 as string;

              // Build atom-level loci for each interacting atom
              const result1 = buildResidueLoci(plugin, [{ chain: chain1, resno: resno1, atomName: atom1 }]);
              const result2 = buildResidueLoci(plugin, [{ chain: chain2, resno: resno2, atomName: atom2 }]);

              if (result1 && result2) {
                await plugin.managers.structure.measurement.addDistance(result1.loci, result2.loci);
                console.log(`[viz:draw_lines] Added: ${chain1}:${resno1}(${atom1}) — ${chain2}:${resno2}(${atom2})`);
              } else {
                console.warn(`[viz:draw_lines] Atoms not found: ${chain1}:${resno1}(${atom1}) or ${chain2}:${resno2}(${atom2})`);
              }
            } catch (err) { console.warn(`[viz:draw_lines] failed:`, err); }
          }

          // R167 (MOL-M4b): record the measurement cells this step added so
          // cleanupCapture / cleanup_previous remove exactly these.
          const measAfter = snapshotMeasurementRefs(plugin);
          const added = diffMeasurementRefs(measBefore, measAfter);
          if (added.length > 0) {
            vizAddedMeasurementRefs.push(...added);
            console.log(`[viz:draw_lines] Tracked ${added.length} measurement cells for selective cleanup`);
          }
        }, "draw_interaction_lines");

        // R170: residue-PAIR labels — "PRO114–HIS116 2.7Å" anchored at the
        // midpoint of the two interacting atoms. This is what lets the VLM
        // (and the user) verify the specific interactions the analysis
        // reported, e.g. "PRO114-HIS116" on 4HHB A-B. Top-6 only (recipes
        // pre-sort by significance/distance); gold text distinguishes them
        // from the per-residue labels drawn by capture_multi_angle.
        await safe(async () => {
          const interactions = params?.interactions as Array<Record<string, unknown>> | undefined;
          if (!Array.isArray(interactions) || interactions.length === 0) return;
          const pairCandidates = interactions.filter(
            (c) => c.chain1 && c.resno1 && c.chain2 && c.resno2 &&
              (c.resname1 || c.resname2) &&
              (c.type === 'hbond' || c.type === 'salt_bridge' || c.type === 'salt-bridge' || c.type === 'hydrophobic')
          );
          const top = pairCandidates.slice(0, 6);
          if (top.length === 0) return;

          const measBefore = snapshotMeasurementRefs(plugin);

          // R171: pass 1 — resolve each pair's loci and anchor center. The
          // camera is already at the focused-interface view, so the anchor
          // distances measured NOW drive per-label size compensation below
          // ("有一些比较远的氨基酸的label很小看不清楚" — text is true 3D
          // geometry whose screen size shrinks ~1/distance).
          const prepared: Array<{ it: Record<string, unknown>; result: { loci: unknown } }> = [];
          for (const it of top) {
            try {
              // Loci spanning BOTH endpoints (atom-level when the recipe
              // reports atoms) → the label anchors at their midpoint.
              const refs = [
                { chain: it.chain1 as string, resno: it.resno1 as number, atomName: it.atom1 as string | undefined },
                { chain: it.chain2 as string, resno: it.resno2 as number, atomName: it.atom2 as string | undefined },
              ];
              const result = buildResidueLoci(plugin, refs);
              if (result) prepared.push({ it, result });
            } catch (err) { console.warn('[viz:pair_labels] one pair failed:', err); }
          }
          if (prepared.length === 0) return;

          const ratios = getLabelSizeRatios(
            plugin,
            prepared.map((p) => getLociCenter(p.result.loci)),
            14 // offsetZ used below — the depth labels actually render at
          );

          let drawn = 0;
          for (let idx = 0; idx < prepared.length; idx++) {
            const { it, result } = prepared[idx];
            try {
              const ratio = ratios[idx] ?? 1;
              const d = it.distance_A != null ? ` ${Number(it.distance_A).toFixed(1)}Å` : "";
              await plugin.managers.structure.measurement.addLabel(result.loci, {
                labelParams: {
                  customText: `${it.resname1 ?? ''}${it.resno1}–${it.resname2 ?? ''}${it.resno2}${d}`,
                  textColor: 0xffd700, // gold — distinct from per-residue chain colors
                  // R171: distance-compensated sizing (far pairs render as
                  // large as near ones; clamped so outliers stay sane).
                  textSize: 0.48 * ratio,
                  sizeFactor: 0.48 * ratio,
                  offsetX: 0, offsetY: 0,
                  offsetZ: 14,          // clear the cartoon toward the camera (Å)
                  borderWidth: 0.16, borderColor: 0x101010,
                  background: true, backgroundColor: 0x000000, backgroundOpacity: 0.55,
                  backgroundMargin: 0.1,
                  attachment: (drawn % 2 === 0) ? 'top-center' : 'bottom-center',
                  tether: true, tetherLength: 0.9, tetherBaseWidth: 0.16,
                },
                // R173: agent tag — covered by the toolbar show/hide toggle.
                reprTags: [AGENT_LABEL_TAG],
              } as any);
              drawn++;
            } catch (err) { console.warn('[viz:pair_labels] one pair failed:', err); }
          }
          const measAfter = snapshotMeasurementRefs(plugin);
          const addedRefs = diffMeasurementRefs(measBefore, measAfter);
          if (addedRefs.length > 0) vizAddedMeasurementRefs.push(...addedRefs);
          console.log(`[viz:pair_labels] Drew ${drawn} residue-pair labels (${addedRefs.length} tracked for cleanup)`);
        }, "draw_pair_labels");

        // R171: semi-transparent cartoon — the interface sidechain sticks sit
        // IN/BEHIND the cartoon surface; at full opacity they are hard to make
        // out ("界面还是看得不是很清晰"). A 0.4 transparency layer on the
        // cartoon representations (polymer + per-pair stand-ins; the
        // element-colored sticks stay solid) lets the sticks read through.
        // Cleared by cleanupCapture and the next run's cleanup_previous.
        await safe(async () => {
          await applyCartoonTransparency(plugin, 0.4);
        }, "cartoon_transparency");

        await safe(async () => { await applyColorTheme("chain-id"); }, "color_chain");
        break;
      }

      case "druggability": {
        const ligandCompId = params?.ligandCompId as string | undefined;
        if (ligandCompId) {
          await safe(async () => {
            const loci = await lociFromResidue(viewer, { compId: ligandCompId });
            if (loci) plugin.managers.camera.focusLoci(loci, { minRadius: 18 });
          }, "focus_druggable_pocket");
        }
        await safe(async () => { await applyColorTheme("hydrophobicity"); }, "color_hydrophobicity");
        break;
      }

      case "virtual_screening":
      case "druglike_screening": {
        const ligandCompId = params?.ligandCompId as string | undefined;
        if (ligandCompId) {
          await safe(async () => {
            const loci = await lociFromResidue(viewer, { compId: ligandCompId });
            if (loci) plugin.managers.camera.focusLoci(loci, { minRadius: 16 });
          }, "focus_screening_pocket");
        }
        await safe(async () => { await applyColorTheme("element-symbol"); }, "color_element");
        break;
      }

      case "disulfide_bonds":
      case "metal_coordination":
      case "aromatic_stacking":
      case "water_bridges": {
        await safe(async () => {
          const data = getFirstStructureData(plugin);
          if (!data) return;
          const structs = getStructures(plugin);
          if (structs.length > 0 && structs[0].components) {
            for (const c of structs[0].components) {
              const tags = c?.cell?.transform?.tags;
              if (Array.isArray(tags) && tags.includes("structure-component-static-chain")) {
                const loci = c.cell?.obj?.data?.sourceSelection?.loci;
                if (loci && !isLociEmpty(loci)) {
                  plugin.managers.camera.focusLoci(loci, { minRadius: 20 });
                  return;
                }
              }
            }
          }
        }, "focus_chain_for_special_bonds");
        await safe(async () => { await applyColorTheme("element-symbol"); }, "color_element");
        break;
      }

      case "sasa":
      case "surface_residues": {
        await safe(async () => { await applyColorTheme("hydrophobicity"); }, "color_hydrophobicity");
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_surface");
        break;
      }

      case "electrostatic":
      case "apbs_electrostatic": {
        await safe(async () => { await applyColorTheme("partial-charge"); }, "color_charge");
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_electrostatic");
        break;
      }

      case "bfactor_stats": {
        await safe(async () => { await applyColorTheme("uncertainty"); }, "color_bfactor");
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_bfactor");
        break;
      }

      case "secondary_structure_simple": {
        await safe(async () => { await applyColorTheme("secondary-structure"); }, "color_ss");
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_ss");
        break;
      }

      case "rmsd":
      case "conformational_changes":
      case "per_residue_rmsd_two": {
        await safe(async () => { await applyColorTheme("uncertainty"); }, "color_rmsd");
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_rmsd");
        break;
      }

      case "detect_pockets": {
        await safe(async () => { await applyColorTheme("chain-id"); }, "color_chain");
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_pocket_detection");
        break;
      }

      case "summary": {
        await safe(async () => { await applyColorTheme("sequence-id"); }, "color_spectrum");
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_summary");
        break;
      }

      case "ramachandran": {
        await safe(async () => { await applyColorTheme("secondary-structure"); }, "color_ss_rama");
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_ramachandran");
        break;
      }

      case "contact_map": {
        await safe(async () => { await applyColorTheme("chain-id"); }, "color_chain_cm");
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_contact_map");
        break;
      }

      case "distances":
      case "align_and_superpose":
      case "align_save_transformed":
      case "cross_pdb_rmsd":
      case "cross_pdb_rmsd_aligned": {
        await safe(async () => { await applyColorTheme("chain-id"); }, "color_chain_align");
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_alignment");
        break;
      }

      case "entity_analysis": {
        await safe(async () => { await applyColorTheme("entity-id"); }, "color_entity");
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_entity");
        break;
      }

      case "protonation_states": {
        await safe(async () => { await applyColorTheme("element-symbol"); }, "color_protonation");
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_protonation");
        break;
      }

      case "sequence_align":
      case "sequence_features": {
        await safe(async () => { await applyColorTheme("sequence-id"); }, "color_seq");
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_sequence");
        break;
      }

      case "structure_validation": {
        await safe(async () => { await applyColorTheme("uncertainty"); }, "color_validation");
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_validation");
        break;
      }

      case "blast_chain_id": {
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_blast");
        break;
      }

      default: {
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_default");
        break;
      }
    }
  } catch (err) {
    console.warn(`[applyRecipeVisualization:${recipe}] overall error:`, err);
  }
}
