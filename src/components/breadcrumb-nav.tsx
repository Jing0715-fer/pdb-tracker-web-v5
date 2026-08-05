'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Home } from 'lucide-react';
import type { Mode } from '@/lib/pdb-types';
import { useI18n } from '@/lib/i18n';

export interface BreadcrumbSegment {
  label: string;
  onClick?: () => void;
  isCurrent?: boolean;
}

interface BreadcrumbNavProps {
  mode: Mode;
  /** Weekly mode: e.g., "W08" */
  weekLabel?: string | null;
  /** Weekly mode: e.g., "8FG1" when entry selected */
  entryId?: string | null;
  /** Evaluation mode: e.g., "EGFR" or batch name */
  evalName?: string | null;
  /** Evaluation mode: batch name when viewing batch */
  evalBatchName?: string | null;
  /** Literature mode: e.g., "2025" */
  litYear?: string | null;
  /** Literature mode: e.g., "PMID39120001" when paper selected */
  litPmid?: string | null;
  /** Callbacks */
  onModeClick?: () => void;
  onSubClick?: () => void;
}

export function BreadcrumbNav({
  mode,
  weekLabel,
  entryId,
  evalName,
  evalBatchName,
  litYear,
  litPmid,
  onModeClick,
  onSubClick,
}: BreadcrumbNavProps) {
  const { t, locale } = useI18n();
  const segments: BreadcrumbSegment[] = [
    { label: 'PDB Tracker' },
  ];

  // Add mode segment
  const modeLabel = mode === 'weekly' ? 'Weekly' : mode === 'evaluation' ? 'Evaluation' : mode === 'analysis' ? 'Analysis' : 'Literature';
  const modeHasChildren =
    (mode === 'weekly' && !!weekLabel) ||
    (mode === 'evaluation' && (!!evalName || !!evalBatchName)) ||
    (mode === 'literature' && !!litYear);

  segments.push({
    label: modeLabel,
    onClick: modeHasChildren ? onModeClick : undefined,
    isCurrent: !modeHasChildren,
  });

  // Add sub-segments based on mode
  if (mode === 'weekly') {
    if (weekLabel) {
      const hasEntry = !!entryId;
      segments.push({
        label: weekLabel,
        onClick: hasEntry ? onSubClick : undefined,
        isCurrent: !hasEntry,
      });
      if (entryId) {
        segments.push({
          label: entryId,
          isCurrent: true,
        });
      }
    }
  } else if (mode === 'evaluation') {
    if (evalBatchName) {
      const hasEval = !!evalName;
      segments.push({
        label: evalBatchName,
        onClick: hasEval ? onSubClick : undefined,
        isCurrent: !hasEval,
      });
      if (evalName) {
        segments.push({
          label: evalName,
          isCurrent: true,
        });
      }
    } else if (evalName) {
      segments.push({
        label: evalName,
        isCurrent: true,
      });
    }
  } else if (mode === 'literature') {
    if (litYear) {
      const hasPaper = !!litPmid;
      segments.push({
        label: litYear,
        onClick: hasPaper ? onSubClick : undefined,
        isCurrent: !hasPaper,
      });
      if (litPmid) {
        segments.push({
          label: litPmid,
          isCurrent: true,
        });
      }
    }
  }

  return (
    <nav
      aria-label={t.breadcrumb}
      className="flex items-center gap-1 px-4 py-1.5 bg-claude-bg dark:bg-[#1a1917] border-b border-claude-border-light dark:border-[#2b2926] text-[11px] overflow-hidden min-w-0"
    >
      <Home className="h-3 w-3 text-claude-text-muted flex-shrink-0" />
      <AnimatePresence mode="popLayout">
        {segments.map((seg, i) => (
          <React.Fragment key={`${seg.label}-${i}`}>
            {i > 0 && (
              <motion.span
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -4 }}
                transition={{ duration: 0.15 }}
                className="text-claude-text-muted flex-shrink-0"
              >
                <ChevronRight className="h-2.5 w-2.5" />
              </motion.span>
            )}
            <motion.span
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.2, delay: i * 0.03 }}
              className={`
                flex-shrink-0 truncate max-w-[140px]
                ${seg.isCurrent
                  ? 'text-claude-text font-medium'
                  : seg.onClick
                    ? 'text-claude-text-secondary hover:text-claude-accent cursor-pointer transition-colors duration-150'
                    : 'text-claude-text-secondary'
                }
              `}
              onClick={seg.onClick}
              role={seg.onClick ? 'button' : undefined}
              tabIndex={seg.onClick ? 0 : undefined}
              onKeyDown={seg.onClick ? (e) => { if (e.key === 'Enter') seg.onClick?.(); } : undefined}
            >
              {seg.label}
            </motion.span>
          </React.Fragment>
        ))}
      </AnimatePresence>
    </nav>
  );
}
