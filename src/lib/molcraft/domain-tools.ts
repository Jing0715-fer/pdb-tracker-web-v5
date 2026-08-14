/**
 * Domain Tools — Registration of all PDB structure analysis tools.
 *
 * This module registers all tools (schema + executor) with the toolRegistry.
 * The tool SCHEMAS live in `tool-definitions.ts` (shared with the server-side
 * agent round route) so there's a single source of truth.
 *
 * Each executor wraps the existing `executeCommand` function from commands.ts,
 * so the tool-calling agent loop reuses all the existing Molstar logic.
 *
 * Total tools: 36 (up from 9 in Round 94)
 */

import { toolRegistry, type ToolExecutor } from "./tool-registry";
import {
  PDB_LOAD, LOAD_ALPHAFOLD, LOAD_EMDB, LOAD_STRUCTURE_URL,
  PDB_ANALYZE, FETCH_METADATA, FETCH_INTERFACE, SHOW_INTERACTIONS, ALIGN_STRUCTURES,
  SHOW_ELECTROSTATIC_SURFACE, SHOW_DRUGGABLE_POCKET, RUN_VIRTUAL_SCREENING, DETECT_POCKETS,
  SET_REPRESENTATION, SET_COLOR_THEME, SET_UNIFORM_COLOR,
  FOCUS_LIGAND, FOCUS_RESIDUE, FOCUS_CHAIN, RESET_CAMERA, SET_BACKGROUND,
  TOGGLE_SPIN, TOGGLE_ROCK, TOGGLE_COMPONENT_VISIBILITY,
  SELECT, CLEAR_SELECTION, CLEAR_INTERACTIONS, LABEL_RESIDUE,
  MEASURE_DISTANCE, MEASURE_ANGLE, MEASURE_DIHEDRAL, CLEAR_MEASUREMENTS,
  CAPTURE_MULTI_ANGLE, CAPTURE_SNAPSHOT, EXPORT_SNAPSHOT,
  CLEAR_CHAT,
  ALL_TOOL_DEFINITIONS,
} from "./tool-definitions";

type ExecuteCommandFn = (
  viewer: unknown,
  cmd: unknown,
) => Promise<{ ok: boolean; detail?: string; data?: unknown; analysisResult?: unknown }>;

/**
 * Register all domain tools with their executors.
 * The executor wraps the existing executeCommand function.
 *
 * @param executeCommandFn - The executeCommand function from commands.ts
 */
export function registerDomainTools(executeCommandFn: ExecuteCommandFn): void {
  const exec: ToolExecutor = async (args, ctx) => executeCommandFn(ctx.viewer, buildCommand(args));

  // ---- Structure loading ----
  toolRegistry.register(PDB_LOAD, async (args, ctx) =>
    executeCommandFn(ctx.viewer, { type: "load_pdb", id: args.id as string }),
  );
  toolRegistry.register(LOAD_ALPHAFOLD, async (args, ctx) =>
    executeCommandFn(ctx.viewer, { type: "load_alphafold", uniprotId: args.uniprotId as string }),
  );
  toolRegistry.register(LOAD_EMDB, async (args, ctx) =>
    executeCommandFn(ctx.viewer, {
      type: "load_emdb",
      id: args.emdbId as string,
      detail: (args.detail as number) ?? 3,
    }),
  );
  toolRegistry.register(LOAD_STRUCTURE_URL, async (args, ctx) =>
    executeCommandFn(ctx.viewer, {
      type: "load_structure_url",
      url: args.url as string,
      format: (args.format as "pdb" | "mmcif") ?? "mmcif",
      isBinary: (args.isBinary as boolean) ?? false,
    }),
  );

  // ---- Analysis ----
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
  toolRegistry.register(FETCH_METADATA, async (_args, _ctx) =>
    // fetchMetadata is called inside executeCommand for analyze_metadata
    executeCommandFn(_ctx.viewer, {
      type: "analyze_metadata",
      id: _args.id as string,
      includeInterfaces: (args_includeInterfaces(_args)) ?? true,
    }),
  );
  toolRegistry.register(FETCH_INTERFACE, async (args, ctx) =>
    executeCommandFn(ctx.viewer, {
      type: "analyze_interface",
      id: args.id as string,
      assembly: (args.assembly as number) ?? 1,
    }),
  );
  toolRegistry.register(SHOW_INTERACTIONS, async (args, ctx) => {
    const cmd: Record<string, unknown> = { type: "show_interactions", radius: (args.radius as number) ?? 8 };
    if (args.target_compId) {
      cmd.target = args.target_compId;
    } else if (args.target_chain && args.target_resno) {
      cmd.target = { chain: args.target_chain, resno: args.target_resno };
    } else {
      cmd.target = "ligand";
    }
    return executeCommandFn(ctx.viewer, cmd);
  });
  toolRegistry.register(ALIGN_STRUCTURES, async (args, ctx) =>
    executeCommandFn(ctx.viewer, {
      type: "align_structures",
      ref: args.ref as number,
      mobile: args.mobile as number,
      method: (args.method as "superpose" | "tm-align") ?? "superpose",
    }),
  );
  toolRegistry.register(SHOW_ELECTROSTATIC_SURFACE, async (args, ctx) =>
    executeCommandFn(ctx.viewer, {
      type: "show_electrostatic_surface",
      chain: args.chain as string | undefined,
      ionicStrength: args.ionicStrength as number | undefined,
    }),
  );
  toolRegistry.register(SHOW_DRUGGABLE_POCKET, async (args, ctx) =>
    executeCommandFn(ctx.viewer, {
      type: "show_druggable_pocket",
      ligandCompId: args.ligandCompId as string,
      radius: (args.radius as number) ?? 8,
    }),
  );
  toolRegistry.register(RUN_VIRTUAL_SCREENING, async (args, ctx) =>
    executeCommandFn(ctx.viewer, {
      type: "run_virtual_screening",
      ligandCompId: args.ligandCompId as string,
      fragmentSet: (args.fragmentSet as string) ?? "druglike",
    }),
  );
  toolRegistry.register(DETECT_POCKETS, async (args, ctx) =>
    executeCommandFn(ctx.viewer, {
      type: "detect_pockets",
      minDepth: (args.minDepth as number) ?? 100,
    }),
  );

  // ---- Visualization ----
  toolRegistry.register(SET_REPRESENTATION, async (args, ctx) =>
    executeCommandFn(ctx.viewer, {
      type: "set_representation",
      preset: args.preset as string,
      structures: "all",
    }),
  );
  toolRegistry.register(SET_COLOR_THEME, async (args, ctx) =>
    executeCommandFn(ctx.viewer, {
      type: "set_color_theme",
      theme: args.theme as string,
      structures: "all",
    }),
  );
  toolRegistry.register(SET_UNIFORM_COLOR, async (args, ctx) =>
    executeCommandFn(ctx.viewer, {
      type: "set_uniform_color",
      color: args.color as string,
      structures: "all",
    }),
  );
  toolRegistry.register(FOCUS_LIGAND, async (args, ctx) =>
    executeCommandFn(ctx.viewer, { type: "focus_ligand", compId: args.compId as string }),
  );
  toolRegistry.register(FOCUS_RESIDUE, async (args, ctx) =>
    executeCommandFn(ctx.viewer, {
      type: "focus_residue",
      chain: args.chain as string,
      resno: args.resno as number,
    }),
  );
  toolRegistry.register(FOCUS_CHAIN, async (args, ctx) =>
    executeCommandFn(ctx.viewer, { type: "focus_chain", chain: args.chain as string }),
  );
  toolRegistry.register(RESET_CAMERA, async (_args, ctx) =>
    executeCommandFn(ctx.viewer, { type: "reset_camera" }),
  );
  toolRegistry.register(SET_BACKGROUND, async (args, ctx) =>
    executeCommandFn(ctx.viewer, { type: "set_background", color: args.color as string }),
  );
  toolRegistry.register(TOGGLE_SPIN, async (args, ctx) =>
    executeCommandFn(ctx.viewer, { type: "toggle_spin", speed: (args.speed as number) ?? 0.1 }),
  );
  toolRegistry.register(TOGGLE_ROCK, async (_args, ctx) =>
    executeCommandFn(ctx.viewer, { type: "toggle_rock" }),
  );
  toolRegistry.register(TOGGLE_COMPONENT_VISIBILITY, async (args, ctx) =>
    executeCommandFn(ctx.viewer, {
      type: "toggle_component_visibility",
      component: args.component as string,
      action: (args.action as "show" | "hide" | "toggle") ?? "toggle",
    }),
  );
  toolRegistry.register(SELECT, async (args, ctx) => {
    const cmd: Record<string, unknown> = {
      type: "select",
      action: (args.action as "set" | "add" | "remove") ?? "set",
    };
    if (args.target_compId) {
      cmd.target = args.target_compId;
    } else if (args.target_chain && args.target_resno) {
      cmd.target = { chain: args.target_chain, resno: args.target_resno };
    } else {
      cmd.target = "all";
    }
    return executeCommandFn(ctx.viewer, cmd);
  });
  toolRegistry.register(CLEAR_SELECTION, async (_args, ctx) =>
    executeCommandFn(ctx.viewer, { type: "clear_selection" }),
  );
  toolRegistry.register(CLEAR_INTERACTIONS, async (_args, ctx) =>
    executeCommandFn(ctx.viewer, { type: "clear_interactions" }),
  );
  toolRegistry.register(LABEL_RESIDUE, async (args, ctx) =>
    executeCommandFn(ctx.viewer, {
      type: "label_residue",
      chain: args.chain as string,
      resno: args.resno as number,
      text: args.text as string | undefined,
    }),
  );

  // ---- Measurement ----
  toolRegistry.register(MEASURE_DISTANCE, async (args, ctx) =>
    executeCommandFn(ctx.viewer, {
      type: "measure_distance",
      a: {
        chain: args.a_chain as string,
        resno: args.a_resno as number,
        atom: (args.a_atom as string) ?? "CA",
      },
      b: {
        chain: args.b_chain as string,
        resno: args.b_resno as number,
        atom: (args.b_atom as string) ?? "CA",
      },
    }),
  );
  toolRegistry.register(MEASURE_ANGLE, async (args, ctx) =>
    executeCommandFn(ctx.viewer, {
      type: "measure_angle",
      a: { chain: args.a_chain as string, resno: args.a_resno as number, atom: (args.a_atom as string) ?? "CA" },
      b: { chain: args.b_chain as string, resno: args.b_resno as number, atom: (args.b_atom as string) ?? "CA" },
      c: { chain: args.c_chain as string, resno: args.c_resno as number, atom: (args.c_atom as string) ?? "CA" },
    }),
  );
  toolRegistry.register(MEASURE_DIHEDRAL, async (args, ctx) =>
    executeCommandFn(ctx.viewer, {
      type: "measure_dihedral",
      a: { chain: args.a_chain as string, resno: args.a_resno as number, atom: (args.a_atom as string) ?? "CA" },
      b: { chain: args.b_chain as string, resno: args.b_resno as number, atom: (args.b_atom as string) ?? "CA" },
      c: { chain: args.c_chain as string, resno: args.c_resno as number, atom: (args.c_atom as string) ?? "CA" },
      d: { chain: args.d_chain as string, resno: args.d_resno as number, atom: (args.d_atom as string) ?? "CA" },
    }),
  );
  toolRegistry.register(CLEAR_MEASUREMENTS, async (_args, ctx) =>
    executeCommandFn(ctx.viewer, { type: "clear_measurements" }),
  );

  // ---- Screenshot / capture ----
  toolRegistry.register(CAPTURE_MULTI_ANGLE, async (args, ctx) =>
    executeCommandFn(ctx.viewer, {
      type: "capture_multi_angle",
      recipe: args.recipe as string,
      angles: (args.angles as Array<"front" | "side" | "top" | "back">) ?? ["front", "side", "top"],
    }),
  );
  toolRegistry.register(CAPTURE_SNAPSHOT, async (args, ctx) =>
    executeCommandFn(ctx.viewer, {
      type: "capture_snapshot",
      label: args.label as string | undefined,
    }),
  );
  toolRegistry.register(EXPORT_SNAPSHOT, async (_args, ctx) =>
    executeCommandFn(ctx.viewer, { type: "export_snapshot" }),
  );

  // ---- Session ----
  toolRegistry.register(CLEAR_CHAT, async (_args, _ctx) => {
    // This will be handled by the chat store — return a signal
    return { cleared: true };
  });
}

/** Helper to safely extract includeInterfaces from args */
function args_includeInterfaces(args: Record<string, unknown>): boolean | undefined {
  const v = args.includeInterfaces;
  return typeof v === "boolean" ? v : undefined;
}

/** Placeholder — not used (executors are registered individually above) */
function buildCommand(_args: Record<string, unknown>): unknown {
  return { type: "noop" };
}

/** Unregister all domain tools (for cleanup/testing) */
export function unregisterDomainTools(): void {
  for (const def of ALL_TOOL_DEFINITIONS) {
    toolRegistry.unregister(def.name);
  }
}

/** List all registered tool names (for debugging/UI display) */
export function listAllToolNames(): string[] {
  return ALL_TOOL_DEFINITIONS.map((d) => d.name);
}
