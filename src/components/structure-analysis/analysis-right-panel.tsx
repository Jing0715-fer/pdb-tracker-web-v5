"use client";

/**
 * Structure Analysis right panel — two tabs:
 *  1. Reports: saved analysis markdown reports (from chart dashboards)
 *  2. History: command log + alignment history
 *
 * Adapted from Molcraft's reports-panel + history-panel. The chat/agent
 * panel was removed (we reuse pdb-tracker-web-v4's LLM system).
 */
import { useState, useMemo, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  FileText,
  History,
  Trash2,
  Download,
  Search,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Copy,
  Save,
  FolderOpen,
  Box,
  Dna,
  Pill,
  Beaker,
  Eye,
  EyeOff,
  BarChart3,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAppStore } from "@/lib/molcraft/store";
import { executeCommand } from "@/lib/molcraft/commands";
import { ChartRenderer, ALL_CHART_LABELS } from "./chart-renderer";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// DeepSeek-Harness-inspired agent panel — new agent subsystem
// (append-only session log + turn/step loop + tool registry + LLM seam).
// R164 (AGENT-002 / MOL-002 / UI-009): the legacy chat-tab.tsx (ChatTab) +
// use-agent-loop.ts + /api/llm/agent/round route were deleted — they held a
// divergent system prompt that re-introduced the duplicate-capture bug
// ("ALWAYS call capture_multi_angle after pdb_analyze"). The DSH panel is
// now the only chat surface in the structure-analysis view.
const AgentChatPanel = dynamic(
  () => import("@/components/agent/ChatPanel").then((m) => m.AgentChatPanel),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full text-claude-text-muted text-xs gap-2">
        <div className="h-3 w-3 border-2 border-claude-accent border-t-transparent rounded-full animate-spin" />
        Loading agent…
      </div>
    ),
  }
);

// UI-021: defense-in-depth URL filter for markdown rendered from saved
// reports / LLM output. react-markdown's default transform already drops
// javascript: URLs — this makes the allowlist explicit: only absolute
// http(s), site-relative, and fragment URLs survive.
const safeUrlTransform = (url: string) =>
  /^https?:\/\//i.test(url) || url.startsWith("/") || url.startsWith("#")
    ? url
    : "";

interface StructureInfo {
  pdbId: string;
  title: string;
  methods: string[];
  resolution: number | null;
  molecularWeight: number | null;
  chainCount: number;
  ligands: Array<{ compId: string; name: string }>;
  polymers?: Array<{
    entityId: string;
    chains: string[];
    authChains: string[];
    sequenceLength: number;
    description: string;
    organism: string;
    entityType: string;
  }>;
  nonpolymers?: Array<{
    entityId: string;
    compId: string;
    name: string;
    formulaWeight: number | null;
  }>;
}

type RightTab = "results" | "chat" | "reports" | "entities" | "history";

export function AnalysisRightPanel({ structureInfo }: { structureInfo?: StructureInfo | null }) {
  const [tab, setTab] = useState<RightTab>("reports");
  const activeAnalysisChart = useAppStore((s) => s.activeAnalysisChart);
  const setActiveAnalysisChart = useAppStore((s) => s.setActiveAnalysisChart);
  const saveSession = useAppStore((s) => s.saveSession);
  const loadSession = useAppStore((s) => s.loadSession);
  const toast = useAppStore((s) => s.toast);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-switch to Results tab when a chart is clicked in the left panel.
  // We use a ref + microtask to avoid calling setState synchronously in the
  // effect body (react-hooks/set-state-in-effect lint rule). When the chart
  // is closed (activeAnalysisChart → null), don't auto-switch away.
  const switchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
    if (activeAnalysisChart) {
      switchTimerRef.current = setTimeout(() => setTab("results"), 0);
    }
    return () => { if (switchTimerRef.current) clearTimeout(switchTimerRef.current); };
  }, [activeAnalysisChart]);

  // Auto-switch to Entities tab when structure info becomes available
  // and user hasn't manually selected another tab
  useEffect(() => {
    if (structureInfo && (structureInfo.polymers?.length || structureInfo.nonpolymers?.length)) {
      // Don't auto-switch — let the user choose. Just make the tab visible.
    }
  }, [structureInfo]);

  const handleSaveSession = () => {
    const json = saveSession();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pdb-tracker-session-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Session saved", "success");
  };

  const handleLoadSession = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // UI-022: refuse oversized session files before reading them into memory.
    if (file.size > 10 * 1024 * 1024) {
      toast("文件过大：会话文件不能超过 10MB", "error");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        loadSession(data);
      } catch {
        toast("Invalid session file", "error");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="flex h-full flex-col bg-claude-surface">
      <div className="sa-tab-row shrink-0">
        <button
          className={`sa-tab-btn ${tab === "results" ? "sa-tab-active" : ""}`}
          onClick={() => setTab("results")}
        >
          <BarChart3 className="h-3 w-3" />
          Results
          {activeAnalysisChart && (
            <Badge variant="outline" className="ml-0.5 h-3.5 px-1 text-[7px] bg-claude-accent-light text-claude-accent border-claude-accent/30">
              1
            </Badge>
          )}
        </button>
        <button
          className={`sa-tab-btn ${tab === "chat" ? "sa-tab-active" : ""}`}
          onClick={() => setTab("chat")}
        >
          <MessageSquare className="h-3 w-3" />
          Chat
        </button>
        <button
          className={`sa-tab-btn ${tab === "reports" ? "sa-tab-active" : ""}`}
          onClick={() => setTab("reports")}
        >
          <FileText className="h-3 w-3" />
          Reports
        </button>
        <button
          className={`sa-tab-btn ${tab === "entities" ? "sa-tab-active" : ""}`}
          onClick={() => setTab("entities")}
        >
          <Box className="h-3 w-3" />
          Entities
        </button>
        <button
          className={`sa-tab-btn ${tab === "history" ? "sa-tab-active" : ""}`}
          onClick={() => setTab("history")}
        >
          <History className="h-3 w-3" />
          History
        </button>
        <div className="ml-auto flex items-center gap-0.5 pr-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={handleSaveSession}
            title="Save session"
          >
            <Save className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => fileInputRef.current?.click()}
            title="Load session"
          >
            <FolderOpen className="h-3 w-3" />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleLoadSession}
          />
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {tab === "results" && (
          activeAnalysisChart ? (
            <ChartRenderer
              key={activeAnalysisChart}
              chartId={activeAnalysisChart}
              onClose={() => setActiveAnalysisChart(null)}
            />
          ) : (
            <ResultsEmptyState />
          )
        )}
        {tab === "reports" && <ReportsTab />}
        {tab === "chat" && (
          <div className="flex flex-col h-full min-h-0">
            <div className="flex-1 min-h-0">
              <AgentChatPanel />
            </div>
          </div>
        )}
        {tab === "entities" && <EntitiesTab structureInfo={structureInfo} />}
        {tab === "history" && <HistoryTab />}
      </div>
    </div>
  );
}

// ============================================================
// Results Tab — empty state when no chart is active
// ============================================================
function ResultsEmptyState() {
  const recentCharts = useAppStore((s) => s.recentCharts);
  const setActiveAnalysisChart = useAppStore((s) => s.setActiveAnalysisChart);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="rounded-full bg-claude-accent-light/40 p-3">
        <BarChart3 className="h-6 w-6 text-claude-accent" />
      </div>
      <div>
        <p className="text-xs font-medium text-claude-text">No analysis chart selected</p>
        <p className="text-[10px] text-claude-text-muted mt-0.5 leading-relaxed">
          Click a chart tile in the left panel (Analysis tab) to view its result here.
        </p>
      </div>
      {recentCharts.length > 0 && (
        <div className="w-full mt-2">
          <div className="text-[9px] font-semibold uppercase tracking-wide text-claude-text-muted mb-1.5">
            Recently used
          </div>
          <div className="flex flex-wrap gap-1 justify-center">
            {recentCharts.slice(0, 6).map((id) => (
              <button
                key={id}
                onClick={() => setActiveAnalysisChart(id)}
                className="sa-chart-tile text-[9px]"
                style={{ padding: "0.25rem 0.5rem" }}
              >
                {ALL_CHART_LABELS[id] ?? id}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Reports Tab
// ============================================================
function ReportsTab() {
  const reports = useAppStore((s) => s.reports);
  const removeReport = useAppStore((s) => s.removeReport);
  const toast = useAppStore((s) => s.toast);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return reports;
    const q = search.toLowerCase();
    return reports.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.markdown.toLowerCase().includes(q)
    );
  }, [reports, search]);

  if (reports.length === 0) {
    return (
      <div className="sa-empty-state p-4">
        <FileText className="h-8 w-8 text-claude-text-muted" />
        <p className="text-xs">No saved reports</p>
        <p className="text-[10px] text-claude-text-muted">
          Analysis dashboards (Overview, Comparison) can export markdown reports
          that appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-claude-border p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-claude-text-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search reports…"
            className="h-7 pl-6 text-[11px]"
          />
        </div>
      </div>
      <ScrollArea className="sa-scroll flex-1 min-h-0">
        <div className="space-y-1.5 p-2">
          {filtered.map((r) => {
            const isOpen = expandedId === r.id;
            return (
              <div
                key={r.id}
                className="rounded-md border border-claude-border bg-claude-bg"
              >
                <button
                  onClick={() => setExpandedId(isOpen ? null : r.id)}
                  className="flex w-full items-center gap-2 p-2 text-left hover:bg-claude-accent-light/30"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-claude-accent" />
                  <span className="flex-1 truncate text-[11px] font-medium">
                    {r.title}
                  </span>
                  <span className="text-[9px] text-claude-text-muted">
                    {new Date(r.createdAt).toLocaleString()}
                  </span>
                  <ChevronRight
                    className={`h-3 w-3 text-claude-text-muted transition-transform ${
                      isOpen ? "rotate-90" : ""
                    }`}
                  />
                </button>
                {isOpen && (
                  <div className="border-t border-claude-border p-2">
                    <div className="mb-2 flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[10px]"
                        onClick={() => {
                          navigator.clipboard.writeText(r.markdown);
                          toast("Copied to clipboard", "success");
                        }}
                      >
                        <Copy className="h-3 w-3" />
                        Copy
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[10px]"
                        onClick={() => {
                          const blob = new Blob([r.markdown], {
                            type: "text/markdown",
                          });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `${r.title.replace(/\s+/g, "_")}.md`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                      >
                        <Download className="h-3 w-3" />
                        Download
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[10px] text-destructive hover:text-destructive"
                        onClick={() => removeReport(r.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="prose prose-sm max-w-none text-[11px] text-claude-text">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        urlTransform={safeUrlTransform}
                      >
                        {r.markdown}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

// ============================================================
// History Tab — command log + alignment history
// ============================================================
function HistoryTab() {
  const commandLog = useAppStore((s) => s.commandLog);
  const alignmentHistory = useAppStore((s) => s.alignmentHistory);
  const clearAlignmentHistory = useAppStore((s) => s.clearAlignmentHistory);
  const [section, setSection] = useState<"commands" | "alignments">("commands");

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 gap-1 border-b border-claude-border p-1.5">
        <Button
          size="sm"
          variant={section === "commands" ? "default" : "ghost"}
          className="h-7 flex-1 text-[10px]"
          onClick={() => setSection("commands")}
        >
          Commands ({commandLog.length})
        </Button>
        <Button
          size="sm"
          variant={section === "alignments" ? "default" : "ghost"}
          className="h-7 flex-1 text-[10px]"
          onClick={() => setSection("alignments")}
        >
          Alignments ({alignmentHistory.length})
        </Button>
      </div>
      <ScrollArea className="sa-scroll flex-1 min-h-0">
        <div className="p-2">
          {section === "commands" && (
            <div className="space-y-1">
              {commandLog.length === 0 ? (
                <div className="sa-empty-state p-3">
                  <History className="h-6 w-6 text-claude-text-muted" />
                  <p className="text-[10px]">No commands yet</p>
                </div>
              ) : (
                commandLog.map((cmd, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-1.5 rounded-md border border-claude-border bg-claude-bg p-1.5"
                  >
                    {cmd.ok ? (
                      <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-green-600" />
                    ) : (
                      <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-[10px] font-medium text-claude-text">
                          {cmd.type}
                        </span>
                        <span className="text-[8px] text-claude-text-muted">
                          {new Date(cmd.ts).toLocaleTimeString()}
                        </span>
                      </div>
                      {cmd.detail && (
                        <div className="truncate text-[9px] text-claude-text-secondary">
                          {cmd.detail}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
          {section === "alignments" && (
            <div className="space-y-1">
              {alignmentHistory.length === 0 ? (
                <div className="sa-empty-state p-3">
                  <History className="h-6 w-6 text-claude-text-muted" />
                  <p className="text-[10px]">No alignments yet</p>
                  <p className="text-[9px] text-claude-text-muted">
                    Load 2+ structures and align them from the Structures tab.
                  </p>
                </div>
              ) : (
                <>
                  {alignmentHistory.map((a) => (
                    <div
                      key={a.id}
                      className="rounded-md border border-claude-border bg-claude-bg p-1.5"
                    >
                      <div className="flex items-center gap-1">
                        <Badge variant="outline" className="text-[8px]">
                          {a.method}
                        </Badge>
                        <span className="font-mono text-[10px] text-claude-text">
                          {a.refId} ↔ {a.mobileId}
                        </span>
                      </div>
                      <div className="mt-1 flex gap-2 text-[9px] text-claude-text-secondary">
                        {a.rmsd != null && <span>RMSD: {a.rmsd.toFixed(2)} Å</span>}
                        {a.tmScore != null && (
                          <span>TM: {a.tmScore.toFixed(3)}</span>
                        )}
                        {a.identity != null && (
                          <span>SeqID: {(a.identity * 100).toFixed(1)}%</span>
                        )}
                      </div>
                    </div>
                  ))}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-2 h-7 w-full text-[10px] text-destructive"
                    onClick={clearAlignmentHistory}
                  >
                    <Trash2 className="h-3 w-3" />
                    Clear history
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ============================================================
// Entities Tab — shows polymer chains + ligand/non-polymer entities
// ============================================================
function EntitiesTab({ structureInfo }: { structureInfo: StructureInfo | null }) {
  const activeStructure = useAppStore((s) => s.activeStructureId);
  const structures = useAppStore((s) => s.structures);
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const [expandedEntity, setExpandedEntity] = useState<string | null>(null);

  const polymers = structureInfo?.polymers ?? [];
  const nonpolymers = structureInfo?.nonpolymers ?? [];
  const hasData = polymers.length > 0 || nonpolymers.length > 0;

  // Also check uploaded-file metadata (chains from parsePdb)
  const fileChains = structures.find((s) => s.id === activeStructure)?.metadata?.chains ?? [];

  const focusChain = async (chain: string) => {
    if (!viewer) return;
    // Route through executeCommand so we reuse the verified lociFromChain
    // path (snake_case MolScript properties). Direct structureInteractivity
    // with camelCase props (authAsymId) silently fails — see molstar docs.
    const res = await executeCommand(viewer, { type: "focus_chain", chain });
    toast(res.ok ? `Focused chain ${chain}` : `Chain ${chain} not found`, res.ok ? "info" : "error");
  };

  const focusLigand = async (compId: string) => {
    if (!viewer) return;
    const res = await executeCommand(viewer, { type: "focus_ligand", compId });
    toast(res.ok ? `Focused ligand ${compId}` : `Ligand ${compId} not found`, res.ok ? "info" : "error");
  };

  if (!structureInfo && fileChains.length === 0) {
    return (
      <div className="p-4 text-center text-[11px] text-claude-text-muted">
        <Box className="mx-auto h-8 w-8 mb-2 opacity-40" />
        <p>No entity data available.</p>
        <p className="mt-1 text-[10px]">
          Load a PDB ID to view chain and ligand information.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full sa-scroll">
      <div className="p-2 space-y-2">
        {/* Summary header */}
        {structureInfo && (
          <div className="rounded-md border border-claude-border bg-claude-bg/50 p-2">
            <div className="flex items-center gap-1.5 mb-1">
              <Beaker className="h-3 w-3 text-claude-accent" />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-claude-text-secondary">
                {structureInfo.pdbId} Summary
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1 text-[9px]">
              <div className="flex items-center gap-1">
                <span className="text-claude-text-muted">Method:</span>
                <span className="font-mono text-claude-text">
                  {structureInfo.methods.join(", ") || "—"}
                </span>
              </div>
              {structureInfo.resolution != null && (
                <div className="flex items-center gap-1">
                  <span className="text-claude-text-muted">Resolution:</span>
                  <span className="font-mono text-claude-text">
                    {structureInfo.resolution} Å
                  </span>
                </div>
              )}
              <div className="flex items-center gap-1">
                <span className="text-claude-text-muted">Polymers:</span>
                <span className="font-mono text-claude-text">{polymers.length}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-claude-text-muted">Ligands:</span>
                <span className="font-mono text-claude-text">{nonpolymers.length}</span>
              </div>
            </div>
            {structureInfo.title && (
              <p className="mt-1.5 text-[9px] text-claude-text-secondary leading-relaxed line-clamp-2">
                {structureInfo.title}
              </p>
            )}
          </div>
        )}

        {/* Polymer entities (chains) */}
        {polymers.length > 0 && (
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-wide text-claude-text-secondary mb-1 flex items-center gap-1">
              <Dna className="h-3 w-3" />
              Polymer Entities ({polymers.length})
            </div>
            <div className="space-y-1">
              {polymers.map((p) => {
                const isExpanded = expandedEntity === `poly-${p.entityId}`;
                return (
                  <div
                    key={`poly-${p.entityId}`}
                    className="rounded-md border border-claude-border/60 bg-claude-surface overflow-hidden"
                  >
                    <button
                      onClick={() =>
                        setExpandedEntity(isExpanded ? null : `poly-${p.entityId}`)
                      }
                      className="w-full flex items-center gap-1.5 p-1.5 text-left hover:bg-claude-border-light/40 transition-colors"
                    >
                      <ChevronRight
                        className={`h-2.5 w-2.5 text-claude-text-muted transition-transform ${
                          isExpanded ? "rotate-90" : ""
                        }`}
                      />
                      <span className="font-mono text-[10px] font-semibold text-claude-accent">
                        {p.chains.join(",")}
                      </span>
                      <span className="text-[9px] text-claude-text-muted truncate flex-1">
                        {p.description || p.entityType}
                      </span>
                      <Badge variant="outline" className="text-[8px] px-1 h-4">
                        {p.sequenceLength}aa
                      </Badge>
                    </button>
                    {isExpanded && (
                      <div className="px-2 pb-2 space-y-1 text-[9px] border-t border-claude-border/40">
                        {p.description && (
                          <div>
                            <span className="text-claude-text-muted">Description: </span>
                            <span className="text-claude-text">{p.description}</span>
                          </div>
                        )}
                        {p.organism && (
                          <div>
                            <span className="text-claude-text-muted">Organism: </span>
                            <span className="text-claude-text">{p.organism}</span>
                          </div>
                        )}
                        <div>
                          <span className="text-claude-text-muted">Type: </span>
                          <span className="text-claude-text">{p.entityType}</span>
                        </div>
                        <div>
                          <span className="text-claude-text-muted">Auth chains: </span>
                          <span className="font-mono text-claude-text">
                            {p.authChains.join(", ")}
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 mt-1 text-[9px] gap-1"
                          onClick={() => focusChain(p.chains[0])}
                          disabled={!viewer}
                        >
                          <Box className="h-2.5 w-2.5" />
                          Focus in 3D
                        </Button>
                        <div className="flex items-center gap-0.5 mt-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 px-1.5 text-[9px] gap-0.5"
                            onClick={async () => {
                              if (!viewer) return;
                              const res = await executeCommand(viewer, {
                                type: "toggle_component_visibility",
                                component: p.chains[0],
                                action: "toggle",
                              });
                              toast(res.ok ? `Toggled chain ${p.chains[0]}` : res.detail, res.ok ? "info" : "error");
                            }}
                            disabled={!viewer}
                            title={`Toggle visibility of chain ${p.chains[0]}`}
                          >
                            <Eye className="h-2.5 w-2.5" />
                            Hide
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 px-1.5 text-[9px] gap-0.5"
                            onClick={async () => {
                              if (!viewer) return;
                              // Solo: hide all other chains, show this one
                              const allChains = polymers.flatMap(pp => pp.chains);
                              for (const c of allChains) {
                                await executeCommand(viewer, {
                                  type: "toggle_component_visibility",
                                  component: c,
                                  action: c === p.chains[0] ? "show" : "hide",
                                });
                              }
                              toast(`Solo: chain ${p.chains[0]}`, "info");
                            }}
                            disabled={!viewer}
                            title={`Solo chain ${p.chains[0]} (hide all others)`}
                          >
                            <EyeOff className="h-2.5 w-2.5" />
                            Solo
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Fallback: show file-parsed chains if no RCSB data */}
        {polymers.length === 0 && fileChains.length > 0 && (
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-wide text-claude-text-secondary mb-1 flex items-center gap-1">
              <Dna className="h-3 w-3" />
              Chains ({fileChains.length})
            </div>
            <div className="flex flex-wrap gap-1">
              {fileChains.map((c) => (
                <button
                  key={c}
                  onClick={() => focusChain(c)}
                  disabled={!viewer}
                  className="px-2 py-1 rounded-md text-[10px] font-mono font-semibold border border-claude-border bg-claude-surface hover:border-claude-accent/40 hover:bg-claude-accent-light/50 transition-colors text-claude-text disabled:opacity-40"
                  title={`Focus chain ${c} in 3D viewer`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Non-polymer entities (ligands) */}
        {nonpolymers.length > 0 && (
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-wide text-claude-text-secondary mb-1 flex items-center gap-1">
              <Pill className="h-3 w-3" />
              Ligands & Cofactors ({nonpolymers.length})
            </div>
            <div className="space-y-1">
              {nonpolymers.map((np) => (
                <div
                  key={`np-${np.entityId}`}
                  className="rounded-md border border-claude-border/60 bg-claude-surface p-1.5"
                >
                  <div className="flex items-center gap-1.5">
                    <Badge
                      variant="outline"
                      className="text-[9px] font-mono font-bold px-1.5 h-5 bg-claude-accent-light text-claude-accent border-claude-accent/30"
                    >
                      {np.compId}
                    </Badge>
                    <span className="text-[10px] text-claude-text flex-1 truncate">
                      {np.name}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 w-5 p-0"
                      onClick={() => focusLigand(np.compId)}
                      disabled={!viewer}
                      title={`Focus ${np.compId} in 3D viewer`}
                    >
                      <Box className="h-2.5 w-2.5" />
                    </Button>
                  </div>
                  {np.formulaWeight != null && (
                    <div className="mt-0.5 text-[9px] text-claude-text-muted">
                      MW: {np.formulaWeight.toFixed(1)} Da
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
