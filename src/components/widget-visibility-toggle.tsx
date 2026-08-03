'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, Settings2, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

/**
 * WidgetVisibilityToggle
 *
 * A dropdown button that lets users toggle which dashboard widgets are visible.
 * Widget visibility is persisted to localStorage.
 *
 * Usage:
 *   <WidgetVisibilityToggle
 *     storageKey="weekly-widget-visibility"
 *     widgets={[
 *       { id: 'quality-score', label: 'Quality Score' },
 *       { id: 'method-distribution', label: 'Method Distribution' },
 *     ]}
 *     visibleIds={visibleWidgetIds}
 *     onToggle={(id) => toggleWidget(id)}
 *   />
 */

interface WidgetConfig {
  id: string;
  label: string;
}

interface WidgetVisibilityToggleProps {
  widgets: WidgetConfig[];
  visibleIds: Set<string>;
  onToggle: (id: string) => void;
}

export function WidgetVisibilityToggle({ widgets, visibleIds, onToggle }: WidgetVisibilityToggleProps) {
  const { locale } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const hiddenCount = widgets.length - visibleIds.size;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium transition-all ${
          hiddenCount > 0
            ? 'bg-claude-accent/15 text-claude-accent border border-claude-accent/30'
            : 'text-claude-text-muted hover:text-claude-text hover:bg-claude-border-light dark:hover:bg-[#2b2926]'
        }`}
        title={locale === 'zh' ? '小部件可见性' : 'Widget visibility'}
        aria-label={locale === 'zh' ? '切换小部件可见性' : 'Toggle widget visibility'}
      >
        <Settings2 className="h-3 w-3" />
        {hiddenCount > 0 && (
          <span className="text-[9px] font-bold bg-claude-accent/20 text-claude-accent rounded-full px-1">
            {hiddenCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.96 }}
            transition={{ duration: 0.12 }}
            className="glass-dropdown absolute right-0 top-full mt-1 w-44 rounded-lg overflow-hidden z-50 shadow-lg border border-claude-border dark:border-[#3d3832]"
          >
            <div className="px-2 py-1.5 text-[9px] font-bold uppercase tracking-wider text-claude-text-muted border-b border-claude-border/30 dark:border-[#3d3832]/30">
              {locale === 'zh' ? '小部件可见性' : 'Widget Visibility'}
            </div>
            <div className="py-1">
              {widgets.map(widget => {
                const isVisible = visibleIds.has(widget.id);
                return (
                  <button
                    key={widget.id}
                    onClick={() => onToggle(widget.id)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926] transition-colors"
                  >
                    {isVisible ? (
                      <Eye className="h-3 w-3 text-claude-accent shrink-0" />
                    ) : (
                      <EyeOff className="h-3 w-3 text-claude-text-muted shrink-0" />
                    )}
                    <span className={`flex-1 text-left ${isVisible ? '' : 'line-through opacity-50'}`}>
                      {widget.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
