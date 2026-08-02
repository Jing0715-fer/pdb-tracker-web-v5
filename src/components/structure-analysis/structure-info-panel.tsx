"use client";

/**
 * Structure Info Panel — displays comprehensive RCSB metadata for the active
 * structure, including experimental details, cell parameters, dates, and
 * entity counts.
 *
 * Fetched from the RCSB Data API on structure change.
 */
import { useState, useEffect, useRef } from "react";
import {
  Box,
  Microscope,
  Calendar,
  Ruler,
  Atom,
  Layers,
  Database,
  RefreshCw,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useAppStore,
  selectActiveStructure,
} from "@/lib/molcraft/store";

interface FullMetadata {
  pdbId: string;
  title: string;
  methods: string[];
  resolution: number[];
  molecularWeight: number | null;
  releaseDate: string;
  revisionDate: string;
  depositDate: string;
  numPolymerEntities: number;
  numNonpolymerEntities: number;
  numWater: number | null;
  assemblyCount: number;
  spaceGroup: string | null;
  cell: {
    length_a?: number;
    length_b?: number;
    length_c?: number;
    angle_alpha?: number;
    angle_beta?: number;
    angle_gamma?: number;
  } | null;
  ligands: Array<{ compId: string; name: string }>;
}

export function StructureInfoPanel({ pdbIdOverride }: { pdbIdOverride?: string }) {
  const activeStructure = useAppStore(selectActiveStructure);
  const [metadata, setMetadata] = useState<FullMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastFetchedId = useRef<string | null>(null);

  // Use override PDB ID if provided (e.g. from PdbViewerModal), otherwise
  // fall back to the active structure from the store
  const effectiveId = pdbIdOverride ?? activeStructure?.id ?? null;

  const fetchMetadata = async (pdbId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `https://data.rcsb.org/rest/v1/core/entry/${pdbId}`,
        { headers: { Accept: "application/json" } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      const ei = d.rcsb_entry_info || {};
      const acc = d.rcsb_accession_info || {};
      const struct = d.struct || {};
      const cell = d.cell || null;
      const sym = d.symmetry || {};

      // Normalize methods to array (API may return string or array)
      const rawMethods = ei.experimental_method;
      const methods: string[] = Array.isArray(rawMethods)
        ? rawMethods
        : rawMethods
        ? [rawMethods]
        : [];
      const rawResolution = ei.resolution_combined;
      const resolution: number[] = Array.isArray(rawResolution)
        ? rawResolution
        : rawResolution != null
        ? [rawResolution]
        : [];

      // Fetch nonpolymer entities (ligands) — need to query each entity
      const ligands: Array<{ compId: string; name: string }> = [];
      const nonPolyIds: string[] =
        d.rcsb_entry_container_identifiers?.non_polymer_entity_ids || [];
      for (const entityId of nonPolyIds.slice(0, 10)) {
        try {
          const r = await fetch(
            `https://data.rcsb.org/rest/v1/core/nonpolymer_entity/${pdbId}/${entityId}`,
            { headers: { Accept: "application/json" } }
          );
          if (r.ok) {
            const e = await r.json();
            const compId =
              e.nonpolymer_comp?.chem_comp?.id ||
              e.rcsb_nonpolymer_instance_container_identifiers?.comp_id ||
              entityId;
            const name =
              e.nonpolymer_comp?.chem_comp?.name ||
              e.rcsb_nonpolymer_instance_container_identifiers?.comp_id ||
              compId;
            ligands.push({ compId, name });
          }
        } catch {}
      }

      setMetadata({
        pdbId: pdbId.toUpperCase(),
        title: struct.title || pdbId,
        methods,
        resolution,
        molecularWeight: ei.molecular_weight ?? null,
        releaseDate: acc.initial_release_date || "",
        revisionDate: acc.revision_date || "",
        depositDate: acc.deposit_date || "",
        numPolymerEntities: ei.polymer_entity_count ?? 0,
        numNonpolymerEntities: ei.nonpolymer_entity_count ?? 0,
        numWater: ei.water_count ?? null,
        assemblyCount: ei.assembly_count ?? 0,
        spaceGroup: sym.space_group_name_H_M || null,
        cell: cell
          ? {
              length_a: cell.length_a,
              length_b: cell.length_b,
              length_c: cell.length_c,
              angle_alpha: cell.angle_alpha,
              angle_beta: cell.angle_beta,
              angle_gamma: cell.angle_gamma,
            }
          : null,
        ligands,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setMetadata(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const id = effectiveId;
    if (!id || !/^[a-zA-Z0-9]{4}$/.test(id)) {
      setMetadata(null);
      setError(null);
      lastFetchedId.current = null;
      return;
    }
    if (lastFetchedId.current === id) return;
    lastFetchedId.current = id;
    fetchMetadata(id.toUpperCase());
  }, [effectiveId]);

  if (!effectiveId) {
    return (
      <div className="sa-empty-state p-4">
        <Box className="h-8 w-8 text-claude-text-muted" />
        <p className="text-xs">No structure loaded</p>
        <p className="text-[10px] text-claude-text-muted">
          Load a PDB ID to view detailed metadata.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex items-center gap-2">
        <Database className="h-3.5 w-3.5 text-claude-accent" />
        <span className="text-[11px] font-semibold text-claude-text">
          Structure Info
        </span>
        {metadata && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 w-6 p-0"
            onClick={() => fetchMetadata(metadata.pdbId)}
            title="Refresh metadata"
            disabled={loading}
          >
            <RefreshCw
              className={`h-3 w-3 ${loading ? "animate-spin" : ""}`}
            />
          </Button>
        )}
      </div>

      {loading && !metadata && (
        <div className="flex items-center justify-center gap-2 py-4 text-xs text-claude-text-secondary">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-claude-accent" />
          Fetching metadata...
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[10px] text-destructive">
          {error}
        </div>
      )}

      {metadata && (
        <ScrollArea className="sa-scroll max-h-[500px]">
          <div className="space-y-2">
            {/* PDB ID + Title */}
            <div className="rounded-md border border-claude-border bg-claude-bg p-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-bold text-claude-accent">
                  {metadata.pdbId}
                </span>
                {metadata.methods.map((m) => (
                  <Badge
                    key={m}
                    variant="outline"
                    className="text-[8px] px-1 py-0"
                  >
                    {m}
                  </Badge>
                ))}
                <a
                  href={`https://www.rcsb.org/structure/${metadata.pdbId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto text-claude-text-muted hover:text-claude-accent"
                  title="View on RCSB"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <p className="mt-1 text-[10px] text-claude-text-secondary leading-relaxed">
                {metadata.title}
              </p>
            </div>

            {/* Experimental */}
            <InfoSection icon={<Microscope className="h-3 w-3" />} title="Experimental">
              <InfoRow
                label="Method"
                value={metadata.methods.join(", ") || "—"}
              />
              <InfoRow
                label="Resolution"
                value={
                  metadata.resolution.length > 0
                    ? `${metadata.resolution.map((r) => r.toFixed(2)).join(", ")} Å`
                    : "—"
                }
              />
              <InfoRow
                label="Mol. Weight"
                value={
                  metadata.molecularWeight != null
                    ? `${metadata.molecularWeight} kDa`
                    : "—"
                }
              />
              {metadata.spaceGroup && (
                <InfoRow
                  label="Space Group"
                  value={metadata.spaceGroup}
                />
              )}
            </InfoSection>

            {/* Cell parameters */}
            {metadata.cell && (
              <InfoSection icon={<Box className="h-3 w-3" />} title="Unit Cell">
                <div className="grid grid-cols-3 gap-1">
                  <CellParam label="a" value={metadata.cell.length_a} unit="Å" />
                  <CellParam label="b" value={metadata.cell.length_b} unit="Å" />
                  <CellParam label="c" value={metadata.cell.length_c} unit="Å" />
                  <CellParam label="α" value={metadata.cell.angle_alpha} unit="°" />
                  <CellParam label="β" value={metadata.cell.angle_beta} unit="°" />
                  <CellParam label="γ" value={metadata.cell.angle_gamma} unit="°" />
                </div>
              </InfoSection>
            )}

            {/* Entities */}
            <InfoSection icon={<Layers className="h-3 w-3" />} title="Entities">
              <InfoRow
                label="Polymer"
                value={String(metadata.numPolymerEntities)}
              />
              <InfoRow
                label="Non-polymer"
                value={String(metadata.numNonpolymerEntities)}
              />
              <InfoRow
                label="Water"
                value={metadata.numWater != null ? String(metadata.numWater) : "—"}
              />
              <InfoRow
                label="Assemblies"
                value={String(metadata.assemblyCount)}
              />
            </InfoSection>

            {/* Ligands */}
            {metadata.ligands.length > 0 && (
              <InfoSection icon={<Atom className="h-3 w-3" />} title="Ligands">
                <div className="flex flex-wrap gap-1">
                  {metadata.ligands.map((l) => (
                    <Badge
                      key={l.compId}
                      variant="outline"
                      className="text-[8px] px-1 py-0 font-mono"
                      title={l.name}
                    >
                      {l.compId}
                    </Badge>
                  ))}
                </div>
              </InfoSection>
            )}

            {/* Dates */}
            <InfoSection icon={<Calendar className="h-3 w-3" />} title="Dates">
              <InfoRow
                label="Deposited"
                value={formatDate(metadata.depositDate)}
              />
              <InfoRow
                label="Released"
                value={formatDate(metadata.releaseDate)}
              />
              <InfoRow
                label="Revised"
                value={formatDate(metadata.revisionDate)}
              />
            </InfoSection>
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function InfoSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-claude-border bg-claude-bg p-2">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="text-claude-accent">{icon}</span>
        <span className="text-[9px] font-semibold uppercase tracking-wide text-claude-text-secondary">
          {title}
        </span>
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[10px]">
      <span className="text-claude-text-muted">{label}</span>
      <span className="font-mono text-claude-text text-right truncate max-w-[60%]">
        {value}
      </span>
    </div>
  );
}

function CellParam({
  label,
  value,
  unit,
}: {
  label: string;
  value?: number;
  unit: string;
}) {
  return (
    <div className="rounded bg-claude-surface px-1 py-0.5 text-center">
      <div className="text-[8px] text-claude-text-muted">{label}</div>
      <div className="font-mono text-[9px] text-claude-text">
        {value != null ? `${value.toFixed(2)}${unit}` : "—"}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso.split("T")[0];
  }
}
