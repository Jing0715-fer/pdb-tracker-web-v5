"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Fingerprint, RefreshCw, Loader2, Info } from "lucide-react";
import { exportJSON, exportCSV } from "@/components/structure-analysis/chart-export-utils";
import { useAppStore, selectActiveStructure } from "@/lib/molcraft/store";
import { executeCommand } from "@/lib/molcraft/commands";

interface LigandContact {
  ligand_atom: string;
  chain: string;
  resno: number;
  resname: string;
  atom: string;
  distance_A: number;
  type: string;
}

interface LigandResidueSummary {
  chain: string;
  resno: number;
  resname: string;
  min_distance_A: number;
  n_contacts: number;
  contact_types: string[];
}

interface LigandInteractionsData {
  ligand: string;
  cutoff: number;
  num_ligand_residues: number;
  total_contacts: number;
  total_residues: number;
  type_counts: Record<string, number>;
  residues: LigandResidueSummary[];
  contacts: LigandContact[];
}

const TYPE_META: Record<string, { label: string; color: string; symbol: string }> = {
  "H-bond": { label: "H-bond", color: "#0ea5e9", symbol: "H" },
  hydrophobic: { label: "Hydrophobic", color: "#10b981", symbol: "V" },
  aromatic: { label: "Aromatic", color: "#8b5cf6", symbol: "π" },
  ionic: { label: "Ionic", color: "#f59e0b", symbol: "±" },
  other: { label: "Other", color: "#9ca3af", symbol: "·" },
};

export function LigandInteractionsChart() {
  const activeStructure = useAppStore(selectActiveStructure);
  const structureFileCache = useAppStore((s) => s.structureFileCache);
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const [ligandCompId, setLigandCompId] = useState("REA");
  const [cutoff, setCutoff] = useState(5.0);
  const [data, setData] = useState<LigandInteractionsData | null>(null);
  const [viewMode, setViewMode] = useState<"residues" | "atomic">("residues");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableLigands, setAvailableLigands] = useState<string[] | null>(null);

  const activeId = activeStructure?.id;
  const isPdbId = activeId ? /^[a-zA-Z0-9]{4}$/.test(activeId) : false;
  const hasFileCache = activeId ? !!structureFileCache[activeId] : false;

  const fetchData = useCallback(async () => {
    if (!activeId) {
      setData(null);
      return;
    }
    const body: Record<string, unknown> = {
      recipe: "ligand_interactions",
      params: { ligandCompId: ligandCompId.toUpperCase(), cutoff },
    };
    if (isPdbId) {
      body.pdbId = activeId;
    } else if (hasFileCache) {
      body.fileContent = structureFileCache[activeId].content;
      body.fileFormat = structureFileCache[activeId].format;
    } else {
      setError(
        `The current structure (${activeId}) is not a PDB ID and has no local file cache, so ligand interaction analysis cannot run. Please upload a local .pdb/.cif file and try again.`
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
          if (json.data.available_ligands) {
            setAvailableLigands(json.data.available_ligands);
          }
          setData(null);
        } else {
          setData(json.data);
          setAvailableLigands(null);
        }
      } else {
        setError(json.stderr || "No data returned");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast(`Ligand interaction analysis failed: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  }, [activeId, isPdbId, hasFileCache, structureFileCache, ligandCompId, cutoff, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleFocusResidue = async (residue: LigandResidueSummary) => {
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
          <Fingerprint className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold">Ligand interaction fingerprint</span>
          {activeId && (
            <Badge variant="outline" className="truncate font-mono text-[9px]">
              {activeStructure?.label ?? activeId}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {data && (
            <Badge variant="secondary" className="text-[10px]">
              {data.total_contacts} contacts
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
          {data && data.total_contacts > 0 && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => exportJSON(data, "ligand-interactions", activeId ?? undefined)}
                title="Export JSON"
              >
                <span className="text-[8px] font-bold">JS</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => {
                  const csvData = data.residues.map((r) => ({
                    chain: r.chain,
                    resno: r.resno,
                    resname: r.resname,
                    min_distance_A: r.min_distance_A.toFixed(2),
                    n_contacts: r.n_contacts,
                    contact_types: r.contact_types.join("; "),
                  }));
                  exportCSV(csvData, "ligand-interactions", activeId ?? undefined);
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
            <Label className="text-[10px] text-muted-foreground">Ligand (3-letter)</Label>
            <Input
              value={ligandCompId}
              onChange={(e) => setLigandCompId(e.target.value.toUpperCase())}
              placeholder="REA"
              className="h-8 text-sm font-mono"
              maxLength={6}
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Cutoff (Å)</Label>
            <Input
              type="number"
              value={cutoff}
              onChange={(e) => setCutoff(Number(e.target.value))}
              step={0.5}
              min={3}
              max={10}
              className="h-8 text-sm font-mono"
            />
          </div>
        </div>

        {loading && <Skeleton className="h-32 w-full" />}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[10px] text-destructive">
            {error}
            {availableLigands && availableLigands.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <span className="text-[9px] text-muted-foreground">Available ligands:</span>
                {availableLigands.slice(0, 8).map((lig) => (
                  <button
                    key={lig}
                    onClick={() => setLigandCompId(lig)}
                    className="rounded bg-muted px-1.5 py-0 font-mono text-[9px] hover:bg-accent"
                  >
                    {lig}
                  </button>
                ))}
                {availableLigands.length > 8 && (
                  <span className="text-[9px] text-muted-foreground">
                    +{availableLigands.length - 8}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {!loading && !error && !data && !activeId && (
          <div className="py-4 text-center text-[11px] text-muted-foreground">
            Load a structure to analyze ligand interactions
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-2">
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded-md border bg-primary/5 p-2 text-center">
                <div className="text-[9px] uppercase text-muted-foreground">Total contacts</div>
                <div className="font-mono text-base font-bold text-primary">
                  {data.total_contacts}
                </div>
              </div>
              <div className="rounded-md border bg-amber-500/5 p-2 text-center">
                <div className="text-[9px] uppercase text-muted-foreground">Contact residues</div>
                <div className="font-mono text-base font-bold text-amber-600">
                  {data.total_residues}
                </div>
              </div>
            </div>

            {/* Contact type breakdown */}
            {Object.keys(data.type_counts).length > 0 && (
              <div>
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Contact type distribution
                </div>
                <div className="flex h-5 overflow-hidden rounded border">
                  {Object.entries(data.type_counts).map(([type, count]) => {
                    const meta = TYPE_META[type] ?? TYPE_META.other;
                    const pct = data.total_contacts > 0 ? (count / data.total_contacts) * 100 : 0;
                    if (pct === 0) return null;
                    return (
                      <div
                        key={type}
                        className="flex items-center justify-center text-[8px] font-bold text-white"
                        style={{ width: `${pct}%`, backgroundColor: meta.color }}
                        title={`${meta.label}: ${count} (${pct.toFixed(0)}%)`}
                      >
                        {pct >= 15 ? meta.symbol : ""}
                      </div>
                    );
                  })}
                </div>
                {/* Legend */}
                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                  {Object.entries(data.type_counts)
                    .filter(([, count]) => count > 0)
                    .map(([type, count]) => {
                      const meta = TYPE_META[type] ?? TYPE_META.other;
                      return (
                        <div key={type} className="flex items-center gap-1 text-[9px]">
                          <span
                            className="h-2 w-2 rounded-sm"
                            style={{ backgroundColor: meta.color }}
                          />
                          <span className="text-muted-foreground">{meta.label}</span>
                          <span className="font-mono">{count}</span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* View mode toggle */}
            <div className="flex items-center gap-1 rounded-md border bg-muted/20 p-0.5">
              <button
                onClick={() => setViewMode("residues")}
                className={`flex-1 rounded px-2 py-0.5 text-[10px] font-medium transition ${
                  viewMode === "residues"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent"
                }`}
              >
                Residue view ({data.total_residues})
              </button>
              <button
                onClick={() => setViewMode("atomic")}
                className={`flex-1 rounded px-2 py-0.5 text-[10px] font-medium transition ${
                  viewMode === "atomic"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent"
                }`}
              >
                Atomic view ({data.total_contacts})
              </button>
            </div>

            {/* Residue contact list (residue view) */}
            {viewMode === "residues" && (
            <div className="space-y-1">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Contact residues (click to focus, sorted by distance)
              </div>
              <div className="max-h-44 overflow-y-auto scrollbar-thin space-y-0.5">
                {data.residues.map((residue, i) => {
                  const primaryType = residue.contact_types[0] ?? "other";
                  const meta = TYPE_META[primaryType] ?? TYPE_META.other;
                  return (
                    <button
                      key={i}
                      onClick={() => handleFocusResidue(residue)}
                      className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left transition hover:bg-accent/30"
                    >
                      <span
                        className="grid h-5 w-5 shrink-0 place-items-center rounded text-[9px] font-bold text-white"
                        style={{ backgroundColor: meta.color }}
                        title={meta.label}
                      >
                        {meta.symbol}
                      </span>
                      <span className="font-mono text-[10px] font-medium">
                        {residue.resname}{residue.resno}
                      </span>
                      <span className="text-[9px] text-muted-foreground">
                        ({residue.chain})
                      </span>
                      <div className="flex gap-0.5">
                        {residue.contact_types.map((ct, j) => {
                          const ctMeta = TYPE_META[ct] ?? TYPE_META.other;
                          return (
                            <span
                              key={j}
                              className="rounded px-0.5 text-[8px] text-white"
                              style={{ backgroundColor: ctMeta.color }}
                              title={ctMeta.label}
                            >
                              {ctMeta.symbol}
                            </span>
                          );
                        })}
                      </div>
                      <span className="text-[9px] text-muted-foreground">
                        {residue.n_contacts} contacts
                      </span>
                      <Badge variant="outline" className="ml-auto font-mono text-[9px]">
                        {residue.min_distance_A.toFixed(1)} Å
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </div>
            )}

            {/* Atomic contacts list (atomic view) */}
            {viewMode === "atomic" && (
            <div className="space-y-1">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Atomic contacts (sorted by distance, top 30)
              </div>
              <div className="max-h-44 overflow-y-auto scrollbar-thin space-y-0.5">
                {data.contacts.slice(0, 30).map((contact, i) => {
                  const meta = TYPE_META[contact.type] ?? TYPE_META.other;
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] hover:bg-accent/20"
                    >
                      <span
                        className="grid h-4 w-4 shrink-0 place-items-center rounded text-[8px] font-bold text-white"
                        style={{ backgroundColor: meta.color }}
                        title={meta.label}
                      >
                        {meta.symbol}
                      </span>
                      <span className="font-mono text-[9px] text-primary font-medium">
                        {contact.ligand_atom}
                      </span>
                      <span className="text-muted-foreground">→</span>
                      <span className="font-mono text-[10px] font-medium">
                        {contact.resname}{contact.resno}
                      </span>
                      <span className="text-[9px] text-muted-foreground">
                        .{contact.atom}
                      </span>
                      <Badge variant="outline" className="ml-auto font-mono text-[9px]">
                        {contact.distance_A.toFixed(2)} Å
                      </Badge>
                    </div>
                  );
                })}
              </div>
              {data.contacts.length > 30 && (
                <div className="text-center text-[9px] text-muted-foreground">
                  +{data.contacts.length - 30} more contacts
                </div>
              )}
            </div>
            )}

            <div className="flex items-start gap-1.5 rounded-md bg-primary/5 p-2 text-[10px] text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
              <div>
                Atomic-level contacts within {data.cutoff} Å of ligand {data.ligand}. H=H-bond, V=hydrophobic, π=aromatic, ±=ionic. The fingerprint is used for drug-likeness comparison and SAR analysis.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
