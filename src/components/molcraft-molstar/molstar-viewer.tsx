"use client";

import { useEffect, useRef } from "react";
import { useMolstarLoader } from "./use-molstar-loader";
import { useAppStore } from "@/lib/molcraft/store";
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
      // Viewport controls — keep just the essentials.
      viewportShowReset: true,
      viewportShowScreenshotControls: false,
      viewportShowControls: true,
      viewportShowExpand: false,
      viewportShowToggleFullscreen: true,
      viewportShowSettings: true,
      viewportShowSelectionMode: true,
      viewportShowAnimation: false,
      viewportShowTrajectoryControls: true,
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

    return () => {
      disposed = true;
      ro.disconnect();
      if (viewerRef.current) {
        try {
          viewerRef.current.dispose();
        } catch {
          // ignore
        }
        viewerRef.current = null;
      }
      // Don't clear the store viewer on cleanup — the next effect run
      // will set a new one. Clearing here causes race conditions with
      // HMR / Fast Refresh where the cleanup runs after the new viewer
      // is already set.
    };
  }, [molstar, setViewer, toast]);

  return (
    <div className={className} style={{ position: "relative", width: "100%", height: "100%" }}>
      <div className="viewer-backdrop absolute inset-0 -z-10" />
      <div
        ref={containerRef}
        className="absolute inset-0"
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
          <div className="sa-molstar-loader flex flex-col items-center gap-4 text-claude-text-secondary">
            <div className="relative h-16 w-16">
              {/* Outer ring */}
              <div className="absolute inset-0 rounded-full border-2 border-claude-accent/20" />
              {/* Spinning arc */}
              <div className="absolute inset-0 rounded-full border-t-2 border-claude-accent animate-spin" />
              {/* Center icon */}
              <div className="absolute inset-0 flex items-center justify-center">
                <svg
                  className="h-6 w-6 text-claude-accent animate-pulse"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
              </div>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-claude-text">
                Initializing Molstar Viewer
              </p>
              <p className="mt-0.5 text-[10px] text-claude-text-muted">
                Loading 3D rendering engine...
              </p>
            </div>
            {/* Progress bar */}
            <div className="h-1 w-32 overflow-hidden rounded-full bg-claude-border">
              <div className="sa-progress-bar h-full bg-claude-accent" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
