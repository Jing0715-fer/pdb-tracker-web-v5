'use client';

import React, { useState, useMemo } from 'react';
import { ExternalLink, BookOpen, ChevronDown, ChevronUp, Link2, Star, Calendar, Users, Quote } from 'lucide-react';
import type { LitPaper, LitPaperPdb } from '@/lib/pdb-types';
import { getMethodColor, getMethodLabel } from '@/components/pdb-helpers';
import { AddToListPopover, type ReadingList } from './LiteratureReadingList';
import { PaperNotesButton } from './LiteraturePaperNotes';
import { TagPill } from './LiteraturePaperTags';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

interface LiteraturePaperCardProps {
  paper: LitPaper;
  index: number;
  isExpanded?: boolean;
  onSelect: (paper: LitPaper) => void;
  onToggleExpand?: () => void;
  // Reading list props
  readingLists?: ReadingList[];
  isPaperInList?: (listId: string, pmid: string) => boolean;
  onToggleList?: (listId: string, pmid: string) => void;
  // Notes props
  hasNote?: boolean;
  onOpenNotes?: (pmid: string) => void;
  // Tags props
  tags?: string[];
  onTagClick?: (tag: string) => void;
  // Reading progress
  readingProgress?: number; // 0-100
}

/** Get color for reading progress bar: teal 0-33%, amber 34-66%, green 67-100% */
function getProgressColor(progress: number): string {
  if (progress >= 67) return '#10b981';
  if (progress >= 34) return '#f59e0b';
  return '#2d8f8f';
}

/** Get reading status info: dot color + label */
function getReadingStatus(progress: number): { dotColor: string; label: string } {
  if (progress >= 100) return { dotColor: 'bg-emerald-500 dark:bg-emerald-400', label: 'Read' };
  if (progress > 0) return { dotColor: 'bg-amber-500 dark:bg-amber-400', label: 'Reading' };
  return { dotColor: 'bg-gray-400 dark:bg-gray-500', label: 'Unread' };
}

function getIfTierColor(ifVal: number | null): { bar: string; bg: string; text: string } {
  if (ifVal == null) return { bar: 'bg-gray-300 dark:bg-gray-600', bg: 'bg-gray-50 dark:bg-gray-800/50', text: 'text-gray-500 dark:text-gray-400' };
  if (ifVal >= 20) return { bar: 'bg-red-500 dark:bg-red-400', bg: 'bg-red-50 dark:bg-red-900/20', text: 'text-red-700 dark:text-red-300' };
  if (ifVal >= 10) return { bar: 'bg-orange-500 dark:bg-orange-400', bg: 'bg-orange-50 dark:bg-orange-900/20', text: 'text-orange-700 dark:text-orange-300' };
  if (ifVal >= 5) return { bar: 'bg-emerald-500 dark:bg-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20', text: 'text-emerald-700 dark:text-emerald-300' };
  return { bar: 'bg-gray-400 dark:bg-gray-500', bg: 'bg-gray-50 dark:bg-gray-800/50', text: 'text-gray-600 dark:text-gray-400' };
}

function getIfTierLabel(ifVal: number | null): string {
  if (ifVal == null) return '';
  if (ifVal >= 20) return 'Top';
  if (ifVal >= 10) return 'High';
  if (ifVal >= 5) return 'Mid';
  return 'Low';
}

/** Get IF color bar gradient for top of card */
function getIfBarGradient(ifVal: number | null): string {
  if (ifVal == null) return 'linear-gradient(90deg, #d4cfc8, #e8e4dd)';
  if (ifVal >= 30) return 'linear-gradient(90deg, #dc2626, #ef4444, #dc2626)';
  if (ifVal >= 20) return 'linear-gradient(90deg, #ea580c, #f97316, #ea580c)';
  if (ifVal >= 10) return 'linear-gradient(90deg, #c9872e, #d9a24e, #c9872e)';
  if (ifVal >= 5) return 'linear-gradient(90deg, #16a34a, #22c55e, #16a34a)';
  return 'linear-gradient(90deg, #6b7280, #9ca3af, #6b7280)';
}

/** Simulated citation count based on IF and publication age */
function getSimulatedCitationCount(paper: LitPaper): number {
  if (!paper.IF || !paper.pubdate) return 0;
  const pubYear = new Date(paper.pubdate).getFullYear();
  const currentYear = new Date().getFullYear();
  const age = Math.max(1, currentYear - pubYear + 1);
  // Simulate: base citations = IF * age * random factor (deterministic based on pmid)
  const seed = parseInt(paper.pmid.slice(-4), 10) || 42;
  const factor = 0.7 + ((seed % 60) / 100); // 0.7 - 1.3 range
  return Math.round(paper.IF * age * factor * 2.5);
}

function abbreviateAuthors(authors: string, maxLen: number = 60): string {
  if (!authors) return '';
  const parts = authors.split(/[,;]/).map(a => a.trim()).filter(Boolean);
  if (parts.length <= 2) return parts.join(', ');
  const firstTwo = parts.slice(0, 2).join(', ');
  if (firstTwo.length > maxLen) return firstTwo.slice(0, maxLen) + '...';
  return `${firstTwo}, et al.`;
}

export function LiteraturePaperCard({
  paper,
  index,
  isExpanded,
  onSelect,
  onToggleExpand,
  readingLists,
  isPaperInList,
  onToggleList,
  hasNote,
  onOpenNotes,
  tags,
  onTagClick,
  readingProgress = 0,
}: LiteraturePaperCardProps) {
  const [bookmarked, setBookmarked] = useState(false);
  const ifStyle = getIfTierColor(paper.IF);
  const ifLabel = getIfTierLabel(paper.IF);
  const citationCount = useMemo(() => getSimulatedCitationCount(paper), [paper]);
  const abstractPreview = paper.abstract
    ? paper.abstract.length > 200
      ? paper.abstract.slice(0, 200) + '...'
      : paper.abstract
    : 'No abstract available';

  return (
    <div
      className="group h-full lit-card-fade-in"
      style={{ animationDelay: `${Math.min(index * 40, 600)}ms` }}
    >
      <div
        id={`paper-${paper.pmid}`}
        data-pmid={paper.pmid}
        className={`relative rounded-xl border bg-claude-surface dark:bg-[#242220] overflow-hidden transition-all duration-200 hover:shadow-lg dark:hover:shadow-xl dark:hover:shadow-black/20 hover:border-claude-accent/30 dark:hover:border-claude-accent-hover/30 cursor-pointer claude-card-shadow card-hover-lift h-full flex flex-col ${
          isExpanded ? 'border-claude-accent/40 dark:border-claude-accent-hover/40' : 'border-claude-border dark:border-[#3d3832]'
        }`}
        onClick={() => onSelect(paper)}
      >
        {/* Journal IF Color Bar at top */}
        <div
          className="h-[3px] w-full flex-shrink-0 if-color-bar-top"
          style={{ background: getIfBarGradient(paper.IF) }}
        />

        {/* IF tier color bar on left edge — 3px wide, subtle expansion on hover */}
        <div className={`absolute left-0 top-[3px] bottom-0 w-[3px] ${ifStyle.bar} transition-all duration-200 group-hover:w-[5px]`} />

        {/* Note indicator dot - small yellow dot in top-right corner */}
        {hasNote && (
          <div className="absolute top-4 right-2 h-2 w-2 rounded-full bg-amber-400 dark:bg-amber-500 ring-2 ring-white dark:ring-[#242220] z-10" title="Has notes" />
        )}

        <div className="pl-3 pr-3 sm:pr-4 py-3 sm:py-4 flex-1 min-w-0">
          {/* Top row: Journal + IF + Citation + Action buttons */}
          <div className="flex items-start justify-between mb-1.5 sm:mb-2">
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap min-w-0">
              {paper.journal && (
                <span className={`inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded-md text-[9px] sm:text-[10px] font-semibold truncate max-w-[180px] ${ifStyle.bg} ${ifStyle.text} border border-current/10`} title={paper.journal}>
                  {paper.journal}
                </span>
              )}
              {paper.IF != null && (
                <span className={`inline-flex items-center gap-1 px-1 sm:px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-bold ${ifStyle.text}`}>
                  IF {paper.IF.toFixed(1)}
                  {ifLabel && <span className="font-normal opacity-70">· {ifLabel}</span>}
                </span>
              )}
              {/* Citation Count Badge */}
              {citationCount > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-0.5 px-1 sm:px-1.5 py-0.5 rounded-md text-[9px] sm:text-[10px] font-medium bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400 border border-violet-200/60 dark:border-violet-800/30 citation-badge">
                      <Quote className="h-2.5 w-2.5" />
                      {citationCount >= 1000 ? `${(citationCount / 1000).toFixed(1)}k` : citationCount}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-[11px]">~{citationCount} estimated citations</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {paper.pdbs.length > 0 && (
                <span className="inline-flex items-center gap-0.5 px-1 sm:px-1.5 py-0.5 rounded-md text-[9px] sm:text-[10px] font-medium bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-400 border border-teal-200/60 dark:border-teal-800/30">
                  <BookOpen className="h-2.5 w-2.5" />
                  {paper.pdbs.length} PDB
                </span>
              )}
              {/* Reading progress badge */}
              {readingProgress > 0 && readingProgress < 100 && (
                <span className="inline-flex items-center gap-0.5 px-1 sm:px-1.5 py-0.5 rounded-md text-[9px] sm:text-[10px] font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/30">
                  {readingProgress}%
                </span>
              )}
              {readingProgress >= 100 && (
                <span className="inline-flex items-center gap-0.5 px-1 sm:px-1.5 py-0.5 rounded-md text-[9px] sm:text-[10px] font-medium bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/30">
                  ✓ Read
                </span>
              )}
              {/* Source badge for 结构生物学文献日报 */}
              {paper.source === '结构生物学文献日报' && (
                <span className="inline-flex items-center gap-0.5 px-1 sm:px-1.5 py-0.5 rounded-md text-[9px] sm:text-[10px] font-medium bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 border border-orange-200/60 dark:border-orange-800/30" title="结构生物学文献日报">
                  <BookOpen className="h-3 w-3" /> 日报
                </span>
              )}
            </div>
            <div className="flex items-center gap-0.5 flex-shrink-0">
              {/* Notes button */}
              {onOpenNotes && (
                <PaperNotesButton
                  pmid={paper.pmid}
                  hasNote={!!hasNote}
                  onClick={() => onOpenNotes(paper.pmid)}
                />
              )}
              {/* Add to list button */}
              {readingLists && onToggleList && isPaperInList && (
                <AddToListPopover
                  pmid={paper.pmid}
                  lists={readingLists}
                  isPaperInList={isPaperInList}
                  onToggle={onToggleList}
                />
              )}
              {/* Progress percentage near bookmark */}
              {readingProgress > 0 && readingProgress < 100 && (
                <span className="text-[9px] font-bold tabular-nums text-amber-600 dark:text-amber-400 mr-0.5">{readingProgress}%</span>
              )}
              {readingProgress >= 100 && (
                <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 mr-0.5">100%</span>
              )}
              {/* Bookmark */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={(e) => { e.stopPropagation(); setBookmarked(!bookmarked); }}
                    className={`p-1 rounded-md transition-all duration-200 active:scale-90 ${
                      bookmarked
                        ? 'text-amber-500 dark:text-amber-400'
                        : 'text-claude-text-muted hover:text-amber-500 dark:hover:text-amber-400 opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    <Star className={`h-3.5 w-3.5 transition-transform duration-200 ${bookmarked ? 'fill-current scale-110' : ''}`} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom"><p>{bookmarked ? 'Remove bookmark' : 'Bookmark this paper'}</p></TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Title with reading status dot */}
          <h3 className="text-xs sm:text-sm font-semibold text-claude-text leading-snug mb-1 sm:mb-1.5 line-clamp-2 group-hover:text-claude-accent dark:group-hover:text-claude-accent-hover transition-colors flex items-start gap-1 sm:gap-1.5">
            <span className={`mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${getReadingStatus(readingProgress).dotColor}`} title={getReadingStatus(readingProgress).label} />
            <span>{paper.title || 'Untitled'}</span>
          </h3>

          {/* Authors + Date row */}
          <div className="flex items-center gap-2 sm:gap-3 mb-1.5 sm:mb-2 text-[10px] sm:text-[11px] text-claude-text-muted">
            <span className="flex items-center gap-1 truncate max-w-[50%] sm:max-w-[60%]">
              <Users className="h-3 w-3 flex-shrink-0" />
              {abbreviateAuthors(paper.authors)}
            </span>
            {paper.pubdate && (
              <span className="flex items-center gap-1 flex-shrink-0">
                <Calendar className="h-3 w-3" />
                {paper.pubdate}
              </span>
            )}
          </div>

          {/* Abstract */}
          <div className="mb-1.5 sm:mb-2">
            <p className="text-[10px] sm:text-[11px] text-claude-text-secondary leading-relaxed">
              {isExpanded ? paper.abstract : abstractPreview}
            </p>
            {paper.abstract && paper.abstract.length > 200 && (
              <button
                onClick={(e) => { e.stopPropagation(); onToggleExpand?.(); }}
                className="inline-flex items-center gap-0.5 mt-1 text-[9px] sm:text-[10px] font-medium text-claude-accent dark:text-claude-accent-hover hover:underline"
              >
                {isExpanded ? (
                  <>Show less <ChevronUp className="h-3 w-3" /></>
                ) : (
                  <>Show more <ChevronDown className="h-3 w-3" /></>
                )}
              </button>
            )}
          </div>

          {/* PDB structure pills */}
          {paper.pdbs.length > 0 && (
            <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap mb-1.5 sm:mb-2">
              {paper.pdbs.slice(0, 6).map((pdb: LitPaperPdb) => {
                const methodStyle = getMethodColor(pdb.method || '');
                const methodLbl = getMethodLabel(pdb.method || '');
                const methodKey = methodLbl.toLowerCase().replace('-', '') as 'cryoem' | 'xray' | 'nmr' | 'other';
                return (
                  <a
                    key={pdb.pdbId}
                    href={`https://www.rcsb.org/structure/${pdb.pdbId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className={`inline-flex items-center justify-center min-w-[62px] gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium border transition-all duration-150 hover:scale-105 hover:shadow-sm ${methodStyle.bg} ${methodStyle.text} ${methodStyle.border} method-badge method-badge-${methodKey}`}
                  >
                    {pdb.pdbId}
                    <span className="opacity-60">{methodLbl}</span>
                  </a>
                );
              })}
              {paper.pdbs.length > 6 && (
                <span className="text-[8px] sm:text-[9px] text-claude-text-muted">+{paper.pdbs.length - 6} more</span>
              )}
            </div>
          )}

          {/* Source target tags — which evaluation targets reference this paper */}
          {paper.sourceTargets && paper.sourceTargets.length > 0 && (() => {
            // Dedup by uniprotId (a target may cite the same paper via multiple PDBs)
            const seen = new Set<string>();
            const uniqueTargets = paper.sourceTargets.filter(t => {
              if (seen.has(t.uniprotId)) return false;
              seen.add(t.uniprotId);
              return true;
            });
            return (
              <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap mb-1.5 sm:mb-2">
                <span className="text-[8px] sm:text-[9px] text-claude-text-muted font-medium uppercase tracking-wide">来源靶点:</span>
                {uniqueTargets.slice(0, 5).map((t) => (
                  <Tooltip key={t.uniprotId}>
                    <TooltipTrigger asChild>
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800/50 cursor-default"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="font-mono font-semibold">{t.uniprotId}</span>
                        {paper.sourceTargets!.filter(x => x.uniprotId === t.uniprotId).length > 1 && (
                          <span className="opacity-60">×{paper.sourceTargets!.filter(x => x.uniprotId === t.uniprotId).length}</span>
                        )}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      <div className="text-xs">
                        <div className="font-semibold">{t.proteinName}</div>
                        <div className="opacity-70 mt-0.5">{t.uniprotId} · PDB: {paper.sourceTargets!.filter(x => x.uniprotId === t.uniprotId).map(x => x.pdbId).join(', ')}</div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                ))}
                {uniqueTargets.length > 5 && (
                  <span className="text-[8px] sm:text-[9px] text-claude-text-muted">+{uniqueTargets.length - 5} more</span>
                )}
              </div>
            );
          })()}

          {/* Keywords/Tags */}
          {paper.keywords && paper.keywords.length > 0 && (
            <div className="flex items-center gap-0.5 sm:gap-1 flex-wrap mb-1.5 sm:mb-2">
              {paper.keywords.slice(0, 5).map((kw, i) => (
                <span
                  key={i}
                  className="px-1 sm:px-1.5 py-0.5 rounded text-[8px] sm:text-[9px] font-medium bg-claude-border-light dark:bg-[#2b2926] text-claude-text-secondary border border-claude-border/50 dark:border-[#3d3832]/50"
                >
                  {kw}
                </span>
              ))}
              {paper.keywords.length > 5 && (
                <span className="text-[8px] sm:text-[9px] text-claude-text-muted">+{paper.keywords.length - 5}</span>
              )}
            </div>
          )}

          {/* User Tags */}
          {tags && tags.length > 0 && (
            <div className="flex items-center gap-0.5 sm:gap-1 flex-wrap mb-1.5 sm:mb-2">
              {tags.map(tag => (
                <TagPill
                  key={tag}
                  tag={tag}
                  size="sm"
                  onClick={onTagClick ? () => onTagClick(tag) : undefined}
                />
              ))}
            </div>
          )}

          {/* Footer: PMID + DOI links */}
          <div className="flex items-center gap-1.5 sm:gap-2 pt-1.5 border-t border-claude-border-light dark:border-[#2b2926]">
            <span className="text-[9px] sm:text-[10px] font-mono text-claude-text-muted">PMID: {paper.pmid}</span>
            <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
              <a
                href={`https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-0.5 text-[9px] sm:text-[10px] font-medium text-claude-accent dark:text-claude-accent-hover hover:underline external-link-hover"
              >
                PubMed
                <ExternalLink className="h-2.5 w-2.5 ext-arrow" />
              </a>
              {paper.doi && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a
                      href={`https://doi.org/${paper.doi}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-0.5 text-[9px] sm:text-[10px] font-medium text-claude-accent dark:text-claude-accent-hover hover:underline external-link-hover"
                    >
                      DOI
                      <Link2 className="h-2.5 w-2.5 ext-arrow" />
                    </a>
                  </TooltipTrigger>
                  <TooltipContent side="bottom"><p>{paper.doi}</p></TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        </div>

        {/* Reading progress bar at bottom */}
        <div className="h-[2px] sm:h-[3px] w-full bg-claude-border-light dark:bg-[#2b2926] flex-shrink-0">
          <div
            className="h-full reading-progress-bar-animate"
            style={{
              width: `${readingProgress}%`,
              background: getProgressColor(readingProgress),
              borderRadius: readingProgress >= 100 ? '0 0 0 0' : '0 2px 2px 0',
              transition: 'width 0.6s ease-out',
            }}
          />
        </div>
      </div>
    </div>
  );
}
