'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Wifi, WifiOff, HardDrive, Trash2 } from 'lucide-react';
import { formatCacheSize, getCacheSize, clearAllCache, useOnlineStatus } from '@/lib/cache-utils';
import { useI18n } from '@/lib/i18n';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CacheDataSource = 'live' | 'cached' | 'offline';

export interface CacheStatusIndicatorProps {
  /** Where the current data is coming from */
  dataSource: CacheDataSource;
  /** When the data was last refreshed from the API */
  lastRefreshed: Date | null;
  /** Whether a background refresh is in progress */
  refreshing?: boolean;
  /** Callback to trigger a manual refresh */
  onRefresh?: () => void;
  /** Compact mode — icon only, no label text */
  compact?: boolean;
  /** Extra CSS class names */
  className?: string;
}

// ─── Utility: Relative time ──────────────────────────────────────────────────

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

// ─── Component ────────────────────────────────────────────────────────────────

export function CacheStatusIndicator({
  dataSource,
  lastRefreshed,
  refreshing = false,
  onRefresh,
  compact = false,
  className = '',
}: CacheStatusIndicatorProps) {
  const { t, locale } = useI18n();
  const isOnline = useOnlineStatus();
  const [cacheSize, setCacheSize] = useState(0);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Periodically update the cache size display
  useEffect(() => {
    const update = () => setCacheSize(getCacheSize());
    update();
    const interval = setInterval(update, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Auto-dismiss clear confirmation
  useEffect(() => {
    if (!showClearConfirm) return;
    const timer = setTimeout(() => setShowClearConfirm(false), 3000);
    return () => clearTimeout(timer);
  }, [showClearConfirm]);

  const handleClear = useCallback(() => {
    if (showClearConfirm) {
      clearAllCache();
      setCacheSize(0);
      setShowClearConfirm(false);
    } else {
      setShowClearConfirm(true);
    }
  }, [showClearConfirm]);

  // ── Visual config per data source ──────────────────────────────────────────

  const config: Record<CacheDataSource, {
    dotClass: string;
    label: string;
    icon: React.ReactNode;
    title: string;
  }> = {
    live: {
      dotClass: 'bg-emerald-500 animate-pulse',
      label: 'Live',
      icon: <Wifi className="h-3 w-3 text-emerald-500" />,
      title: 'Data is fresh from the API',
    },
    cached: {
      dotClass: 'bg-amber-500',
      label: 'Cached',
      icon: <HardDrive className="h-3 w-3 text-amber-500" />,
      title: locale === 'zh' ? '显示缓存数据 — 后台刷新中' : 'Showing cached data — background refresh in progress',
    },
    offline: {
      dotClass: 'bg-red-500',
      label: 'Offline',
      icon: <WifiOff className="h-3 w-3 text-red-500" />,
      title: 'API unreachable — using expired cache',
    },
  };

  const { dotClass, label, icon, title } = config[dataSource];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} title={title}>
      {/* Status dot */}
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 transition-colors duration-300 ${dotClass}`}
      />

      {/* Label + age */}
      {!compact && (
        <>
          <span className="flex items-center gap-0.5 text-[10px] font-medium">
            {icon}
            <span
              className={
                dataSource === 'live'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : dataSource === 'cached'
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-red-600 dark:text-red-400'
              }
            >
              {label}
            </span>
          </span>

          {/* Last refreshed time */}
          {lastRefreshed && dataSource !== 'live' && (
            <span className="text-[9px] text-claude-text-muted">
              ({getRelativeTime(lastRefreshed)})
            </span>
          )}
        </>
      )}

      {/* Compact: just show the dot + short label */}
      {compact && (
        <span
          className={`text-[9px] font-medium ${
            dataSource === 'live'
              ? 'text-emerald-600 dark:text-emerald-400'
              : dataSource === 'cached'
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-red-600 dark:text-red-400'
          }`}
        >
          {label}
        </span>
      )}

      {/* Refresh button */}
      {onRefresh && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRefresh();
          }}
          disabled={refreshing || !isOnline}
          className="ml-0.5 h-4 w-4 rounded flex items-center justify-center text-claude-text-muted hover:text-claude-accent hover:bg-claude-accent/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title={t.refreshDataBtn}
          aria-label={t.refreshDataBtn}
        >
          <RefreshCw
            className={`h-2.5 w-2.5 ${refreshing ? 'animate-spin' : ''}`}
            style={refreshing ? { animationDuration: '1s' } : undefined}
          />
        </button>
      )}

      {/* Clear cache button */}
      {cacheSize > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleClear();
          }}
          className={`ml-0.5 h-4 w-4 rounded flex items-center justify-center transition-colors ${
            showClearConfirm
              ? 'text-red-500 bg-red-500/10 hover:bg-red-500/20'
              : 'text-claude-text-muted hover:text-claude-accent hover:bg-claude-accent/10'
          }`}
          title={showClearConfirm ? (locale === 'zh' ? '再次点击确认清除' : 'Click again to confirm clear') : (locale === 'zh' ? `清除缓存 (${formatCacheSize(cacheSize)})` : `Clear cache (${formatCacheSize(cacheSize)})`)}
          aria-label={showClearConfirm ? (locale === 'zh' ? '确认清除缓存' : 'Confirm clear cache') : (locale === 'zh' ? '清除缓存' : 'Clear cache')}
        >
          <Trash2 className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}
