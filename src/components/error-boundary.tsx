'use client';

import React, { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useI18n, type LocaleId } from '@/lib/i18n';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /** Injected by the functional wrapper via useI18n. */
  locale?: LocaleId;
}

interface State {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
  isRetrying: boolean;
}

const MAX_RETRIES = 5;
const BASE_DELAY = 1500;

function isRecoverableError(error: Error): boolean {
  const msg = error.message || '';
  const name = error.name || '';
  // Only auto-retry for chunk-loading / module-loading errors (real HMR
  // glitches). Do NOT match generic "fetch" — that catches too many
  // unrelated errors (including SSE stream failures handled by useRunStream)
  // and causes spurious full-tree re-renders that feel like page refreshes.
  return (
    name === 'ChunkLoadError' ||
    msg.includes('Loading chunk') ||
    msg.includes('Failed to load chunk') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('dynamically imported module') ||
    msg.includes('Load failed') && msg.includes('chunk')
  );
}

/**
 * True ONLY when the error is a *static asset* / *chunk* failure — these
 * never recover by retrying the React tree, because the chunk hash is
 * baked into the HTML. The only fix is a full page reload. Network SSE
 * errors, transient API errors, etc. are NOT in this set (they recover
 * fine on their own or via normal refetch).
 */
function isChunkLoadError(error: Error): boolean {
  const name = error.name || '';
  const msg = error.message || '';
  return (
    name === 'ChunkLoadError' ||
    msg.includes('Loading chunk') ||
    msg.includes('Failed to load chunk') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('dynamically imported module') ||
    (msg.includes('Load failed') && msg.includes('chunk'))
  );
}

class ErrorBoundaryInner extends Component<Props, State> {
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, retryCount: 0, isRetrying: false };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error, isRetrying: false };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);

    // ChunkLoadError: the chunk hash in the served HTML doesn't match
    // what's on disk (typical after dev server recompiles mid-session
    // or after switching branches). Retrying the React tree can't
    // help because the chunk URL is fixed in the page's <script> tags
    // — only a full reload will re-fetch the new HTML and resolve the
    // new chunk paths. Auto-retry just delays the inevitable and shows
    // a confusing "Auto-retrying... (attempt N)" UI for ~20 seconds.
    // For non-chunk errors we still do the normal backoff retry.
    if (isChunkLoadError(error)) {
      const reloadDelay = 500; // tiny pause so user sees the message
      this.setState({ isRetrying: true });
      this.retryTimer = setTimeout(() => {
        window.location.reload();
      }, reloadDelay);
      return;
    }

    // Auto-retry for recoverable errors (network/chunk load issues)
    if (isRecoverableError(error) && this.state.retryCount < MAX_RETRIES) {
      const delay = BASE_DELAY * Math.pow(1.5, this.state.retryCount);
      this.setState({ isRetrying: true });
      this.retryTimer = setTimeout(() => {
        this.setState(prev => ({ hasError: false, retryCount: prev.retryCount + 1, isRetrying: false }));
      }, delay);
    }
  }

  componentWillUnmount() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, retryCount: 0, isRetrying: false });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const locale = this.props.locale || 'en';
      const zh = locale === 'zh';
      const isRecoverable = this.state.error ? isRecoverableError(this.state.error) : false;
      const canRetry = this.state.retryCount < MAX_RETRIES;
      const isAutoRetrying = this.state.isRetrying;

      return (
        <div className="flex items-center justify-center min-h-screen bg-claude-bg p-6">
          <div className="max-w-md w-full p-6 border-2 border-red-300 dark:border-red-800 rounded-xl bg-red-50 dark:bg-red-950/30 shadow-lg">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="h-6 w-6 text-red-500" />
              <h2 className="text-lg font-semibold text-red-700 dark:text-red-400">
                {isRecoverable
                  ? (zh ? '资源加载失败' : 'Resource failed to load')
                  : (zh ? '出错了' : 'Something went wrong')}
              </h2>
            </div>
            <p className="text-red-800 dark:text-red-300 mb-4">
              {isRecoverable
                ? (zh
                    ? '部分资源加载失败，可能是网络波动或服务器暂时不可用。请尝试重试。'
                    : (zh ? '部分资源加载失败，可能是网络波动或服务器暂时不可用。请重试。' : 'Some resources failed to load, possibly due to a network blip or a temporarily unavailable server. Please retry.'))
                : (zh ? '加载失败，请刷新页面重试。' : 'Loading failed. Please refresh the page and try again.')}
            </p>
            {isAutoRetrying && (
              <div className="flex items-center gap-2 mb-4 text-sm text-amber-700 dark:text-amber-400">
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span>
                  {zh
                    ? `正在自动重试... (第 ${this.state.retryCount + 1} 次)`
                    : `Auto-retrying... (attempt ${this.state.retryCount + 1})`}
                </span>
              </div>
            )}
            {this.state.retryCount > 0 && !isAutoRetrying && (
              <p className="text-sm text-red-600 dark:text-red-400 mb-3">
                {zh ? `已自动重试 ${this.state.retryCount} 次` : `Auto-retried ${this.state.retryCount} time(s)`}
              </p>
            )}
            <details className="mb-4">
              <summary className="cursor-pointer text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300">
                {zh ? '错误详情' : 'Error details'}
              </summary>
              <p className="mt-2 text-xs text-red-700 dark:text-red-300 break-all">
                {this.state.error?.message}
              </p>
            </details>
            <div className="flex gap-3">
              {canRetry && !isAutoRetrying && (
                <button
                  onClick={this.handleRetry}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                >
                  <RefreshCw className="h-4 w-4" />
                  {zh ? '重试' : 'Retry'}
                </button>
              )}
              <button
                onClick={this.handleReload}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 rounded-lg transition-colors"
              >
                {zh ? '刷新页面' : 'Reload page'}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/** Functional wrapper that injects the current i18n locale into the class-based boundary. */
export function ErrorBoundary(props: Omit<Props, 'locale'>) {
  const { locale } = useI18n();
  return <ErrorBoundaryInner {...props} locale={locale} />;
}
