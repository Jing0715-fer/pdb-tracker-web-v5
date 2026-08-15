"use client";

/**
 * Analysis Summary — compact quick-analysis panel shown in the PdbViewerModal.
 *
 * Fetches key structure statistics (quality, secondary structure, SASA)
 * in parallel and displays them as compact stat cards. This gives users
 * immediate analysis results without leaving the 3D preview.
 */
import { useState, useEffect, useCallback } from "react";
import {
  Activity,
  Loader2,
  RefreshCw,
  AlertCircle,
  ShieldCheck,
  Spline,
  CircleDashed,
  Box,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface SummaryData {
  quality?: {
    favoured_pct?: number;
    outlier_pct?: number;
    clashes?: number;
    grade?: string;
  };
  secondary_structure?: {
    helix_pct?: number;
    sheet_pct?: number;
    coil_pct?: number;
  };
  sasa?: {
    total_A2?: number;
    n_chains?: number;
  };
  bfactor?: {
    mean?: number;
    min?: number;
    max?: number;
  };
}

interface AnalysisSummaryProps {
  pdbId: string;
}

export function AnalysisSummary({ pdbId }: AnalysisSummaryProps) {
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    setProgress(0);
    setData(null);

    const recipes = [
      { name: "ramachandran", key: "quality" },
      { name: "secondary_structure_simple", key: "secondary_structure" },
      { name: "sasa", key: "sasa" },
      { name: "bfactor_stats", key: "bfactor" },
    ];

    const result: SummaryData = {};
    let completed = 0;

    // Run recipes in parallel
    await Promise.all(
      recipes.map(async (recipe) => {
        try {
          const res = await fetch("/api/analyze/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              recipe: recipe.name,
              pdbId: pdbId.toUpperCase(),
              params: {},
            }),
          });
          if (res.ok) {
            const json = await res.json();
            if (json.ok && json.data) {
              const d = json.data;
              if (recipe.key === "quality") {
                const favoured = d.regions?.favoured ?? 0;
                const outlier = d.regions?.outlier ?? 0;
                const total = d.total_residues ?? 1;
                result.quality = {
                  favoured_pct: (favoured / total) * 100,
                  outlier_pct: (outlier / total) * 100,
                  clashes: 0,
                  grade:
                    favoured / total > 0.95
                      ? "Excellent"
                      : favoured / total > 0.85
                      ? "Good"
                      : favoured / total > 0.7
                      ? "Fair"
                      : "Poor",
                };
              } else if (recipe.key === "secondary_structure") {
                const total =
                  (d.helix_count ?? 0) +
                  (d.sheet_count ?? 0) +
                  (d.coil_count ?? 0) ||
                  1;
                result.secondary_structure = {
                  helix_pct: ((d.helix_count ?? 0) / total) * 100,
                  sheet_pct: ((d.sheet_count ?? 0) / total) * 100,
                  coil_pct: ((d.coil_count ?? 0) / total) * 100,
                };
              } else if (recipe.key === "sasa") {
                result.sasa = {
                  total_A2: d.total_sasa_A2 ?? 0,
                  n_chains: d.n_chains ?? 0,
                };
              } else if (recipe.key === "bfactor") {
                const chains = d.chains || {};
                const firstChain = Object.values(chains)[0] as any;
                result.bfactor = {
                  mean: firstChain?.mean ?? 0,
                  min: firstChain?.min ?? 0,
                  max: firstChain?.max ?? 0,
                };
              }
            }
          }
        } catch {
          // Individual recipe failures are OK — we just skip that metric
        }
        completed++;
        setProgress((completed / recipes.length) * 100);
      })
    );

    setData(result);
    setLoading(false);
  }, [pdbId]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Activity className="h-3.5 w-3.5 text-claude-accent" />
        <span className="text-[11px] font-semibold text-claude-text">
          Quick Analysis
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 w-6 p-0"
          onClick={fetchSummary}
          disabled={loading}
          title="Refresh analysis"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Progress bar */}
      {loading && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[10px] text-claude-text-secondary">
            <Loader2 className="h-3 w-3 animate-spin text-claude-accent" />
            Running analysis recipes...
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-claude-border-light dark:bg-[#2b2926]">
            <div
              className="h-full bg-claude-accent transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {["Ramachandran", "Sec. Structure", "SASA", "B-factor"].map((name, i) => (
              <div
                key={name}
                className="flex items-center gap-1 rounded border border-claude-border bg-claude-bg dark:bg-[#1a1917] px-1.5 py-1 text-[9px]"
              >
                <Loader2
                  className={`h-2 w-2 ${
                    progress > (i + 1) * 25 ? "text-green-500" : "text-claude-accent animate-spin"
                  }`}
                />
                <span className="text-claude-text-muted">{name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[10px] text-destructive">
          <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Results */}
      {!loading && data && (
        <div className="space-y-2">
          {/* Quality */}
          {data.quality && (
            <SummaryCard
              icon={<ShieldCheck className="h-3.5 w-3.5 text-claude-accent" />}
              title="Structure Quality"
              grade={data.quality.grade}
            >
              <StatRow
                label="Ramachandran Favoured"
                value={`${data.quality.favoured_pct?.toFixed(1)}%`}
                color={
                  (data.quality.favoured_pct ?? 0) > 90
                    ? "text-green-600"
                    : (data.quality.favoured_pct ?? 0) > 75
                    ? "text-amber-600"
                    : "text-red-600"
                }
              />
              <StatRow
                label="Outliers"
                value={`${data.quality.outlier_pct?.toFixed(1)}%`}
                color={
                  (data.quality.outlier_pct ?? 0) < 2
                    ? "text-green-600"
                    : (data.quality.outlier_pct ?? 0) < 5
                    ? "text-amber-600"
                    : "text-red-600"
                }
              />
            </SummaryCard>
          )}

          {/* Secondary Structure */}
          {data.secondary_structure && (
            <SummaryCard
              icon={<Spline className="h-3.5 w-3.5 text-claude-accent" />}
              title="Secondary Structure"
            >
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-claude-border">
                <div
                  className="bg-claude-accent"
                  style={{ width: `${data.secondary_structure.helix_pct}%` }}
                  title={`Helix: ${data.secondary_structure.helix_pct?.toFixed(1)}%`}
                />
                <div
                  className="bg-teal-500"
                  style={{ width: `${data.secondary_structure.sheet_pct}%` }}
                  title={`Sheet: ${data.secondary_structure.sheet_pct?.toFixed(1)}%`}
                />
                <div
                  className="bg-claude-text-muted"
                  style={{ width: `${data.secondary_structure.coil_pct}%` }}
                  title={`Coil: ${data.secondary_structure.coil_pct?.toFixed(1)}%`}
                />
              </div>
              <div className="mt-1 flex justify-between text-[8px]">
                <span className="text-claude-accent">
                  α {data.secondary_structure.helix_pct?.toFixed(0)}%
                </span>
                <span className="text-teal-500">
                  β {data.secondary_structure.sheet_pct?.toFixed(0)}%
                </span>
                <span className="text-claude-text-muted">
                  Coil {data.secondary_structure.coil_pct?.toFixed(0)}%
                </span>
              </div>
            </SummaryCard>
          )}

          {/* SASA */}
          {data.sasa && (
            <SummaryCard
              icon={<CircleDashed className="h-3.5 w-3.5 text-claude-accent" />}
              title="Solvent Accessibility"
            >
              <StatRow
                label="Total SASA"
                value={`${data.sasa.total_A2?.toLocaleString(undefined, { maximumFractionDigits: 0 })} Å²`}
              />
              <StatRow label="Chains" value={String(data.sasa.n_chains)} />
            </SummaryCard>
          )}

          {/* B-factor */}
          {data.bfactor && (
            <SummaryCard
              icon={<Zap className="h-3.5 w-3.5 text-claude-accent" />}
              title="B-factor Stats"
            >
              <StatRow label="Mean" value={data.bfactor.mean?.toFixed(1)} />
              <div className="flex gap-2">
                <StatRow label="Min" value={data.bfactor.min?.toFixed(1)} />
                <StatRow label="Max" value={data.bfactor.max?.toFixed(1)} />
              </div>
            </SummaryCard>
          )}

          {!data.quality && !data.secondary_structure && !data.sasa && !data.bfactor && (
            <div className="rounded-md border border-claude-border bg-claude-bg p-3 text-center text-[10px] text-claude-text-muted">
              No analysis data available. Click refresh to retry.
            </div>
          )}
        </div>
      )}

      {!loading && !data && !error && (
        <div className="rounded-md border border-claude-border bg-claude-bg p-3 text-center text-[10px] text-claude-text-muted">
          Click refresh to run analysis.
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  icon,
  title,
  grade,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  grade?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-claude-border bg-claude-bg dark:bg-[#1a1917] p-2">
      <div className="mb-1.5 flex items-center gap-1.5">
        {icon}
        <span className="text-[10px] font-semibold text-claude-text">{title}</span>
        {grade && (
          <Badge
            variant="outline"
            className={`ml-auto px-1 py-0 text-[8px] ${
              grade === "Excellent"
                ? "border-green-500/40 text-green-600"
                : grade === "Good"
                ? "border-green-500/40 text-green-600"
                : grade === "Fair"
                ? "border-amber-500/40 text-amber-600"
                : "border-red-500/40 text-red-600"
            }`}
          >
            {grade}
          </Badge>
        )}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function StatRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex items-center justify-between text-[9px]">
      <span className="text-claude-text-muted">{label}</span>
      <span className={`font-mono font-medium ${color ?? "text-claude-text"}`}>
        {value}
      </span>
    </div>
  );
}
