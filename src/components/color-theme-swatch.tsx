'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Check } from 'lucide-react';
import { useColorTheme, COLOR_THEMES } from '@/hooks/use-color-theme';
import { useI18n } from '@/lib/i18n';

/**
 * ColorThemeSwatch
 *
 * A compact button in the header showing the current accent color.
 * Click to open a dropdown with all available color themes.
 * Uses createPortal to render dropdown at document.body level,
 * avoiding any z-index/overflow issues from parent containers.
 */

export function ColorThemeSwatch() {
  const { locale } = useI18n();
  const { themeId, currentTheme, changeTheme } = useColorTheme();
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, right: 0 });

  useEffect(() => {
    if (!isOpen || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });

    const handler = (e: MouseEvent) => {
      if (buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        const dropdown = document.getElementById('color-theme-dropdown-portal');
        if (dropdown && !dropdown.contains(e.target as Node)) {
          setIsOpen(false);
        }
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="h-7 w-7 rounded-full flex items-center justify-center hover:scale-110 transition-transform"
        title={locale === 'zh' ? `${currentTheme.nameZh} 主题` : `${currentTheme.name} theme`}
        aria-label={locale === 'zh' ? '切换颜色主题' : 'Switch color theme'}
      >
        <span
          className="w-4 h-4 rounded-full border-2 border-white/30 dark:border-black/30 shadow-sm"
          style={{ backgroundColor: currentTheme.accent }}
        />
      </button>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          <motion.div
            id="color-theme-dropdown-portal"
            initial={{ opacity: 0, y: -4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.96 }}
            transition={{ duration: 0.12 }}
            style={{
              position: 'fixed',
              top: `${dropdownPos.top}px`,
              right: `${dropdownPos.right}px`,
              zIndex: 9999,
            }}
            className="w-40 rounded-lg overflow-hidden shadow-2xl border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]"
          >
            <div className="px-2 py-1.5 text-[9px] font-bold uppercase tracking-wider text-claude-text-muted border-b border-claude-border/30 dark:border-[#3d3832]/30">
              {locale === 'zh' ? '颜色主题' : 'Color Theme'}
            </div>
            <div className="py-1">
              {COLOR_THEMES.map(theme => (
                <button
                  key={theme.id}
                  onClick={() => { changeTheme(theme.id); setIsOpen(false); }}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] transition-colors ${
                    themeId === theme.id
                      ? 'text-claude-text bg-claude-accent/5'
                      : 'text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926]'
                  }`}
                >
                  <span
                    className="w-3.5 h-3.5 rounded-full border border-white/20 dark:border-black/20 shrink-0"
                    style={{ backgroundColor: theme.accent }}
                  />
                  <span className="flex-1 text-left">{locale === 'zh' ? theme.nameZh : theme.name}</span>
                  {themeId === theme.id && <Check className="h-3 w-3" style={{ color: currentTheme.accent }} />}
                </button>
              ))}
            </div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
