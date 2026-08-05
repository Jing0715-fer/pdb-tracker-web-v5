'use client';

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Gauge } from 'lucide-react';
import type { PdbEntry } from '@/lib/pdb-types';

/**
 * ResolutionHistogramWidget
 *
 * A compact resolution distribution histogram for the custom dashboard.
 * Shows how many structures fall into each resolution bin.
 */

const BINS = [
  { label: '<1.5Å', min: 0, max: 1.5, color: '#16a34a' },
  { label: '1.5-2Å', min: 1.5, max: 2.0, color: '#2d8f8f' },
  { label: '2-2.5Å', min: 2.0, max: 2.5, color: '#7c5cbf' },
  { label: '2.5-3Å', min: 2.5, max: 3.0, color: '#c9872e' },
  { label: '3-3.5Å', min: 3.0, max: 3.5, color: '#ea580c' },
  { label: '>3.5Å', min: 3.5, max: Infinity, color: '#dc2626' },
];

export function ResolutionHistogramWidget({ entries }: { entries: PdbEntry[] }) {
  const data = useMemo(() => {
    return BINS.map(bin => ({
      ...bin,
      count: entries.filter(e => e.resolution != null && e.resolution >= bin.min && e.resolution < bin.max).length,
    }));
  }, [entries]);

  const maxCount = Math.max(...data.map(d => d.count), 1);

  return (
    <div className="space-y-2">
      {data.map((bin, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-[9px] font-mono text-claude-text-muted w-12 text-right shrink-0">{bin.label}</span>
          <div className="flex-1 h-4 bg-claude-border-light dark:bg-[#2b2926] rounded-sm overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(bin.count / maxCount) * 100}%` }}
              transition={{ delay: i * 0.05, duration: 0.4, ease: 'easeOut' }}
              className="h-full rounded-sm flex items-center justify-end pr-1"
              style={{ backgroundColor: bin.color, opacity: 0.8 }}
            >
              {bin.count > 0 && (
                <span className="text-[8px] font-bold text-white">{bin.count}</span>
              )}
            </motion.div>
          </div>
        </div>
      ))}
    </div>
  );
}
