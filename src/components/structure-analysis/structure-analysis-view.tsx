"use client";

/**
 * Structure Analysis module — the 4th module of pdb-tracker-web-v4.
 *
 * 3-pane resizable layout (ported from Molcraft's app-shell.tsx):
 *   Left  : Structures + Measure + Analysis charts
 *   Center: Molstar 3D viewer (prebuilt bundle, works in dev)
 *   Right : Reports + History
 *
 * The agent/chatbot panel from Molcraft was intentionally removed — we
 * reuse pdb-tracker-web-v4's own LLM system (src/lib/llm.ts + /api/ai-*)
 * instead. Styling is adapted to the Claude/terracotta theme.
 */
import { useState, useEffect, useRef } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Microscope, Activity, Box, Sparkles, FileText, Loader2 } from "lucide-react";
import { AnalysisToolbar } from "./analysis-toolbar";
import { AnalysisLeftPanel } from "./analysis-left-panel";
import { AnalysisRightPanel } from "./analysis-right-panel";
import { useAnalysisKeyboardShortcuts } from "./use-analysis-keyboard-shortcuts";
import { DragDropOverlay } from "./drag-drop-overlay";
import { ShortcutHelpDialog } from "./shortcut-help-dialog";
import { AnalysisTour } from "./analysis-tour";
import { useAtomPicking } from "./use-atom-picking";
import { MolstarViewer } from "@/components/molcraft-molstar/molstar-viewer";
import { MeasureOverlay } from "@/components/molcraft-molstar/measure-overlay";
import { MeasureToolbar } from "@/components/molcraft-molstar/measure-toolbar";
import {
  useAppStore,
  selectActiveStructure,
  registerToast,
  type LoadedStructure,
} from "@/lib/molcraft/store";
import { executeCommand } from "@/lib/molcraft/commands";
import { parsePdb } from "@/lib/molcraft/structure-utils";
import { toast as sonnerToast } from "sonner";

interface StructureInfo {
  pdbId: string;
  title: string;
  methods: string[];
  resolution: number | null;
  molecularWeight: number | null;
  chainCount: number;
  ligands: Array<{ compId: string; name: string }>;
  polymers?: Array<{
    entityId: string;
    chains: string[];
    authChains: string[];
    sequenceLength: number;
    description: string;
    organism: string;
    entityType: string;
  }>;
  nonpolymers?: Array<{
    entityId: string;
    compId: string;
    name: string;
    formulaWeight: number | null;
  }>;
}

export function StructureAnalysisView() {
  const activeStructure = useAppStore(selectActiveStructure);
  const structures = useAppStore((s) => s.structures);
  const commandLog = useAppStore((s) => s.commandLog);
  const viewerBgDark = useAppStore((s) => s.viewerBgDark);
  const viewer = useAppStore((s) => s.viewer);
  const ready = useAppStore((s) => s.ready);
  const pendingPdbId = useAppStore((s) => s.pendingPdbId);
  // Picking-mode cursor: when the user enables Distance/Angle click-to-pick,
  // show a crosshair cursor over the 3D viewport so the interaction is obvious.
  const measureMode = useAppStore((s) => s.measureMode);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  // Desktop vs. mobile layout. We use a JS media-query check (not CSS-only
  // `hidden lg:flex`) so that only ONE MolstarViewer instance is mounted at
  // a time. Two mounted instances (even if one is CSS-hidden) both subscribe
  // to Molstar's click events, causing atom-picking to fire twice and
  // measurements to fail.
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setIsDesktop(mql.matches);
    onChange(); // sync initial
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  // Enable keyboard shortcuts when the viewer is ready
  useAnalysisKeyboardShortcuts(ready);

  // Enable click-to-pick atom selection (Molcraft-style distance/angle measurement)
  useAtomPicking();

  // Listen for shortcut help toggle event (triggered by "?" key)
  useEffect(() => {
    const handler = () => setShortcutHelpOpen((v) => !v);
    window.addEventListener("sa:toggle-shortcut-help", handler);
    return () => window.removeEventListener("sa:toggle-shortcut-help", handler);
  }, []);

  const setPendingPdbId = useAppStore((s) => s.setPendingPdbId);
  const addStructure = useAppStore((s) => s.addStructure);
  const setStructureFileCache = useAppStore((s) => s.setStructureFileCache);
  const setActiveStructure = useAppStore((s) => s.setActiveStructure);
  const toast = useAppStore((s) => s.toast);
  const logCommand = useAppStore((s) => s.logCommand);

  // Auto-load a pending PDB ID (handed off from PdbViewerModal's "Analyze" button)
  // once the Molstar viewer is ready.
  useEffect(() => {
    if (!ready || !viewer || !pendingPdbId) return;
    const id = pendingPdbId.toUpperCase();
    // Don't re-load if already loaded
    if (structures.some((s) => s.id === id)) {
      setPendingPdbId(null);
      setActiveStructure(id);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await executeCommand(viewer, { type: "load_pdb", id });
        if (!res.ok || cancelled) return;
        let pdbText = "";
        try {
          const pdbRes = await fetch(
            `https://files.rcsb.org/download/${id}.pdb`
          );
          if (pdbRes.ok) pdbText = await pdbRes.text();
        } catch {}
        let metadata: LoadedStructure["metadata"] | undefined;
        if (pdbText) {
          // Cache the PDB text so interaction charts (water bridges, etc.)
          // can analyze it without requiring a separate file upload.
          setStructureFileCache(id, pdbText, "pdb");
          try {
            const parsed = parsePdb(pdbText);
            metadata = {
              chains: parsed.chains,
              numAtoms: parsed.numAtoms,
              numResidues: parsed.numResidues,
              title: parsed.title || undefined,
            };
          } catch {}
        }
        addStructure({
          id,
          label: id,
          source: "pdb",
          loadedAt: Date.now(),
          pdbText: pdbText || undefined,
          metadata,
        });
        // Explicitly set as active structure so left panel + charts pick it up
        setActiveStructure(id);
        logCommand({ type: "load_pdb", ok: true, detail: id });
        toast(`Loaded ${id}`, "success");
      } catch (err) {
        toast(`Load failed: ${err}`, "error");
      } finally {
        setPendingPdbId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, viewer, pendingPdbId]);

  // Auto-fetch structure info when the active structure changes
  const primaryId = activeStructure?.id;
  const [structureInfo, setStructureInfo] = useState<StructureInfo | null>(null);
  const lastFetchedId = useRef<string | null>(null);

  useEffect(() => {
    if (!primaryId || !/^[a-zA-Z0-9]{4}$/.test(primaryId)) {
      setStructureInfo(null);
      lastFetchedId.current = null;
      return;
    }
    if (lastFetchedId.current === primaryId) return;
    lastFetchedId.current = primaryId;
    let cancelled = false;
    fetch(`/api/analyze/metadata?id=${primaryId}&interfaces=0`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setStructureInfo({
          pdbId: primaryId.toUpperCase(),
          title: data.entry?.title ?? primaryId,
          methods: data.entry?.methods ?? [],
          resolution: data.entry?.resolution ?? null,
          molecularWeight: data.entry?.molecularWeight ?? null,
          chainCount: data.polymers?.length ?? 0,
          ligands: data.nonpolymers ?? [],
          polymers: data.polymers ?? [],
          nonpolymers: data.nonpolymers ?? [],
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [primaryId]);

  // Wire the store's toast() to sonner
  useEffect(() => {
    registerToast((msg, kind = "default") => {
      switch (kind) {
        case "success":
          sonnerToast.success(msg);
          break;
        case "error":
          sonnerToast.error(msg);
          break;
        case "info":
          sonnerToast.info(msg);
          break;
        default:
          sonnerToast(msg);
      }
    });
  }, []);

  // Shared viewer JSX — used by BOTH desktop (3-pane) and mobile (tabbed).
  // We render a SINGLE MolstarViewer instance to avoid double-subscribing to
  // Molstar's click/selection events (which caused atom-picking to fire twice
  // and measurement to fail). The mobile <MobilePanelSwitcher> receives this
  // same element; React only mounts it once.
  const viewerBlock = (
    <div className={`sa-viewer absolute inset-0 ${viewerBgDark ? "dark-viewer" : ""} ${measureMode !== "off" ? "sa-picking-mode" : ""}`}>
      <div className="sa-viewer-backdrop" />
      <MolstarViewer className="absolute inset-0" />
      {/* 2D canvas overlay — draws measurement lines/spheres/labels on
          top of the 3D viewport. pointer-events:none so clicks pass through. */}
      <MeasureOverlay />
      {/* Loading overlay — shown while the viewer initializes. */}
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="flex flex-col items-center gap-3 bg-claude-surface/80 dark:bg-[#242220]/80 rounded-lg p-4">
            <Box className="h-8 w-8 text-claude-accent animate-pulse" />
            <div className="flex items-center gap-2 text-xs text-claude-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Initializing 3D Viewer...</span>
            </div>
          </div>
        </div>
      )}
      <ViewerOverlay
        structures={structures}
        activeStructure={activeStructure}
        commandLog={commandLog}
        structureInfo={structureInfo}
      />
      <DragDropOverlay
        enabled={ready}
        onFiles={(files) => {
          // Delegate to the toolbar's file upload logic via a custom event
          window.dispatchEvent(
            new CustomEvent("sa:upload-files", { detail: files })
          );
        }}
      />
    </div>
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full w-full flex-col overflow-hidden bg-claude-bg">
        <AnalysisToolbar />
        {/* Responsive layout: we use a JS media-query check to render ONLY ONE
            of the two layout variants. This is critical because MolstarViewer
            is expensive to mount and subscribes to global click/selection
            events — having two mounted instances (even if one is CSS-hidden)
            causes atom-picking subscriptions to fire twice and measurement
            to fail. CSS-only `hidden lg:flex` would mount both; we avoid that. */}
        {isDesktop ? (
          <div className="flex flex-1 min-h-0 w-full">
            <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
              {/* Left: structures + analysis */}
              <ResizablePanel defaultSize="22" minSize="10" maxSize="40">
                <div data-tour="left-panel" className="h-full min-w-0 overflow-hidden">
                  <AnalysisLeftPanel />
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle />
              {/* Center: viewer */}
              <ResizablePanel defaultSize="54" minSize="15">
                <div className="relative h-full min-w-0 overflow-hidden">{viewerBlock}</div>
              </ResizablePanel>
              <ResizableHandle withHandle />
              {/* Right: reports + history */}
              <ResizablePanel defaultSize="24" minSize="10" maxSize="40">
                <div data-tour="right-panel" className="h-full min-w-0 overflow-hidden">
                  <AnalysisRightPanel structureInfo={structureInfo} />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        ) : (
          <div className="flex flex-1 min-h-0 flex-col w-full">
            <MobilePanelSwitcher
              viewerBlock={viewerBlock}
              leftPanel={<AnalysisLeftPanel />}
              rightPanel={<AnalysisRightPanel structureInfo={structureInfo} />}
            />
          </div>
        )}

        <div data-tour="status-bar">
          <AnalysisStatusBar
            structures={structures}
            activeStructure={activeStructure}
            ready={ready}
            commandLog={commandLog}
            viewerBgDark={viewerBgDark}
            onOpenShortcutHelp={() => setShortcutHelpOpen(true)}
            onOpenTour={() => {
              try {
                localStorage.removeItem("pdb-tracker:analysis-tour-seen");
              } catch {}
              window.dispatchEvent(new CustomEvent("sa:open-tour"));
            }}
          />
        </div>
        <ShortcutHelpDialog
          open={shortcutHelpOpen}
          onOpenChange={setShortcutHelpOpen}
        />
        <AnalysisTour />
      </div>
    </TooltipProvider>
  );
}

/** Mobile/tablet panel switcher — 3 tabs: Viewer | Structures | Reports.
 *  Shows only on screens below lg breakpoint (< 1024px). */
function MobilePanelSwitcher({
  viewerBlock,
  leftPanel,
  rightPanel,
}: {
  viewerBlock: React.ReactNode;
  leftPanel: React.ReactNode;
  rightPanel: React.ReactNode;
}) {
  const [tab, setTab] = useState<"viewer" | "structures" | "reports">("viewer");

  return (
    <>
      {/* Tab bar */}
      <div className="sa-tab-row shrink-0">
        <button
          className={`sa-tab-btn ${tab === "viewer" ? "sa-tab-active" : ""}`}
          onClick={() => setTab("viewer")}
        >
          <Microscope className="h-3 w-3" />
          3D Viewer
        </button>
        <button
          className={`sa-tab-btn ${tab === "structures" ? "sa-tab-active" : ""}`}
          onClick={() => setTab("structures")}
        >
          <Activity className="h-3 w-3" />
          Structures
        </button>
        <button
          className={`sa-tab-btn ${tab === "reports" ? "sa-tab-active" : ""}`}
          onClick={() => setTab("reports")}
        >
          <FileText className="h-3 w-3" />
          Reports
        </button>
      </div>
      {/* Tab content — full height */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === "viewer" && viewerBlock}
        {tab === "structures" && (
          <div className="h-full overflow-y-auto sa-scroll">{leftPanel}</div>
        )}
        {tab === "reports" && (
          <div className="h-full overflow-y-auto sa-scroll">{rightPanel}</div>
        )}
      </div>
    </>
  );
}

/** Bottom status bar — shows live stats: structure count, active structure,
 *  viewer status, last command, background mode. */
function AnalysisStatusBar({
  structures,
  activeStructure,
  ready,
  commandLog,
  viewerBgDark,
  onOpenShortcutHelp,
  onOpenTour,
}: {
  structures: LoadedStructure[];
  activeStructure: LoadedStructure | null;
  ready: boolean;
  commandLog: Array<{ ts: number; type: string; ok: boolean; detail?: string }>;
  viewerBgDark: boolean;
  onOpenShortcutHelp: () => void;
  onOpenTour: () => void;
}) {
  const lastCmd = commandLog[0];
  const totalAtoms = structures.reduce(
    (sum, s) => sum + (s.metadata?.numAtoms ?? 0),
    0
  );
  const totalResidues = structures.reduce(
    (sum, s) => sum + (s.metadata?.numResidues ?? 0),
    0
  );

  return (
    <div className="sa-status-bar flex shrink-0 items-center gap-3 border-t border-claude-border bg-claude-surface px-3 py-1 text-[10px] text-claude-text-secondary">
      {/* Viewer status */}
      <span className="flex items-center gap-1">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            ready ? "bg-green-500 animate-pulse" : "bg-claude-text-muted"
          }`}
        />
        <span className="font-medium">
          {ready ? "Viewer Ready" : "Viewer Loading..."}
        </span>
      </span>

      <span className="h-3 w-px bg-claude-border" />

      {/* Structure count */}
      <span className="flex items-center gap-1">
        <Box className="h-3 w-3" />
        <span className="font-mono font-semibold text-claude-text">
          {structures.length}
        </span>
        <span>structure{structures.length !== 1 ? "s" : ""}</span>
      </span>

      {/* Active structure */}
      {activeStructure && (
        <>
          <span className="h-3 w-px bg-claude-border" />
          <span className="flex items-center gap-1">
            <span className="text-claude-text-muted">Active:</span>
            <span className="font-mono font-semibold text-claude-accent">
              {activeStructure.label}
            </span>
          </span>
        </>
      )}

      {/* Atoms / Residues */}
      {totalAtoms > 0 && (
        <>
          <span className="h-3 w-px bg-claude-border" />
          <span className="flex items-center gap-1">
            <span className="text-claude-text-muted">Atoms:</span>
            <span className="font-mono">{totalAtoms.toLocaleString()}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-claude-text-muted">Residues:</span>
            <span className="font-mono">{totalResidues.toLocaleString()}</span>
          </span>
        </>
      )}

      {/* Background mode */}
      <span className="ml-auto flex items-center gap-2">
        <span className="flex items-center gap-1">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              viewerBgDark ? "bg-indigo-400" : "bg-amber-400"
            }`}
          />
          <span>{viewerBgDark ? "Dark BG" : "Light BG"}</span>
        </span>

        {/* Last command */}
        {lastCmd && (
          <>
            <span className="h-3 w-px bg-claude-border" />
            <span className="flex items-center gap-1">
              <span className="text-claude-text-muted">Last:</span>
              <span
                className={`font-mono ${
                  lastCmd.ok ? "text-green-600" : "text-destructive"
                }`}
              >
                {lastCmd.type}
              </span>
            </span>
          </>
        )}

        {/* Commands count */}
        {commandLog.length > 0 && (
          <>
            <span className="h-3 w-px bg-claude-border" />
            <span className="flex items-center gap-1">
              <Activity className="h-2.5 w-2.5" />
              <span className="font-mono">{commandLog.length}</span>
              <span className="text-claude-text-muted">cmds</span>
            </span>
          </>
        )}

        {/* Shortcut help + Tour buttons */}
        <span className="h-3 w-px bg-claude-border" />
        <button
          onClick={onOpenShortcutHelp}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-claude-text-muted hover:bg-claude-accent-light hover:text-claude-accent transition-colors"
          title="Keyboard shortcuts (?)"
        >
          <kbd className="sa-kbd">?</kbd>
          <span>Help</span>
        </button>
        <button
          onClick={onOpenTour}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-claude-text-muted hover:bg-claude-accent-light hover:text-claude-accent transition-colors"
          title="Start interactive tour"
        >
          <Sparkles className="h-2.5 w-2.5" />
          <span>Tour</span>
        </button>
      </span>
    </div>
  );
}

/** Floating overlay on top of the Molstar viewer — shows structure info,
 *  recent commands, and quick hints. */
function ViewerOverlay({
  structures,
  activeStructure,
  commandLog,
  structureInfo,
}: {
  structures: LoadedStructure[];
  activeStructure: LoadedStructure | null;
  commandLog: Array<{ ts: number; type: string; ok: boolean; detail?: string }>;
  structureInfo: StructureInfo | null;
}) {
  if (structures.length === 0) {
    return (
      <div className="sa-viewer-overlay" style={{ top: 12, left: 12 }}>
        <div className="flex items-center gap-2">
          <Microscope className="h-4 w-4 text-claude-accent" />
          <span className="text-xs font-semibold text-claude-text">
            Structure Analysis
          </span>
        </div>
        <p className="mt-1 text-[10px] text-claude-text-secondary">
          Load a PDB / AlphaFold / EMDB ID or upload a file to begin.
        </p>
        <p className="mt-1 text-[10px] text-claude-text-muted">
          Try examples: 1CBS · 6LU7 · 4HHB
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Top-left: structure info */}
      <div className="sa-viewer-overlay" style={{ top: 12, left: 12 }}>
        <div className="flex items-center gap-2">
          <Box className="h-4 w-4 text-claude-accent" />
          <span className="font-mono text-xs font-bold text-claude-text">
            {activeStructure?.label ?? "—"}
          </span>
          {structureInfo && structureInfo.methods.length > 0 && (
            <span className="rounded bg-claude-accent-light px-1.5 py-0.5 text-[9px] font-medium text-claude-accent">
              {structureInfo.methods.join(", ")}
            </span>
          )}
        </div>
        {structureInfo?.title && (
          <p className="mt-1 text-[10px] text-claude-text-secondary">
            {structureInfo.title}
          </p>
        )}
        {structureInfo && (
          <div className="mt-1.5 flex flex-wrap gap-2 text-[9px] text-claude-text-muted">
            {structureInfo.resolution != null && (
              <span>Res: {structureInfo.resolution} Å</span>
            )}
            <span>Chains: {structureInfo.chainCount}</span>
            {structureInfo.ligands.length > 0 && (
              <span>
                Ligands: {structureInfo.ligands.map((l) => l.compId).join(", ")}
              </span>
            )}
          </div>
        )}
        {activeStructure?.metadata && !structureInfo && (
          <div className="mt-1.5 flex flex-wrap gap-2 text-[9px] text-claude-text-muted">
            {activeStructure.metadata.numResidues != null && (
              <span>Residues: {activeStructure.metadata.numResidues}</span>
            )}
            {activeStructure.metadata.numAtoms != null && (
              <span>Atoms: {activeStructure.metadata.numAtoms}</span>
            )}
            {activeStructure.metadata.chains && (
              <span>
                Chains: {activeStructure.metadata.chains.join(", ")}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Top-right: unified measurement toolbar (shared component — same as
          the modal PdbViewerLite). Always shows all 4 mode buttons in a single
          row (no 2×2 wrap) and inlines the 0/N picking progress. */}
      <div
        className="sa-viewer-overlay"
        style={{ top: 12, right: 12 }}
      >
        <MeasureToolbar pdbId={activeStructure?.id} />
      </div>

      {/* Bottom-left: recent commands */}
      {commandLog.length > 0 && (
        <div
          className="sa-viewer-overlay"
          style={{ bottom: 12, left: 12, maxWidth: 240 }}
        >
          <div className="mb-1 flex items-center gap-1.5">
            <Activity className="h-3 w-3 text-claude-accent" />
            <span className="text-[9px] font-semibold uppercase tracking-wide text-claude-text-secondary">
              Recent
            </span>
          </div>
          <div className="space-y-0.5">
            {commandLog.slice(0, 5).map((cmd, i) => (
              <div key={i} className="flex items-center gap-1 text-[9px]">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    cmd.ok ? "bg-green-500" : "bg-destructive"
                  }`}
                />
                <span className="font-mono text-claude-text">{cmd.type}</span>
                {cmd.detail && (
                  <span className="truncate text-claude-text-muted">
                    {cmd.detail}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bottom-right: keyboard shortcuts hint */}
      <div
        className="sa-viewer-overlay"
        style={{ bottom: 12, right: 12, maxWidth: 200 }}
      >
        <div className="mb-1 flex items-center gap-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-claude-text-secondary">
            Shortcuts
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[9px] text-claude-text-muted">
          <span><kbd className="sa-kbd">S</kbd> Spin</span>
          <span><kbd className="sa-kbd">R</kbd> Reset</span>
          <span><kbd className="sa-kbd">F</kbd> Fit</span>
          <span><kbd className="sa-kbd">P</kbd> Snapshot</span>
          <span><kbd className="sa-kbd">B</kbd> Background</span>
          <span><kbd className="sa-kbd">C</kbd> Color</span>
          <span><kbd className="sa-kbd">1-5</kbd> Repr.</span>
          <span><kbd className="sa-kbd">Esc</kbd> Clear</span>
        </div>
      </div>
    </>
  );
}
