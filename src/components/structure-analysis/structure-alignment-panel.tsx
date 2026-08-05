"use client";

/**
 * Structure Alignment Panel — align two loaded structures and display
 * RMSD / TM-score / sequence identity.
 *
 * Uses the `align_and_superpose` Python recipe from cli-registry to
 * compute the alignment, then displays the results.
 */
import { useState, useCallback } from "react";
import {
  GitCompare,
  Loader2,
  RefreshCw,
  Download,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppStore } from "@/lib/molcraft/store";
import { exportJSON } from "./chart-export-utils";

interface AlignmentResultData {
  rmsd: number;
  tm_score: number;
  seq_identity: number;
  aligned_residues: number;
  total_residues: number;
  method: string;
  ref_id: string;
  mobile_id: string;
  transform?: number[][];
}

export function StructureAlignmentPanel() {
  const structures = useAppStore((s) => s.structures);
  const structureFileCache = useAppStore((s) => s.structureFileCache);
  const setLastAlignment = useAppStore((s) => s.setLastAlignment);
  const addAlignmentToHistory = useAppStore((s) => s.addAlignmentToHistory);
  const toast = useAppStore((s) => s.toast);

  const [refIdx, setRefIdx] = useState(0);
  const [mobileIdx, setMobileIdx] = useState(1);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AlignmentResultData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAlign = useCallback(async () => {
    if (structures.length < 2) {
      setError("Load at least 2 structures to align");
      return;
    }
    const ref = structures[refIdx];
    const mobile = structures[mobileIdx];
    if (!ref || !mobile || ref.id === mobile.id) {
      setError("Select two different structures");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Get PDB text for both structures
      const refPdb = ref.pdbText || structureFileCache[ref.id]?.content;
      const mobilePdb = mobile.pdbText || structureFileCache[mobile.id]?.content;

      if (!refPdb || !mobilePdb) {
        setError("Both structures need PDB text (load from RCSB or upload .pdb files)");
        return;
      }

      // Call the analyze API with align_and_superpose recipe
      const res = await fetch("/api/analyze/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipe: "align_and_superpose",
          fileContent: refPdb,
          fileContent2: mobilePdb,
          fileFormat: "pdb",
          params: {},
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
      }

      const json = await res.json();
      if (!json.ok) {
        throw new Error(json.stderr || json.data?.error || "Alignment failed");
      }

      const data = json.data || {};
      const resultData: AlignmentResultData = {
        rmsd: data.rmsd ?? data.rmsd_raw ?? 0,
        tm_score: data.tm_score ?? data.tm ?? 0,
        seq_identity: data.seq_identity ?? data.identity ?? 0,
        aligned_residues: data.aligned_residues ?? data.n_aligned ?? 0,
        total_residues: data.total_residues ?? data.n_total ?? 0,
        method: data.method ?? "Kabsch superposition",
        ref_id: ref.id,
        mobile_id: mobile.id,
        transform: data.transform || data.rotation,
      };

      setResult(resultData);

      // Save to store
      const alignmentRecord = {
        id: `align-${Date.now()}`,
        refId: ref.id,
        mobileId: mobile.id,
        method: resultData.method,
        rmsd: resultData.rmsd,
        tmScore: resultData.tm_score,
        alignedResidues: resultData.aligned_residues,
        totalResidues: resultData.total_residues,
        identity: resultData.seq_identity,
        transform: resultData.transform,
        timestamp: Date.now(),
        detail: `RMSD: ${resultData.rmsd.toFixed(2)} Å, TM: ${resultData.tm_score.toFixed(3)}`,
      };
      setLastAlignment(alignmentRecord);
      addAlignmentToHistory(alignmentRecord);

      toast(
        `Alignment complete: RMSD ${resultData.rmsd.toFixed(2)} Å, TM ${resultData.tm_score.toFixed(3)}`,
        "success"
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast(`Alignment failed: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  }, [structures, refIdx, mobileIdx, structureFileCache, setLastAlignment, addAlignmentToHistory, toast]);

  if (structures.length < 2) {
    return (
      <div className="sa-empty-state p-4">
        <GitCompare className="h-8 w-8 text-claude-text-muted" />
        <p className="text-xs">Load 2+ structures to align</p>
        <p className="text-[10px] text-claude-text-muted">
          Alignment computes RMSD, TM-score, and sequence identity between
          two structures.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 p-2">
      <div className="flex items-center gap-2">
        <GitCompare className="h-3.5 w-3.5 text-claude-accent" />
        <span className="text-[11px] font-semibold text-claude-text">
          Structure Alignment
        </span>
        {result && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 w-6 p-0"
            onClick={() => exportJSON(result, "alignment", `${result.ref_id}-${result.mobile_id}`)}
            title="Export JSON"
          >
            <Download className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* Structure selectors */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-0.5 block text-[9px] font-medium text-claude-text-muted">
            Reference
          </label>
          <Select
            value={String(refIdx)}
            onValueChange={(v) => setRefIdx(Number(v))}
          >
            <SelectTrigger className="h-7 text-[10px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {structures.map((s, i) => (
                <SelectItem key={s.id} value={String(i)} className="text-[10px]">
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-0.5 block text-[9px] font-medium text-claude-text-muted">
            Mobile
          </label>
          <Select
            value={String(mobileIdx)}
            onValueChange={(v) => setMobileIdx(Number(v))}
          >
            <SelectTrigger className="h-7 text-[10px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {structures.map((s, i) => (
                <SelectItem key={s.id} value={String(i)} className="text-[10px]">
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Align button */}
      <Button
        size="sm"
        className="h-7 w-full text-[11px] gap-1.5"
        disabled={loading || refIdx === mobileIdx}
        onClick={handleAlign}
      >
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <GitCompare className="h-3 w-3" />
        )}
        {loading ? "Aligning..." : "Align Structures"}
      </Button>

      {/* Error */}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[10px] text-destructive flex items-start gap-1.5">
          <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-2 rounded-md border border-claude-border bg-claude-bg p-2">
          <div className="flex items-center gap-1.5 text-[10px] text-claude-text-secondary">
            <CheckCircle2 className="h-3 w-3 text-green-500" />
            <span className="font-medium">Alignment Complete</span>
            <Badge variant="outline" className="ml-auto text-[8px]">
              {result.method}
            </Badge>
          </div>

          {/* Structure pair */}
          <div className="flex items-center gap-1 text-[10px] font-mono">
            <span className="font-semibold text-claude-accent">{result.ref_id}</span>
            <ArrowRight className="h-2.5 w-2.5 text-claude-text-muted" />
            <span className="font-semibold text-claude-accent">{result.mobile_id}</span>
          </div>

          {/* Metrics grid */}
          <div className="grid grid-cols-2 gap-1.5">
            <MetricCard
              label="RMSD"
              value={result.rmsd.toFixed(2)}
              unit="Å"
              color={result.rmsd < 2 ? "text-green-600" : result.rmsd < 4 ? "text-amber-600" : "text-red-600"}
            />
            <MetricCard
              label="TM-score"
              value={result.tm_score.toFixed(3)}
              unit=""
              color={result.tm_score > 0.5 ? "text-green-600" : result.tm_score > 0.3 ? "text-amber-600" : "text-red-600"}
            />
            <MetricCard
              label="Seq Identity"
              value={`${(result.seq_identity * 100).toFixed(1)}%`}
              unit=""
              color="text-claude-text"
            />
            <MetricCard
              label="Aligned"
              value={`${result.aligned_residues}/${result.total_residues}`}
              unit=""
              color="text-claude-text"
            />
          </div>

          {/* Quality indicator */}
          <div className="rounded bg-claude-surface p-1.5 text-[9px] text-center">
            {result.rmsd < 2 && result.tm_score > 0.5 ? (
              <span className="text-green-600 font-medium">✓ High structural similarity</span>
            ) : result.rmsd < 4 ? (
              <span className="text-amber-600 font-medium">~ Moderate similarity</span>
            ) : (
              <span className="text-red-600 font-medium">✗ Low similarity / different fold</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: string;
  unit: string;
  color: string;
}) {
  return (
    <div className="rounded bg-claude-surface p-1.5 text-center">
      <div className="text-[8px] uppercase tracking-wide text-claude-text-muted">
        {label}
      </div>
      <div className={`font-mono text-sm font-bold ${color}`}>
        {value}
        {unit && <span className="text-[9px] ml-0.5 text-claude-text-muted">{unit}</span>}
      </div>
    </div>
  );
}
