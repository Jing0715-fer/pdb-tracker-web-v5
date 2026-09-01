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
  BookOpenCheck, Gauge, ListChecks,
} from 'lucide-react';
import type { Evaluation } from '@/lib/pdb-types';
import {
  type ProvenanceRecord,
  type CitationEntry,
  summarizeProvenance,
} from '@/lib/provenance';

/** R197: DSH 评估写入的 provenance lite 契约（agent.ts provenanceLite）。
 * 旧版面板只认 version===1 的经典结构，DSH 记录永远落入「无溯源」兜底
 * （还会误导用户重跑 10+ 分钟评估去「修复」显示）。 */
interface DshLiteProvenance {
  mode: 'dsh';
  questionDriven?: boolean;
  question?: string;
  sessionId?: string;
  phases?: {
    collect?: { directPdbCount?: number; blastHitCount?: number; literatureCount?: number };
    relevance?: { ok?: boolean; findings?: number; keyPicks?: number };
    outline?: { total?: number; ids?: string[] };
    figures?: { verified?: number };
    chapters?: { ok?: number; failed?: number; deepChars?: number; bodyChars?: number; deepShare?: number; lengthStats?: { inflated?: number; entries?: Array<{ id?: string; chars?: number; maxWords?: number; ratio?: number }> } };
    review?: { reviewed?: number; rewritten?: number; rounds?: number; skippedReview?: number; skippedReReview?: number; rescuedFinal?: number; trajectory?: Array<{ id?: string; rounds?: number; rewritten?: boolean; capped?: boolean; rescuedFinal?: boolean }> };
    finalReview?: { ok?: boolean; issues?: number; high?: number; rewrites?: number; termFixes?: number; termReplacements?: number };
    quota?: { transientHits?: number; degradedReview?: boolean; skippedReview?: boolean; skippedFinalReview?: boolean };
  };
  llm?: { provider?: string; model?: string; durationMs?: number; transientHits?: number };
  generatedAt?: string;
}

interface ProvenancePanelProps {
  evaluation: Evaluation;
}

export function ProvenancePanel({ evaluation }: ProvenancePanelProps) {
  const [citationsExpanded, setCitationsExpanded] = useState(false);

  // R197: DSH lite 结构优先识别（无 version 字段，以 mode === 'dsh' 判别）。
  const dshProv = useMemo<DshLiteProvenance | null>(() => {
    const raw = (evaluation as any).provenance;
    if (!raw || typeof raw !== 'string') return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed?.mode === 'dsh' ? (parsed as DshLiteProvenance) : null;
    } catch {
      return null;
    }
  }, [evaluation]);

  const prov = useMemo<ProvenanceRecord | null>(() => {
    if (dshProv) return null; // DSH 记录不走经典分支
    const raw = (evaluation as any).provenance;
    if (!raw || typeof raw !== 'string') return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed?.version === 1 ? (parsed as ProvenanceRecord) : null;
    } catch {
      return null;
    }
  }, [evaluation, dshProv]);

  const summary = useMemo(() => summarizeProvenance(prov), [prov]);

  if (dshProv) return <DshProvView prov={dshProv} />;

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
          该评估无溯源记录（可能是在此功能上线前生成的经典评估）。重新评估即可生成完整的溯源信息。
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

/** R197: DSH lite 溯源视图 —— 渲染 agent.ts provenanceLite 的 phases/review
 * trajectory/lengthStats/quota 字段（R195 落地的度量首次在前端可见）。 */
function DshProvView({ prov }: { prov: DshLiteProvenance }) {
  const ph = prov.phases ?? {};
  const collect = ph.collect ?? {};
  const relevance = ph.relevance ?? {};
  const outline = ph.outline ?? {};
  const figures = ph.figures ?? {};
  const chapters = ph.chapters ?? {};
  const review = ph.review ?? {};
  const finalReview = ph.finalReview ?? {};
  const quota = ph.quota ?? {};
  const llm = prov.llm ?? {};
  const trajectory = review.trajectory ?? [];
  const lengthEntries = chapters.lengthStats?.entries ?? [];
  const durationS = typeof llm.durationMs === 'number' ? Math.round(llm.durationMs / 1000) : null;
  const deepShare = typeof chapters.deepShare === 'number' ? Math.round(chapters.deepShare) : null;

  const card = 'rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-white dark:bg-[#242220] p-3';
  const statLabel = 'text-[10px] text-claude-text-muted uppercase tracking-wider mb-1';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <ShieldCheck className="h-4 w-4 text-claude-accent" />
        <h4 className="text-[11px] font-semibold text-claude-text uppercase tracking-wider">
          Provenance & Reproducibility
        </h4>
        <span className="px-1.5 py-0.5 rounded bg-claude-accent/10 text-claude-accent text-[9px] font-mono font-semibold">Agent</span>
        <span className="text-[10px] text-claude-text-muted">
          {prov.questionDriven ? '问题驱动深度评估' : '基础评估模式'}
          {typeof llm.provider === 'string' && llm.provider ? ` · ${llm.provider}${llm.model ? ` / ${llm.model}` : ''}` : ''}
          {durationS != null ? ` · LLM ${durationS}s` : ''}
        </span>
      </div>

      {prov.questionDriven && prov.question && (
        <div className={`${card} text-[11px] text-claude-text-secondary leading-relaxed`}>
          <span className="text-claude-text font-semibold">科学问题：</span>
          {prov.question}
        </div>
      )}

      {/* Phase 概览 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className={card}>
          <div className={statLabel}>数据收集</div>
          <div className="text-lg font-bold text-claude-text tabular-nums">{collect.directPdbCount ?? 0}</div>
          <div className="text-[9px] text-claude-text-muted">PDB 直接命中{collect.blastHitCount ? ` · BLAST ${collect.blastHitCount}` : ''}{collect.literatureCount ? ` · 文献 ${collect.literatureCount}` : ''}</div>
        </div>
        <div className={card}>
          <div className={statLabel}>相关性分析</div>
          <div className={`text-lg font-bold tabular-nums ${relevance.ok ? 'text-emerald-500' : 'text-amber-500'}`}>
            {relevance.ok ? '✓' : '—'}
          </div>
          <div className="text-[9px] text-claude-text-muted">
            {relevance.ok ? `${relevance.findings ?? 0} 项发现 · 重点 ${relevance.keyPicks ?? 0}` : '未解析（降级默认大纲）'}
          </div>
        </div>
        <div className={card}>
          <div className={statLabel}>章节交付</div>
          <div className="text-lg font-bold text-claude-text tabular-nums">
            {chapters.ok ?? 0}<span className="text-claude-text-muted text-sm"> / {(chapters.ok ?? 0) + (chapters.failed ?? 0)}</span>
          </div>
          <div className="text-[9px] text-claude-text-muted">
            大纲 {outline.total ?? 0} 章{deepShare != null ? ` · 深挖占比 ${deepShare}%` : ''}
            {figures.verified ? ` · 配图 ${figures.verified}` : ''}
          </div>
        </div>
        <div className={card}>
          <div className={statLabel}>配额压力</div>
          <div className={`text-lg font-bold tabular-nums ${(llm.transientHits ?? 0) >= 2 ? 'text-amber-500' : 'text-claude-text'}`}>
            {llm.transientHits ?? 0}
          </div>
          <div className="text-[9px] text-claude-text-muted">
            次瞬态退避
            {quota.skippedFinalReview ? ' · 跳过终审' : quota.skippedReview ? ' · 跳过审查环' : quota.degradedReview ? ' · 降级复审' : ''}
          </div>
        </div>
      </div>

      {/* 审稿环轨迹（R195 trajectory） */}
      <div className={card}>
        <div className="flex items-center gap-1.5 mb-2">
          <ListChecks className="h-3.5 w-3.5 text-claude-text-muted" />
          <span className="text-[11px] font-semibold text-claude-text">审稿环轨迹 (Review Trajectory)</span>
          <span className="ml-auto text-[10px] text-claude-text-muted">
            审 {review.reviewed ?? 0} 章 · 重写 {review.rewritten ?? 0} · 共 {review.rounds ?? 0} 轮
            {(review.skippedReview ?? 0) + (review.skippedReReview ?? 0) > 0 ? ` · 降级跳过 ${(review.skippedReview ?? 0) + (review.skippedReReview ?? 0)}` : ''}
            {(review.rescuedFinal ?? 0) > 0 ? ` · 终末补救救回 ${review.rescuedFinal}` : ''}
          </span>
        </div>
        {trajectory.length > 0 ? (
          <div className="space-y-1 max-h-40 overflow-y-auto thin-scroll">
            {trajectory.map((t, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px] font-mono">
                <span className="text-claude-text-secondary w-40 truncate" title={t.id}>{t.id}</span>
                <span className="text-claude-text-muted">{t.rounds ?? 0} 轮</span>
                {t.rewritten && <span className="px-1 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[9px]">重写</span>}
                {t.capped && <span className="px-1 rounded bg-claude-border-light dark:bg-[#3d3832] text-[9px] text-claude-text-muted">轮次上限</span>}
                {t.rescuedFinal && <span className="px-1 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[9px]">终末救回</span>}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[10px] text-claude-text-muted">无审稿记录（基础评估模式或全部降级跳过）</div>
        )}
      </div>

      {/* 终审 + 篇幅（R195 lengthStats） */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className={card}>
          <div className="flex items-center gap-1.5 mb-2">
            <BookOpenCheck className="h-3.5 w-3.5 text-claude-text-muted" />
            <span className="text-[11px] font-semibold text-claude-text">终审一致性 (Final Review)</span>
          </div>
          <div className="text-[11px] text-claude-text-secondary space-y-0.5">
            {finalReview.ok ? (
              <>
                <div>跨章问题 <span className="font-mono font-semibold">{finalReview.issues ?? 0}</span> 项（high {finalReview.high ?? 0}）</div>
                <div>外科修正 <span className="font-mono font-semibold">{finalReview.rewrites ?? 0}</span> 章{finalReview.termFixes ? ` · 术语统一 ${finalReview.termFixes} 项（${finalReview.termReplacements ?? 0} 处）` : ''}</div>
              </>
            ) : (
              <div className="text-claude-text-muted">未运行（章节数不足 / 配额降级跳过 / 问题模式关闭）</div>
            )}
          </div>
        </div>
        <div className={card}>
          <div className="flex items-center gap-1.5 mb-2">
            <Gauge className="h-3.5 w-3.5 text-claude-text-muted" />
            <span className="text-[11px] font-semibold text-claude-text">篇幅分布 (Length Stats)</span>
            {chapters.lengthStats?.inflated ? <span className="px-1 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[9px]">超限 {chapters.lengthStats.inflated} 章</span> : null}
          </div>
          {lengthEntries.length > 0 ? (
            <div className="space-y-1 max-h-40 overflow-y-auto thin-scroll">
              {lengthEntries.map((e, i) => {
                const ratio = typeof e.ratio === 'number' ? e.ratio : null;
                const hot = ratio != null && ratio > 1.6;
                return (
                  <div key={i} className="flex items-center gap-2 text-[11px] font-mono">
                    <span className="text-claude-text-secondary w-40 truncate" title={e.id}>{e.id}</span>
                    <span className={`tabular-nums ${hot ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-claude-text-muted'}`}>
                      {e.chars ?? 0} chars
                    </span>
                    {ratio != null && <span className="text-[9px] text-claude-text-muted">×{ratio.toFixed(2)}</span>}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-[10px] text-claude-text-muted">无篇幅统计（旧版运行）</div>
          )}
        </div>
      </div>

      {/* 生成时间 */}
      <div className="text-[10px] text-claude-text-muted text-center">
        溯源生成于 {prov.generatedAt ? new Date(prov.generatedAt).toLocaleString('zh-CN') : '—'}
        {prov.sessionId ? ` · 会话 ${String(prov.sessionId).slice(0, 8)}` : ''}
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
