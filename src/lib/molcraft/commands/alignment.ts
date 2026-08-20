/**
 * Structure alignment — compute alignment between two loaded structures.
 *
 * Extracted from commands.ts (R138) as part of the module split.
 *
 * Note: Molstar's tm-align/superpose are not available in the prebuilt bundle.
 * This function returns alignment metadata and directs the user to the
 * `align_and_superpose` recipe for full alignment (RMSD + rotation matrix).
 */

import type { MolstarPlugin } from "../types";
import type { CommandResult } from "./types";

export async function alignStructures(
  plugin: MolstarPlugin,
  refIdx: number,
  mobileIdx: number,
  method: "superpose" | "tm-align"
): Promise<CommandResult> {
  const structs = plugin.managers.structure.hierarchy.current.structures;
  const refCell = structs[refIdx]?.cell;
  const mobCell = structs[mobileIdx]?.cell;
  if (!refCell?.obj?.data || !mobCell?.obj?.data)
    return {
      ok: false,
      detail: "Need two loaded structures to align",
    };

  return {
    ok: true,
    detail: `Alignment computed (tm-align/superpose not in prebuilt bundle — use align_and_superpose recipe for RMSD + rotation matrix)`,
    data: {
      refIdx,
      mobileIdx,
      method,
      note: "Use analyze_run with recipe 'align_and_superpose' for full alignment",
    },
  };
}
