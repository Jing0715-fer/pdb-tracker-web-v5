'use client';

/**
 * PdbViewerLite — a lightweight 3D structure viewer for the PdbViewerModal.
 *
 * Uses the PREBUILT Molstar bundle (/molstar.js) loaded via <script> tag,
 * NOT the ESM `molstar/lib/...` imports that PdbStructureViewer.tsx uses.
 *
 * The ESM imports are blocked by IgnorePlugin in next.config.ts (dev mode),
 * causing "Cannot find module 'molstar/lib/mol-plugin-ui/index.js'" errors.
 *
 * This component:
 *  1. Renders a MolstarViewer (prebuilt bundle)
 *  2. Loads the PDB structure when pdbId changes
 *  3. Cleans up on unmount
 */

import { useEffect, useRef, useCallback } from 'react';
import { MolstarViewer } from '@/components/molcraft-molstar/molstar-viewer';
import { useAppStore } from '@/lib/molcraft/store';
import { executeCommand } from '@/lib/molcraft/commands';
import { Loader2, Box } from 'lucide-react';

interface PdbViewerLiteProps {
  pdbId: string;
  className?: string;
}

export function PdbViewerLite({ pdbId, className }: PdbViewerLiteProps) {
  const viewer = useAppStore((s) => s.viewer);
  const ready = useAppStore((s) => s.ready);
  const toast = useAppStore((s) => s.toast);
  const loadedRef = useRef<string | null>(null);

  // Load the PDB structure when the viewer is ready and pdbId changes
  useEffect(() => {
    if (!viewer || !ready || !pdbId) return;
    if (loadedRef.current === pdbId) return; // already loaded

    loadedRef.current = pdbId;
    let cancelled = false;

    (async () => {
      try {
        const res = await executeCommand(viewer, { type: 'load_pdb', id: pdbId });
        if (cancelled) return;
        if (!res.ok) {
          toast(`Failed to load ${pdbId}: ${res.detail}`, 'error');
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        toast(`Load error: ${msg}`, 'error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [viewer, ready, pdbId, toast]);

  // Clear structure on unmount
  useEffect(() => {
    return () => {
      loadedRef.current = null;
      // Note: we don't call viewer.clear() here because the MolstarViewer
      // component manages its own lifecycle. The structure will be replaced
      // next time a new pdbId is loaded.
    };
  }, []);

  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <MolstarViewer className="absolute inset-0" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-3 bg-claude-surface/80 dark:bg-[#242220]/80 rounded-lg p-4">
            <Box className="h-8 w-8 text-claude-accent animate-pulse" />
            <div className="flex items-center gap-2 text-xs text-claude-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Initializing 3D Viewer...</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
