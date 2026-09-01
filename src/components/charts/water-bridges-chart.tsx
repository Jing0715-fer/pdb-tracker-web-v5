"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Droplets, RefreshCw, Loader2, Info } from "lucide-react";
import { exportJSON, exportCSV } from "@/components/structure-analysis/chart-export-utils";
import { useAppStore, selectActiveStructure } from "@/lib/molcraft/store";
import { executeCommand } from "@/lib/molcraft/commands";

interface WaterBridge {
  water_resno: number;
  res1: string; // "ASP30(A)"
  atom1: string;
  dist1_A: number;
  res2: string;
  atom2: string;
  dist2_A: number;
  total_path_A: number;
}

interface WaterBridgeData {
  total_water_bridges: number;
  bridges: WaterBridge[];
  note?: string;
}

export function WaterBridgesChart() {
  const activeStructure = useAppStore(selectActiveStructure);
  const structureFileCache = useAppStore((s) => s.structureFileCache);
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const [chain1, setChain1] = useState("A");
  const [chain2, setChain2] = useState("B");
  const [cutoff, setCutoff] = useState(3.5);
  const [data, setData] = useState<WaterBridgeData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeId = activeStructure?.id;
  const isPdbId = activeId ? /^[a-zA-Z0-9]{4}$/.test(activeId) : false;
  const hasFileCache = activeId ? !!structureFileCache[activeId] : false;

  // Auto-detect available chains from structure metadata
  const availableChains: string[] = activeStructure?.metadata?.chains ?? [];
  const chainCount = availableChains.length;

  // Auto-set chain1/chain2 when structure changes
  useEffect(() => {
    if (chainCount > 0) {
      setChain1(availableChains[0]);
      setChain2(chainCount > 1 ? availableChains[1] : availableChains[0]);
    }
  }, [activeId, chainCount, availableChains]);

  const fetchData = useCallback(async () => {
    if (!activeId) {
      setData(null);
      return;
    }
    const body: Record<string, unknown> = {
      recipe: "water_bridges",
      params: { chain1, chain2, cutoff },
    };
    if (isPdbId) {
      body.pdbId = activeId;
    } else if (hasFileCache) {
      body.fileContent = structureFileCache[activeId].content;
      body.fileFormat = structureFileCache[activeId].format;
    } else {
      setError(
        `The current structure (${activeId}) is not a PDB ID and has no local file cache, so water bridge analysis cannot run. Please upload a local .pdb/.cif file and try again.`
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
        // Check for recipe-level error (e.g. "chain not found")
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
      toast(`Water bridge analysis failed: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  }, [activeId, isPdbId, hasFileCache, structureFileCache, chain1, chain2, cutoff, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleFocusBridge = async (bridge: WaterBridge) => {
    if (!viewer) return;
    try {
      // Focus on the water molecule
      await executeCommand(viewer, {
        type: "focus_residue",
        compId: "HOH",
        resno: bridge.water_resno,
      });
      toast(`Focused water molecule HOH${bridge.water_resno}`, "info");
    } catch {
      toast("Focus failed", "error");
    }
  };

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Droplets className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold">Water bridges</span>
          {activeId && (
            <Badge variant="outline" className="truncate font-mono text-[9px]">
              {activeStructure?.label ?? activeId}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {data && (
            <Badge variant="secondary" className="text-[10px]">
              {data.total_water_bridges} found
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
          {data && data.bridges && data.bridges.length > 0 && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => exportJSON(data, "water-bridges", activeId ?? undefined)}
                title="Export JSON"
              >
                <span className="text-[8px] font-bold">JS</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => {
                  const csvData = data.bridges.map((b) => {
                    const m1 = b.res1.match(/^(\w+?)(\d+)\(([A-Z])\)$/);
                    const m2 = b.res2.match(/^(\w+?)(\d+)\(([A-Z])\)$/);
                    return {
                      chain1: m1?.[3] ?? "",
                      resno1: m1?.[2] ?? "",
                      resname1: m1?.[1] ?? "",
                      water_id: b.water_resno,
                      chain2: m2?.[3] ?? "",
                      resno2: m2?.[2] ?? "",
                      resname2: m2?.[1] ?? "",
                      distance1_A: b.dist1_A.toFixed(2),
                      distance2_A: b.dist2_A.toFixed(2),
                    };
                  });
                  exportCSV(csvData, "water-bridges", activeId ?? undefined);
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
        {/* Chain + cutoff inputs */}
        <div className="grid grid-cols-3 gap-1.5">
          <div>
            <Label className="text-[9px] text-muted-foreground">Chain 1</Label>
            {chainCount > 0 ? (
              <select
                value={chain1}
                onChange={(e) => setChain1(e.target.value)}
                className="h-7 w-full text-xs rounded-md border border-input bg-background px-1"
              >
                {availableChains.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            ) : (
              <Input
                value={chain1}
                onChange={(e) => setChain1(e.target.value.toUpperCase())}
                className="h-7 text-xs"
                maxLength={2}
              />
            )}
          </div>
          <div>
            <Label className="text-[9px] text-muted-foreground">Chain 2</Label>
            {chainCount > 1 ? (
              <select
                value={chain2}
                onChange={(e) => setChain2(e.target.value)}
                className="h-7 w-full text-xs rounded-md border border-input bg-background px-1"
              >
                {availableChains.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            ) : (
              <Input
                value={chain2}
                onChange={(e) => setChain2(e.target.value.toUpperCase())}
                className="h-7 text-xs"
                maxLength={2}
                placeholder={chainCount <= 1 ? "same as 1" : "B"}
              />
            )}
          </div>
          <div>
            <Label className="text-[9px] text-muted-foreground">Cutoff (Å)</Label>
            <Input
              type="number"
              value={cutoff}
              onChange={(e) => setCutoff(Number(e.target.value))}
              step={0.1}
              min={2.5}
              max={5}
              className="h-7 text-xs"
            />
          </div>
        </div>
        {chainCount <= 1 && (
          <p className="text-[9px] text-muted-foreground">
            Single-chain structure — will detect intra-chain water bridges.
          </p>
        )}

        {loading && <Skeleton className="h-24 w-full" />}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[10px] text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && !data && !activeId && (
          <div className="py-4 text-center text-[11px] text-muted-foreground">
            Load a structure to analyze water bridges
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-2">
            {(data.total_water_bridges ?? 0) === 0 || !data.bridges ? (
              <div className="rounded-md border border-dashed p-3 text-center text-[11px] text-muted-foreground">
                <Droplets className="mx-auto mb-1 h-5 w-5 text-muted-foreground/40" />
                {data.note || "No water bridges detected"}
                <div className="mt-0.5 text-[9px]">
                  (this structure may contain no water molecules, or no water bridges exist between the two chains)
                </div>
              </div>
            ) : (
              <>
                {/* Summary card */}
                <div className="rounded-md border bg-sky-500/5 p-2 text-center">
                  <div className="text-[9px] uppercase text-muted-foreground">
                    Water bridges detected
                  </div>
                  <div className="font-mono text-base font-bold text-sky-600">
                    {data.total_water_bridges}
                  </div>
                  <div className="text-[9px] text-muted-foreground">
                    Protein-water-protein H-bond network
                  </div>
                </div>

                {/* Bridge list */}
                <div className="space-y-1">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Water bridge list (click to focus water molecule)
                  </div>
                  <div className="max-h-48 overflow-y-auto scrollbar-thin space-y-1">
                    {data.bridges.map((bridge, i) => (
                      <button
                        key={i}
                        onClick={() => handleFocusBridge(bridge)}
                        className="w-full rounded-md border bg-background p-1.5 text-left transition hover:border-primary/50 hover:bg-accent/30"
                      >
                        <div className="flex items-center gap-1.5 text-[10px]">
                          <Droplets className="h-3 w-3 shrink-0 text-sky-500" />
                          <span className="font-mono text-sky-700">
                            HOH{bridge.water_resno}
                          </span>
                          <span className="text-muted-foreground">↔</span>
                          <span className="font-mono font-semibold">{bridge.res1}</span>
                          <span className="text-muted-foreground">+</span>
                          <span className="font-mono font-semibold">{bridge.res2}</span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 pl-5 text-[9px] text-muted-foreground">
                          <span>{bridge.atom1}↔O: {bridge.dist1_A.toFixed(1)}Å</span>
                          <span>+</span>
                          <span>{bridge.atom2}↔O: {bridge.dist2_A.toFixed(1)}Å</span>
                          <Badge variant="outline" className="ml-auto font-mono">
                            Total {bridge.total_path_A.toFixed(1)}Å
                          </Badge>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-start gap-1.5 rounded-md bg-primary/5 p-2 text-[10px] text-muted-foreground">
                  <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                  <div>
                    Water bridges are protein-water-protein H-bond networks that mediate long-range inter-chain interactions. The default cutoff distance is 3.5 Å (water to polar atom).
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
