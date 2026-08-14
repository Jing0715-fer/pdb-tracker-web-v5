/**
 * Domain Tools — Registration of PDB structure analysis tools.
 *
 * This module registers all the tools that the agent can call:
 * - pdb_load: Load a PDB structure
 * - pdb_analyze: Run an analysis recipe
 * - set_representation: Change the 3D representation
 * - set_color_theme: Change the color theme
 * - focus_ligand: Focus camera on a ligand
 * - focus_residue: Focus camera on a specific residue
 * - capture_multi_angle: Capture screenshots from multiple angles
 * - measure_distance: Measure distance between two atoms
 * - clear_chat: Clear the chat (requires approval)
 *
 * Each tool wraps the existing executeCommand function from commands.ts,
 * so the tool-calling agent loop reuses all the existing Molstar logic.
 */

import { toolRegistry, type ToolDefinition, type ToolExecutor, type ToolExecutionContext } from "./tool-registry";

// Tool definitions (schema only — executors are registered separately)

const PDB_LOAD: ToolDefinition = {
  name: "pdb_load",
  description: "Load a PDB structure by ID (e.g. 4HHB, 6LU7, 1CBS). Downloads from RCSB.",
  category: "structure",
  parameters: {
    id: { type: "string", description: "4-character PDB ID (e.g. 4HHB)", required: true },
  },
};

const PDB_ANALYZE: ToolDefinition = {
  name: "pdb_analyze",
  description: "Run a structure analysis recipe (hbonds, salt_bridges, binding_pocket, all_interactions, etc.)",
  category: "analysis",
  parameters: {
    recipe: {
      type: "string",
      description: "Analysis recipe name",
      required: true,
      enum: [
        "hbonds", "salt_bridges", "hydrophobic_contacts", "all_interactions",
        "binding_pocket", "druggability", "virtual_screening", "ligand_interactions",
        "disulfide_bonds", "metal_coordination", "aromatic_stacking", "water_bridges",
        "sasa", "electrostatic", "ramachandran", "bfactor_stats",
        "secondary_structure_simple", "interface_residues", "detect_pockets",
        "oligomer_analysis", "surface_residues", "structure_validation",
        "rmsd", "conformational_changes", "protonation_states", "summary",
      ],
    },
    chain1: { type: "string", description: "Chain 1 ID (e.g. A)", required: true },
    chain2: { type: "string", description: "Chain 2 ID (e.g. B, or same as chain1 for intra-chain)", required: true },
    ligandCompId: { type: "string", description: "Ligand compId for pocket analysis (e.g. PJE, N3, HEM)" },
    radius: { type: "number", description: "Pocket radius in Angstroms (default 5.0)" },
  },
  timeoutMs: 120_000, // Analysis can take a while
};

const SET_REPRESENTATION: ToolDefinition = {
  name: "set_representation",
  description: "Set the 3D representation preset (cartoon, surface, ball-and-stick, putty)",
  category: "visualization",
  parameters: {
    preset: {
      type: "string",
      description: "Representation preset name",
      required: true,
      enum: ["cartoon", "surface", "ball-and-stick", "putty"],
    },
  },
};

const SET_COLOR_THEME: ToolDefinition = {
  name: "set_color_theme",
  description: "Set the color theme (chain-id, element-symbol, hydrophobicity, bfactor, etc.)",
  category: "visualization",
  parameters: {
    theme: {
      type: "string",
      description: "Color theme name",
      required: true,
      enum: ["chain-id", "element-symbol", "hydrophobicity", "residue-name", "sequence-id", "uniform", "secondary-structure", "bfactor", "uncertainty", "partial-charge"],
    },
  },
};

const FOCUS_LIGAND: ToolDefinition = {
  name: "focus_ligand",
  description: "Focus the camera on a specific ligand by its compId (e.g. HEM, N3, PJE)",
  category: "visualization",
  parameters: {
    compId: { type: "string", description: "Ligand 3-letter compId (e.g. HEM, N3, PJE)", required: true },
  },
};

const FOCUS_RESIDUE: ToolDefinition = {
  name: "focus_residue",
  description: "Focus the camera on a specific residue",
  category: "visualization",
  parameters: {
    chain: { type: "string", description: "Chain ID (e.g. A)", required: true },
    resno: { type: "number", description: "Residue number (e.g. 145)", required: true },
  },
};

const CAPTURE_MULTI_ANGLE: ToolDefinition = {
  name: "capture_multi_angle",
  description: "Capture screenshots from multiple angles (front, side, top) for VLM analysis",
  category: "visualization",
  parameters: {
    recipe: { type: "string", description: "Recipe name for screenshot labeling", required: true },
    angles: {
      type: "array",
      description: "Camera angles to capture",
      items: { type: "string", enum: ["front", "side", "top", "back"] },
    },
  },
};

const MEASURE_DISTANCE: ToolDefinition = {
  name: "measure_distance",
  description: "Measure the distance between two residues/atoms",
  category: "measurement",
  parameters: {
    a_chain: { type: "string", description: "Chain of atom A", required: true },
    a_resno: { type: "number", description: "Residue number of atom A", required: true },
    a_atom: { type: "string", description: "Atom name of atom A (e.g. CA, SG)" },
    b_chain: { type: "string", description: "Chain of atom B", required: true },
    b_resno: { type: "number", description: "Residue number of atom B", required: true },
    b_atom: { type: "string", description: "Atom name of atom B (e.g. CA, SG)" },
  },
};

const CLEAR_CHAT: ToolDefinition = {
  name: "clear_chat",
  description: "Clear all chat messages (destructive — requires user approval)",
  category: "session",
  parameters: {},
  requiresApproval: true,
};

/**
 * Register all domain tools with their executors.
 * The executor wraps the existing executeCommand function.
 *
 * @param executeCommandFn - The executeCommand function from commands.ts
 */
export function registerDomainTools(
  executeCommandFn: (viewer: unknown, cmd: unknown) => Promise<{ ok: boolean; detail?: string; data?: unknown }>,
): void {
  // pdb_load
  toolRegistry.register(PDB_LOAD, async (args, ctx) => {
    return executeCommandFn(ctx.viewer, { type: "load_pdb", id: args.id as string });
  });

  // pdb_analyze
  toolRegistry.register(PDB_ANALYZE, async (args, ctx) => {
    const params: Record<string, unknown> = {};
    if (args.chain1) params.chain1 = args.chain1;
    if (args.chain2) params.chain2 = args.chain2;
    if (args.ligandCompId) params.ligandCompId = args.ligandCompId;
    if (args.radius) params.radius = args.radius;
    return executeCommandFn(ctx.viewer, {
      type: "analyze_run",
      recipe: args.recipe as string,
      pdbId: ctx.pdbId,
      params,
    });
  });

  // set_representation
  toolRegistry.register(SET_REPRESENTATION, async (args, ctx) => {
    return executeCommandFn(ctx.viewer, { type: "set_representation", preset: args.preset as string });
  });

  // set_color_theme
  toolRegistry.register(SET_COLOR_THEME, async (args, ctx) => {
    return executeCommandFn(ctx.viewer, { type: "set_color_theme", theme: args.theme as string });
  });

  // focus_ligand
  toolRegistry.register(FOCUS_LIGAND, async (args, ctx) => {
    return executeCommandFn(ctx.viewer, { type: "focus_ligand", compId: args.compId as string });
  });

  // focus_residue
  toolRegistry.register(FOCUS_RESIDUE, async (args, ctx) => {
    return executeCommandFn(ctx.viewer, {
      type: "focus_residue",
      chain: args.chain as string,
      resno: args.resno as number,
    });
  });

  // capture_multi_angle
  toolRegistry.register(CAPTURE_MULTI_ANGLE, async (args, ctx) => {
    return executeCommandFn(ctx.viewer, {
      type: "capture_multi_angle",
      recipe: args.recipe as string,
      angles: (args.angles as Array<"front" | "side" | "top" | "back">) || ["front", "side", "top"],
    });
  });

  // measure_distance
  toolRegistry.register(MEASURE_DISTANCE, async (args, ctx) => {
    return executeCommandFn(ctx.viewer, {
      type: "measure_distance",
      a: {
        chain: args.a_chain as string,
        resno: args.a_resno as number,
        atom: args.a_atom as string | undefined,
      },
      b: {
        chain: args.b_chain as string,
        resno: args.b_resno as number,
        atom: args.b_atom as string | undefined,
      },
    });
  });

  // clear_chat (requires approval)
  toolRegistry.register(CLEAR_CHAT, async (_args, _ctx) => {
    // This will be handled by the chat store — return a signal
    return { cleared: true };
  });
}

/** Unregister all domain tools (for cleanup/testing) */
export function unregisterDomainTools(): void {
  const names = [
    "pdb_load", "pdb_analyze", "set_representation", "set_color_theme",
    "focus_ligand", "focus_residue", "capture_multi_angle",
    "measure_distance", "clear_chat",
  ];
  for (const name of names) {
    toolRegistry.unregister(name);
  }
}
