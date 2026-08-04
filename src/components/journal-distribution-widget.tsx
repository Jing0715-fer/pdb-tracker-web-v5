'use client';

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Award } from 'lucide-react';
import type { PdbEntry } from '@/lib/pdb-types';

/**
 * JournalDistributionWidget
 *
 * A compact journal distribution chart for the custom dashboard.
 * Shows top 5 journals by structure count with IF badges.
 */

export function JournalDistributionWidget({ entries }: { entries: PdbEntry[] }) {
  const data = useMemo(() => {
    const journalMap = new Map<string, { count: number; totalIf: number }>();
    entries.forEach(e => {
      if (e.journal) {
        const existing = journalMap.get(e.journal) || { count: 0, totalIf: 0 };
        existing.count++;
        if (e.journalIf) existing.totalIf += e.journalIf;
        journalMap.set(e.journal, existing);
      }
    });
    return Array.from(journalMap.entries())
      .map(([name, { count, totalIf }]) => ({ name, count, avgIf: count > 0 ? totalIf / count : 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [entries]);

  const maxCount = Math.max(...data.map(d => d.count), 1);

  if (data.length === 0) return <div className="text-[10px] text-claude-text-muted py-4 text-center">No journal data</div>;

  return (
    <div className="space-y-1.5">
      {data.map((journal, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-[9px] text-claude-text-secondary truncate flex-1" title={journal.name}>
            {journal.name.length > 20 ? journal.name.slice(0, 19) + '…' : journal.name}
          </span>
          <div className="w-20 h-3 bg-claude-border-light dark:bg-[#2b2926] rounded-sm overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(journal.count / maxCount) * 100}%` }}
              transition={{ delay: i * 0.05, duration: 0.4 }}
              className="h-full rounded-sm"
              style={{ backgroundColor: '#c96442', opacity: 0.7 }}
            />
          </div>
          <span className="text-[9px] font-mono font-medium text-claude-text w-4 text-right">{journal.count}</span>
          {journal.avgIf > 0 && (
            <span className="text-[8px] font-mono text-[#dc2626] w-8 text-right">IF {journal.avgIf.toFixed(0)}</span>
          )}
        </div>
      ))}
    </div>
  );
}
