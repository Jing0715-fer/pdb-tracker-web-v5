'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, RefreshCw, X, Database, WifiOff } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

/**
 * ErrorBanner
 *
 * A persistent, dismissible error banner that appears at the top of the content
 * area when an API fetch fails. Unlike toast notifications (which auto-dismiss
 * after 6s), this banner stays visible until the user takes action:
 *
 *   - Click "Retry" to re-fetch the data
 *   - Click "Open Run Center" for database errors
 *   - Click X to dismiss the banner
 *
 * The banner slides in from the top with a subtle red accent and auto-detects
 * whether the error is database-related (shows DB icon + Run Center action)
 * or a generic fetch error (shows WifiOff icon + Retry action).
 */

interface ErrorBannerProps {
  /** The error message to display. null = no error (banner hidden). */
  error: string | null;
  /** Whether data is currently loading (hides banner during reload). */
  loading?: boolean;
  /** Whether the error is database-related (changes icon + action). */
  isDbError?: boolean;
  /** Called when the user clicks "Retry". */
  onRetry: () => void;
  /** Called when the user clicks "Open Run Center" (DB errors only). */
  onOpenRunCenter?: () => void;
  /** Called when the user dismisses the banner. */
  onDismiss: () => void;
}

export function ErrorBanner({
  error,
  loading = false,
  isDbError = false,
  onRetry,
  onOpenRunCenter,
  onDismiss,
}: ErrorBannerProps) {
  const { locale } = useI18n();
  const [isRetrying, setIsRetrying] = useState(false);
  const isVisible = error && !loading;

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      await Promise.resolve(onRetry());
    } finally {
      setTimeout(() => setIsRetrying(false), 800);
    }
  };

  return (
    <AnimatePresence mode="wait">
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, height: 0, y: -10 }}
          animate={{ opacity: 1, height: 'auto', y: 0 }}
          exit={{ opacity: 0, height: 0, y: -10 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="overflow-hidden border-b border-red-500/20 dark:border-red-900/30 bg-red-50 dark:bg-red-950/20"
        >
          <div className="flex items-center gap-2.5 px-3 sm:px-4 py-2.5 flex-wrap">
            {/* Error icon with pulse */}
            <motion.div
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center ${
                isDbError
                  ? 'bg-amber-100 dark:bg-amber-950/40'
                  : 'bg-red-100 dark:bg-red-950/40'
              }`}
            >
              {isDbError ? (
                <Database className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              ) : (
                <WifiOff className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
              )}
            </motion.div>

            {/* Error text */}
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
              <span className={`text-[11px] font-semibold ${
                isDbError
                  ? 'text-amber-700 dark:text-amber-300'
                  : 'text-red-700 dark:text-red-300'
              }`}>
                {isDbError
                  ? (locale === 'zh' ? '数据库未配置' : 'Database not configured')
                  : (locale === 'zh' ? '数据加载失败' : 'Failed to load data')
                }
              </span>
              <span className="text-[10px] text-red-600/80 dark:text-red-400/70 truncate font-mono">
                {error}
              </span>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1.5 shrink-0">
              {isDbError && onOpenRunCenter && (
                <button
                  onClick={onOpenRunCenter}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium bg-amber-600 hover:bg-amber-700 text-white transition-all active:scale-95"
                >
                  <Database className="h-2.5 w-2.5" />
                  {locale === 'zh' ? '打开运行中心' : 'Open Run Center'}
                </button>
              )}
              <button
                onClick={handleRetry}
                disabled={isRetrying}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium bg-claude-surface dark:bg-[#242220] border border-red-300 dark:border-red-900/50 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`h-2.5 w-2.5 ${isRetrying ? 'animate-spin' : ''}`} />
                {isRetrying
                  ? (locale === 'zh' ? '重试中…' : 'Retrying…')
                  : (locale === 'zh' ? '重试' : 'Retry')
                }
              </button>
              <button
                onClick={onDismiss}
                className="p-1 rounded-md text-red-600/60 dark:text-red-400/60 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/40 transition-all"
                aria-label={locale === 'zh' ? '关闭' : 'Dismiss'}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* Subtle gradient line at bottom */}
          <div className="h-px bg-gradient-to-r from-transparent via-red-400/30 to-transparent" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
