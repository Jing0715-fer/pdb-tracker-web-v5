'use client';

import { motion } from 'framer-motion';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * EnhancedLoadingSkeleton
 *
 * A collection of shimmer-animated loading skeletons for different views.
 * Each skeleton mimics the layout of its corresponding content area so
 * the user sees a smooth transition from loading to loaded state.
 *
 * Skeletons:
 *   - WeeklyTableSkeleton: mimics the structure table with rows
 *   - EvaluationCardSkeleton: mimics the evaluation score card
 *   - LiteraturePaperSkeleton: mimics the paper card layout
 *   - SidebarWidgetSkeleton: mimics sidebar widgets (trending, comparison)
 *   - StatsCardSkeleton: mimics the 4-column stats cards row
 */

function ShimmerBlock({ className }: { className?: string }) {
  return (
    <div className={`skeleton-shimmer relative overflow-hidden rounded-md bg-claude-border/30 dark:bg-[#3d3832]/30 ${className || ''}`} />
  );
}

export function WeeklyTableSkeleton() {
  return (
    <div className="data-fade-in p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-center gap-3 pb-2 border-b border-claude-border/30 dark:border-[#3d3832]/30">
        <ShimmerBlock className="h-4 w-16" />
        <ShimmerBlock className="h-4 w-14" />
        <ShimmerBlock className="h-4 w-20" />
        <ShimmerBlock className="h-4 w-10" />
        <ShimmerBlock className="h-4 flex-1" />
        <ShimmerBlock className="h-4 w-16" />
      </div>
      {/* Data rows */}
      {Array.from({ length: 8 }).map((_, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
          className="flex items-center gap-3 py-2"
        >
          <ShimmerBlock className="h-4 w-16" />
          <ShimmerBlock className="h-5 w-14 rounded-full" />
          <ShimmerBlock className="h-4 w-20" />
          <ShimmerBlock className="h-4 w-10" />
          <ShimmerBlock className="h-4 flex-1" />
          <ShimmerBlock className="h-4 w-16" />
        </motion.div>
      ))}
    </div>
  );
}

export function EvaluationCardSkeleton() {
  return (
    <div className="glass-card rounded-xl p-3 data-fade-in">
      <div className="flex items-center gap-2 mb-3">
        <ShimmerBlock className="h-7 w-7 rounded-lg" />
        <ShimmerBlock className="h-3 w-24" />
      </div>
      <div className="flex gap-4">
        <ShimmerBlock className="h-16 w-16 rounded-full" />
        <div className="flex-1 space-y-2">
          <ShimmerBlock className="h-2 w-full" />
          <ShimmerBlock className="h-2 w-3/4" />
          <ShimmerBlock className="h-2 w-5/6" />
          <ShimmerBlock className="h-2 w-2/3" />
        </div>
      </div>
      <div className="mt-3 pt-2 border-t border-claude-border/30 grid grid-cols-3 gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="text-center">
            <ShimmerBlock className="h-2 w-12 mx-auto mb-1" />
            <ShimmerBlock className="h-4 w-8 mx-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function LiteraturePaperSkeleton() {
  return (
    <div className="structure-tile-hover rounded-xl border border-claude-border/40 dark:border-[#3d3832]/40 bg-white/60 dark:bg-[#242220]/60 overflow-hidden data-fade-in">
      <ShimmerBlock className="h-0.5 w-full" />
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <ShimmerBlock className="h-4 w-16 rounded-md" />
          <ShimmerBlock className="h-3 w-24" />
          <ShimmerBlock className="h-3 w-12 ml-auto" />
        </div>
        <ShimmerBlock className="h-3 w-full" />
        <ShimmerBlock className="h-3 w-4/5" />
        <ShimmerBlock className="h-2 w-32" />
        <div className="flex items-center gap-1.5">
          <ShimmerBlock className="h-4 w-14 rounded-full" />
          <ShimmerBlock className="h-4 w-10 rounded-md" />
          <ShimmerBlock className="h-4 w-4 ml-auto rounded" />
        </div>
      </div>
    </div>
  );
}

export function SidebarWidgetSkeleton() {
  return (
    <div className="p-3 space-y-2 data-fade-in">
      <div className="flex items-center gap-1.5 mb-2">
        <ShimmerBlock className="h-3 w-3 rounded" />
        <ShimmerBlock className="h-2 w-16" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-start gap-2 p-2">
          <ShimmerBlock className="h-8 w-12 rounded-md shrink-0" />
          <div className="flex-1 space-y-1">
            <ShimmerBlock className="h-2 w-full" />
            <ShimmerBlock className="h-2 w-3/4" />
            <ShimmerBlock className="h-2 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatsCardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 px-4 py-2.5 data-fade-in">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-claude-border/40 dark:border-[#3d3832]/40 bg-white/60 dark:bg-[#242220]/60 p-2.5"
        >
          <div className="flex items-center gap-2 mb-2">
            <ShimmerBlock className="h-7 w-7 rounded-lg" />
            <div className="flex-1 space-y-1">
              <ShimmerBlock className="h-2 w-12" />
              <ShimmerBlock className="h-3 w-8" />
            </div>
          </div>
          <ShimmerBlock className="h-8 w-full rounded-md" />
        </div>
      ))}
    </div>
  );
}

/**
 * Full-page loading skeleton that mimics the entire Weekly mode layout.
 * Used during initial data fetch.
 */
export function FullPageSkeleton() {
  return (
    <div className="flex h-full">
      {/* Sidebar skeleton */}
      <div className="hidden lg:flex w-[260px] border-r border-claude-border/30 dark:border-[#3d3832]/30 flex-col">
        <div className="px-3 py-3 border-b border-claude-border/30 dark:border-[#3d3832]/30">
          <ShimmerBlock className="h-3 w-24" />
        </div>
        <div className="flex-1 p-2 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <ShimmerBlock key={i} className="h-12 w-full rounded-md" />
          ))}
        </div>
      </div>
      {/* Main content skeleton */}
      <div className="flex-1 flex flex-col">
        <StatsCardSkeleton />
        <WeeklyTableSkeleton />
      </div>
    </div>
  );
}
