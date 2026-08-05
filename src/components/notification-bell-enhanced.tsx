'use client';

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell,
  X,
  Check,
  CheckCheck,
  Trash2,
  Microscope,
  BookOpen,
  Star,
  TrendingUp,
  FlaskConical,
  Clock,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * NotificationBellEnhanced
 *
 * An enhanced notification bell with a dropdown preview panel.
 * Shows recent notifications categorized by type with:
 *   - Unread count badge (animated pulse)
 *   - Category filter chips
 *   - Mark all as read button
 *   - Individual notification actions (read, dismiss, click)
 *   - Color-coded category icons
 *   - Relative timestamps
 *
 * Replaces the basic notification bell in the header.
 */

export type NotifType = 'new_structure' | 'evaluation' | 'literature' | 'high_impact' | 'weekly_summary' | 'system';

export interface NotifItem {
  id: string;
  type: NotifType;
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  pdbId?: string;
  actionUrl?: string;
}

interface NotifCategoryConfig {
  icon: typeof Microscope;
  color: string;
  gradient: string;
  label: string;
}

const CATEGORY_CONFIG: Record<NotifType, NotifCategoryConfig> = {
  new_structure: {
    icon: Microscope,
    color: '#2d8f8f',
    gradient: 'from-[#2d8f8f] to-[#1a6b6b]',
    label: 'New Structure',
  },
  evaluation: {
    icon: FlaskConical,
    color: '#7c5cbf',
    gradient: 'from-[#7c5cbf] to-[#5a3d99]',
    label: 'Evaluation',
  },
  literature: {
    icon: BookOpen,
    color: '#c9872e',
    gradient: 'from-[#c9872e] to-[#a06b1a]',
    label: 'Literature',
  },
  high_impact: {
    icon: Star,
    color: '#dc2626',
    gradient: 'from-[#dc2626] to-[#991b1b]',
    label: 'High Impact',
  },
  weekly_summary: {
    icon: TrendingUp,
    color: '#16a34a',
    gradient: 'from-[#16a34a] to-[#15803d]',
    label: 'Weekly Summary',
  },
  system: {
    icon: Bell,
    color: '#94a3b8',
    gradient: 'from-[#94a3b8] to-[#64748b]',
    label: 'System',
  },
};

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface NotificationBellEnhancedProps {
  notifications: NotifItem[];
  onMarkRead?: (id: string) => void;
  onMarkAllRead?: () => void;
  onDismiss?: (id: string) => void;
  onClick?: (notif: NotifItem) => void;
}

export function NotificationBellEnhanced({
  notifications,
  onMarkRead,
  onMarkAllRead,
  onDismiss,
  onClick,
}: NotificationBellEnhancedProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<NotifType | 'all' | 'unread'>('all');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  );

  const filtered = useMemo(() => {
    if (filter === 'all') return notifications;
    if (filter === 'unread') return notifications.filter((n) => !n.read);
    return notifications.filter((n) => n.type === filter);
  }, [notifications, filter]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  const filterChips: { value: typeof filter; label: string; count: number }[] = [
    { value: 'all', label: 'All', count: notifications.length },
    { value: 'unread', label: 'Unread', count: unreadCount },
    ...Object.entries(CATEGORY_CONFIG).map(([type, config]) => ({
      value: type as NotifType,
      label: config.label,
      count: notifications.filter((n) => n.type === type).length,
    })).filter((c) => c.count > 0),
  ];

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button */}
      <Button
        variant="ghost"
        size="sm"
        className="relative h-8 w-8 p-0"
        onClick={() => setOpen(!open)}
        title="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="badge-count-animated absolute -top-0.5 -right-0.5">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </Button>

      {/* Dropdown panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="glass-dropdown absolute right-0 top-full mt-2 w-96 max-w-[calc(100vw-2rem)] rounded-xl overflow-hidden z-50"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-claude-border/30 dark:border-[#3d3832]/30">
              <div className="flex items-center gap-1.5">
                <Bell className="h-3.5 w-3.5 text-claude-accent" />
                <span className="text-xs font-bold uppercase tracking-wider text-claude-text">
                  Notifications
                </span>
                {unreadCount > 0 && (
                  <Badge variant="secondary" className="text-[9px] h-4 px-1">
                    {unreadCount} unread
                  </Badge>
                )}
              </div>
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={onMarkAllRead}
                >
                  <CheckCheck className="h-3 w-3 mr-1" />
                  Mark all read
                </Button>
              )}
            </div>

            {/* Filter chips */}
            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-claude-border/20 dark:border-[#3d3832]/20 overflow-x-auto custom-scrollbar">
              {filterChips.map((chip) => (
                <button
                  key={chip.value}
                  onClick={() => setFilter(chip.value)}
                  className={cn(
                    'flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-medium whitespace-nowrap transition-all',
                    filter === chip.value
                      ? 'bg-claude-accent/15 text-claude-accent'
                      : 'text-claude-text-muted hover:bg-claude-border/30'
                  )}
                >
                  {chip.label}
                  <span className="tabular-nums opacity-60">{chip.count}</span>
                </button>
              ))}
            </div>

            {/* Notification list */}
            <div className="max-h-80 overflow-y-auto custom-scrollbar">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                  <Bell className="h-8 w-8 text-claude-text-muted opacity-30 mb-2" />
                  <p className="text-xs text-claude-text-muted">
                    {filter === 'unread' ? 'No unread notifications' : 'No notifications'}
                  </p>
                </div>
              ) : (
                filtered.slice(0, 20).map((notif, i) => {
                  const config = CATEGORY_CONFIG[notif.type];
                  const Icon = config.icon;
                  return (
                    <motion.div
                      key={notif.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.02 }}
                      className={cn(
                        'notification-item-enhanced group flex items-start gap-2 px-3 py-2 border-b border-claude-border/10 dark:border-[#3d3832]/10 cursor-pointer hover:bg-claude-border/20',
                        !notif.read && 'unread'
                      )}
                      style={{ ['--notif-color' as any]: config.color }}
                      onClick={() => {
                        if (!notif.read) onMarkRead?.(notif.id);
                        onClick?.(notif);
                      }}
                    >
                      {/* Category icon */}
                      <div
                        className={cn(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br shadow-sm',
                          config.gradient
                        )}
                      >
                        <Icon className="h-3.5 w-3.5 text-white" />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-[11px] font-semibold text-claude-text truncate">
                            {notif.title}
                          </span>
                          {!notif.read && (
                            <span className="w-1.5 h-1.5 rounded-full bg-claude-accent shrink-0" />
                          )}
                        </div>
                        <p className="text-[10px] text-claude-text-muted line-clamp-2 leading-relaxed">
                          {notif.message}
                        </p>
                        <div className="flex items-center gap-1 mt-1">
                          <Clock className="h-2.5 w-2.5 text-claude-text-muted" />
                          <span className="text-[9px] text-claude-text-muted">
                            {formatRelativeTime(notif.timestamp)}
                          </span>
                          {notif.pdbId && (
                            <span className="text-[9px] font-mono text-claude-accent ml-1">
                              {notif.pdbId}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {!notif.read && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onMarkRead?.(notif.id);
                            }}
                            className="paper-action-btn"
                            title="Mark as read"
                          >
                            <Check className="h-3 w-3 text-claude-text-muted" />
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDismiss?.(notif.id);
                          }}
                          className="paper-action-btn"
                          title="Dismiss"
                        >
                          <X className="h-3 w-3 text-claude-text-muted" />
                        </button>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-3 py-1.5 border-t border-claude-border/30 dark:border-[#3d3832]/30 bg-claude-surface/50 dark:bg-[#242220]/50">
              <span className="text-[9px] text-claude-text-muted">
                {notifications.length} total · {unreadCount} unread
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[9px] text-claude-accent hover:text-claude-accent-hover"
                onClick={() => setOpen(false)}
              >
                Close
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
