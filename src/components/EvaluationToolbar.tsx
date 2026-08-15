'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Search,
  Download,
  Minimize2,
  Maximize2,
  Filter,
  Layers,
  Target,
  Dna,
  ChevronDown,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useI18n } from '@/lib/i18n';
import type { Evaluation } from '@/lib/pdb-types';

interface EvaluationToolbarProps {
  evaluation: Evaluation | null;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  compact: boolean;
  onCompactToggle: () => void;
  onExportCSV?: () => void;
  onExportJSON?: () => void;
  filterType: 'all' | 'structure' | 'blast';
  onFilterTypeChange: (type: 'all' | 'structure' | 'blast') => void;
}

export function EvaluationToolbar({
  evaluation,
  searchQuery,
  onSearchChange,
  compact,
  onCompactToggle,
  onExportCSV,
  onExportJSON,
  filterType,
  onFilterTypeChange,
}: EvaluationToolbarProps) {
  const { t, locale } = useI18n();
  const [filterOpen, setFilterOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!exportOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [exportOpen]);

  const pdbCount = evaluation?.pdbStructures?.length ?? 0;
  const blastCount = evaluation?.blastResults?.length ?? 0;

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
      {/* Protein info */}
      {evaluation ? (
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.2 }}
          className="flex items-center gap-3 min-w-0 flex-shrink-0"
        >
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-claude-accent-light dark:bg-[#3d2a22] flex-shrink-0">
            <Dna className="h-4 w-4 text-claude-accent" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold text-claude-text truncate">
                {evaluation.proteinName || evaluation.entryName || evaluation.uniprotId}
              </h1>
              <span className="font-mono text-[10px] text-claude-accent bg-claude-accent-light dark:bg-[#3d2a22] px-1.5 py-0.5 rounded">
                {evaluation.uniprotId}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="inline-flex items-center gap-1 text-[10px] text-claude-cryoem">
                <Layers className="h-3 w-3" />
                {pdbCount} structures
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] text-claude-nmr">
                <Target className="h-3 w-3" />
                {blastCount} homologs
              </span>
              {evaluation.organism && (
                <span className="text-[10px] text-claude-text-muted truncate max-w-[120px]">
                  {evaluation.organism}
                </span>
              )}
            </div>
          </div>
        </motion.div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-claude-border-light dark:bg-[#2b2926]">
            <Dna className="h-4 w-4 text-claude-text-muted" />
          </div>
          <span className="text-sm text-claude-text-muted">Select an evaluation</span>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Filter type tabs */}
      <div className="hidden sm:flex items-center gap-1 bg-claude-border-light dark:bg-[#2b2926] rounded-lg p-0.5">
        {(['all', 'structure', 'blast'] as const).map((type) => (
          <button
            key={type}
            onClick={() => onFilterTypeChange(type)}
            className={`px-2 py-1 text-[10px] font-medium rounded-md transition-all duration-150 ${
              filterType === type
                ? 'bg-claude-surface dark:bg-[#242220] text-claude-text shadow-sm'
                : 'text-claude-text-muted hover:text-claude-text-secondary'
            }`}
          >
            {type === 'all' ? 'All' : type === 'structure' ? 'Structures' : 'Homologs'}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative hidden md:block">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-claude-text-muted" />
        <Input
          type="text"
          placeholder={t.filterTable}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-7 w-40 pl-8 pr-3 text-xs bg-claude-surface dark:bg-[#1a1917] border-claude-border dark:border-[#3d3832] focus:ring-claude-accent/30 input-focus-glow"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={onCompactToggle}
              className="h-7 w-7 p-0 text-claude-text-muted hover:text-claude-text hover:bg-claude-border-light dark:hover:bg-[#2b2926] active:scale-95 transition-transform duration-100"
            >
              {compact ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom"><p>{compact ? 'Expand view' : 'Compact view'}</p></TooltipContent>
        </Tooltip>
        {(onExportCSV || onExportJSON) && (
          <div className="relative" ref={exportMenuRef}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setExportOpen(!exportOpen)}
                  className="h-7 px-1.5 text-claude-text-muted hover:text-claude-text hover:bg-claude-border-light dark:hover:bg-[#2b2926] gap-1 active:scale-95 transition-transform duration-100"
                >
                  <Download className="h-3.5 w-3.5" />
                  <ChevronDown className={`h-2.5 w-2.5 transition-transform ${exportOpen ? 'rotate-180' : ''}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p>Export data</p></TooltipContent>
            </Tooltip>
            {exportOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-[#2b2926] border border-claude-border dark:border-[#3d3832] rounded-md shadow-lg py-1 min-w-[140px]">
                {onExportCSV && (
                  <button
                    onClick={() => { onExportCSV(); setExportOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-[11px] text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#3d3832] hover:text-claude-text transition-colors"
                  >
                    Export as CSV
                  </button>
                )}
                {onExportJSON && (
                  <button
                    onClick={() => { onExportJSON(); setExportOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-[11px] text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#3d3832] hover:text-claude-text transition-colors"
                  >
                    Export as JSON
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
