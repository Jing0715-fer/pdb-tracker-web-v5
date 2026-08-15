"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link2, RefreshCw, Loader2, Info } from "lucide-react";
import { exportJSON, exportCSV } from "@/components/structure-analysis/chart-export-utils";
import { useAppStore, selectActiveStructure } from "@/lib/molcraft/store";
import { executeCommand } from "@/lib/molcraft/commands";

interface DisulfideBond {
  chain1: string;
  resno1: number;
  chain2: string;
  resno2: number;
  distance_A: number;
}

interface DisulfideData {
  count: number;
  bonds: DisulfideBond[];
  cutoff: number;
}

export function DisulfideChart() {
  const activeStructure = useAppStore(selectActiveStructure);
  const structureFileCache = useAppStore((s) => s.structureFileCache);
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const [data, setData] = useState<DisulfideData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cutoff, setCutoff] = useState(2.5);

  const activeId = activeStructure?.id;
  const isPdbId = activeId ? /^[a-zA-Z0-9]{4}$/.test(activeId) : false;
  const hasFileCache = activeId ? !!structureFileCache[activeId] : false;

  const fetchData = useCallback(async () => {
    if (!activeId) {
      setData(null);
      return;
    }
    const body: Record<string, unknown> = {
      recipe: "disulfide_bonds",
      params: { cutoff },
    };
    if (isPdbId) {
      body.pdbId = activeId;
    } else if (hasFileCache) {
      body.fileContent = structureFileCache[activeId].content;
      body.fileFormat = structureFileCache[activeId].format;
    } else {
      setError(
        `The current structure (${activeId}) is not a PDB ID and has no local file cache, so disulfide bond detection cannot run. Please upload a local .pdb/.cif file and try again.`
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
      toast(`Disulfide bond detection failed: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  }, [activeId, isPdbId, hasFileCache, structureFileCache, cutoff, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleFocusBond = async (bond: DisulfideBond) => {
    if (!viewer) return;
    try {
      // Focus the first CYS of the bond
      await executeCommand(viewer, {
        type: "focus_residue",
        chain: bond.chain1,
        resno: bond.resno1,
        compId: "CYS",
      });
      toast(`Focused ${bond.chain1}:CYS${bond.resno1} ↔ ${bond.chain2}:CYS${bond.resno2}`, "info");
    } catch {
      toast("Focus failed", "error");
    }
  };

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link2 className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold">Disulfide bonds</span>
          {activeId && (
            <Badge variant="outline" className="truncate font-mono text-[9px]">
              {activeStructure?.label ?? activeId}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {data && (
            <Badge variant="secondary" className="text-[10px]">
              {data.count} found
            </Badge>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={fetchData}
            disabled={loading}
            title="Re-detect"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          {data && data.bonds.length > 0 && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => exportJSON(data, "disulfide", activeId ?? undefined)}
                title="Export JSON"
              >
                <span className="text-[8px] font-bold">JS</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => {
                  const csvData = data.bonds.map((b) => ({
                    chain1: b.chain1,
                    resno1: b.resno1,
                    chain2: b.chain2,
                    resno2: b.resno2,
                    distance_A: b.distance_A.toFixed(3),
                  }));
                  exportCSV(csvData, "disulfide", activeId ?? undefined);
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
            min={1.5}
            max={3.5}
            className="h-7 w-20 text-xs font-mono"
          />
          <span className="text-[9px] text-muted-foreground">SG-SG</span>
        </div>

        {loading && <Skeleton className="h-24 w-full" />}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[10px] text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && !data && !activeId && (
          <div className="py-4 text-center text-[11px] text-muted-foreground">
            Load a structure to detect disulfide bonds
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-2">
            {data.count === 0 ? (
              <div className="rounded-md border border-dashed p-3 text-center text-[11px] text-muted-foreground">
                <Link2 className="mx-auto mb-1 h-5 w-5 text-muted-foreground/40" />
                No disulfide bonds detected
                <div className="mt-0.5 text-[9px]">
                  (cutoff {data.cutoff} Å · this protein may not contain CYS-CYS pairs)
                </div>
              </div>
            ) : (
              <>
                {/* Summary card */}
                <div className="rounded-md border bg-amber-500/5 p-2 text-center">
                  <div className="text-[9px] uppercase text-muted-foreground">
                    Disulfide bonds detected
                  </div>
                  <div className="font-mono text-lg font-bold text-amber-600">
                    {data.count}
                  </div>
                </div>

                {/* Bond list */}
                <div className="space-y-1">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Bond list (click to focus)
                  </div>
                  {data.bonds.map((bond, i) => (
                    <button
                      key={i}
                      onClick={() => handleFocusBond(bond)}
                      className="flex w-full items-center gap-2 rounded-md border bg-background p-1.5 text-left transition hover:border-primary/50 hover:bg-accent/30"
                    >
                      <div className="flex items-center gap-1 font-mono text-[10px]">
                        <span className="font-semibold text-amber-700">CYS</span>
                        <span>{bond.chain1}:{bond.resno1}</span>
                      </div>
                      <Link2 className="h-3 w-3 text-amber-600" />
                      <div className="flex items-center gap-1 font-mono text-[10px]">
                        <span className="font-semibold text-amber-700">CYS</span>
                        <span>{bond.chain2}:{bond.resno2}</span>
                      </div>
                      <Badge
                        variant="outline"
                        className="ml-auto font-mono text-[9px]"
                      >
                        {bond.distance_A.toFixed(2)} Å
                      </Badge>
                    </button>
                  ))}
                </div>

                <div className="flex items-start gap-1.5 rounded-md bg-primary/5 p-2 text-[10px] text-muted-foreground">
                  <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                  <div>
                    Disulfide bonds (S-S) are covalent cross-links between CYS residues and are critical for protein stability. The standard SG-SG distance is ~2.05 Å; the cutoff is 2.5 Å.
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
