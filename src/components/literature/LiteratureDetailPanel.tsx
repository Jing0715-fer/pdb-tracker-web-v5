'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { X, ExternalLink, Link2, BookOpen, Users, Calendar, Tag, Sparkles, Loader2, CheckCircle2, Circle, Box, ExternalLink as ExtLink } from 'lucide-react';
import type { LitPaper } from '@/lib/pdb-types';
import { getMethodColor, getMethodLabel } from '@/components/pdb-helpers';
import { TagInput, TagPill } from './LiteraturePaperTags';
import { LiteratureRelatedPapers } from './LiteratureRelatedPapers';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { CitationFormatSelector } from './CitationFormatSelector';
import { toast } from 'sonner';
import { useI18n } from '@/lib/i18n';

// PdbStructureViewer is only rendered when the user clicks "View 3D structure"
// on a PDB entry (isViewerOpen gate). Statically importing it forces the
// molstar CSS + 2800-line viewer + framer-motion + radix hover-card/collapsible
// to be parsed eagerly whenever the literature detail panel chunk loads.
// Lazy-load so the heavy 3D viewer code only compiles when actually opened.
const PdbStructureViewer = dynamic(
  () => import('@/components/PdbStructureViewer').then(m => ({ default: m.PdbStructureViewer })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-32 text-xs text-claude-text-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
        Loading 3D viewer…
      </div>
    ),
  }
);

interface LiteratureDetailPanelProps {
  paper: LitPaper | null;
  isOpen: boolean;
  onClose: () => void;
  // Tags props
  paperTags?: string[];
  onAddTag?: (pmid: string, tag: string) => void;
  onRemoveTag?: (pmid: string, tag: string) => void;
  // Related papers props
  allPapers?: LitPaper[];
  onSelectPaper?: (paper: LitPaper) => void;
  // Reading progress props
  readingProgress?: number; // 0-100
  onProgressChange?: (pmid: string, value: number) => void;
  onMarkComplete?: (pmid: string) => void;
}

/** Get progress bar color: teal 0-33%, amber 34-66%, green 67-100% */
function getProgressColor(progress: number): string {
  if (progress >= 67) return '#10b981';
  if (progress >= 34) return '#f59e0b';
  return '#2d8f8f';
}

/** Get reading status for badge */
function getReadingStatus(progress: number, locale: 'en' | 'zh'): { color: string; bg: string; text: string; label: string } {
  if (progress >= 100) return { color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200/60 dark:border-emerald-800/30', text: 'border-emerald-300 dark:border-emerald-700', label: locale === 'zh' ? '已读' : 'Read' };
  if (progress > 0) return { color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200/60 dark:border-amber-800/30', text: 'border-amber-300 dark:border-amber-700', label: locale === 'zh' ? '阅读中' : 'Reading' };
  return { color: 'text-gray-500 dark:text-gray-400', bg: 'bg-gray-50 dark:bg-gray-800/50 border-gray-200/60 dark:border-gray-700/30', text: 'border-gray-300 dark:border-gray-600', label: locale === 'zh' ? '未读' : 'Unread' };
}

/** Prestigious journals for special badge */
const PRESTIGE_JOURNALS: Record<string, { label: string; color: string; bgLight: string; bgDark: string; borderLight: string; borderDark: string }> = {
  'nature': { label: 'Nature', color: 'text-red-600 dark:text-red-400', bgLight: 'bg-red-50', bgDark: 'dark:bg-red-900/20', borderLight: 'border-red-200/60', borderDark: 'dark:border-red-800/30' },
  'science': { label: 'Science', color: 'text-blue-600 dark:text-blue-400', bgLight: 'bg-blue-50', bgDark: 'dark:bg-blue-900/20', borderLight: 'border-blue-200/60', borderDark: 'dark:border-blue-800/30' },
  'cell': { label: 'Cell', color: 'text-emerald-600 dark:text-emerald-400', bgLight: 'bg-emerald-50', bgDark: 'dark:bg-emerald-900/20', borderLight: 'border-emerald-200/60', borderDark: 'dark:border-emerald-800/30' },
};

function getJournalPrestige(journal: string | undefined) {
  if (!journal) return null;
  const lower = journal.toLowerCase();
  for (const [key, prestige] of Object.entries(PRESTIGE_JOURNALS)) {
    if (lower.includes(key)) return prestige;
  }
  return null;
}

/** Simulated Altmetric-style donut score based on IF and PDB count */
function computeAltmetricScore(paper: LitPaper): number {
  let score = 0;
  if (paper.IF != null) {
    score += Math.min(paper.IF * 3, 60);
  }
  score += Math.min(paper.pdbs.length * 5, 20);
  if (paper.doi) score += 5;
  if (paper.abstract) score += 5;
  score += Math.min((paper.keywords?.length || 0) * 2, 10);
  return Math.round(Math.min(score, 100));
}

/** IF badge with color gradient */
function IFGradientBadge({ ifValue }: { ifValue: number }) {
  // Compute color intensity based on IF value (0-70+ scale)
  const intensity = Math.min(ifValue / 70, 1);
  // Gradient from emerald (low IF) → amber → orange → red (high IF)
  let bgColor: string;
  let textColor: string;
  let borderColor: string;
  let glowColor: string;

  if (ifValue >= 30) {
    bgColor = `rgba(220, 38, 38, ${0.08 + intensity * 0.1})`;
    textColor = 'text-red-600 dark:text-red-400';
    borderColor = 'rgba(220, 38, 38, 0.2)';
    glowColor = 'rgba(220, 38, 38, 0.15)';
  } else if (ifValue >= 15) {
    bgColor = `rgba(234, 88, 12, ${0.06 + intensity * 0.08})`;
    textColor = 'text-orange-600 dark:text-orange-400';
    borderColor = 'rgba(234, 88, 12, 0.18)';
    glowColor = 'rgba(234, 88, 12, 0.12)';
  } else if (ifValue >= 5) {
    bgColor = `rgba(201, 135, 46, ${0.06 + intensity * 0.06})`;
    textColor = 'text-amber-600 dark:text-amber-400';
    borderColor = 'rgba(201, 135, 46, 0.18)';
    glowColor = 'rgba(201, 135, 46, 0.10)';
  } else {
    bgColor = 'rgba(22, 163, 74, 0.06)';
    textColor = 'text-emerald-600 dark:text-emerald-400';
    borderColor = 'rgba(22, 163, 74, 0.15)';
    glowColor = 'rgba(22, 163, 74, 0.08)';
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${textColor} if-gradient-badge`}
      style={{
        backgroundColor: bgColor,
        borderColor: borderColor,
        boxShadow: ifValue >= 15 ? `0 0 8px ${glowColor}` : 'none',
      }}
    >
      IF {ifValue.toFixed(1)}
    </span>
  );
}

/** Altmetric-style mini donut SVG */
function AltmetricDonut({ score }: { score: number }) {
  const { locale } = useI18n();
  const size = 32;
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - score / 100);

  // Color based on score
  let color: string;
  if (score >= 70) color = '#dc2626';
  else if (score >= 50) color = '#ea580c';
  else if (score >= 30) color = '#c9872e';
  else if (score >= 15) color = '#2d8f8f';
  else color = '#6b7280';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="relative inline-flex items-center justify-center cursor-default">
          <svg width={size} height={size} className="altmetric-donut">
            {/* Background circle */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth={strokeWidth}
              className="text-claude-border-light dark:text-[#2b2926]"
            />
            {/* Progress arc */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              className="altmetric-donut-arc"
            />
          </svg>
          <span className="absolute text-[8px] font-bold text-claude-text-secondary">{score}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="left">
        <p>{locale === 'zh' ? `Altmetric 分数（模拟）：${score}` : `Altmetric score (simulated): ${score}`}</p>
        <p className="text-[10px] text-claude-text-muted">{locale === 'zh' ? '基于 IF、PDB 数量与元数据' : 'Based on IF, PDB count, and metadata'}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function LiteratureDetailPanel({
  paper,
  isOpen,
  onClose,
  paperTags = [],
  onAddTag,
  onRemoveTag,
  allPapers = [],
  onSelectPaper,
  readingProgress = 0,
  onProgressChange,
  onMarkComplete,
}: LiteratureDetailPanelProps) {
  // Close on Escape key
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen || !paper) return null;

  // Inner component keyed by pmid so React resets aiSummary / aiLoading / viewerPdbId
  // automatically whenever the paper changes (https://react.dev/learn/preserving-and-resetting-state).
  return (
    <>
      <DetailPanelBody
        key={paper.pmid}
        paper={paper}
        onClose={onClose}
        readingProgress={readingProgress}
        onProgressChange={onProgressChange}
        onMarkComplete={onMarkComplete}
        paperTags={paperTags}
        onAddTag={onAddTag}
        onRemoveTag={onRemoveTag}
        allPapers={allPapers}
        onSelectPaper={onSelectPaper}
      />
    </>
  );
}

interface DetailPanelBodyProps {
  paper: LitPaper;
  onClose: () => void;
  readingProgress: number;
  onProgressChange?: (pmid: string, value: number) => void;
  onMarkComplete?: (pmid: string) => void;
  paperTags?: string[];
  onAddTag?: (pmid: string, tag: string) => void;
  onRemoveTag?: (pmid: string, tag: string) => void;
  allPapers?: LitPaper[];
  onSelectPaper?: (paper: LitPaper) => void;
}

function DetailPanelBody({
  paper,
  onClose,
  readingProgress,
  onProgressChange,
  onMarkComplete,
  paperTags = [],
  onAddTag,
  onRemoveTag,
  allPapers = [],
  onSelectPaper,
}: DetailPanelBodyProps) {
  const { t, locale } = useI18n();
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [viewerPdbId, setViewerPdbId] = useState<string | null>(null);

  const handleAiSummary = async () => {
    if (aiLoading) return;
    setAiLoading(true);
    try {
      const res = await fetch('/api/ai-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdbId: paper.pdbs[0]?.pdbId || paper.pmid,
          title: paper.title,
          method: paper.pdbs[0]?.method || '',
          resolution: paper.pdbs[0]?.resolution || null,
          journal: paper.journal,
          journalIf: paper.IF,
        }),
      });
      const data = await res.json();
      setAiSummary(data.summary || (locale === 'zh' ? '无法生成摘要。' : 'Unable to generate summary.'));
    } catch {
      setAiSummary(locale === 'zh' ? 'AI 摘要生成失败，请重试。' : 'Failed to generate AI summary. Please try again.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleOpenPubMed = () => {
    window.open(`https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`, '_blank', 'noopener,noreferrer');
  };

  const handleAddToReadingList = () => {
    if (onProgressChange && readingProgress === 0) {
      onProgressChange(paper.pmid, 10);
      toast.success('Added to reading list');
    } else {
      toast.info('Paper is already in your reading list');
    }
  };

  const status = getReadingStatus(readingProgress, locale);
  const prestige = getJournalPrestige(paper.journal);
  const altScore = computeAltmetricScore(paper);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 dark:bg-black/40 backdrop-blur-sm lit-detail-backdrop-enter"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed top-0 right-0 bottom-0 z-50 w-full sm:w-[420px] bg-claude-surface dark:bg-[#242220] border-l border-claude-border dark:border-[#3d3832] shadow-2xl preview-gradient-border flex flex-col lit-detail-enter">
        {/* Reading progress bar at very top */}
        <div className="h-[2px] w-full bg-claude-border-light dark:bg-[#2b2926] flex-shrink-0">
          <div
            className="h-full lit-progress-bar"
            style={{ width: `${readingProgress}%`, background: getProgressColor(readingProgress) }}
          />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-claude-border dark:border-[#3d3832] bg-gradient-to-r from-[#faf7f4] to-[#f5f0ea] dark:from-[#242220] dark:to-[#2b2926]">
          <h2 className="text-sm font-bold text-claude-text truncate pr-2">{locale === 'zh' ? '论文详情' : 'Paper Details'}</h2>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-claude-border-light dark:hover:bg-[#2b2926] text-claude-text-muted hover:text-claude-text transition-colors active:scale-95"
              >
                <X className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left"><p>{t.closeBtn}</p></TooltipContent>
          </Tooltip>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar preview-scroll p-4 space-y-4">
          {/* Title */}
          <div>
            <h3 className="text-base font-bold text-claude-text leading-snug">
              {paper.title || 'Untitled'}
            </h3>
          </div>

          {/* Visual Quality Indicators Row */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* IF Gradient Badge */}
            {paper.IF != null && (
              <IFGradientBadge ifValue={paper.IF} />
            )}

            {/* Journal Prestige Badge */}
            {prestige && (
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${prestige.color} ${prestige.bgLight} ${prestige.bgDark} ${prestige.borderLight} ${prestige.borderDark} prestige-badge`}>
                ★ {prestige.label}
              </span>
            )}

            {/* Altmetric-style donut */}
            <AltmetricDonut score={altScore} />

            {/* Reading status */}
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-semibold border ${status.bg} ${status.color}`}>
              <Circle className="h-1.5 w-1.5 fill-current" />
              {status.label}
            </span>
          </div>

          {/* Citation Format Selector (replaces old quick actions) */}
          <CitationFormatSelector paper={paper} />

          {/* Quick action buttons row */}
          <div className="lit-quick-actions-enter flex items-center gap-1.5 flex-wrap">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOpenPubMed}
                  className="h-7 px-2 text-[10px] gap-1 border-claude-border dark:border-[#3d3832] text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926]"
                >
                  <ExternalLink className="h-3 w-3" />
                  PubMed
                </Button>
              </TooltipTrigger>
              <TooltipContent>{locale === 'zh' ? '在 PubMed 中打开' : 'Open in PubMed'}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAddToReadingList}
                  className="h-7 px-2 text-[10px] gap-1 border-claude-border dark:border-[#3d3832] text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926]"
                >
                  <BookOpen className="h-3 w-3" />
                  <span className="hidden sm:inline">{locale === 'zh' ? '阅读列表' : 'Reading List'}</span>
                  <span className="sm:hidden">{locale === 'zh' ? '阅读' : 'Read'}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{locale === 'zh' ? '加入阅读列表' : 'Add to reading list'}</TooltipContent>
            </Tooltip>
          </div>

          {/* Reading Progress Section */}
          {onProgressChange && (
            <div className="p-3 rounded-lg border border-claude-border/60 dark:border-[#3d3832]/60 bg-claude-border-light/30 dark:bg-[#1a1917]/30">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <BookOpen className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
                  <span className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider">
                    {locale === 'zh' ? '阅读进度' : 'Reading Progress'}
                  </span>
                </div>
                <span className={`text-sm font-bold tabular-nums ${
                  readingProgress >= 100
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : readingProgress > 0
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-claude-text-muted'
                }`}>
                  {readingProgress}%
                </span>
              </div>

              {/* Progress bar visual */}
              <div className="h-1.5 w-full bg-claude-border-light dark:bg-[#2b2926] rounded-full mb-3 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${readingProgress}%`, background: getProgressColor(readingProgress) }}
                />
              </div>

              {/* Slider */}
              <Slider
                value={[readingProgress]}
                min={0}
                max={100}
                step={5}
                onValueChange={(value) => {
                  onProgressChange(paper.pmid, value[0]);
                }}
                className="w-full mb-2"
              />

              {/* Quick action buttons */}
              <div className="flex items-center gap-2">
                {readingProgress < 100 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2.5 text-[10px] font-medium border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                    onClick={() => onMarkComplete?.(paper.pmid)}
                  >
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    {locale === 'zh' ? '标记为已读' : 'Mark as Read'}
                  </Button>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" />
                    {locale === 'zh' ? '已完成' : 'Completed'}
                  </span>
                )}
                {readingProgress > 0 && readingProgress < 100 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px] font-medium text-claude-text-muted hover:text-claude-text"
                    onClick={() => onProgressChange(paper.pmid, 0)}
                  >
                    {locale === 'zh' ? '重置' : 'Reset'}
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Metadata grid */}
          <div className="grid grid-cols-2 gap-3">
            {paper.authors && (
              <div className="col-span-2">
                <div className="flex items-start gap-2">
                  <Users className="h-3.5 w-3.5 text-claude-text-muted mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider mb-0.5">{locale === 'zh' ? '作者' : 'Authors'}</div>
                    <div className="text-xs text-claude-text-secondary leading-relaxed">{paper.authors}</div>
                  </div>
                </div>
              </div>
            )}
            {paper.journal && (
              <div>
                <div className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider mb-0.5">{locale === 'zh' ? '期刊' : 'Journal'}</div>
                <div className="text-xs text-claude-text-secondary font-medium">{paper.journal}</div>
              </div>
            )}
            {paper.IF != null && (
              <div>
                <div className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider mb-0.5">{locale === 'zh' ? '影响因子' : 'Impact Factor'}</div>
                <div className={`text-sm font-bold ${
                  paper.IF >= 20 ? 'text-red-600 dark:text-red-400' :
                  paper.IF >= 10 ? 'text-orange-600 dark:text-orange-400' :
                  paper.IF >= 5 ? 'text-emerald-600 dark:text-emerald-400' :
                  'text-claude-text'
                }`}>
                  {paper.IF.toFixed(1)}
                </div>
              </div>
            )}
            {paper.pubdate && (
              <div>
                <div className="flex items-center gap-1">
                  <Calendar className="h-3 w-3 text-claude-text-muted" />
                  <div className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider">{locale === 'zh' ? '日期' : 'Date'}</div>
                </div>
                <div className="text-xs text-claude-text-secondary mt-0.5">{paper.pubdate}</div>
              </div>
            )}
            <div>
              <div className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider mb-0.5">{locale === 'zh' ? 'PMID' : 'PMID'}</div>
              <div className="text-xs text-claude-text-secondary font-mono">{paper.pmid}</div>
            </div>
          </div>

          {/* DOI + PubMed links */}
          <div className="flex items-center gap-2">
            <a
              href={`https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-claude-accent/10 text-claude-accent dark:bg-claude-accent/20 dark:text-claude-accent-hover hover:bg-claude-accent/20 dark:hover:bg-claude-accent/30 transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              PubMed
            </a>
            {paper.doi && (
              <a
                href={`https://doi.org/${paper.doi}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-claude-border-light dark:bg-[#2b2926] text-claude-text-secondary hover:bg-claude-border dark:hover:bg-[#3d3832] transition-colors"
              >
                <Link2 className="h-3 w-3" />
                DOI
              </a>
            )}
          </div>

          {/* Abstract */}
          {paper.abstract && (
            <div>
              <div className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider mb-1.5">{locale === 'zh' ? '摘要' : 'Abstract'}</div>
              <div className="text-xs text-claude-text-secondary leading-relaxed p-3 rounded-lg bg-claude-border-light/50 dark:bg-[#1a1917]/50 border border-claude-border/50 dark:border-[#3d3832]/50">
                {paper.abstract}
              </div>
            </div>
          )}

          {/* AI Summary */}
          <div>
            <button
              onClick={handleAiSummary}
              disabled={aiLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-claude-accent/10 to-purple-500/10 dark:from-claude-accent/20 dark:to-purple-500/20 text-claude-accent dark:text-claude-accent-hover hover:from-claude-accent/20 hover:to-purple-500/20 dark:hover:from-claude-accent/30 dark:hover:to-purple-500/30 transition-all disabled:opacity-50 active:scale-95"
            >
              {aiLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              {aiLoading ? '生成中...' : locale === 'zh' ? 'AI 摘要' : 'AI Summary'}
            </button>
            {aiSummary && (
              <div className="mt-2 p-3 rounded-lg bg-gradient-to-br from-claude-accent/5 to-purple-500/5 dark:from-claude-accent/10 dark:to-purple-500/10 border border-claude-accent/20 dark:border-claude-accent/30 text-xs text-claude-text-secondary leading-relaxed lit-fade-in-up">
                {aiSummary}
              </div>
            )}
          </div>

          {/* Tags Section */}
          {onAddTag && onRemoveTag && (
            <div className="border-t border-claude-border/50 dark:border-[#3d3832]/50 pt-3">
              <TagInput
                pmid={paper.pmid}
                currentTags={paperTags}
                onAddTag={onAddTag}
                onRemoveTag={onRemoveTag}
              />
            </div>
          )}

          {/* Associated PDB structures */}
          {paper.pdbs.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <BookOpen className="h-3.5 w-3.5 text-claude-text-muted" />
                <span className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider">
                  {locale === 'zh' ? `关联 PDB 结构 (${paper.pdbs.length})` : `Associated PDB Structures (${paper.pdbs.length})`}
                </span>
              </div>
              <div className="space-y-2">
                {paper.pdbs.map(pdb => {
                  const methodStyle = getMethodColor(pdb.method || '');
                  const methodLabel = getMethodLabel(pdb.method || '');
                  const methodKey = methodLabel.toLowerCase().replace('-', '') as 'cryoem' | 'xray' | 'nmr' | 'other';
                  const badgeClass = `method-badge-${methodKey}`;
                  const isViewerOpen = viewerPdbId === pdb.pdbId;
                  return (
                    <div key={pdb.pdbId} className="space-y-2">
                      <div
                        className="flex items-center gap-2 p-2.5 rounded-lg border border-claude-border/60 dark:border-[#3d3832]/60 bg-claude-border-light/30 dark:bg-[#1a1917]/30 hover:bg-claude-border-light/60 dark:hover:bg-[#2b2926]/60 transition-colors"
                      >
                        <a
                          href={`https://www.rcsb.org/structure/${pdb.pdbId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-mono font-bold text-claude-accent dark:text-claude-accent-hover hover:underline"
                        >
                          {pdb.pdbId}
                        </a>
                        <span className={`inline-flex items-center justify-center min-w-[62px] px-1.5 py-0.5 rounded text-[9px] font-medium border ${methodStyle.bg} ${methodStyle.text} ${methodStyle.border} method-badge ${badgeClass}`}>
                          {methodLabel}
                        </span>
                        {pdb.resolution != null && (
                          <span className="text-[10px] text-claude-text-muted font-mono">
                            {pdb.resolution.toFixed(2)}Å
                          </span>
                        )}
                        {pdb.isBlast && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400">
                            BLAST
                          </span>
                        )}
                        <a
                          href={`https://www.rcsb.org/structure/${pdb.pdbId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 rounded hover:bg-claude-border-light dark:hover:bg-[#2b2926] text-claude-text-muted hover:text-claude-accent dark:hover:text-claude-accent-hover transition-colors"
                        >
                          <ExtLink className="h-3 w-3" />
                        </a>
                        <button
                          onClick={() => setViewerPdbId(isViewerOpen ? null : pdb.pdbId)}
                          className={`ml-auto p-1 rounded transition-colors ${
                            isViewerOpen
                              ? 'bg-claude-accent/15 text-claude-accent dark:bg-claude-accent/25 dark:text-claude-accent-hover'
                              : 'text-claude-text-muted hover:text-claude-accent dark:hover:text-claude-accent-hover hover:bg-claude-border-light/60 dark:hover:bg-[#3d3832]/40'
                          }`}
                          title={isViewerOpen ? (locale === 'zh' ? '关闭 3D 查看器' : 'Close 3D viewer') : (locale === 'zh' ? '查看 3D 结构' : 'View 3D structure')}
                        >
                          <Box className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {/* Inline 3D viewer for this PDB — CSS transition instead of framer-motion */}
                      <div className={`lit-viewer-expand ${isViewerOpen ? 'lit-viewer-expanded' : 'lit-viewer-collapsed'}`}>
                        {isViewerOpen && <PdbStructureViewer pdbId={pdb.pdbId} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Related PDB Structures — PDB IDs mentioned in the paper with links */}
          {paper.pdbs.length > 0 && (
            <div className="border-t border-claude-border/50 dark:border-[#3d3832]/50 pt-3">
              <div className="flex items-center gap-1.5 mb-2">
                <ExtLink className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
                <span className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider">
                  {locale === 'zh' ? '相关 PDB 结构' : 'Related PDB Structures'}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {paper.pdbs.map(pdb => (
                  <a
                    key={pdb.pdbId}
                    href={`https://www.rcsb.org/structure/${pdb.pdbId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono font-medium bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 border border-teal-200/60 dark:border-teal-800/30 hover:bg-teal-100 dark:hover:bg-teal-900/30 transition-colors related-pdb-chip"
                  >
                    {pdb.pdbId}
                    {pdb.method && (
                      <span className="text-[8px] text-teal-500 dark:text-teal-400 font-sans">
                        {getMethodLabel(pdb.method)}
                      </span>
                    )}
                    <ExtLink className="h-2.5 w-2.5 opacity-50" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Keywords */}
          {paper.keywords && paper.keywords.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Tag className="h-3 w-3 text-claude-text-muted" />
                <span className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider">{locale === 'zh' ? '关键词' : 'Keywords'}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {paper.keywords.map((kw, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-claude-border-light dark:bg-[#2b2926] text-claude-text-secondary border border-claude-border/50 dark:border-[#3d3832]/50"
                  >
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Related Papers */}
          {allPapers.length > 1 && onSelectPaper && (
            <div className="border-t border-claude-border/50 dark:border-[#3d3832]/50 pt-3">
              <LiteratureRelatedPapers
                currentPaper={paper}
                allPapers={allPapers}
                onSelectPaper={(relatedPaper) => {
                  onSelectPaper(relatedPaper);
                }}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
