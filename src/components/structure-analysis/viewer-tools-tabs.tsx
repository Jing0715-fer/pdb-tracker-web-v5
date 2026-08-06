"use client";

/**
 * viewer-tools-tabs
 *
 * Self-contained tool tabs that live inside the PdbViewerModal side panel.
 * Faithfully ports Molcraft's tools-panel.tsx tabs (Display / Interactions /
 * Export / Volume / Visualization) into the modal context, using the
 * pdb-tracker's `@/lib/molcraft/*` modules.
 *
 * Unlike Molcraft (which reads the active PDB from `structures[0]?.id`),
 * these components take an explicit `pdbId` prop because the modal can
 * preview any PDB regardless of what's loaded in the full Analysis module.
 */

import { useState, useRef } from "react";
import {
  Palette, Zap, Download, Upload, Loader2, Trash2, Box,
  Microscope, FlaskConical, ShieldCheck, Atom, Camera, RotateCcw, Copy,
  FileBox, Link2, Dna, Crosshair,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/lib/molcraft/store";
import { executeCommand } from "@/lib/molcraft/commands";
import { extractAtomInfoFromLoci } from "@/lib/molcraft/measure";
import {
  REPRESENTATION_PRESETS,
  COLOR_THEMES,
  SELECTION_GRANULARITY,
  COLOR_SWATCHES,
  SNAPSHOT_TYPES,
} from "@/lib/molcraft/presets";
import type { LlmCommand, ResidueRef } from "@/lib/molcraft/command-schema";

// ============================================================
// shared helpers
// ============================================================

function useRunCommand() {
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const logCommand = useAppStore((s) => s.logCommand);
  const [busy, setBusy] = useState(false);

  const run = async (cmd: LlmCommand) => {
    if (!viewer) {
      toast("Viewer not ready", "error");
      return null;
    }
    setBusy(true);
    try {
      const res = await executeCommand(viewer, cmd);
      logCommand({ type: cmd.type, ok: res.ok, detail: res.detail });
      if (res.ok) {
        toast(res.detail ?? "Done", "success");
      } else {
        toast(res.detail ?? "Failed", "error");
      }
      return res;
    } finally {
      setBusy(false);
    }
  };

  return { run, busy };
}

function SectionTitle({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="mb-2 mt-3 flex items-center gap-1.5 first:mt-0">
      <div className="h-3 w-1 rounded-full bg-claude-accent" />
      {icon}
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-claude-text-muted">
        {children}
      </h3>
    </div>
  );
}

function ResidueInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ResidueRef;
  onChange: (v: ResidueRef) => void;
}) {
  return (
    <div className="rounded-lg border border-claude-border-light/60 dark:border-[#3d3832]/60 p-2 bg-claude-bg/40 dark:bg-[#1a1917]/40">
      <div className="mb-1.5 text-[11px] font-medium text-claude-text-muted">{label}</div>
      <div className="grid grid-cols-3 gap-1.5">
        <div>
          <Label className="text-[10px] text-claude-text-muted">Chain</Label>
          <Input
            value={value.chain ?? ""}
            onChange={(e) => onChange({ ...value, chain: e.target.value || undefined })}
            placeholder="A"
            className="h-8 text-xs font-mono"
          />
        </div>
        <div>
          <Label className="text-[10px] text-claude-text-muted">ResNo</Label>
          <Input
            type="number"
            value={value.resno ?? ""}
            onChange={(e) =>
              onChange({ ...value, resno: e.target.value ? Number(e.target.value) : undefined })
            }
            placeholder="145"
            className="h-8 text-xs font-mono"
          />
        </div>
        <div>
          <Label className="text-[10px] text-claude-text-muted">Atom</Label>
          <Input
            value={value.atom ?? ""}
            onChange={(e) => onChange({ ...value, atom: e.target.value || undefined })}
            placeholder="CA"
            className="h-8 text-xs font-mono"
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Display tab
// ============================================================

export function DisplayTab() {
  const { run, busy } = useRunCommand();
  const [preset, setPreset] = useState("polymer-and-ligand");
  const [colorTheme, setColorTheme] = useState("chain");
  const [uniformColor, setUniformColor] = useState("#c96442");
  const [granularity, setGranularity] = useState("residue");
  const [spin, setSpin] = useState(false);
  const [spinSpeed, setSpinSpeed] = useState(0.3);
  const [rock, setRock] = useState(false);

  return (
    <div className="space-y-2 p-3">
      <SectionTitle icon={<Palette className="h-3 w-3 text-claude-accent" />}>Representation</SectionTitle>
      <Select value={preset} onValueChange={setPreset}>
        <SelectTrigger className="h-9 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {REPRESENTATION_PRESETS.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              <div className="flex flex-col">
                <span className="font-medium">{p.label}</span>
                <span className="text-[11px] text-claude-text-muted">
                  {p.description}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        className="w-full h-8 text-xs"
        disabled={busy}
        onClick={() => run({ type: "set_representation", preset, structures: "all" })}
      >
        {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
        Apply Representation
      </Button>

      <SectionTitle icon={<Palette className="h-3 w-3 text-claude-accent" />}>Color Theme</SectionTitle>
      <Select value={colorTheme} onValueChange={setColorTheme}>
        <SelectTrigger className="h-9 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {COLOR_THEMES.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              <div className="flex flex-col">
                <span className="font-medium">{c.label}</span>
                <span className="text-[11px] text-claude-text-muted">
                  {c.description}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        variant="secondary"
        className="w-full h-8 text-xs"
        disabled={busy}
        onClick={() => run({ type: "set_color_theme", theme: colorTheme, structures: "all" })}
      >
        Apply Color Theme
      </Button>

      <SectionTitle icon={<Palette className="h-3 w-3 text-claude-accent" />}>Uniform Color</SectionTitle>
      <div className="grid grid-cols-4 gap-1.5">
        {COLOR_SWATCHES.slice(0, 12).map((c) => {
          const hex = `#${c.value.toString(16).padStart(6, "0")}`;
          return (
            <button
              key={c.value}
              onClick={() => setUniformColor(hex)}
              className={`aspect-square rounded-md border-2 transition ${
                uniformColor === hex
                  ? "border-claude-accent"
                  : "border-transparent hover:border-claude-text-muted/50"
              }`}
              style={{ backgroundColor: hex }}
              title={c.name}
            />
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="color"
          value={uniformColor}
          onChange={(e) => setUniformColor(e.target.value)}
          className="h-9 w-12 cursor-pointer p-1"
        />
        <Input
          value={uniformColor}
          onChange={(e) => setUniformColor(e.target.value)}
          className="h-9 flex-1 font-mono text-xs"
        />
        <Button
          size="sm"
          variant="secondary"
          className="h-9 text-xs"
          disabled={busy}
          onClick={() => run({ type: "set_uniform_color", color: uniformColor, structures: "all" })}
        >
          Apply
        </Button>
      </div>

      <SectionTitle icon={<Palette className="h-3 w-3 text-claude-accent" />}>Selection Granularity</SectionTitle>
      <Select value={granularity} onValueChange={(v) => { setGranularity(v); run({ type: "set_granularity", granularity: v }); }}>
        <SelectTrigger className="h-9 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SELECTION_GRANULARITY.map((g) => (
            <SelectItem key={g.id} value={g.id}>
              {g.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <SectionTitle icon={<Palette className="h-3 w-3 text-claude-accent" />}>Animation</SectionTitle>
      <div className="space-y-2 rounded-lg border border-claude-border-light/60 dark:border-[#3d3832]/60 p-3 bg-claude-bg/40 dark:bg-[#1a1917]/40">
        <div className="flex items-center justify-between">
          <Label htmlFor="spin" className="text-xs">Spin</Label>
          <Switch
            id="spin"
            checked={spin}
            onCheckedChange={(v) => {
              setSpin(v);
              setRock(false);
              run({ type: v ? "toggle_spin" : "stop_animation", speed: spinSpeed });
            }}
          />
        </div>
        {spin && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-claude-text-muted w-10">Speed</span>
            <Slider
              value={[spinSpeed]}
              min={0.05}
              max={2}
              step={0.05}
              onValueChange={(v) => setSpinSpeed(v[0])}
              className="flex-1"
            />
            <span className="w-10 text-right font-mono text-[11px]">
              {spinSpeed.toFixed(2)}
            </span>
          </div>
        )}
        <Separator />
        <div className="flex items-center justify-between">
          <Label htmlFor="rock" className="text-xs">Rock</Label>
          <Switch
            id="rock"
            checked={rock}
            onCheckedChange={(v) => {
              setRock(v);
              setSpin(false);
              run({ type: v ? "toggle_rock" : "stop_animation" });
            }}
          />
        </div>
      </div>

      <SectionTitle icon={<Camera className="h-3 w-3 text-claude-accent" />}>Camera</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => run({ type: "reset_camera" })}>
          <RotateCcw className="h-3 w-3" />
          Reset
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => run({ type: "focus_selection" })}>
          Focus Selection
        </Button>
      </div>
    </div>
  );
}

// ============================================================
// Interactions tab
// ============================================================

export function InteractionsTab({ pdbId }: { pdbId: string }) {
  const { run, busy } = useRunCommand();
  const [target, setTarget] = useState<ResidueRef>({ chain: "A", resno: 145 });
  const [radius, setRadius] = useState(8);

  const [analysisChain1, setAnalysisChain1] = useState("A");
  const [analysisChain2, setAnalysisChain2] = useState("B");
  const [analysisSummary, setAnalysisSummary] = useState<string | null>(null);
  const [analysisRows, setAnalysisRows] = useState<Array<{
    type: string;
    chain1?: string; resno1?: number; resname1?: string; atom1?: string;
    chain2?: string; resno2?: number; resname2?: string; atom2?: string;
    distance_A?: number;
  }>>([]);
  const [sortKey, setSortKey] = useState<"distance_A" | "type" | "resno1">("distance_A");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [analysisKind, setAnalysisKind] = useState<
    "hbonds" | "salt_bridges" | "hydrophobic_contacts" | "all_interactions" | null
  >(null);

  const runDetailedAnalysis = async (
    recipe: "hbonds" | "salt_bridges" | "hydrophobic_contacts" | "all_interactions"
  ) => {
    if (!pdbId) {
      useAppStore.getState().toast("No PDB loaded", "error");
      return;
    }
    setAnalysisKind(recipe);
    setAnalysisSummary(null);
    setAnalysisRows([]);
    try {
      const res = await fetch("/api/analyze/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pdbId,
          recipe,
          params: {
            chain1: analysisChain1,
            chain2: analysisChain2,
            ...(recipe === "hbonds"
              ? { distanceCutoff: 3.5 }
              : recipe === "all_interactions"
              ? {}
              : { cutoff: recipe === "salt_bridges" ? 4.0 : 4.5 }),
          },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.data) {
        const d = data.data;
        if (recipe === "hbonds") {
          setAnalysisSummary(
            `Hydrogen bonds: ${d.total_hbonds}` +
              (d.top_residue_pairs?.length
                ? `\nTop residue pairs:\n${(d.top_residue_pairs || [])
                    .slice(0, 5)
                    .map((p: { pair: string; count: number }) => `  ${p.pair}: ${p.count}`)
                    .join("\n")}`
                : "")
          );
          setAnalysisRows((d.hbonds || []).map((b: any) => ({
            type: "hbond",
            chain1: b.chain1, resno1: b.resno1, resname1: b.resname1, atom1: b.atom1,
            chain2: b.chain2, resno2: b.resno2, resname2: b.resname2, atom2: b.atom2,
            distance_A: b.distance_A,
          })));
        } else if (recipe === "salt_bridges") {
          setAnalysisSummary(`Salt bridges: ${d.total_salt_bridges}`);
          setAnalysisRows((d.salt_bridges || []).map((b: any) => ({
            type: "salt_bridge",
            chain1: b.pos_chain, resno1: b.pos_resno, resname1: b.pos_resname, atom1: b.pos_atom || b.atom1,
            chain2: b.neg_chain, resno2: b.neg_resno, resname2: b.neg_resname, atom2: b.neg_atom || b.atom2,
            distance_A: b.distance_A,
          })));
        } else if (recipe === "hydrophobic_contacts") {
          setAnalysisSummary(
            `Atom contacts: ${d.total_atom_contacts}\nResidue pairs: ${d.total_residue_pairs}`
          );
          setAnalysisRows((d.hydrophobic_contacts || d.contacts || []).map((b: any) => ({
            type: "hydrophobic",
            chain1: b.chain1, resno1: b.resno1, resname1: b.resname1, atom1: b.atom1,
            chain2: b.chain2, resno2: b.resno2, resname2: b.resname2, atom2: b.atom2,
            distance_A: b.distance_A,
          })));
        } else if (recipe === "all_interactions") {
          // Recipe now returns numeric counts (matching Molcraft form):
          //   d.salt_bridges (number), d.hbonds (number), d.hydrophobic (number)
          //   d.interactions (array of atom-level contact objects)
          const hb = typeof d.hbonds === "number" ? d.hbonds : (d.hbonds?.total_hbonds ?? 0);
          const sb = typeof d.salt_bridges === "number" ? d.salt_bridges : (d.salt_bridges?.total_salt_bridges ?? 0);
          const hp = typeof d.hydrophobic === "number" ? d.hydrophobic : (d.hydrophobic_contacts?.total_residue_pairs ?? 0);
          setAnalysisSummary(
            `All interactions:\n  Hydrogen bonds: ${hb}\n  Salt bridges: ${sb}\n  Hydrophobic: ${hp}\n  Total atom-level: ${d.total ?? 0}`
          );
          setAnalysisRows(d.interactions || []);
        }
      } else {
        setAnalysisSummary(`No data (stderr: ${data.stderr ?? "none"})`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAnalysisSummary(`Error: ${msg}`);
    } finally {
      setAnalysisKind(null);
    }
  };

  const sortedRows = [...analysisRows].sort((a, b) => {
    let cmp = 0;
    if (sortKey === "distance_A") {
      cmp = (a.distance_A ?? 999) - (b.distance_A ?? 999);
    } else if (sortKey === "type") {
      cmp = (a.type || "").localeCompare(b.type || "");
    } else if (sortKey === "resno1") {
      cmp = (a.resno1 ?? 0) - (b.resno1 ?? 0);
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const exportRowsCSV = () => {
    if (sortedRows.length === 0) return;
    const header = "type,chain1,resno1,resname1,atom1,chain2,resno2,resname2,atom2,distance_A";
    const rows = sortedRows.map(r =>
      [r.type, r.chain1, r.resno1, r.resname1, r.atom1, r.chain2, r.resno2, r.resname2, r.atom2, r.distance_A]
        .map(v => `"${String(v ?? "").replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [header, ...rows].join("\n");
    navigator.clipboard.writeText(csv).then(
      () => useAppStore.getState().toast(`Copied ${rows.length} rows as CSV`, "success"),
      () => useAppStore.getState().toast("Copy failed", "error")
    );
  };

  // 3D contacts visualization state + drawer
  const viewer = useAppStore((s) => s.viewer);
  const addInteractionLine = useAppStore((s) => s.addInteractionLine);
  const clearInteractionLines = useAppStore((s) => s.clearInteractionLines);
  const [vizBusy, setVizBusy] = useState(false);

  const CONTACT_COLORS: Record<string, string> = {
    salt_bridge: "#f59e0b",   // amber
    hbond: "#0ea5e9",         // sky
    hydrophobic: "#10b981",   // emerald
  };

  /** Draw contact lines in 3D by looking up each atom's coords via the
   *  Molstar structure. Uses the `select` command to set the selection
   *  to each atom, then reads the loci back from the selection manager
   *  and extracts xyz via extractAtomInfoFromLoci. */
  const drawContacts3D = async (rows: typeof analysisRows) => {
    if (!viewer || rows.length === 0) {
      useAppStore.getState().toast("No viewer or no contacts to draw", "error");
      return;
    }
    setVizBusy(true);
    let drawn = 0;
    let skipped = 0;
    try {
      for (const r of rows) {
        try {
          const plugin = viewer.plugin;
          // Select atom 1
          await executeCommand(viewer, {
            type: "select",
            target: { chain: r.chain1, resno: r.resno1, atom: r.atom1 },
            action: "set",
          } as LlmCommand);
          await new Promise((res) => setTimeout(res, 20));
          const entries = plugin.managers.structure.selection.entries as
            | Map<unknown, { _selection?: any; selection?: any }>
            | undefined;
          let lociA: unknown = null;
          if (entries && typeof entries.forEach === "function") {
            entries.forEach((val: any) => {
              const sel = val?._selection || val?.selection;
              if (sel?.elements?.length > 0 && !lociA) lociA = sel;
            });
          }
          if (!lociA) { skipped++; continue; }
          const infoA = extractAtomInfoFromLoci(plugin, lociA);
          if (!infoA) { skipped++; continue; }

          // Select atom 2
          await executeCommand(viewer, {
            type: "select",
            target: { chain: r.chain2, resno: r.resno2, atom: r.atom2 },
            action: "set",
          } as LlmCommand);
          await new Promise((res) => setTimeout(res, 20));
          let lociB: unknown = null;
          if (entries && typeof entries.forEach === "function") {
            entries.forEach((val: any) => {
              const sel = val?._selection || val?.selection;
              if (sel?.elements?.length > 0 && !lociB) lociB = sel;
            });
          }
          if (!lociB) { skipped++; continue; }
          const infoB = extractAtomInfoFromLoci(plugin, lociB);
          if (!infoB) { skipped++; continue; }

          // Clear selection so we don't leave residue highlights
          plugin.managers.structure.selection.clear();
          plugin.managers.interactivity.lociHighlights.clearHighlights();

          const color = CONTACT_COLORS[r.type] || "#6b7280";
          addInteractionLine({
            from: { x: infoA.x, y: infoA.y, z: infoA.z, label: `${r.resname1}${r.resno1}.${r.chain1}/${r.atom1}` },
            to: { x: infoB.x, y: infoB.y, z: infoB.z, label: `${r.resname2}${r.resno2}.${r.chain2}/${r.atom2}` },
            color,
            label: r.distance_A !== undefined ? `${r.distance_A.toFixed(1)}Å` : r.type,
            dashed: r.type === "hbond",
          });
          drawn++;
        } catch {
          skipped++;
        }
      }
      // Clear selection at the end
      try { viewer.plugin.managers.structure.selection.clear(); } catch { /* ignore */ }
      useAppStore.getState().toast(
        `Drew ${drawn} contact line${drawn === 1 ? "" : "s"}${skipped > 0 ? ` (${skipped} skipped)` : ""}`,
        drawn > 0 ? "success" : "info"
      );
    } finally {
      setVizBusy(false);
    }
  };

  return (
    <div className="space-y-2 p-3">
      <SectionTitle icon={<Zap className="h-3 w-3 text-claude-accent" />}>Non-covalent Interactions (3D Viz)</SectionTitle>
      <p className="rounded-lg bg-claude-accent-light/40 p-2.5 text-[11px] leading-relaxed text-claude-text-muted border border-claude-accent/20">
        Show all interactions within a radius around a residue in the 3D viewer:
        <span className="font-medium text-claude-text"> H-bonds, salt bridges, hydrophobic, π-stacking, cation-π, halogen, metal coordination</span>.
      </p>
      <ResidueInput label="Central residue" value={target} onChange={setTarget} />

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Radius (Å)</Label>
          <span className="font-mono text-xs">{radius.toFixed(1)}</span>
        </div>
        <Slider
          value={[radius]}
          min={3}
          max={20}
          step={0.5}
          onValueChange={(v) => setRadius(v[0])}
        />
      </div>

      <Button
        size="sm"
        className="w-full h-8 text-xs gap-1.5"
        disabled={busy}
        onClick={() => run({ type: "show_interactions", target, radius })}
      >
        <Zap className="h-3.5 w-3.5" />
        Show Interactions
      </Button>

      <div className="grid grid-cols-2 gap-2">
        <Button
          size="sm"
          variant="secondary"
          className="h-8 text-xs"
          onClick={() => run({ type: "show_interactions", target: "selection", radius })}
        >
          From Selection
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="h-8 text-xs"
          onClick={() => run({ type: "show_interactions", target: "ligand", radius })}
        >
          From Ligand
        </Button>
      </div>

      <SectionTitle icon={<Microscope className="h-3 w-3 text-claude-accent" />}>Detailed Analysis (Biopython)</SectionTitle>
      <p className="rounded-lg bg-claude-bg/60 dark:bg-[#1a1917]/60 p-2 text-[10px] leading-relaxed text-claude-text-muted border border-claude-border-light/40 dark:border-[#3d3832]/40">
        Precise detection of specific interactions between two chains via local Biopython. Returns atom-level details and residue-pair statistics.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] text-claude-text-muted">Chain 1</Label>
          <Input
            value={analysisChain1}
            onChange={(e) => setAnalysisChain1(e.target.value)}
            className="h-8 text-xs font-mono"
          />
        </div>
        <div>
          <Label className="text-[10px] text-claude-text-muted">Chain 2</Label>
          <Input
            value={analysisChain2}
            onChange={(e) => setAnalysisChain2(e.target.value)}
            className="h-8 text-xs font-mono"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="flex flex-col items-center gap-0.5 py-2 text-[10px] h-auto"
          disabled={analysisKind !== null || !pdbId}
          onClick={() => runDetailedAnalysis("hbonds")}
        >
          {analysisKind === "hbonds" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <span className="h-2 w-2 rounded-full bg-sky-500" />
          )}
          H-bonds
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex flex-col items-center gap-0.5 py-2 text-[10px] h-auto"
          disabled={analysisKind !== null || !pdbId}
          onClick={() => runDetailedAnalysis("salt_bridges")}
        >
          {analysisKind === "salt_bridges" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <span className="h-2 w-2 rounded-full bg-amber-500" />
          )}
          Salt Bridges
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex flex-col items-center gap-0.5 py-2 text-[10px] h-auto"
          disabled={analysisKind !== null || !pdbId}
          onClick={() => runDetailedAnalysis("hydrophobic_contacts")}
        >
          {analysisKind === "hydrophobic_contacts" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <span className="h-2 w-2 rounded-full bg-emerald-600" />
          )}
          Hydrophobic
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex flex-col items-center gap-0.5 py-2 text-[10px] h-auto"
          disabled={analysisKind !== null || !pdbId}
          onClick={() => runDetailedAnalysis("all_interactions")}
        >
          {analysisKind === "all_interactions" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <span className="h-2 w-2 rounded-full bg-violet-500" />
          )}
          All
        </Button>
      </div>

      {analysisSummary && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-medium text-claude-text-muted">Analysis Result</span>
            {analysisRows.length > 0 && (
              <button
                onClick={exportRowsCSV}
                className="flex items-center gap-1 text-[9px] text-claude-accent hover:text-claude-accent-hover transition-colors"
                title="Copy as CSV"
              >
                <Copy className="h-2.5 w-2.5" />
                CSV ({analysisRows.length})
              </button>
            )}
          </div>
          <pre className="whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-claude-text">
            {analysisSummary}
          </pre>
        </div>
      )}

      {analysisRows.length > 0 && (
        <div className="rounded-lg border border-claude-border-light/60 dark:border-[#3d3832]/60 overflow-hidden">
          <div className="px-2 py-1 bg-claude-bg/60 dark:bg-[#1a1917]/60 border-b border-claude-border-light/40 dark:border-[#3d3832]/40 flex items-center justify-between">
            <span className="text-[9px] font-semibold uppercase tracking-wide text-claude-text-muted">
              Atom-level contacts ({analysisRows.length})
            </span>
            <span className="text-[8px] text-claude-text-muted/70">click header to sort</span>
          </div>
          <div className="max-h-48 overflow-y-auto sa-scroll">
            <table className="w-full text-[9px] font-mono">
              <thead className="sticky top-0 bg-claude-surface dark:bg-[#242220] z-10">
                <tr className="text-claude-text-muted border-b border-claude-border-light/40 dark:border-[#3d3832]/40">
                  <th
                    className="px-1.5 py-1 text-left cursor-pointer hover:text-claude-accent transition-colors"
                    onClick={() => toggleSort("type")}
                  >
                    Type {sortKey === "type" && (sortDir === "asc" ? "▲" : "▼")}
                  </th>
                  <th
                    className="px-1.5 py-1 text-left cursor-pointer hover:text-claude-accent transition-colors"
                    onClick={() => toggleSort("resno1")}
                  >
                    Res1 {sortKey === "resno1" && (sortDir === "asc" ? "▲" : "▼")}
                  </th>
                  <th className="px-1.5 py-1 text-left">Atom1</th>
                  <th className="px-1.5 py-1 text-left">Res2</th>
                  <th className="px-1.5 py-1 text-left">Atom2</th>
                  <th
                    className="px-1.5 py-1 text-right cursor-pointer hover:text-claude-accent transition-colors"
                    onClick={() => toggleSort("distance_A")}
                  >
                    Å {sortKey === "distance_A" && (sortDir === "asc" ? "▲" : "▼")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.slice(0, 100).map((r, i) => {
                  const color =
                    r.type === "salt_bridge" ? "bg-amber-500" :
                    r.type === "hbond" ? "bg-sky-500" :
                    r.type === "hydrophobic" ? "bg-emerald-600" :
                    "bg-gray-400";
                  return (
                    <tr
                      key={i}
                      className="border-b border-claude-border-light/20 dark:border-[#3d3832]/20 hover:bg-claude-accent-light/20 transition-colors"
                    >
                      <td className="px-1.5 py-0.5">
                        <span className="inline-flex items-center gap-1">
                          <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
                          <span className="text-claude-text truncate max-w-[60px]">{r.type}</span>
                        </span>
                      </td>
                      <td className="px-1.5 py-0.5 text-claude-text">
                        {r.resname1}{r.resno1}{r.chain1 ? `.${r.chain1}` : ""}
                      </td>
                      <td className="px-1.5 py-0.5 text-claude-text-muted">{r.atom1 || "-"}</td>
                      <td className="px-1.5 py-0.5 text-claude-text">
                        {r.resname2}{r.resno2}{r.chain2 ? `.${r.chain2}` : ""}
                      </td>
                      <td className="px-1.5 py-0.5 text-claude-text-muted">{r.atom2 || "-"}</td>
                      <td className="px-1.5 py-0.5 text-right font-bold text-claude-accent">
                        {r.distance_A !== undefined ? r.distance_A.toFixed(2) : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {sortedRows.length > 100 && (
              <div className="px-2 py-1 text-[8px] text-center text-claude-text-muted bg-claude-bg/40 dark:bg-[#1a1917]/40">
                Showing first 100 of {sortedRows.length} — use CSV export for full data
              </div>
            )}
          </div>
        </div>
      )}

      {/* Contacts summary chart — type histogram + distance distribution */}
      {analysisRows.length > 0 && (() => {
        // Count contacts by type
        const typeCounts: Record<string, number> = {};
        const distances: number[] = [];
        for (const r of analysisRows) {
          typeCounts[r.type] = (typeCounts[r.type] || 0) + 1;
          if (typeof r.distance_A === "number") distances.push(r.distance_A);
        }
        const typeColors: Record<string, string> = {
          salt_bridge: "#f59e0b",
          hbond: "#0ea5e9",
          hydrophobic: "#10b981",
        };
        const typeLabels: Record<string, string> = {
          salt_bridge: "Salt bridge",
          hbond: "H-bond",
          hydrophobic: "Hydrophobic",
        };
        const total = analysisRows.length;
        const maxCount = Math.max(...Object.values(typeCounts), 1);

        // Distance histogram bins (1Å wide, 0-8Å range)
        const binSize = 0.5;
        const maxDist = 8;
        const bins = new Array(Math.ceil(maxDist / binSize)).fill(0);
        for (const d of distances) {
          const idx = Math.min(Math.floor(d / binSize), bins.length - 1);
          bins[idx]++;
        }
        const maxBin = Math.max(...bins, 1);

        // Stats
        const avgDist = distances.length > 0 ? distances.reduce((s, d) => s + d, 0) / distances.length : 0;
        const minDist = distances.length > 0 ? Math.min(...distances) : 0;
        const maxDistVal = distances.length > 0 ? Math.max(...distances) : 0;

        return (
          <div className="rounded-lg border border-claude-border-light/60 dark:border-[#3d3832]/60 overflow-hidden">
            <div className="px-2 py-1 bg-claude-bg/60 dark:bg-[#1a1917]/60 border-b border-claude-border-light/40 dark:border-[#3d3832]/40">
              <span className="text-[9px] font-semibold uppercase tracking-wide text-claude-text-muted">
                Contacts Summary
              </span>
            </div>
            <div className="p-2.5 space-y-2.5">
              {/* Type histogram */}
              <div>
                <div className="text-[9px] text-claude-text-muted mb-1">By type</div>
                <div className="space-y-1">
                  {Object.entries(typeCounts)
                    .sort(([, a], [, b]) => b - a)
                    .map(([type, count]) => (
                      <div key={type} className="flex items-center gap-1.5">
                        <span className="text-[9px] font-mono text-claude-text w-16 flex-shrink-0 truncate">
                          {typeLabels[type] || type}
                        </span>
                        <div className="flex-1 h-3 bg-claude-bg/60 dark:bg-[#1a1917]/60 rounded-sm overflow-hidden border border-claude-border-light/30 dark:border-[#3d3832]/30">
                          <div
                            className="h-full rounded-sm transition-all"
                            style={{
                              width: `${(count / maxCount) * 100}%`,
                              backgroundColor: typeColors[type] || "#6b7280",
                            }}
                          />
                        </div>
                        <span className="text-[9px] font-mono text-claude-text-muted w-6 text-right">
                          {count}
                        </span>
                        <span className="text-[8px] text-claude-text-muted/70 w-8 text-right">
                          {((count / total) * 100).toFixed(0)}%
                        </span>
                      </div>
                    ))}
                </div>
              </div>

              {/* Distance distribution histogram */}
              {distances.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] text-claude-text-muted">Distance distribution (Å)</span>
                    <span className="text-[8px] text-claude-text-muted/70 font-mono">
                      n={distances.length} · avg={avgDist.toFixed(2)} · {minDist.toFixed(2)}–{maxDistVal.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-end gap-px h-12 px-0.5">
                    {bins.map((count, i) => {
                      const binStart = (i * binSize).toFixed(1);
                      const binEnd = ((i + 1) * binSize).toFixed(1);
                      const isPeak = count === maxBin;
                      return (
                        <div
                          key={i}
                          className="flex-1 relative group"
                          title={`${binStart}–${binEnd}Å: ${count} contacts`}
                        >
                          <div
                            className="w-full rounded-t-sm transition-all"
                            style={{
                              height: `${Math.max((count / maxBin) * 100, count > 0 ? 8 : 0)}%`,
                              backgroundColor: isPeak ? "#c96442" : "#c9644299",
                              minHeight: count > 0 ? "2px" : "0",
                            }}
                          />
                          {isPeak && count > 0 && (
                            <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[7px] font-mono text-claude-accent">
                              {count}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-between mt-0.5 px-0.5">
                    <span className="text-[7px] text-claude-text-muted/60 font-mono">0</span>
                    <span className="text-[7px] text-claude-text-muted/60 font-mono">{(maxDist / 2).toFixed(0)}</span>
                    <span className="text-[7px] text-claude-text-muted/60 font-mono">{maxDist}+</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* 3D contacts visualization — draws interactionLines between contacting
          atoms using the MeasureOverlay canvas. Replaces the stub show_interactions
          command (prebuilt Molstar bundle lacks ComputeContacts). */}
      {analysisRows.length > 0 && (
        <div className="rounded-lg border border-claude-accent/30 bg-claude-accent-light/20 p-2.5 space-y-2">
          <div className="flex items-center gap-1.5">
            <Crosshair className="h-3 w-3 text-claude-accent" />
            <span className="text-[10px] font-semibold text-claude-accent">
              Visualize contacts in 3D
            </span>
          </div>
          <p className="text-[10px] text-claude-text-muted leading-relaxed">
            Draw {analysisRows.length} contact{analysisRows.length > 1 ? "s" : ""} as colored lines between atoms in the 3D viewer (overlay canvas). Uses the atom-level data from the last analysis run.
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              className="h-7 text-[10px] gap-1"
              disabled={vizBusy || analysisRows.length === 0}
              onClick={() => drawContacts3D(analysisRows.slice(0, 50))}
              title="Draw first 50 contacts as overlay lines"
            >
              {vizBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
              Draw (top 50)
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="h-7 text-[10px] gap-1"
              disabled={vizBusy || analysisRows.length === 0}
              onClick={() => drawContacts3D(analysisRows)}
              title="Draw ALL contacts (may be slow for >200)"
            >
              {vizBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
              Draw all ({analysisRows.length})
            </Button>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="w-full h-7 text-[10px] gap-1 text-claude-text-muted"
            onClick={() => { clearInteractionLines(); useAppStore.getState().toast("Cleared overlay lines", "info"); }}
            title="Clear all overlay lines"
          >
            <Trash2 className="h-3 w-3" />
            Clear overlay lines
          </Button>
        </div>
      )}

      <SectionTitle>Interaction Type Legend</SectionTitle>
      <div className="grid grid-cols-2 gap-1.5 text-[11px]">
        {[
          { name: "H-bond", color: "bg-sky-500" },
          { name: "Salt bridge", color: "bg-amber-500" },
          { name: "Hydrophobic", color: "bg-emerald-600" },
          { name: "π-stacking", color: "bg-violet-500" },
          { name: "Cation-π", color: "bg-rose-500" },
          { name: "Halogen", color: "bg-cyan-400" },
          { name: "Metal coord.", color: "bg-fuchsia-500" },
          { name: "Water bridge", color: "bg-blue-300" },
        ].map((x) => (
          <div key={x.name} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${x.color}`} />
            <span className="text-claude-text-muted">{x.name}</span>
          </div>
        ))}
      </div>

      <SectionTitle>Clear</SectionTitle>
      <Button
        size="sm"
        variant="destructive"
        className="w-full h-8 text-xs gap-1.5"
        onClick={() => run({ type: "clear_interactions" })}
      >
        <Trash2 className="h-3.5 w-3.5" />
        Clear Interactions
      </Button>
    </div>
  );
}

// ============================================================
// Visualization tab (advanced 3D overlays)
// ============================================================

export function VisualizationTab({ pdbId }: { pdbId: string }) {
  const { run, busy } = useRunCommand();
  const [ligandCompId, setLigandCompId] = useState("");
  const [chain, setChain] = useState("");
  const [radius, setRadius] = useState(6);
  const electrostaticViz = useAppStore((s) => s.electrostaticViz);
  const druggabilityViz = useAppStore((s) => s.druggabilityViz);
  const screeningViz = useAppStore((s) => s.screeningViz);
  const pocketDetectionViz = useAppStore((s) => s.pocketDetectionViz);

  return (
    <div className="space-y-2 p-3">
      <SectionTitle icon={<Atom className="h-3 w-3 text-claude-accent" />}>Electrostatic Surface (APBS)</SectionTitle>
      <p className="rounded-lg bg-claude-bg/60 dark:bg-[#1a1917]/60 p-2 text-[10px] leading-relaxed text-claude-text-muted border border-claude-border-light/40 dark:border-[#3d3832]/40">
        Runs the APBS electrostatic recipe and renders a molecular surface with partial-charge coloring (red = negative, blue = positive).
      </p>
      <div className="flex items-center gap-2">
        <Input
          value={chain}
          onChange={(e) => setChain(e.target.value)}
          placeholder="chain (optional, e.g. A)"
          className="h-8 text-xs font-mono"
        />
        <Button
          size="sm"
          variant="secondary"
          className="h-8 text-xs gap-1.5"
          disabled={busy || !pdbId}
          onClick={() => run({ type: "show_electrostatic_surface", pdbId, chain: chain || undefined })}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
          Run APBS
        </Button>
      </div>
      {electrostaticViz && (
        <div className="rounded-md border border-claude-accent/30 bg-claude-accent-light/30 p-2 text-[10px] text-claude-text">
          <Badge variant="outline" className="mr-1 border-claude-accent/40 text-claude-accent">Active</Badge>
          {electrostaticViz.pdbId} surface applied
        </div>
      )}

      <SectionTitle icon={<ShieldCheck className="h-3 w-3 text-claude-accent" />}>Druggable Pocket</SectionTitle>
      <p className="rounded-lg bg-claude-bg/60 dark:bg-[#1a1917]/60 p-2 text-[10px] leading-relaxed text-claude-text-muted border border-claude-border-light/40 dark:border-[#3d3832]/40">
        Detects druggable pockets around a ligand and labels pocket residues by category (high/medium/low druggability).
      </p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Radius (Å)</Label>
          <span className="font-mono text-xs">{radius.toFixed(1)}</span>
        </div>
        <Slider
          value={[radius]}
          min={3}
          max={15}
          step={0.5}
          onValueChange={(v) => setRadius(v[0])}
        />
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={ligandCompId}
          onChange={(e) => setLigandCompId(e.target.value)}
          placeholder="ligand compId (e.g. ATP)"
          className="h-8 text-xs font-mono"
        />
        <Button
          size="sm"
          variant="secondary"
          className="h-8 text-xs gap-1.5"
          disabled={busy || !pdbId || !ligandCompId}
          onClick={() => run({ type: "show_druggable_pocket", pdbId, ligandCompId, radius })}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
          Detect
        </Button>
      </div>
      {druggabilityViz && (
        <div className="rounded-md border border-claude-accent/30 bg-claude-accent-light/30 p-2 text-[10px] text-claude-text">
          <Badge variant="outline" className="mr-1 border-claude-accent/40 text-claude-accent">Active</Badge>
          {druggabilityViz.pdbId} · {druggabilityViz.pockets?.length ?? 0} pockets
        </div>
      )}

      <SectionTitle icon={<FlaskConical className="h-3 w-3 text-claude-accent" />}>Virtual Screening</SectionTitle>
      <Button
        size="sm"
        variant="secondary"
        className="w-full h-8 text-xs gap-1.5"
        disabled={busy || !pdbId || !ligandCompId}
        onClick={() => run({ type: "run_virtual_screening", pdbId, ligandCompId })}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
        Run Virtual Screening
      </Button>
      {screeningViz && (
        <div className="rounded-md border border-claude-accent/30 bg-claude-accent-light/30 p-2 text-[10px] text-claude-text">
          <Badge variant="outline" className="mr-1 border-claude-accent/40 text-claude-accent">Active</Badge>
          {screeningViz.pdbId} screening done
        </div>
      )}

      <SectionTitle icon={<Box className="h-3 w-3 text-claude-accent" />}>Multi-pocket Detection</SectionTitle>
      <Button
        size="sm"
        variant="secondary"
        className="w-full h-8 text-xs gap-1.5"
        disabled={busy || !pdbId}
        onClick={() => run({ type: "detect_pockets", pdbId })}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Box className="h-3.5 w-3.5" />}
        Detect Pockets
      </Button>
      {pocketDetectionViz && (
        <div className="rounded-md border border-claude-accent/30 bg-claude-accent-light/30 p-2 text-[10px] text-claude-text">
          <Badge variant="outline" className="mr-1 border-claude-accent/40 text-claude-accent">Active</Badge>
          {pocketDetectionViz.pdbId} pockets detected
        </div>
      )}
    </div>
  );
}

// ============================================================
// Volume tab (cryo-EM density)
// ============================================================

export function VolumeTab() {
  const { run, busy } = useRunCommand();
  const [emdbId, setEmdbId] = useState("");
  const [detail, setDetail] = useState(3);
  const [isoValue, setIsoValue] = useState(1.5);
  const [opacity, setOpacity] = useState(0.5);
  const [color, setColor] = useState("#c96442");

  return (
    <div className="space-y-2 p-3">
      <SectionTitle icon={<Box className="h-3 w-3 text-claude-accent" />}>EMDB Volume (Cryo-EM)</SectionTitle>
      <p className="rounded-lg bg-claude-bg/60 dark:bg-[#1a1917]/60 p-2 text-[10px] leading-relaxed text-claude-text-muted border border-claude-border-light/40 dark:border-[#3d3832]/40">
        Load an EMDB density map and render it as an isosurface over the structure. Useful for cryo-EM structures.
      </p>
      <div>
        <Label className="text-[10px] text-claude-text-muted">EMDB ID</Label>
        <Input
          value={emdbId}
          onChange={(e) => setEmdbId(e.target.value)}
          placeholder="e.g. EMD-1234"
          className="h-8 text-xs font-mono"
        />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Detail</Label>
          <span className="font-mono text-xs">{detail}</span>
        </div>
        <Slider value={[detail]} min={0} max={6} step={1} onValueChange={(v) => setDetail(v[0])} />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Iso value</Label>
          <span className="font-mono text-xs">{isoValue.toFixed(2)}</span>
        </div>
        <Slider value={[isoValue]} min={0} max={5} step={0.1} onValueChange={(v) => setIsoValue(v[0])} />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Opacity</Label>
          <span className="font-mono text-xs">{opacity.toFixed(2)}</span>
        </div>
        <Slider value={[opacity]} min={0} max={1} step={0.05} onValueChange={(v) => setOpacity(v[0])} />
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-8 w-12 cursor-pointer p-1"
        />
        <Button
          size="sm"
          variant="secondary"
          className="h-8 flex-1 text-xs gap-1.5"
          disabled={busy || !emdbId}
          onClick={() =>
            run({
              type: "load_volume_url",
              url: `https://www.ebi.ac.uk/pdbe/entry/emdb/${emdbId.toLowerCase()}/map`,
              format: "dscif",
              isBinary: true,
              isoValue,
              color,
            } as LlmCommand)
          }
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Box className="h-3.5 w-3.5" />}
          Load Volume
        </Button>
      </div>
    </div>
  );
}

// ============================================================
// Export tab
// ============================================================

export function ExportTab() {
  const { run, busy } = useRunCommand();
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [snapshotType, setSnapshotType] = useState<"molj" | "molx">("molj");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSessionSave = async () => {
    if (!viewer) return;
    try {
      await viewer.plugin.managers.snapshots?.downloadToFile(snapshotType);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useAppStore.getState().toast(`Save failed: ${msg}`, "error");
    }
  };

  const handleSessionRestore = async (files: FileList | null) => {
    if (!viewer || !files || files.length === 0) return;
    const file = files[0];
    const name = file.name.toLowerCase();
    const ext = name.endsWith(".molx") ? "molx" : "molj";
    try {
      await viewer.plugin.managers.snapshots?.openFile(file);
      toast(`Session restored (${ext})`, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Restore failed: ${msg}`, "error");
    }
  };

  const handleSnapshotFromUrl = async () => {
    if (!viewer) return;
    const url = window.prompt("Enter session file URL (.molj or .molx):");
    if (!url) return;
    const ext = url.toLowerCase().endsWith(".molx") ? "molx" : "molj";
    try {
      await viewer.plugin.managers.snapshots?.openUrl(url, ext);
      toast(`Session restored from URL`, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Restore failed: ${msg}`, "error");
    }
  };

  return (
    <div className="space-y-2 p-3">
      <SectionTitle icon={<Camera className="h-3 w-3 text-claude-accent" />}>PNG Screenshot</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Width</Label>
          <Input
            type="number"
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
            className="h-8 text-xs"
          />
        </div>
        <div>
          <Label className="text-xs">Height</Label>
          <Input
            type="number"
            value={height}
            onChange={(e) => setHeight(Number(e.target.value))}
            className="h-8 text-xs"
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {[
          { label: "720p", w: 1280, h: 720 },
          { label: "1080p", w: 1920, h: 1080 },
          { label: "4K", w: 3840, h: 2160 },
        ].map((p) => (
          <Button
            key={p.label}
            size="sm"
            variant="outline"
            className="h-7 text-[10px]"
            onClick={() => {
              setWidth(p.w);
              setHeight(p.h);
            }}
          >
            {p.label}
          </Button>
        ))}
      </div>
      <Button
        size="sm"
        className="w-full h-8 text-xs gap-1.5"
        disabled={busy}
        onClick={() => run({ type: "export_snapshot", width, height })}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        Download PNG
      </Button>

      <SectionTitle icon={<Download className="h-3 w-3 text-claude-accent" />}>Save Session</SectionTitle>
      <Select value={snapshotType} onValueChange={(v) => setSnapshotType(v as "molj" | "molx")}>
        <SelectTrigger className="h-9 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SNAPSHOT_TYPES.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              <div className="flex flex-col">
                <span className="font-medium">{t.label}</span>
                <span className="text-[11px] text-claude-text-muted">{t.description}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        variant="secondary"
        className="w-full h-8 text-xs gap-1.5"
        onClick={handleSessionSave}
        disabled={!viewer}
      >
        <Download className="h-3.5 w-3.5" />
        Save Session
      </Button>

      <SectionTitle icon={<Upload className="h-3 w-3 text-claude-accent" />}>Restore Session</SectionTitle>
      <input
        ref={fileInputRef}
        type="file"
        accept=".molj,.molx"
        className="hidden"
        onChange={(e) => handleSessionRestore(e.target.files)}
      />
      <Button
        size="sm"
        variant="secondary"
        className="w-full h-8 text-xs gap-1.5"
        onClick={() => fileInputRef.current?.click()}
        disabled={!viewer}
      >
        <Upload className="h-3.5 w-3.5" />
        From File
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="w-full h-8 text-xs gap-1.5"
        onClick={handleSnapshotFromUrl}
        disabled={!viewer}
      >
        <Upload className="h-3.5 w-3.5" />
        From URL
      </Button>

      <Separator />
      <div className="text-[10px] text-claude-text-muted leading-relaxed">
        <Badge variant="outline" className="mr-1 text-claude-accent border-claude-accent/40">Tip</Badge>
        Screenshot resolution is independent of the browser window; 4K takes a few seconds. Session files save all structures, representations, measurements, and camera state.
      </div>
    </div>
  );
}

// ============================================================
// Upload tab — load structures from local files / URLs / AlphaFold
// ============================================================

export function UploadTab() {
  const { run, busy } = useRunCommand();
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [recentFiles, setRecentFiles] = useState<Array<{ name: string; size: number; format: string; loadedAt: number }>>([]);
  const [urlInput, setUrlInput] = useState("");
  const [alphafoldId, setAlphafoldId] = useState("");
  const [pdbIdInput, setPdbIdInput] = useState("");

  const detectFormat = (name: string): "pdb" | "mmcif" => {
    const lower = name.toLowerCase();
    if (lower.endsWith(".cif") || lower.endsWith(".mmcif")) return "mmcif";
    return "pdb";
  };

  const loadFile = async (file: File) => {
    if (!viewer) {
      toast("Viewer not ready", "error");
      return;
    }
    const format = detectFormat(file.name);
    try {
      const text = await file.text();
      const res = await run({
        type: "load_structure_data",
        data: text,
        format,
        label: file.name,
      } as LlmCommand);
      if (res?.ok) {
        setRecentFiles(prev => [
          { name: file.name, size: file.size, format, loadedAt: Date.now() },
          ...prev.slice(0, 4),
        ]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Load failed: ${msg}`, "error");
    }
  };

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      await loadFile(file);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      await handleFileSelect(files);
    }
  };

  const handleLoadUrl = async () => {
    if (!urlInput.trim()) return;
    await run({
      type: "load_structure_url",
      url: urlInput.trim(),
      format: urlInput.toLowerCase().endsWith(".cif") ? "mmcif" : "pdb",
      isBinary: false,
    });
  };

  const handleLoadPdbId = async () => {
    const id = pdbIdInput.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(id)) {
      toast("PDB ID must be 4 alphanumeric chars", "error");
      return;
    }
    await run({ type: "load_pdb", id });
  };

  const handleLoadAlphafold = async () => {
    const id = alphafoldId.trim().toUpperCase();
    if (!id) {
      toast("Enter a UniProt ID", "error");
      return;
    }
    await run({ type: "load_alphafold", uniprotId: id });
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-3 p-3">
      <SectionTitle icon={<FileBox className="h-3 w-3 text-claude-accent" />}>Upload Local File</SectionTitle>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
          dragOver
            ? "border-claude-accent bg-claude-accent-light/40"
            : "border-claude-border-light/60 dark:border-[#3d3832]/60 hover:border-claude-accent/60 hover:bg-claude-accent-light/20"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdb,.ent,.cif,.mmcif"
          multiple
          className="hidden"
          onChange={(e) => handleFileSelect(e.target.files)}
        />
        <FileBox className={`h-8 w-8 mx-auto mb-2 ${dragOver ? "text-claude-accent" : "text-claude-text-muted"}`} />
        <div className="text-xs font-medium text-claude-text">
          {dragOver ? "Drop files here…" : "Click or drag PDB / mmCIF files"}
        </div>
        <div className="text-[10px] text-claude-text-muted mt-1">
          Supports .pdb, .ent, .cif, .mmcif — multiple files allowed
        </div>
      </div>

      {recentFiles.length > 0 && (
        <div className="rounded-lg border border-claude-border-light/60 dark:border-[#3d3832]/60 overflow-hidden">
          <div className="px-2 py-1 bg-claude-bg/60 dark:bg-[#1a1917]/60 border-b border-claude-border-light/40 dark:border-[#3d3832]/40">
            <span className="text-[9px] font-semibold uppercase tracking-wide text-claude-text-muted">
              Recently loaded ({recentFiles.length})
            </span>
          </div>
          <div className="max-h-32 overflow-y-auto sa-scroll">
            {recentFiles.map((f, i) => (
              <div key={i} className="flex items-center gap-1.5 px-2 py-1 text-[10px] hover:bg-claude-accent-light/20 border-b border-claude-border-light/20 dark:border-[#3d3832]/20 last:border-0">
                <FileBox className="h-3 w-3 text-claude-accent flex-shrink-0" />
                <span className="font-mono text-claude-text truncate flex-1" title={f.name}>{f.name}</span>
                <Badge variant="outline" className="h-4 px-1 text-[8px] font-mono bg-claude-accent-light text-claude-accent border-claude-accent/30">
                  {f.format}
                </Badge>
                <span className="text-[9px] text-claude-text-muted whitespace-nowrap">{formatSize(f.size)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Separator />

      <SectionTitle icon={<Dna className="h-3 w-3 text-claude-accent" />}>Load by PDB ID</SectionTitle>
      <p className="rounded-lg bg-claude-bg/60 dark:bg-[#1a1917]/60 p-2 text-[10px] leading-relaxed text-claude-text-muted border border-claude-border-light/40 dark:border-[#3d3832]/40">
        Load any structure from RCSB PDB by its 4-character ID (e.g. 1CBS, 6XR8, 7KQR).
      </p>
      <div className="flex items-center gap-2">
        <Input
          value={pdbIdInput}
          onChange={(e) => setPdbIdInput(e.target.value)}
          placeholder="e.g. 1CBS"
          className="h-8 text-xs font-mono uppercase"
          maxLength={4}
          onKeyDown={(e) => { if (e.key === "Enter") handleLoadPdbId(); }}
        />
        <Button
          size="sm"
          variant="secondary"
          className="h-8 text-xs gap-1.5"
          disabled={busy || pdbIdInput.trim().length !== 4}
          onClick={handleLoadPdbId}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Dna className="h-3.5 w-3.5" />}
          Load
        </Button>
      </div>

      <SectionTitle icon={<Dna className="h-3 w-3 text-claude-accent" />}>Load AlphaFold Prediction</SectionTitle>
      <p className="rounded-lg bg-claude-bg/60 dark:bg-[#1a1917]/60 p-2 text-[10px] leading-relaxed text-claude-text-muted border border-claude-border-light/40 dark:border-[#3d3832]/40">
        Load a predicted structure from the AlphaFold DB by UniProt accession (e.g. P00520).
      </p>
      <div className="flex items-center gap-2">
        <Input
          value={alphafoldId}
          onChange={(e) => setAlphafoldId(e.target.value)}
          placeholder="UniProt ID, e.g. P00520"
          className="h-8 text-xs font-mono"
          onKeyDown={(e) => { if (e.key === "Enter") handleLoadAlphafold(); }}
        />
        <Button
          size="sm"
          variant="secondary"
          className="h-8 text-xs gap-1.5"
          disabled={busy || !alphafoldId.trim()}
          onClick={handleLoadAlphafold}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Dna className="h-3.5 w-3.5" />}
          Load
        </Button>
      </div>

      <Separator />

      <SectionTitle icon={<Link2 className="h-3 w-3 text-claude-accent" />}>Load from URL</SectionTitle>
      <p className="rounded-lg bg-claude-bg/60 dark:bg-[#1a1917]/60 p-2 text-[10px] leading-relaxed text-claude-text-muted border border-claude-border-light/40 dark:border-[#3d3832]/40">
        Fetch a structure file from any URL. Format is auto-detected from the file extension (.cif → mmCIF, else PDB).
      </p>
      <div className="flex items-center gap-2">
        <Input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="https://files.rcsb.org/download/1CBS.pdb"
          className="h-8 text-xs font-mono"
          onKeyDown={(e) => { if (e.key === "Enter") handleLoadUrl(); }}
        />
        <Button
          size="sm"
          variant="secondary"
          className="h-8 text-xs gap-1.5"
          disabled={busy || !urlInput.trim()}
          onClick={handleLoadUrl}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
          Fetch
        </Button>
      </div>

      <Separator />
      <div className="text-[10px] text-claude-text-muted leading-relaxed">
        <Badge variant="outline" className="mr-1 text-claude-accent border-claude-accent/40">Tip</Badge>
        Uploaded structures are loaded into the same viewer session — you can still use all measurement, interaction, and visualization tools on them. Use Display → Representation to change the visual style.
      </div>
    </div>
  );
}
