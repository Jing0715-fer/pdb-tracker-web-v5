'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Rows3, Rows2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

/**
 * ViewDensityToggle
 *
 * A compact toggle button that switches between "Comfortable" and "Compact"
 * row density in the Weekly structure table. Stored in localStorage.
 *
 * - Comfortable: default row height with more padding
 * - Compact: smaller row height, more rows visible
 */

type Density = 'comfortable' | 'compact';

const STORAGE_KEY = 'pdb-view-density';

export function ViewDensityToggle() {
  const { locale } = useI18n();
  const [density, setDensity] = useState<Density>(() => {
    if (typeof window === 'undefined') return 'comfortable';
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === 'compact' ? 'compact' : 'comfortable';
    } catch {
      return 'comfortable';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, density);
    } catch {
      // ignore
    }
    // Apply density class to the table container
    const table = document.querySelector('[data-table-container]');
    if (table) {
      table.classList.toggle('density-compact', density === 'compact');
      table.classList.toggle('density-comfortable', density === 'comfortable');
    }
  }, [density]);

  const toggle = () => {
    setDensity(prev => prev === 'comfortable' ? 'compact' : 'comfortable');
  };

  const isCompact = density === 'compact';

  return (
    <button
      onClick={toggle}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium text-claude-text-muted hover:text-claude-text hover:bg-claude-border-light dark:hover:bg-[#2b2926] transition-all"
      title={isCompact
        ? (locale === 'zh' ? '切换到舒适密度' : 'Switch to comfortable density')
        : (locale === 'zh' ? '切换到紧凑密度' : 'Switch to compact density')
      }
    >
      <AnimatePresence mode="wait">
        {isCompact ? (
          <motion.span
            key="compact"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.15 }}
            className="inline-flex items-center gap-1"
          >
            <Rows3 className="h-3 w-3" />
            <span className="hidden sm:inline">{locale === 'zh' ? '紧凑' : 'Compact'}</span>
          </motion.span>
        ) : (
          <motion.span
            key="comfortable"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.15 }}
            className="inline-flex items-center gap-1"
          >
            <Rows2 className="h-3 w-3" />
            <span className="hidden sm:inline">{locale === 'zh' ? '舒适' : 'Comfortable'}</span>
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}
