/**
 * KeyboardShortcutsDialog — a small popover showing all available keyboard
 * shortcuts. Toggled by pressing "?" (when not typing in an input).
 */

'use client';

import { useEffect, useState } from 'react';
import { Keyboard, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Shortcut {
  keys: string;
  description: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: '⌘K', description: '聚焦输入框' },
  { keys: '⌘R', description: '重新生成最后响应' },
  { keys: 'Esc', description: '关闭侧边栏 / 失焦输入' },
  { keys: 'Enter', description: '发送消息' },
  { keys: 'Shift+Enter', description: '输入换行' },
  { keys: '?', description: '显示此快捷键帮助' },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsDialog({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-[1px]" onClick={onClose}>
      <div
        className="w-72 rounded-lg border border-claude-border bg-claude-bg-surface shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-claude-border bg-claude-bg-elevated/50">
          <div className="flex items-center gap-1.5">
            <Keyboard className="h-3.5 w-3.5 text-claude-accent" />
            <span className="text-xs font-semibold text-claude-text">键盘快捷键</span>
          </div>
          <button onClick={onClose} className="text-claude-text-muted hover:text-claude-text">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <ul className="p-2 flex flex-col gap-0.5">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-claude-bg-elevated/50">
              <span className="text-xs text-claude-text">{s.description}</span>
              <kbd className="px-1.5 py-0.5 rounded border border-claude-border bg-claude-bg-base font-mono text-[10px] text-claude-text-muted">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
        <div className="px-3 py-1.5 border-t border-claude-border text-[10px] text-claude-text-muted">
          按 ? 打开 · Esc 关闭
        </div>
      </div>
    </div>
  );
}

/** Hook that manages the dialog open state + the "?" key listener. */
export function useKeyboardShortcutsDialog() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only trigger "?" when not typing in an input/textarea.
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (e.key === '?' && !isInput) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);
  return { open, setOpen };
}
