'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  X, Bell, BellOff, Check, CheckCheck, Trash2, Filter, Settings,
  Microscope, BookOpen, Star, TrendingUp, FlaskConical, Clock
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { useLocalStorageSet, useLocalStorage } from '@/hooks/use-local-storage';
import { useI18n } from '@/lib/i18n';

// ─── Types ─────────────────────────────────────────────────────────────────

export type NotificationCategory =
  | 'new_structure'
  | 'evaluation'
  | 'literature'
  | 'high_impact'
  | 'weekly_summary';

export interface Notification {
  id: string;
  type: 'new_structure' | 'weekly_update' | 'comparison_ready' | 'bookmark_added' | 'system' | 'achievement';
  category?: NotificationCategory;
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  pdbId?: string;
  weekId?: string;
  actionUrl?: string;
  actionLabel?: string;
  isHighImpact?: boolean;
}

export type NotificationFilter = 'all' | 'unread' | 'structures' | 'literature' | 'high_impact';

interface NotificationPreferences {
  showNewStructure: boolean;
  showEvaluation: boolean;
  showLiterature: boolean;
  showHighImpact: boolean;
  showWeeklySummary: boolean;
}

const DEFAULT_PREFS: NotificationPreferences = {
  showNewStructure: true,
  showEvaluation: true,
  showLiterature: true,
  showHighImpact: true,
  showWeeklySummary: true,
};

interface NotificationPanelProps {
  open: boolean;
  onClose: () => void;
  onMarkAllRead: () => void;
  onClearAll: () => void;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
  notifications?: Notification[];
}

// ─── Category Config ──────────────────────────────────────────────────────

const buildCategoryConfig = (locale: 'en' | 'zh'): Record<NotificationCategory, {
  icon: React.ElementType;
  label: string;
  cssClass: string;
}> => ({
  new_structure: {
    icon: Microscope,
    label: locale === 'zh' ? '新结构' : 'New Structure',
    cssClass: 'new_structure',
  },
  evaluation: {
    icon: FlaskConical,
    label: locale === 'zh' ? '评估' : 'Evaluation',
    cssClass: 'evaluation',
  },
  literature: {
    icon: BookOpen,
    label: locale === 'zh' ? '文献' : 'Literature',
    cssClass: 'literature',
  },
  high_impact: {
    icon: Star,
    label: locale === 'zh' ? '高影响力' : 'High Impact',
    cssClass: 'high_impact',
  },
  weekly_summary: {
    icon: TrendingUp,
    label: locale === 'zh' ? '周报' : 'Weekly Summary',
    cssClass: 'weekly_summary',
  },
});

// ─── Map notification type to category ────────────────────────────────────

function notificationToCategory(notif: Notification): NotificationCategory {
  if (notif.isHighImpact) return 'high_impact';
  if (notif.category) return notif.category;

  switch (notif.type) {
    case 'new_structure':
      return 'new_structure';
    case 'comparison_ready':
      return 'evaluation';
    case 'bookmark_added':
      return 'new_structure';
    case 'weekly_update':
      return 'weekly_summary';
    case 'system':
      return 'weekly_summary';
    case 'achievement':
      return 'high_impact';
    default:
      return 'new_structure';
  }
}

// ─── Relative Time Helper ──────────────────────────────────────────────────

export function formatRelativeTime(date: Date, locale: 'en' | 'zh' = 'en'): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return locale === 'zh' ? '刚刚' : 'Just now';
  if (diffMins < 60) return locale === 'zh' ? `${diffMins} 分钟前` : `${diffMins}m ago`;
  if (diffHours < 24) return locale === 'zh' ? `${diffHours} 小时前` : `${diffHours}h ago`;
  if (diffDays < 7) return locale === 'zh' ? `${diffDays} 天前` : `${diffDays}d ago`;
  return date.toLocaleDateString(locale === 'zh' ? 'zh-CN' : undefined);
}

// ─── Filter Tabs ───────────────────────────────────────────────────────────

const buildFilterTabs = (locale: 'en' | 'zh'): { key: NotificationFilter; label: string }[] => [
  { key: 'all', label: locale === 'zh' ? '全部' : 'All' },
  { key: 'unread', label: locale === 'zh' ? '未读' : 'Unread' },
  { key: 'structures', label: locale === 'zh' ? '结构' : 'Structures' },
  { key: 'literature', label: locale === 'zh' ? '文献' : 'Literature' },
  { key: 'high_impact', label: locale === 'zh' ? '高影响力' : 'High Impact' },
];

// ─── NotificationPanel Component ───────────────────────────────────────────

export function NotificationPanel({
  open,
  onClose,
  onMarkAllRead,
  onClearAll,
  onMarkRead,
  onDismiss,
  notifications: externalNotifications,
}: NotificationPanelProps) {
  const { locale } = useI18n();
  const { notifications, setNotifications } = useSampleNotifications();
  const [activeFilter, setActiveFilter] = useState<NotificationFilter>('all');
  const [showPrefs, setShowPrefs] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Preferences persisted in localStorage
  const [prefs, setPrefs] = useLocalStorage<NotificationPreferences>(
    'pdb-notification-prefs',
    DEFAULT_PREFS,
  );

  // Use external notifications if provided, otherwise use sample data
  const effectiveNotifications = externalNotifications ?? notifications;

  const unreadCount = useMemo(
    () => effectiveNotifications.filter((n) => !n.read).length,
    [effectiveNotifications],
  );

  // Apply filter and preferences
  const filteredNotifications = useMemo(() => {
    return effectiveNotifications.filter(n => {
      const cat = notificationToCategory(n);

      // Apply preference filters
      if (cat === 'high_impact' && !prefs.showHighImpact) return false;
      if (cat === 'new_structure' && !prefs.showNewStructure) return false;
      if (cat === 'evaluation' && !prefs.showEvaluation) return false;
      if (cat === 'literature' && !prefs.showLiterature) return false;
      if (cat === 'weekly_summary' && !prefs.showWeeklySummary) return false;

      switch (activeFilter) {
        case 'unread':
          return !n.read;
        case 'structures':
          return cat === 'new_structure';
        case 'literature':
          return cat === 'literature';
        case 'high_impact':
          return cat === 'high_impact';
        default:
          return true;
      }
    });
  }, [effectiveNotifications, activeFilter, prefs]);

  // Handle close with animation
  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      setActiveFilter('all');
      setShowPrefs(false);
      onClose();
    }, 200);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, handleClose]);

  // Mark all read handler
  const handleMarkAllRead = () => {
    if (externalNotifications) {
      onMarkAllRead();
    } else {
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      onMarkAllRead();
    }
  };

  // Clear all handler
  const handleClearAll = () => {
    if (externalNotifications) {
      onClearAll();
    } else {
      setNotifications([]);
      onClearAll();
    }
  };

  // Mark single read
  const handleMarkRead = (id: string) => {
    if (externalNotifications) {
      onMarkRead(id);
    } else {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
      );
      onMarkRead(id);
    }
  };

  // Dismiss single
  const handleDismiss = (id: string) => {
    if (externalNotifications) {
      onDismiss(id);
    } else {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      onDismiss(id);
    }
  };

  if (!open && !isClosing) return null;

  const CATEGORY_CONFIG = buildCategoryConfig(locale);
  const FILTER_TABS = buildFilterTabs(locale);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/20 z-40 ${isClosing ? 'notif-backdrop-exit' : 'notif-backdrop-enter'}`}
        onClick={handleClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={`notification-panel glass-card fixed right-0 top-0 bottom-0 w-full sm:w-[400px] z-50 flex flex-col ${isClosing ? 'notif-panel-exit' : 'notif-panel-enter'}`}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e8e4dd] dark:border-[#3d3832]">
          <div className="flex items-center gap-2.5">
            <Bell className="h-4 w-4 text-[#c96442] dark:text-[#d4784f]" />
            <h2 className="text-sm font-semibold text-[#1a1a1a] dark:text-[#e8e4dd]">
              {locale === 'zh' ? '通知' : 'Notifications'}
            </h2>
            {unreadCount > 0 && (
              <span className="notif-badge-pulse inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[#c96442] dark:bg-[#d4784f] text-[10px] font-bold text-white">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* Settings button */}
            <button
              onClick={() => setShowPrefs(!showPrefs)}
              className={`p-1.5 rounded-md transition-colors duration-150 ${
                showPrefs
                  ? 'bg-[#fdf0eb] dark:bg-[#3d2a22] text-[#c96442] dark:text-[#d4784f]'
                  : 'text-[#9b9590] hover:text-[#1a1a1a] dark:hover:text-[#e8e4dd] hover:bg-[#f5f0ea] dark:hover:bg-[#2b2926]'
              }`}
              aria-label={locale === 'zh' ? '通知偏好设置' : 'Notification preferences'}
              title={locale === 'zh' ? '通知偏好设置' : 'Notification preferences'}
            >
              <Settings className={`h-3.5 w-3.5 ${showPrefs ? 'animate-spin' : ''}`} style={{ animationDuration: showPrefs ? '0.5s' : undefined }} />
            </button>

            {effectiveNotifications.length > 0 && (
              <>
                <Separator orientation="vertical" className="h-4 mx-0.5" />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleMarkAllRead}
                  className="h-7 px-2 text-[11px] text-[#6b6560] dark:text-[#9b9590] hover:text-[#1a1a1a] dark:hover:text-[#e8e4dd] hover:bg-[#f5f0ea] dark:hover:bg-[#2b2926]"
                  title={locale === 'zh' ? '全部标记已读' : 'Mark all as read'}
                >
                  <CheckCheck className="h-3.5 w-3.5 mr-1" />
                  {locale === 'zh' ? '全部标记已读' : 'Mark all read'}
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              className="h-7 w-7 text-[#9b9590] hover:text-[#1a1a1a] dark:hover:text-[#e8e4dd] hover:bg-[#f5f0ea] dark:hover:bg-[#2b2926]"
              aria-label={locale === 'zh' ? '关闭通知' : 'Close notifications'}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* ── Preferences Panel (collapsible) ── */}
        {showPrefs && (
          <div className="px-5 py-3 border-b border-[#e8e4dd] dark:border-[#3d3832] bg-[#faf7f4]/50 dark:bg-[#1a1917]/50 notif-card-enter">
            <h3 className="text-[11px] font-semibold text-[#1a1a1a] dark:text-[#e8e4dd] mb-2">{locale === 'zh' ? '通知偏好设置' : 'Notification Preferences'}</h3>
            <div className="notif-prefs-section">
              <PanelPrefToggle
                label={locale === 'zh' ? '新结构通知' : 'New structure notifications'}
                icon={Microscope}
                checked={prefs.showNewStructure}
                onChange={(v) => setPrefs(p => ({ ...p, showNewStructure: v }))}
              />
              <PanelPrefToggle
                label={locale === 'zh' ? '评估通知' : 'Evaluation notifications'}
                icon={FlaskConical}
                checked={prefs.showEvaluation}
                onChange={(v) => setPrefs(p => ({ ...p, showEvaluation: v }))}
              />
              <PanelPrefToggle
                label={locale === 'zh' ? '文献通知' : 'Literature notifications'}
                icon={BookOpen}
                checked={prefs.showLiterature}
                onChange={(v) => setPrefs(p => ({ ...p, showLiterature: v }))}
              />
              <PanelPrefToggle
                label={locale === 'zh' ? '高影响力提醒' : 'High impact alerts'}
                icon={Star}
                checked={prefs.showHighImpact}
                onChange={(v) => setPrefs(p => ({ ...p, showHighImpact: v }))}
              />
              <PanelPrefToggle
                label={locale === 'zh' ? '周报' : 'Weekly summary'}
                icon={TrendingUp}
                checked={prefs.showWeeklySummary}
                onChange={(v) => setPrefs(p => ({ ...p, showWeeklySummary: v }))}
              />
            </div>
          </div>
        )}

        {/* ── Filter Tabs ── */}
        {effectiveNotifications.length > 0 && !showPrefs && (
          <div className="flex items-center gap-1 px-5 py-3 border-b border-[#e8e4dd] dark:border-[#3d3832] overflow-x-auto scrollbar-hide">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveFilter(tab.key)}
                className={`notif-filter-pill whitespace-nowrap ${activeFilter === tab.key ? 'active' : ''}`}
              >
                {tab.label}
                {tab.key === 'unread' && unreadCount > 0 && (
                  <span className="ml-1 text-[9px] opacity-70">({unreadCount})</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* ── Notification List ── */}
        <ScrollArea className="flex-1">
          <div className="py-1">
            {filteredNotifications.length === 0 ? (
              <PanelEmptyState
                hasFilter={effectiveNotifications.length > 0}
                filterKey={activeFilter}
              />
            ) : (
              filteredNotifications.map((notif, index) => (
                <PanelNotificationCard
                  key={notif.id}
                  notification={notif}
                  index={index}
                  onMarkRead={handleMarkRead}
                  onDismiss={handleDismiss}
                />
              ))
            )}
          </div>
        </ScrollArea>

        {/* ── Footer ── */}
        {effectiveNotifications.length > 0 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-[#e8e4dd] dark:border-[#3d3832]">
            <span className="text-[11px] text-[#9b9590]">
              {locale === 'zh'
                ? `${filteredNotifications.length} / ${effectiveNotifications.length} 条通知`
                : `${filteredNotifications.length} of ${effectiveNotifications.length} notification${effectiveNotifications.length !== 1 ? 's' : ''}`}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearAll}
              className="h-7 px-2 text-[11px] text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              <Trash2 className="h-3 w-3 mr-1" />
              {locale === 'zh' ? '清除全部' : 'Clear all'}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Notification Card ─────────────────────────────────────────────────────

function PanelNotificationCard({
  notification,
  index,
  onMarkRead,
  onDismiss,
}: {
  notification: Notification;
  index: number;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const { locale } = useI18n();
  const CATEGORY_CONFIG = buildCategoryConfig(locale);
  const category = notificationToCategory(notification);
  const config = CATEGORY_CONFIG[category];
  const Icon = config.icon;

  return (
    <div
      className={`notif-card-enhanced notif-cat-${config.cssClass} notif-card-enter relative flex items-start gap-3 px-5 py-3.5 cursor-pointer ${
        !notification.read ? 'unread' : ''
      }`}
      style={{ animationDelay: `${index * 30}ms` }}
      onClick={() => {
        if (!notification.read) onMarkRead(notification.id);
      }}
    >
      {/* Category icon */}
      <div
        className={`notif-icon-${config.cssClass} flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-lg`}
      >
        <Icon className="h-4 w-4" />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <h4 className={`text-[13px] truncate ${
            !notification.read ? 'font-semibold text-[#1a1a1a] dark:text-[#e8e4dd]' : 'font-medium text-[#6b6560] dark:text-[#9b9590]'
          }`}>
            {notification.title}
          </h4>
          {!notification.read && (
            <span className="notif-unread-dot flex-shrink-0" />
          )}
        </div>
        <p className="text-[12px] text-[#6b6560] dark:text-[#9b9590] leading-relaxed line-clamp-2">
          {notification.message}
        </p>
        <div className="flex items-center gap-2 mt-1.5">
          {/* Category badge */}
          <span className={`notif-cat-badge notif-cat-badge-${config.cssClass}`}>
            {config.label}
          </span>
          <Clock className="h-3 w-3 text-[#9b9590]" />
          <span className="text-[10px] text-[#9b9590]">
            {formatRelativeTime(notification.timestamp, locale)}
          </span>
          {notification.actionUrl && (
            <a
              href={notification.actionUrl}
              onClick={(e) => e.stopPropagation()}
              className="text-[10px] font-medium text-[#c96442] dark:text-[#d4784f] hover:underline ml-auto"
            >
              {notification.actionLabel || (locale === 'zh' ? '查看' : 'View')}
            </a>
          )}
        </div>
      </div>

      {/* Dismiss button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(notification.id);
        }}
        className="dismiss-btn flex-shrink-0 p-1 rounded-md hover:bg-[#f5f0ea] dark:hover:bg-[#2b2926] transition-colors"
        aria-label={locale === 'zh' ? '关闭通知' : 'Dismiss notification'}
      >
        <X className="h-3.5 w-3.5 text-[#9b9590]" />
      </button>
    </div>
  );
}

// ─── Preference Toggle ─────────────────────────────────────────────────────

function PanelPrefToggle({
  label,
  icon: Icon,
  checked,
  onChange,
}: {
  label: string;
  icon: React.ElementType;
  checked: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <div className="notif-prefs-item">
      <span className="text-[11px] text-[#6b6560] dark:text-[#9b9590] flex items-center gap-1.5">
        <Icon className="h-3 w-3 text-[#9b9590]" aria-hidden="true" />
        {label}
      </span>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        className="scale-75 origin-right"
      />
    </div>
  );
}

// ─── Empty State ───────────────────────────────────────────────────────────

function PanelEmptyState({
  hasFilter,
  filterKey,
}: {
  hasFilter: boolean;
  filterKey: NotificationFilter;
}) {
  const { locale } = useI18n();
  const filterLabelsEn: Record<NotificationFilter, string> = {
    all: 'notifications',
    unread: 'unread notifications',
    structures: 'structure notifications',
    literature: 'literature notifications',
    high_impact: 'high impact alerts',
  };
  const filterLabelsZh: Record<NotificationFilter, string> = {
    all: '通知',
    unread: '未读通知',
    structures: '结构通知',
    literature: '文献通知',
    high_impact: '高影响力提醒',
  };
  const filterLabels = locale === 'zh' ? filterLabelsZh : filterLabelsEn;

  return (
    <div className="flex flex-col items-center justify-center py-16 px-6">
      {hasFilter ? (
        <>
          <div className="w-14 h-14 rounded-full bg-[#f5f0ea] dark:bg-[#2b2926] flex items-center justify-center mb-4 animate-float">
            <Filter className="h-6 w-6 text-[#9b9590]" />
          </div>
          <p className="text-sm font-medium text-[#1a1a1a] dark:text-[#e8e4dd] mb-1">
            {locale === 'zh' ? `暂无${filterLabels[filterKey]}` : `No ${filterLabels[filterKey]}`}
          </p>
          <p className="text-[12px] text-[#9b9590] text-center">
            {locale === 'zh' ? '试试更改筛选条件以查看更多通知' : 'Try changing the filter to see more notifications'}
          </p>
        </>
      ) : (
        <>
          <div className="w-14 h-14 rounded-full bg-[#f5f0ea] dark:bg-[#2b2926] flex items-center justify-center mb-4 animate-float">
            <BellOff className="h-6 w-6 text-[#9b9590]" />
          </div>
          <p className="text-sm font-medium text-[#1a1a1a] dark:text-[#e8e4dd] mb-1">
            {locale === 'zh' ? '已全部处理！' : 'All caught up!'}
          </p>
          <p className="text-[12px] text-[#9b9590] text-center">
            {locale === 'zh' ? '暂无未处理通知。新更新将出现在这里。' : 'You have no pending notifications. New updates will appear here.'}
          </p>
        </>
      )}
    </div>
  );
}

// ─── useSampleNotifications Hook ──────────────────────────────────────────

export function useSampleNotifications() {
  const { locale } = useI18n();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const timer = setTimeout(() => setNotifications(generateSampleNotifications(locale)), 0);
    return () => clearTimeout(timer);
  }, [locale]);

  return { notifications, setNotifications };
}

function generateSampleNotifications(locale: 'en' | 'zh' = 'en'): Notification[] {
  const now = new Date();
  const zh = locale === 'zh';
  const t = (en: string, cn: string) => (zh ? cn : en);

  return [
    {
      id: 'sample-1',
      type: 'new_structure',
      category: 'new_structure',
      title: t('New Structure: 8XYZ', '新结构：8XYZ'),
      message: t(
        'A new Cryo-EM structure of SARS-CoV-2 spike protein has been released with 2.1Å resolution.',
        '一个 SARS-CoV-2 刺突蛋白的冷冻电镜结构已发布，分辨率为 2.1Å。',
      ),
      timestamp: new Date(now.getTime() - 2 * 60000),
      read: false,
      pdbId: '8XYZ',
      actionUrl: '#',
      actionLabel: t('View structure', '查看结构'),
    },
    {
      id: 'sample-2',
      type: 'new_structure',
      category: 'new_structure',
      title: t('New Structure: 9ABC', '新结构：9ABC'),
      message: t(
        'X-ray crystallography structure of human DNA polymerase delta resolved at 1.8Å.',
        '人源 DNA 聚合酶 δ 的 X 射线晶体结构已解析，分辨率为 1.8Å。',
      ),
      timestamp: new Date(now.getTime() - 15 * 60000),
      read: false,
      pdbId: '9ABC',
      actionUrl: '#',
      actionLabel: t('View structure', '查看结构'),
    },
    {
      id: 'sample-3',
      type: 'weekly_update',
      category: 'weekly_summary',
      title: t('Weekly Summary Available', '周报已生成'),
      message: t(
        'Week 2025-W12: 47 new structures released — 23 Cryo-EM, 19 X-ray, 5 NMR.',
        '2025-W12 周：新增 47 个结构 — 23 个冷冻电镜、19 个 X 射线、5 个 NMR。',
      ),
      timestamp: new Date(now.getTime() - 2 * 3600000),
      read: false,
      weekId: '2025-W12',
      actionUrl: '#',
      actionLabel: t('View summary', '查看周报'),
    },
    {
      id: 'sample-4',
      type: 'weekly_update',
      category: 'weekly_summary',
      title: t('Weekly Summary Available', '周报已生成'),
      message: t(
        'Week 2025-W11: 52 new structures released — 28 Cryo-EM, 18 X-ray, 6 NMR.',
        '2025-W11 周：新增 52 个结构 — 28 个冷冻电镜、18 个 X 射线、6 个 NMR。',
      ),
      timestamp: new Date(now.getTime() - 26 * 3600000),
      read: true,
      weekId: '2025-W11',
    },
    {
      id: 'sample-5',
      type: 'comparison_ready',
      category: 'evaluation',
      title: t('Comparison Report Ready', '比较报告已就绪'),
      message: t(
        'Your comparison of 8XYZ vs 7ABC has been generated. 12 structural differences found.',
        '8XYZ 与 7ABC 的比较报告已生成，共发现 12 处结构差异。',
      ),
      timestamp: new Date(now.getTime() - 45 * 60000),
      read: false,
      actionUrl: '#',
      actionLabel: t('View comparison', '查看比较'),
    },
    {
      id: 'sample-6',
      type: 'bookmark_added',
      category: 'new_structure',
      title: t('Bookmark Added', '已加入收藏'),
      message: t(
        'Structure 7K3M (Ribosome assembly factor) has been added to your bookmarks.',
        '结构 7K3M（核糖体组装因子）已加入您的收藏。',
      ),
      timestamp: new Date(now.getTime() - 5 * 3600000),
      read: true,
      pdbId: '7K3M',
    },
    {
      id: 'sample-7',
      type: 'system',
      category: 'weekly_summary',
      title: t('System Update', '系统更新'),
      message: t(
        'New filtering options are now available. You can filter structures by ligand count and experimental method.',
        '新的筛选选项已上线，您可按配体数量与实验方法筛选结构。',
      ),
      timestamp: new Date(now.getTime() - 24 * 3600000),
      read: true,
    },
    {
      id: 'sample-8',
      type: 'achievement',
      category: 'high_impact',
      title: t('High Impact: Breakthrough Structure', '高影响力：突破性结构'),
      message: t(
        'A landmark structure with IF ≥ 20 has been published in Nature. This could transform drug discovery approaches.',
        '一项 IF ≥ 20 的标志性结构已在 Nature 发表，可能改变药物发现策略。',
      ),
      timestamp: new Date(now.getTime() - 30 * 60000),
      read: false,
      isHighImpact: true,
      actionUrl: '#',
      actionLabel: t('View paper', '查看论文'),
    },
    {
      id: 'sample-9',
      type: 'achievement',
      category: 'high_impact',
      title: t('Collection Milestone', '收藏集里程碑'),
      message: t(
        'Your "Cryo-EM Favorites" collection now has 25 structures. Consider exporting your findings.',
        '您的「冷冻电镜收藏」已收录 25 个结构，建议导出您的研究成果。',
      ),
      timestamp: new Date(now.getTime() - 3 * 3600000),
      read: false,
    },
    {
      id: 'sample-10',
      type: 'new_structure',
      category: 'literature',
      title: t('New Paper: AlphaFold3 Analysis', '新论文：AlphaFold3 分析'),
      message: t(
        'A new paper analyzing AlphaFold3 predictions vs experimental structures has been published in Science (IF: 44.7).',
        '一篇对比 AlphaFold3 预测与实验结构的论文已在 Science 发表（IF: 44.7）。',
      ),
      timestamp: new Date(now.getTime() - 48 * 3600000),
      read: true,
      isHighImpact: true,
      actionUrl: '#',
      actionLabel: t('Read paper', '阅读论文'),
    },
  ];
}
