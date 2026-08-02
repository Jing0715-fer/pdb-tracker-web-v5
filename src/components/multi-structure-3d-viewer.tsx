'use client';

import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Boxes, ExternalLink, Maximize2 } from 'lucide-react';
import type { PdbEntry } from '@/lib/pdb-types';
import { getMethodColor, getMethodLabel } from '@/components/pdb-helpers';
import { useI18n } from '@/lib/i18n';
import { useFocusTrap } from '@/hooks/use-focus-trap';

/**
 * MultiStructure3DViewer
 *
 * A side-by-side 3D structure preview grid for 2-4 PDB structures.
 * Uses PDB thumbnail images (from RCSB) for each structure, displayed
 * in a responsive grid layout. Each panel shows:
 *   - 3D structure thumbnail
 *   - PDB ID + method badge
 *   - Resolution + IF
 *   - Click to open full 3D viewer
 *
 * This is a lightweight alternative to running multiple Molstar instances
 * (which would consume too much memory in the browser).
 */

interface MultiStructure3DViewerProps {
  entries: PdbEntry[];
  onClose: () => void;
  onViewEntry?: (pdbId: string) => void;
}

export function MultiStructure3DViewer({ entries, onClose, onViewEntry }: MultiStructure3DViewerProps) {
  const { locale } = useI18n();
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, onClose);
  if (!entries.length) return null;

  const gridCols = entries.length === 2 ? 'grid-cols-1 sm:grid-cols-2' : entries.length === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        ref={modalRef}
        initial={{ scale: 0.95 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0.95 }}
        className="bg-claude-surface dark:bg-[#242220] rounded-xl shadow-2xl border border-claude-border dark:border-[#3d3832] max-w-5xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-claude-border dark:border-[#3d3832]">
          <div className="flex items-center gap-2">
            <Boxes className="h-4 w-4 text-claude-accent" />
            <h3 className="text-sm font-bold text-claude-text">
              {locale === 'zh' ? '多结构 3D 预览' : 'Multi-Structure 3D Preview'}
            </h3>
            <span className="text-[10px] text-claude-text-muted">
              {entries.length} {locale === 'zh' ? '个结构' : 'structures'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-claude-text-muted hover:text-claude-text hover:bg-claude-border-light dark:hover:bg-[#2b2926] transition-all"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Grid of structure previews */}
        <div className="flex-1 overflow-auto custom-scrollbar p-4">
          <div className={`grid ${gridCols} gap-4`}>
            {entries.map((entry, i) => {
              const method = getMethodLabel(entry.method || '');
              const methodColor = entry.method && method === 'Cryo-EM' ? '#2d8f8f' : method === 'X-ray' ? '#7c5cbf' : method === 'NMR' ? '#c9872e' : '#6b7280';
              const imageUrl = `/api/pdb-image/${entry.pdbId.toUpperCase()}`;
              return (
                <motion.div
                  key={entry.pdbId}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.1, duration: 0.3 }}
                  className="rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-claude-bg dark:bg-[#1a1917] overflow-hidden flex flex-col"
                >
                  {/* 3D Preview Image */}
                  <div
                    className="relative aspect-square bg-gradient-to-br from-claude-border-light/30 to-claude-border/10 dark:from-[#2b2926]/30 dark:to-[#1a1917]/10 flex items-center justify-center cursor-pointer group"
                    onClick={() => onViewEntry?.(entry.pdbId)}
                  >
                    <img
                      src={imageUrl}
                      alt={`3D structure ${entry.pdbId}`}
                      className="w-full h-full object-contain p-2 transition-transform group-hover:scale-105"
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                        const fallback = (e.target as HTMLImageElement).nextElementSibling;
                        if (fallback) (fallback as HTMLElement).style.display = 'flex';
                      }}
                    />
                    <div className="absolute inset-0 hidden items-center justify-center text-claude-text-muted">
                      <Boxes className="h-8 w-8 opacity-30" />
                    </div>
                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/80 dark:bg-black/60 rounded-full p-1.5">
                        <Maximize2 className="h-3 w-3 text-claude-accent" />
                      </div>
                    </div>
                  </div>

                  {/* Info Bar */}
                  <div className="p-2 border-t border-claude-border/30 dark:border-[#3d3832]/30">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: methodColor }}
                      />
                      <a
                        href={`https://www.rcsb.org/structure/${entry.pdbId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[11px] font-bold text-claude-accent hover:underline"
                      >
                        {entry.pdbId}
                      </a>
                      <ExternalLink className="h-2.5 w-2.5 text-claude-text-muted" />
                      <span className="text-[9px] text-claude-text-muted ml-auto">{method}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[9px] text-claude-text-muted">
                      {entry.resolution != null && (
                        <span className="font-mono">{entry.resolution.toFixed(2)}Å</span>
                      )}
                      {entry.journalIf != null && entry.journalIf > 0 && (
                        <span className="font-mono text-[#dc2626]">IF {entry.journalIf.toFixed(1)}</span>
                      )}
                    </div>
                    <p className="text-[9px] text-claude-text-secondary line-clamp-1 mt-0.5">
                      {entry.title || 'Untitled'}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-claude-border dark:border-[#3d3832] flex items-center justify-between">
          <span className="text-[10px] text-claude-text-muted">
            {locale === 'zh' ? '点击结构查看 3D 详情' : 'Click a structure to view 3D details'}
          </span>
          <button
            onClick={onClose}
            className="text-[10px] text-claude-text-muted hover:text-claude-text transition-colors"
          >
            {locale === 'zh' ? '关闭' : 'Close'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
