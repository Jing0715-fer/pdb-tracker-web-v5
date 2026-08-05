'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
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
import type { PdbEntry } from '@/lib/pdb-types';

/**
 * StructureQuickView
 *
 * A compact summary card shown when hovering over a PDB ID link.
 * Displays key info: method, resolution, title, journal, IF, authors, date.
 * Also shows a "View Details" button and external links.
 *
 * Usage: Wrap around a PDB ID display, shows popover on hover.
 */

interface StructureQuickViewProps {
  entry: PdbEntry;
  children?: React.ReactNode;
  onView?: (pdbId: string) => void;
}

export function StructureQuickView({ entry, children, onView }: StructureQuickViewProps) {
  const [hovered, setHovered] = useState(false);
  const method = normalizeMethod(entry.method);

  const qualityLabel = useMemo(() => {
    if (entry.resolution == null) return 'Unknown';
    if (entry.resolution < 2.0) return 'High';
    if (entry.resolution < 3.0) return 'Medium';
    return 'Low';
  }, [entry.resolution]);

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children || (
        <span className="font-mono text-xs font-bold text-claude-accent hover:underline cursor-pointer">
          {entry.pdbId}
        </span>
      )}

      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute z-[100] left-0 top-full mt-1 w-80 max-w-[90vw]"
          >
            <div className="glass-card rounded-xl shadow-xl border border-claude-border/50 dark:border-[#3d3832]/50 overflow-hidden">
              {/* Header with PDB ID + quality */}
              <div className="flex items-center gap-2 p-2.5 border-b border-claude-border/30 dark:border-[#3d3832]/30 bg-gradient-to-r from-claude-accent/5 to-transparent">
                <div className="flex h-8 w-12 items-center justify-center rounded-md bg-gradient-to-br from-claude-accent to-[#d4784f] font-mono text-[10px] font-bold text-white shadow-sm">
                  {entry.pdbId}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <MethodBadge method={method} size="sm" showIcon={true} showLabel={true} />
                    {entry.resolution != null && (
                      <span className="text-[9px] text-claude-text-muted tabular-nums">
                        {entry.resolution.toFixed(2)}Å · {qualityLabel}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Title */}
              <div className="p-2.5">
                <div className="text-[11px] font-medium text-claude-text leading-snug line-clamp-2 mb-2">
                  {entry.title || 'Untitled structure'}
                </div>

                {/* Info grid */}
                <div className="grid grid-cols-2 gap-1.5 text-[9px]">
                  {entry.journal && (
                    <div className="flex items-center gap-1">
                      <Database className="h-2.5 w-2.5 text-claude-text-muted shrink-0" />
                      <span className="text-claude-text-muted truncate">{entry.journal}</span>
                    </div>
                  )}
                  {entry.journalIf != null && (
                    <div className="flex items-center gap-1">
                      <TrendingUp className="h-2.5 w-2.5 text-claude-text-muted shrink-0" />
                      <span className="text-claude-text-muted">IF: {entry.journalIf.toFixed(1)}</span>
                    </div>
                  )}
                  {entry.releaseDate && (
                    <div className="flex items-center gap-1">
                      <Calendar className="h-2.5 w-2.5 text-claude-text-muted shrink-0" />
                      <span className="text-claude-text-muted">{entry.releaseDate}</span>
                    </div>
                  )}
                  {entry.organisms && (
                    <div className="flex items-center gap-1 col-span-2">
                      <Users className="h-2.5 w-2.5 text-claude-text-muted shrink-0" />
                      <span className="text-claude-text-muted truncate">{entry.organisms}</span>
                    </div>
                  )}
                </div>

                {/* Ligands */}
                {entry.ligands && (
                  <div className="mt-2 flex items-center gap-1 flex-wrap">
                    <Boxes className="h-2.5 w-2.5 text-claude-text-muted shrink-0" />
                    {entry.ligands.split(',').slice(0, 4).map((ligand, i) => (
                      <span
                        key={i}
                        className="inline-block px-1 py-0.5 rounded text-[8px] font-mono bg-claude-border/20 dark:bg-[#3d3832]/20 text-claude-text-muted"
                      >
                        {ligand.trim()}
                      </span>
                    ))}
                    {entry.ligands.split(',').length > 4 && (
                      <span className="text-[8px] text-claude-text-muted">
                        +{entry.ligands.split(',').length - 4}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Footer with actions */}
              <div className="flex items-center gap-1 p-2 border-t border-claude-border/30 dark:border-[#3d3832]/30 bg-claude-surface/50 dark:bg-[#242220]/50">
                <button
                  onClick={() => onView?.(entry.pdbId)}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-claude-accent hover:bg-claude-accent/10 transition-colors"
                >
                  <Eye className="h-2.5 w-2.5" />
                  View Details
                </button>
                <a
                  href={`https://www.rcsb.org/structure/${entry.pdbId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-claude-text-muted hover:text-claude-accent hover:bg-claude-accent/10 transition-colors ml-auto"
                >
                  <ExternalLink className="h-2.5 w-2.5" />
                  RCSB
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
