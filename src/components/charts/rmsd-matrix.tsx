"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Grid3x3, Loader2, Play, Info, X, Layers } from "lucide-react";
import { exportJSON, exportCSV } from "@/components/structure-analysis/chart-export-utils";
import { useAppStore } from "@/lib/molcraft/store";

interface RmsdData {
  pdb_ids: string[];
  chain: string;
  matrix: number[][];
  matched_counts?: number[][];
  errors: Record<string, string>;
  method?: string;
}

export function RmsdMatrix() {
  const toast = useAppStore((s) => s.toast);
  const structures = useAppStore((s) => s.structures);
  const [pdbIdInput, setPdbIdInput] = useState("1CBS, 1CBR, 1TQN");
  const [chain, setChain] = useState("A");
  const [useAlignment, setUseAlignment] = useState(true);
  const [data, setData] = useState<RmsdData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredCell, setHoveredCell] = useState<{ i: number; j: number } | null>(null);

  // Auto-populate input from loaded PDB structures when the user clicks the
  // "use loaded" button (or when 2+ PDB structures are loaded and input is empty).
  const useLoadedStructures = useCallback(() => {
    const pdbStructs = structures.filter((s) => /^[a-zA-Z0-9]{4}$/.test(s.id));
    if (pdbStructs.length < 2) {
      toast("At least 2 PDB structures are required to compute the RMSD matrix", "error");
      return;
    }
    setPdbIdInput(pdbStructs.map((s) => s.id).join(", "));
    toast(`Filled in ${pdbStructs.length} loaded PDB structures`, "info");
  }, [structures, toast]);

  const runAnalysis = useCallback(async () => {
    const pdbIds = pdbIdInput
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length >= 4)
      .map((s) => s.slice(0, 4));
    if (pdbIds.length < 2) {
      setError("Please enter at least 2 PDB IDs (comma-separated)");
      return;
    }
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch("/api/analyze/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipe: useAlignment ? "cross_pdb_rmsd_aligned" : "cross_pdb_rmsd",
          params: { pdbIds, chain },
        }),
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
          const n = json.data.pdb_ids?.length ?? 0;
          toast(`Completed: ${n}×${n} RMSD matrix`, "success");
        }
      } else {
        setError(json.stderr || "No data returned");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast(`RMSD matrix computation failed: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  }, [pdbIdInput, chain, toast, useAlignment]);

  // Color scale for RMSD (green=low → yellow → red=high)
  const rmsdColor = (rmsd: number, max: number): string => {
    if (rmsd < 0) return "#f3f4f6"; // N/A
    const t = Math.min(rmsd / max, 1);
    if (t < 0.5) {
      const r = Math.round(16 + (250 - 16) * t * 2);
      const g = Math.round(185 + (204 - 185) * t * 2);
      const b = Math.round(129 + (0 - 129) * t * 2);
      return `rgb(${r},${g},${b})`;
    }
    const t2 = (t - 0.5) * 2;
    const r = 250;
    const g = Math.round(204 - 204 * t2);
    const b = 0;
    return `rgb(${r},${g},${b})`;
  };

  const maxRmsd = data
    ? Math.max(
        1, // fallback when all values are N/A
        ...data.matrix
          .flat()
          .filter((v) => v > 0)
          .map(Math.abs)
      )
    : 1;

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Grid3x3 className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Cross-PDB RMSD matrix</span>
        </div>
        {data && (
          <div className="flex items-center gap-1">
            <Badge variant="secondary" className="text-[10px]">
              {data.pdb_ids.length}×{data.pdb_ids.length}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => exportJSON(data, "rmsd-matrix", data.pdb_ids.join("-"))}
              title="Export JSON"
            >
              <span className="text-[8px] font-bold">JS</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                const csvData: Array<Record<string, unknown>> = [];
                for (let i = 0; i < data.matrix.length; i++) {
                  for (let j = 0; j < data.matrix[i].length; j++) {
                    if (i === j) continue;
                    csvData.push({
                      pdb1: data.pdb_ids[i],
                      pdb2: data.pdb_ids[j],
                      rmsd_A: data.matrix[i][j],
                      matched_residues: data.matched_counts?.[i]?.[j] ?? "",
                    });
                  }
                }
                exportCSV(csvData, "rmsd-matrix", data.pdb_ids.join("-"));
              }}
              title="Export CSV"
            >
              <span className="text-[8px] font-bold">CV</span>
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-2 p-3">
        {/* Inputs */}
        <div>
          <div className="flex items-center justify-between">
            <Label className="text-[10px] text-muted-foreground">
              PDB ID list (comma-separated)
            </Label>
            <Button
              size="sm"
              variant="ghost"
              className="h-5 gap-1 px-1.5 text-[9px]"
              onClick={useLoadedStructures}
              disabled={structures.filter((s) => /^[a-zA-Z0-9]{4}$/.test(s.id)).length < 2}
              title="Fill with loaded PDB structures"
            >
              <Layers className="h-2.5 w-2.5" />
              Use loaded
            </Button>
          </div>
          <Input
            value={pdbIdInput}
            onChange={(e) => setPdbIdInput(e.target.value)}
            placeholder="1CBS, 1CBR, 1TQN"
            className="h-8 text-xs font-mono"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] text-muted-foreground">Chain ID</Label>
            <Input
              value={chain}
              onChange={(e) => setChain(e.target.value.toUpperCase())}
              className="h-8 text-sm font-mono"
              maxLength={2}
            />
          </div>
          <div className="flex items-end">
            <Button
              size="sm"
              className="h-8 w-full"
              onClick={runAnalysis}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="mr-1.5 h-3.5 w-3.5" />
              )}
              Compute
            </Button>
          </div>
        </div>

        {/* Method toggle */}
        <div className="flex items-center gap-2 rounded-md border bg-accent/20 p-1.5">
          <button
            onClick={() => setUseAlignment(true)}
            className={`flex-1 rounded px-2 py-1 text-[10px] font-medium transition ${
              useAlignment
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent"
            }`}
          >
            Sequence-aligned matching (recommended)
          </button>
          <button
            onClick={() => setUseAlignment(false)}
            className={`flex-1 rounded px-2 py-1 text-[10px] font-medium transition ${
              !useAlignment
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent"
            }`}
          >
            Residue-number matching
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[10px] text-destructive">
            {error}
          </div>
        )}

        {loading && <Skeleton className="h-48 w-full" />}

        {/* Matrix heatmap */}
        {!loading && !error && data && (
          <div className="space-y-2">
            <div className="overflow-x-auto scrollbar-thin">
              <table className="border-collapse text-[10px]">
                <thead>
                  <tr>
                    <th className="border border-border bg-muted/30 p-1"></th>
                    {data.pdb_ids.map((id) => (
                      <th
                        key={id}
                        className="border border-border bg-muted/30 p-1 font-mono"
                      >
                        {id}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.matrix.map((row, i) => (
                    <tr key={i}>
                      <td className="border border-border bg-muted/30 p-1 font-mono font-medium">
                        {data.pdb_ids[i]}
                      </td>
                      {row.map((val, j) => {
                        const isHovered =
                          hoveredCell?.i === i && hoveredCell?.j === j;
                        const isDiag = i === j;
                        return (
                          <td
                            key={j}
                            className="border border-border p-1 text-center font-mono transition"
                            style={{
                              backgroundColor: isDiag
                                ? "#f9fafb"
                                : rmsdColor(val, maxRmsd),
                              color: isDiag
                                ? "#9ca3af"
                                : val > maxRmsd * 0.6
                                ? "#fff"
                                : "#1f2937",
                              fontWeight: isHovered ? 700 : 400,
                              cursor: "pointer",
                            }}
                            onMouseEnter={() => setHoveredCell({ i, j })}
                            onMouseLeave={() => setHoveredCell(null)}
                          >
                            {isDiag ? "—" : val < 0 ? "N/A" : val.toFixed(2)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Hover info */}
            {hoveredCell && hoveredCell.i !== hoveredCell.j && (
              <div className="rounded-md border bg-accent/30 px-2 py-1 text-[10px]">
                {data.pdb_ids[hoveredCell.i]} vs {data.pdb_ids[hoveredCell.j]}:{" "}
                <span className="font-mono font-medium">
                  {data.matrix[hoveredCell.i][hoveredCell.j] < 0
                    ? "No common residues"
                    : `${data.matrix[hoveredCell.i][hoveredCell.j].toFixed(3)} Å`}
                </span>
                {data.matched_counts &&
                  data.matched_counts[hoveredCell.i]?.[hoveredCell.j] > 0 && (
                    <span className="ml-2 text-muted-foreground">
                      ({data.matched_counts[hoveredCell.i][hoveredCell.j]} residues matched)
                    </span>
                  )}
              </div>
            )}

            {/* Errors */}
            {Object.keys(data.errors).length > 0 && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[10px]">
                <div className="font-medium text-amber-700">Download failed:</div>
                {Object.entries(data.errors).map(([id, err]) => (
                  <div key={id} className="font-mono">
                    {id}: {err}
                  </div>
                ))}
              </div>
            )}

            {/* Color scale */}
            <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
              <span>0 Å</span>
              <div
                className="h-2 flex-1 rounded"
                style={{
                  background:
                    "linear-gradient(to right, rgb(16,185,129), rgb(250,204,0), rgb(250,0,0))",
                }}
              />
              <span>{maxRmsd.toFixed(1)} Å</span>
            </div>

            <div className="flex items-start gap-1.5 rounded-md bg-primary/5 p-2 text-[10px] text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
              <div>
                For each PDB's specified chain, CA atoms are pairwise superposed using Kabsch to compute RMSD. N/A indicates &lt;3 common residues (residue numbering mismatch; sequence alignment is required first). The diagonal is self-alignment (0 Å).
              </div>
            </div>
          </div>
        )}

        {!data && !error && !loading && (
          <div className="flex items-start gap-1.5 rounded-md bg-primary/5 p-2 text-[10px] text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
            <div>
              Enter multiple PDB IDs (comma-separated) to compute the pairwise RMSD matrix of chain A CA atoms (Kabsch optimal superposition). Useful for comparing different conformations or mutants of homologous proteins.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
