/**
 * Loci helpers — build StructureElement.Loci from residue/chain references.
 *
 * Extracted from commands.ts (R138) as part of the module split.
 */

import type { MolstarViewer } from "../types";
import type { ResidueRef } from "../command-schema";
import { getFirstStructureData, isLociEmpty } from "./structure-helpers";

/**
 * Build a StructureElement.Loci from a residue spec by using MolScript
 * expressions via the viewer's high-level API.
 *
 * R137: Uses `getLociFromExpression` (non-destructive) as the primary path,
 * falling back to select-then-read only if unavailable.
 */
export async function lociFromResidue(
  viewer: MolstarViewer,
  ref: ResidueRef,
  atomName?: string
): Promise<unknown> {
  const plugin = viewer.plugin;
  const data = getFirstStructureData(plugin);
  if (!data) return null;

  // Build the MolScript expression. `Q` is provided by the viewer.
  const expr = (Q: any) => {
    const residueTests: any[] = [];
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
    // R104.4: Support insertion codes (e.g. 145A, 145B)
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

    // Atom name filter goes in 'atom-test', not 'residue-test'
    const atomTest =
      atomName || ref.atom
        ? Q.core.rel.eq([
            Q.struct.atomProperty.macromolecular.label_atom_id(),
            atomName ?? ref.atom,
          ])
        : undefined;

    const params: any = {
      "group-by": Q.struct.atomProperty.macromolecular.residueKey(),
    };
    if (residueTest) params["residue-test"] = residueTest;
    if (atomTest) params["atom-test"] = atomTest;
    return Q.struct.generator.atomGroups(params);
  };

  try {
    // R137: Non-destructive path — getLociFromExpression resolves a MolScript
    // expression to a Loci WITHOUT touching the selection manager.
    const getLociFromExpression = plugin.managers.structure.selection.getLociFromExpression as
      | ((expr: unknown, data: unknown) => unknown) | undefined;
    if (typeof getLociFromExpression === 'function') {
      const loci = getLociFromExpression(expr, data);
      if (loci && !isLociEmpty(loci)) {
        return loci;
      }
    }

    // Fallback: select-then-read-back (destructive — only used when
    // getLociFromExpression is not available in the prebuilt bundle).
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
      } catch (err) {
        console.warn('[lociFromResidue] hadSelection check failed:', err);
        return false;
      }
    })();

    plugin.managers.structure.selection.clear();
    viewer.structureInteractivity({ expression: expr, action: ["select"] });
    await new Promise((r) => setTimeout(r, 30));

    const entries = plugin.managers.structure.selection.entries as
      | Map<unknown, { _selection?: { elements?: unknown[] }; selection?: { elements?: unknown[] } }>
      | undefined;
    if (entries && typeof entries.forEach === "function") {
      let foundLoci: unknown = null;
      entries.forEach((val) => {
        const sel = val?._selection || val?.selection;
        if (
          sel?.elements &&
          sel.elements.length > 0 &&
          !foundLoci
        ) {
          foundLoci = sel;
        }
      });
      if (foundLoci) return foundLoci;
    }
    const loci = plugin.managers.structure.selection.getLoci(data);
    if (loci && !isLociEmpty(loci)) {
      return loci;
    }
    if (hadSelection) {
      console.warn('[lociFromResidue] Cleared a user selection but found no matching loci');
    }
    return null;
  } catch (err) {
    console.warn("[lociFromResidue] failed:", err);
    return null;
  }
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
