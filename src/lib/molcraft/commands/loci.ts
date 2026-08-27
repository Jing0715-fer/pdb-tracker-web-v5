/**
 * Loci helpers — build StructureElement.Loci from residue/chain references.
 *
 * Extracted from commands.ts (R138) as part of the module split.
 *
 * R161 (green-box bug fix):
 * The old primary path called `plugin.managers.structure.selection.getLociFromExpression`
 * — a method that does NOT exist in the prebuilt Molstar bundle. So EVERY call
 * fell through to the destructive fallback:
 *     viewer.structureInteractivity({ expression, action: ["select"] })
 * which SELECTS the residue (green box on canvas). Combined with the broken
 * clearing (lociSelects.clearHighlights() missing), the green boxes leaked
 * into every screenshot.
 *
 * Now the primary path builds the loci by directly traversing the structure
 * units (same technique as buildResidueLoci in recipe-viz.ts) — completely
 * non-destructive. The destructive select path only remains as a last-resort
 * fallback and immediately deselects after reading the loci back.
 */

import type { MolstarViewer } from "../types";
import type { ResidueRef } from "../command-schema";
import { getFirstStructureData, isLociEmpty } from "./structure-helpers";

/**
 * R161: Build a StructureElement.Loci for residue specs by direct unit
 * traversal — NO selection side effects.
 *
 * Supports matching by chain / resno / compId / insCode / atomName.
 * Returns the loci, or null when nothing matched or the bundle APIs are
 * unavailable.
 */
export function buildLociByTraversal(
  viewer: MolstarViewer,
  refs: ResidueRef[]
): unknown | null {
  const plugin = viewer.plugin;
  const bundle = (window as any).molstar;
  const SE = bundle?.lib?.structure?.StructureElement;
  const SP = bundle?.lib?.structure?.StructureProperties;
  if (!SE || !SP) return null;

  const structs = plugin.managers.structure.hierarchy.current.structures;
  if (!structs.length) return null;
  const data = structs[0]?.cell?.obj?.data as any;
  if (!data) return null;

  // Compile matchers. A ref without any test matches nothing (defensive);
  // callers pass at least chain/resno or compId.
  interface Matcher {
    chain?: string;
    resno?: number;
    compId?: string;
    insCode?: string;
    atom?: string;
  }
  const matchers: Matcher[] = refs
    .filter((r) => r && (r.chain || r.compId))
    .map((r) => ({
      chain: r.chain,
      resno: r.resno,
      compId: r.compId ? r.compId.toUpperCase() : undefined,
      insCode: r.insCode,
      atom: r.atom,
    }));
  if (matchers.length === 0) return null;

  const matches = (m: Matcher, chainId: string, resno: number, compId: string, insCode: string, atomId: string): boolean => {
    if (m.chain && m.chain !== chainId) return false;
    if (m.resno !== undefined && m.resno !== resno) return false;
    if (m.compId && m.compId !== compId.toUpperCase()) return false;
    if (m.insCode && m.insCode !== insCode) return false;
    if (m.atom && m.atom !== atomId) return false;
    return true;
  };

  const elementsByUnit = new Map<unknown, number[]>();
  for (const unit of data.units) {
    if (unit.kind !== 0) continue; // atomic units only
    const indices: number[] = [];
    for (let i = 0; i < unit.elements.length; i++) {
      // R166 (multi-chain loci bug): Location.create's 3rd arg is the ELEMENT
      // (unit.elements[i]), not the within-unit position — see recipe-viz.ts.
      const loc = SE.Location.create(data, unit, unit.elements[i]);
      const chainId = SP.chain.auth_asym_id(loc) || SP.chain.label_asym_id(loc);
      const resno = SP.residue.auth_seq_id(loc);
      const compId = SP.residue.label_comp_id(loc);
      const insCode = (SP.residue.pdbx_PDB_ins_code ? String(SP.residue.pdbx_PDB_ins_code(loc) ?? "") : "");
      const atomId = SP.atom.label_atom_id(loc);
      for (const m of matchers) {
        if (matches(m, chainId, resno, compId, insCode, atomId)) {
          indices.push(i);
          break;
        }
      }
    }
    if (indices.length > 0) {
      elementsByUnit.set(unit, indices);
    }
  }

  if (elementsByUnit.size === 0) return null;

  const elements: Array<{ unit: unknown; indices: number[] }> = [];
  elementsByUnit.forEach((indices, unit) => {
    elements.push({ unit, indices });
  });
  return new SE.Loci(data, elements);
}

/**
 * Build a StructureElement.Loci from a residue spec.
 *
 * R161 resolution order:
 *   1. getLociFromExpression (kept for forward-compat with full bundles)
 *   2. buildLociByTraversal — non-destructive direct traversal (NEW default)
 *   3. Legacy destructive select-then-read-back — only if 1+2 fail, and it
 *      deselects immediately after reading so no green box remains.
 */
export async function lociFromResidue(
  viewer: MolstarViewer,
  ref: ResidueRef,
  atomName?: string
): Promise<unknown> {
  const plugin = viewer.plugin;
  const data = getFirstStructureData(plugin);
  if (!data) return null;

  // Path 1: non-destructive expression resolution (full bundles only).
  try {
    const getLociFromExpression = (plugin.managers.structure.selection as any).getLociFromExpression as
      | ((expr: unknown, data: unknown) => unknown) | undefined;
    if (typeof getLociFromExpression === 'function') {
      const expr = buildMolScriptExpr(viewer, ref, atomName);
      const loci = getLociFromExpression(expr, data);
      if (loci && !isLociEmpty(loci)) {
        return loci;
      }
    }
  } catch { /* fall through */ }

  // Path 2 (R161): non-destructive direct unit traversal.
  try {
    const traversed = buildLociByTraversal(viewer, [{ ...ref, atom: atomName ?? ref.atom }]);
    if (traversed && !isLociEmpty(traversed)) {
      return traversed;
    }
  } catch (err) {
    console.warn('[lociFromResidue] buildLociByTraversal failed:', err);
  }

  // Path 3 (last resort, destructive): select → read back → deselect.
  try {
    const hadSelection = (() => {
      try {
        const entries = plugin.managers.structure.selection.entries as
          | Map<unknown, { _selection?: { elements?: unknown[] }; selection?: { elements?: unknown[] } }>
          | undefined;
        if (!entries || typeof entries.forEach !== 'function') return false;
        let any = false;
        entries.forEach((val) => {
          const sel = val?._selection || val?.selection;
          if (sel?.elements && sel.elements.length > 0) any = true;
        });
        return any;
      } catch {
        return false;
      }
    })();

    // R164 (MOL-006): snapshot the user's CURRENT selection before the
    // destructive clear() below. getLoci returns a StructureElement.Loci for
    // the first structure — exactly what selection.add() accepts — so the
    // user's selection can be put back if (and only if) it existed.
    const savedUserLoci: unknown = (() => {
      try {
        const sel = plugin.managers.structure.selection as unknown as {
          getLoci?: (structure: unknown) => unknown;
        };
        if (typeof sel.getLoci !== 'function') return null;
        const loci = sel.getLoci(data);
        return loci && !isLociEmpty(loci) ? loci : null;
      } catch {
        return null;
      }
    })();

    let foundLoci: unknown = null;
    try {
      plugin.managers.structure.selection.clear();
      const expr = buildMolScriptExpr(viewer, ref, atomName);
      (viewer as any).structureInteractivity({ expression: expr, action: ["select"] });
      await new Promise((r) => setTimeout(r, 30));

      const entries = plugin.managers.structure.selection.entries as
        | Map<unknown, { _selection?: { elements?: unknown[] }; selection?: { elements?: unknown[] } }>
        | undefined;
      if (entries && typeof entries.forEach === "function") {
        entries.forEach((val) => {
          const sel = val?._selection || val?.selection;
          if (sel?.elements && sel.elements.length > 0 && !foundLoci) {
            foundLoci = sel;
          }
        });
      }
      if (!foundLoci) {
        const loci = plugin.managers.structure.selection.getLoci(data);
        if (loci && !isLociEmpty(loci)) {
          foundLoci = loci;
        }
      }
    } catch (err) {
      console.warn('[lociFromResidue] destructive read-back failed:', err);
    } finally {
      // R161: ALWAYS deselect after the destructive read-back so no green
      // selection box is left on the canvas.
      try { plugin.managers.interactivity.lociSelects.deselectAll(); } catch { /* best-effort */ }
      try { plugin.managers.structure.selection.clear(); } catch { /* best-effort */ }

      // R164 (MOL-006): restore the user's pre-call selection. This runs on
      // EVERY path-3 outcome — when path-3 finds its loci AND when it comes
      // up empty/invalid (previously the empty case left the user with a
      // cleared selection: their selection was silently destroyed by a mere
      // residue lookup). All three resolution paths can now fail without
      // breaking the user's selection state.
      if (savedUserLoci) {
        try {
          const sel = plugin.managers.structure.selection as unknown as {
            add?: (loci: unknown) => void;
          };
          if (typeof sel.add === 'function') {
            sel.add(savedUserLoci);
          } else {
            console.warn('[lociFromResidue] selection.add unavailable — user selection could not be restored');
          }
        } catch (err) {
          console.warn('[lociFromResidue] failed to restore user selection:', err);
        }
      }
    }

    if (foundLoci) return foundLoci;
    if (hadSelection) {
      console.warn('[lociFromResidue] Path-3 found no matching loci (user selection was restored where possible)');
    }
    return null;
  } catch (err) {
    console.warn("[lociFromResidue] failed:", err);
    return null;
  }
}

/** Build the MolScript expression for a residue ref (used by paths 1 and 3). */
function buildMolScriptExpr(viewer: MolstarViewer, ref: ResidueRef, atomName?: string): unknown {
  const Q = (viewer as any)?.Q ?? (window as any).molstar?.lib?.molscript;
  if (!Q) return null;
  const residueTests: unknown[] = [];
  if (ref.chain)
    residueTests.push(
      Q.core.rel.eq([
        Q.struct.atomProperty.macromolecular.auth_asym_id(),
        ref.chain,
      ])
    );
  if (ref.resno !== undefined)
    residueTests.push(
      Q.core.rel.eq([
        Q.struct.atomProperty.macromolecular.auth_seq_id(),
        ref.resno,
      ])
    );
  if (ref.compId)
    residueTests.push(
      Q.core.rel.eq([
        Q.struct.atomProperty.macromolecular.label_comp_id(),
        ref.compId,
      ])
    );
  if (ref.insCode)
    residueTests.push(
      Q.core.rel.eq([
        Q.struct.atomProperty.macromolecular.label_ins_code(),
        ref.insCode,
      ])
    );
  const residueTest =
    residueTests.length === 0
      ? undefined
      : residueTests.length === 1
      ? residueTests[0]
      : Q.core.logic.and(residueTests);

  const atomTest =
    atomName || ref.atom
      ? Q.core.rel.eq([
          Q.struct.atomProperty.macromolecular.label_atom_id(),
          atomName ?? ref.atom,
        ])
      : undefined;

  const params: Record<string, unknown> = {
    "group-by": Q.struct.atomProperty.macromolecular.residueKey(),
  };
  if (residueTest) params["residue-test"] = residueTest;
  if (atomTest) params["atom-test"] = atomTest;
  return Q.struct.generator.atomGroups(params);
}

/** Build a chain loci using StructureElement.Loci.fromSchema. */
export async function lociFromChain(
  viewer: MolstarViewer,
  chain: string
): Promise<unknown> {
  const plugin = viewer.plugin;
  const data = getFirstStructureData(plugin);
  if (!data) return null;

  try {
    const lib = (window as any).molstar?.lib;
    const Loci = lib?.structure?.StructureElement?.Loci;
    if (!Loci?.fromSchema) {
      return lociFromResidue(viewer, { chain });
    }
    const loci = Loci.fromSchema(data, {
      "chain-test": { auth_asym_id: chain },
    });
    if (loci && !isLociEmpty(loci)) return loci;
    return null;
  } catch (err) {
    console.warn(`[lociFromChain] fromSchema failed for chain "${chain}", falling back:`, err);
    return lociFromResidue(viewer, { chain });
  }
}

/** Resolve an interactions target to a loci. */
export async function resolveInteractionsTarget(
  viewer: MolstarViewer,
  target: ResidueRef | "selection" | "ligand" | undefined
): Promise<unknown> {
  const plugin = viewer.plugin;
  if (!target || target === "selection") {
    const data = getFirstStructureData(plugin);
    return data; // approximate: focus whole structure if no selection
  }
  if (target === "ligand") {
    return lociFromResidue(viewer, {});
  }
  return lociFromResidue(viewer, target);
}
