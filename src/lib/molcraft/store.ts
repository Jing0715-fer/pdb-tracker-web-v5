"use client";

/**
 * Molcraft structure-analysis Zustand store — adapted for pdb-tracker-web-v4.
 *
 * Removed from the original Molcraft store:
 *   - Chat messages / agent conversation state (we reuse pdb-tracker-web-v4's
 *     own LLM system in src/lib/llm.ts + /api/ai-* routes instead of
 *     Molcraft's chatbot).
 *   - lastSnapshot (was tied to the agent's screenshot verification loop).
 *
 * Kept: viewer, structures, UI tabs, command log, alignment, measurements,
 *       advanced visualization overlays, analysis reports, session save/load.
 */

import { create } from "zustand";
import type { MolstarViewer, MolstarPlugin } from "./types";

// ---- localStorage persistence helpers ----
const STORAGE_KEY_REPORTS = "pdb-tracker:molcraft-reports";

function loadFromStorage<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveReportsToStorage(reports: AnalysisReport[]): void {
  if (typeof window === "undefined") return;
  try {
    const cleaned = reports.slice(-50).map((r) => ({
      ...r,
      snapshot: undefined,
    }));
    localStorage.setItem(STORAGE_KEY_REPORTS, JSON.stringify(cleaned));
  } catch {
    /* give up */
  }
}

export interface AnalysisReport {
  id: string;
  title: string;
  markdown: string;
  snapshot?: string;
  createdAt: number;
}

export interface LoadedStructure {
  id: string;
  label: string;
  source: "pdb" | "alphafold" | "emdb" | "url" | "file";
  loadedAt: number;
  pdbText?: string;
  color?: string;
  style?: {
    representation: "cartoon" | "stick" | "line" | "sphere" | "surface";
    colorScheme: "chain" | "element" | "secondary" | "single" | "spectrum" | "bfactor" | "residue" | "charge";
    opacity: number;
    singleColor: string;
  };
  metadata?: {
    chains?: string[];
    numAtoms?: number;
    numResidues?: number;
    method?: string;
    resolution?: number | null;
    title?: string;
    organism?: string;
  };
  transform?: number[][];
  alignRmsd?: number;
  alignTmScore?: number;
}

export const DEFAULT_STYLE = {
  representation: "cartoon" as const,
  colorScheme: "spectrum" as const,
  opacity: 1,
  singleColor: "#c96442", // pdb-tracker-web-v4 terracotta accent
};

export interface MolstarStateSnapshot {
  measurements: Array<{ kind: "distance" | "angle" | "dihedral" | "label"; label: string }>;
}

interface AppState {
  // Viewer
  viewer: MolstarViewer | null;
  plugin: MolstarPlugin | null;
  ready: boolean;
  setViewer: (v: MolstarViewer | null) => void;

  // Structures
  structures: LoadedStructure[];
  activeStructureId: string | null;
  addStructure: (s: LoadedStructure) => void;
  removeStructure: (id: string) => void;
  clearStructures: () => void;
  setActiveStructure: (id: string | null) => void;
  renameStructure: (id: string, label: string) => void;
  updateStructureStyle: (id: string, patch: Partial<NonNullable<LoadedStructure["style"]>>) => void;
  updateStructureMetadata: (id: string, metadata: LoadedStructure["metadata"]) => void;
  setStructureAlignment: (id: string, rmsd: number, tmScore?: number, transform?: number[][]) => void;
  structureFileCache: Record<string, { content: string; format: "pdb" | "cif" }>;
  setStructureFileCache: (id: string, content: string, format: "pdb" | "cif") => void;

  // UI
  leftPanelTab: "structures" | "measure" | "analysis";
  setLeftPanelTab: (t: "structures" | "measure" | "analysis") => void;
  viewerBgDark: boolean;
  setViewerBgDark: (dark: boolean) => void;

  // Reports (analysis markdown saved from charts)
  reports: AnalysisReport[];
  addReport: (r: AnalysisReport) => void;
  removeReport: (id: string) => void;

  // Active command log
  commandLog: Array<{ ts: number; type: string; ok: boolean; detail?: string }>;
  logCommand: (entry: { type: string; ok: boolean; detail?: string }) => void;

  // Alignment
  lastAlignment: AlignmentResult | null;
  setLastAlignment: (a: AlignmentResult | null) => void;
  alignmentHistory: AlignmentResult[];
  addAlignmentToHistory: (a: AlignmentResult) => void;
  clearAlignmentHistory: () => void;

  // Measurement
  measureMode: "off" | "distance" | "angle";
  setMeasureMode: (m: "off" | "distance" | "angle") => void;
  measurements: Array<{ id: string; mode: "distance" | "angle"; label: string; detail: string; ts: number }>;
  addMeasurement: (m: { mode: "distance" | "angle"; label: string; detail: string }) => void;
  removeMeasurement: (id: string) => void;
  clearMeasurements: () => void;

  // Advanced visualization overlays
  electrostaticViz: ElectrostaticViz | null;
  setElectrostaticViz: (v: ElectrostaticViz | null) => void;
  druggabilityViz: DruggabilityViz | null;
  setDruggabilityViz: (v: DruggabilityViz | null) => void;
  screeningViz: ScreeningViz | null;
  setScreeningViz: (v: ScreeningViz | null) => void;
  pocketDetectionViz: PocketDetectionViz | null;
  setPocketDetectionViz: (v: PocketDetectionViz | null) => void;

  // Session
  saveSession: () => string;
  loadSession: (data: unknown) => void;

  // Toast bus
  toast: (msg: string, kind?: "default" | "success" | "error" | "info") => void;

  // Pending PDB ID to auto-load when the viewer becomes ready (used by the
  // "Analyze" button in PdbViewerModal to hand off a structure to this module)
  pendingPdbId: string | null;
  setPendingPdbId: (id: string | null) => void;

  // Chart favorites and recently used (persisted to localStorage)
  favoriteCharts: string[];
  toggleFavoriteChart: (chartId: string) => void;
  recentCharts: string[];
  addRecentChart: (chartId: string) => void;

  // Chart presets (save/load chart parameter combinations)
  chartPresets: ChartPreset[];
  saveChartPreset: (preset: ChartPreset) => void;
  deleteChartPreset: (id: string) => void;
}

export interface ChartPreset {
  id: string;
  name: string;
  chartId: string;
  chartLabel: string;
  params: Record<string, unknown>;
  createdAt: number;
}

// Advanced visualization state types
export interface ElectrostaticViz {
  pdbId: string;
  chainFilter: string;
  ionicStrengthMm: number;
  debyeLengthA: number;
  forcefield: string;
  pdb2pqrUsed: boolean;
  numChargedAtoms: number;
  totalPotentialKcal: number;
  meanPotentialKcal: number;
  mostStabilizing: Array<{
    chain: string; resno: number; resname: string; atom: string;
    charge: number; potential_kcal_mol: number;
  }>;
  mostDestabilizing: Array<{
    chain: string; resno: number; resname: string; atom: string;
    charge: number; potential_kcal_mol: number;
  }>;
  surfaceCharged: Array<{
    chain: string; resno: number; resname: string; atom: string;
    charge: number; potential_kcal_mol: number;
  }>;
  createdAt: number;
}

export interface DruggabilityViz {
  pdbId: string;
  ligand: string;
  radiusA: number;
  pocketResidueCount: number;
  pocketVolumeA3: number;
  druggabilityScore: number;
  classification: string;
  composition: Record<string, number>;
  hydrophobicPct: number;
  polarPct: number;
  chargedPct: number;
  scoreBreakdown: {
    volume: number; hydrophobicity: number; polarity: number;
    depth: number; charge: number;
  };
  residues: Array<{
    chain: string; resno: number; resname: string;
    min_dist_A: number; category: string;
  }>;
  createdAt: number;
}

export interface ScreeningViz {
  pdbId: string;
  ligand: string;
  pocketScore: number;
  fragmentSet: string;
  rankedHits: Array<{
    name: string; smiles: string; mw: number; logp: number;
    hbondDonors: number; hbondAcceptors: number;
    affinityKcal: number; ki_uM: number; score: number; rationale: string;
  }>;
  createdAt: number;
}

export interface PocketDetectionViz {
  pdbId: string;
  pockets: Array<{
    id: number;
    center: [number, number, number];
    volume: number;
    depth: number;
    druggabilityScore: number;
    classification: string;
    residueCount: number;
    composition: Record<string, number>;
    topResidues: Array<{ chain: string; resno: number; resname: string }>;
  }>;
  createdAt: number;
}

export interface AlignmentResult {
  id: string;
  refId: string;
  mobileId: string;
  method: string;
  rmsd?: number;
  tmScore?: number;
  alignedResidues?: number;
  totalResidues?: number;
  identity?: number;
  transform?: number[][];
  detail?: string;
  timestamp: number;
}

let toastFn: ((msg: string, kind?: "default" | "success" | "error" | "info") => void) | null = null;
export function registerToast(fn: typeof toastFn) {
  toastFn = fn;
}

/** Color palette for structure list items — adapted to pdb-tracker-web-v4 warm palette. */
export const STRUCTURE_PALETTE = [
  "#c96442", // terracotta (claude accent)
  "#2d8f8f", // teal (cryo-em)
  "#7c5cbf", // purple (x-ray)
  "#c9872e", // amber (nmr)
  "#6b7280", // gray (other)
  "#3db5b5", // light teal
  "#9b7ed8", // light purple
  "#d9a24e", // light amber
];

function nextStructureColor(existing: LoadedStructure[]): string {
  const used = new Set(existing.map((s) => s.color));
  for (const c of STRUCTURE_PALETTE) if (!used.has(c)) return c;
  return STRUCTURE_PALETTE[existing.length % STRUCTURE_PALETTE.length];
}

export const useAppStore = create<AppState>((set, get) => ({
  viewer: null,
  plugin: null,
  ready: false,
  setViewer: (v) => {
    if (typeof window !== "undefined" && v?.plugin) {
      (window as any).__molstarPlugin = v.plugin;
    }
    set({
      viewer: v,
      plugin: v?.plugin ?? null,
      ready: !!v,
    });
  },

  structures: [],
  activeStructureId: null,
  addStructure: (s) =>
    set((state) => {
      const filtered = state.structures.filter((x) => x.id !== s.id);
      const struct: LoadedStructure = {
        ...s,
        color: s.color ?? nextStructureColor(filtered),
        style: s.style ?? { ...DEFAULT_STYLE, singleColor: s.color ?? nextStructureColor(filtered) },
      };
      const structures = [...filtered, struct];
      const activeStructureId =
        state.activeStructureId && structures.some((x) => x.id === state.activeStructureId)
          ? state.activeStructureId
          : structures[0]?.id ?? null;
      return { structures, activeStructureId };
    }),
  removeStructure: (id) =>
    set((state) => {
      const structures = state.structures.filter((x) => x.id !== id);
      const activeStructureId =
        state.activeStructureId === id
          ? structures[0]?.id ?? null
          : state.activeStructureId;
      const structureFileCache = { ...state.structureFileCache };
      delete structureFileCache[id];
      const alignmentHistory = state.alignmentHistory.filter(
        (a) => a.refId !== id && a.mobileId !== id
      );
      return { structures, activeStructureId, structureFileCache, alignmentHistory };
    }),
  clearStructures: () => set({ structures: [], activeStructureId: null, structureFileCache: {} }),
  setActiveStructure: (id) => set({ activeStructureId: id }),
  renameStructure: (id, label) =>
    set((state) => ({
      structures: state.structures.map((s) =>
        s.id === id ? { ...s, label } : s
      ),
    })),
  updateStructureStyle: (id, patch) =>
    set((state) => ({
      structures: state.structures.map((s) =>
        s.id === id
          ? { ...s, style: { ...DEFAULT_STYLE, ...s.style, ...patch } }
          : s
      ),
    })),
  updateStructureMetadata: (id, metadata) =>
    set((state) => ({
      structures: state.structures.map((s) =>
        s.id === id ? { ...s, metadata: { ...s.metadata, ...metadata } } : s
      ),
    })),
  setStructureAlignment: (id, rmsd, tmScore, transform) =>
    set((state) => ({
      structures: state.structures.map((s) =>
        s.id === id ? { ...s, alignRmsd: rmsd, alignTmScore: tmScore, transform } : s
      ),
    })),
  structureFileCache: {},
  setStructureFileCache: (id, content, format) =>
    set((state) => ({
      structureFileCache: { ...state.structureFileCache, [id]: { content, format } },
    })),

  leftPanelTab: "structures",
  setLeftPanelTab: (t) => set({ leftPanelTab: t }),
  viewerBgDark: false,
  setViewerBgDark: (dark) => set({ viewerBgDark: dark }),

  reports: loadFromStorage<AnalysisReport>(STORAGE_KEY_REPORTS),
  addReport: (r) =>
    set((state) => {
      const reports = [r, ...state.reports];
      saveReportsToStorage(reports);
      return { reports };
    }),
  removeReport: (id) =>
    set((state) => {
      const reports = state.reports.filter((r) => r.id !== id);
      saveReportsToStorage(reports);
      return { reports };
    }),

  commandLog: [],
  logCommand: (entry) =>
    set((state) => ({
      commandLog: [
        { ts: Date.now(), ...entry },
        ...state.commandLog,
      ].slice(0, 50),
    })),

  lastAlignment: null,
  setLastAlignment: (a) => set({ lastAlignment: a }),
  alignmentHistory: [],
  addAlignmentToHistory: (a) =>
    set((state) => ({
      alignmentHistory: [...state.alignmentHistory, a].slice(-20),
    })),
  clearAlignmentHistory: () => set({ alignmentHistory: [] }),

  measureMode: "off",
  setMeasureMode: (m) => set({ measureMode: m }),
  measurements: [],
  addMeasurement: (m) =>
    set((state) => ({
      measurements: [
        { id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...m, ts: Date.now() },
        ...state.measurements,
      ].slice(0, 50),
    })),
  removeMeasurement: (id) =>
    set((state) => ({ measurements: state.measurements.filter((m) => m.id !== id) })),
  clearMeasurements: () => set({ measurements: [] }),

  electrostaticViz: null,
  setElectrostaticViz: (v) => set({ electrostaticViz: v }),
  druggabilityViz: null,
  setDruggabilityViz: (v) => set({ druggabilityViz: v }),
  screeningViz: null,
  setScreeningViz: (v) => set({ screeningViz: v }),
  pocketDetectionViz: null,
  setPocketDetectionViz: (v) => set({ pocketDetectionViz: v }),

  saveSession: () => {
    const s = get();
    const payload = {
      version: 1,
      savedAt: new Date().toISOString(),
      structures: s.structures,
      measurements: s.measurements,
      alignmentHistory: s.alignmentHistory,
      reports: s.reports,
      structureFileCache: s.structureFileCache,
    };
    return JSON.stringify(payload, null, 2);
  },
  loadSession: (data) => {
    if (!data || typeof data !== "object") {
      get().toast("Invalid session data", "error");
      return;
    }
    const d = data as {
      structures?: LoadedStructure[];
      measurements?: AppState["measurements"];
      alignmentHistory?: AlignmentResult[];
      reports?: AnalysisReport[];
      structureFileCache?: Record<string, { content: string; format: "pdb" | "cif" }>;
    };
    set({
      structures: Array.isArray(d.structures) ? d.structures : [],
      measurements: Array.isArray(d.measurements) ? d.measurements : [],
      alignmentHistory: Array.isArray(d.alignmentHistory) ? d.alignmentHistory : [],
      reports: Array.isArray(d.reports) ? d.reports : [],
      structureFileCache:
        d.structureFileCache && typeof d.structureFileCache === "object"
          ? d.structureFileCache
          : {},
      activeStructureId:
        Array.isArray(d.structures) && d.structures.length > 0
          ? d.structures[0].id
          : null,
    });
    get().toast(
      `Session loaded: ${d.structures?.length ?? 0} structures, ${d.reports?.length ?? 0} reports`,
      "success"
    );
  },

  toast: (msg, kind = "default") => {
    if (toastFn) toastFn(msg, kind);
    else console.log(`[toast:${kind}] ${msg}`);
  },

  pendingPdbId: null,
  setPendingPdbId: (id) => set({ pendingPdbId: id }),

  favoriteCharts: loadChartFavorites(),
  toggleFavoriteChart: (chartId) =>
    set((state) => {
      const favorites = state.favoriteCharts.includes(chartId)
        ? state.favoriteCharts.filter((id) => id !== chartId)
        : [...state.favoriteCharts, chartId];
      saveChartFavorites(favorites);
      return { favoriteCharts: favorites };
    }),
  recentCharts: loadRecentCharts(),
  addRecentChart: (chartId) =>
    set((state) => {
      const recent = [chartId, ...state.recentCharts.filter((id) => id !== chartId)].slice(0, 6);
      saveRecentCharts(recent);
      return { recentCharts: recent };
    }),

  chartPresets: loadChartPresets(),
  saveChartPreset: (preset) =>
    set((state) => {
      const presets = [preset, ...state.chartPresets.filter((p) => p.id !== preset.id)];
      saveChartPresets(presets);
      return { chartPresets: presets };
    }),
  deleteChartPreset: (id) =>
    set((state) => {
      const presets = state.chartPresets.filter((p) => p.id !== id);
      saveChartPresets(presets);
      return { chartPresets: presets };
    }),
}));

// localStorage helpers for chart presets
const CHART_PRESETS_KEY = "pdb-tracker:chart-presets";

function loadChartPresets(): ChartPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CHART_PRESETS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveChartPresets(presets: ChartPreset[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CHART_PRESETS_KEY, JSON.stringify(presets));
  } catch {}
}

// localStorage helpers for chart favorites and recent
const FAVORITE_CHARTS_KEY = "pdb-tracker:favorite-charts";
const RECENT_CHARTS_KEY = "pdb-tracker:recent-charts";

function loadChartFavorites(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(FAVORITE_CHARTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveChartFavorites(favorites: string[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FAVORITE_CHARTS_KEY, JSON.stringify(favorites));
  } catch {}
}

function loadRecentCharts(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_CHARTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecentCharts(recent: string[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(RECENT_CHARTS_KEY, JSON.stringify(recent));
  } catch {}
}

try { if (typeof window !== "undefined") (window as any).__molcraftStore = useAppStore; } catch {}

export function selectActiveStructure(state: AppState): LoadedStructure | null {
  if (!state.activeStructureId) return state.structures[0] ?? null;
  return state.structures.find((s) => s.id === state.activeStructureId) ?? state.structures[0] ?? null;
}
