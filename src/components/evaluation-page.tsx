'use client';

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FlaskConical, Search, ArrowRight, Database, Dna, BarChart3, Microscope } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { EvalPdbTable } from '@/components/EvalPdbTable';
import { EvaluationToolbar } from '@/components/EvaluationToolbar';
import { EvalBlastIdentityChart } from '@/components/eval-blast-identity-chart';
import type { Evaluation, EvalRow, EvalStructureRow, EvalBlastRow } from '@/lib/pdb-types';
import { exportToCSV, exportToJSON, formatEvalForExport } from '@/lib/export-utils';
import { EnhancedEmptyState } from '@/components/enhanced-empty-state';
import { EvaluationScoreCard } from '@/components/evaluation-score-card';
import { useI18n } from '@/lib/i18n';

interface EvaluationPageProps {
  evaluation: Evaluation | null;
  loading: boolean;
  onSelectPdb?: (pdbId: string) => void;
  selectedPdbId?: string | null;
}

function EmptyState() {
  const { t } = useI18n();
  return (
    <EnhancedEmptyState
      icon={<FlaskConical className="h-10 w-10" />}
      title={t.evalEmptyTitle}
      description={t.evalEmptyDesc}
      accentColor="#c96442"
      suggestions={[
        { icon: <Dna className="h-3.5 w-3.5" />, text: t.evalEmptySugg1 },
        { icon: <BarChart3 className="h-3.5 w-3.5" />, text: t.evalEmptySugg2 },
        { icon: <Microscope className="h-3.5 w-3.5" />, text: t.evalEmptySugg3 },
      ]}
    />
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col h-full">
      {/* Toolbar skeleton */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-claude-border dark:border-[#3d3832]">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <div className="space-y-1">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-2.5 w-24" />
        </div>
        <div className="flex-1" />
        <Skeleton className="h-7 w-32 rounded-md" />
        <Skeleton className="h-7 w-7 rounded-md" />
      </div>

      {/* Table skeleton */}
      <div className="flex-1 p-4 space-y-3">
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function EvaluationPage({
  evaluation,
  loading,
  onSelectPdb,
  selectedPdbId,
}: EvaluationPageProps) {
  const { locale } = useI18n();
  const [searchQuery, setSearchQuery] = useState('');
  const [compact, setCompact] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'structure' | 'blast'>('all');

  const rows: EvalRow[] = useMemo(() => {
    if (!evaluation) return [];

    const structureRows: EvalStructureRow[] = (evaluation.pdbStructures || []).map((s) => ({
      ...s,
      _type: 'structure' as const,
    }));

    const blastRows: EvalBlastRow[] = (evaluation.blastResults || []).map((b) => ({
      ...b,
      _type: 'blast' as const,
      ifTier: b.ifTier || '',
      journalIf: b.journalIf ?? null,
      title: b.title || b.description || null,
      releaseDate: b.releaseDate || null,
      pubmedId: b.pubmedId || null,
      pubmedTitle: b.pubmedTitle || null,
      pubmedAuthors: b.pubmedAuthors || null,
      pubmedAbstract: b.pubmedAbstract || null,
    }));

    let allRows: EvalRow[] = [...structureRows, ...blastRows];

    // Filter by type
    if (filterType === 'structure') {
      allRows = allRows.filter((r) => r._type === 'structure');
    } else if (filterType === 'blast') {
      allRows = allRows.filter((r) => r._type === 'blast');
    }

    return allRows;
  }, [evaluation, filterType]);

  if (loading) {
    return <LoadingSkeleton />;
  }

  if (!evaluation) {
    return <EmptyState />;
  }

  const handleExportCSV = () => {
    if (!evaluation) return;
    const formatted = formatEvalForExport(evaluation);
    exportToCSV([formatted], `evaluation-${evaluation.uniprotId}`);
  };

  const handleExportJSON = () => {
    if (!evaluation) return;
    const formatted = formatEvalForExport(evaluation);
    exportToJSON([formatted], `evaluation-${evaluation.uniprotId}`);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col h-full"
    >
      <EvaluationToolbar
        evaluation={evaluation}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        compact={compact}
        onCompactToggle={() => setCompact(!compact)}
        onExportCSV={handleExportCSV}
        onExportJSON={handleExportJSON}
        filterType={filterType}
        onFilterTypeChange={setFilterType}
      />

      <div className="flex-1 min-h-0 flex flex-col gap-2">
        {/* Score card — shown above the table when scores exist (responsive) */}
        {evaluation.scores && (
          <div className="lg:flex hidden">
            <EvaluationScoreCard evaluation={evaluation} compact={false} />
          </div>
        )}

        {/* BLAST identity distribution chart — only shown when BLAST hits exist */}
        {evaluation.blastResults && evaluation.blastResults.length > 0 && (
          <EvalBlastIdentityChart evaluation={evaluation} locale={locale} height={180} />
        )}
        <EvalPdbTable
          rows={rows}
          loading={false}
          compact={compact}
          searchQuery={searchQuery}
          onSelectRow={(row) => onSelectPdb?.(row.pdbId)}
          selectedPdbId={selectedPdbId}
        />
      </div>
    </motion.div>
  );
}
