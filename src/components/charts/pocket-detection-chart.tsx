"use client";

import { useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppStore, selectActiveStructure } from "@/lib/molcraft/store";
import { executeCommand } from "@/lib/molcraft/commands";
import { Loader2, AlertCircle, Target, Star } from "lucide-react";
import { exportJSON, exportCSV } from "@/components/structure-analysis/chart-export-utils";

// ----- Types -----
interface PocketResidueRef {
  chain?: string;
  resno?: number;
  resname?: string;
}

interface DetectedPocket {
  id?: number;
  center?: [number, number, number] | number[];
  volume?: number;
  depth?: number;
  druggability_score?: number;
  classification?: string;
  residue_count?: number;
  composition?: Record<string, number>;
  top_residues?: PocketResidueRef[];
}

interface PocketDetectionData {
  num_pockets?: number;
  grid_spacing?: number;
  probe_radius?: number;
  pockets?: DetectedPocket[];
  top_pocket?: string;
}

// Classification → color (mirrors druggability-chart)
function classificationColor(c: string): string {
  const s = (c ?? "").toLowerCase();
  if (s.includes("highly")) return "#10b981";
  if (s.includes("druggable") && !s.includes("moderately")) return "#3b82f6";
  if (s.includes("moderate")) return "#f59e0b";
  if (s.includes("difficult")) return "#ef4444";
  return "#9ca3af";
}

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

export function PocketDetectionChart() {
  const activeStructure = useAppStore(selectActiveStructure);
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const [minVolume, setMinVolume] = useState(100); // R169 (MOL-L3): renamed from minDepth
  const [data, setData] = useState<PocketDetectionData | null>(null);
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
    setLoading(true);
    setError(null);
    try {
      const result = await executeCommand(viewer, {
        type: "detect_pockets",
        pdbId,
        minVolume,
      });
      if (!result.ok) {
        setError(result.detail ?? "Pocket detection failed");
        return;
      }
      const d = (result.analysisResult as any)?.data?.data;
      if (d) {
        setData(d as PocketDetectionData);
        toast(result.detail ?? "Pocket detection complete", "success");
      } else {
        setError("No valid data returned");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [activeStructure, viewer, pdbId, minVolume, toast]);

  // Sort pockets by druggability score (best first) — defensive
  const sortedPockets = useMemo(() => {
    const arr = (data?.pockets ?? []).slice();
    arr.sort(
      (a, b) => (b.druggability_score ?? 0) - (a.druggability_score ?? 0)
    );
    return arr;
  }, [data]);

  const numPockets = data?.num_pockets ?? sortedPockets.length;

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Target className="h-4 w-4 shrink-0 text-violet-500" />
          <span className="text-sm font-semibold">Multi-pocket detection</span>
          {activeStructure && (
            <Badge variant="outline" className="truncate font-mono text-[9px]">
              {activeStructure.label ?? pdbId}
            </Badge>
          )}
        </div>
        {data && (
          <div className="flex items-center gap-1">
            <Badge variant="secondary" className="text-[10px]">
              {numPockets} pockets
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => exportJSON(data, "pocket-detection", pdbId || undefined)}
              title="Export JSON"
            >
              <span className="text-[8px] font-bold">JS</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                const csvData = sortedPockets.map((p, idx) => ({
                  pocket_id: p.id ?? idx,
                  volume: p.volume ?? "",
                  depth: p.depth?.toFixed(2) ?? "",
                  druggability_score: p.druggability_score?.toFixed(2) ?? "",
                  classification: p.classification ?? "",
                  residue_count: p.residue_count ?? "",
                }));
                exportCSV(csvData, "pocket-detection", pdbId || undefined);
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
            <Label className="text-[10px] text-muted-foreground">Minimum volume (Å³)</Label>
            <Input
              type="number"
              value={minVolume}
              onChange={(e) => setMinVolume(Number(e.target.value) || 0)}
              step={50}
              min={0}
              max={2000}
              className="h-8 text-xs font-mono"
            />
          </div>
          <div className="flex flex-col justify-end">
            <Label className="text-[10px] text-muted-foreground">Detection parameters</Label>
            <div className="text-[9px] text-muted-foreground">
              grid ≈ {(data?.grid_spacing ?? 0.8).toString()} Å · probe r ={" "}
              {(data?.probe_radius ?? 1.4).toString()} Å
            </div>
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
              Detecting pockets…
            </>
          ) : (
            <>
              <Target className="mr-1.5 h-3.5 w-3.5" />
              Detect pockets
            </>
          )}
        </Button>

        {!loading && !error && !data && (
          <div className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-[11px] text-muted-foreground">
            After clicking "Detect pockets", the structure surface will be scanned for all concave regions using a grid/probe algorithm, and results will be shown sorted by druggability score.
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
            {/* Summary */}
            <div className="flex items-center justify-between rounded-md border bg-violet-500/5 p-2">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-violet-500" />
                <span className="text-xs font-semibold">
                  Detected {numPockets} pockets
                </span>
              </div>
              {data.top_pocket && (
                <Badge variant="outline" className="text-[9px]">
                  Top: {data.top_pocket}
                </Badge>
              )}
            </div>

            {sortedPockets.length === 0 && (
              <div className="rounded-md border border-dashed p-4 text-center text-[10px] text-muted-foreground">
                No matching pockets detected; try lowering the minimum volume threshold.
              </div>
            )}

            {/* Pocket cards */}
            <div className="max-h-96 overflow-y-auto scrollbar-thin space-y-2">
              {sortedPockets.map((p, idx) => {
                const score = p.druggability_score ?? 0;
                const cls = p.classification ?? "unknown";
                const color = classificationColor(cls);
                const volume = p.volume ?? 0;
                const depth = p.depth ?? 0;
                const resCount = p.residue_count ?? 0;
                const center = p.center ?? [0, 0, 0];
                const comp = p.composition ?? {};
                const totalComp = Object.values(comp).reduce((a, b) => a + (b ?? 0), 0);
                const topRes = (p.top_residues ?? []).slice(0, 6);
                return (
                  <div
                    key={p.id ?? idx}
                    className="rounded-md border bg-card p-2"
                    style={{ borderLeft: `3px solid ${color}` }}
                  >
                    {/* Header */}
                    <div className="mb-1 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="font-mono text-[9px]">
                          #{idx + 1} (id {p.id ?? idx})
                        </Badge>
                        <Badge
                          className="text-[9px] font-semibold text-white"
                          style={{ backgroundColor: color }}
                        >
                          {cls}
                        </Badge>
                        {idx === 0 && (
                          <Badge className="bg-violet-500 text-white text-[9px] gap-0.5">
                            <Star className="h-2.5 w-2.5" aria-hidden="true" />
                            Top
                          </Badge>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="text-[8px] uppercase text-muted-foreground">Score</span>
                        <span
                          className="ml-1 font-mono text-sm font-bold"
                          style={{ color }}
                        >
                          {(score ?? 0).toFixed(1)}
                        </span>
                      </div>
                    </div>

                    {/* Coords + main metrics */}
                    <div className="mb-1.5 grid grid-cols-4 gap-1 text-center text-[9px]">
                      <div>
                        <div className="text-[8px] uppercase text-muted-foreground">Volume</div>
                        <div className="font-mono font-bold">
                          {(volume ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                        </div>
                        <div className="text-[7px] text-muted-foreground">Å³</div>
                      </div>
                      <div>
                        <div className="text-[8px] uppercase text-muted-foreground">Depth</div>
                        <div className="font-mono font-bold">{(depth ?? 0).toFixed(1)}</div>
                        <div className="text-[7px] text-muted-foreground">Å</div>
                      </div>
                      <div>
                        <div className="text-[8px] uppercase text-muted-foreground">Residues</div>
                        <div className="font-mono font-bold">{resCount}</div>
                      </div>
                      <div>
                        <div className="text-[8px] uppercase text-muted-foreground">Center</div>
                        <div className="font-mono text-[8px] font-bold leading-tight">
                          {Array.isArray(center)
                            ? center
                                .slice(0, 3)
                                .map((v) => (Number(v) ?? 0).toFixed(0))
                                .join(",")
                            : "—"}
                        </div>
                      </div>
                    </div>

                    {/* Composition bar */}
                    {totalComp > 0 && (
                      <div className="mb-1.5">
                        <div className="flex h-3 overflow-hidden rounded border">
                          {Object.entries(comp).map(([cat, cnt]) => {
                            const c = (cnt ?? 0);
                            if (c === 0) return null;
                            const pct = totalComp > 0 ? (c / totalComp) * 100 : 0;
                            const cc = CATEGORY_COLOR[cat] ?? CATEGORY_COLOR.other;
                            return (
                              <div
                                key={cat}
                                className="flex items-center justify-center text-[7px] font-bold text-white"
                                style={{ width: `${pct}%`, backgroundColor: cc }}
                                title={`${CATEGORY_LABEL[cat] ?? cat}: ${c}`}
                              >
                                {pct >= 18 ? c : ""}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Top residues */}
                    {topRes.length > 0 && (
                      <div>
                        <div className="mb-0.5 text-[8px] uppercase tracking-wide text-muted-foreground">
                          Key residues (top {topRes.length})
                        </div>
                        <div className="flex flex-wrap gap-0.5">
                          {topRes.map((r, i) => (
                            <Badge
                              key={i}
                              variant="outline"
                              className="font-mono text-[8px]"
                            >
                              {(r.resname ?? "")}
                              {r.resno ?? ""}
                              <span className="ml-0.5 text-muted-foreground">
                                ({r.chain ?? ""})
                              </span>
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
