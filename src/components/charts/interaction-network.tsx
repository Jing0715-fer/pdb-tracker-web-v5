"use client";

/**
 * Interaction Network — displays the non-covalent interaction network between
 * two chains as a filterable list with click-to-focus-and-draw.
 *
 * Faithfully ported from Molcraft (src/components/charts/interaction-network.tsx).
 * Differences from Molcraft:
 *   - Import paths adjusted: @/lib/store → @/lib/molcraft/store,
 *     @/lib/molstar/measure → @/lib/molcraft/measure,
 *     @/lib/structure-utils → @/lib/molcraft/structure-utils.
 *   - UI palette uses claude-* tokens instead of Tailwind defaults to match
 *     the pdb-tracker-web-v5 theme.
 *
 * Runs the `all_interactions` Biopython recipe, then renders:
 *   - Chain1/Chain2 inputs + refresh button
 *   - Filter tabs (all / salt_bridge / hbond / hydrophobic) with counts
 *   - Interaction list — each row has a "画线" (draw line) button that:
 *     1. Finds both atoms' xyz coords from the PDB text via findAtomCoord
 *     2. Clears existing interaction state + measurements
 *     3. Shows ball-and-stick for clickable atoms via showAtomsForInteraction
 *     4. Adds an interactionLine (dashed, colored by type) with the distance label
 *     5. Focuses the camera on the midpoint between the two atoms
 */

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Network, RefreshCw, Info, Ruler, Zap, Link2, Droplets } from "lucide-react";
import { useAppStore, selectActiveStructure } from "@/lib/molcraft/store";
import { clearInteractionState, showAtomsForInteraction } from "@/lib/molcraft/measure";
import { findAtomCoord } from "@/lib/molcraft/structure-utils";

interface Interaction {
  type: "salt_bridge" | "hbond" | "hydrophobic";
  chain1: string;
  resno1: number;
  resname1: string;
  atom1: string;
  chain2: string;
  resno2: number;
  resname2: string;
  atom2: string;
  distance_A: number;
}

interface AllInteractionsData {
  chain1: string;
  chain2: string;
  total: number;
  salt_bridges: number;
  hbonds: number;
  hydrophobic: number;
  interactions: Interaction[];
}

const TYPE_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  salt_bridge: { label: "Salt bridge", color: "#f59e0b", icon: <Zap className="h-3 w-3" /> },
  hbond: { label: "H-bond", color: "#0ea5e9", icon: <Link2 className="h-3 w-3" /> },
  hydrophobic: { label: "Hydrophobic", color: "#10b981", icon: <Droplets className="h-3 w-3" /> },
};

type FilterType = "all" | "salt_bridge" | "hbond" | "hydrophobic";

export function InteractionNetwork() {
  const activeStructure = useAppStore(selectActiveStructure);
  const structureFileCache = useAppStore((s) => s.structureFileCache);
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const setInteractionLines = useAppStore((s) => s.setInteractionLines);
  const clearInteractionLines = useAppStore((s) => s.clearInteractionLines);
  const clearMeasurements = useAppStore((s) => s.clearMeasurements);
  const [chain1, setChain1] = useState("A");
  const [chain2, setChain2] = useState("B");
  const [data, setData] = useState<AllInteractionsData | null>(null);
  const [loading, setLoading] = useState(false);

  // Auto-detect available chains from the active structure's metadata.
  // When the structure changes, update chain1/chain2 to valid values:
  // - If only 1 chain: set both to that chain (intra-chain analysis)
  // - If 2+ chains: keep chain1=A, set chain2 to the second chain
  const availableChains: string[] = activeStructure?.metadata?.chains ?? [];
  useEffect(() => {
    if (availableChains.length === 0) return;
    if (availableChains.length === 1) {
      setChain1(availableChains[0]);
      setChain2(availableChains[0]);
    } else {
      // If current chain1 isn't available, pick the first available
      if (!availableChains.includes(chain1)) setChain1(availableChains[0]);
      // If current chain2 isn't available, pick the second chain
      if (!availableChains.includes(chain2)) setChain2(availableChains[1] ?? availableChains[0]);
    }
  }, [availableChains.join(",")]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [drawingIdx, setDrawingIdx] = useState<number | null>(null);

  const activeId = activeStructure?.id;
  const isPdbId = activeId ? /^[a-zA-Z0-9]{4}$/.test(activeId) : false;
  const hasFileCache = activeId ? !!structureFileCache[activeId] : false;

  const fetchData = useCallback(async () => {
    if (!activeId) {
      setData(null);
      return;
    }
    const body: Record<string, unknown> = {
      recipe: "all_interactions",
      params: { chain1, chain2 },
    };
    if (isPdbId) {
      body.pdbId = activeId;
    } else if (hasFileCache) {
      body.fileContent = structureFileCache[activeId].content;
      body.fileFormat = structureFileCache[activeId].format;
    } else {
      setError(
        `Structure (${activeId}) is not a PDB ID and has no local file cache — cannot run interaction analysis.`
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
      toast(`Interaction analysis failed: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  }, [activeId, isPdbId, hasFileCache, structureFileCache, chain1, chain2, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleFocusInteraction = async (interaction: Interaction, idx: number) => {
    if (!viewer) return;
    if (drawingIdx !== null) return;
    setDrawingIdx(idx);
    try {
      const plugin = viewer.plugin;
      const pdbText =
        activeStructure?.pdbText ??
        (activeId ? structureFileCache[activeId]?.content : undefined) ??
        "";

      const coord1 = findAtomCoord(pdbText, {
        chain: interaction.chain1,
        resno: interaction.resno1,
        resname: interaction.resname1,
        atomName: interaction.atom1,
      });
      const coord2 = findAtomCoord(pdbText, {
        chain: interaction.chain2,
        resno: interaction.resno2,
        resname: interaction.resname2,
        atomName: interaction.atom2,
      });

      clearInteractionState(plugin);
      clearInteractionLines();
      clearMeasurements();
      await showAtomsForInteraction(plugin);

      if (coord1 && coord2) {
        const meta = TYPE_META[interaction.type];
        setInteractionLines([
          {
            from: { ...coord1, label: `${interaction.resname1}${interaction.resno1}(${interaction.chain1})/${interaction.atom1}` },
            to: { ...coord2, label: `${interaction.resname2}${interaction.resno2}(${interaction.chain2})/${interaction.atom2}` },
            color: meta.color,
            label: `${interaction.distance_A.toFixed(2)} Å`,
            dashed: true,
          },
        ]);

        // Focus the camera on the midpoint of the two atoms so the user
        // actually sees the interaction being drawn. We use focusSphere with
        // a modest radius (distance between atoms + 8Å padding).
        try {
          const mid = [
            (coord1.x + coord2.x) / 2,
            (coord1.y + coord2.y) / 2,
            (coord1.z + coord2.z) / 2,
          ];
          const dist = Math.sqrt(
            (coord2.x - coord1.x) ** 2 +
            (coord2.y - coord1.y) ** 2 +
            (coord2.z - coord1.z) ** 2
          );
          const radius = Math.max(12, dist + 8);
          plugin.managers.camera.focusSphere({ center: mid, radius });
        } catch (e) {
          console.warn("[handleFocusInteraction] camera focus failed:", e);
        }
      }

      plugin.canvas3d?.requestDraw?.();

      toast(`Focused ${interaction.resname1}${interaction.resno1} ↔ ${interaction.resname2}${interaction.resno2}`, "info");
    } catch (err) {
      console.error("[handleFocusInteraction] failed:", err);
      toast("Focus failed", "error");
    } finally {
      setDrawingIdx(null);
    }
  };

  const filteredInteractions = data?.interactions?.filter(
    (i) => filter === "all" || i.type === filter
  ) ?? [];

  return (
    <div className="rounded-lg border border-claude-border-light/60 dark:border-[#3d3832]/60 bg-claude-surface dark:bg-[#242220] shadow-sm">
      <div className="flex items-center justify-between border-b border-claude-border-light/40 dark:border-[#3d3832]/40 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Network className="h-4 w-4 shrink-0 text-claude-accent" />
          <span className="text-sm font-semibold text-claude-text">Interaction Network</span>
          {activeId && (
            <Badge variant="outline" className="truncate font-mono text-[9px] bg-claude-accent-light text-claude-accent border-claude-accent/30">
              {activeStructure?.label ?? activeId}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {data && (
            <Badge variant="secondary" className="text-[10px]">
              {data.total} total
            </Badge>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={fetchData} disabled={loading} title="Re-run analysis">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="space-y-2 p-3">
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <Label className="text-[9px] text-claude-text-muted">Chain 1</Label>
            {availableChains.length > 0 ? (
              <select
                value={chain1}
                onChange={(e) => setChain1(e.target.value)}
                className="h-7 w-full text-xs rounded-md border border-claude-border-light/60 dark:border-[#3d3832]/60 bg-claude-bg dark:bg-[#1a1917] px-1.5"
              >
                {availableChains.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            ) : (
              <Input value={chain1} onChange={(e) => setChain1(e.target.value.toUpperCase())} className="h-7 text-xs" maxLength={2} />
            )}
          </div>
          <div>
            <Label className="text-[9px] text-claude-text-muted">Chain 2</Label>
            {availableChains.length > 0 ? (
              <select
                value={chain2}
                onChange={(e) => setChain2(e.target.value)}
                className="h-7 w-full text-xs rounded-md border border-claude-border-light/60 dark:border-[#3d3832]/60 bg-claude-bg dark:bg-[#1a1917] px-1.5"
              >
                {availableChains.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            ) : (
              <Input value={chain2} onChange={(e) => setChain2(e.target.value.toUpperCase())} className="h-7 text-xs" maxLength={2} />
            )}
          </div>
        </div>
        {chain1 === chain2 && (
          <div className="rounded-md bg-claude-accent-light/30 border border-claude-accent/20 px-2 py-1 text-[9px] text-claude-text-muted">
            <Info className="inline h-2.5 w-2.5 mr-1 text-claude-accent" />
            Intra-chain analysis (chain {chain1} ↔ itself). all_interactions includes same-chain contacts.
          </div>
        )}

        {loading && <Skeleton className="h-24 w-full" />}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[10px] text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && !data && !activeId && (
          <div className="py-4 text-center text-[11px] text-claude-text-muted">
            Load a structure to analyze interactions
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-2">
            {/* Filter tabs */}
            <div className="flex items-center gap-1 flex-wrap">
              <button
                onClick={() => setFilter("all")}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  filter === "all" ? "bg-claude-accent text-white" : "bg-claude-bg dark:bg-[#1a1917] text-claude-text-muted hover:bg-claude-accent-light/40"
                }`}
              >
                All ({data.total})
              </button>
              <button
                onClick={() => setFilter("salt_bridge")}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors flex items-center gap-0.5 ${
                  filter === "salt_bridge" ? "bg-amber-500 text-white" : "bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20"
                }`}
              >
                <Zap className="h-2.5 w-2.5" /> Salt ({data.salt_bridges})
              </button>
              <button
                onClick={() => setFilter("hbond")}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors flex items-center gap-0.5 ${
                  filter === "hbond" ? "bg-sky-500 text-white" : "bg-sky-500/10 text-sky-700 dark:text-sky-400 hover:bg-sky-500/20"
                }`}
              >
                <Link2 className="h-2.5 w-2.5" /> H-bond ({data.hbonds})
              </button>
              <button
                onClick={() => setFilter("hydrophobic")}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors flex items-center gap-0.5 ${
                  filter === "hydrophobic" ? "bg-emerald-500 text-white" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20"
                }`}
              >
                <Droplets className="h-2.5 w-2.5" /> Hydrophobic ({data.hydrophobic})
              </button>
            </div>

            {/* Interaction list */}
            <div className="space-y-1">
              <div className="text-[10px] font-medium uppercase tracking-wide text-claude-text-muted">
                Interactions (click to focus + draw line)
              </div>
              <div className="max-h-56 overflow-y-auto sa-scroll space-y-1">
                {filteredInteractions.length === 0 ? (
                  <div className="rounded-md border border-dashed border-claude-border-light/60 dark:border-[#3d3832]/60 p-3 text-center text-[11px] text-claude-text-muted">
                    No interactions for this filter
                  </div>
                ) : (
                  filteredInteractions.map((interaction, i) => {
                    const meta = TYPE_META[interaction.type];
                    return (
                      <div
                        key={i}
                        className="rounded-md border border-claude-border-light/40 dark:border-[#3d3832]/40 bg-claude-bg/40 dark:bg-[#1a1917]/40 p-1.5 transition hover:border-claude-accent/50"
                      >
                        <div className="flex items-center gap-1.5 text-[10px]">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleFocusInteraction(interaction, i); }}
                            disabled={drawingIdx !== null}
                            className="flex flex-1 min-w-0 items-center gap-1.5 text-left hover:bg-claude-accent-light/30 rounded px-0.5 disabled:opacity-50"
                            title="Focus and draw line"
                          >
                            <span className="shrink-0" style={{ color: meta.color }}>{meta.icon}</span>
                            <span className="font-mono font-semibold truncate text-claude-text">
                              {interaction.resname1}{interaction.resno1}({interaction.chain1})
                            </span>
                            <span className="text-claude-text-muted">↔</span>
                            <span className="font-mono font-semibold truncate text-claude-text">
                              {interaction.resname2}{interaction.resno2}({interaction.chain2})
                            </span>
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleFocusInteraction(interaction, i); }}
                            disabled={drawingIdx !== null}
                            className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25 disabled:opacity-50 transition-colors"
                            title="Focus and draw distance line"
                          >
                            {drawingIdx === i ? (
                              <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                            ) : (
                              <span className="flex items-center gap-0.5">
                                <Ruler className="h-2.5 w-2.5" />
                                Draw
                              </span>
                            )}
                          </button>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1 pl-5 text-[9px]">
                          <Badge variant="outline" className="font-mono text-[9px]" style={{ backgroundColor: meta.color + "10", color: meta.color, borderColor: meta.color + "40" }}>
                            {meta.label}
                          </Badge>
                          <Badge variant="outline" className="font-mono text-[9px] bg-claude-bg dark:bg-[#1a1917]">
                            {interaction.atom1}↔{interaction.atom2}: {interaction.distance_A.toFixed(2)}Å
                          </Badge>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="flex items-start gap-1.5 rounded-md bg-claude-accent-light/30 p-2 text-[10px] text-claude-text-muted border border-claude-accent/20">
              <Info className="mt-0.5 h-3 w-3 shrink-0 text-claude-accent" />
              <div>
                Interaction types: salt bridge (ARG/LYS/HIS ↔ ASP/GLU, &lt;4.0Å), hydrogen bond (donor-acceptor, &lt;3.5Å), hydrophobic (hydrophobic residue C-C, &lt;4.5Å). Click a list item to focus the camera and draw a distance line in the 3D viewer.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
