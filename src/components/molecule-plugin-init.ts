'use client';

// ─── Molstar module loading with retry ─────────────────────────────────

export function isChunkLoadError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message || '';
    return (
      msg.includes('Failed to load chunk') ||
      msg.includes('Loading chunk') ||
      msg.includes('Importing a module script failed') ||
      (err.name === 'TypeError' &&
        msg.includes('Failed to fetch dynamically imported module'))
    );
  }
  return false;
}

export async function importWithRetry<T>(
  importFn: () => Promise<T>,
  retries = 1,
  delayMs = 1500
): Promise<T> {
  try {
    return await importFn();
  } catch (err) {
    if (retries > 0 && isChunkLoadError(err)) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return importWithRetry(importFn, retries - 1, delayMs);
    }
    throw err;
  }
}

// ─── Types ───────────────────────────────────────────────────────────────

export interface MolstarModules {
  StructureProperties: any;
  StructureElement: any;
  PluginCommands: any;
  Color: any;
  Script: any;
  StructureSelectionQuery: any;
  StructureSelectionQueries: any;
  MolScriptBuilder: any;
  compile: any;
  StateSelection: any;
  PluginStateObject: any;
}

export type BackgroundMode = 'theme' | 'white' | 'dark' | 'transparent';

// ─── Background colors ──────────────────────────────────────────────────

export const BACKGROUND_COLORS: Record<BackgroundMode, number> = {
  theme: 0xfaf8f5,
  white: 0xffffff,
  dark: 0x1a1917,
  transparent: 0x000000,
};

export const BACKGROUND_LABELS: Record<BackgroundMode, string> = {
  theme: 'Theme',
  white: 'White',
  dark: 'Dark',
  transparent: 'Transparent',
};

// ─── Preset Colors for context menu color picker ─────────────────────────

export const PRESET_COLORS = [
  '#e53e3e', '#dd6b20', '#d69e2e', '#38a169', '#3182ce',
  '#805ad5', '#d53f8c', '#00b5d8', '#718096', '#1a202c',
  '#48bb78', '#ed8936', '#9f7aea', '#fc8181', '#f6e05e',
];

// ─── Cached Molstar module refs (loaded once, reused) ───────────────────

let molstarModulesCache: MolstarModules | null = null;

// Helper: create a per-chain selection query using MolScriptBuilder
export function createChainSelectionQuery(MS: any, chainId: string) {
  return MS.struct.generator.atomGroups({
    'chain-test': MS.core.rel.eq([MS.ammp('auth_asym_id'), chainId])
  });
}

export async function getMolstarModules(): Promise<MolstarModules> {
  // Validate cache has all expected modules (in case of hot reload)
  if (molstarModulesCache && molstarModulesCache.MolScriptBuilder && molstarModulesCache.compile) {
    return molstarModulesCache;
  }
  // Invalidate stale cache that doesn't have the new modules
  molstarModulesCache = null;

  const [sp, se, pc, color, script, ssq, msb, comp, ss, pso] = await Promise.all([
    importWithRetry(() =>
      import('molstar/lib/mol-model/structure/structure/properties.js')
    ),
    importWithRetry(() =>
      import('molstar/lib/mol-model/structure/structure/element.js')
    ),
    importWithRetry(() => import('molstar/lib/mol-plugin/commands.js')),
    importWithRetry(() => import('molstar/lib/mol-util/color/index.js')),
    importWithRetry(() => import('molstar/lib/mol-script/script.js')),
    importWithRetry(() =>
      import('molstar/lib/mol-plugin-state/helpers/structure-selection-query.js')
    ),
    importWithRetry(() => import('molstar/lib/mol-script/language/builder.js')),
    importWithRetry(() => import('molstar/lib/mol-script/runtime/query/compiler.js')),
    importWithRetry(() => import('molstar/lib/mol-state/state/selection.js')),
    importWithRetry(() => import('molstar/lib/mol-plugin-state/objects.js')),
  ]);

  const modules: MolstarModules = {
    StructureProperties: sp.StructureProperties,
    StructureElement: se.StructureElement,
    PluginCommands: pc.PluginCommands,
    Color: color.Color,
    Script: script.Script,
    StructureSelectionQuery: ssq.StructureSelectionQuery,
    StructureSelectionQueries: ssq.StructureSelectionQueries,
    MolScriptBuilder: msb.MolScriptBuilder,
    compile: comp.compile,
    StateSelection: ss.StateSelection,
    PluginStateObject: pso.PluginStateObject,
  };

  molstarModulesCache = modules;
  return modules;
}

// ─── WebGL availability check ───────────────────────────────────────────

export function checkWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return false;
    // Verify the context is actually usable
    return (gl as WebGL2RenderingContext).constructor.name === 'WebGL2RenderingContext' ||
           (gl as WebGLRenderingContext).constructor.name === 'WebGLRenderingContext';
  } catch {
    return false;
  }
}

// ─── Context Menu & Hover Info Types ─────────────────────────────────────

export interface ContextMenuState {
  x: number;
  y: number;
  type: 'entity' | 'ligand';
  key: string; // entityKey or ligandCode
  chainId?: string;
  entityId?: number;
  showColorPicker: boolean;
  entityDesc?: string;
  organism?: string;
  residueCount?: number;
  ligandCode?: string;
  ligandName?: string;
  ligandType?: string;
}

export interface HoverInfoState {
  x: number;
  y: number;
  type: 'entity' | 'ligand';
  chainId?: string;
  entityDesc?: string;
  organism?: string;
  residueCount?: number;
  ligandCode?: string;
  ligandName?: string;
  ligandType?: string;
}
// ─── Ligand Detection ────────────────────────────────────────────────────

export function detectLigandCodes(entities: EntityInfo[]): string[] {
  const codes = new Set<string>();
  for (const entity of entities) {
    for (const chemCompId of entity.chem_comp_ids) {
      if (chemCompId && !/^ion$|^mg$|^ca$|^na$|^cl$|^k$|^zn$|^fe$|^cu$|^mn$/i.test(chemCompId)) {
        codes.add(chemCompId);
      }
    }
  }
  return Array.from(codes);
}

// detectLigandCodes is at end of file

// EntityInfo used by detectLigandCodes - defined locally to avoid circular dep with molecule-viewer
export interface EntityInfo {
  entity_id: number;
  molecule_type: string;
  description: string;
  organism: string;
  gene_name: string;
  chem_comp_ids: string[];
  chains: { chain: string; asym_id: string; length: number | null }[];
}
