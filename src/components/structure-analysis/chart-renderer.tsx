"use client";

/**
 * ChartRenderer — renders a single analysis chart by id.
 *
 * Shared between the left panel (which just sets the active chart id in the
 * store) and the right panel (which renders the chart result here). This
 * keeps the chart rendering logic in ONE place instead of duplicating the
 * big switch statement across panels.
 *
 * The chart renders inside a scrollable container so wide/tall charts
 * (Ramachandran, Contact Map, dashboards) don't overflow the right panel.
 */

import { useState, useEffect } from "react";
import { X, ChevronRight, Star, BarChart3, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/lib/molcraft/store";
import { PresetManager } from "./preset-manager";

// Chart components
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

export const ALL_CHART_LABELS: Record<string, string> = {
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

export const ALL_CHART_DESCS: Record<string, string> = {
  overview: "8 analyses in one screen: quality, secondary structure, SASA, etc.",
  comparison: "Compare 2-4 structures across 13 metrics side-by-side",
  rama: "φ/ψ dihedral distribution, conformation validity",
  bfactor: "Atomic thermal motion / model confidence",
  ss: "α-helix / β-sheet / turn / coil ratio",
  seqalign: "Needleman-Wunsch pairwise alignment",
  rmsd: "Multi-PDB CA Kabsch superposition RMSD",
  disulfide: "CYS-CYS SG-SG < 2.5Å covalent links",
  aromatic: "π-π stacking + cation-π (PHE/TYR/TRP/HIS)",
  water: "Protein-water-protein H-bond networks",
  metal: "Metal-ion coordination (ZN/CA/MG/FE/MN/NA/K)",
  contactmap: "Residue-residue contact heatmap",
  interaction: "Non-covalent interaction network (salt bridge/H-bond/hydrophobic)",
  pocket: "Druggable binding pocket detection",
  ligand: "Protein-ligand contact map",
  oligomer: "Assembly / interface analysis",
  druggability: "Per-residue druggability score",
  apbs_surface: "APBS electrostatic surface potential",
  screening: "Virtual screening of fragment library",
  detect_pockets: "Multi-pocket geometric detection",
  sasa: "Solvent-accessible surface area per residue",
  surface: "Surface-exposed vs buried residues",
  electrostatic: "Electrostatic interaction energy",
  validation: "Geometry + clash validation report",
};

interface ChartRendererProps {
  chartId: string;
  onClose?: () => void;
}

export function ChartRenderer({ chartId, onClose }: ChartRendererProps) {
  const chartLabel = ALL_CHART_LABELS[chartId] ?? chartId;
  const chartDesc = ALL_CHART_DESCS[chartId] ?? "";
  const favoriteCharts = useAppStore((s) => s.favoriteCharts);
  const toggleFavoriteChart = useAppStore((s) => s.toggleFavoriteChart);
  const isFav = favoriteCharts.includes(chartId);
  const [rendered, setRendered] = useState(false);

  // Brief loading shimmer for chart switches (gives visual feedback on click).
  // Use a microtask + timeout pattern so setState is NOT called synchronously
  // in the effect body (avoids the react-hooks/set-state-in-effect lint rule).
  useEffect(() => {
    let cancelled = false;
    const t1 = setTimeout(() => { if (!cancelled) setRendered(false); }, 0);
    const t2 = setTimeout(() => { if (!cancelled) setRendered(true); }, 80);
    return () => { cancelled = true; clearTimeout(t1); clearTimeout(t2); };
  }, [chartId]);

  return (
    <div className="flex h-full flex-col">
      {/* Chart header — title + favorite + close */}
      <div className="flex shrink-0 items-center gap-2 border-b border-claude-border-light/40 dark:border-[#3d3832]/40 px-3 py-2 bg-claude-bg/40 dark:bg-[#1a1917]/40">
        <BarChart3 className="h-3.5 w-3.5 text-claude-accent shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold text-claude-text truncate">{chartLabel}</div>
          {chartDesc && (
            <div className="text-[9px] text-claude-text-muted truncate">{chartDesc}</div>
          )}
        </div>
        <button
          onClick={() => toggleFavoriteChart(chartId)}
          className="shrink-0 p-1 rounded text-claude-text-muted hover:text-claude-accent transition-colors"
          title={isFav ? "Remove from favorites" : "Add to favorites"}
        >
          <Star className={`h-3 w-3 ${isFav ? "fill-claude-accent text-claude-accent" : ""}`} />
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="shrink-0 p-1 rounded text-claude-text-muted hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="Close chart"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Chart body — scrollable so wide/tall charts don't overflow */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto sa-scroll">
        {!rendered ? (
          <div className="flex items-center justify-center h-32 gap-2 text-[10px] text-claude-text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-claude-accent" />
            Loading {chartLabel}…
          </div>
        ) : (
          <div className="p-2.5">
            {chartId === "overview" && <StructureOverviewDashboard />}
            {chartId === "comparison" && <StructureComparisonDashboard />}
            {chartId === "rama" && <RamachandranPlot />}
            {chartId === "bfactor" && <BfactorChart />}
            {chartId === "ss" && <SecondaryStructureChart />}
            {chartId === "sasa" && <SasaChart />}
            {chartId === "disulfide" && <DisulfideChart />}
            {chartId === "aromatic" && <AromaticStackingChart />}
            {chartId === "water" && <WaterBridgesChart />}
            {chartId === "metal" && <MetalCoordinationChart />}
            {chartId === "validation" && <StructureValidationChart />}
            {chartId === "pocket" && <BindingPocketChart />}
            {chartId === "ligand" && <LigandInteractionsChart />}
            {chartId === "oligomer" && <OligomerAnalysisChart />}
            {chartId === "electrostatic" && <ElectrostaticChart />}
            {chartId === "contactmap" && <ContactMapChart />}
            {chartId === "surface" && <SurfaceResiduesChart />}
            {chartId === "interaction" && <InteractionNetwork />}
            {chartId === "seqalign" && <SequenceAlignment />}
            {chartId === "rmsd" && <RmsdMatrix />}
            {chartId === "druggability" && <DruggabilityChart />}
            {chartId === "apbs_surface" && <ApbsSurfaceChart />}
            {chartId === "screening" && <ScreeningChart />}
            {chartId === "detect_pockets" && <PocketDetectionChart />}
          </div>
        )}
      </div>

      {/* Preset manager at the bottom */}
      <div className="shrink-0 border-t border-claude-border-light/40 dark:border-[#3d3832]/40 p-1.5">
        <PresetManager
          chartId={chartId}
          chartLabel={chartLabel}
          currentParams={{}}
          onApplyPreset={() => {}}
        />
      </div>
    </div>
  );
}
