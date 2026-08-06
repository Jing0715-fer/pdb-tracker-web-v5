"use client";

import { useEffect, useRef } from "react";
import { useMolstarLoader } from "./use-molstar-loader";
import { useAppStore } from "@/lib/molcraft/store";
import { Box, Loader2 } from "lucide-react";
import type { MolstarViewer } from "@/lib/molcraft/types";

interface MolstarViewerProps {
  className?: string;
}

/**
 * Embeds the Molstar viewer. We use the high-level `Viewer.create` API from
 * the prebuilt bundle with a heavily customised options object that strips
 * most of the built-in chrome (we render our own toolbars around the canvas).
 *
 * The viewer instance is published into the global Zustand store so every
 * other panel (tools, chat) can call its imperative API.
 */
export function MolstarViewer({ className }: MolstarViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<MolstarViewer | null>(null);
  const { molstar, error } = useMolstarLoader();
  const setViewer = useAppStore((s) => s.setViewer);
  const toast = useAppStore((s) => s.toast);

  useEffect(() => {
    if (!molstar || !containerRef.current) return;
    if (viewerRef.current) return; // already created

    let disposed = false;
    let createdViewer: MolstarViewer | null = null;
    const el = containerRef.current;

    molstar.Viewer.create(el, {
      // Strip the built-in UI chrome — we render our own panels.
      layoutIsExpanded: false,
      layoutShowControls: false,
      layoutShowRemoteState: "none" as unknown as boolean,
      layoutShowSequence: false,
      layoutShowLog: false,
      layoutShowLeftPanel: false,
      collapseLeftPanel: true,
      collapseRightPanel: true,
      // Viewport controls — hide ALL native Molstar viewport buttons.
      // We render our own measurement toolbar + Display/Export tabs instead.
      viewportShowReset: false,
      viewportShowScreenshotControls: false,
      viewportShowControls: false,
      viewportShowExpand: false,
      viewportShowToggleFullscreen: false,
      viewportShowSettings: false,
      viewportShowSelectionMode: false,
      viewportShowAnimation: false,
      viewportShowTrajectoryControls: false,
      viewportFocusBehavior: "default",
      // Picking: enable atom-level picking so click-to-measure works.
      pickScale: 1,
      pickPadding: 1,
      // Rendering quality.
      disableAntialiasing: false,
      pixelScale: 1,
      transparency: "wboit",
      preferWebgl1: false,
      allowMajorPerformanceCaveat: false,
      powerPreference: "high-performance",
      resolutionMode: "auto",
      illumination: false,
      // Data sources.
      pdbProvider: "pdbe",
      emdbProvider: "pdbe",
      volumeStreamingServer: "https://www.ebi.ac.uk/pdbe/densities",
      volumeStreamingDisabled: false,
      // Enable the extensions we actually use.
      extensions: [
        "mp4-export",
        "backgrounds",
        "geo-export",
        "model-export",
        "assembly-symmetry",
        "rcsb-validation-report",
        "pdbe-structure-quality-report",
        "anvil-membrane-orientation",
        "ma-quality-assessment",
      ],
      disabledExtensions: [],
      viewportBackgroundColor: "#ffffff",
    })
      .then((viewer: MolstarViewer) => {
        if (disposed) {
          viewer.dispose();
          return;
        }
        createdViewer = viewer;
        viewerRef.current = viewer;
        setViewer(viewer);
        toast("Molstar ready", "success");
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        toast(`Molstar init failed: ${msg}`, "error");
      });

    // Resize observer to keep the canvas in sync with its container.
    const ro = new ResizeObserver(() => {
      viewerRef.current?.handleResize();
    });
    ro.observe(el);

    // Additional periodic resize sync for the first 3 seconds — Molstar's
    // internal canvas3d.input.width/height can be 0x0 right after mount if
    // the container's layout wasn't fully settled when Viewer.create ran.
    // handleResize() reads layout.root (the G_ container's parent) offset
    // dimensions; if that's 0 we re-trigger after a short delay.
    let resizeTicks = 0;
    const resizeInterval = setInterval(() => {
      if (!viewerRef.current) return;
      resizeTicks++;
      try {
        const p = (viewerRef.current as unknown as { plugin?: { canvas3d?: { input?: { width?: number; height?: number } } } }).plugin;
        const input = p?.canvas3d?.input;
        if (input && (input.width === 0 || input.height === 0)) {
          viewerRef.current?.handleResize();
        } else {
          // Canvas has a real size — stop the periodic check.
          clearInterval(resizeInterval);
        }
      } catch {
        // ignore
      }
      if (resizeTicks > 30) clearInterval(resizeInterval); // ~3s max
    }, 100);

    return () => {
      disposed = true;
      ro.disconnect();
      clearInterval(resizeInterval);
      if (viewerRef.current) {
        try {
          viewerRef.current.dispose();
        } catch {
          // ignore
        }
        viewerRef.current = null;
      }
      // Guarded store clear: only reset the store viewer when it still
      // points to the instance we created. This fixes the "second PDB
      // doesn't load" bug — without this, after the modal closes the
      // store retains a *disposed* viewer with ready=true, so the next
      // PdbViewerLite mount tries to load_pdb against a dead viewer and
      // silently fails. The guard avoids the HMR/Fast Refresh race
      // where the new viewer is already set before cleanup runs.
      if (createdViewer) {
        const storeViewer = useAppStore.getState().viewer;
        if (storeViewer === createdViewer) {
          setViewer(null);
        }
      }
    };
  }, [molstar, setViewer, toast]);

  return (
    <div className={`${className ?? ''} molstar-viewer`} style={{ position: "relative", width: "100%", height: "100%" }}>
      <div className="viewer-backdrop absolute inset-0 -z-10" />
      <div
        ref={containerRef}
        className="absolute inset-0 molstar-container"
        style={{ minHeight: 0 }}
      />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-8 text-center">
          <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
            Molstar load failed: {error}
          </div>
        </div>
      )}
      {!molstar && !error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
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
