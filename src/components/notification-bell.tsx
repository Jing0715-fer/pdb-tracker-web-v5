'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Bell, BellOff, Check, Settings, Microscope, FlaskConical,
  BookOpen, Star, TrendingUp, X, Filter
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { useLocalStorageSet, useLocalStorage } from '@/hooks/use-local-storage';
import { useI18n } from '@/lib/i18n';

// ─── Types ──────────────────────────────────────────────────────────────────────

export type NotificationCategory =
  | 'new_structure'
  | 'evaluation'
  | 'literature'
  | 'high_impact'
  | 'report_published';

interface ActivityItem {
  id: string;
  type: 'new_structure' | 'new_paper' | 'new_evaluation' | 'report_published';
  title: string;
  description: string;
  timestamp: string;
  relatedId: string;
}

export type NotifFilterTab = 'all' | 'unread' | 'structures' | 'literature' | 'high_impact';

interface NotificationPreferences {
  showNewStructure: boolean;
  showEvaluation: boolean;
  showLiterature: boolean;
  showHighImpact: boolean;
  showReports: boolean;
}

const DEFAULT_PREFS: NotificationPreferences = {
  showNewStructure: true,
  showEvaluation: true,
  showLiterature: true,
  showHighImpact: true,
  showReports: true,
};

// ─── Category Config ────────────────────────────────────────────────────────

const buildCategoryConfig = (locale: 'en' | 'zh'): Record<NotificationCategory, {
  icon: React.ElementType;
  label: string;
  emoji: string;
  cssClass: string;
}> => ({
  new_structure: {
    icon: Microscope,
    label: locale === 'zh' ? '新结构' : 'New Structure',
    emoji: '🔬',
    cssClass: 'new_structure',
  },
  evaluation: {
    icon: FlaskConical,
    label: locale === 'zh' ? '评估' : 'Evaluation',
    emoji: '📊',
    cssClass: 'evaluation',
  },
  literature: {
    icon: BookOpen,
    label: locale === 'zh' ? '文献' : 'Literature',
    emoji: '📄',
    cssClass: 'literature',
  },
  high_impact: {
    icon: Star,
    label: locale === 'zh' ? '高影响力' : 'High Impact',
    emoji: '⭐',
    cssClass: 'high_impact',
  },
  report_published: {
    icon: TrendingUp,
    label: locale === 'zh' ? '报告' : 'Reports',
    emoji: '📄',
    cssClass: 'report_published',
  },
});

// ─── Filter Tabs ────────────────────────────────────────────────────────────

const buildFilterTabs = (locale: 'en' | 'zh'): { key: NotifFilterTab; label: string }[] => [
  { key: 'all', label: locale === 'zh' ? '全部' : 'All' },
  { key: 'unread', label: locale === 'zh' ? '未读' : 'Unread' },
  { key: 'structures', label: locale === 'zh' ? '结构' : 'Structures' },
  { key: 'literature', label: locale === 'zh' ? '文献' : 'Literature' },
  { key: 'high_impact', label: locale === 'zh' ? '高影响力' : 'High Impact' },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function getRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  const d = new Date(dateStr);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Map API activity type to notification category */
function activityToCategory(type: ActivityItem['type']): NotificationCategory {
  switch (type) {
    case 'new_structure':
      return 'new_structure';
    case 'new_evaluation':
      return 'evaluation';
    case 'new_paper':
      return 'literature';
    case 'report_published':
      return 'report_published';
    default:
      return 'new_structure';
  }
}

/** Check if an activity item should be flagged as high impact */
function isHighImpact(item: ActivityItem): boolean {
  const desc = item.description.toLowerCase();
  return (
    desc.includes('if ≥ 20') ||
    desc.includes('impact factor') ||
    desc.includes('high impact') ||
    desc.includes('notable') ||
    item.title.toLowerCase().includes('high impact') ||
    item.title.toLowerCase().includes('milestone') ||
    item.title.toLowerCase().includes('breakthrough')
  );
}

/** Get effective category for an item (considers high impact override) */
function getEffectiveCategory(item: ActivityItem): NotificationCategory {
  if (isHighImpact(item)) return 'high_impact';
  return activityToCategory(item.type);
}

// ─── Notification Bell Component ─────────────────────────────────────────────

export function NotificationBell() {
  const { locale } = useI18n();
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<NotifFilterTab>('all');
  const [showPrefs, setShowPrefs] = useState(false);
  const [bellWiggle, setBellWiggle] = useState(false);

  // Read state persisted in localStorage
  const [readItems, updateReadItems] = useLocalStorageSet('pdb-read-notifications');

  // Preferences persisted in localStorage
  const [prefs, setPrefs] = useLocalStorage<NotificationPreferences>(
    'pdb-notification-prefs',
    DEFAULT_PREFS,
  );

  // Fetch activity feed
  const fetchActivities = useCallback(async () => {
    try {
      const res = await fetch('/api/activity?limit=20');
      if (res.ok) {
        const data = await res.json();
        setActivities(data);
      }
    } catch (err) {
      console.error('Failed to fetch activity feed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial activity fetch — defer with setTimeout(0) so the setState call
  // inside fetchActivities happens outside the effect body (avoids the
  // react-hooks/set-state-in-effect cascading-render warning).
  // fetchActivities is a stable useCallback with [] deps, so identity never
  // changes and we can safely run this exactly once on mount.
  useEffect(() => {
    const handle = setTimeout(() => { fetchActivities(); }, 0);
    return () => clearTimeout(handle);
  }, []);

  // Trigger bell wiggle on new unread items — defer setState through
  // setTimeout(0) so the setBellWiggle calls run outside the effect body
  // (avoids react-hooks/set-state-in-effect cascading-render warning).
  useEffect(() => {
    const unreadCount = activities.filter(a => !readItems.has(a.id)).length;
    if (unreadCount === 0 || bellWiggle) return;
    const handle = setTimeout(() => {
      setBellWiggle(true);
      setTimeout(() => setBellWiggle(false), 1000);
    }, 0);
    return () => clearTimeout(handle);
  }, [activities, readItems, bellWiggle]);

  // Compute unread count (respecting preferences)
  const unreadCount = useMemo(() => {
    return activities.filter(a => {
      if (readItems.has(a.id)) return false;
      const cat = getEffectiveCategory(a);
      if (cat === 'high_impact' && !prefs.showHighImpact) return false;
      if (cat === 'new_structure' && !prefs.showNewStructure) return false;
      if (cat === 'evaluation' && !prefs.showEvaluation) return false;
      if (cat === 'literature' && !prefs.showLiterature) return false;
      if (cat === 'report_published' && !prefs.showReports) return false;
      return true;
    }).length;
  }, [activities, readItems, prefs]);

  // Filter activities based on active filter and preferences
  const filteredActivities = useMemo(() => {
    return activities.filter(item => {
      const cat = getEffectiveCategory(item);

      // Apply preference filters
      if (cat === 'high_impact' && !prefs.showHighImpact) return false;
      if (cat === 'new_structure' && !prefs.showNewStructure) return false;
      if (cat === 'evaluation' && !prefs.showEvaluation) return false;
      if (cat === 'literature' && !prefs.showLiterature) return false;
      if (cat === 'report_published' && !prefs.showReports) return false;

      // Apply tab filter
      switch (activeFilter) {
        case 'unread':
          return !readItems.has(item.id);
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
  }, [activities, activeFilter, prefs, readItems]);

  // Mark all as read
  const handleMarkAllRead = useCallback(() => {
    updateReadItems(prev => {
      const next = new Set(prev);
      for (const a of activities) {
        next.add(a.id);
      }
      return next;
    });
  }, [activities, updateReadItems]);

  // Mark single item as read on click
  const handleItemClick = useCallback((item: ActivityItem) => {
    updateReadItems(prev => {
      const next = new Set(prev);
      next.add(item.id);
      return next;
    });
  }, [updateReadItems]);

  // Reset filter when popover closes
  const handleOpenChange = useCallback((newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      setActiveFilter('all');
      setShowPrefs(false);
    }
  }, []);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-claude-text-muted hover:text-claude-text relative active:scale-95 transition-transform duration-100"
          aria-label={locale === 'zh' ? `通知${unreadCount > 0 ? ` (${unreadCount} 条未读)` : ''}` : `Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
          title={unreadCount > 0 ? (locale === 'zh' ? `${unreadCount} 条未读通知` : `${unreadCount} unread notifications`) : (locale === 'zh' ? '暂无新通知' : 'No new notifications')}
        >
          <div className={`relative ${bellWiggle ? 'notif-bell-wiggle' : ''}`}>
            <Bell className="h-3.5 w-3.5" />
          </div>
          {unreadCount > 0 && (
            <span className="notif-bell-pulse-dot flex items-center justify-center text-white text-[7px] font-bold leading-none px-[3px]">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[400px] p-0 bg-claude-surface dark:bg-[#242220] border-claude-border dark:border-[#3d3832] shadow-xl rounded-xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-claude-border dark:border-[#3d3832] bg-gradient-to-r from-[#faf7f4] to-[#f5f0ea] dark:from-[#242220] dark:to-[#2b2926]">
          <div className="flex items-center gap-2">
            <Bell className="h-3.5 w-3.5 text-claude-accent" />
            <span className="text-xs font-semibold text-claude-text">{locale === 'zh' ? '通知' : 'Notifications'}</span>
            {unreadCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-[#c96442] text-white text-[9px] font-bold px-1 notif-badge-pulse">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="inline-flex items-center gap-1 text-[10px] font-medium text-claude-accent dark:text-claude-accent-hover hover:underline"
              >
                <Check className="h-3 w-3" />
                {locale === 'zh' ? '全部标记已读' : 'Mark all read'}
              </button>
            )}
            <Separator orientation="vertical" className="h-4 mx-1" />
            <button
              onClick={() => setShowPrefs(!showPrefs)}
              className={`p-1 rounded-md transition-colors duration-150 ${
                showPrefs
                  ? 'bg-claude-accent-light dark:bg-claude-accent-light text-claude-accent'
                  : 'text-claude-text-muted hover:text-claude-text hover:bg-claude-border-light dark:hover:bg-[#2b2926]'
              }`}
              aria-label={locale === 'zh' ? '通知偏好设置' : 'Notification preferences'}
              title={locale === 'zh' ? '通知偏好设置' : 'Notification preferences'}
            >
              <Settings className={`h-3.5 w-3.5 ${showPrefs ? 'animate-spin' : ''}`} style={{ animationDuration: showPrefs ? '0.5s' : undefined }} />
            </button>
          </div>
        </div>

        {/* Preferences Panel (collapsible) */}
        {showPrefs && (
          <div className="px-4 py-3 border-b border-claude-border dark:border-[#3d3832] bg-claude-bg/50 dark:bg-[#1a1917]/50 notif-card-enter">
            <h3 className="text-[11px] font-semibold text-claude-text mb-2">{locale === 'zh' ? '通知偏好设置' : 'Notification Preferences'}</h3>
            <div className="notif-prefs-section">
              <NotifPrefToggle
                label={locale === 'zh' ? '新结构通知' : 'New structure notifications'}
                emoji="🔬"
                checked={prefs.showNewStructure}
                onChange={(v) => setPrefs(p => ({ ...p, showNewStructure: v }))}
              />
              <NotifPrefToggle
                label={locale === 'zh' ? '评估通知' : 'Evaluation notifications'}
                emoji="📊"
                checked={prefs.showEvaluation}
                onChange={(v) => setPrefs(p => ({ ...p, showEvaluation: v }))}
              />
              <NotifPrefToggle
                label={locale === 'zh' ? '文献通知' : 'Literature notifications'}
                emoji="📄"
                checked={prefs.showLiterature}
                onChange={(v) => setPrefs(p => ({ ...p, showLiterature: v }))}
              />
              <NotifPrefToggle
                label={locale === 'zh' ? '高影响力提醒' : 'High impact alerts'}
                emoji="⭐"
                checked={prefs.showHighImpact}
                onChange={(v) => setPrefs(p => ({ ...p, showHighImpact: v }))}
              />
              <NotifPrefToggle
                label={locale === 'zh' ? '报告通知' : 'Report notifications'}
                emoji="📄"
                checked={prefs.showReports}
                onChange={(v) => setPrefs(p => ({ ...p, showReports: v }))}
              />
            </div>
          </div>
        )}

        {/* Filter Tabs */}
        {activities.length > 0 && !showPrefs && (
          <div className="flex items-center gap-1 px-4 py-2 border-b border-claude-border dark:border-[#3d3832] overflow-x-auto scrollbar-hide">
            {buildFilterTabs(locale).map((tab) => (
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

        {/* Activity List */}
        <ScrollArea className="max-h-[420px]">
          {loading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3 animate-pulse">
                  <div className="h-8 w-8 rounded-lg bg-claude-border-light dark:bg-[#2b2926] flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-3/4 rounded bg-claude-border-light dark:bg-[#2b2926]" />
                    <div className="h-2.5 w-1/2 rounded bg-claude-border-light dark:bg-[#2b2926]" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredActivities.length === 0 ? (
            <EmptyNotifState
              hasFilter={activities.length > 0}
              filterKey={activeFilter}
            />
          ) : (
            <div className="py-1">
              {filteredActivities.map((item, idx) => {
                const category = getEffectiveCategory(item);
                const config = buildCategoryConfig(locale)[category];
                const Icon = config.icon;
                const isUnread = !readItems.has(item.id);

                return (
                  <div
                    key={item.id}
                    className={`notif-card-enhanced notif-cat-${config.cssClass} notif-card-enter w-full text-left px-4 py-2.5 flex items-start gap-3 cursor-pointer ${
                      isUnread ? 'unread' : ''
                    }`}
                    style={{ animationDelay: `${idx * 30}ms` }}
                    onClick={() => handleItemClick(item)}
                  >
                    {/* Category Icon */}
                    <div className={`notif-icon-${config.cssClass} flex-shrink-0 h-8 w-8 rounded-lg flex items-center justify-center`}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        {/* Unread dot */}
                        {isUnread && <span className="notif-unread-dot" />}
                        <p className={`text-[11px] leading-tight truncate ${
                          isUnread ? 'font-semibold text-claude-text' : 'font-medium text-claude-text-secondary'
                        }`}>
                          {item.title}
                        </p>
                      </div>
                      <p className="text-[10px] text-claude-text-muted leading-snug line-clamp-2">
                        {item.description}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {/* Category badge */}
                        <span className={`notif-cat-badge notif-cat-badge-${config.cssClass}`}>
                          {config.emoji} {config.label}
                        </span>
                        <span className="text-[9px] text-claude-text-muted">
                          {getRelativeTime(item.timestamp)}
                        </span>
                        <span className="text-[9px] font-mono text-claude-text-muted opacity-70">
                          {item.relatedId}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="border-t border-claude-border dark:border-[#3d3832] px-4 py-2 bg-claude-bg/50 dark:bg-[#1a1917]/50 flex items-center justify-between">
          <span className="text-[10px] text-claude-text-muted">
            {locale === 'zh'
              ? `${filteredActivities.length} / ${activities.length} 条通知`
              : `${filteredActivities.length} of ${activities.length} notification${activities.length !== 1 ? 's' : ''}`}
          </span>
          <button
            className="text-[10px] font-medium text-claude-accent dark:text-claude-accent-hover hover:underline"
            onClick={() => setOpen(false)}
          >
            {locale === 'zh' ? '查看全部活动 →' : 'View all activity →'}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Notification Preference Toggle ─────────────────────────────────────────

function NotifPrefToggle({
  label,
  emoji,
  checked,
  onChange,
}: {
  label: string;
  emoji: string;
  checked: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <div className="notif-prefs-item">
      <span className="text-[11px] text-claude-text-secondary flex items-center gap-1.5">
        <span className="text-xs">{emoji}</span>
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

// ─── Empty State ────────────────────────────────────────────────────────────

function EmptyNotifState({
  hasFilter,
  filterKey,
}: {
  hasFilter: boolean;
  filterKey: NotifFilterTab;
}) {
  const { locale } = useI18n();
  const filterLabelsEn: Record<NotifFilterTab, string> = {
    all: 'notifications',
    unread: 'unread notifications',
    structures: 'structure notifications',
    literature: 'literature notifications',
    high_impact: 'high impact alerts',
  };
  const filterLabelsZh: Record<NotifFilterTab, string> = {
    all: '通知',
    unread: '未读通知',
    structures: '结构通知',
    literature: '文献通知',
    high_impact: '高影响力提醒',
  };
  const filterLabels = locale === 'zh' ? filterLabelsZh : filterLabelsEn;

  return (
    <div className="flex flex-col items-center justify-center py-12 px-6">
      <div className="w-12 h-12 rounded-full bg-claude-border-light dark:bg-[#2b2926] flex items-center justify-center mb-3 animate-float">
        {hasFilter ? (
          <Filter className="h-5 w-5 text-claude-text-muted" />
        ) : (
          <BellOff className="h-5 w-5 text-claude-text-muted" />
        )}
      </div>
      <p className="text-xs font-medium text-claude-text mb-1">
        {hasFilter ? (locale === 'zh' ? `暂无${filterLabels[filterKey]}` : `No ${filterLabels[filterKey]}`) : (locale === 'zh' ? '已全部处理！' : 'All caught up!')}
      </p>
      <p className="text-[10px] text-claude-text-muted text-center">
        {hasFilter
          ? (locale === 'zh' ? '试试更改筛选条件以查看更多通知' : 'Try changing the filter to see more notifications')
          : (locale === 'zh' ? '暂无未处理通知。新更新将出现在这里。' : 'You have no pending notifications. New updates will appear here.')}
      </p>
    </div>
  );
}
