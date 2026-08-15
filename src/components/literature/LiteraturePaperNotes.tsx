'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { StickyNote, X, Eye, EyeOff, Clock } from 'lucide-react';
import DOMPurify from 'dompurify';

// ─── Types ────────────────────────────────────────────────────────────────────
//
// The `usePaperNotes` hook and `NoteData` type live in `./usePaperNotes` so
// that `pdb-tracker.tsx` can import the hook without pulling `framer-motion` +
// `dompurify` (used only by the editor/section components below) into its
// first-compile graph. Re-exported here for backward compatibility with
// existing consumers (e.g. `LiteratureView.tsx`, `literature/index.ts`).

import { usePaperNotes, type NoteData } from './usePaperNotes';
export { usePaperNotes };
export type { NoteData };

// ─── Component: PaperNotesButton ──────────────────────────────────────────────

interface PaperNotesButtonProps {
  pmid: string;
  hasNote: boolean;
  onClick: () => void;
}

export function PaperNotesButton({ pmid, hasNote, onClick }: PaperNotesButtonProps) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(); }}
      className={`relative p-1 rounded-md transition-colors ${
        hasNote
          ? 'text-amber-500 dark:text-amber-400'
          : 'text-claude-text-muted hover:text-amber-500 dark:hover:text-amber-400 hover:bg-amber-500/5 opacity-0 group-hover:opacity-100'
      }`}
      title={hasNote ? 'Edit note' : 'Add note'}
    >
      <StickyNote className="h-3.5 w-3.5" />
      {hasNote && (
        <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-400 dark:bg-amber-500 ring-1 ring-white dark:ring-[#242220]" />
      )}
    </button>
  );
}

// ─── Component: PaperNotesEditor ──────────────────────────────────────────────

interface PaperNotesEditorProps {
  pmid: string;
  noteText: string;
  noteData: NoteData | null;
  onNoteChange: (pmid: string, text: string) => void;
  onClose: () => void;
}

export function PaperNotesEditor({ pmid, noteText, noteData, onNoteChange, onClose }: PaperNotesEditorProps) {
  const [text, setText] = useState(noteText);
  const [showPreview, setShowPreview] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Debounced save
  const handleChange = useCallback((value: string) => {
    setText(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onNoteChange(pmid, value);
    }, 500);
  }, [pmid, onNoteChange]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const charCount = text.length;
  const maxChars = 2000;

  // Simple markdown-like rendering for preview
  const renderPreview = (md: string) => {
    if (!md) return '';
    // Convert markdown subset to HTML, then sanitize
    const raw = md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br />');
    return DOMPurify.sanitize(raw, { ALLOWED_TAGS: ['strong', 'em', 'code', 'br'] });
  };

  const formattedTimestamp = noteData?.updatedAt
    ? new Date(noteData.updatedAt).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50/50 dark:bg-amber-900/10 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-amber-200/50 dark:border-amber-800/30">
        <div className="flex items-center gap-1.5">
          <StickyNote className="h-3 w-3 text-amber-600 dark:text-amber-400" />
          <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider">Notes</span>
          {formattedTimestamp && (
            <span className="flex items-center gap-0.5 text-[9px] text-amber-600/60 dark:text-amber-400/50 ml-1">
              <Clock className="h-2.5 w-2.5" />
              {formattedTimestamp}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowPreview(!showPreview)}
            className={`p-1 rounded transition-colors ${
              showPreview
                ? 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/20'
                : 'text-amber-600/50 dark:text-amber-400/50 hover:text-amber-600 dark:hover:text-amber-400'
            }`}
            title={showPreview ? 'Edit' : 'Preview'}
          >
            {showPreview ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded text-amber-600/50 dark:text-amber-400/50 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
            title="Close"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Editor / Preview */}
      <div className="p-3">
        {showPreview ? (
          <div
            className="text-xs text-claude-text-secondary leading-relaxed min-h-[80px] max-h-[200px] overflow-y-auto custom-scrollbar"
            dangerouslySetInnerHTML={{ __html: text ? renderPreview(text) : '<span class="text-claude-text-muted italic">No note content</span>' }}
          />
        ) : (
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => handleChange(e.target.value)}
            placeholder="Write your notes here... (supports **bold**, *italic*, `code`)"
            maxLength={maxChars}
            className="w-full min-h-[80px] max-h-[200px] p-2 text-xs leading-relaxed rounded border border-amber-200/50 dark:border-amber-800/30 bg-white dark:bg-[#1a1917] text-claude-text placeholder:text-amber-600/30 dark:placeholder:text-amber-400/30 resize-y focus:outline-none focus:ring-1 focus:ring-amber-400/50 custom-scrollbar"
          />
        )}

        {/* Character count */}
        <div className="flex items-center justify-end mt-1">
          <span className={`text-[9px] font-mono ${charCount > maxChars * 0.9 ? 'text-red-500' : 'text-amber-600/40 dark:text-amber-400/30'}`}>
            {charCount}/{maxChars}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Component: PaperNotesSection (for detail panel) ──────────────────────────

interface PaperNotesSectionProps {
  pmid: string;
  noteText: string;
  noteData: NoteData | null;
  onNoteChange: (pmid: string, text: string) => void;
}

export function PaperNotesSection({ pmid, noteText, noteData, onNoteChange }: PaperNotesSectionProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [text, setText] = useState(noteText);
  const [prevNoteText, setPrevNoteText] = useState(noteText);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Sync text when noteText prop changes (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
  if (noteText !== prevNoteText) {
    setPrevNoteText(noteText);
    setText(noteText);
  }

  const handleChange = useCallback((value: string) => {
    setText(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onNoteChange(pmid, value);
    }, 500);
  }, [pmid, onNoteChange]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const formattedTimestamp = noteData?.updatedAt
    ? new Date(noteData.updatedAt).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <StickyNote className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400" />
          <span className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider">Notes</span>
          {formattedTimestamp && (
            <span className="flex items-center gap-0.5 text-[9px] text-claude-text-muted ml-1">
              <Clock className="h-2.5 w-2.5" />
              {formattedTimestamp}
            </span>
          )}
        </div>
        <button
          onClick={() => setIsEditing(!isEditing)}
          className={`text-[10px] font-medium px-2 py-0.5 rounded transition-colors ${
            isEditing
              ? 'bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
              : 'text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/10'
          }`}
        >
          {isEditing ? 'Done' : noteText ? 'Edit' : 'Add Note'}
        </button>
      </div>

      <AnimatePresence mode="wait">
        {isEditing ? (
          <motion.div
            key="editor"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
          >
            <textarea
              value={text}
              onChange={e => handleChange(e.target.value)}
              placeholder="Write your notes here... (supports **bold**, *italic*, `code`)"
              maxLength={2000}
              autoFocus
              className="w-full min-h-[100px] p-3 text-xs leading-relaxed rounded-lg border border-amber-200/50 dark:border-amber-800/30 bg-amber-50/30 dark:bg-amber-900/5 text-claude-text placeholder:text-amber-600/30 dark:placeholder:text-amber-400/30 resize-y focus:outline-none focus:ring-1 focus:ring-amber-400/50 custom-scrollbar"
            />
            <div className="flex items-center justify-end mt-1">
              <span className="text-[9px] font-mono text-amber-600/40 dark:text-amber-400/30">
                {text.length}/2000
              </span>
            </div>
          </motion.div>
        ) : noteText ? (
          <motion.div
            key="display"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="p-3 rounded-lg bg-amber-50/30 dark:bg-amber-900/5 border border-amber-200/30 dark:border-amber-800/20 text-xs text-claude-text-secondary leading-relaxed whitespace-pre-wrap"
          >
            {noteText}
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="p-3 rounded-lg border border-dashed border-amber-200/50 dark:border-amber-800/30 text-xs text-amber-600/40 dark:text-amber-400/30 text-center"
          >
            No notes yet. Click &quot;Add Note&quot; to start.
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
