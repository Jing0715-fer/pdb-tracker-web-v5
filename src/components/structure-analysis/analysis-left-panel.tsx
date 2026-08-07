"use client";

/**
 * Structure Analysis left panel — two tabs:
 *  1. Structures: PyMOL-style loaded-structure list with inline controls
 *  2. Analysis: 24-chart catalog grouped into 6 categories with search
 *
 * Ported from Molcraft's unified-left-panel.tsx, restyled with
 * pdb-tracker-web-v4's Claude/terracotta theme.
 */
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Layers,
  Activity,
  Eye,
  EyeOff,
  X,
  ChevronRight,
  Search,
  Palette,
  Zap,
  Ruler,
  LayoutDashboard,
  GitCompare,
  BarChart3,
  Spline,
  AlignLeft,
  Grid3x3,
  Link2,
  Sigma,
  Droplets,
  Atom,
  Network,
  Target,
  Fingerprint,
  Boxes,
  Pill,
  FlaskConical,
  SunMedium,
  CircleDashed,
  ShieldCheck,
  Loader2,
  Trash2,
  Star,
  Clock,
  MousePointerClick,
  CornerDownLeft,
  Triangle,
  Download,
  Tag,
  FileJson,
  FileSpreadsheet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useAppStore,
  selectActiveStructure,
  type LoadedStructure,
} from "@/lib/molcraft/store";
import { executeCommand } from "@/lib/molcraft/commands";
import type { LlmCommand, ResidueRef } from "@/lib/molcraft/command-schema";
import { useRunCommand } from "./use-run-command";
import { SequenceViewer } from "./sequence-viewer";
import { StructureInfoPanel } from "./structure-info-panel";
import { StructureAlignmentPanel } from "./structure-alignment-panel";
import { PresetManager } from "./preset-manager";

// Lazy-loaded chart components
import { RamachandranPlot } from "@/components/charts/ramachandran-plot";
import { BfactorChart } from "@/components/charts/bfactor-chart";
import { InteractionNetwork } from "@/components/charts/interaction-network";
import { SequenceAlignment } from "@/components/charts/sequence-alignment";
import { RmsdMatrix } from "@/components/charts/rmsd-matrix";
import { SasaChart } from "@/components/charts/sasa-chart";
import { DisulfideChart } from "@/components/charts/disulfide-chart";
import { SecondaryStructureChart } from "@/components/charts/secondary-structure-chart";
import { AromaticStackingChart } from "@/components/charts/aromatic-stacking-chart";
import { WaterBridgesChart } from "@/components/charts/water-bridges-chart";
import { MetalCoordinationChart } from "@/components/charts/metal-coordination-chart";
import { StructureValidationChart } from "@/components/charts/structure-validation-chart";
import { BindingPocketChart } from "@/components/charts/binding-pocket-chart";
import { OligomerAnalysisChart } from "@/components/charts/oligomer-analysis-chart";
import { LigandInteractionsChart } from "@/components/charts/ligand-interactions-chart";
import { ElectrostaticChart } from "@/components/charts/electrostatic-chart";
import { ContactMapChart } from "@/components/charts/contact-map-chart";
import { SurfaceResiduesChart } from "@/components/charts/surface-residues-chart";
import { StructureOverviewDashboard } from "@/components/charts/structure-overview-dashboard";
import { StructureComparisonDashboard } from "@/components/charts/structure-comparison-dashboard";
import { DruggabilityChart } from "@/components/charts/druggability-chart";
import { ApbsSurfaceChart } from "@/components/charts/apbs-surface-chart";
import { ScreeningChart } from "@/components/charts/screening-chart";
import { PocketDetectionChart } from "@/components/charts/pocket-detection-chart";

type TabId = "structures" | "measure" | "analysis";

// Chart ID to label mapping (for preset display)
const ALL_CHART_LABELS: Record<string, string> = {
  overview: "Overview Dashboard",
  comparison: "Structure Comparison",
  rama: "Ramachandran",
  bfactor: "B-factor",
  ss: "Secondary Structure",
  seqalign: "Sequence Alignment",
  rmsd: "RMSD Matrix",
  disulfide: "Disulfide Bonds",
  aromatic: "Aromatic Stacking",
  water: "Water Bridges",
  metal: "Metal Coordination",
  contactmap: "Contact Map",
  interaction: "Interaction Network",
  pocket: "Binding Pocket",
  ligand: "Ligand Interactions",
  oligomer: "Oligomer Analysis",
  druggability: "Druggability",
  apbs_surface: "APBS Electrostatic",
  screening: "Virtual Screening",
  detect_pockets: "Multi-Pocket Detection",
  sasa: "SASA",
  surface: "Surface Residues",
  electrostatic: "Electrostatic",
  validation: "Structure Validation",
};

export function AnalysisLeftPanel() {
  const [tab, setTab] = useState<TabId>("structures");
  const structures = useAppStore((s) => s.structures);
  const activeStructureId = useAppStore((s) => s.activeStructureId);

  return (
    <div className="flex h-full flex-col bg-claude-surface">
      {/* Active structure banner */}
      {structures.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-claude-border bg-claude-accent-light/50 px-3 py-1.5">
          <Activity className="h-3 w-3 text-claude-accent" />
          <span className="text-[10px] font-medium uppercase tracking-wide text-claude-text-secondary">
            Active
          </span>
          <Badge variant="secondary" className="ml-auto font-mono text-[10px]">
            {activeStructureId
              ? structures.find((s) => s.id === activeStructureId)?.label ?? "—"
              : structures[0]?.label ?? "—"}
          </Badge>
        </div>
      )}

      {/* Tab row */}
      <div className="sa-tab-row shrink-0">
        <button
          className={`sa-tab-btn ${tab === "structures" ? "sa-tab-active" : ""}`}
          onClick={() => setTab("structures")}
        >
          <Layers className="h-3 w-3" />
          Structures
          {structures.length > 0 && (
            <Badge variant="outline" className="ml-0.5 px-1 py-0 text-[10px]">
              {structures.length}
            </Badge>
          )}
        </button>
        <button
          className={`sa-tab-btn ${tab === "measure" ? "sa-tab-active" : ""}`}
          onClick={() => setTab("measure")}
        >
          <Ruler className="h-3 w-3" />
          Measure
        </button>
        <button
          className={`sa-tab-btn ${tab === "analysis" ? "sa-tab-active" : ""}`}
          onClick={() => setTab("analysis")}
        >
          <Activity className="h-3 w-3" />
          Analysis
        </button>
      </div>

      <ScrollArea className="sa-scroll flex-1 min-h-0">
        {tab === "structures" && <StructuresTab />}
        {tab === "measure" && <MeasureTab />}
        {tab === "analysis" && <AnalysisTab />}
      </ScrollArea>
    </div>
  );
}

// ============================================================
// Structures Tab
// ============================================================
function StructuresTab() {
  const structures = useAppStore((s) => s.structures);
  const removeStructure = useAppStore((s) => s.removeStructure);
  const clearStructures = useAppStore((s) => s.clearStructures);
  const activeStructureId = useAppStore((s) => s.activeStructureId);
  const setActiveStructure = useAppStore((s) => s.setActiveStructure);
  const updateStructureStyle = useAppStore((s) => s.updateStructureStyle);
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const [hiddenSet, setHiddenSet] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [aligning, setAligning] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeStructureId) setOpenId(activeStructureId);
  }, [activeStructureId]);

  const toggleVisibility = async (id: string) => {
    if (!viewer) return;
    try {
      const plugin = viewer.plugin;
      const structs = plugin.managers.structure.hierarchy.current.structures;
      const idx = structures.findIndex((s) => s.id === id);
      if (idx < 0 || idx >= structs.length) return;
      plugin.managers.structure.hierarchy.toggleVisibility([structs[idx]]);
      setHiddenSet((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } catch (err) {
      toast(`Toggle failed: ${err}`, "error");
    }
  };

  const closeStructure = async (id: string) => {
    if (!viewer) return;
    try {
      const plugin = viewer.plugin;
      const structs = plugin.managers.structure.hierarchy.current.structures;
      // BUG FIX: previously this used index-based matching (idx in the store's
      // structures array == idx in Molstar's structs array), which breaks when
      // structures are added/removed in a different order. Instead, match by
      // the structure's label (which is the PDB ID / dataLabel set during load).
      const target = structures.find((s) => s.id === id);
      const targetLabel = target?.label ?? id;
      // Find the Molstar hierarchy structure whose label matches.
      // Molstar sets the label from dataLabel (loadStructureFromData) or the
      // PDB ID (loadPdb). We try exact match, then case-insensitive, then
      // includes-match as fallbacks.
      let molStruct = structs.find((s: any) => {
        const label = s?.cell?.obj?.label ?? s?.cell?.transform?.tags?.[0] ?? "";
        return label === targetLabel || label.toUpperCase() === targetLabel.toUpperCase();
      });
      if (!molStruct) {
        // Fallback: find by includes-match (label might have extra suffix)
        molStruct = structs.find((s: any) => {
          const label = s?.cell?.obj?.label ?? "";
          return label.toUpperCase().includes(targetLabel.toUpperCase());
        });
      }
      if (molStruct) {
        plugin.managers.structure.hierarchy.remove(molStruct);
      }
      // Also remove from the store (this updates activeStructureId if needed)
      removeStructure(id);
      // Clear measurements + interactionLines that belonged to this structure
      // (they reference atom coords from this structure's PDB text)
      toast(`Removed ${id}`, "info");
    } catch (err) {
      // Even if Molstar removal fails, still remove from the store so the UI
      // updates. The Molstar structure will be cleaned up on viewer dispose.
      removeStructure(id);
      toast(`Removed ${id} (Molstar cleanup skipped)`, "info");
    }
  };

  if (structures.length === 0) {
    return (
      <div className="sa-empty-state p-4">
        <Layers className="h-8 w-8 text-claude-text-muted" />
        <p className="text-xs">No structures loaded</p>
        <p className="text-[10px] text-claude-text-muted">
          Use the toolbar above to load a PDB / AlphaFold / EMDB ID or upload a
          file.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5 p-2">
      {structures.map((s, i) => {
        const isActive = activeStructureId === s.id || (!activeStructureId && i === 0);
        const isOpen = openId === s.id;
        const isHidden = hiddenSet.has(s.id);
        return (
          <div key={s.id}>
            <div
              className={`sa-struct-item ${isActive ? "sa-struct-active" : ""}`}
              onClick={() => {
                setActiveStructure(s.id);
                setOpenId(isOpen ? null : s.id);
              }}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: s.color ?? "#c96442" }}
              />
              <span className="flex-1 truncate font-mono text-[11px] font-medium">
                {s.label}
              </span>
              {s.metadata?.method && (
                <Badge variant="outline" className="px-1 py-0 text-[10px]">
                  {s.metadata.method}
                </Badge>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleVisibility(s.id);
                }}
                className="text-claude-text-muted hover:text-claude-text"
                title={isHidden ? "Show" : "Hide"}
              >
                {isHidden ? (
                  <EyeOff className="h-3 w-3" />
                ) : (
                  <Eye className="h-3 w-3" />
                )}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeStructure(s.id);
                }}
                className="text-claude-text-muted hover:text-destructive"
                title="Remove"
              >
                <X className="h-3 w-3" />
              </button>
            </div>

            {/* Inline expanded controls */}
            {isOpen && (
              <div className="mt-1 space-y-2 rounded-md border border-claude-border bg-claude-bg p-2">
                {s.metadata && (
                  <div className="grid grid-cols-2 gap-1 text-[11px]">
                    {s.metadata.title && (
                      <div className="col-span-2 truncate text-claude-text-secondary">
                        <span className="font-medium">Title:</span>{" "}
                        {s.metadata.title}
                      </div>
                    )}
                    {s.metadata.chains && (
                      <div className="text-claude-text-secondary">
                        <span className="font-medium">Chains:</span>{" "}
                        {s.metadata.chains.join(", ")}
                      </div>
                    )}
                    {s.metadata.numResidues != null && (
                      <div className="text-claude-text-secondary">
                        <span className="font-medium">Residues:</span>{" "}
                        {s.metadata.numResidues}
                      </div>
                    )}
                    {s.metadata.numAtoms != null && (
                      <div className="text-claude-text-secondary">
                        <span className="font-medium">Atoms:</span>{" "}
                        {s.metadata.numAtoms}
                      </div>
                    )}
                    {s.metadata.resolution != null && (
                      <div className="text-claude-text-secondary">
                        <span className="font-medium">Res:</span>{" "}
                        {s.metadata.resolution} Å
                      </div>
                    )}
                  </div>
                )}
                {/* Representation */}
                <div>
                  <Label className="mb-1 block text-[11px] text-claude-text-secondary">
                    Representation
                  </Label>
                  <Select
                    value={s.style?.representation ?? "cartoon"}
                    onValueChange={(v) =>
                      updateStructureStyle(s.id, {
                        representation: v as LoadedStructure["style"] extends infer T
                          ? T extends { representation: infer R }
                            ? R
                            : never
                          : never,
                      })
                    }
                  >
                    <SelectTrigger className="h-7 text-[10px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["cartoon", "stick", "line", "sphere", "surface"].map(
                        (r) => (
                          <SelectItem key={r} value={r} className="text-[10px]">
                            {r}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>
                {/* Color scheme */}
                <div>
                  <Label className="mb-1 block text-[11px] text-claude-text-secondary">
                    Color scheme
                  </Label>
                  <Select
                    value={s.style?.colorScheme ?? "spectrum"}
                    onValueChange={(v) =>
                      updateStructureStyle(s.id, {
                        colorScheme: v as LoadedStructure["style"] extends infer T
                          ? T extends { colorScheme: infer R }
                            ? R
                            : never
                          : never,
                      })
                    }
                  >
                    <SelectTrigger className="h-7 text-[10px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        "chain",
                        "element",
                        "secondary",
                        "single",
                        "spectrum",
                        "bfactor",
                        "residue",
                        "charge",
                      ].map((c) => (
                        <SelectItem key={c} value={c} className="text-[10px]">
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {s.alignRmsd != null && (
                  <div className="rounded bg-claude-accent-light px-1.5 py-1 text-[11px] text-claude-accent">
                    Aligned: RMSD {s.alignRmsd.toFixed(2)} Å
                    {s.alignTmScore != null &&
                      ` · TM ${s.alignTmScore.toFixed(3)}`}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {structures.length > 1 && (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2 h-7 w-full text-[10px] text-claude-text-muted hover:text-destructive"
          onClick={() => clearStructures()}
        >
          <Trash2 className="h-3 w-3" />
          Clear all
        </Button>
      )}

      {/* Sequence viewer — shown when a structure with PDB text is loaded */}
      {structures.length > 0 && (
        <div className="mt-3 border-t border-claude-border pt-2">
          <SequenceViewer />
        </div>
      )}

      {/* Structure info panel — full RCSB metadata */}
      {structures.length > 0 && (
        <div className="mt-3 border-t border-claude-border pt-2">
          <StructureInfoPanel />
        </div>
      )}

      {/* Structure alignment panel — shown when 2+ structures loaded */}
      <div className="mt-3 border-t border-claude-border pt-2">
        <StructureAlignmentPanel />
      </div>
    </div>
  );
}

// ============================================================
// Measure Tab
// ============================================================
function MeasureTab() {
  const { run, busy } = useRunCommand();
  const [a, setA] = useState<ResidueRef>({ chain: "A", resno: 30, atom: "CA" });
  const [b, setB] = useState<ResidueRef>({ chain: "A", resno: 50, atom: "CA" });
  const [c, setC] = useState<ResidueRef>({ chain: "A", resno: 70, atom: "CA" });
  const [d, setD] = useState<ResidueRef>({ chain: "A", resno: 90, atom: "CA" });
  const [labelTarget, setLabelTarget] = useState<ResidueRef>({
    chain: "A",
    resno: 30,
  });
  const measurements = useAppStore((s) => s.measurements);
  const removeMeasurement = useAppStore((s) => s.removeMeasurement);
  const clearMeasurements = useAppStore((s) => s.clearMeasurements);
  const measureMode = useAppStore((s) => s.measureMode);
  const setMeasureMode = useAppStore((s) => s.setMeasureMode);
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  // For export filename + labeling
  const activeStructureId = useAppStore((s) => s.activeStructureId);
  const structures = useAppStore((s) => s.structures);
  const activeStructure = structures.find((s) => s.id === activeStructureId);
  // Live picking progress (0/2 → 1/2 → 2/2) for the indicator badge
  const measureProgress = useAppStore((s) => s.measureProgress);

  const isPicking = measureMode !== "off";

  // Clear all measurements (both store + Molstar measurement manager)
  const handleClearAll = () => {
    clearMeasurements();
    if (viewer) {
      try {
        viewer.plugin.managers.structure.measurement.clear();
      } catch {
        // ignore
      }
    }
    toast("Measurements cleared", "info");
  };

  // Export measurements as JSON (full detail) or CSV (tabular)
  const handleExportJSON = () => {
    if (measurements.length === 0) {
      toast("No measurements to export", "error");
      return;
    }
    const payload = {
      exportedAt: new Date().toISOString(),
      structure: activeStructure?.id ?? "unknown",
      measurements: measurements.map((m) => ({
        id: m.id,
        mode: m.mode,
        label: m.label,
        detail: m.detail,
        timestamp: new Date(m.ts).toISOString(),
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `measurements-${activeStructure?.id ?? "export"}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${measurements.length} measurement(s) as JSON`, "success");
  };

  const handleExportCSV = () => {
    if (measurements.length === 0) {
      toast("No measurements to export", "error");
      return;
    }
    const header = "id,mode,label,detail,timestamp_iso\n";
    const rows = measurements
      .map(
        (m) =>
          `${m.id},${m.mode},"${m.label.replace(/"/g, '""')}","${m.detail.replace(/"/g, '""')}",${new Date(
            m.ts
          ).toISOString()}`
      )
      .join("\n");
    const csv = header + rows + "\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `measurements-${activeStructure?.id ?? "export"}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${measurements.length} measurement(s) as CSV`, "success");
  };

  return (
    <div className="space-y-2 p-2">
      {/* ── Click-to-Pick Mode (Molcraft-style) ── */}
      <div className="rounded-md border border-claude-border bg-claude-bg/50 p-2 space-y-1.5">
        <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-claude-text-secondary">
          <MousePointerClick className="h-3 w-3" />
          Click-to-Pick Mode
        </div>
        <p className="text-[11px] text-claude-text-muted leading-relaxed">
          Enable a mode below, then click atoms in the 3D viewer to measure.
        </p>
        <div className="grid grid-cols-2 gap-1">
          <Button
            size="sm"
            variant={measureMode === "distance" ? "default" : "outline"}
            className={`h-7 text-[10px] gap-1 transition-all duration-150 ${
              measureMode === "distance"
                ? "bg-claude-accent text-white border-claude-accent shadow-sm shadow-claude-accent/30"
                : "hover:border-claude-accent/50 hover:bg-claude-accent-light/20"
            }`}
            disabled={!viewer}
            onClick={() =>
              setMeasureMode(measureMode === "distance" ? "off" : "distance")
            }
          >
            <Ruler className="h-3 w-3" />
            Distance
          </Button>
          <Button
            size="sm"
            variant={measureMode === "angle" ? "default" : "outline"}
            className={`h-7 text-[10px] gap-1 transition-all duration-150 ${
              measureMode === "angle"
                ? "bg-claude-accent text-white border-claude-accent shadow-sm shadow-claude-accent/30"
                : "hover:border-claude-accent/50 hover:bg-claude-accent-light/20"
            }`}
            disabled={!viewer}
            onClick={() => setMeasureMode(measureMode === "angle" ? "off" : "angle")}
          >
            <Triangle className="h-3 w-3" />
            Angle
          </Button>
          <Button
            size="sm"
            variant={measureMode === "dihedral" ? "default" : "outline"}
            className={`h-7 text-[10px] gap-1 transition-all duration-150 ${
              measureMode === "dihedral"
                ? "bg-claude-accent text-white border-claude-accent shadow-sm shadow-claude-accent/30"
                : "hover:border-claude-accent/50 hover:bg-claude-accent-light/20"
            }`}
            disabled={!viewer}
            onClick={() => setMeasureMode(measureMode === "dihedral" ? "off" : "dihedral")}
          >
            <Sigma className="h-3 w-3" />
            Dihedral
          </Button>
          <Button
            size="sm"
            variant={measureMode === "label" ? "default" : "outline"}
            className={`h-7 text-[10px] gap-1 transition-all duration-150 ${
              measureMode === "label"
                ? "bg-claude-accent text-white border-claude-accent shadow-sm shadow-claude-accent/30"
                : "hover:border-claude-accent/50 hover:bg-claude-accent-light/20"
            }`}
            disabled={!viewer}
            onClick={() => setMeasureMode(measureMode === "label" ? "off" : "label")}
          >
            <Tag className="h-3 w-3" />
            Label
          </Button>
        </div>
        {isPicking && (
          <div className="flex items-center gap-1.5 text-[11px] text-claude-accent bg-claude-accent-light/30 rounded px-1.5 py-1 border border-claude-accent/20">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-claude-accent opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-claude-accent" />
            </span>
            <span className="font-medium">
              Picking atoms
            </span>
            <span className="font-mono font-bold text-claude-accent bg-claude-accent-light/50 rounded px-1 py-0.5 text-[10px]">
              {measureProgress.picked}/{measureProgress.needed}
            </span>
            <span className="text-claude-text-muted text-[11px]">
              {measureProgress.picked === 0
                ? `click ${measureProgress.needed} atom${measureProgress.needed > 1 ? "s" : ""}`
                : measureProgress.picked < measureProgress.needed
                ? `${measureProgress.needed - measureProgress.picked} more…`
                : "done"}
            </span>
            <button
              onClick={() => setMeasureMode("off")}
              className="ml-auto text-claude-text-muted hover:text-destructive transition-colors px-1"
              title="Cancel picking"
            >
              cancel
            </button>
          </div>
        )}
      </div>

      <div className="my-1 h-px bg-claude-border" />

      {/* ── Manual residue input ── */}
      <div className="rounded-md border border-claude-border p-2 space-y-1">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-claude-text-secondary">
          Manual Distance
        </div>
        <ResidueInput label="Atom A" value={a} onChange={setA} />
        <ResidueInput label="Atom B" value={b} onChange={setB} />
        <Button
          size="sm"
          className="h-7 w-full text-[11px]"
          disabled={busy}
          onClick={() => run({ type: "measure_distance", a, b })}
        >
          Measure Distance
        </Button>
      </div>

      <div className="my-1 h-px bg-claude-border" />

      {/* ── Manual angle input ── */}
      <div className="rounded-md border border-claude-border p-2 space-y-1">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-claude-text-secondary">
          Manual Angle
        </div>
        <ResidueInput label="Atom A" value={a} onChange={setA} />
        <ResidueInput label="Atom B (vertex)" value={b} onChange={setB} />
        <ResidueInput label="Atom C" value={c} onChange={setC} />
        <Button
          size="sm"
          className="h-7 w-full text-[11px]"
          disabled={busy}
          onClick={() => run({ type: "measure_angle", a, b, c })}
        >
          Measure Angle
        </Button>
      </div>

      <div className="my-1 h-px bg-claude-border" />

      {/* ── Manual dihedral input ── */}
      <div className="rounded-md border border-claude-border p-2 space-y-1">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-claude-text-secondary">
          Manual Dihedral
        </div>
        <ResidueInput label="Atom A" value={a} onChange={setA} />
        <ResidueInput label="Atom B" value={b} onChange={setB} />
        <ResidueInput label="Atom C" value={c} onChange={setC} />
        <ResidueInput label="Atom D" value={d} onChange={setD} />
        <Button
          size="sm"
          className="h-7 w-full text-[11px]"
          disabled={busy}
          onClick={() => run({ type: "measure_dihedral", a, b, c, d })}
        >
          Measure Dihedral
        </Button>
      </div>

      <div className="my-1 h-px bg-claude-border" />

      <ResidueInput label="Label target" value={labelTarget} onChange={setLabelTarget} />
      <Button
        size="sm"
        variant="secondary"
        className="h-7 w-full text-[11px]"
        disabled={busy}
        onClick={() => run({ type: "label_residue", target: labelTarget })}
      >
        Add Label
      </Button>

      {/* Measurement history */}
      {measurements.length > 0 && (
        <div className="mt-2 rounded-md border border-claude-border bg-claude-bg p-1.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-claude-text-secondary">
              History ({measurements.length})
            </span>
            <div className="flex items-center gap-0.5">
              <button
                onClick={handleExportCSV}
                className="flex items-center gap-0.5 text-[11px] text-claude-text-muted hover:text-claude-accent transition-colors px-1 py-0.5 rounded hover:bg-claude-accent-light/40"
                title="Export as CSV"
              >
                <FileSpreadsheet className="h-2.5 w-2.5" />
                CSV
              </button>
              <button
                onClick={handleExportJSON}
                className="flex items-center gap-0.5 text-[11px] text-claude-text-muted hover:text-claude-accent transition-colors px-1 py-0.5 rounded hover:bg-claude-accent-light/40"
                title="Export as JSON"
              >
                <FileJson className="h-2.5 w-2.5" />
                JSON
              </button>
              <div className="mx-0.5 h-3 w-px bg-claude-border" />
              <button
                onClick={handleClearAll}
                className="flex items-center gap-0.5 text-[11px] text-claude-text-muted hover:text-destructive transition-colors px-1 py-0.5 rounded hover:bg-destructive/10"
                title="Clear all measurements"
              >
                <Trash2 className="h-2.5 w-2.5" />
              </button>
            </div>
          </div>
          <div className="space-y-0.5 max-h-32 overflow-y-auto sa-scroll">
            <AnimatePresence initial={false}>
              {measurements.map((m) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, height: 0, x: -8 }}
                  animate={{ opacity: 1, height: "auto", x: 0 }}
                  exit={{ opacity: 0, height: 0, x: 8 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="flex items-center gap-1 rounded px-1 py-0.5 text-[11px] hover:bg-claude-accent-light/50 group transition-colors"
                >
                  <span className="font-mono text-claude-text">{m.label}</span>
                  <span className="ml-auto font-mono text-claude-accent font-semibold">{m.detail}</span>
                  <button
                    onClick={() => removeMeasurement(m.id)}
                    className="text-claude-text-muted opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                    title="Remove this measurement"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {measurements.length === 0 && (
        <div className="mt-2 rounded-md border border-dashed border-claude-border/60 bg-claude-bg/30 p-3 text-center">
          <Ruler className="mx-auto h-4 w-4 text-claude-text-muted/50 mb-1" />
          <p className="text-[10px] text-claude-text-muted">No measurements yet</p>
          <p className="text-[11px] text-claude-text-muted/70 mt-0.5">
            Enable a mode above and click atoms in the 3D viewer
          </p>
        </div>
      )}
    </div>
  );
}

function ResidueInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ResidueRef;
  onChange: (v: ResidueRef) => void;
}) {
  return (
    <div className="rounded-md border border-claude-border p-1.5">
      <div className="mb-1 text-[10px] font-medium text-claude-text-secondary">
        {label}
      </div>
      <div className="grid grid-cols-3 gap-1">
        <Input
          value={value.chain ?? ""}
          onChange={(e) =>
            onChange({ ...value, chain: e.target.value || undefined })
          }
          placeholder="A"
          className="h-7 text-xs"
        />
        <Input
          type="number"
          value={value.resno ?? ""}
          onChange={(e) =>
            onChange({
              ...value,
              resno: e.target.value ? Number(e.target.value) : undefined,
            })
          }
          placeholder="145"
          className="h-7 text-xs"
        />
        <Input
          value={value.atom ?? ""}
          onChange={(e) =>
            onChange({ ...value, atom: e.target.value || undefined })
          }
          placeholder="CA"
          className="h-7 text-xs"
        />
      </div>
    </div>
  );
}

// ============================================================
// Analysis Tab
// ============================================================
export function AnalysisTab() {
  return (
    <div className="space-y-2 p-2">
      <ActiveStructureSelector />
      <InteractionVizCard />
      <div data-tour="analysis-charts">
        <AnalysisChartsGrid />
      </div>
    </div>
  );
}

function ActiveStructureSelector() {
  const structures = useAppStore((s) => s.structures);
  const activeStructureId = useAppStore((s) => s.activeStructureId);
  const setActiveStructure = useAppStore((s) => s.setActiveStructure);

  if (structures.length === 0) return null;
  if (structures.length === 1) {
    return (
      <div className="rounded-md border border-claude-border bg-claude-bg p-1.5 text-[10px]">
        <span className="text-claude-text-secondary">Target: </span>
        <span className="font-mono font-semibold">{structures[0].label}</span>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-claude-border bg-claude-bg p-1.5">
      <Label className="mb-1 block text-[11px] text-claude-text-secondary">
        Analysis target
      </Label>
      <div className="flex flex-wrap gap-1">
        {structures.map((s, i) => {
          const isActive =
            activeStructureId === s.id || (!activeStructureId && i === 0);
          return (
            <button
              key={s.id}
              onClick={() => setActiveStructure(s.id)}
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] transition ${
                isActive
                  ? "bg-claude-accent text-white"
                  : "bg-claude-surface hover:bg-claude-accent-light"
              }`}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: s.color ?? "#c96442" }}
              />
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function InteractionVizCard() {
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const activeStructureId = useAppStore((s) => s.activeStructureId);
  const structures = useAppStore((s) => s.structures);
  const structureFileCache = useAppStore((s) => s.structureFileCache);
  const [contacts, setContacts] = useState<Array<{
    chain1: string; residue1: string; chain2: string; residue2: string; distance: number; type: string;
  }>>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [filter, setFilter] = useState("");

  const activeStruct = structures.find((s) => s.id === activeStructureId);
  const activePdbId = activeStruct?.id;
  const isPdbId = activePdbId && /^[a-zA-Z0-9]{4}$/.test(activePdbId);
  const hasFileCache = activePdbId && structureFileCache?.[activePdbId];

  // Detect ligand compId from the structure's metadata or RCSB data
  const [ligandCompId, setLigandCompId] = useState<string>("");
  useEffect(() => {
    if (!activePdbId) { setLigandCompId(""); return; }
    // Try to fetch ligand info from the metadata API
    fetch(`/api/analyze/metadata?id=${activePdbId}&interfaces=0`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const nps = data?.nonpolymers ?? [];
        if (nps.length > 0) {
          // Pick the first non-polymer that's not water
          const lig = nps.find((n: any) => n.compId && n.compId !== "HOH") ?? nps[0];
          if (lig?.compId) setLigandCompId(lig.compId);
        }
      })
      .catch(() => {});
  }, [activePdbId]);

  const fetchContacts = useCallback(async () => {
    if (!activePdbId) return;
    setLoading(true);
    try {
      const allContacts: typeof contacts = [];

      // Helper to run a recipe and parse contacts
      const runRecipe = async (recipe: string, params: Record<string, unknown>, typeLabel: string) => {
        const body: Record<string, unknown> = { recipe, params };
        if (isPdbId) {
          body.pdbId = activePdbId;
        } else if (hasFileCache) {
          body.fileContent = structureFileCache[activePdbId].content;
          body.fileFormat = structureFileCache[activePdbId].format;
        } else {
          return;
        }
        try {
          const res = await fetch("/api/analyze/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) return;
          const json = await res.json();
          const data = json.data;
          if (!data || data.error) return;

          // Parse recipe-specific contact formats
          if (recipe === "ligand_interactions") {
            const rawContacts = data?.ligand_contacts ?? data?.contacts ?? [];
            for (const c of rawContacts) {
              allContacts.push({
                chain1: String(c.chain ?? c.chain_id ?? ""),
                residue1: `${c.ligand_resno ?? 1}${ligandCompId}`,
                chain2: String(c.chain ?? c.chain_id ?? ""),
                residue2: `${c.resno}${c.resname ?? c.residue_name ?? ""}`,
                distance: Number(c.distance ?? 0),
                type: String(c.type ?? typeLabel),
              });
            }
          } else if (recipe === "hbonds") {
            // hbonds recipe returns: {hbonds: [{resname1, resno1, chain1, atom1, resname2, resno2, chain2, atom2, distance}]}
            const rawHbonds = data?.hbonds ?? [];
            for (const c of rawHbonds) {
              allContacts.push({
                chain1: String(c.chain1 ?? c.chain ?? ""),
                residue1: `${c.resno1 ?? c.resno ?? ""}${c.resname1 ?? c.resname ?? ""}`,
                chain2: String(c.chain2 ?? c.chain ?? ""),
                residue2: `${c.resno2 ?? c.resno ?? ""}${c.resname2 ?? c.resname ?? ""}`,
                distance: Number(c.distance ?? 0),
                type: "hbond",
              });
            }
          } else if (recipe === "salt_bridges") {
            const rawSb = data?.salt_bridges ?? data?.contacts ?? [];
            for (const c of rawSb) {
              allContacts.push({
                chain1: String(c.chain1 ?? c.chain ?? ""),
                residue1: `${c.resno1 ?? c.resno ?? ""}${c.resname1 ?? c.resname ?? ""}`,
                chain2: String(c.chain2 ?? c.chain ?? ""),
                residue2: `${c.resno2 ?? c.resno ?? ""}${c.resname2 ?? c.resname ?? ""}`,
                distance: Number(c.distance ?? 0),
                type: "salt-bridge",
              });
            }
          } else if (recipe === "hydrophobic_contacts") {
            const rawHp = data?.hydrophobic_contacts ?? data?.contacts ?? [];
            for (const c of rawHp) {
              allContacts.push({
                chain1: String(c.chain1 ?? c.chain ?? ""),
                residue1: `${c.resno1 ?? c.resno ?? ""}${c.resname1 ?? c.resname ?? ""}`,
                chain2: String(c.chain2 ?? c.chain ?? ""),
                residue2: `${c.resno2 ?? c.resno ?? ""}${c.resname2 ?? c.resname ?? ""}`,
                distance: Number(c.distance ?? 0),
                type: "hydrophobic",
              });
            }
          }
        } catch {
          // ignore individual recipe errors
        }
      };

      // Run all interaction recipes in parallel
      const recipes: Array<[string, Record<string, unknown>, string]> = [];
      if (ligandCompId) {
        recipes.push(["ligand_interactions", { ligandCompId: ligandCompId.toUpperCase(), cutoff: 5.0 }, "ligand_contact"]);
      }
      recipes.push(["hbonds", { chain1: "A", chain2: "A", distanceCutoff: 0.4, angleTolerance: 20.0 }, "hbond"]);
      recipes.push(["salt_bridges", { chain1: "A", chain2: "A", cutoff: 4.0 }, "salt-bridge"]);
      recipes.push(["hydrophobic_contacts", { chain1: "A", chain2: "A", cutoff: 4.5 }, "hydrophobic"]);

      await Promise.all(recipes.map(([r, p, label]) => runRecipe(r, p, label)));

      setContacts(allContacts);
      setFetched(true);
      toast(`Loaded ${allContacts.length} interactions`, "success");
    } catch {
      toast("Failed to load interactions", "error");
    } finally {
      setLoading(false);
    }
  }, [activePdbId, ligandCompId, isPdbId, hasFileCache, structureFileCache, toast]);

  // Auto-fetch when a structure is loaded
  useEffect(() => {
    if (activePdbId && !fetched) {
      fetchContacts();
    }
    if (!activePdbId) {
      setContacts([]);
      setFetched(false);
    }
  }, [activePdbId, fetched, fetchContacts]);

  const handleFocusContact = useCallback(async (contact: typeof contacts[0]) => {
    if (!viewer) return;
    try {
      // Parse residue info: "123ALA" → resno=123, compId=ALA
      const m2 = contact.residue2.match(/^(\d+)([A-Z]{3})/);
      const m1 = contact.residue1.match(/^(\d+)([A-Z]{3})/);
      if (!m2) {
        toast("Could not parse residue info", "error");
        return;
      }
      const resno2 = parseInt(m2[1]);
      const compId2 = m2[2];

      // Focus on the protein residue
      await executeCommand(viewer, {
        type: "focus_residue",
        chain: contact.chain2,
        resno: resno2,
        compId: compId2,
      });

      // Try to draw a distance line between the ligand and the protein residue.
      // The ligand (residue1) is a non-polymer — its auth_asym_id may differ
      // from the protein chain. We pass only compId + resno for the ligand
      // (no chain) so lociFromResidue matches by compId alone.
      if (m1) {
        const resno1 = parseInt(m1[1]);
        const compId1 = m1[2];
        try {
          await executeCommand(viewer, {
            type: "measure_distance",
            // Ligand: match by compId + resno only (chain may be different)
            a: { resno: resno1, compId: compId1 },
            // Protein residue: full spec
            b: { chain: contact.chain2, resno: resno2, compId: compId2 },
          });
        } catch {
          // Distance line is best-effort — focus is the primary action
        }
      }

      toast(`${compId2}${resno2} (${contact.chain2})`, "info");
    } catch (err) {
      toast("Focus failed", "error");
    }
  }, [viewer, toast]);

  // Hover highlight: briefly highlight the residue in the 3D viewer without
  // moving the camera. Uses lociHighlights which is non-destructive.
  const handleHoverContact = useCallback((contact: typeof contacts[0]) => {
    if (!viewer) return;
    try {
      const m2 = contact.residue2.match(/^(\d+)([A-Z]{3})/);
      if (!m2) return;
      const resno2 = parseInt(m2[1]);
      const compId2 = m2[2];
      const plugin = viewer.plugin;
      // Use structureInteractivity to highlight (not select) the residue
      viewer.structureInteractivity({
        expression: (Q: any) => Q.struct.generator.atomGroups({
          "residue-test": Q.core.logic.and([
            Q.core.rel.eq([Q.struct.atomProperty.macromolecular.auth_seq_id(), resno2]),
            Q.core.rel.eq([Q.struct.atomProperty.macromolecular.label_comp_id(), compId2]),
          ]),
        }),
        action: ["highlight"],
      });
    } catch {
      // best-effort — ignore
    }
  }, [viewer]);

  const handleHoverLeave = useCallback(() => {
    if (!viewer) return;
    try {
      viewer.plugin.managers.interactivity.lociHighlights.clearHighlights();
    } catch {
      // ignore
    }
  }, [viewer]);

  const handleClear = useCallback(() => {
    if (!viewer) return;
    try {
      viewer.plugin.managers.structure.measurement.clear();
      toast("Distance lines cleared", "info");
    } catch {
      // ignore
    }
  }, [viewer, toast]);

  const filtered = filter
    ? contacts.filter(c =>
        c.residue1.includes(filter) || c.residue2.includes(filter) ||
        c.chain1.includes(filter) || c.chain2.includes(filter) ||
        c.type.includes(filter)
      )
    : contacts;

  return (
    <div className="rounded-lg border border-claude-border bg-claude-surface p-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-claude-text">
        <Zap className="h-3.5 w-3.5 text-claude-accent" />
        Interaction List
        {ligandCompId && (
          <span className="text-[11px] text-claude-text-muted font-normal ml-0.5">
            ({ligandCompId})
          </span>
        )}
        {contacts.length > 0 && (
          <Badge variant="secondary" className="ml-auto text-[11px] h-4">
            {filtered.length}/{contacts.length}
          </Badge>
        )}
      </div>

      {/* Type distribution with proportional bars */}
      {contacts.length > 0 && (() => {
        const typeCounts = contacts.reduce((acc, c) => {
          acc[c.type] = (acc[c.type] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        const sorted = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
        const total = contacts.length;
        const typeColors: Record<string, string> = {
          hbond: "bg-blue-400",
          hydrogen_bond: "bg-blue-400",
          hydrophobic: "bg-amber-400",
          aromatic: "bg-purple-400",
          "aromatic-stacking": "bg-purple-400",
          ionic: "bg-red-400",
          "salt-bridge": "bg-red-400",
          "water-bridge": "bg-cyan-400",
          ligand_contact: "bg-claude-accent",
          ligand_proximity: "bg-claude-accent",
          contact: "bg-claude-text-muted",
        };
        return (
          <div className="mb-1.5 space-y-0.5">
            {/* Proportional stacked bar */}
            <div className="flex h-1.5 rounded-full overflow-hidden bg-claude-border/30">
              {sorted.map(([type, count]) => (
                <div
                  key={type}
                  className={`${typeColors[type] || typeColors.contact} transition-all hover:opacity-80`}
                  style={{ width: `${(count / total) * 100}%` }}
                  title={`${type}: ${count} (${((count / total) * 100).toFixed(0)}%)`}
                />
              ))}
            </div>
            {/* Type chips with counts */}
            <div className="flex items-center gap-0.5 flex-wrap">
              {sorted.slice(0, 6).map(([type, count]) => (
                <button
                  key={type}
                  onClick={() => setFilter(filter === type ? "" : type)}
                  className={`flex items-center gap-0.5 text-[10px] px-1 py-0.5 rounded border transition-all ${
                    filter === type
                      ? "bg-claude-accent text-white border-claude-accent"
                      : "bg-claude-bg/50 text-claude-text-muted border-claude-border/40 hover:bg-claude-accent-light/30"
                  }`}
                  title={`${count} ${type} interactions — click to filter`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${typeColors[type] || typeColors.contact}`} />
                  <span className="capitalize">{type.replace(/_/g, " ").substring(0, 6)}</span>
                  <span className="font-mono font-bold">{count}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Search filter */}
      {contacts.length > 0 && (
        <Input
          placeholder="Filter by residue, chain, type…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-6 mb-1.5 text-[10px]"
        />
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-3 text-[10px] text-claude-text-muted">
          <Loader2 className="h-3 w-3 animate-spin mr-1" />
          Loading interactions…
        </div>
      )}

      {/* Empty state */}
      {!loading && contacts.length === 0 && fetched && (
        <div className="text-center py-3 text-[10px] text-claude-text-muted">
          <Zap className="mx-auto h-4 w-4 mb-1 opacity-40" />
          No interactions found for this structure.
        </div>
      )}

      {/* Not fetched yet */}
      {!loading && contacts.length === 0 && !fetched && (
        <div className="text-center py-3 text-[10px] text-claude-text-muted">
          <Zap className="mx-auto h-4 w-4 mb-1 opacity-40" />
          Load a PDB structure to see interactions.
        </div>
      )}

      {/* Contact list */}
      {!loading && filtered.length > 0 && (
        <div className="max-h-56 overflow-y-auto sa-scroll space-y-0.5">
          {filtered.slice(0, 100).map((c, i) => {
            // Color-code by interaction type
            const typeColor = {
              hbond: "text-blue-500 border-blue-300/40 bg-blue-50/50",
              hydrogen_bond: "text-blue-500 border-blue-300/40 bg-blue-50/50",
              hydrophobic: "text-amber-600 border-amber-300/40 bg-amber-50/50",
              aromatic: "text-purple-500 border-purple-300/40 bg-purple-50/50",
              "aromatic-stacking": "text-purple-500 border-purple-300/40 bg-purple-50/50",
              ionic: "text-red-500 border-red-300/40 bg-red-50/50",
              "salt-bridge": "text-red-500 border-red-300/40 bg-red-50/50",
              "water-bridge": "text-cyan-500 border-cyan-300/40 bg-cyan-50/50",
              contact: "text-claude-text-muted border-claude-border/40 bg-claude-surface",
              ligand_contact: "text-claude-accent border-claude-accent/30 bg-claude-accent-light/30",
              ligand_proximity: "text-claude-accent border-claude-accent/30 bg-claude-accent-light/30",
            };
            const colorClass = typeColor[c.type as keyof typeof typeColor] || typeColor.contact;
            return (
              <button
                key={i}
                onClick={() => handleFocusContact(c)}
                onMouseEnter={() => handleHoverContact(c)}
                onMouseLeave={() => handleHoverLeave()}
                className="w-full flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] hover:bg-claude-accent-light/40 hover:shadow-sm transition-all group text-left border border-transparent hover:border-claude-accent/20"
                title={`Click to focus: ${c.residue1} (${c.chain1}) ↔ ${c.residue2} (${c.chain2}) — ${c.distance > 0 ? c.distance.toFixed(1) + 'Å' : 'no distance'}`}
              >
                <span className="font-mono text-claude-text font-semibold group-hover:text-claude-accent transition-colors">
                  {c.residue2}
                </span>
                <span className="text-claude-text-muted text-[10px] group-hover:text-claude-accent/70">
                  {c.chain2}
                </span>
                <span className="text-claude-accent/60 mx-0.5 text-[10px]">←</span>
                <span className="font-mono text-claude-text-muted text-[10px]">
                  {c.residue1}
                </span>
                <span className="ml-auto flex items-center gap-1">
                  {c.distance > 0 && (
                    <span className="font-mono text-claude-text-secondary text-[11px] tabular-nums">
                      {c.distance.toFixed(1)}Å
                    </span>
                  )}
                  <span className={`text-[10px] h-3.5 px-1 rounded border capitalize font-medium ${colorClass}`}>
                    {c.type.replace(/_/g, " ").substring(0, 8)}
                  </span>
                </span>
              </button>
            );
          })}
          {filtered.length > 100 && (
            <div className="text-center text-[11px] text-claude-text-muted py-1 border-t border-claude-border/30 mt-1">
              +{filtered.length - 100} more (use filter to narrow)
            </div>
          )}
        </div>
      )}

      {/* Clear distance lines button */}
      {contacts.length > 0 && (
        <Button
          size="sm"
          variant="outline"
          className="w-full h-6 mt-1.5 text-[11px] gap-1"
          onClick={handleClear}
          disabled={!viewer}
        >
          <Trash2 className="h-2.5 w-2.5" />
          Clear distance lines
        </Button>
      )}
    </div>
  );
}

function AnalysisChartsGrid() {
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const favoriteCharts = useAppStore((s) => s.favoriteCharts);
  const toggleFavoriteChart = useAppStore((s) => s.toggleFavoriteChart);
  const recentCharts = useAppStore((s) => s.recentCharts);
  const addRecentChart = useAppStore((s) => s.addRecentChart);
  const activeAnalysisChart = useAppStore((s) => s.activeAnalysisChart);
  const setActiveAnalysisChart = useAppStore((s) => s.setActiveAnalysisChart);

  const handleChartClick = (chartId: string) => {
    // Toggle: if the same chart is already active, close it; otherwise open it.
    // The chart result renders in the RIGHT panel (Results tab), not inline here.
    if (activeAnalysisChart === chartId) {
      setActiveAnalysisChart(null);
    } else {
      setActiveAnalysisChart(chartId);
      addRecentChart(chartId);
    }
  };

  const categories: Array<{
    title: string;
    color: string;
    accentColor: string;
    charts: Array<{ id: string; label: string; desc: string; icon: React.ReactNode }>;
  }> = [
    {
      title: "Overview",
      color: "text-claude-accent",
      accentColor: "#c96442",
      charts: [
        {
          id: "overview",
          label: "Overview Dashboard",
          desc: "8 analyses in one screen: quality, secondary structure, SASA, etc.",
          icon: <LayoutDashboard className="h-3.5 w-3.5" />,
        },
        {
          id: "comparison",
          label: "Structure Comparison",
          desc: "Compare 2-4 structures across 13 metrics side-by-side",
          icon: <GitCompare className="h-3.5 w-3.5" />,
        },
      ],
    },
    {
      title: "Geometry",
      color: "text-teal-600",
      accentColor: "#2d8f8f",
      charts: [
        {
          id: "rama",
          label: "Ramachandran",
          desc: "φ/ψ dihedral distribution, conformation validity",
          icon: <Activity className="h-3.5 w-3.5" />,
        },
        {
          id: "bfactor",
          label: "B-factor",
          desc: "Atomic thermal motion / model confidence",
          icon: <BarChart3 className="h-3.5 w-3.5" />,
        },
        {
          id: "ss",
          label: "Secondary Structure",
          desc: "α-helix / β-sheet / turn / coil ratio",
          icon: <Spline className="h-3.5 w-3.5" />,
        },
        {
          id: "seqalign",
          label: "Sequence Alignment",
          desc: "Needleman-Wunsch pairwise alignment",
          icon: <AlignLeft className="h-3.5 w-3.5" />,
        },
        {
          id: "rmsd",
          label: "RMSD Matrix",
          desc: "Multi-PDB CA Kabsch superposition RMSD",
          icon: <Grid3x3 className="h-3.5 w-3.5" />,
        },
      ],
    },
    {
      title: "Interactions",
      color: "text-sky-600",
      accentColor: "#0ea5e9",
      charts: [
        {
          id: "disulfide",
          label: "Disulfide Bonds",
          desc: "CYS-CYS SG-SG < 2.5Å covalent links",
          icon: <Link2 className="h-3.5 w-3.5" />,
        },
        {
          id: "aromatic",
          label: "Aromatic Stacking",
          desc: "π-π stacking + cation-π (PHE/TYR/TRP/HIS)",
          icon: <Sigma className="h-3.5 w-3.5" />,
        },
        {
          id: "water",
          label: "Water Bridges",
          desc: "Protein-water-protein H-bond networks",
          icon: <Droplets className="h-3.5 w-3.5" />,
        },
        {
          id: "metal",
          label: "Metal Coordination",
          desc: "Zn/Mg/Ca/Fe coordination geometry",
          icon: <Atom className="h-3.5 w-3.5" />,
        },
        {
          id: "contactmap",
          label: "Contact Map",
          desc: "Inter-chain CA-CA distance heatmap",
          icon: <Grid3x3 className="h-3.5 w-3.5" />,
        },
        {
          id: "interaction",
          label: "Interaction Network",
          desc: "H-bond / salt-bridge / hydrophobic force-directed graph",
          icon: <Network className="h-3.5 w-3.5" />,
        },
      ],
    },
    {
      title: "Ligand & Assembly",
      color: "text-amber-600",
      accentColor: "#c9872e",
      charts: [
        {
          id: "pocket",
          label: "Binding Pocket",
          desc: "Ligand-surrounding residues + volume + classification",
          icon: <Target className="h-3.5 w-3.5" />,
        },
        {
          id: "ligand",
          label: "Ligand Fingerprint",
          desc: "Atomic-level contact fingerprint",
          icon: <Fingerprint className="h-3.5 w-3.5" />,
        },
        {
          id: "oligomer",
          label: "Oligomer Analysis",
          desc: "Oligomer type + interfaces + symmetry",
          icon: <Boxes className="h-3.5 w-3.5" />,
        },
      ],
    },
    {
      title: "Drug Discovery",
      color: "text-pink-600",
      accentColor: "#7c5cbf",
      charts: [
        {
          id: "druggability",
          label: "Druggability",
          desc: "Pocket score + hydrophobic/polar/charge + 3D highlight",
          icon: <Pill className="h-3.5 w-3.5" />,
        },
        {
          id: "apbs_surface",
          label: "APBS Electrostatic",
          desc: "pdb2pqr charge + Debye-Hückel potential + 3D coloring",
          icon: <Zap className="h-3.5 w-3.5" />,
        },
        {
          id: "screening",
          label: "Virtual Screening",
          desc: "Fragment library scoring + ΔG prediction + Ki ranking",
          icon: <FlaskConical className="h-3.5 w-3.5" />,
        },
        {
          id: "detect_pockets",
          label: "Multi-Pocket Detection",
          desc: "Grid-based surface cavity detection + druggability",
          icon: <Target className="h-3.5 w-3.5" />,
        },
      ],
    },
    {
      title: "Quality",
      color: "text-violet-600",
      accentColor: "#8b5cf6",
      charts: [
        {
          id: "sasa",
          label: "SASA",
          desc: "Solvent accessible surface area (freesasa)",
          icon: <CircleDashed className="h-3.5 w-3.5" />,
        },
        {
          id: "surface",
          label: "Surface Residues",
          desc: "Surface-exposed vs buried classification",
          icon: <SunMedium className="h-3.5 w-3.5" />,
        },
        {
          id: "electrostatic",
          label: "Electrostatic",
          desc: "Per-residue net charge + Coulomb interaction energy",
          icon: <Zap className="h-3.5 w-3.5" />,
        },
        {
          id: "validation",
          label: "Structure Validation",
          desc: "Clashes / Ramachandran outliers / missing sidechains",
          icon: <ShieldCheck className="h-3.5 w-3.5" />,
        },
      ],
    },
  ];

  const totalCharts = categories.reduce(
    (sum, cat) => sum + cat.charts.length,
    0
  );

  // Flat list of all charts for favorites/recent lookups
  const allCharts = categories.flatMap((cat) => cat.charts);

  const toggleCollapse = (title: string) => {
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  };

  const filteredCategories = searchQuery.trim()
    ? categories
        .map((cat) => ({
          ...cat,
          charts: cat.charts.filter(
            (c) =>
              c.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
              c.id.toLowerCase().includes(searchQuery.toLowerCase())
          ),
        }))
        .filter((cat) => cat.charts.length > 0)
    : activeFilter
    ? categories.filter((cat) => cat.title === activeFilter)
    : categories;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label className="text-[11px] text-claude-text-secondary shrink-0">
          Charts
        </Label>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-1.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 text-claude-text-muted" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search charts…"
            className="h-6 pl-6 text-[10px]"
          />
        </div>
        <Badge variant="outline" className="shrink-0 text-[11px]">
          {totalCharts}
        </Badge>
      </div>

      {/* Category filter chips (hidden during search) */}
      {!searchQuery && (
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setActiveFilter(null)}
            className={`sa-filter-chip ${activeFilter === null ? "sa-filter-active" : ""}`}
          >
            All
            <Badge variant="outline" className="ml-0.5 px-1 py-0 text-[7px]">
              {totalCharts}
            </Badge>
          </button>
          {categories.map((cat) => (
            <button
              key={cat.title}
              onClick={() => setActiveFilter(activeFilter === cat.title ? null : cat.title)}
              className={`sa-filter-chip ${activeFilter === cat.title ? "sa-filter-active" : ""}`}
              style={activeFilter === cat.title ? { borderColor: cat.accentColor, color: cat.accentColor } : {}}
            >
              {cat.title}
              <Badge variant="outline" className="ml-0.5 px-1 py-0 text-[7px]">
                {cat.charts.length}
              </Badge>
            </button>
          ))}
        </div>
      )}

      {filteredCategories.length === 0 && searchQuery && (
        <div className="rounded-md border border-dashed border-claude-border p-3 text-center text-[10px] text-claude-text-muted">
          No matching charts
        </div>
      )}

      {/* Favorites section (hidden during search) */}
      {!searchQuery && favoriteCharts.length > 0 && (
        <div>
          <div className="sa-cat-header w-full text-claude-accent">
            <Star className="h-3 w-3 fill-claude-accent" />
            Favorites
            <Badge variant="outline" className="ml-0.5 px-1 py-0 text-[10px] font-normal">
              {favoriteCharts.length}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-1">
            {favoriteCharts.map((favId) => {
              const chart = allCharts.find((c) => c.id === favId);
              if (!chart) return null;
              return (
                <button
                  key={favId}
                  onClick={() => handleChartClick(favId)}
                  className={`sa-chart-tile ${activeAnalysisChart === favId ? "sa-chart-active" : ""}`}
                  style={{ padding: "0.25rem 0.5rem" }}
                >
                  <span className="sa-chart-tile-icon">{chart.icon}</span>
                  {chart.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Recently used section (hidden during search) */}
      {!searchQuery && recentCharts.length > 0 && (
        <div>
          <div className="sa-cat-header w-full text-claude-text-secondary">
            <Clock className="h-3 w-3" />
            Recent
            <Badge variant="outline" className="ml-0.5 px-1 py-0 text-[10px] font-normal">
              {recentCharts.length}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-1">
            {recentCharts.map((recId) => {
              const chart = allCharts.find((c) => c.id === recId);
              if (!chart) return null;
              return (
                <button
                  key={recId}
                  onClick={() => handleChartClick(recId)}
                  className={`sa-chart-tile ${activeAnalysisChart === recId ? "sa-chart-active" : ""}`}
                  style={{ padding: "0.25rem 0.5rem" }}
                >
                  <span className="sa-chart-tile-icon">{chart.icon}</span>
                  {chart.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {filteredCategories.map((cat) => {
        const isCollapsed = collapsedCats.has(cat.title) && !searchQuery;
        return (
          <div key={cat.title}>
            <button
              onClick={() => toggleCollapse(cat.title)}
              className={`sa-cat-header w-full ${cat.color} ${
                searchQuery ? "cursor-default" : "hover:opacity-80"
              }`}
            >
              {cat.title}
              <Badge
                variant="outline"
                className="ml-0.5 px-1 py-0 text-[10px] font-normal"
              >
                {cat.charts.length}
              </Badge>
              {!searchQuery && (
                <ChevronRight
                  className={`ml-auto h-3 w-3 transition-transform ${
                    isCollapsed ? "" : "rotate-90"
                  }`}
                />
              )}
            </button>
            {!isCollapsed && (
              <div className="grid grid-cols-2 gap-1">
                {cat.charts.map((c) => {
                  const isFav = favoriteCharts.includes(c.id);
                  return (
                  <TooltipProvider key={c.id} delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => handleChartClick(c.id)}
                          data-category={cat.title.toLowerCase()}
                          className={`sa-chart-tile ${
                            activeAnalysisChart === c.id ? "sa-chart-active" : ""
                          } ${isFav ? "sa-chart-fav" : ""}`}
                        >
                          <span
                            className="sa-chart-tile-accent"
                            style={{ backgroundColor: cat.accentColor }}
                          />
                          <span className="sa-chart-tile-icon">{c.icon}</span>
                          {c.label}
                          <span
                            className="sa-chart-fav-star"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFavoriteChart(c.id);
                            }}
                            title={isFav ? "Remove from favorites" : "Add to favorites"}
                          >
                            <Star className={`h-2.5 w-2.5 ${isFav ? "fill-claude-accent text-claude-accent" : "text-claude-text-muted"}`} />
                          </span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent
                        side="top"
                        className="max-w-[200px] text-[10px]"
                      >
                        <div className="font-medium">{c.label}</div>
                        <div className="text-claude-text-secondary">{c.desc}</div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {/* Active chart indicator — the chart result renders in the RIGHT panel
          (Results tab). Here we just show a small hint when a chart is active. */}
      {activeAnalysisChart && (
        <div className="mt-2 rounded-md border border-claude-accent/30 bg-claude-accent-light/30 px-2 py-1.5 text-[11px] text-claude-accent flex items-center gap-1.5">
          <ChevronRight className="h-3 w-3 animate-pulse" />
          <span className="font-medium">
            {ALL_CHART_LABELS[activeAnalysisChart] ?? activeAnalysisChart}
          </span>
          <span className="text-claude-text-muted">→ Results panel</span>
          <button
            onClick={() => setActiveAnalysisChart(null)}
            className="ml-auto text-claude-text-muted hover:text-destructive"
            title="Close chart"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
