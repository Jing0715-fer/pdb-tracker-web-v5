/**
 * PDB tools — the tool set the agent uses to drive the Molstar 3D viewer.
 *
 * Each tool is declared with a JSON-schema (for the LLM), an output renderer,
 * and pure UI presenters. Tools divide into two execution classes:
 *
 *   - CLIENT-SIDE: the Molstar viewer operation. The server emits a
 *     tool/call event; the client executes the corresponding Molstar command
 *     and POSTs the result back. (pdb_load, pdb_analyze, set_representation,
 *     measure_*, capture_*, focus_*, etc.)
 *
 *   - SERVER-SIDE: pure data fetches the loop executes inline during the
 *     step (no Molstar needed). (fetch_metadata — calls the RCSB API.)
 *
 * The mapping from agent tool name → Molstar command type lives in
 * `toolToCommand` and is consumed by the client bridge.
 */

import type { ContentBlock } from './llm/types';
import { newCallId, type CallId, type Json } from './types';
import type { ToolDefinition } from './tools/types';

// ─── Shared constants ──────────────────────────────────────────────────────

export const ANALYSIS_RECIPES = [
  'hbonds', 'salt_bridges', 'hydrophobic_contacts', 'all_interactions',
  'binding_pocket', 'druggability', 'virtual_screening', 'druglike_screening',
  'ligand_interactions', 'disulfide_bonds', 'metal_coordination',
  'aromatic_stacking', 'water_bridges', 'sasa', 'electrostatic',
  'apbs_electrostatic', 'ramachandran', 'bfactor_stats',
  'secondary_structure_simple', 'interface_residues', 'detect_pockets',
  'oligomer_analysis', 'surface_residues', 'rmsd', 'conformational_changes',
  'protonation_states', 'summary',
] as const;

export const COLOR_THEMES = [
  'chain-id', 'element-symbol', 'residue-name', 'sequence-id',
  'hydrophobicity', 'uniform', 'occupancy', 'uncertainty', 'bfactor',
  'entity-id', 'model-index', 'structure-index', 'polymer-index',
] as const;

export const REPRESENTATION_PRESETS = ['cartoon', 'surface', 'ball-and-stick', 'putty'] as const;
export const CAMERA_ANGLES = ['front', 'side', 'top', 'back'] as const;

/** The set of tools the agent loop will execute server-side. */
export const SERVER_SIDE_TOOLS = new Set<string>(['fetch_metadata']);

/**
 * Map an agent tool call to the Molstar command the client should execute.
 * Returns null for server-side tools (they never reach the client).
 */
export function toolToCommand(name: string, args: Record<string, unknown>): Record<string, unknown> | null {
  switch (name) {
    // Structure loading
    case 'pdb_load':
      return { type: 'load_pdb', id: args.id };
    case 'load_alphafold':
      return { type: 'load_alphafold', uniprotId: args.uniprotId };
    case 'load_emdb':
      return { type: 'load_emdb', id: args.emdbId, detail: args.detail ?? 3 };
    case 'load_structure_url':
      return {
        type: 'load_structure_url',
        url: args.url,
        format: args.format ?? 'mmcif',
        isBinary: args.isBinary ?? false,
      };
    // Analysis
    case 'pdb_analyze': {
      const params: Record<string, unknown> = { chain1: args.chain1, chain2: args.chain2 };
      if (args.ligandCompId) params.ligandCompId = args.ligandCompId;
      if (args.radius) params.radius = args.radius;
      return { type: 'analyze_run', pdbId: args.pdbId || '', recipe: args.recipe, params };
    }
    case 'fetch_interface':
      return { type: 'analyze_interface', id: args.id, assembly: args.assembly ?? 1 };
    case 'show_interactions': {
      const cmd: Record<string, unknown> = {
        type: 'show_interactions',
        pdbId: args.pdbId,
        chain: args.chain,
        residue: args.residue,
      };
      if (args.radius) cmd.radius = args.radius;
      return cmd;
    }
    case 'align_structures':
      return { type: 'align_structures', mobileId: args.mobileId, targetId: args.targetId };
    // Visualization
    case 'set_representation':
      return { type: 'set_representation', preset: args.preset };
    case 'set_color_theme':
      return { type: 'set_color_theme', theme: args.theme, hexColor: args.hexColor };
    case 'set_uniform_color':
      return { type: 'set_uniform_color', hexColor: args.hexColor };
    case 'focus_ligand':
      return { type: 'focus_ligand', compId: args.compId };
    case 'focus_residue':
      return { type: 'focus_residue', chain: args.chain, resno: args.resno };
    case 'focus_chain':
      return { type: 'focus_chain', chain: args.chain };
    case 'reset_camera':
      return { type: 'reset_camera' };
    case 'set_background':
      return { type: 'set_background', color: args.color };
    case 'toggle_spin':
      return { type: 'toggle_spin', spin: args.spin ?? true };
    case 'toggle_rock':
      return { type: 'toggle_rock', rock: args.rock ?? true };
    case 'toggle_component_visibility':
      return { type: 'toggle_component_visibility', chain: args.chain, visible: args.visible };
    case 'select':
      return { type: 'select', chain: args.chain, resno: args.resno, entityType: args.entityType };
    case 'clear_selection':
      return { type: 'clear_selection' };
    case 'clear_interactions':
      return { type: 'clear_interactions' };
    case 'label_residue':
      return { type: 'label_residue', chain: args.chain, resno: args.resno, label: args.label };
    // Measurement
    case 'measure_distance':
      return { type: 'measure_distance', a: args.a, b: args.b };
    case 'measure_angle':
      return { type: 'measure_angle', a: args.a, b: args.b, c: args.c };
    case 'measure_dihedral':
      return { type: 'measure_dihedral', a: args.a, b: args.b, c: args.c, d: args.d };
    case 'clear_measurements':
      return { type: 'clear_measurements' };
    // Screenshot
    case 'capture_multi_angle':
      return {
        type: 'capture_multi_angle',
        recipe: args.recipe,
        angles: args.angles ?? ['front', 'side', 'top'],
      };
    case 'capture_snapshot':
      return { type: 'capture_snapshot' };
    case 'export_snapshot':
      return { type: 'export_snapshot' };
    case 'recapture_screenshot':
      return {
        type: 'capture_multi_angle',
        recipe: args.recipe,
        angles: args.angles ?? ['back', 'side'],
      };
    case 'show_electrostatic_surface':
      return { type: 'show_electrostatic_surface' };
    case 'show_druggable_pocket':
      return { type: 'show_druggable_pocket', ligandCompId: args.ligandCompId };
    case 'run_virtual_screening':
      return { type: 'run_virtual_screening', ligandCompId: args.ligandCompId };
    case 'detect_pockets':
      return { type: 'detect_pockets' };
    case 'clear_chat':
      return { type: 'clear_chat' };
    default:
      return null;
  }
}

// ─── Tool definitions (LLM-facing schema + UI presenters) ──────────────────

function textContent(text: string): ContentBlock[] {
  return [{ type: 'text', text }];
}

/** Helper to define a client-side Molstar tool with a generic renderer. */
function clientTool(
  name: string,
  description: string,
  parameters: Json,
  opts: {
    card?: 'pdb' | 'measure' | 'screenshot' | 'analysis' | 'generic';
    kind?: string;
    title: string;
    requiresApproval?: boolean;
    timeoutMs?: number;
  },
): ToolDefinition {
  const card = opts.card ?? 'generic';
  const kind = opts.kind ?? name;
  // Wrap parameters in { type: 'object', properties: {...}, required: [...] } if not already wrapped.
  // OpenAI-compatible APIs require this format for function parameters.
  const wrappedParams: Json = (() => {
    const p = parameters as Record<string, unknown>;
    if (!p || typeof p !== 'object') return { type: 'object', properties: {} } as Json;
    if (p.type === 'object') return parameters; // Already wrapped
    // Extract required fields from individual property definitions
    const required: string[] = [];
    const properties: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(p)) {
      if (val && typeof val === 'object') {
        const prop = { ...(val as Record<string, unknown>) };
        if (prop.required === true) {
          required.push(key);
          delete prop.required;
        }
        properties[key] = prop;
      }
    }
    const result: Record<string, unknown> = { type: 'object', properties };
    if (required.length > 0) result.required = required;
    return result as Json;
  })();
  return {
    name,
    description,
    parameters: wrappedParams,
    output: {
      schema: { type: 'object' },
      render: (_args, value) => {
        const v = (value as { ok?: boolean; result?: unknown; error?: string }) ?? {};
        const text = v.ok
          ? typeof v.result === 'string'
            ? v.result
            : JSON.stringify(v.result ?? {}).slice(0, 6000)
          : `Error: ${v.error ?? 'execution failed'}`;
        return textContent(text);
      },
    },
    execute: async () => ({ ok: true } as unknown as Json),
    presentCall: () => ({ card, title: opts.title, kind }),
    presentResult: (_args, value) => {
      const v = (value as { ok?: boolean; result?: unknown; error?: string }) ?? {};
      const text = v.ok
        ? typeof v.result === 'string'
          ? v.result
          : JSON.stringify(v.result ?? {}, null, 2).slice(0, 4000)
        : `Error: ${v.error ?? 'execution failed'}`;
      return {
        card,
        title: opts.title,
        content: textContent(text),
      };
    },
    timeoutMs: opts.timeoutMs,
  };
}

export const PDB_TOOLS: ToolDefinition[] = [
  // ── Structure loading ──
  clientTool('pdb_load', 'Load a PDB structure by ID (e.g. 4HHB, 6LU7, 1CBS). Downloads from RCSB.', { id: { type: 'string', description: '4-character PDB ID', required: true } }, { card: 'pdb', kind: 'load', title: 'Load PDB' }),
  clientTool('load_alphafold', 'Load an AlphaFold predicted structure by UniProt ID (e.g. P00520).', { uniprotId: { type: 'string', description: 'UniProt accession', required: true } }, { card: 'pdb', kind: 'load', title: 'Load AlphaFold' }),
  clientTool('load_emdb', 'Load an EMDB cryo-EM volume map by EMDB ID (e.g. EMD-1234).', { emdbId: { type: 'string', description: 'EMDB ID', required: true }, detail: { type: 'number', description: 'Detail level 0-6 (default 3)' } }, { card: 'pdb', kind: 'load', title: 'Load EMDB' }),
  clientTool('load_structure_url', 'Load a structure file from a URL (mmCIF or PDB format).', { url: { type: 'string', description: 'URL to the structure file', required: true }, format: { type: 'string', description: 'File format', enum: ['pdb', 'mmcif'] }, isBinary: { type: 'boolean', description: 'Whether the file is binary (e.g. BCIF)' } }, { card: 'pdb', kind: 'load', title: 'Load from URL' }),
  // ── Analysis ──
  clientTool(
    'pdb_analyze',
    'Run a structure analysis recipe. Returns detailed interaction/pocket/structure data. For single-chain structures, set chain1=chain2. For binding pocket analysis, pass ligandCompId and radius.',
    {
      recipe: { type: 'string', description: 'Analysis recipe name', required: true, enum: [...ANALYSIS_RECIPES] },
      chain1: { type: 'string', description: 'Chain 1 ID', required: true },
      chain2: { type: 'string', description: 'Chain 2 ID (same as chain1 for intra-chain)', required: true },
      ligandCompId: { type: 'string', description: 'Ligand compId for pocket analysis (e.g. N3, HEM)' },
      radius: { type: 'number', description: 'Pocket/interaction radius in Angstroms' },
    },
    { card: 'analysis', kind: 'analyze', title: 'Analyze', timeoutMs: 120_000 },
  ),
  clientTool('fetch_interface', 'Fetch interface data for a PDB assembly.', { id: { type: 'string', description: 'PDB ID', required: true }, assembly: { type: 'number', description: 'Assembly ID (default 1)' } }, { card: 'analysis', kind: 'interface', title: 'Fetch Interface' }),
  clientTool('show_interactions', 'Highlight the neighborhood around a residue or ligand.', { pdbId: { type: 'string', description: 'PDB ID', required: true }, chain: { type: 'string', description: 'Chain ID', required: true }, residue: { type: 'string', description: 'Residue number or compId', required: true }, radius: { type: 'number', description: 'Radius in Angstroms (default 5)' } }, { card: 'analysis', kind: 'interactions', title: 'Show Interactions' }),
  clientTool('align_structures', 'Superpose two loaded structures.', { mobileId: { type: 'string', description: 'Mobile structure PDB ID', required: true }, targetId: { type: 'string', description: 'Target structure PDB ID', required: true } }, { card: 'analysis', kind: 'align', title: 'Align Structures' }),
  // ── Visualization ──
  clientTool('set_representation', 'Change the 3D representation preset.', { preset: { type: 'string', description: 'Representation preset', required: true, enum: [...REPRESENTATION_PRESETS] } }, { card: 'pdb', kind: 'representation', title: 'Set Representation' }),
  clientTool('set_color_theme', 'Change the color theme.', { theme: { type: 'string', description: 'Color theme', required: true, enum: [...COLOR_THEMES] }, hexColor: { type: 'string', description: 'Hex color (for uniform theme, e.g. #FF0000)' } }, { card: 'pdb', kind: 'color', title: 'Set Color Theme' }),
  clientTool('set_uniform_color', 'Apply a single uniform hex color.', { hexColor: { type: 'string', description: 'Hex color (e.g. #FF0000)', required: true } }, { card: 'pdb', kind: 'color', title: 'Set Uniform Color' }),
  clientTool('focus_ligand', 'Move camera to focus on a ligand.', { compId: { type: 'string', description: 'Ligand compId (e.g. HEM)', required: true } }, { card: 'pdb', kind: 'focus', title: 'Focus Ligand' }),
  clientTool('focus_residue', 'Move camera to focus on a residue.', { chain: { type: 'string', description: 'Chain ID', required: true }, resno: { type: 'number', description: 'Residue number', required: true } }, { card: 'pdb', kind: 'focus', title: 'Focus Residue' }),
  clientTool('focus_chain', 'Move camera to focus on a chain.', { chain: { type: 'string', description: 'Chain ID', required: true } }, { card: 'pdb', kind: 'focus', title: 'Focus Chain' }),
  clientTool('reset_camera', 'Reset the camera position.', { type: 'object', properties: {} }, { card: 'pdb', kind: 'camera', title: 'Reset Camera' }),
  clientTool('set_background', 'Set the viewport background color.', { color: { type: 'string', description: 'Hex color (e.g. #000000)', required: true } }, { card: 'pdb', kind: 'background', title: 'Set Background' }),
  clientTool('toggle_spin', 'Toggle structure spin animation.', { spin: { type: 'boolean', description: 'true to spin, false to stop (default true)' } }, { card: 'pdb', kind: 'animation', title: 'Toggle Spin' }),
  clientTool('toggle_rock', 'Toggle structure rock animation.', { rock: { type: 'boolean', description: 'true to rock, false to stop (default true)' } }, { card: 'pdb', kind: 'animation', title: 'Toggle Rock' }),
  clientTool('toggle_component_visibility', 'Show or hide a chain.', { chain: { type: 'string', description: 'Chain ID', required: true }, visible: { type: 'boolean', description: 'true to show, false to hide', required: true } }, { card: 'pdb', kind: 'visibility', title: 'Toggle Visibility' }),
  clientTool('select', 'Select a residue or entity.', { chain: { type: 'string', description: 'Chain ID' }, resno: { type: 'number', description: 'Residue number' }, entityType: { type: 'string', description: 'Entity type' } }, { card: 'pdb', kind: 'select', title: 'Select' }),
  clientTool('clear_selection', 'Clear the current selection.', { type: 'object', properties: {} }, { card: 'pdb', kind: 'select', title: 'Clear Selection' }),
  clientTool('clear_interactions', 'Clear all interaction overlays.', { type: 'object', properties: {} }, { card: 'pdb', kind: 'clear', title: 'Clear Interactions' }),
  clientTool('label_residue', 'Add a text label to a residue.', { chain: { type: 'string', description: 'Chain ID', required: true }, resno: { type: 'number', description: 'Residue number', required: true }, label: { type: 'string', description: 'Label text', required: true } }, { card: 'pdb', kind: 'label', title: 'Label Residue' }),
  // ── Measurement ──
  clientTool('measure_distance', 'Measure the distance between two atoms.', { a: { type: 'string', description: 'Atom A (e.g. "A:145:CA")', required: true }, b: { type: 'string', description: 'Atom B', required: true } }, { card: 'measure', kind: 'distance', title: 'Measure Distance' }),
  clientTool('measure_angle', 'Measure the angle between three atoms.', { a: { type: 'string', description: 'Atom A', required: true }, b: { type: 'string', description: 'Atom B', required: true }, c: { type: 'string', description: 'Atom C', required: true } }, { card: 'measure', kind: 'angle', title: 'Measure Angle' }),
  clientTool('measure_dihedral', 'Measure the dihedral angle between four atoms.', { a: { type: 'string', description: 'Atom A', required: true }, b: { type: 'string', description: 'Atom B', required: true }, c: { type: 'string', description: 'Atom C', required: true }, d: { type: 'string', description: 'Atom D', required: true } }, { card: 'measure', kind: 'dihedral', title: 'Measure Dihedral' }),
  clientTool('clear_measurements', 'Clear all measurements.', { type: 'object', properties: {} }, { card: 'measure', kind: 'clear', title: 'Clear Measurements' }),
  // ── Screenshot ──
  clientTool(
    'capture_multi_angle',
    'Capture screenshots from multiple angles. Run after pdb_analyze to visualize results.',
    {
      recipe: { type: 'string', description: 'Recipe name (auto-injected from analyze result)', enum: [...ANALYSIS_RECIPES] },
      angles: { type: 'array', description: 'Camera angles', items: { type: 'string', enum: [...CAMERA_ANGLES] } },
    },
    { card: 'screenshot', kind: 'capture', title: 'Capture Multi-Angle', timeoutMs: 60_000 },
  ),
  clientTool('capture_snapshot', 'Capture a single screenshot of the current view.', { type: 'object', properties: {} }, { card: 'screenshot', kind: 'snapshot', title: 'Capture Snapshot' }),
  clientTool(
    'export_snapshot',
    'Export the viewport as a PNG file. REQUIRES APPROVAL.',
    { type: 'object', properties: {} },
    { card: 'screenshot', kind: 'export', title: 'Export Snapshot' },
  ),
  clientTool(
    'recapture_screenshot',
    'Recapture screenshots with different angles after VLM quality feedback.',
    {
      recipe: { type: 'string', description: 'Recipe name', enum: [...ANALYSIS_RECIPES] },
      angles: { type: 'array', description: 'Camera angles', items: { type: 'string', enum: [...CAMERA_ANGLES] } },
    },
    { card: 'screenshot', kind: 'recapture', title: 'Recapture Screenshot', timeoutMs: 60_000 },
  ),
  // ── Advanced analysis ──
  clientTool('show_electrostatic_surface', 'Show the APBS electrostatic potential surface.', { type: 'object', properties: {} }, { card: 'analysis', kind: 'electrostatic', title: 'Show Electrostatic Surface', timeoutMs: 90_000 }),
  clientTool('show_druggable_pocket', 'Highlight the druggable pocket around a ligand.', { ligandCompId: { type: 'string', description: 'Ligand compId', required: true } }, { card: 'analysis', kind: 'pocket', title: 'Show Druggable Pocket' }),
  clientTool('run_virtual_screening', 'Run virtual screening against a pocket.', { ligandCompId: { type: 'string', description: 'Ligand compId', required: true } }, { card: 'analysis', kind: 'screening', title: 'Virtual Screening', timeoutMs: 120_000 }),
  clientTool('detect_pockets', 'Detect all surface pockets.', { type: 'object', properties: {} }, { card: 'analysis', kind: 'pockets', title: 'Detect Pockets' }),
  // ── Session ──
  clientTool(
    'clear_chat',
    'Clear all chat messages. REQUIRES APPROVAL.',
    { type: 'object', properties: {} },
    { card: 'generic', kind: 'clear', title: 'Clear Chat' },
  ),
];

/** fetch_metadata — the one SERVER-SIDE tool (calls RCSB API directly). */
export const FETCH_METADATA_TOOL: ToolDefinition = {
  name: 'fetch_metadata',
  description:
    'Fetch RCSB metadata for a PDB entry (publication, method, resolution, title, deposit date). Runs server-side.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '4-character PDB ID' },
      includeInterfaces: { type: 'boolean', description: 'Include interface data (default true)' },
    },
    required: ['id'],
  },
  output: {
    schema: { type: 'object' },
    render: (_args, value) => textContent(JSON.stringify(value, null, 2).slice(0, 6000)),
  },
  execute: async (args) => {
    const a = args as { id: string };
    const id = String(a.id ?? '').toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(id)) {
      throw new Error(`Invalid PDB ID: ${a.id}`);
    }
    const url = `https://data.rcsb.org/rest/v1/core/entry/${id}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      throw new Error(`RCSB API returned ${res.status} for ${id}`);
    }
    const json = (await res.json()) as Record<string, unknown>;
    const struct = (json.struct ?? {}) as Record<string, unknown>;
    const title = (struct.title as string) ?? '';
    const exptl = (json.exptl ?? []) as Array<Record<string, unknown>>;
    const method = (exptl[0]?.method as string) ?? '';
    const info = (json.rcsb_entry_info ?? {}) as Record<string, unknown>;
    const resArr = (info.resolution_combined ?? []) as number[];
    const resolution = resArr[0] ?? null;
    const accession = (json.rcsb_accession_info ?? {}) as Record<string, unknown>;
    const depositDate = (accession.initial_release_date as string) ?? '';
    const extRefs = (json.rcsb_external_references ?? []) as Array<Record<string, unknown>>;
    const pub = extRefs.find((r) => r.type === 'PubMed');
    const pubmedId = (pub?.id as string) ?? '';
    return {
      pdbId: id,
      title,
      method,
      resolution,
      depositDate,
      pubmedId,
    } as unknown as Json;
  },
  presentCall: () => ({ card: 'analysis', title: 'Fetch Metadata', kind: 'metadata' }),
  presentResult: (_args, value) => ({
    card: 'analysis',
    title: 'Fetch Metadata',
    content: textContent(JSON.stringify(value, null, 2)),
  }),
};

export const ALL_PDB_TOOLS: ToolDefinition[] = [...PDB_TOOLS, FETCH_METADATA_TOOL];

/** Tools that require explicit user approval before executing. */
export const APPROVAL_REQUIRED = new Set<string>(['export_snapshot', 'clear_chat']);

export function requiresApproval(name: string): boolean {
  return APPROVAL_REQUIRED.has(name);
}

export type { CallId };
