/**
 * Tool Definitions — Single source of truth for all agent tools.
 *
 * This module is shared between:
 *   - `domain-tools.ts` (client-side executor registration)
 *   - `src/app/api/llm/agent/round/route.ts` (server-side LLM function-calling schema)
 *
 * By keeping definitions in one place, we avoid the enum drift and missing
 * parameter bugs that plagued the earlier split (e.g. capture_multi_angle
 * missing `recipe`, set_color_theme having invalid themes).
 *
 * This file is isomorphic — it has NO browser or Node-only imports, so it
 * can be imported from both client and server code.
 */

import type { ToolDefinition } from "./tool-registry";

// ─── Shared constants ──────────────────────────────────────────────────────

/**
 * All valid analysis recipes. Synchronized with the backend /api/analyze/run
 * endpoint and applyRecipeVisualization in commands.ts.
 */
export const ANALYSIS_RECIPES = [
  "hbonds", "salt_bridges", "hydrophobic_contacts", "all_interactions",
  "binding_pocket", "druggability", "virtual_screening", "druglike_screening",
  "ligand_interactions", "disulfide_bonds", "metal_coordination",
  "aromatic_stacking", "water_bridges", "sasa", "electrostatic",
  "apbs_electrostatic", "ramachandran", "bfactor_stats",
  "secondary_structure_simple", "interface_residues", "detect_pockets",
  "oligomer_analysis", "surface_residues", "rmsd", "conformational_changes",
  "protonation_states", "summary",
] as const;

/**
 * All valid color themes. Synchronized with normalizeColorTheme() in commands.ts.
 * Only themes that the function accepts (either in CANONICAL set or ALIASES
 * map that return a non-null value) are included here.
 */
export const COLOR_THEMES = [
  "chain-id", "element-symbol", "residue-name", "sequence-id",
  "hydrophobicity", "uniform", "occupancy", "uncertainty", "bfactor",
  "entity-id", "model-index", "structure-index", "polymer-index",
] as const;

/**
 * Representation presets supported by set_representation.
 */
export const REPRESENTATION_PRESETS = [
  "cartoon", "surface", "ball-and-stick", "putty",
] as const;

/**
 * Camera angles for screenshot capture.
 */
export const CAMERA_ANGLES = ["front", "side", "top", "back"] as const;

// ─── Tool definitions ──────────────────────────────────────────────────────

// ---- Structure loading ----
export const PDB_LOAD: ToolDefinition = {
  name: "pdb_load",
  description: "Load a PDB structure by ID (e.g. 4HHB, 6LU7, 1CBS). Downloads from RCSB. Use this for standard PDB entries.",
  category: "structure",
  parameters: {
    id: { type: "string", description: "4-character PDB ID (e.g. 4HHB)", required: true },
  },
};

export const LOAD_ALPHAFOLD: ToolDefinition = {
  name: "load_alphafold",
  description: "Load an AlphaFold predicted structure by UniProt ID (e.g. P00520). Use for proteins without experimental structures.",
  category: "structure",
  parameters: {
    uniprotId: { type: "string", description: "UniProt accession (e.g. P00520, Q9NZQ5)", required: true },
  },
};

export const LOAD_EMDB: ToolDefinition = {
  name: "load_emdb",
  description: "Load an EMDB cryo-EM volume map by EMDB ID (e.g. EMD-1234). Use for cryo-EM density maps.",
  category: "structure",
  parameters: {
    emdbId: { type: "string", description: "EMDB ID (e.g. EMD-1234 or 1234)", required: true },
    detail: { type: "number", description: "Detail level 0-6 (default 3, higher = more detail but slower)" },
  },
};

export const LOAD_STRUCTURE_URL: ToolDefinition = {
  name: "load_structure_url",
  description: "Load a structure file from a URL (mmCIF or PDB format). Use for custom or non-RCSB structures.",
  category: "structure",
  parameters: {
    url: { type: "string", description: "URL to the structure file", required: true },
    format: { type: "string", description: "File format", enum: ["pdb", "mmcif"] },
    isBinary: { type: "boolean", description: "Whether the file is binary (e.g. BCIF)" },
  },
};

// ---- Analysis ----
export const PDB_ANALYZE: ToolDefinition = {
  name: "pdb_analyze",
  description: "Run a structure analysis recipe. Returns detailed interaction/pocket/structure data. For single-chain structures, set chain1=chain2. For binding pocket analysis, pass ligandCompId and radius.",
  category: "analysis",
  parameters: {
    recipe: {
      type: "string",
      description: "Analysis recipe name",
      required: true,
      enum: [...ANALYSIS_RECIPES],
    },
    chain1: { type: "string", description: "Chain 1 ID (e.g. A). For intra-chain analysis, set chain1=chain2.", required: true },
    chain2: { type: "string", description: "Chain 2 ID (e.g. B, or same as chain1 for intra-chain)", required: true },
    ligandCompId: { type: "string", description: "Ligand compId for pocket analysis (e.g. N3, HEM, PJE). Required for binding_pocket, druggability, ligand_interactions." },
    radius: { type: "number", description: "Pocket/interaction radius in Angstroms (default 5.0 for pocket, 8.0 for interactions)" },
  },
  timeoutMs: 120_000,
};

export const FETCH_METADATA: ToolDefinition = {
  name: "fetch_metadata",
  description: "Fetch RCSB metadata for a PDB entry (publication, method, resolution, entity info). Returns markdown text.",
  category: "analysis",
  parameters: {
    id: { type: "string", description: "4-character PDB ID", required: true },
    includeInterfaces: { type: "boolean", description: "Include interface analysis (default true)" },
  },
};

export const FETCH_INTERFACE: ToolDefinition = {
  name: "fetch_interface",
  description: "Fetch interface data for a PDB assembly (chain-chain contacts, buried surface area).",
  category: "analysis",
  parameters: {
    id: { type: "string", description: "4-character PDB ID", required: true },
    assembly: { type: "number", description: "Assembly number (default 1)" },
  },
};

export const SHOW_INTERACTIONS: ToolDefinition = {
  name: "show_interactions",
  description: "Highlight and focus on the neighborhood around a target residue/ligand within a radius. Shows nearby residues and their contacts.",
  category: "analysis",
  parameters: {
    target_chain: { type: "string", description: "Chain of the target residue" },
    target_resno: { type: "number", description: "Residue number of the target" },
    target_compId: { type: "string", description: 'Ligand compId (alternative to chain/resno). Use "ligand" for all ligands.' },
    radius: { type: "number", description: "Neighborhood radius in Angstroms (default 8.0)" },
  },
};

export const ALIGN_STRUCTURES: ToolDefinition = {
  name: "align_structures",
  description: "Superpose two loaded structures (reference + mobile) to compute structural alignment/RMSD.",
  category: "analysis",
  parameters: {
    ref: { type: "number", description: "Index of the reference structure (0-based)", required: true },
    mobile: { type: "number", description: "Index of the mobile structure to align (0-based)", required: true },
    method: { type: "string", description: "Alignment method", enum: ["superpose", "tm-align"] },
  },
};

// ---- Visualization ----
export const SET_REPRESENTATION: ToolDefinition = {
  name: "set_representation",
  description: "Set the 3D representation preset for all structures.",
  category: "visualization",
  parameters: {
    preset: {
      type: "string",
      description: "Representation preset",
      required: true,
      enum: [...REPRESENTATION_PRESETS],
    },
  },
};

export const SET_COLOR_THEME: ToolDefinition = {
  name: "set_color_theme",
  description: "Set the color theme for all structures (chain-id, element-symbol, hydrophobicity, bfactor, etc.).",
  category: "visualization",
  parameters: {
    theme: {
      type: "string",
      description: "Color theme name",
      required: true,
      enum: [...COLOR_THEMES],
    },
  },
};

export const SET_UNIFORM_COLOR: ToolDefinition = {
  name: "set_uniform_color",
  description: "Apply a single uniform color to all structures (e.g. #FF0000 for red).",
  category: "visualization",
  parameters: {
    color: { type: "string", description: "Hex color code (e.g. #FF0000, #00FF00, #c96442)", required: true },
  },
};

export const FOCUS_LIGAND: ToolDefinition = {
  name: "focus_ligand",
  description: "Focus the camera on a specific ligand by its compId (e.g. HEM, N3, PJE).",
  category: "visualization",
  parameters: {
    compId: { type: "string", description: "Ligand 3-letter compId (e.g. HEM, N3, PJE)", required: true },
  },
};

export const FOCUS_RESIDUE: ToolDefinition = {
  name: "focus_residue",
  description: "Focus the camera on a specific residue.",
  category: "visualization",
  parameters: {
    chain: { type: "string", description: "Chain ID (e.g. A)", required: true },
    resno: { type: "number", description: "Residue number (e.g. 145)", required: true },
  },
};

export const FOCUS_CHAIN: ToolDefinition = {
  name: "focus_chain",
  description: "Focus the camera on an entire chain.",
  category: "visualization",
  parameters: {
    chain: { type: "string", description: "Chain ID (e.g. A)", required: true },
  },
};

export const RESET_CAMERA: ToolDefinition = {
  name: "reset_camera",
  description: "Reset the camera to its default position and zoom.",
  category: "visualization",
  parameters: {},
};

export const SET_BACKGROUND: ToolDefinition = {
  name: "set_background",
  description: "Set the viewer background color.",
  category: "visualization",
  parameters: {
    color: { type: "string", description: "Hex color code (e.g. #FFFFFF for white, #000000 for black)", required: true },
  },
};

export const TOGGLE_SPIN: ToolDefinition = {
  name: "toggle_spin",
  description: "Toggle camera spin animation (continuous rotation).",
  category: "visualization",
  parameters: {
    speed: { type: "number", description: "Rotation speed (default 0.1)" },
  },
};

export const TOGGLE_ROCK: ToolDefinition = {
  name: "toggle_rock",
  description: "Toggle camera rock animation (back-and-forth rotation).",
  category: "visualization",
  parameters: {},
};

export const TOGGLE_COMPONENT_VISIBILITY: ToolDefinition = {
  name: "toggle_component_visibility",
  description: "Show, hide, or toggle the visibility of a specific chain/component.",
  category: "visualization",
  parameters: {
    component: { type: "string", description: "Chain/component ID (e.g. A, B)", required: true },
    action: { type: "string", description: "Visibility action", enum: ["show", "hide", "toggle"] },
  },
};

export const SELECT: ToolDefinition = {
  name: "select",
  description: "Select residues/atoms in the viewer (set/add/remove selection).",
  category: "visualization",
  parameters: {
    target_chain: { type: "string", description: "Chain ID of the target" },
    target_resno: { type: "number", description: "Residue number" },
    target_compId: { type: "string", description: 'Ligand compId, or "all" for everything' },
    action: { type: "string", description: "Selection action", enum: ["set", "add", "remove"] },
  },
};

export const CLEAR_SELECTION: ToolDefinition = {
  name: "clear_selection",
  description: "Clear the current selection.",
  category: "visualization",
  parameters: {},
};

export const CLEAR_INTERACTIONS: ToolDefinition = {
  name: "clear_interactions",
  description: "Clear all interaction overlays (dashed lines, labels).",
  category: "visualization",
  parameters: {},
};

export const LABEL_RESIDUE: ToolDefinition = {
  name: "label_residue",
  description: "Add a text label at a specific residue position.",
  category: "visualization",
  parameters: {
    chain: { type: "string", description: "Chain ID", required: true },
    resno: { type: "number", description: "Residue number", required: true },
    text: { type: "string", description: "Label text (default: residue name + number)" },
  },
};

// ---- Measurement ----
export const MEASURE_DISTANCE: ToolDefinition = {
  name: "measure_distance",
  description: "Measure the distance between two atoms/residues.",
  category: "measurement",
  parameters: {
    a_chain: { type: "string", description: "Chain of atom A", required: true },
    a_resno: { type: "number", description: "Residue number of atom A", required: true },
    a_atom: { type: "string", description: "Atom name of atom A (e.g. CA, SG). Default CA." },
    b_chain: { type: "string", description: "Chain of atom B", required: true },
    b_resno: { type: "number", description: "Residue number of atom B", required: true },
    b_atom: { type: "string", description: "Atom name of atom B. Default CA." },
  },
};

export const MEASURE_ANGLE: ToolDefinition = {
  name: "measure_angle",
  description: "Measure the angle between three atoms/residues (A-B-C).",
  category: "measurement",
  parameters: {
    a_chain: { type: "string", required: true },
    a_resno: { type: "number", required: true },
    a_atom: { type: "string", description: "Atom name (default CA)" },
    b_chain: { type: "string", required: true },
    b_resno: { type: "number", required: true },
    b_atom: { type: "string" },
    c_chain: { type: "string", required: true },
    c_resno: { type: "number", required: true },
    c_atom: { type: "string" },
  },
};

export const MEASURE_DIHEDRAL: ToolDefinition = {
  name: "measure_dihedral",
  description: "Measure the dihedral angle between four atoms/residues (A-B-C-D).",
  category: "measurement",
  parameters: {
    a_chain: { type: "string", required: true },
    a_resno: { type: "number", required: true },
    a_atom: { type: "string" },
    b_chain: { type: "string", required: true },
    b_resno: { type: "number", required: true },
    b_atom: { type: "string" },
    c_chain: { type: "string", required: true },
    c_resno: { type: "number", required: true },
    c_atom: { type: "string" },
    d_chain: { type: "string", required: true },
    d_resno: { type: "number", required: true },
    d_atom: { type: "string" },
  },
};

export const CLEAR_MEASUREMENTS: ToolDefinition = {
  name: "clear_measurements",
  description: "Clear all measurements (distances, angles, dihedrals, labels).",
  category: "measurement",
  parameters: {},
};

// ---- Screenshot / capture ----
export const CAPTURE_MULTI_ANGLE: ToolDefinition = {
  name: "capture_multi_angle",
  description: "Capture screenshots from multiple angles (front, side, top, back). Returns image data URIs for VLM analysis.",
  category: "visualization",
  parameters: {
    recipe: { type: "string", description: "Recipe name for screenshot labeling and visualization (e.g. binding_pocket, hbonds)", required: true },
    angles: {
      type: "array",
      description: "Camera angles to capture (default: front, side, top)",
      items: { type: "string", enum: [...CAMERA_ANGLES] },
    },
  },
};

export const CAPTURE_SNAPSHOT: ToolDefinition = {
  name: "capture_snapshot",
  description: "Capture a single screenshot of the current view.",
  category: "visualization",
  parameters: {
    label: { type: "string", description: "Optional label for the screenshot" },
  },
};

export const EXPORT_SNAPSHOT: ToolDefinition = {
  name: "export_snapshot",
  description: "Export the current viewport as a PNG file download.",
  category: "session",
  parameters: {},
  requiresApproval: true,
};

// ---- Advanced analysis (with visualization side-effects) ----
export const SHOW_ELECTROSTATIC_SURFACE: ToolDefinition = {
  name: "show_electrostatic_surface",
  description: "Run APBS electrostatics and display the molecular surface colored by electrostatic potential (red=negative, blue=positive).",
  category: "analysis",
  parameters: {
    chain: { type: "string", description: "Chain ID (optional, defaults to all)" },
    ionicStrength: { type: "number", description: "Ionic strength in mol/L (default 0.15)" },
  },
  timeoutMs: 120_000,
};

export const SHOW_DRUGGABLE_POCKET: ToolDefinition = {
  name: "show_druggable_pocket",
  description: "Run druggability analysis and highlight the pocket around a ligand with residue labels.",
  category: "analysis",
  parameters: {
    ligandCompId: { type: "string", description: "Ligand compId to find the pocket for (e.g. N3, PJE)", required: true },
    radius: { type: "number", description: "Pocket radius in Angstroms (default 8.0)" },
  },
  timeoutMs: 120_000,
};

export const RUN_VIRTUAL_SCREENING: ToolDefinition = {
  name: "run_virtual_screening",
  description: "Run virtual screening against a binding pocket. Returns ranked hit compounds.",
  category: "analysis",
  parameters: {
    ligandCompId: { type: "string", description: "Reference ligand compId defining the pocket", required: true },
    fragmentSet: { type: "string", description: "Fragment library to screen", enum: ["druglike", "fragment", "natural"] },
  },
  timeoutMs: 180_000,
};

export const DETECT_POCKETS: ToolDefinition = {
  name: "detect_pockets",
  description: "Detect all surface pockets on the structure using grid-based detection.",
  category: "analysis",
  parameters: {
    minDepth: { type: "number", description: "Minimum pocket depth (default 100)" },
  },
  timeoutMs: 120_000,
};

// ---- Session ----
export const CLEAR_CHAT: ToolDefinition = {
  name: "clear_chat",
  description: "Clear all chat messages. Destructive operation — requires user approval.",
  category: "session",
  parameters: {},
  requiresApproval: true,
};

// ─── Aggregate: all tool definitions in order ──────────────────────────────

export const ALL_TOOL_DEFINITIONS: ToolDefinition[] = [
  // Structure loading
  PDB_LOAD,
  LOAD_ALPHAFOLD,
  LOAD_EMDB,
  LOAD_STRUCTURE_URL,
  // Analysis
  PDB_ANALYZE,
  FETCH_METADATA,
  FETCH_INTERFACE,
  SHOW_INTERACTIONS,
  ALIGN_STRUCTURES,
  SHOW_ELECTROSTATIC_SURFACE,
  SHOW_DRUGGABLE_POCKET,
  RUN_VIRTUAL_SCREENING,
  DETECT_POCKETS,
  // Visualization
  SET_REPRESENTATION,
  SET_COLOR_THEME,
  SET_UNIFORM_COLOR,
  FOCUS_LIGAND,
  FOCUS_RESIDUE,
  FOCUS_CHAIN,
  RESET_CAMERA,
  SET_BACKGROUND,
  TOGGLE_SPIN,
  TOGGLE_ROCK,
  TOGGLE_COMPONENT_VISIBILITY,
  SELECT,
  CLEAR_SELECTION,
  CLEAR_INTERACTIONS,
  LABEL_RESIDUE,
  // Measurement
  MEASURE_DISTANCE,
  MEASURE_ANGLE,
  MEASURE_DIHEDRAL,
  CLEAR_MEASUREMENTS,
  // Screenshot
  CAPTURE_MULTI_ANGLE,
  CAPTURE_SNAPSHOT,
  EXPORT_SNAPSHOT,
  // Session
  CLEAR_CHAT,
];

/**
 * Convert a ToolDefinition to the OpenAI-style function-calling schema
 * used by the z.ai SDK. This is the format the LLM expects in the `tools`
 * parameter.
 */
export function toFunctionSchema(def: ToolDefinition): {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required: string[];
    };
  };
} {
  const required: string[] = [];
  const properties: Record<string, unknown> = {};
  for (const [key, param] of Object.entries(def.parameters)) {
    properties[key] = {
      type: param.type,
      description: param.description,
      ...(param.enum ? { enum: param.enum } : {}),
      ...(param.default !== undefined ? { default: param.default } : {}),
      ...(param.items ? { items: param.items } : {}),
      ...(param.properties ? { properties: param.properties } : {}),
    };
    if (param.required) required.push(key);
  }
  return {
    type: "function",
    function: {
      name: def.name,
      description: def.description,
      parameters: { type: "object", properties, required },
    },
  };
}

/**
 * Get all tool definitions as OpenAI-style function schemas.
 * Used by the /api/llm/agent/round route.
 */
export function getAllToolSchemas(): ReturnType<typeof toFunctionSchema>[] {
  return ALL_TOOL_DEFINITIONS.map(toFunctionSchema);
}

/**
 * Look up a tool definition by name.
 */
export function getToolDefinition(name: string): ToolDefinition | undefined {
  return ALL_TOOL_DEFINITIONS.find((d) => d.name === name);
}
