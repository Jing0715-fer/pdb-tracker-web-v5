'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { BookOpen, Search, Filter, Database, CalendarDays, TrendingUp, SearchCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EnhancedEmptyState } from '@/components/enhanced-empty-state';
import { useI18n } from '@/lib/i18n';

interface LiteratureEmptyStateProps {
  hasFilters?: boolean;
  onClearFilters?: () => void;
}

export function LiteratureEmptyState({ hasFilters = true, onClearFilters }: LiteratureEmptyStateProps) {
  const { t } = useI18n();
  return (
    <EnhancedEmptyState
      icon={<BookOpen className="h-10 w-10" />}
      title={t.litEmptyTitle}
      description={
        hasFilters
          ? t.litEmptyDescFiltered
          : t.litEmptyDescEmpty
      }
      accentColor="#7c5cbf"
      action={
        hasFilters && onClearFilters
          ? { label: t.litEmptyAction, onClick: onClearFilters, icon: <Filter className="h-4 w-4" /> }
          : undefined
      }
      suggestions={[
        { icon: <CalendarDays className="h-3.5 w-3.5" />, text: t.litEmptySugg1 },
        { icon: <TrendingUp className="h-3.5 w-3.5" />, text: t.litEmptySugg2 },
        { icon: <SearchCheck className="h-3.5 w-3.5" />, text: t.litEmptySugg3 },
      ]}
    />
  );
}
