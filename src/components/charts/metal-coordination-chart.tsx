"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Atom, RefreshCw, Loader2, Info } from "lucide-react";
import { exportJSON, exportCSV } from "@/components/structure-analysis/chart-export-utils";
import { useAppStore, selectActiveStructure } from "@/lib/molcraft/store";
import { executeCommand } from "@/lib/molcraft/commands";

interface MetalLigand {
  resname: string;
  resno: number;
  chain: string;
  atom: string;
  distance_A: number;
  is_donor: boolean;
}

interface MetalCenter {
  metal: string; // "ZN301(A)"
  coordination_number: number;
  geometry: string; // "tetrahedral" | "octahedral" | etc.
  ligands: MetalLigand[];
}

interface MetalCoordinationData {
  total_metals: number;
  metals: MetalCenter[];
  note?: string;
}

const GEOMETRY_LABELS: Record<string, string> = {
  tetrahedral: "Tetrahedral",
  octahedral: "Octahedral",
  trigonal_bipyramidal: "Trigonal bipyramidal",
  trigonal_planar: "Trigonal planar",
  linear: "Linear",
  unknown: "Unknown",
};

const GEOMETRY_COLORS: Record<string, string> = {
  tetrahedral: "#10b981", // emerald
  octahedral: "#3b82f6", // blue
  trigonal_bipyramidal: "#8b5cf6", // violet
  trigonal_planar: "#f59e0b", // amber
  linear: "#06b6d4", // cyan
  unknown: "#9ca3af",
};

// Metal colors (Jmol/CPK-like)
const METAL_COLORS: Record<string, string> = {
  ZN: "#7d80b0",
  MG: "#8acb00",
  CA: "#3dff00",
  MN: "#9c7ac7",
  FE: "#e90209",
  CU: "#b87333",
  NI: "#43d0ff",
  CO: "#ff6c00",
  CD: "#ffd98d",
  NA: "#ab5cf2",
  K: "#8f40d4",
  MO: "#54b5ff",
  W: "#2196d4",
};

export function MetalCoordinationChart() {
  const activeStructure = useAppStore(selectActiveStructure);
  const structureFileCache = useAppStore((s) => s.structureFileCache);
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const [cutoff, setCutoff] = useState(3.5);
  const [data, setData] = useState<MetalCoordinationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeId = activeStructure?.id;
  const isPdbId = activeId ? /^[a-zA-Z0-9]{4}$/.test(activeId) : false;
  const hasFileCache = activeId ? !!structureFileCache[activeId] : false;

  const fetchData = useCallback(async () => {
    if (!activeId) {
      setData(null);
      return;
    }
    const body: Record<string, unknown> = {
      recipe: "metal_coordination",
      params: { cutoff },
    };
    if (isPdbId) {
      body.pdbId = activeId;
    } else if (hasFileCache) {
      body.fileContent = structureFileCache[activeId].content;
      body.fileFormat = structureFileCache[activeId].format;
    } else {
      setError(
        `The current structure (${activeId}) is not a PDB ID and has no local file cache, so metal coordination analysis cannot run. Please upload a local .pdb/.cif file and try again.`
      );
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || err.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      if (json.data) {
        if (json.data.error) {
          setError(`Analysis failed: ${json.data.error}`);
          setData(null);
        } else {
          setData(json.data);
        }
      } else {
        setError(json.stderr || "No data returned");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast(`Metal coordination analysis failed: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  }, [activeId, isPdbId, hasFileCache, structureFileCache, cutoff, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleFocusMetal = async (metal: MetalCenter) => {
    if (!viewer) return;
    try {
      // Parse "ZN301(A)" → compId ZN, resno 301, chain A
      const match = metal.metal.match(/^(\w+?)(\d+)\(([A-Z])\)$/);
      if (!match) return;
      const [, compId, resnoStr, chain] = match;
      await executeCommand(viewer, {
        type: "focus_residue",
        chain,
        resno: Number(resnoStr),
        compId,
      });
      toast(`Focused metal ${metal.metal}`, "info");
    } catch {
      toast("Focus failed", "error");
    }
  };

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Atom className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold">Metal coordination</span>
          {activeId && (
            <Badge variant="outline" className="truncate font-mono text-[9px]">
              {activeStructure?.label ?? activeId}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {data && (
            <Badge variant="secondary" className="text-[10px]">
              {data.total_metals} metals
            </Badge>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={fetchData}
            disabled={loading}
            title="Re-analyze"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          {data && data.metals && data.metals.length > 0 && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => exportJSON(data, "metal-coordination", activeId ?? undefined)}
                title="Export JSON"
              >
                <span className="text-[8px] font-bold">JS</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => {
                  const csvData: Record<string, unknown>[] = [];
                  for (const m of data.metals) {
                    const mm = m.metal.match(/^(\w+?)(\d+)\(([A-Z])\)$/);
                    const metal_resname = mm?.[1] ?? "";
                    const metal_resno = mm?.[2] ?? "";
                    const metal_chain = mm?.[3] ?? "";
                    for (const lig of m.ligands) {
                      csvData.push({
                        metal_chain,
                        metal_resno,
                        metal_resname,
                        metal_atom: metal_resname,
                        donor_chain: lig.chain,
                        donor_resno: lig.resno,
                        donor_resname: lig.resname,
                        donor_atom: lig.atom,
                        distance_A: lig.distance_A.toFixed(2),
                      });
                    }
                  }
                  exportCSV(csvData, "metal-coordination", activeId ?? undefined);
                }}
                title="Export CSV"
              >
                <span className="text-[8px] font-bold">CV</span>
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="space-y-2 p-3">
        {/* Cutoff input */}
        <div className="flex items-center gap-2">
          <Label className="text-[10px] text-muted-foreground">Distance cutoff (Å)</Label>
          <Input
            type="number"
            value={cutoff}
            onChange={(e) => setCutoff(Number(e.target.value))}
            step={0.1}
            min={2}
            max={5}
            className="h-7 w-20 text-xs font-mono"
          />
        </div>

        {loading && <Skeleton className="h-24 w-full" />}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[10px] text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && !data && !activeId && (
          <div className="py-4 text-center text-[11px] text-muted-foreground">
            Load a structure to analyze metal coordination
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-2">
            {data.total_metals === 0 ? (
              <div className="rounded-md border border-dashed p-3 text-center text-[11px] text-muted-foreground">
                <Atom className="mx-auto mb-1 h-5 w-5 text-muted-foreground/40" />
                {data.note || "No metal ions detected"}
                <div className="mt-0.5 text-[9px]">
                  (this protein may not contain metal cofactors)
                </div>
              </div>
            ) : (
              <>
                {/* Metal center cards */}
                <div className="space-y-1.5">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Metal centers (click to focus)
                  </div>
                  {data.metals.map((metal, i) => {
                    const match = metal.metal.match(/^(\w+?)(\d+)\(([A-Z])\)$/);
                    const metalName = match?.[1] ?? "ZN";
                    const metalColor = METAL_COLORS[metalName] ?? "#7d80b0";
                    const geoColor = GEOMETRY_COLORS[metal.geometry] ?? "#9ca3af";
                    return (
                      <div
                        key={i}
                        className="rounded-md border bg-background overflow-hidden"
                      >
                        {/* Metal header */}
                        <button
                          onClick={() => handleFocusMetal(metal)}
                          className="flex w-full items-center gap-2 border-b bg-muted/20 p-1.5 text-left transition hover:bg-accent/30"
                        >
                          <div
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[9px] font-bold text-white"
                            style={{ backgroundColor: metalColor }}
                          >
                            {metalName.slice(0, 2)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-mono text-[11px] font-semibold">
                              {metal.metal}
                            </div>
                            <div className="flex items-center gap-1.5 text-[9px]">
                              <span
                                className="rounded px-1 font-medium"
                                style={{ backgroundColor: geoColor + "20", color: geoColor }}
                              >
                                {GEOMETRY_LABELS[metal.geometry] ?? metal.geometry}
                              </span>
                              <span className="text-muted-foreground">
                                Coordination number {metal.coordination_number}
                              </span>
                            </div>
                          </div>
                        </button>
                        {/* Ligand list */}
                        <div className="space-y-0.5 p-1.5">
                          {metal.ligands.map((ligand, j) => (
                            <div
                              key={j}
                              className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[10px] hover:bg-accent/20"
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  ligand.is_donor ? "bg-emerald-500" : "bg-muted-foreground"
                                }`}
                                title={ligand.is_donor ? "Coordination donor" : "Non-donor"}
                              />
                              <span className="font-mono font-medium">
                                {ligand.resname}{ligand.resno}
                              </span>
                              <span className="text-muted-foreground">
                                ({ligand.chain})
                              </span>
                              <Badge variant="outline" className="font-mono text-[9px]">
                                {ligand.atom}
                              </Badge>
                              <span className="ml-auto font-mono text-[9px]">
                                {ligand.distance_A.toFixed(2)} Å
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-start gap-1.5 rounded-md bg-primary/5 p-2 text-[10px] text-muted-foreground">
                  <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                  <div>
                    Metal coordination centers (Zn²⁺/Mg²⁺/Ca²⁺/Fe²⁺, etc.) bind CYS/ASP/GLU/HIS residues via coordinate bonds, stabilizing protein structure and enzyme active sites.
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
