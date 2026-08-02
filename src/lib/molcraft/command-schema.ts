/**
 * Command type definitions for the structure-analysis → Molstar bridge.
 *
 * Ported from Molcraft. Only the type definitions are kept here (the agent
 * chatbot parsing logic was removed — we reuse pdb-tracker-web-v4's own
 * LLM system in src/lib/llm.ts instead).
 *
 * Each command is discriminated by its `type` field so TypeScript can narrow
 * the payload. Dispatched in commands.ts.
 */

export type LlmCommand =
  | { type: "load_pdb"; id: string; preset?: string }
  | { type: "load_alphafold"; uniprotId: string }
  | { type: "load_emdb"; emdbId: string; detail?: number }
  | { type: "load_structure_url"; url: string; format?: string; isBinary?: boolean }
  | {
      type: "set_representation";
      preset: string;
      structures?: "all" | number;
    }
  | {
      type: "set_color_theme";
      theme: string;
      structures?: "all" | number;
    }
  | {
      type: "set_uniform_color";
      color: string;
      structures?: "all" | number;
    }
  | { type: "focus_residue"; chain?: string; resno?: number; compId?: string }
  | { type: "focus_ligand"; compId: string }
  | { type: "focus_chain"; chain: string }
  | { type: "focus_selection" }
  | { type: "reset_camera" }
  | {
      type: "measure_distance";
      a: ResidueRef;
      b: ResidueRef;
      atomA?: string;
      atomB?: string;
    }
  | {
      type: "measure_angle";
      a: ResidueRef;
      b: ResidueRef;
      c: ResidueRef;
    }
  | {
      type: "measure_dihedral";
      a: ResidueRef;
      b: ResidueRef;
      c: ResidueRef;
      d: ResidueRef;
    }
  | { type: "label_residue"; target: ResidueRef; text?: string }
  | {
      type: "show_interactions";
      target?: ResidueRef | "selection" | "ligand";
      radius?: number;
    }
  | { type: "clear_measurements" }
  | { type: "clear_interactions" }
  | { type: "toggle_spin"; speed?: number }
  | { type: "toggle_rock" }
  | { type: "stop_animation" }
  | { type: "export_snapshot"; width?: number; height?: number }
  | {
      type: "capture_snapshot";
      label?: string;
      angle?: "front" | "side" | "top" | "back";
      labels?: Array<{
        text: string;
        chain?: string;
        resno?: number;
      }>;
      width?: number;
      height?: number;
    }
  | {
      type: "select";
      target: ResidueRef | "ligand" | "all";
      action?: "set" | "add" | "remove";
    }
  | { type: "clear_selection" }
  | { type: "toggle_component_visibility"; component: string; visible?: boolean }
  | {
      type: "load_volume_url";
      url: string;
      format: string;
      isBinary: boolean;
      isoValue: number;
      color?: string;
    }
  | {
      type: "align_structures";
      ref: number;
      mobile: number;
      method?: "superpose" | "tm-align";
    }
  | { type: "set_background"; color: string }
  | { type: "set_granularity"; granularity: string }
  // ---------- Real structure analysis ----------
  | { type: "analyze_metadata"; id: string; includeInterfaces?: boolean }
  | { type: "analyze_interface"; id: string; assembly?: number }
  | { type: "analyze_cli_list" }
  | {
      type: "analyze_run";
      recipe: string;
      pdbId?: string;
      params?: Record<string, unknown>;
    }
  // ---------- APBS electrostatic 3D visualization ----------
  | {
      type: "show_electrostatic_surface";
      pdbId?: string;
      chain?: string;
      ionicStrength?: number;
    }
  // ---------- Druggability 3D visualization ----------
  | {
      type: "show_druggable_pocket";
      ligandCompId: string;
      pdbId?: string;
      radius?: number;
    }
  // ---------- Virtual screening ----------
  | {
      type: "run_virtual_screening";
      ligandCompId: string;
      pdbId?: string;
      fragmentSet?: "druglike" | "fragment" | "natural";
    }
  // ---------- Multi-pocket detection ----------
  | {
      type: "detect_pockets";
      pdbId?: string;
      minDepth?: number;
    };

export interface ResidueRef {
  chain?: string;
  resno?: number;
  compId?: string;
  insCode?: string;
  atom?: string;
}
