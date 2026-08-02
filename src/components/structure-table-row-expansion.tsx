'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown,
  ExternalLink,
  Microscope,
  Atom,
  Waves,
  Boxes,
  TrendingUp,
  Users,
  Calendar,
  Database,
  Eye,
} from 'lucide-react';
import { MethodBadge, normalizeMethod } from '@/components/method-badge';
import { StructureQualityRing } from '@/components/structure-quality-ring';
import type { PdbEntry } from '@/lib/pdb-types';

/**
 * StructureTableRowExpansion
 *
 * An expandable row component for the Weekly structure table.
 * When clicked, the row expands to show an inline preview with:
 *   - Quality score ring with breakdown
 *   - Method badge with details
 *   - Resolution indicator
 *   - Authors, organisms, ligands
 *   - Journal & IF
 *   - External links (RCSB, PubMed, DOI)
 *   - "View Full Details" button
 *
 * Uses Framer Motion for smooth height animation.
 */

interface StructureTableRowExpansionProps {
  entry: PdbEntry;
  qualityScore?: {
    score: number;
    resolution: number;
    method: number;
    impact: number;
  };
  isExpanded: boolean;
  onToggle: () => void;
  onViewDetails?: (pdbId: string) => void;
  children?: React.ReactNode; // The row content when collapsed
}

export function StructureTableRowExpansion({
  entry,
  qualityScore,
  isExpanded,
  onToggle,
  onViewDetails,
  children,
}: StructureTableRowExpansionProps) {
  const method = normalizeMethod(entry.method);

  const qualityBreakdown = useMemo(() => {
    if (!qualityScore) return undefined;
    return {
      resolution: qualityScore.resolution,
      method: qualityScore.method,
      impact: qualityScore.impact,
      coverage: 0,
    };
  }, [qualityScore]);

  return (
    <>
      {/* Collapsed row content */}
      <div
        className="cursor-pointer transition-colors hover:bg-claude-border/10"
        onClick={onToggle}
      >
        <div className="flex items-center">
          {children}
          {/* Expand indicator */}
          <div className="flex-shrink-0 w-8 flex justify-center">
            <motion.div
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown className="h-3.5 w-3.5 text-claude-text-muted" />
            </motion.div>
          </div>
        </div>
      </div>

      {/* Expanded preview */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="px-4 py-3 bg-gradient-to-r from-claude-surface/50 to-transparent dark:from-[#242220]/50 border-b border-claude-border/30 dark:border-[#3d3832]/30">
              <div className="flex gap-4">
                {/* Left: Quality ring */}
                {qualityScore && (
                  <div className="shrink-0">
                    <StructureQualityRing
                      score={qualityScore.score}
                      size={56}
                      showLabel={true}
                      showBreakdown={false}
                      breakdown={qualityBreakdown}
                    />
                  </div>
                )}

                {/* Middle: Info grid */}
                <div className="flex-1 min-w-0 grid grid-cols-2 gap-x-4 gap-y-2 text-[10px]">
                  {/* Title */}
                  <div className="col-span-2">
                    <div className="text-claude-text-muted mb-0.5">Title</div>
                    <div className="text-claude-text font-medium leading-snug">
                      {entry.title || '—'}
                    </div>
                  </div>

                  {/* Method */}
                  <div>
                    <div className="flex items-center gap-1 text-claude-text-muted mb-1">
                      <Microscope className="h-2.5 w-2.5" />
                      Method
                    </div>
                    <MethodBadge method={method} size="sm" />
                  </div>

                  {/* Resolution */}
                  <div>
                    <div className="flex items-center gap-1 text-claude-text-muted mb-1">
                      <TrendingUp className="h-2.5 w-2.5" />
                      Resolution
                    </div>
                    <span className={`font-mono font-semibold ${
                      entry.resolution != null
                        ? entry.resolution <= 2.0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : entry.resolution <= 3.5
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-red-500 dark:text-red-400'
                        : 'text-claude-text-muted'
                    }`}>
                      {entry.resolution != null ? `${entry.resolution.toFixed(2)}Å` : '—'}
                    </span>
                  </div>

                  {/* Journal + IF */}
                  <div>
                    <div className="flex items-center gap-1 text-claude-text-muted mb-1">
                      <Database className="h-2.5 w-2.5" />
                      Journal
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-claude-text truncate">{entry.journal || '—'}</span>
                      {entry.journalIf != null && (
                        <span
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold text-white"
                          style={{
                            backgroundColor: entry.journalIf >= 20 ? '#dc2626' : entry.journalIf >= 10 ? '#ea580c' : '#c9872e',
                          }}
                        >
                          IF {entry.journalIf.toFixed(1)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Date */}
                  <div>
                    <div className="flex items-center gap-1 text-claude-text-muted mb-1">
                      <Calendar className="h-2.5 w-2.5" />
                      Date
                    </div>
                    <span className="text-claude-text">{entry.releaseDate || '—'}</span>
                  </div>

                  {/* Organisms */}
                  {entry.organisms && (
                    <div className="col-span-2">
                      <div className="flex items-center gap-1 text-claude-text-muted mb-1">
                        <Users className="h-2.5 w-2.5" />
                        Organisms
                      </div>
                      <span className="text-claude-text">{entry.organisms}</span>
                    </div>
                  )}

                  {/* Ligands */}
                  {entry.ligands && (
                    <div className="col-span-2">
                      <div className="flex items-center gap-1 text-claude-text-muted mb-1">
                        <Boxes className="h-2.5 w-2.5" />
                        Ligands
                      </div>
                      <div className="flex items-center gap-1 flex-wrap">
                        {entry.ligands.split(',').slice(0, 6).map((ligand, i) => (
                          <span
                            key={i}
                            className="inline-block px-1.5 py-0.5 rounded text-[9px] font-mono bg-claude-border/20 dark:bg-[#3d3832]/20 text-claude-text-muted"
                          >
                            {ligand.trim()}
                          </span>
                        ))}
                        {entry.ligands.split(',').length > 6 && (
                          <span className="text-[9px] text-claude-text-muted">
                            +{entry.ligands.split(',').length - 6}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Right: Actions */}
                <div className="shrink-0 flex flex-col gap-1.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onViewDetails?.(entry.pdbId);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[10px] font-medium text-claude-accent bg-claude-accent/10 hover:bg-claude-accent/20 transition-colors"
                  >
                    <Eye className="h-3 w-3" />
                    Details
                  </button>
                  <a
                    href={`https://www.rcsb.org/structure/${entry.pdbId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[10px] font-medium text-claude-text-muted hover:text-claude-accent hover:bg-claude-accent/10 transition-colors"
                  >
                    <ExternalLink className="h-3 w-3" />
                    RCSB
                  </a>
                  {entry.pubmedId && (
                    <a
                      href={`https://pubmed.ncbi.nlm.nih.gov/${entry.pubmedId}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[10px] font-medium text-claude-text-muted hover:text-claude-accent hover:bg-claude-accent/10 transition-colors"
                    >
                      <ExternalLink className="h-3 w-3" />
                      PubMed
                    </a>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
