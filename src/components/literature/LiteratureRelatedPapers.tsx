'use client';

import React, { useMemo } from 'react';
import { GitBranch, ExternalLink } from 'lucide-react';
import type { LitPaper } from '@/lib/pdb-types';

// ─── Similarity Algorithm ─────────────────────────────────────────────────────
// Score = shared keywords (40%) + same journal (20%) + shared PDB (30%) + close IF (10%)

interface SimilarityResult {
  paper: LitPaper;
  score: number;
  sharedKeywords: string[];
  sharedPdbs: string[];
  sameJournal: boolean;
  closeIf: boolean;
}

function computeSimilarity(current: LitPaper, candidate: LitPaper): SimilarityResult {
  if (current.pmid === candidate.pmid) {
    return { paper: candidate, score: 0, sharedKeywords: [], sharedPdbs: [], sameJournal: false, closeIf: false };
  }

  // Shared keywords (40% weight, max 0.4)
  const currentKw = new Set(current.keywords || []);
  const candidateKw = new Set(candidate.keywords || []);
  const sharedKeywords = [...candidateKw].filter(k => currentKw.has(k));
  const maxPossibleKw = Math.max(currentKw.size, candidateKw.size, 1);
  const keywordScore = (sharedKeywords.length / maxPossibleKw) * 0.4;

  // Same journal (20% weight, max 0.2)
  const sameJournal = !!(current.journal && candidate.journal && current.journal === candidate.journal);
  const journalScore = sameJournal ? 0.2 : 0;

  // Shared PDB structures (30% weight, max 0.3)
  const currentPdbs = new Set(current.pdbs.map(p => p.pdbId));
  const candidatePdbs = new Set(candidate.pdbs.map(p => p.pdbId));
  const sharedPdbs = [...candidatePdbs].filter(p => currentPdbs.has(p));
  const maxPossiblePdbs = Math.max(currentPdbs.size, candidatePdbs.size, 1);
  const pdbScore = (sharedPdbs.length / maxPossiblePdbs) * 0.3;

  // Close IF range (10% weight, max 0.1)
  let closeIf = false;
  let ifScore = 0;
  if (current.IF != null && candidate.IF != null) {
    const ifDiff = Math.abs(current.IF - candidate.IF);
    closeIf = ifDiff <= 5;
    ifScore = closeIf ? 0.1 : Math.max(0, 0.1 - (ifDiff / 50) * 0.1);
  }

  const score = keywordScore + journalScore + pdbScore + ifScore;

  return {
    paper: candidate,
    score,
    sharedKeywords,
    sharedPdbs,
    sameJournal,
    closeIf,
  };
}

function getRelatedPapers(current: LitPaper, allPapers: LitPaper[], topN: number = 5): SimilarityResult[] {
  const scored = allPapers
    .map(p => computeSimilarity(current, p))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, topN);
}

// ─── IF Tier Color ────────────────────────────────────────────────────────────

function getIfColor(ifVal: number | null): string {
  if (ifVal == null) return 'text-claude-text-muted';
  if (ifVal >= 20) return 'text-red-600 dark:text-red-400';
  if (ifVal >= 10) return 'text-orange-600 dark:text-orange-400';
  if (ifVal >= 5) return 'text-emerald-600 dark:text-emerald-400';
  return 'text-gray-600 dark:text-gray-400';
}

function getIfBgColor(ifVal: number | null): string {
  if (ifVal == null) return 'bg-gray-50 dark:bg-gray-800/50';
  if (ifVal >= 20) return 'bg-red-50 dark:bg-red-900/20';
  if (ifVal >= 10) return 'bg-orange-50 dark:bg-orange-900/20';
  if (ifVal >= 5) return 'bg-emerald-50 dark:bg-emerald-900/20';
  return 'bg-gray-50 dark:bg-gray-800/50';
}

// ─── Component ────────────────────────────────────────────────────────────────

interface LiteratureRelatedPapersProps {
  currentPaper: LitPaper;
  allPapers: LitPaper[];
  onSelectPaper: (paper: LitPaper) => void;
}

export function LiteratureRelatedPapers({
  currentPaper,
  allPapers,
  onSelectPaper,
}: LiteratureRelatedPapersProps) {
  const related = useMemo(
    () => getRelatedPapers(currentPaper, allPapers, 5),
    [currentPaper, allPapers]
  );

  if (related.length === 0) {
    return (
      <div className="text-center py-4">
        <GitBranch className="h-6 w-6 text-claude-text-muted mx-auto mb-2 opacity-50" />
        <p className="text-[11px] text-claude-text-muted">
          No related papers found based on shared attributes.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <GitBranch className="h-3.5 w-3.5 text-claude-text-muted" />
        <span className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider">
          Related Papers
        </span>
      </div>

      <div className="space-y-1.5">
        {related.map((result, index) => (
          <button
            key={result.paper.pmid}
            onClick={() => onSelectPaper(result.paper)}
            className="w-full text-left p-2.5 rounded-lg border border-claude-border/60 dark:border-[#3d3832]/60 bg-claude-border-light/30 dark:bg-[#1a1917]/30 hover:bg-claude-border-light/60 dark:hover:bg-[#2b2926]/60 hover:border-claude-accent/30 dark:hover:border-claude-accent-hover/30 transition-all group cursor-pointer lit-fade-in-up"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            {/* Title (1-line) */}
            <div className="text-xs font-medium text-claude-text leading-snug line-clamp-1 group-hover:text-claude-accent dark:group-hover:text-claude-accent-hover transition-colors mb-1">
              {result.paper.title || 'Untitled'}
            </div>

            {/* Bottom row: journal badge, IF, shared count */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {/* Journal badge */}
              {result.paper.journal && (
                <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-semibold ${getIfBgColor(result.paper.IF)} ${getIfColor(result.paper.IF)} border border-current/10`}>
                  {result.paper.journal.length > 20 ? result.paper.journal.slice(0, 20) + '…' : result.paper.journal}
                </span>
              )}

              {/* IF */}
              {result.paper.IF != null && (
                <span className={`text-[9px] font-bold ${getIfColor(result.paper.IF)}`}>
                  IF {result.paper.IF.toFixed(1)}
                </span>
              )}

              {/* Shared attributes */}
              <div className="ml-auto flex items-center gap-1">
                {result.sharedKeywords.length > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-[9px] text-purple-600 dark:text-purple-400">
                    <span className="font-medium">{result.sharedKeywords.length}</span> kw
                  </span>
                )}
                {result.sharedPdbs.length > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-[9px] text-teal-600 dark:text-teal-400">
                    <span className="font-medium">{result.sharedPdbs.length}</span> PDB
                  </span>
                )}
                {result.sameJournal && (
                  <span className="inline-flex items-center gap-0.5 text-[9px] text-amber-600 dark:text-amber-400">
                    Same J
                  </span>
                )}
                {result.closeIf && (
                  <span className="inline-flex items-center gap-0.5 text-[9px] text-emerald-600 dark:text-emerald-400">
                    ~IF
                  </span>
                )}
              </div>

              {/* Similarity score bar */}
              <div className="flex items-center gap-1">
                <div className="w-8 h-1 rounded-full bg-claude-border-light dark:bg-[#3d3832] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-claude-accent transition-all"
                    style={{ width: `${Math.min(100, result.score * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
