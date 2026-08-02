'use client';

/**
 * ProvenancePanel — Claude Science-inspired "trace every result" panel.
 *
 * Renders the provenance record stored on an Evaluation row:
 *   • Reproducibility score (0-100) — citation verification rate + data
 *     source coverage + LLM call logging.
 *   • Data sources queried (UniProt / RCSB / NCBI BLAST) with result counts.
 *   • LLM calls (provider / model / prompt hash) so the exact generation
 *     context is auditable.
 *   • Citations extracted from the report, each with a verified / not-found
 *     badge linking to its source database for manual confirmation.
 *
 * If the Evaluation row has no provenance (legacy rows created before this
 * upgrade), we show a friendly "not available" state instead of a blank panel.
 */
import { useMemo, useState } from 'react';
import {
  ShieldCheck, ShieldAlert, Database, Brain, Link2,
  CheckCircle2, XCircle, ExternalLink, ChevronDown, ChevronRight,
} from 'lucide-react';
import type { Evaluation } from '@/lib/pdb-types';
import {
  type ProvenanceRecord,
  type CitationEntry,
  summarizeProvenance,
} from '@/lib/provenance';

interface ProvenancePanelProps {
  evaluation: Evaluation;
}

export function ProvenancePanel({ evaluation }: ProvenancePanelProps) {
  const [citationsExpanded, setCitationsExpanded] = useState(false);

  const prov = useMemo<ProvenanceRecord | null>(() => {
    const raw = (evaluation as any).provenance;
    if (!raw || typeof raw !== 'string') return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed?.version === 1 ? (parsed as ProvenanceRecord) : null;
    } catch {
      return null;
    }
  }, [evaluation]);

  const summary = useMemo(() => summarizeProvenance(prov), [prov]);

  if (!prov) {
    return (
      <div className="rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-claude-border-light/30 dark:bg-[#1a1917]/30 p-4">
        <div className="flex items-center gap-2 mb-2">
          <ShieldAlert className="h-4 w-4 text-claude-text-muted" />
          <h4 className="text-[11px] font-semibold text-claude-text uppercase tracking-wider">
            Provenance & Reproducibility
          </h4>
        </div>
        <p className="text-xs text-claude-text-muted">
          该评估无溯源记录（可能是在此功能上线前生成的）。重新评估即可生成完整的溯源信息。
        </p>
      </div>
    );
  }

  const scoreColor =
    summary.reproducibilityScore >= 80
      ? 'text-emerald-500'
      : summary.reproducibilityScore >= 50
      ? 'text-amber-500'
      : 'text-red-500';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-claude-accent" />
        <h4 className="text-[11px] font-semibold text-claude-text uppercase tracking-wider">
          Provenance & Reproducibility
        </h4>
      </div>

      {/* Reproducibility score + summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-white dark:bg-[#242220] p-3">
          <div className="text-[10px] text-claude-text-muted uppercase tracking-wider mb-1">可复现性</div>
          <div className={`text-2xl font-bold tabular-nums ${scoreColor}`}>{summary.reproducibilityScore}</div>
          <div className="text-[9px] text-claude-text-muted">/ 100</div>
        </div>
        <div className="rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-white dark:bg-[#242220] p-3">
          <div className="text-[10px] text-claude-text-muted uppercase tracking-wider mb-1">引用验证</div>
          <div className="text-lg font-bold text-claude-text tabular-nums">
            <span className="text-emerald-500">{summary.verifiedCitations}</span>
            <span className="text-claude-text-muted text-sm"> / {summary.totalCitations}</span>
          </div>
          <div className="text-[9px] text-claude-text-muted">已验证 / 总引用</div>
        </div>
        <div className="rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-white dark:bg-[#242220] p-3">
          <div className="text-[10px] text-claude-text-muted uppercase tracking-wider mb-1">数据源</div>
          <div className="text-lg font-bold text-claude-text tabular-nums">{summary.sourcesQueried}</div>
          <div className="text-[9px] text-claude-text-muted">个数据库</div>
        </div>
        <div className="rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-white dark:bg-[#242220] p-3">
          <div className="text-[10px] text-claude-text-muted uppercase tracking-wider mb-1">LLM 调用</div>
          <div className="text-lg font-bold text-claude-text tabular-nums">{summary.llmCallsMade}</div>
          <div className="text-[9px] text-claude-text-muted">次生成</div>
        </div>
      </div>

      {/* Data sources */}
      <div className="rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-white dark:bg-[#242220] p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Database className="h-3.5 w-3.5 text-claude-text-muted" />
          <span className="text-[11px] font-semibold text-claude-text">数据源 (Data Sources)</span>
        </div>
        <div className="space-y-1.5">
          {prov.dataSources.map((ds, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px]">
              <span className="px-1.5 py-0.5 rounded bg-claude-accent/10 text-claude-accent font-mono font-semibold w-20 text-center flex-shrink-0">
                {ds.source}
              </span>
              <span className="text-claude-text-secondary truncate flex-1" title={ds.query}>{ds.query}</span>
              <span className="text-claude-text-muted font-mono flex-shrink-0">{ds.resultCount} 条</span>
            </div>
          ))}
        </div>
      </div>

      {/* LLM calls */}
      <div className="rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-white dark:bg-[#242220] p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Brain className="h-3.5 w-3.5 text-claude-text-muted" />
          <span className="text-[11px] font-semibold text-claude-text">LLM 调用 (Generation Trace)</span>
        </div>
        <div className="space-y-1">
          {prov.llmCalls.slice(0, 3).map((llm, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px] font-mono">
              <span className="text-claude-text-secondary w-32 truncate" title={llm.provider}>{llm.provider}</span>
              <span className="text-claude-text-muted">/</span>
              <span className="text-claude-text-secondary w-32 truncate" title={llm.model}>{llm.model}</span>
              <span className="text-claude-text-muted ml-auto">prompt: {llm.promptHash}</span>
            </div>
          ))}
          {prov.llmCalls.length > 3 && (
            <div className="text-[10px] text-claude-text-muted">+ {prov.llmCalls.length - 3} more calls</div>
          )}
        </div>
      </div>

      {/* Citations */}
      {prov.citations.length > 0 && (
        <div className="rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-white dark:bg-[#242220] p-3">
          <button
            onClick={() => setCitationsExpanded((v) => !v)}
            className="flex items-center gap-1.5 w-full text-left mb-2"
          >
            {citationsExpanded ? <ChevronDown className="h-3.5 w-3.5 text-claude-text-muted" /> : <ChevronRight className="h-3.5 w-3.5 text-claude-text-muted" />}
            <Link2 className="h-3.5 w-3.5 text-claude-text-muted" />
            <span className="text-[11px] font-semibold text-claude-text">引用验证 (Citation Verification)</span>
            <span className="ml-auto text-[10px] text-claude-text-muted">
              {summary.verifiedCitations}/{summary.totalCitations} verified
            </span>
          </button>
          {citationsExpanded && (
            <div className="space-y-1 max-h-72 overflow-y-auto thin-scroll">
              {prov.citations.map((c, i) => (
                <CitationRow key={i} citation={c} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Generation timestamp */}
      <div className="text-[10px] text-claude-text-muted text-center">
        溯源生成于 {new Date(prov.generatedAt).toLocaleString('zh-CN')} · app v{prov.appVersion}
      </div>
    </div>
  );
}

function CitationRow({ citation }: { citation: CitationEntry }) {
  const url = citationUrl(citation);
  const icon = citation.verified
    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
    : <XCircle className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />;

  return (
    <div className="flex items-start gap-2 py-1 border-b border-claude-border/30 dark:border-[#3d3832]/30 last:border-0">
      {icon}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="px-1 py-0.5 rounded bg-claude-border-light dark:bg-[#3d3832] text-[9px] font-mono font-semibold text-claude-text-secondary uppercase">
            {citation.type}
          </span>
          <span className="font-mono text-[11px] font-semibold text-claude-text">{citation.id}</span>
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer" className="text-claude-accent hover:underline">
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        <div className="text-[10px] text-claude-text-muted mt-0.5 truncate" title={citation.context}>
          …{citation.context}
        </div>
        {citation.verifyDetail && (
          <div className={`text-[9px] mt-0.5 ${citation.verified ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
            {citation.verifyDetail}
          </div>
        )}
      </div>
    </div>
  );
}

function citationUrl(c: CitationEntry): string | null {
  if (c.type === 'pdb') return `https://www.rcsb.org/structure/${c.id}`;
  if (c.type === 'pmid') return `https://pubmed.ncbi.nlm.nih.gov/${c.id}/`;
  if (c.type === 'doi') return `https://doi.org/${c.id}`;
  if (c.type === 'uniprot') return `https://www.uniprot.org/uniprotkb/${c.id}`;
  return null;
}
