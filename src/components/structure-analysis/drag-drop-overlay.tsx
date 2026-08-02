"use client";

/**
 * Drag-and-drop file upload overlay for the Molstar viewer area.
 *
 * When the user drags PDB/mmCIF files over the viewer, a full-overlay
 * dropzone appears with a dashed border and upload icon. On drop, files
 * are passed to the parent's onFiles callback.
 */
import { useState, useCallback, useEffect } from "react";
import { UploadCloud, FileBox } from "lucide-react";

interface DragDropOverlayProps {
  onFiles: (files: FileList) => void;
  enabled: boolean;
}

export function DragDropOverlay({ onFiles, enabled }: DragDropOverlayProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragCounter, setDragCounter] = useState(0);

  const handleDragEnter = useCallback(
    (e: DragEvent) => {
      if (!enabled) return;
      // Only handle file drags
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes("Files"))
        return;
      e.preventDefault();
      e.stopPropagation();
      setDragCounter((c) => c + 1);
      setIsDragging(true);
    },
    [enabled]
  );

  const handleDragLeave = useCallback(
    (e: DragEvent) => {
      if (!enabled) return;
      e.preventDefault();
      e.stopPropagation();
      setDragCounter((c) => {
        const next = c - 1;
        if (next <= 0) {
          setIsDragging(false);
          return 0;
        }
        return next;
      });
    },
    [enabled]
  );

  const handleDragOver = useCallback(
    (e: DragEvent) => {
      if (!enabled) return;
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes("Files"))
        return;
      e.preventDefault();
      e.stopPropagation();
      // Show copy cursor
      e.dataTransfer.dropEffect = "copy";
    },
    [enabled]
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      if (!enabled) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      setDragCounter(0);
      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        onFiles(e.dataTransfer.files);
      }
    },
    [enabled, onFiles]
  );

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("drop", handleDrop);
    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("drop", handleDrop);
    };
  }, [enabled, handleDragEnter, handleDragLeave, handleDragOver, handleDrop]);

  if (!isDragging) return null;

  return (
    <div className="sa-dropzone-overlay absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
      <div className="sa-dropzone-box flex flex-col items-center gap-4 rounded-xl border-2 border-dashed border-claude-accent bg-claude-surface/95 backdrop-blur-sm px-12 py-10 shadow-2xl">
        <div className="relative">
          <div className="absolute inset-0 animate-ping rounded-full bg-claude-accent/20" />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-claude-accent-light">
            <UploadCloud className="h-8 w-8 text-claude-accent" />
          </div>
        </div>
        <div className="text-center">
          <p className="text-base font-semibold text-claude-text">
            Drop files to load
          </p>
          <p className="mt-1 text-xs text-claude-text-secondary">
            Supports .pdb, .cif, .mmcif, .ent formats
          </p>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-claude-text-muted">
          <FileBox className="h-3 w-3" />
          <span>Multiple files supported</span>
        </div>
      </div>
    </div>
  );
}
