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
const STORAGE_KEY_CHAT_PROVIDER = "pdb-tracker:llm-provider:v2";
const STORAGE_KEY_MEASUREMENTS = "pdb-tracker:measurements:v1";
const STORAGE_KEY_INTERACTION_LINES = "pdb-tracker:interaction-lines:v1";

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
  measureMode: "off" | "distance" | "angle" | "dihedral" | "label";
  setMeasureMode: (m: "off" | "distance" | "angle" | "dihedral" | "label") => void;
  /** Live picking progress for the UI indicator (0/2 → 1/2 → 2/2). */
  measureProgress: { picked: number; needed: number };
  setMeasureProgress: (p: { picked: number; needed: number }) => void;
  /** Labels of atoms picked so far (e.g. ["TRP A 47 C", "LYS A 66 CE"]). */
  pickedAtoms: string[];
  setPickedAtoms: (a: string[]) => void;
  measurements: Array<{
    id: string;
    mode: "distance" | "angle" | "dihedral" | "label";
    label: string;
    detail: string;
    ts: number;
    /** Optional atom coords for the overlay canvas to draw the line. When
     *  present, the measurement is rendered as an interactionLine (so it
     *  can be removed individually via removeMeasurement). */
    atoms?: Array<{ x: number; y: number; z: number; label?: string }>;
    /** The interactionLine id linked to this measurement, so removing the
     *  measurement also removes its overlay line. */
    lineId?: string;
  }>;
  addMeasurement: (m: {
    mode: "distance" | "angle" | "dihedral" | "label";
    label: string;
    detail: string;
    atoms?: Array<{ x: number; y: number; z: number; label?: string }>;
    lineId?: string;
  }) => void;
  removeMeasurement: (id: string) => void;
  clearMeasurements: () => void;

  /** Interaction overlay lines — drawn by the MeasureOverlay canvas.
   *  Used by click-to-measure distance/angle and by interaction charts
   *  to draw dashed distance lines between two atoms in 3D space,
   *  projected onto the overlay canvas. */
  interactionLines: Array<{
    id: string;
    from: { x: number; y: number; z: number; label?: string };
    to: { x: number; y: number; z: number; label?: string };
    color: string;
    label?: string;
    dashed?: boolean;
  }>;
  addInteractionLine: (line: {
    id?: string;
    from: { x: number; y: number; z: number; label?: string };
    to: { x: number; y: number; z: number; label?: string };
    color: string;
    label?: string;
    dashed?: boolean;
  }) => void;
  setInteractionLines: (lines: Array<{
    from: { x: number; y: number; z: number; label?: string };
    to: { x: number; y: number; z: number; label?: string };
    color: string;
    label?: string;
    dashed?: boolean;
  }>) => void;
  clearInteractionLines: () => void;

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

  // Active analysis chart — when the user clicks a chart tile in the left
  // panel, the chart's result renders in the RIGHT panel (Results tab) instead
  // of inline in the narrow left panel. This gives the chart more space and
  // keeps the left panel as a navigation list.
  activeAnalysisChart: string | null;
  setActiveAnalysisChart: (chartId: string | null) => void;

  // Chat / agent conversation state (ported from Molcraft, adapted to use
  // pdb-tracker-web-v5's run-center LLM provider system instead of Molcraft's
  // CLI agent detection).
  chatMessages: ChatMessage[];
  addChatMessage: (m: ChatMessage) => void;
  updateChatMessage: (id: string, patch: Partial<ChatMessage>) => void;
  clearChat: () => void;
  // Selected LLM provider (persisted to localStorage, shared with run center).
  // Empty string = auto (use the run center's chosen provider).
  chatProvider: string;
  setChatProvider: (providerId: string) => void;

  // Chart presets (save/load chart parameter combinations)
  chartPresets: ChartPreset[];
  saveChartPreset: (preset: ChartPreset) => void;
  deleteChartPreset: (id: string) => void;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
  pending?: boolean;
  /** Optional commands the agent requested (for display in the message bubble). */
  commands?: unknown[];
  /** Optional analysis results the agent collected (for ReAct display). */
  analysisResults?: unknown[];
  /** Provider that produced this message (for the avatar badge). */
  provider?: string;
  /** P3: When true, the message bubble shows confirm/deny buttons and the agent
   *  loop waits for the user to approve destructive commands. */
  needsConfirmation?: boolean;
  /** P3: The user's confirmation response (true = proceed, false = skip). */
  confirmationResult?: boolean;
  /** Improvement #2: Current agent step for the progress indicator.
   *  One of: "thinking" | "calling-llm" | "parsing" | "executing" | "done" | "error" */
  agentStep?: "thinking" | "calling-llm" | "parsing" | "executing" | "done" | "error";
  /** Improvement #3: When true, the message is an error and shows a Retry button. */
  isError?: boolean;
  /** Improvement #3: The user message text that should be re-sent on retry. */
  retryPrompt?: string;
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
      // Clear viz state if it belonged to this structure
      const clearViz = (viz: unknown) => {
        if (viz && typeof viz === "object" && "pdbId" in viz) {
          return (viz as { pdbId: string }).pdbId === id ? null : viz;
        }
        return viz;
      };
      return {
        structures,
        activeStructureId,
        structureFileCache,
        alignmentHistory,
        electrostaticViz: clearViz(state.electrostaticViz) as typeof state.electrostaticViz,
        druggabilityViz: clearViz(state.druggabilityViz) as typeof state.druggabilityViz,
        screeningViz: clearViz(state.screeningViz) as typeof state.screeningViz,
        pocketDetectionViz: clearViz(state.pocketDetectionViz) as typeof state.pocketDetectionViz,
      };
    }),
  clearStructures: () =>
    set({
      structures: [],
      activeStructureId: null,
      structureFileCache: {},
      alignmentHistory: [],
      electrostaticViz: null,
      druggabilityViz: null,
      screeningViz: null,
      pocketDetectionViz: null,
    }),
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
  setMeasureMode: (m) => set({ measureMode: m, measureProgress: { picked: 0, needed: m === "distance" ? 2 : m === "angle" ? 3 : m === "dihedral" ? 4 : m === "label" ? 1 : 0 }, pickedAtoms: [] }),
  measureProgress: { picked: 0, needed: 0 },
  setMeasureProgress: (p) => set({ measureProgress: p }),
  pickedAtoms: [],
  setPickedAtoms: (a) => set({ pickedAtoms: a }),
  measurements: loadMeasurements(),
  addMeasurement: (m) =>
    set((state) => {
      const measurements = [
        { id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...m, ts: Date.now() },
        ...state.measurements,
      ].slice(0, 50);
      persistMeasurements(measurements);
      return { measurements };
    }),
  removeMeasurement: (id) =>
    set((state) => {
      const target = state.measurements.find((mm) => mm.id === id);
      const lineId = target?.lineId;
      const measurements = state.measurements.filter((mm) => mm.id !== id);
      const interactionLines = lineId
        ? state.interactionLines.filter((l) => l.id !== lineId)
        : state.interactionLines;
      persistMeasurements(measurements);
      persistInteractionLines(interactionLines);
      return { measurements, interactionLines };
    }),
  clearMeasurements: () => {
    persistMeasurements([]);
    set({ measurements: [] });
  },

  interactionLines: loadInteractionLines(),
  addInteractionLine: (line) =>
    set((state) => {
      const interactionLines = [
        ...state.interactionLines,
        {
          id: line.id ?? `il-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          from: line.from,
          to: line.to,
          color: line.color,
          label: line.label,
          dashed: line.dashed,
        },
      ];
      persistInteractionLines(interactionLines);
      return { interactionLines };
    }),
  setInteractionLines: (lines) => {
    const interactionLines = lines.map((line, i) => ({
      id: `il-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      ...line,
    }));
    persistInteractionLines(interactionLines);
    set({ interactionLines });
  },
  clearInteractionLines: () => {
    persistInteractionLines([]);
    set({ interactionLines: [] });
  },

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

  activeAnalysisChart: null,
  setActiveAnalysisChart: (chartId) => set({ activeAnalysisChart: chartId }),

  // Chat / agent conversation state
  chatMessages: [],
  addChatMessage: (m) =>
    set((state) => ({ chatMessages: [...state.chatMessages, m] })),
  updateChatMessage: (id, patch) =>
    set((state) => ({
      chatMessages: state.chatMessages.map((m) =>
        m.id === id ? { ...m, ...patch } : m
      ),
    })),
  clearChat: () => set({ chatMessages: [] }),
  chatProvider: loadChatProvider(),
  setChatProvider: (providerId) => {
    persistChatProvider(providerId);
    set({ chatProvider: providerId });
  },

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

// ---- chat provider persistence (shared with run center via the same localStorage key) ----
function loadChatProvider(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(STORAGE_KEY_CHAT_PROVIDER) || "";
  } catch {
    return "";
  }
}

function persistChatProvider(providerId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_CHAT_PROVIDER, providerId);
  } catch { /* ignore */ }
}

// ---- measurement persistence (survive modal close/reopen) ----
function loadMeasurements(): AppState["measurements"] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MEASUREMENTS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistMeasurements(measurements: AppState["measurements"]): void {
  if (typeof window === "undefined") return;
  try {
    // Only persist measurements that have atom coords (needed for overlay redraw).
    // Cap at 50 to avoid localStorage overflow.
    const toSave = measurements.slice(0, 50).map((m) => ({
      ...m,
      // Strip any non-serializable fields
      atoms: m.atoms?.map((a) => ({ x: a.x, y: a.y, z: a.z, label: a.label })),
    }));
    localStorage.setItem(STORAGE_KEY_MEASUREMENTS, JSON.stringify(toSave));
  } catch { /* ignore quota errors */ }
}

function loadInteractionLines(): AppState["interactionLines"] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_INTERACTION_LINES);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistInteractionLines(lines: AppState["interactionLines"]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_INTERACTION_LINES, JSON.stringify(lines.slice(0, 100)));
  } catch { /* ignore */ }
}
