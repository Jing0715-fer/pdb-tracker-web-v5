'use client';

import { motion } from 'framer-motion';
import {
  ExternalLink,
  BookOpen,
  Users,
  Calendar,
  FileText,
  Microscope,
  Atom,
  Waves,
  TrendingUp,
  Bookmark,
  BookmarkCheck,
  Tag,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MethodBadge, normalizeMethod } from '@/components/method-badge';
import type { LitPaper } from '@/lib/pdb-types';

/**
 * LiteraturePaperCardEnhanced
 *
 * An enhanced visual card for displaying a single PubMed paper in the
 * Literature mode. Features:
 *   - Journal badge with IF gradient color
 *   - Method badge (Cryo-EM/X-ray/NMR) with icon
 *   - Title with hover effect
 *   - Authors (truncated)
 *   - Date with calendar icon
 *   - Abstract preview (first 2 lines, expandable)
 *   - PDB structure link (if associated)
 *   - Bookmark toggle
 *   - Tag indicator
 *   - PMID/DOI external links
 *   - Animated entrance
 */

interface LiteraturePaperCardEnhancedProps {
  paper: LitPaper;
  index?: number;
  isSelected?: boolean;
  isBookmarked?: boolean;
  hasNotes?: boolean;
  tags?: string[];
  onSelect?: () => void;
  onToggleBookmark?: () => void;
  onAddTag?: () => void;
}

function getIfColor(ifValue: number | null | undefined): string {
  if (ifValue == null) return '#94a3b8';
  if (ifValue >= 40) return '#dc2626';
  if (ifValue >= 20) return '#ea580c';
  if (ifValue >= 10) return '#c9872e';
  if (ifValue >= 5) return '#16a34a';
  return '#94a3b8';
}

function getIfGradient(ifValue: number | null | undefined): string {
  if (ifValue == null) return 'from-[#94a3b8] to-[#64748b]';
  if (ifValue >= 40) return 'from-[#dc2626] to-[#991b1b]';
  if (ifValue >= 20) return 'from-[#ea580c] to-[#c2410c]';
  if (ifValue >= 10) return 'from-[#c9872e] to-[#a06b1a]';
  if (ifValue >= 5) return 'from-[#16a34a] to-[#15803d]';
  return 'from-[#94a3b8] to-[#64748b]';
}

function formatDate(pubdate: string | null | undefined): string {
  if (!pubdate) return '—';
  try {
    const d = new Date(pubdate);
    if (isNaN(d.getTime())) return pubdate;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return pubdate;
  }
}

export function LiteraturePaperCardEnhanced({
  paper,
  index = 0,
  isSelected = false,
  isBookmarked = false,
  hasNotes = false,
  tags = [],
  onSelect,
  onToggleBookmark,
  onAddTag,
}: LiteraturePaperCardEnhancedProps) {
  const ifColor = getIfColor(paper.IF);
  const ifGradient = getIfGradient(paper.IF);
  const method = normalizeMethod(paper.methods || paper.title);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.25 }}
      className={`structure-tile-hover group rounded-xl border bg-white/60 dark:bg-[#242220]/60 backdrop-blur-sm overflow-hidden ${
        isSelected
          ? 'border-claude-accent ring-1 ring-claude-accent/20'
          : 'border-claude-border/40 dark:border-[#3d3832]/40'
      }`}
    >
      {/* Top accent bar with IF gradient */}
      <div className={`h-0.5 bg-gradient-to-r ${ifGradient}`} />

      {/* Content */}
      <div className="p-3">
        {/* Header: Journal + IF + Date */}
        <div className="flex items-center gap-2 mb-2">
          {/* Journal badge with IF */}
          <div className="flex items-center gap-1.5 min-w-0">
            <div
              className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-bold text-white bg-gradient-to-br ${ifGradient} shadow-sm shrink-0`}
              title={`Impact Factor: ${paper.IF ?? 'N/A'}`}
            >
              <TrendingUp className="h-2.5 w-2.5" />
              {paper.IF ? paper.IF.toFixed(1) : 'N/A'}
            </div>
            <span className="text-[10px] font-medium text-claude-text truncate">
              {paper.journal || 'Unknown Journal'}
            </span>
          </div>

          {/* Date */}
          <div className="flex items-center gap-1 text-[9px] text-claude-text-muted ml-auto shrink-0">
            <Calendar className="h-2.5 w-2.5" />
            {formatDate(paper.pubdate)}
          </div>
        </div>

        {/* Title */}
        <h3
          className="text-xs font-semibold text-claude-text leading-snug mb-2 line-clamp-2 cursor-pointer hover:text-claude-accent transition-colors"
          onClick={onSelect}
        >
          {paper.title || 'Untitled'}
        </h3>

        {/* Authors */}
        {paper.authors && (
          <div className="flex items-start gap-1 mb-2">
            <Users className="h-2.5 w-2.5 text-claude-text-muted mt-0.5 shrink-0" />
            <span className="text-[10px] text-claude-text-muted line-clamp-1">
              {paper.authors}
            </span>
          </div>
        )}

        {/* Abstract preview */}
        {paper.abstract && (
          <p className="text-[10px] text-claude-text-secondary leading-relaxed line-clamp-2 mb-2">
            {paper.abstract}
          </p>
        )}

        {/* Footer: Method + PDB + Actions */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Method badge */}
          <MethodBadge method={method} size="sm" showIcon={true} showLabel={true} />

          {/* PDB structure link */}
          {paper.pdbId && (
            <a
              href={`https://www.rcsb.org/structure/${paper.pdbId}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold text-claude-accent hover:underline"
            >
              <BookOpen className="h-2.5 w-2.5" />
              {paper.pdbId}
            </a>
          )}

          {/* Tags */}
          {tags.length > 0 && (
            <div className="flex items-center gap-0.5">
              <Tag className="h-2.5 w-2.5 text-claude-text-muted" />
              {tags.slice(0, 2).map((tag) => (
                <Badge key={tag} variant="secondary" className="text-[8px] h-3.5 px-1">
                  {tag}
                </Badge>
              ))}
              {tags.length > 2 && (
                <span className="text-[8px] text-claude-text-muted">+{tags.length - 2}</span>
              )}
            </div>
          )}

          {/* Notes indicator */}
          {hasNotes && (
            <span className="inline-flex items-center gap-0.5 text-[9px] text-claude-accent">
              <FileText className="h-2.5 w-2.5" />
              Notes
            </span>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-0.5 ml-auto">
            {/* Bookmark */}
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={(e) => {
                e.stopPropagation();
                onToggleBookmark?.();
              }}
              title={isBookmarked ? 'Remove bookmark' : 'Bookmark'}
            >
              {isBookmarked ? (
                <BookmarkCheck className="h-3 w-3 text-claude-accent" />
              ) : (
                <Bookmark className="h-3 w-3 text-claude-text-muted" />
              )}
            </Button>

            {/* Add tag */}
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={(e) => {
                e.stopPropagation();
                onAddTag?.();
              }}
              title="Add tag"
            >
              <Tag className="h-3 w-3 text-claude-text-muted" />
            </Button>

            {/* PubMed link */}
            <a
              href={`https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center justify-center h-6 w-6 rounded hover:bg-claude-border/30 transition-colors"
              title="View on PubMed"
            >
              <ExternalLink className="h-3 w-3 text-claude-text-muted" />
            </a>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
