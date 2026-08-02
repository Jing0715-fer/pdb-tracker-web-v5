"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppStore, selectActiveStructure } from "@/lib/molcraft/store";
import { executeCommand } from "@/lib/molcraft/commands";
import { Loader2, AlertCircle, Pill } from "lucide-react";
import { exportJSON, exportCSV } from "@/components/structure-analysis/chart-export-utils";

// ----- Types -----
interface DrugResidue {
  chain?: string;
  resno?: number;
  resname?: string;
  min_dist_A?: number;
  category?: string;
}

interface ScoreBreakdown {
  volume?: number;
  hydrophobicity?: number;
  polarity?: number;
  depth?: number;
  charge?: number;
}

interface DruggabilityData {
  ligand?: string;
  radius_A?: number;
  pocket_residue_count?: number;
  pocket_volume_A3?: number;
  druggability_score?: number;
  classification?: string;
  composition?: Record<string, number>;
  hydrophobic_pct?: number;
  polar_pct?: number;
  charged_pct?: number;
  score_breakdown?: ScoreBreakdown;
  residues?: DrugResidue[];
}

// Classification → color
function classificationColor(c: string): string {
  const s = (c ?? "").toLowerCase();
  if (s.includes("highly")) return "#10b981"; // emerald
  if (s.includes("druggable") && !s.includes("moderately")) return "#3b82f6"; // blue
  if (s.includes("moderate")) return "#f59e0b"; // amber
  if (s.includes("difficult")) return "#ef4444"; // red
  return "#9ca3af"; // gray
}

// Category color (same as binding-pocket-chart for consistency)
const CATEGORY_COLOR: Record<string, string> = {
  hydrophobic: "#f59e0b",
  polar: "#06b6d4",
  positive: "#3b82f6",
  negative: "#ef4444",
  glycine: "#9ca3af",
  other: "#8b5cf6",
};

const CATEGORY_LABEL: Record<string, string> = {
  hydrophobic: "Hydrophobic",
  polar: "Polar",
  positive: "Positive",
  negative: "Negative",
  glycine: "Glycine",
  other: "Other",
};

// Score breakdown weights (must match backend recipe)
const BREAKDOWN_WEIGHTS: Record<keyof ScoreBreakdown, number> = {
  volume: 0.25,
  hydrophobicity: 0.25,
  polarity: 0.15,
  depth: 0.20,
  charge: 0.15,
};

const BREAKDOWN_LABELS: Record<keyof ScoreBreakdown, string> = {
  volume: "Volume",
  hydrophobicity: "Hydrophobicity",
  polarity: "Polarity",
  depth: "Depth",
  charge: "Charge",
};

export function DruggabilityChart() {
  const activeStructure = useAppStore(selectActiveStructure);
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const [ligandCompId, setLigandCompId] = useState("REA");
  const [radius, setRadius] = useState(8);
  const [data, setData] = useState<DruggabilityData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pdbId = activeStructure?.id ?? "";

  const run = useCallback(async () => {
    if (!activeStructure) {
      setError("Please load a structure first");
      return;
    }
    if (!viewer) {
      setError("3D viewer not ready, please try again");
      return;
    }
    if (!ligandCompId.trim()) {
      setError("Please enter a ligand compId");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await executeCommand(viewer, {
        type: "show_druggable_pocket",
        ligandCompId: ligandCompId.toUpperCase(),
        pdbId,
        radius,
      });
      if (!result.ok) {
        setError(result.detail ?? "Druggability computation failed");
        return;
      }
      const d = (result.analysisResult as any)?.data?.data;
      if (d) {
        setData(d as DruggabilityData);
        toast(result.detail ?? "Pocket highlighted", "success");
      } else {
        setError("No valid data returned");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [activeStructure, viewer, pdbId, ligandCompId, radius, toast]);

  // ----- Derived values (defensive) -----
  const score = data?.druggability_score ?? 0;
  const classification = data?.classification ?? "unknown";
  const classColor = classificationColor(classification);
  const volume = data?.pocket_volume_A3 ?? 0;
  const residueCount = data?.pocket_residue_count ?? 0;
  const ligandLabel = data?.ligand ?? ligandCompId;
  const radiusA = data?.radius_A ?? radius;
  const breakdown = data?.score_breakdown ?? {};
  const residues = (data?.residues ?? []).slice(0, 15);
  const composition = data?.composition ?? {};
  const totalComp = Object.values(composition).reduce((a, b) => a + (b ?? 0), 0);

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Pill className="h-4 w-4 shrink-0 text-rose-500" />
          <span className="text-sm font-semibold">Druggability prediction</span>
          {activeStructure && (
            <Badge variant="outline" className="truncate font-mono text-[9px]">
              {activeStructure.label ?? pdbId}
            </Badge>
          )}
        </div>
        {data && (
          <div className="flex items-center gap-1">
            <Badge variant="secondary" className="text-[10px]">
              Ligand {ligandLabel}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => exportJSON(data, "druggability", pdbId || undefined)}
              title="Export JSON"
            >
              <span className="text-[8px] font-bold">JS</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                const csvData = (data.residues ?? []).map((r) => ({
                  chain: r.chain ?? "",
                  resno: r.resno ?? "",
                  resname: r.resname ?? "",
                  min_dist_A: r.min_dist_A?.toFixed(2) ?? "",
                  category: r.category ?? "",
                }));
                exportCSV(csvData, "druggability", pdbId || undefined);
              }}
              title="Export CSV"
            >
              <span className="text-[8px] font-bold">CV</span>
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-3 p-4">
        {/* Controls */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] text-muted-foreground">Ligand compId (3-letter)</Label>
            <Input
              value={ligandCompId}
              onChange={(e) => setLigandCompId(e.target.value.toUpperCase())}
              placeholder="REA"
              maxLength={6}
              className="h-8 text-xs font-mono"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Pocket radius (Å)</Label>
            <Input
              type="number"
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value) || 0)}
              step={0.5}
              min={3}
              max={15}
              className="h-8 text-xs font-mono"
            />
          </div>
        </div>

        <Button
          onClick={run}
          disabled={loading || !activeStructure}
          className="w-full h-8 text-xs"
          size="sm"
        >
          {loading ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Computing druggability…
            </>
          ) : (
            <>
              <Pill className="mr-1.5 h-3.5 w-3.5" />
              Compute + highlight pocket
            </>
          )}
        </Button>

        {!loading && !error && !data && (
          <div className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-[11px] text-muted-foreground">
            Enter a ligand compId and pocket radius, then click compute to focus the ligand in the 3D view and label pocket residues. The score is a weighted combination of volume / hydrophobicity / polarity / depth / charge.
          </div>
        )}

        {loading && <Skeleton className="h-48 w-full" />}

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[10px] text-destructive">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        )}

        {/* Results */}
        {!loading && !error && data && (
          <div className="space-y-3">
            {/* Big score + classification */}
            <div
              className="flex items-center justify-between rounded-md border p-3"
              style={{
                borderColor: `${classColor}55`,
                background: `linear-gradient(135deg, ${classColor}15, transparent)`,
              }}
            >
              <div>
                <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
                  Druggability score
                </div>
                <div
                  className="font-mono text-3xl font-bold leading-tight"
                  style={{ color: classColor }}
                >
                  {(score ?? 0).toFixed(1)}
                  <span className="ml-1 text-[10px] text-muted-foreground">/ 100</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Classification</div>
                <Badge
                  className="text-[10px] font-semibold text-white"
                  style={{ backgroundColor: classColor }}
                >
                  {classification}
                </Badge>
              </div>
            </div>

            {/* Score progress bar */}
            <div>
              <div className="mb-1 flex justify-between text-[9px] text-muted-foreground">
                <span>0 (Difficult)</span>
                <span>30 (Moderate)</span>
                <span>50 (Druggable)</span>
                <span>70 (Highly druggable)</span>
                <span>100</span>
              </div>
              <div className="relative h-3 overflow-hidden rounded border bg-muted">
                <div
                  className="h-full"
                  style={{
                    width: `${Math.max(0, Math.min(100, score))}%`,
                    backgroundColor: classColor,
                    transition: "width .3s ease",
                  }}
                />
                {/* threshold ticks */}
                {[30, 50, 70].map((t) => (
                  <div
                    key={t}
                    className="absolute top-0 h-full w-px bg-black/20"
                    style={{ left: `${t}%` }}
                  />
                ))}
              </div>
            </div>

            {/* Score breakdown bars */}
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Score breakdown (with weights)
              </div>
              <div className="space-y-1">
                {(Object.keys(BREAKDOWN_WEIGHTS) as Array<keyof ScoreBreakdown>).map((k) => {
                  const val = (breakdown[k] as number | undefined) ?? 0;
                  const weight = BREAKDOWN_WEIGHTS[k];
                  return (
                    <div key={k} className="flex items-center gap-2 text-[10px]">
                      <span className="w-16 shrink-0 text-muted-foreground">
                        {BREAKDOWN_LABELS[k]}
                        <span className="ml-1 text-[8px] opacity-60">
                          ({(weight * 100).toFixed(0)}%)
                        </span>
                      </span>
                      <div className="relative h-2.5 flex-1 overflow-hidden rounded bg-muted">
                        <div
                          className="h-full rounded"
                          style={{
                            width: `${Math.max(0, Math.min(100, val))}%`,
                            backgroundColor: classColor,
                            opacity: 0.85,
                          }}
                        />
                      </div>
                      <span className="w-8 shrink-0 text-right font-mono text-[9px]">
                        {(val ?? 0).toFixed(0)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-md border bg-amber-500/5 p-2 text-center">
                <div className="text-[9px] uppercase text-muted-foreground">Residues</div>
                <div className="font-mono text-base font-bold text-amber-600">{residueCount}</div>
              </div>
              <div className="rounded-md border bg-rose-500/5 p-2 text-center">
                <div className="text-[9px] uppercase text-muted-foreground">Pocket volume</div>
                <div className="font-mono text-base font-bold text-rose-600">
                  {(volume ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </div>
                <div className="text-[8px] text-muted-foreground">Å³</div>
              </div>
              <div className="rounded-md border bg-primary/5 p-2 text-center">
                <div className="text-[9px] uppercase text-muted-foreground">Ligand</div>
                <div className="font-mono text-base font-bold text-primary">{ligandLabel}</div>
                <div className="text-[8px] text-muted-foreground">r = {radiusA} Å</div>
              </div>
            </div>

            {/* Composition bar */}
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Residue composition ({residueCount} total)
              </div>
              <div className="flex h-5 overflow-hidden rounded border">
                {Object.entries(composition).map(([cat, cnt]) => {
                  const c = (cnt ?? 0);
                  if (c === 0) return null;
                  const pct = totalComp > 0 ? (c / totalComp) * 100 : 0;
                  const color = CATEGORY_COLOR[cat] ?? CATEGORY_COLOR.other;
                  return (
                    <div
                      key={cat}
                      className="flex items-center justify-center text-[8px] font-bold text-white"
                      style={{ width: `${pct}%`, backgroundColor: color }}
                      title={`${CATEGORY_LABEL[cat] ?? cat}: ${c} (${pct.toFixed(0)}%)`}
                    >
                      {pct >= 12 ? c : ""}
                    </div>
                  );
                })}
              </div>
              {/* Legend */}
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                {Object.entries(composition)
                  .filter(([, cnt]) => (cnt ?? 0) > 0)
                  .map(([cat, cnt]) => {
                    const color = CATEGORY_COLOR[cat] ?? CATEGORY_COLOR.other;
                    return (
                      <div key={cat} className="flex items-center gap-1 text-[9px]">
                        <span
                          className="h-2 w-2 rounded-sm"
                          style={{ backgroundColor: color }}
                        />
                        <span className="text-muted-foreground">
                          {CATEGORY_LABEL[cat] ?? cat}
                        </span>
                        <span className="font-mono">{cnt}</span>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Key residues list */}
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Key pocket residues (top 15, sorted by distance)
              </div>
              <div className="max-h-44 overflow-y-auto scrollbar-thin space-y-0.5">
                {residues.length === 0 && (
                  <div className="text-[9px] text-muted-foreground">No residues</div>
                )}
                {residues.map((r, i) => {
                  const cat = (r.category ?? "other").toLowerCase();
                  const color = CATEGORY_COLOR[cat] ?? CATEGORY_COLOR.other;
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] transition hover:bg-accent/30"
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: color }}
                        title={CATEGORY_LABEL[cat] ?? cat}
                      />
                      <span className="font-mono text-[10px] font-medium">
                        {(r.resname ?? "")}
                        {r.resno ?? ""}
                      </span>
                      <span className="text-[9px] text-muted-foreground">
                        ({r.chain ?? ""})
                      </span>
                      <span className="text-[9px]" style={{ color }}>
                        {CATEGORY_LABEL[cat] ?? cat}
                      </span>
                      <Badge
                        variant="outline"
                        className="ml-auto font-mono text-[9px]"
                      >
                        {(r.min_dist_A ?? 0).toFixed(1)} Å
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
