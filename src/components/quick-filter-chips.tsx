'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Flame, Award, Microscope, Calendar, Star, Zap } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

/**
 * QuickFilterChips
 *
 * A row of preset filter chips shown above the structure table in Weekly mode.
 * Each chip applies a common filter with a single click:
 *
 *   - High Impact (IF ≥ 20)
 *   - Cryo-EM only
 *   - Best Resolution (< 2.0Å)
 *   - Bookmarked
 *   - This Week
 *   - Clear All
 *
 * The active chip is highlighted. Clicking an active chip clears it.
 */

interface QuickFilterChipsProps {
  activeFilter: string;
  onFilterChange: (filter: string) => void;
  onClearAll: () => void;
  bookmarksCount?: number;
}

interface ChipConfig {
  id: string;
  label: string;
  labelZh: string;
  icon: typeof Flame;
  color: string;
  bgColor: string;
}

const CHIPS: ChipConfig[] = [
  {
    id: 'high-if',
    label: 'High IF ≥20',
    labelZh: '高IF ≥20',
    icon: Award,
    color: '#dc2626',
    bgColor: 'rgba(220, 38, 38, 0.1)',
  },
  {
    id: 'Cryo-EM',
    label: 'Cryo-EM',
    labelZh: '冷冻电镜',
    icon: Microscope,
    color: '#2d8f8f',
    bgColor: 'rgba(45, 143, 143, 0.1)',
  },
  {
    id: 'top-if',
    label: 'Top IF ≥10',
    labelZh: '顶级IF ≥10',
    icon: Flame,
    color: '#ea580c',
    bgColor: 'rgba(234, 88, 12, 0.1)',
  },
  {
    id: 'bookmarks',
    label: 'Bookmarks',
    labelZh: '收藏',
    icon: Star,
    color: '#c9872e',
    bgColor: 'rgba(201, 135, 46, 0.1)',
  },
];

export function QuickFilterChips({
  activeFilter,
  onFilterChange,
  onClearAll,
  bookmarksCount = 0,
}: QuickFilterChipsProps) {
  const { locale } = useI18n();

  const handleChipClick = (chipId: string) => {
    if (activeFilter === chipId) {
      onClearAll();
    } else {
      onFilterChange(chipId);
    }
  };

  return (
    <div className="flex items-center gap-1.5 px-3 sm:px-4 py-1.5 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] overflow-x-auto custom-scrollbar">
      <span className="text-[9px] font-semibold uppercase tracking-wider text-claude-text-muted shrink-0 mr-1 hidden sm:inline">
        {locale === 'zh' ? '快速筛选' : 'Quick'}
      </span>
      {CHIPS.map((chip, i) => {
        const Icon = chip.icon;
        const isActive = activeFilter === chip.id;
        const showCount = chip.id === 'bookmarks' && bookmarksCount > 0;
        return (
          <motion.button
            key={chip.id}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.03, duration: 0.15 }}
            onClick={() => handleChipClick(chip.id)}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all shrink-0 ${
              isActive
                ? 'text-white shadow-sm'
                : 'text-claude-text-secondary hover:text-claude-text border border-claude-border/40 dark:border-[#3d3832]/40'
            }`}
            style={isActive ? { backgroundColor: chip.color } : undefined}
          >
            <Icon className="h-2.5 w-2.5" />
            <span>{locale === 'zh' ? chip.labelZh : chip.label}</span>
            {showCount && (
              <span className={`ml-0.5 inline-flex items-center justify-center min-w-[12px] h-[12px] px-0.5 rounded-full text-[8px] font-bold ${
                isActive ? 'bg-white/25' : 'bg-claude-border-light dark:bg-[#2b2926]'
              }`}>
                {bookmarksCount}
              </span>
            )}
          </motion.button>
        );
      })}
      {activeFilter !== 'all' && (
        <motion.button
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          onClick={onClearAll}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium text-claude-text-muted hover:text-red-500 transition-colors shrink-0 ml-auto"
        >
          <Zap className="h-2.5 w-2.5" />
          {locale === 'zh' ? '清除' : 'Clear'}
        </motion.button>
      )}
    </div>
  );
}
