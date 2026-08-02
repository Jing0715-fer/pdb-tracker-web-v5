'use client';

import React from 'react';

// ─── Shared Shimmer Block ──────────────────────────────────────────────────

function ShimmerBlock({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`shimmer-skeleton ${className}`} style={style} />;
}

// ─── Stat Card Skeleton ───────────────────────────────────────────────────

function StatCardSkeleton() {
  return (
    <div className="gradient-border-wrap min-w-0 h-full">
      <div className="gradient-border-inner bg-claude-surface dark:bg-[#242220] p-3 sm:p-4 min-w-0 h-full flex flex-col">
        <div className="flex items-start justify-between mb-1.5 sm:mb-2 min-h-[36px] gap-2">
          <ShimmerBlock className="w-8 h-8 min-w-[32px] rounded-md flex-shrink-0" />
          <ShimmerBlock className="hidden sm:block w-[60px] h-[34px] rounded-md" />
        </div>
        <ShimmerBlock className="w-14 sm:w-16 h-6 sm:h-7 rounded mt-1" />
        <ShimmerBlock className="w-20 h-3 rounded mt-2" />
        <ShimmerBlock className="w-24 h-2 rounded mt-1.5" />
      </div>
    </div>
  );
}

// ─── WeeklyViewSkeleton ───────────────────────────────────────────────────

export function WeeklyViewSkeleton() {
  return (
    <div className="flex flex-col h-full">
      {/* 4 stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 p-2 sm:p-3 [grid-auto-rows:1fr] min-w-0">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>

      {/* Colored separator */}
      <div
        className="mx-4 mt-2 h-[2px] flex-shrink-0"
        style={{ background: 'linear-gradient(90deg, #c96442, #2d8f8f, #7c5cbf, #c9872e)' }}
      />

      {/* Quick stats / filter bar */}
      <div className="px-4 py-2 flex items-center gap-2 flex-shrink-0 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
        <ShimmerBlock className="w-24 h-7 rounded" />
        <ShimmerBlock className="w-20 h-7 rounded" />
        <ShimmerBlock className="w-28 h-7 rounded" />
        <ShimmerBlock className="w-20 h-7 rounded ml-auto" />
      </div>

      {/* Table area */}
      <div className="flex-1 overflow-hidden">
        {/* Table header */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
          <ShimmerBlock className="w-8 h-4 rounded" />
          <ShimmerBlock className="w-16 h-4 rounded" />
          <ShimmerBlock className="w-32 h-4 rounded" />
          <ShimmerBlock className="w-14 h-4 rounded" />
          <ShimmerBlock className="w-16 h-4 rounded" />
          <ShimmerBlock className="w-20 h-4 rounded" />
          <ShimmerBlock className="w-18 h-4 rounded" />
          <ShimmerBlock className="w-14 h-4 rounded" />
          <ShimmerBlock className="w-20 h-4 rounded" />
        </div>
        {/* Table rows */}
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-1 px-3 py-2.5 border-b border-claude-border-light dark:border-[#2b2926]"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <ShimmerBlock className="w-8 h-4 rounded" />
            <ShimmerBlock className={`h-4 rounded`} style={{ width: `${50 + Math.random() * 20}px` }} />
            <ShimmerBlock className={`h-4 rounded`} style={{ width: `${100 + Math.random() * 80}px` }} />
            <ShimmerBlock className={`h-4 rounded`} style={{ width: `${40 + Math.random() * 20}px` }} />
            <ShimmerBlock className={`h-4 rounded`} style={{ width: `${50 + Math.random() * 30}px` }} />
            <ShimmerBlock className={`h-4 rounded`} style={{ width: `${60 + Math.random() * 40}px` }} />
            <ShimmerBlock className={`h-4 rounded`} style={{ width: `${50 + Math.random() * 30}px` }} />
            <ShimmerBlock className={`h-4 rounded`} style={{ width: `${40 + Math.random() * 20}px` }} />
            <ShimmerBlock className={`h-4 rounded`} style={{ width: `${55 + Math.random() * 30}px` }} />
          </div>
        ))}
      </div>

      {/* Pagination bar */}
      <div className="flex-shrink-0">
        <div className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3 border-t border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
          <ShimmerBlock className="w-40 h-5 rounded" />
          <div className="flex items-center gap-1">
            <ShimmerBlock className="w-12 h-7 rounded" />
            <ShimmerBlock className="w-7 h-7 rounded" />
            <ShimmerBlock className="w-7 h-7 rounded" />
            <ShimmerBlock className="w-7 h-7 rounded" />
            <ShimmerBlock className="w-7 h-7 rounded" />
            <ShimmerBlock className="w-12 h-7 rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── EvaluationViewSkeleton ───────────────────────────────────────────────

export function EvaluationViewSkeleton() {
  return (
    <div className="flex flex-col h-full">
      {/* Stat cards row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 p-2 sm:p-3 [grid-auto-rows:1fr] min-w-0">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>

      {/* Colored separator */}
      <div
        className="mx-4 mt-2 h-[2px] flex-shrink-0"
        style={{ background: 'linear-gradient(90deg, #c96442, #2d8f8f, #7c5cbf, #c9872e)' }}
      />

      {/* Action bar */}
      <div className="px-4 py-2 flex items-center gap-2 flex-shrink-0 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
        <ShimmerBlock className="w-20 h-7 rounded" />
        <ShimmerBlock className="w-24 h-7 rounded" />
        <ShimmerBlock className="w-20 h-7 rounded" />
        <ShimmerBlock className="w-28 h-7 rounded" />
      </div>

      {/* Main content: sidebar + content area */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <div className="hidden lg:block w-56 flex-shrink-0 border-r border-claude-border dark:border-[#3d3832] overflow-y-auto p-3 space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 p-2 rounded-lg">
              <ShimmerBlock className="w-6 h-6 rounded flex-shrink-0" />
              <div className="flex-1 space-y-1.5">
                <ShimmerBlock className="w-16 h-3 rounded" />
                <ShimmerBlock className={`h-2 rounded`} style={{ width: `${50 + Math.random() * 40}px` }} />
              </div>
            </div>
          ))}
        </div>

        {/* Content area */}
        <div className="flex-1 p-4 space-y-4 overflow-y-auto">
          {/* Detail header card */}
          <div className="border border-claude-border dark:border-[#3d3832] rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-3">
              <ShimmerBlock className="w-10 h-10 rounded-lg" />
              <div className="flex-1 space-y-2">
                <ShimmerBlock className="w-32 h-5 rounded" />
                <ShimmerBlock className="w-48 h-3 rounded" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <ShimmerBlock className="h-16 rounded-lg" />
              <ShimmerBlock className="h-16 rounded-lg" />
              <ShimmerBlock className="h-16 rounded-lg" />
            </div>
          </div>

          {/* Sub-tabs */}
          <div className="flex items-center gap-2">
            <ShimmerBlock className="w-20 h-7 rounded" />
            <ShimmerBlock className="w-24 h-7 rounded" />
            <ShimmerBlock className="w-20 h-7 rounded" />
          </div>

          {/* Content cards */}
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="border border-claude-border dark:border-[#3d3832] rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <ShimmerBlock className="w-16 h-4 rounded" />
                <ShimmerBlock className="w-12 h-5 rounded-full" />
              </div>
              <ShimmerBlock className="w-full h-3 rounded" />
              <ShimmerBlock className="w-3/4 h-3 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── LiteratureViewSkeleton ───────────────────────────────────────────────

export function LiteratureViewSkeleton() {
  return (
    <div className="flex flex-col h-full">
      {/* Toolbar row */}
      <div className="px-4 py-2 flex-shrink-0 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
        <div className="flex items-center gap-2">
          <ShimmerBlock className="w-48 h-8 rounded" />
          <ShimmerBlock className="w-20 h-8 rounded" />
          <ShimmerBlock className="w-20 h-8 rounded" />
          <ShimmerBlock className="w-16 h-8 rounded ml-auto" />
        </div>
      </div>

      {/* Active filter info */}
      <div className="px-4 py-1 flex items-center gap-2 flex-shrink-0">
        <ShimmerBlock className="w-32 h-4 rounded" />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 p-2 sm:p-3 [grid-auto-rows:1fr] min-w-0 flex-shrink-0">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>

      {/* Colored separator */}
      <div
        className="mx-4 mt-2 h-[2px] flex-shrink-0"
        style={{ background: 'linear-gradient(90deg, #c96442, #2d8f8f, #7c5cbf, #c9872e)' }}
      />

      {/* Filter chips row */}
      <div className="px-4 py-2 flex-shrink-0 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
        <div className="flex items-center gap-2 flex-wrap">
          <ShimmerBlock className="w-16 h-6 rounded-full" />
          <ShimmerBlock className="w-14 h-6 rounded-full" />
          <ShimmerBlock className="w-20 h-6 rounded-full" />
          <ShimmerBlock className="w-18 h-6 rounded-full" />
          <ShimmerBlock className="w-16 h-6 rounded-full" />
        </div>
      </div>

      {/* Paper list */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2 custom-scrollbar">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="border border-claude-border dark:border-[#3d3832] rounded-lg p-3 space-y-2.5"
            style={{ animationDelay: `${i * 100}ms` }}
          >
            <div className="flex items-start gap-2">
              <ShimmerBlock className="w-5 h-5 rounded flex-shrink-0 mt-0.5" />
              <div className="flex-1 space-y-2">
                <ShimmerBlock className={`h-4 rounded`} style={{ width: `${60 + Math.random() * 30}%` }} />
                <div className="flex items-center gap-2">
                  <ShimmerBlock className="w-28 h-3 rounded" />
                  <ShimmerBlock className="w-20 h-3 rounded" />
                </div>
                <div className="flex items-center gap-2">
                  <ShimmerBlock className="w-16 h-5 rounded-full" />
                  <ShimmerBlock className="w-14 h-5 rounded-full" />
                  <ShimmerBlock className="w-12 h-5 rounded-full" />
                </div>
                <ShimmerBlock className="w-full h-3 rounded" />
                <ShimmerBlock className={`h-3 rounded`} style={{ width: `${40 + Math.random() * 40}%` }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Generic Mode Transition Wrapper ──────────────────────────────────────

export function ModeTransitionWrapper({
  children,
  modeKey,
}: {
  children: React.ReactNode;
  modeKey: string;
}) {
  return (
    <div
      key={modeKey}
      className="mode-content-transition"
    >
      {children}
    </div>
  );
}
