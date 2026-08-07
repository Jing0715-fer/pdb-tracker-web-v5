'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  X, Loader2, Box, Microscope, PanelLeft, PanelRightClose,
  Activity, FileText, ChevronRight, ExternalLink, Download,
  Palette, Zap, Atom, Box as BoxIcon, Camera, Upload, MessageSquare,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useI18n } from '@/lib/i18n';
import { importWithRetry } from '@/lib/dynamic-import-retry';
import { useAppStore } from '@/lib/molcraft/store';

// PdbViewerLite uses the prebuilt Molstar bundle (/molstar.js) via <script>
// tag, avoiding the ESM `molstar/lib/...` imports that are blocked by
// IgnorePlugin in dev mode (next.config.ts).
// Uses importWithRetry to handle ChunkLoadError during dev server recompiles.
const PdbViewerLite = dynamic(
  () => importWithRetry(() => import('@/components/PdbViewerLite').then(m => ({ default: m.PdbViewerLite }))),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Box className="h-8 w-8 text-claude-accent animate-pulse" />
          <div className="flex items-center gap-2 text-xs text-claude-text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Initializing 3D Viewer...</span>
          </div>
        </div>
      </div>
    ),
  }
);

// Lazy-load the StructureInfoPanel for inline analysis
// Uses importWithRetry to handle ChunkLoadError during dev server recompiles.
const StructureInfoPanel = dynamic(
  () => importWithRetry(() => import('@/components/structure-analysis/structure-info-panel').then(m => ({ default: m.StructureInfoPanel }))),
  { ssr: false }
);

// Lazy-load a compact analysis summary (fetches quick stats)
const AnalysisSummary = dynamic(
  () => importWithRetry(() => import('./analysis-summary').then(m => ({ default: m.AnalysisSummary }))),
  { ssr: false }
);

// Lazy-load the full analysis charts grid (same as full analysis view)
const FullAnalysisTab = dynamic(
  () => importWithRetry(() => import('@/components/structure-analysis/analysis-left-panel').then(m => ({ default: m.AnalysisTab }))),
  { ssr: false }
);

// Lazy-load the viewer tool tabs (Display / Interactions / Viz / Volume / Export).
// These pull in molcraft commands + presets, so we keep them out of the
// main bundle until the user clicks the tab.
const DisplayTab = dynamic(
  () => importWithRetry(() => import('@/components/structure-analysis/viewer-tools-tabs').then(m => ({ default: m.DisplayTab }))),
  { ssr: false }
);
const InteractionsTab = dynamic(
  () => importWithRetry(() => import('@/components/structure-analysis/viewer-tools-tabs').then(m => ({ default: m.InteractionsTab }))),
  { ssr: false }
);
const VisualizationTab = dynamic(
  () => importWithRetry(() => import('@/components/structure-analysis/viewer-tools-tabs').then(m => ({ default: m.VisualizationTab }))),
  { ssr: false }
);
const VolumeTab = dynamic(
  () => importWithRetry(() => import('@/components/structure-analysis/viewer-tools-tabs').then(m => ({ default: m.VolumeTab }))),
  { ssr: false }
);
const ExportTab = dynamic(
  () => importWithRetry(() => import('@/components/structure-analysis/viewer-tools-tabs').then(m => ({ default: m.ExportTab }))),
  { ssr: false }
);
const UploadTab = dynamic(
  () => importWithRetry(() => import('@/components/structure-analysis/viewer-tools-tabs').then(m => ({ default: m.UploadTab }))),
  { ssr: false }
);
const ModalChatTab = dynamic(
  () => importWithRetry(() => import('@/components/structure-analysis/viewer-tools-tabs').then(m => ({ default: m.ModalChatTab }))),
  { ssr: false }
);

type AnalysisTab = 'info' | 'analysis' | 'display' | 'interactions' | 'viz' | 'volume' | 'export' | 'upload' | 'chat';

interface PdbViewerModalProps {
  pdbId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when the user clicks "Open in Analysis Mode" — the parent should
   *  switch to mode='analysis' and pre-load the structure. */
  onOpenInAnalysis?: (pdbId: string) => void;
}

export function PdbViewerModal({ pdbId, open, onOpenChange, onOpenInAnalysis }: PdbViewerModalProps) {
  const openTimeRef = useRef<number>(0);
  const [viewerReadyKey, setViewerReadyKey] = useState(0);
  const [analysisPanelOpen, setAnalysisPanelOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<AnalysisTab>('info');

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      // Increment key to force remount of the viewer on each open
      setViewerReadyKey(k => k + 1);
    } else {
      // BUG FIX: clear measurements + interaction lines when the modal closes.
      // Since measurements are persisted to localStorage (P3), they would
      // survive modal close/reopen and show on the next structure's view.
      // We clear them here so each modal session starts fresh.
      useAppStore.getState().clearMeasurements();
      useAppStore.getState().clearInteractionLines();
      openTimeRef.current = 0;
      setAnalysisPanelOpen(true);
      setActiveTab('info');
    }
    onOpenChange(nextOpen);
  }, [onOpenChange]);

  const viewerReady = open;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-[95vw] max-h-[95vh] p-0 gap-0 overflow-hidden border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#1a1917] rounded-xl"
      >
        <DialogTitle className="sr-only">
          3D Structure Viewer — {pdbId}
        </DialogTitle>
        <div className="flex flex-col h-[92vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-sm text-claude-accent uppercase tracking-wider">
                {pdbId}
              </span>
              <span className="text-xs text-claude-text-muted hidden sm:inline">3D Structure Viewer</span>
            </div>
            <div className="flex items-center gap-2">
              {pdbId && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAnalysisPanelOpen(!analysisPanelOpen)}
                  className="h-7 gap-1.5 text-xs"
                  title={analysisPanelOpen ? 'Hide analysis panel' : 'Show analysis panel'}
                >
                  {analysisPanelOpen ? (
                    <PanelRightClose className="h-3.5 w-3.5" />
                  ) : (
                    <PanelLeft className="h-3.5 w-3.5" />
                  )}
                  <span className="hidden sm:inline">Analysis</span>
                </Button>
              )}
              {pdbId && onOpenInAnalysis && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    handleOpenChange(false);
                    onOpenInAnalysis(pdbId);
                  }}
                  className="h-7 gap-1.5 text-xs border-claude-accent/40 text-claude-accent hover:bg-claude-accent-light hover:text-claude-accent-hover"
                  title="Open in full Structure Analysis module"
                >
                  <Microscope className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Full Analysis</span>
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleOpenChange(false)}
                className="h-7 w-7 p-0 rounded-full bg-claude-border-light/80 dark:bg-[#2b2926]/80 hover:bg-red-100 dark:hover:bg-red-900/30 text-claude-text-muted hover:text-red-500 transition-all duration-200"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Body: 3D viewer + inline analysis panel */}
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* 3D Viewer — takes remaining space */}
            <div className="flex-1 min-w-0 relative">
              {pdbId && viewerReady ? (
                <PdbViewerLite
                  key={viewerReadyKey}
                  pdbId={pdbId}
                  className="h-full border-0 rounded-none"
                />
              ) : (
                <div className="flex-1 flex items-center justify-center h-full">
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

            {/* Inline Analysis Panel — right side.
                On narrow screens (< xl), the panel is collapsible so the
                3D viewer gets maximum space. The toggle button is in the
                header (PanelRightClose / PanelLeft). */}
            {analysisPanelOpen && pdbId && (
              <div className="w-[260px] md:w-[300px] lg:w-[340px] xl:w-[380px] shrink-0 border-l border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] flex flex-col min-h-0 analysis-panel">
                {/* Tab bar — compact icon+label grid, wraps to 2 rows on narrow panels */}
                <div className="grid grid-cols-4 border-b border-claude-border dark:border-[#3d3832] flex-shrink-0">
                  <AnalysisTabButton
                    active={activeTab === 'info'}
                    onClick={() => setActiveTab('info')}
                    icon={<FileText className="h-3 w-3" />}
                    label="Info"
                  />
                  <AnalysisTabButton
                    active={activeTab === 'analysis'}
                    onClick={() => setActiveTab('analysis')}
                    icon={<Activity className="h-3 w-3" />}
                    label="Analysis"
                  />
                  <AnalysisTabButton
                    active={activeTab === 'display'}
                    onClick={() => setActiveTab('display')}
                    icon={<Palette className="h-3 w-3" />}
                    label="Display"
                  />
                  <AnalysisTabButton
                    active={activeTab === 'interactions'}
                    onClick={() => setActiveTab('interactions')}
                    icon={<Zap className="h-3 w-3" />}
                    label="Interact"
                  />
                  <AnalysisTabButton
                    active={activeTab === 'viz'}
                    onClick={() => setActiveTab('viz')}
                    icon={<Atom className="h-3 w-3" />}
                    label="Viz"
                  />
                  <AnalysisTabButton
                    active={activeTab === 'volume'}
                    onClick={() => setActiveTab('volume')}
                    icon={<BoxIcon className="h-3 w-3" />}
                    label="Volume"
                  />
                  <AnalysisTabButton
                    active={activeTab === 'export'}
                    onClick={() => setActiveTab('export')}
                    icon={<Camera className="h-3 w-3" />}
                    label="Export"
                  />
                  <AnalysisTabButton
                    active={activeTab === 'upload'}
                    onClick={() => setActiveTab('upload')}
                    icon={<Upload className="h-3 w-3" />}
                    label="Upload"
                  />
                  <AnalysisTabButton
                    active={activeTab === 'chat'}
                    onClick={() => setActiveTab('chat')}
                    icon={<MessageSquare className="h-3 w-3" />}
                    label="Chat"
                  />
                  <AnalysisTabButton
                    active={activeTab === 'tools'}
                    onClick={() => setActiveTab('tools')}
                    icon={<Microscope className="h-3 w-3" />}
                    label="Links"
                  />
                </div>

                {/* Tab content */}
                <ScrollArea className="flex-1 min-h-0 sa-scroll">
                  {activeTab === 'info' && pdbId && (
                    <StructureInfoPanel pdbIdOverride={pdbId} />
                  )}
                  {activeTab === 'analysis' && pdbId && (
                    <FullAnalysisTab />
                  )}
                  {activeTab === 'display' && <DisplayTab />}
                  {activeTab === 'interactions' && pdbId && <FullAnalysisTab />}
                  {activeTab === 'viz' && pdbId && <VisualizationTab pdbId={pdbId} />}
                  {activeTab === 'volume' && <VolumeTab />}
                  {activeTab === 'export' && <ExportTab />}
                  {activeTab === 'upload' && <UploadTab />}
                  {activeTab === 'chat' && pdbId && <ModalChatTab pdbId={pdbId} />}
                  {activeTab === 'tools' && pdbId && (
                    <ToolsTab
                      pdbId={pdbId}
                      onOpenInAnalysis={onOpenInAnalysis}
                      onClose={handleOpenChange}
                    />
                  )}
                </ScrollArea>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Analysis Tab Button ────────────────────────────────────────────────────

function AnalysisTabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[9px] font-medium transition-colors border-b-2 ${
        active
          ? 'text-claude-accent border-claude-accent bg-claude-accent-light/30'
          : 'text-claude-text-muted border-transparent hover:text-claude-text hover:bg-claude-accent-light/20'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ─── Tools Tab ──────────────────────────────────────────────────────────────

function ToolsTab({
  pdbId,
  onOpenInAnalysis,
  onClose,
}: {
  pdbId: string;
  onOpenInAnalysis?: (pdbId: string) => void;
  onClose: (open: boolean) => void;
}) {
  return (
    <div className="p-3 space-y-3">
      <div className="text-[11px] font-semibold text-claude-text flex items-center gap-1.5">
        <Microscope className="h-3.5 w-3.5 text-claude-accent" />
        Analysis Tools
      </div>

      <p className="text-[10px] text-claude-text-muted leading-relaxed">
        Open the full Structure Analysis module for all 24 analysis charts,
        sequence viewer, structure alignment, and more.
      </p>

      {onOpenInAnalysis && (
        <Button
          size="sm"
          className="w-full h-8 text-xs gap-1.5"
          onClick={() => {
            onClose(false);
            onOpenInAnalysis(pdbId);
          }}
        >
          <Microscope className="h-3.5 w-3.5" />
          Open Full Analysis Module
          <ChevronRight className="h-3 w-3" />
        </Button>
      )}

      <div className="border-t border-claude-border dark:border-[#3d3832] pt-2 space-y-1.5">
        <div className="text-[9px] font-semibold uppercase tracking-wide text-claude-text-muted">
          Quick Links
        </div>
        <a
          href={`https://www.rcsb.org/structure/${pdbId.toUpperCase()}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[10px] text-claude-text hover:bg-claude-accent-light/50 hover:text-claude-accent transition-colors"
        >
          <ExternalLink className="h-3 w-3" />
          View on RCSB PDB
        </a>
        <a
          href={`https://www.ebi.ac.uk/pdbe/entry/pdb/${pdbId.toLowerCase()}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[10px] text-claude-text hover:bg-claude-accent-light/50 hover:text-claude-accent transition-colors"
        >
          <ExternalLink className="h-3 w-3" />
          View on PDBe
        </a>
        <a
          href={`https://files.rcsb.org/download/${pdbId.toUpperCase()}.pdb`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[10px] text-claude-text hover:bg-claude-accent-light/50 hover:text-claude-accent transition-colors"
        >
          <Download className="h-3 w-3" />
          Download PDB File
        </a>
        <a
          href={`https://files.rcsb.org/download/${pdbId.toUpperCase()}.cif`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[10px] text-claude-text hover:bg-claude-accent-light/50 hover:text-claude-accent transition-colors"
        >
          <Download className="h-3 w-3" />
          Download mmCIF File
        </a>
      </div>

      <div className="border-t border-claude-border dark:border-[#3d3832] pt-2">
        <div className="text-[9px] font-semibold uppercase tracking-wide text-claude-text-muted mb-1.5">
          Available Analyses
        </div>
        <div className="grid grid-cols-2 gap-1 text-[9px]">
          {[
            'Ramachandran', 'B-factor', 'SASA', 'Disulfide',
            'Secondary Struct', 'Contact Map', 'Ligand Interact',
            'Oligomer', 'Druggability', 'Validation',
          ].map((name) => (
            <div
              key={name}
              className="flex items-center gap-1 px-1.5 py-1 rounded bg-claude-bg dark:bg-[#1a1917] text-claude-text-muted"
            >
              <ChevronRight className="h-2 w-2 text-claude-accent" />
              {name}
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-[8px] text-claude-text-muted text-center">
          + 14 more in full module
        </p>
      </div>
    </div>
  );
}

// ─── Thumbnail Preview Card ──────────────────────────────────────────────────

interface PdbThumbnailPreviewProps {
  pdbId: string;
  title?: string;
  onClick: () => void;
  thumbHeight?: number;
  hideInfoBar?: boolean;
}

export function PdbThumbnailPreview({ pdbId, title, onClick, thumbHeight = 180, hideInfoBar = false }: PdbThumbnailPreviewProps) {
  const { t, locale } = useI18n();

  const proxyUrl = `/api/pdb-image/${pdbId.toUpperCase()}`;
  const lower = pdbId.toLowerCase();
  const directUrl = `https://cdn.rcsb.org/images/rCSB/${lower.substring(1, 3)}/${lower}/${lower}.thumb_350.png`;

  const [imgSrc, setImgSrc] = useState<string | null>(proxyUrl);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [triedSources, setTriedSources] = useState(1);
  const [trackedPdbId, setTrackedPdbId] = useState(pdbId);

  if (trackedPdbId !== pdbId) {
    setTrackedPdbId(pdbId);
    setImgSrc(proxyUrl);
    setImgLoaded(false);
    setImgError(false);
    setTriedSources(1);
  }

  const handleImageError = useCallback(() => {
    if (triedSources === 1) {
      setImgSrc(directUrl);
      setTriedSources(2);
      setImgLoaded(false);
    } else {
      setImgError(true);
    }
  }, [triedSources, directUrl]);

  return (
    <div
      className="group relative rounded-lg border border-claude-border/60 dark:border-[#3d3832]/60 overflow-hidden cursor-pointer transition-all duration-200 hover:border-claude-accent/40 hover:shadow-md"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    >
      <div className="relative bg-gradient-to-br from-claude-border-light dark:from-[#2b2926] to-[#e8e5df] dark:to-[#1a1917] flex items-center justify-center overflow-hidden" style={{ height: thumbHeight }}>
        {imgSrc && !imgError && (
          <img
            src={imgSrc}
            alt={`${pdbId} structure preview`}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
            onLoad={() => setImgLoaded(true)}
            onError={handleImageError}
          />
        )}
        <div className={`relative z-10 flex flex-col items-center gap-2 transition-opacity duration-300 ${imgLoaded && !imgError ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
          <div className="w-12 h-12 rounded-xl bg-claude-accent/10 flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-claude-accent">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <span className="font-mono font-bold text-lg text-claude-text/60">{pdbId}</span>
          {!imgError && !imgLoaded && (
            <Loader2 className="h-3 w-3 text-claude-accent animate-spin" />
          )}
        </div>
        <div className="absolute inset-0 bg-claude-accent/5 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center z-20">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-claude-accent/90 text-white text-xs font-medium shadow-lg">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
            View 3D Structure
          </div>
        </div>
      </div>
      {!hideInfoBar && (
        <div className="px-3 py-2 bg-claude-surface/80 dark:bg-[#242220]/80 border-t border-claude-border/40 dark:border-[#3d3832]/40">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] font-bold text-claude-accent">{pdbId}</span>
            <span className="text-[10px] text-claude-text-muted">
              {title ? (title.length > 30 ? title.slice(0, 30) + '…' : title) : (locale === 'zh' ? '点击查看 3D' : 'Click to view 3D')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
