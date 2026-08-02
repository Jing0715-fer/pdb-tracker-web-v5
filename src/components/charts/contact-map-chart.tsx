"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Grid3x3, RefreshCw, Loader2, Info } from "lucide-react";
import { exportJSON, exportCSV } from "@/components/structure-analysis/chart-export-utils";
import { useAppStore, selectActiveStructure } from "@/lib/molcraft/store";
import { executeCommand } from "@/lib/molcraft/commands";

interface ContactPair {
  res1: string; // "ALA30(A)"
  res2: string; // "VAL112(B)"
  ca_distance_A: number;
}

interface ContactMapData {
  chain1: string;
  chain2: string;
  cutoff: number;
  total_ca_contacts: number;
  contacts: ContactPair[];
}

export function ContactMapChart() {
  const activeStructure = useAppStore(selectActiveStructure);
  const structureFileCache = useAppStore((s) => s.structureFileCache);
  const toast = useAppStore((s) => s.toast);
  const [chain1, setChain1] = useState("A");
  const [chain2, setChain2] = useState("B");
  const [cutoff, setCutoff] = useState(8.0);
  const [data, setData] = useState<ContactMapData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredCell, setHoveredCell] = useState<{ i: number; j: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewer = useAppStore((s) => s.viewer);

  const activeId = activeStructure?.id;
  const isPdbId = activeId ? /^[a-zA-Z0-9]{4}$/.test(activeId) : false;
  const hasFileCache = activeId ? !!structureFileCache[activeId] : false;

  const fetchData = useCallback(async () => {
    if (!activeId) {
      setData(null);
      return;
    }
    const body: Record<string, unknown> = {
      recipe: "contact_map",
      params: { chain1, chain2, cutoff },
    };
    if (isPdbId) {
      body.pdbId = activeId;
    } else if (hasFileCache) {
      body.fileContent = structureFileCache[activeId].content;
      body.fileFormat = structureFileCache[activeId].format;
    } else {
      setError(
        `The current structure (${activeId}) is not a PDB ID and has no local file cache, so contact map analysis cannot run. Please upload a local .pdb/.cif file and try again.`
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
      toast(`Contact map analysis failed: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  }, [activeId, isPdbId, hasFileCache, structureFileCache, chain1, chain2, cutoff, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Build matrix from contacts
  const matrix = (() => {
    if (!data || data.contacts.length === 0) return null;
    // Parse residues to get resno arrays
    const parseRes = (s: string) => {
      const m = s.match(/^(\w+?)(\d+)\(([A-Z])\)$/);
      return m ? { resname: m[1], resno: Number(m[2]), chain: m[3] } : null;
    };
    const res1Set = new Map<number, string>(); // resno -> resname
    const res2Set = new Map<number, string>();
    for (const c of data.contacts) {
      const r1 = parseRes(c.res1);
      const r2 = parseRes(c.res2);
      if (r1) res1Set.set(r1.resno, r1.resname);
      if (r2) res2Set.set(r2.resno, r2.resname);
    }
    const res1List = Array.from(res1Set.keys()).sort((a, b) => a - b);
    const res2List = Array.from(res2Set.keys()).sort((a, b) => a - b);
    // Build distance matrix
    const distMap = new Map<string, number>();
    for (const c of data.contacts) {
      const r1 = parseRes(c.res1);
      const r2 = parseRes(c.res2);
      if (r1 && r2) {
        distMap.set(`${r1.resno},${r2.resno}`, c.ca_distance_A);
      }
    }
    return { res1List, res2List, distMap, res1Set, res2Set };
  })();

  // Draw heatmap
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !matrix) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { res1List, res2List, distMap } = matrix;
    const cellSize = Math.max(3, Math.min(8, 200 / Math.max(res1List.length, res2List.length)));
    const margin = 30;
    const w = margin + res2List.length * cellSize + 10;
    const h = margin + res1List.length * cellSize + 10;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.fillStyle = "#fafafa";
    ctx.fillRect(0, 0, w, h);

    // Draw cells
    const minDist = data?.cutoff ? data.cutoff * 0.4 : 3;
    const maxDist = data?.cutoff ?? 8;

    res1List.forEach((resno1, i) => {
      res2List.forEach((resno2, j) => {
        const dist = distMap.get(`${resno1},${resno2}`);
        const x = margin + j * cellSize;
        const y = margin + i * cellSize;
        if (dist !== undefined) {
          // Color: closer = darker green
          const t = Math.min(1, Math.max(0, (dist - minDist) / (maxDist - minDist)));
          const r = Math.round(16 + (250 - 16) * t);
          const g = Math.round(185 + (204 - 185) * t);
          const b = Math.round(129 + (0 - 129) * t);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fillRect(x, y, cellSize - 0.5, cellSize - 0.5);
        } else {
          ctx.fillStyle = "#f3f4f6";
          ctx.fillRect(x, y, cellSize - 0.5, cellSize - 0.5);
        }
      });
    });

    // Highlight hovered cell
    if (hoveredCell) {
      const { i, j } = hoveredCell;
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(margin + j * cellSize - 0.5, margin + i * cellSize - 0.5, cellSize, cellSize);
    }

    // Axis labels
    ctx.fillStyle = "#6b7280";
    ctx.font = "8px ui-monospace, monospace";
    ctx.textAlign = "center";
    // X axis (chain2) - show every Nth
    const xStep = Math.max(1, Math.floor(res2List.length / 8));
    res2List.forEach((resno, j) => {
      if (j % xStep === 0) {
        ctx.fillText(String(resno), margin + j * cellSize + cellSize / 2, h - 3);
      }
    });
    // Y axis (chain1)
    ctx.textAlign = "right";
    const yStep = Math.max(1, Math.floor(res1List.length / 8));
    res1List.forEach((resno, i) => {
      if (i % yStep === 0) {
        ctx.fillText(String(resno), margin - 3, margin + i * cellSize + cellSize / 2 + 3);
      }
    });

    // Axis titles
    ctx.fillStyle = "#374151";
    ctx.font = "bold 9px ui-sans-serif, system-ui";
    ctx.textAlign = "center";
    ctx.fillText(`Chain ${chain2} residue no. →`, margin + (res2List.length * cellSize) / 2, 10);
    ctx.save();
    ctx.translate(8, margin + (res1List.length * cellSize) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`Chain ${chain1} residue no. →`, 0, 0);
    ctx.restore();
  }, [matrix, data, hoveredCell, chain1, chain2]);

  const handleCanvasMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!matrix) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const cellSize = Math.max(3, Math.min(8, 200 / Math.max(matrix.res1List.length, matrix.res2List.length)));
    const margin = 30;
    const j = Math.floor((x - margin) / cellSize);
    const i = Math.floor((y - margin) / cellSize);
    if (i >= 0 && i < matrix.res1List.length && j >= 0 && j < matrix.res2List.length) {
      setHoveredCell({ i, j });
    } else {
      setHoveredCell(null);
    }
  };

  const handleCanvasClick = async () => {
    if (!matrix || !hoveredCell || !viewer) return;
    const resno1 = matrix.res1List[hoveredCell.i];
    const resname1 = matrix.res1Set.get(resno1) ?? "?";
    try {
      await executeCommand(viewer, {
        type: "focus_residue",
        chain: chain1,
        resno: resno1,
        compId: resname1,
      });
      toast(`Focused ${resname1}${resno1} (${chain1})`, "info");
    } catch {
      toast("Focus failed", "error");
    }
  };

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Grid3x3 className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold">Contact map</span>
          {activeId && (
            <Badge variant="outline" className="truncate font-mono text-[9px]">
              {activeStructure?.label ?? activeId}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {data && (
            <Badge variant="secondary" className="text-[10px]">
              {data.total_ca_contacts} contacts
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
          {data && data.contacts.length > 0 && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => exportJSON(data, "contact-map", activeId ?? undefined)}
                title="Export JSON"
              >
                <span className="text-[8px] font-bold">JS</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => {
                  const csvData = data.contacts.map((c) => ({
                    res1: c.res1,
                    res2: c.res2,
                    ca_distance_A: c.ca_distance_A.toFixed(2),
                  }));
                  exportCSV(csvData, "contact-map", activeId ?? undefined);
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
        <div className="grid grid-cols-3 gap-1.5">
          <div>
            <Label className="text-[9px] text-muted-foreground">Chain 1</Label>
            <Input
              value={chain1}
              onChange={(e) => setChain1(e.target.value.toUpperCase())}
              className="h-7 text-xs font-mono"
              maxLength={2}
            />
          </div>
          <div>
            <Label className="text-[9px] text-muted-foreground">Chain 2</Label>
            <Input
              value={chain2}
              onChange={(e) => setChain2(e.target.value.toUpperCase())}
              className="h-7 text-xs font-mono"
              maxLength={2}
            />
          </div>
          <div>
            <Label className="text-[9px] text-muted-foreground">Cutoff (Å)</Label>
            <Input
              type="number"
              value={cutoff}
              onChange={(e) => setCutoff(Number(e.target.value))}
              step={0.5}
              min={4}
              max={15}
              className="h-7 text-xs font-mono"
            />
          </div>
        </div>

        {loading && <Skeleton className="h-48 w-full" />}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[10px] text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && !data && !activeId && (
          <div className="py-4 text-center text-[11px] text-muted-foreground">
            Load a structure to generate a contact map
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-2">
            {data.total_ca_contacts === 0 ? (
              <div className="rounded-md border border-dashed p-3 text-center text-[11px] text-muted-foreground">
                <Grid3x3 className="mx-auto mb-1 h-5 w-5 text-muted-foreground/40" />
                No inter-chain contacts detected
                <div className="mt-0.5 text-[9px]">
                  (the two chains may be too far apart; try increasing the cutoff distance)
                </div>
              </div>
            ) : (
              <>
                {/* Heatmap */}
                <div className="flex justify-center overflow-x-auto scrollbar-thin">
                  <canvas
                    ref={canvasRef}
                    onMouseMove={handleCanvasMove}
                    onMouseLeave={() => setHoveredCell(null)}
                    onClick={handleCanvasClick}
                    className="rounded-md border bg-white shadow-sm cursor-crosshair"
                  />
                </div>

                {/* Hovered cell info */}
                {hoveredCell && matrix && (
                  <div className="rounded-md border bg-accent/30 px-2 py-1 text-[10px]">
                    {(() => {
                      const resno1 = matrix.res1List[hoveredCell.i];
                      const resno2 = matrix.res2List[hoveredCell.j];
                      const dist = matrix.distMap.get(`${resno1},${resno2}`);
                      const r1name = matrix.res1Set.get(resno1) ?? "?";
                      const r2name = matrix.res2Set.get(resno2) ?? "?";
                      return (
                        <span className="font-mono">
                          {r1name}{resno1}({chain1}) ↔ {r2name}{resno2}({chain2}){" "}
                          {dist !== undefined ? (
                            <span className="font-semibold text-emerald-600">
                              {dist.toFixed(2)} Å
                            </span>
                          ) : (
                            <span className="text-muted-foreground">No contact</span>
                          )}
                          {dist !== undefined && (
                            <span className="ml-2 text-[9px] text-muted-foreground">
                              · Click to focus {r1name}{resno1}
                            </span>
                          )}
                        </span>
                      );
                    })()}
                  </div>
                )}

                {/* Color scale */}
                <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
                  <span>Close</span>
                  <div
                    className="h-2 flex-1 rounded"
                    style={{
                      background:
                        "linear-gradient(to right, rgb(16,185,129), rgb(250,204,0))",
                    }}
                  />
                  <span>Far ({cutoff} Å)</span>
                </div>

                {/* Top contacts list */}
                <div className="space-y-0.5">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Closest contacts (top 10)
                  </div>
                  <div className="max-h-32 overflow-y-auto scrollbar-thin space-y-0.5">
                    {data.contacts.slice(0, 10).map((contact, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] hover:bg-accent/20"
                      >
                        <span className="font-mono font-medium">{contact.res1}</span>
                        <span className="text-muted-foreground">↔</span>
                        <span className="font-mono font-medium">{contact.res2}</span>
                        <Badge variant="outline" className="ml-auto font-mono text-[9px]">
                          {contact.ca_distance_A.toFixed(1)} Å
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-start gap-1.5 rounded-md bg-primary/5 p-2 text-[10px] text-muted-foreground">
                  <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                  <div>
                    Inter-chain CA-CA distance matrix heatmap; green indicates close contacts. Used to identify interface residues and predict mutation effects. Cutoff {cutoff} Å.
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
