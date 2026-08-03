'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Keyboard, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

/**
 * ShortcutHintBar
 *
 * A compact, dismissible bar at the bottom of the screen showing
 * the most commonly used keyboard shortcuts as visual kbd badges.
 *
 * Only shows on desktop (hidden on mobile).
 * Dismiss state persisted to localStorage.
 */

const SHORTCUTS = [
  { keys: ['⌘', 'K'], label: 'Command' },
  { keys: ['1'], label: 'Weekly' },
  { keys: ['2'], label: 'Eval' },
  { keys: ['3'], label: 'Lit' },
  { keys: ['4'], label: 'Analysis' },
  { keys: ['J'], label: '↓ Row' },
  { keys: ['K'], label: '↑ Row' },
  { keys: ['/'], label: 'Search' },
  { keys: ['?'], label: 'Help' },
];

const STORAGE_KEY = 'pdb-shortcut-bar-dismissed';

export function ShortcutHintBar() {
  const { locale } = useI18n();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    try {
      const dismissed = localStorage.getItem(STORAGE_KEY);
      if (!dismissed) {
        timer = setTimeout(() => setVisible(true), 2000);
      }
    } catch {
      timer = setTimeout(() => setVisible(true), 2000);
    }
    return () => { if (timer) clearTimeout(timer); };
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // ignore
    }
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.2 }}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 hidden md:flex items-center gap-3 px-4 py-2 rounded-full bg-claude-surface dark:bg-[#242220] border border-claude-border dark:border-[#3d3832] shadow-lg"
        >
          <div className="flex items-center gap-1 text-claude-text-muted">
            <Keyboard className="h-3 w-3" />
            <span className="text-[9px] font-semibold uppercase tracking-wider">
              {locale === 'zh' ? '快捷键' : 'Shortcuts'}
            </span>
          </div>
          <div className="w-px h-3 bg-claude-border dark:bg-[#3d3832]" />
          <div className="flex items-center gap-2.5 flex-wrap">
            {SHORTCUTS.map((s, i) => (
              <div key={i} className="flex items-center gap-1">
                <div className="flex items-center gap-0.5">
                  {s.keys.map((key, j) => (
                    <kbd
                      key={j}
                      className="inline-flex items-center justify-center min-w-[18px] h-5 px-1 text-[9px] font-mono font-semibold rounded bg-white dark:bg-[#2b2926] text-claude-text border border-claude-border dark:border-[#3d3832] shadow-sm"
                    >
                      {key}
                    </kbd>
                  ))}
                </div>
                <span className="text-[9px] text-claude-text-muted">{s.label}</span>
              </div>
            ))}
          </div>
          <button
            onClick={dismiss}
            className="p-0.5 rounded text-claude-text-muted hover:text-claude-text transition-colors"
            aria-label={locale === 'zh' ? '关闭快捷键提示' : 'Dismiss shortcut hints'}
          >
            <X className="h-3 w-3" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
