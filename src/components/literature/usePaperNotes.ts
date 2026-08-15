'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NoteData {
  text: string;
  updatedAt: string;
}

const STORAGE_KEY = 'pdb-paper-notes';

// ─── Hook: usePaperNotes ──────────────────────────────────────────────────────
//
// Extracted from `LiteraturePaperNotes.tsx` so that `pdb-tracker.tsx` can
// statically import the hook WITHOUT pulling `framer-motion` + `dompurify`
// (which are only needed by the editor/section components in
// `LiteraturePaperNotes.tsx`) into pdb-tracker's first-compile graph.
// The component file is loaded lazily via `next/dynamic` from
// `pdb-tracker.tsx` and `LiteratureView.tsx`.

export function usePaperNotes() {
  const [notes, setNotes] = useState<Record<string, NoteData>>(() => {
    // Load from localStorage using lazy initializer
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          // Migrate from old format (string) to new format (NoteData)
          const migrated: Record<string, NoteData> = {};
          for (const [key, val] of Object.entries(parsed)) {
            if (typeof val === 'string') {
              migrated[key] = { text: val, updatedAt: new Date().toISOString() };
            } else {
              migrated[key] = val as NoteData;
            }
          }
          return migrated;
        }
      } catch {
        // ignore
      }
    }
    return {};
  });

  // Save to localStorage on change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  }, [notes]);

  const setNote = useCallback((pmid: string, text: string) => {
    setNotes(prev => ({
      ...prev,
      [pmid]: { text, updatedAt: new Date().toISOString() },
    }));
  }, []);

  const getNote = useCallback((pmid: string): string => {
    return notes[pmid]?.text || '';
  }, [notes]);

  const getNoteData = useCallback((pmid: string): NoteData | null => {
    return notes[pmid] || null;
  }, [notes]);

  const hasNote = useCallback((pmid: string): boolean => {
    return !!notes[pmid]?.text;
  }, [notes]);

  const deleteNote = useCallback((pmid: string) => {
    setNotes(prev => {
      const next = { ...prev };
      delete next[pmid];
      return next;
    });
  }, []);

  return {
    notes,
    setNote,
    getNote,
    getNoteData,
    hasNote,
    deleteNote,
  };
}
