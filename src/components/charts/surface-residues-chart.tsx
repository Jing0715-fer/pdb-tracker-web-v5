"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SunMedium, RefreshCw, Loader2, Info } from "lucide-react";
import { exportJSON, exportCSV } from "@/components/structure-analysis/chart-export-utils";
import { useAppStore, selectActiveStructure } from "@/lib/molcraft/store";
import { executeCommand } from "@/lib/molcraft/commands";

interface SurfaceResidue {
  chain: string;
  resno: number;
  resname: string;
  sasa_A2: number;
}

interface SurfaceData {
  threshold_A2: number;
  total_residues: number;
  surface_count: number;
  buried_count: number;
  surface_pct: number;
  top_surface: SurfaceResidue[];
  top_buried: SurfaceResidue[];
}

export function SurfaceResiduesChart() {
  const activeStructure = useAppStore(selectActiveStructure);
  const structureFileCache = useAppStore((s) => s.structureFileCache);
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const [chain, setChain] = useState("");
  const [threshold, setThreshold] = useState(30);
  const [data, setData] = useState<SurfaceData | null>(null);
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
      recipe: "surface_residues",
      params: { chain, threshold },
    };
    if (isPdbId) {
      body.pdbId = activeId;
    } else if (hasFileCache) {
      body.fileContent = structureFileCache[activeId].content;
      body.fileFormat = structureFileCache[activeId].format;
    } else {
      setError(
        `The current structure (${activeId}) is not a PDB ID and has no local file cache, so surface residue analysis cannot run. Please upload a local .pdb/.cif file and try again.`
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
      toast(`Surface residue analysis failed: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  }, [activeId, isPdbId, hasFileCache, structureFileCache, chain, threshold, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleFocusResidue = async (residue: SurfaceResidue) => {
    if (!viewer) return;
    try {
      await executeCommand(viewer, {
        type: "focus_residue",
        chain: residue.chain,
        resno: residue.resno,
        compId: residue.resname,
      });
      toast(`Focused ${residue.resname}${residue.resno} (${residue.chain})`, "info");
    } catch {
      toast("Focus failed", "error");
    }
  };

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <SunMedium className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold">Surface residues</span>
          {activeId && (
            <Badge variant="outline" className="truncate font-mono text-[9px]">
              {activeStructure?.label ?? activeId}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {data && (
            <Badge variant="secondary" className="text-[10px]">
              {data.surface_count} surface
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
          {data && data.top_surface && data.top_surface.length > 0 && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => exportJSON(data, "surface-residues", activeId ?? undefined)}
                title="Export JSON"
              >
                <span className="text-[8px] font-bold">JS</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => {
                  const threshold = data.threshold_A2;
                  const csvData = [
                    ...data.top_surface,
                    ...(data.top_buried ?? []),
                  ].map((r) => ({
                    chain: r.chain,
                    resno: r.resno,
                    resname: r.resname,
                    sasa_A2: r.sasa_A2?.toFixed(2) ?? "",
                    classification: r.sasa_A2 > threshold ? "surface" : "buried",
                  }));
                  exportCSV(csvData, "surface-residues", activeId ?? undefined);
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
        {/* Inputs */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] text-muted-foreground">Chain (blank=all)</Label>
            <Input
              value={chain}
              onChange={(e) => setChain(e.target.value.toUpperCase())}
              placeholder="A"
              className="h-8 text-sm font-mono"
              maxLength={2}
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">SASA threshold (Å²)</Label>
            <Input
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              step={5}
              min={5}
              max={100}
              className="h-8 text-sm font-mono"
            />
          </div>
        </div>

        {loading && <Skeleton className="h-40 w-full" />}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[10px] text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && !data && !activeId && (
          <div className="py-4 text-center text-[11px] text-muted-foreground">
            Load a structure to analyze surface residues
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-2">
            {/* Surface/Buried ratio bar */}
            <div>
              <div className="mb-1 flex justify-between text-[10px]">
                <span className="font-medium text-amber-600">Surface {data.surface_count}</span>
                <span className="text-muted-foreground">{data.total_residues} total residues</span>
                <span className="font-medium text-violet-600">Buried {data.buried_count}</span>
              </div>
              <div className="flex h-6 overflow-hidden rounded border">
                <div
                  className="flex items-center justify-center bg-amber-500 text-[9px] font-bold text-white"
                  style={{ width: `${data.surface_pct}%` }}
                >
                  {data.surface_pct >= 15 ? `${data.surface_pct}%` : ""}
                </div>
                <div
                  className="flex items-center justify-center bg-violet-500 text-[9px] font-bold text-white"
                  style={{ width: `${100 - data.surface_pct}%` }}
                >
                  {100 - data.surface_pct >= 15 ? `${(100 - data.surface_pct).toFixed(0)}%` : ""}
                </div>
              </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded-md border bg-amber-500/5 p-2 text-center">
                <div className="text-[9px] uppercase text-muted-foreground">Surface exposed</div>
                <div className="font-mono text-base font-bold text-amber-600">
                  {data.surface_count}
                </div>
                <div className="text-[9px] text-muted-foreground">
                  SASA &gt; {data.threshold_A2} Å²
                </div>
              </div>
              <div className="rounded-md border bg-violet-500/5 p-2 text-center">
                <div className="text-[9px] uppercase text-muted-foreground">Buried</div>
                <div className="font-mono text-base font-bold text-violet-600">
                  {data.buried_count}
                </div>
                <div className="text-[9px] text-muted-foreground">
                  SASA ≤ {data.threshold_A2} Å²
                </div>
              </div>
            </div>

            {/* Top surface residues */}
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-amber-600">
                Most exposed residues (drug binding candidate sites)
              </div>
              <div className="max-h-28 overflow-y-auto scrollbar-thin space-y-0.5">
                {data.top_surface.slice(0, 12).map((residue, i) => {
                  const maxSasa = data.top_surface[0]?.sasa_A2 ?? 1;
                  const pct = (residue.sasa_A2 / maxSasa) * 100;
                  return (
                    <button
                      key={i}
                      onClick={() => handleFocusResidue(residue)}
                      className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left transition hover:bg-accent/30"
                    >
                      <span className="font-mono text-[10px] font-medium w-16 shrink-0">
                        {residue.resname}{residue.resno}
                      </span>
                      <span className="text-[9px] text-muted-foreground w-4">
                        ({residue.chain})
                      </span>
                      <div className="relative h-2.5 flex-1 overflow-hidden rounded bg-muted">
                        <div
                          className="absolute inset-y-0 left-0 rounded bg-amber-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="font-mono text-[9px] w-12 text-right">
                        {residue.sasa_A2.toFixed(0)} Å²
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Top buried residues */}
            {data.top_buried.length > 0 && (
              <div>
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-violet-600">
                  Most buried residues (stability-critical)
                </div>
                <div className="flex flex-wrap gap-0.5">
                  {data.top_buried.slice(0, 10).map((residue, i) => (
                    <button
                      key={i}
                      onClick={() => handleFocusResidue(residue)}
                      className="rounded bg-violet-500/10 px-1 py-0 font-mono text-[9px] text-violet-700 transition hover:bg-violet-500/20"
                    >
                      {residue.resname}{residue.resno}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-start gap-1.5 rounded-md bg-primary/5 p-2 text-[10px] text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
              <div>
                Surface-exposed residues (SASA &gt; {data.threshold_A2} Å²) are candidate sites for drug binding and protein-protein interactions. Buried residues maintain core protein stability; mutations often lead to misfolding.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
