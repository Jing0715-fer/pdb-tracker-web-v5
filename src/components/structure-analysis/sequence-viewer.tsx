"use client";

/**
 * Sequence Viewer — displays the amino acid sequence of the active structure's
 * chains. Allows clicking on residues to focus them in the 3D viewer.
 *
 * Features:
 *   - One-letter code display with 10-residue groups
 *   - Chain selector dropdown
 *   - Residue hover highlight + click-to-focus
 *   - Color-coded by residue type (hydrophobic/polar/positive/negative/special)
 *   - Position ruler
 */
import { useState, useMemo, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Dna, ChevronRight } from "lucide-react";
import {
  useAppStore,
  selectActiveStructure,
} from "@/lib/molcraft/store";
import { extractSequences, type SequenceInfo } from "@/lib/molcraft/structure-utils";
import { executeCommand } from "@/lib/molcraft/commands";

// Residue color groups (Claude palette-inspired)
const RESIDUE_COLORS: Record<string, string> = {
  // Hydrophobic (warm)
  A: "#c96442", V: "#c96442", L: "#c96442", I: "#c96442", P: "#c96442", F: "#c96442", W: "#c96442", M: "#c96442",
  // Polar (teal)
  S: "#2d8f8f", T: "#2d8f8f", N: "#2d8f8f", Q: "#2d8f8f", Y: "#2d8f8f", C: "#2d8f8f",
  // Positive (purple)
  K: "#7c5cbf", R: "#7c5cbf", H: "#7c5cbf",
  // Negative (amber)
  D: "#c9872e", E: "#c9872e",
  // Special (gray)
  G: "#6b7280", U: "#6b7280", O: "#6b7280",
};

const RESIDUE_NAMES: Record<string, string> = {
  A: "Ala", R: "Arg", N: "Asn", D: "Asp", C: "Cys", E: "Glu", Q: "Gln",
  G: "Gly", H: "His", I: "Ile", L: "Leu", K: "Lys", M: "Met", F: "Phe",
  P: "Pro", S: "Ser", T: "Thr", W: "Trp", Y: "Tyr", V: "Val",
};

export function SequenceViewer() {
  const activeStructure = useAppStore(selectActiveStructure);
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const [sequences, setSequences] = useState<SequenceInfo[]>([]);
  const [selectedChain, setSelectedChain] = useState<string>("");
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // Extract sequences when the active structure changes
  useEffect(() => {
    if (!activeStructure?.pdbText) {
      setSequences([]);
      setSelectedChain("");
      return;
    }
    setLoading(true);
    try {
      const seqs = extractSequences(activeStructure.pdbText);
      setSequences(seqs);
      if (seqs.length > 0 && !seqs.some((s) => s.chain === selectedChain)) {
        setSelectedChain(seqs[0].chain);
      }
    } catch {
      setSequences([]);
    } finally {
      setLoading(false);
    }
  }, [activeStructure?.pdbText]);

  const currentSeq = useMemo(
    () => sequences.find((s) => s.chain === selectedChain) ?? sequences[0],
    [sequences, selectedChain]
  );

  const handleResidueClick = async (idx: number) => {
    if (!viewer || !currentSeq) return;
    const resCode = currentSeq.sequence[idx];
    // R103.5: Use actual PDB residue number (auth_seq_id) if available
    const resno = currentSeq.residueNumbers && idx < currentSeq.residueNumbers.length
      ? currentSeq.residueNumbers[idx]
      : idx + 1;
    // R104.4: Pass insertion code if present
    const insCode = currentSeq.insertionCodes && idx < currentSeq.insertionCodes.length
      ? currentSeq.insertionCodes[idx]
      : undefined;
    try {
      await executeCommand(viewer, {
        type: "focus_residue",
        chain: currentSeq.chain,
        resno,
        insCode: insCode || undefined,
      });
      const label = insCode ? `${resno}${insCode}` : `${resno}`;
      toast(`Focused ${RESIDUE_NAMES[resCode] ?? resCode}${label} (chain ${currentSeq.chain})`, "info");
    } catch {
      toast("Focus failed", "error");
    }
  };

  if (!activeStructure) {
    return (
      <div className="sa-empty-state p-4">
        <Dna className="h-8 w-8 text-claude-text-muted" />
        <p className="text-xs">No structure loaded</p>
        <p className="text-[10px] text-claude-text-muted">
          Load a structure to view its sequence.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4 gap-2 text-xs text-claude-text-secondary">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-claude-accent" />
        Extracting sequences...
      </div>
    );
  }

  if (sequences.length === 0) {
    return (
      <div className="sa-empty-state p-4">
        <Dna className="h-6 w-6 text-claude-text-muted" />
        <p className="text-[10px]">No sequence data available</p>
        <p className="text-[9px] text-claude-text-muted">
          Sequence extraction requires PDB format (SEQRES or ATOM records).
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-2">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Dna className="h-3.5 w-3.5 text-claude-accent" />
        <span className="text-[11px] font-semibold text-claude-text">Sequence</span>
        {sequences.length > 1 && (
          <Select value={selectedChain} onValueChange={setSelectedChain}>
            <SelectTrigger className="h-6 w-[80px] text-[10px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sequences.map((s) => (
                <SelectItem key={s.chain} value={s.chain} className="text-[10px]">
                  Chain {s.chain} ({s.length}aa)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {currentSeq && (
          <Badge variant="outline" className="ml-auto text-[9px]">
            {currentSeq.length} residues
          </Badge>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-1 text-[8px]">
        {[
          { label: "Hydrophobic", color: "#c96442" },
          { label: "Polar", color: "#2d8f8f" },
          { label: "Positive", color: "#7c5cbf" },
          { label: "Negative", color: "#c9872e" },
          { label: "Special", color: "#6b7280" },
        ].map((g) => (
          <span key={g.label} className="flex items-center gap-0.5">
            <span
              className="h-2 w-2 rounded-sm"
              style={{ backgroundColor: g.color }}
            />
            <span className="text-claude-text-muted">{g.label}</span>
          </span>
        ))}
      </div>

      {/* Sequence display */}
      {currentSeq && (
        <div className="rounded-md border border-claude-border bg-claude-bg p-2">
          <div className="max-h-64 overflow-y-auto overflow-x-auto sa-scroll">
            <div className="font-mono text-[11px] leading-relaxed min-w-max">
              <SequenceRow sequence={currentSeq.sequence} chain={currentSeq.chain} onResidueClick={handleResidueClick} onResidueHover={setHoveredIdx} hoveredIdx={hoveredIdx} />
            </div>
          </div>
          {hoveredIdx != null && currentSeq.sequence[hoveredIdx] && (
            <div className="mt-1.5 flex items-center gap-2 border-t border-claude-border pt-1.5 text-[9px]">
              <span className="font-mono font-bold text-claude-accent">
                {RESIDUE_NAMES[currentSeq.sequence[hoveredIdx]] ?? currentSeq.sequence[hoveredIdx]}
              </span>
              <span className="text-claude-text-secondary">
                Position {hoveredIdx + 1}
              </span>
              <span className="ml-auto text-claude-text-muted">
                Chain {currentSeq.chain} · Click to focus
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Render a sequence in blocks of 10 residues with position ruler. */
function SequenceRow({
  sequence,
  chain,
  onResidueClick,
  onResidueHover,
  hoveredIdx,
}: {
  sequence: string;
  chain: string;
  onResidueClick: (idx: number) => void;
  onResidueHover: (idx: number | null) => void;
  hoveredIdx: number | null;
}) {
  const blockSize = 10;
  const blocks: React.ReactNode[] = [];

  for (let i = 0; i < sequence.length; i += blockSize) {
    const block = sequence.slice(i, i + blockSize);
    blocks.push(
      <div key={i} className="flex items-center gap-0.5 mb-0.5">
        {/* Position ruler */}
        <span className="w-10 shrink-0 text-right text-[8px] text-claude-text-muted">
          {i + 1}
        </span>
        {/* Residues */}
        <div className="flex gap-0.5">
          {block.split("").map((res, j) => {
            const idx = i + j;
            const isHovered = hoveredIdx === idx;
            return (
              <button
                key={j}
                onClick={() => onResidueClick(idx)}
                onMouseEnter={() => onResidueHover(idx)}
                onMouseLeave={() => onResidueHover(null)}
                className={`flex h-5 w-5 items-center justify-center rounded text-[9px] font-bold transition-all ${
                  isHovered ? "scale-125 text-white shadow-md" : "text-white/90"
                }`}
                style={{
                  backgroundColor: RESIDUE_COLORS[res] ?? "#6b7280",
                  opacity: isHovered ? 1 : 0.85,
                }}
                title={`${RESIDUE_NAMES[res] ?? res} ${idx + 1} (chain ${chain})`}
              >
                {res}
              </button>
            );
          })}
        </div>
        {/* End position */}
        <span className="ml-1 text-[8px] text-claude-text-muted">
          {Math.min(i + blockSize, sequence.length)}
        </span>
      </div>
    );
  }

  return <div>{blocks}</div>;
}
