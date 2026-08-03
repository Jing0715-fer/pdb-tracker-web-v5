'use client';

import React, { useState, useEffect } from 'react';
import { ExternalLink, Database, RefreshCw } from 'lucide-react';
import { formatCacheSize, getCacheSize } from '@/lib/cache-utils';
import type { CacheDataSource } from '@/components/cache-status-indicator';
import { useI18n } from '@/lib/i18n';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface EnhancedFooterProps {
  dataFetchedAt: Date | null;
  totalEntries: number;
  apiStatus: 'online' | 'degraded' | 'offline';
  usingFallbackData: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
  /** Cache data source: 'live' = fresh from API, 'cached' = from localStorage, 'offline' = expired cache fallback */
  cacheDataSource?: CacheDataSource;
  /** Whether a background refresh is in progress */
  isCacheRefreshing?: boolean;
  /** Optional children (e.g., WebVitalsIndicator) */
  children?: React.ReactNode;
}

// ─── Utility: Relative Time ────────────────────────────────────────────────────

function getRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── API Status Indicator ──────────────────────────────────────────────────────

function ApiStatusDot({ status }: { status: 'online' | 'degraded' | 'offline' }) {
  const dotClass = status === 'online' ? 'footer-status-dot-live' : status === 'degraded' ? 'footer-status-dot-cached' : 'footer-status-dot-offline';
  const labelMap = {
    online: 'Live',
    degraded: 'Degraded',
    offline: 'Offline',
  };

  return (
    <span className="flex items-center gap-1.5" title={`API ${status.charAt(0).toUpperCase() + status.slice(1)}`}>
      <span className={`footer-status-dot-animated ${dotClass}`} />
      <span className="hidden sm:inline text-[10px] font-medium">{labelMap[status]}</span>
    </span>
  );
}

// ─── Cache Status Indicator (inline) ──────────────────────────────────────────

function CacheStatusDot({ dataSource }: { dataSource: CacheDataSource }) {
  const dotClass = dataSource === 'live' ? 'footer-status-dot-live' : dataSource === 'cached' ? 'footer-status-dot-cached' : 'footer-status-dot-offline';
  const labelMap = {
    live: 'Live',
    cached: 'Cached',
    offline: 'Offline',
  };
  return (
    <span className="flex items-center gap-1.5">
      <span className={`footer-status-dot-animated ${dotClass}`} />
      <span className="text-[10px] font-medium">{labelMap[dataSource]}</span>
    </span>
  );
}

// ─── Enhanced Footer Component ─────────────────────────────────────────────────

export function EnhancedFooter({
  dataFetchedAt,
  totalEntries,
  apiStatus,
  usingFallbackData,
  onRefresh,
  isRefreshing,
  cacheDataSource,
  isCacheRefreshing,
  children,
}: EnhancedFooterProps) {
  const { t, locale } = useI18n();
  // Live relative time update every 30s
  const [, setTick] = useState(0);
  const [cacheSize, setCacheSize] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  // Update cache size periodically
  useEffect(() => {
    const update = () => {
      try { setCacheSize(getCacheSize()); } catch { /* ignore */ }
    };
    update();
    const interval = setInterval(update, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Determine the cache data source display
  const resolvedDataSource: CacheDataSource = cacheDataSource ?? (
    usingFallbackData
      ? (apiStatus === 'offline' ? 'offline' : 'cached')
      : 'live'
  );

  return (
    <footer className="relative flex-shrink-0 w-full max-w-full overflow-hidden mt-auto z-10">
      {/* Subtle animated gradient line at top */}
      <div
        className="h-px w-full transition-all duration-300"
        style={{
          background: usingFallbackData
            ? 'linear-gradient(90deg, transparent, #d97706, #f59e0b, #d97706, transparent)'
            : 'linear-gradient(90deg, transparent, #2d8f8f, #c96442, #2d8f8f, transparent)',
        }}
      />

      <div className="footer-enhanced-bar">
        <div className="flex items-center justify-between px-4 py-1.5 text-[10px] text-claude-text-muted">
          {/* Left section */}
          <div className="flex items-center gap-3 min-w-0">
            {/* Data source */}
            <a
              href="https://www.rcsb.org"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-claude-accent transition-colors shrink-0"
            >
              <Database className="h-3 w-3" />
              <span className="hidden sm:inline">RCSB PDB</span>
              <ExternalLink className="h-2.5 w-2.5 hidden sm:inline" />
            </a>

            {/* API Status */}
            <ApiStatusDot status={apiStatus} />

            {/* Cache Status */}
            <CacheStatusDot dataSource={resolvedDataSource} />

            {/* Last updated */}
            <span className="hidden sm:flex items-center gap-1">
              {dataFetchedAt ? (
                <>
                  <span>Updated {getRelativeTime(dataFetchedAt)}</span>
                </>
              ) : (
                <span>No data yet</span>
              )}
            </span>

            {/* Mobile: compact updated time */}
            {dataFetchedAt && (
              <span className="sm:hidden flex items-center gap-1">
                <span className="footer-status-dot-animated footer-status-dot-live" />
                {getRelativeTime(dataFetchedAt)}
              </span>
            )}
          </div>

          {/* Right section */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Web Vitals indicator (dev mode only) */}
            {children}
            {/* Entry count */}
            {totalEntries > 0 && (
              <span className="hidden md:inline">
                {totalEntries.toLocaleString()} structures
              </span>
            )}

            {/* Cache size */}
            {cacheSize > 0 && (
              <>
                <span className="hidden md:inline text-claude-border dark:text-[#3d3832]">·</span>
                <span className="hidden md:inline" title="localStorage cache size">
                  Cache: {formatCacheSize(cacheSize)}
                </span>
              </>
            )}

            {/* Version */}
            <span className="hidden md:inline text-claude-border dark:text-[#3d3832]">·</span>
            <span className="hidden md:inline">v0.3.0</span>

            {/* Keyboard shortcuts hint */}
            <span className="hidden lg:inline text-claude-border dark:text-[#3d3832]">·</span>
            <span className="hidden lg:inline opacity-60">
              Press <kbd className="px-0.5 py-px rounded border border-claude-border dark:border-[#3d3832] bg-claude-border-light dark:bg-[#2b2926] text-[9px]">?</kbd> for shortcuts
            </span>

            {/* Refresh button */}
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="ml-1 h-5 w-5 rounded flex items-center justify-center text-claude-text-muted hover:text-claude-accent hover:bg-claude-accent/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={t.refreshDataBtn}
              aria-label={t.refreshDataBtn}
            >
              <RefreshCw
                className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`}
                style={isRefreshing ? { animationDuration: '1s' } : undefined}
              />
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
