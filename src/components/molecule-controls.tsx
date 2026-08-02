'use client';
import { useI18n } from '@/lib/i18n';

import React from 'react';
import {
  RotateCcw,
  ExternalLink,
  Camera,
  RefreshCw,
  Maximize,
  Minimize,
  Layers,
  Crosshair,
  Boxes,
  EyeOff,
  Palette,
  Eye,
  Hexagon,
  Dna,
  Undo2,
  FlaskConical,
  ZoomIn,
  ChevronRight,
  SlidersHorizontal,
  Sun,
  Moon,
} from 'lucide-react';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';

// ─── Toolbar Button ──────────────────────────────────────────────────────

export function ToolbarButton({
  onClick,
  icon,
  label,
  active,
  disabled,
  className = '',
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const { locale } = useI18n();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          disabled={disabled}
          className={`flex items-center justify-center w-7 h-7 rounded-md
                     backdrop-blur-sm border transition-all duration-150 scale-in-bounce btn-icon-hover
                     disabled:opacity-40 disabled:cursor-not-allowed
                     ${
                       active
                         ? 'bg-claude-accent text-white border-claude-accent/60 shadow-sm'
                         : 'bg-claude-surface/80 border-claude-border-light text-claude-text-secondary hover:text-claude-text hover:bg-claude-surface hover:border-claude-border shadow-sm'
                     }
                     ${className}`}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="bg-claude-surface text-claude-text border border-claude-border shadow-lg"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Toolbar: Reset Camera ──────────────────────────────────────────────

export function useViewerActions(pluginRef: React.MutableRefObject<any>) {
  const handleResetCamera = async () => {
    const plugin = pluginRef.current;
    if (!plugin) return;
    plugin.managers?.camera?.reset(undefined, 600);
  };

  const handleFocusHighlighted = async () => {
    const plugin = pluginRef.current;
    if (!plugin) return;
    plugin.managers?.camera?.reset(undefined, 400);
  };

  const handleScreenshot = async () => {
    const plugin = pluginRef.current;
    if (!plugin) return;
    try {
      const canvas3d = plugin.canvas3d;
      if (!canvas3d) return;
      const dataUrl = await canvas3d?.exportScreenshots([
        { width: canvas3d.webgl.maxViewportDimension, height: canvas3d.webgl.maxViewportDimension },
      ]);
      if (dataUrl && dataUrl[0]?.data) {
        const link = document.createElement('a');
        link.href = dataUrl[0].data;
        link.download = 'molstar-screenshot.png';
        link.click();
      }
    } catch (err) {
      console.warn('[MoleculeViewer] Screenshot failed:', err);
    }
  };

  const handleToggleSpin = async (isSpinning: boolean, setIsSpinning: (v: boolean) => void) => {
    const plugin = pluginRef.current;
    if (!plugin) return;
    try {
      const spin = plugin.canvas3d?.context?.settings?.publish;
      if (isSpinning) {
        plugin.canvas3d?.setSettings({ publish: { ...spin, rotate: false } });
      } else {
        plugin.canvas3d?.setSettings({
          publish: {
            ...spin,
            rotate: { speed: 1, step: 0.5, pauseAfter: 0 },
          },
        });
      }
      setIsSpinning(!isSpinning);
    } catch (err) {
      console.warn('[MoleculeViewer] Toggle spin error:', err);
    }
  };

  return { handleResetCamera, handleFocusHighlighted, handleScreenshot, handleToggleSpin };
}

// ─── Format count helper ───────────────────────────────────────────────

export function formatCount(count: number): string {
  if (count === 0) return '—';
  if (count >= 1_000_000) return (count / 1_000_000).toFixed(1) + 'M';
  if (count >= 1_000) return (count / 1_000).toFixed(1) + 'K';
  return count.toString();
}

// ─── Background icon helper ────────────────────────────────────────────

import type { BackgroundMode } from './molecule-plugin-init';
import { BACKGROUND_LABELS } from './molecule-plugin-init';

export function getBackgroundIcon(mode: BackgroundMode, darkMode: boolean): React.ReactNode {
  if (mode === 'dark') return <Moon className="w-3.5 h-3.5" />;
  if (mode === 'white') return <Sun className="w-3.5 h-3.5" />;
  return darkMode ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />;
}

// ─── Assembly switcher panel ─────────────────────────────────────────────

interface AssemblySwitcherProps {
  assemblies: string[];
  currentAssembly: string;
  assemblyDescriptions: Record<string, string>;
  assemblySwitching: boolean;
  onAssemblyChange: (id: string) => void;
}

export function AssemblySwitcher({
  assemblies,
  currentAssembly,
  assemblyDescriptions,
  assemblySwitching,
  onAssemblyChange,
}: AssemblySwitcherProps) {
  if (assemblies.length <= 1) return null;

  return (
    <div
      className={`mt-1.5 p-1.5 rounded-lg bg-claude-surface/70 backdrop-blur-md border border-claude-border-light/60 shadow-sm
                 transition-all duration-300 ${assemblySwitching ? 'opacity-70 scale-[0.98]' : 'opacity-100 scale-100'}`}
    >
      <div className="flex items-center gap-1 mb-1">
        <Layers className="w-3 h-3 text-claude-accent flex-shrink-0" />
        <span className="text-[9px] font-semibold uppercase tracking-wider text-claude-text-muted">
          Assembly
        </span>
      </div>
      <div className="flex rounded-md overflow-hidden border border-claude-border-light">
        {assemblies.map((id) => (
          <button
            key={id}
            onClick={() => onAssemblyChange(id)}
            className={`flex-1 px-2 py-1 text-[10px] font-mono font-semibold transition-all duration-200
                       ${
                         currentAssembly === id
                           ? 'bg-claude-accent text-white shadow-sm'
                           : 'bg-claude-surface text-claude-text-secondary hover:bg-claude-accent-light hover:text-claude-accent'
                       }
                       ${assemblySwitching && currentAssembly === id ? 'animate-pulse' : ''}`}
          >
            {id}
          </button>
        ))}
      </div>
      {assemblyDescriptions[currentAssembly] && (
        <p className="text-[8px] text-claude-text-muted mt-1 leading-tight truncate" title={assemblyDescriptions[currentAssembly]}>
          {assemblyDescriptions[currentAssembly]}
        </p>
      )}
    </div>
  );
}

// ─── ED Map level panel ─────────────────────────────────────────────────

interface EDMapPanelProps {
  edMapLevel: number;
  onEdMapLevelChange: (level: number) => void;
}

export function EDMapPanel({ edMapLevel, onEdMapLevelChange }: EDMapPanelProps) {
  return (
    <div className="mt-1.5 p-2 rounded-lg bg-claude-surface/70 backdrop-blur-md border border-claude-border-light/60 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <SlidersHorizontal className="w-3 h-3 text-claude-accent" />
        <span className="text-[9px] font-semibold uppercase tracking-wider text-claude-text-muted">
          Density Level
        </span>
        <span className="text-[9px] font-mono font-bold text-claude-accent ml-auto">
          {edMapLevel.toFixed(1)}σ
        </span>
      </div>
      <input
        type="range"
        min="0.5"
        max="3.0"
        step="0.1"
        value={edMapLevel}
        onChange={(e) => onEdMapLevelChange(parseFloat(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer
                   bg-claude-border-light accent-claude-accent"
      />
      <div className="flex justify-between text-[7px] text-claude-text-muted mt-0.5">
        <span>0.5σ</span>
        <span>2Fo-Fc</span>
        <span>3.0σ</span>
      </div>
    </div>
  );
}

// ─── Stats overlay ─────────────────────────────────────────────────────

interface StatsOverlayProps {
  representation: 'cartoon' | 'ball-stick' | 'surface';
  atomCount: number;
  residueCount: number;
  edMapActive: boolean;
}

export function StatsOverlay({ representation, atomCount, residueCount, edMapActive }: StatsOverlayProps) {
  const representationLabel = representation === 'ball-stick' ? 'Ball & Stick' :
    representation === 'surface' ? 'Surface' : 'Cartoon';

  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] font-medium text-claude-text-secondary flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-claude-accent" />
        {representationLabel}
      </span>
      <span className="text-[10px] font-mono text-claude-text-muted">
        {formatCount(atomCount)} atoms
      </span>
      {residueCount > 0 && (
        <span className="text-[10px] font-mono text-claude-text-muted">
          {formatCount(residueCount)} residues
        </span>
      )}
      {edMapActive && (
        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded
                       bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400
                       flex items-center gap-0.5">
          <Layers className="w-2.5 h-2.5" />
          EDMap
        </span>
      )}
    </div>
  );
}

// ─── Toolbar container ──────────────────────────────────────────────────

interface ViewerToolbarProps {
  structureLoaded: boolean;
  isSpinning: boolean;
  edMapActive: boolean;
  edMapLevel: number;
  backgroundMode: BackgroundMode;
  darkMode: boolean;
  isFullscreen: boolean;
  assemblies: string[];
  currentAssembly: string;
  assemblyDescriptions: Record<string, string>;
  assemblySwitching: boolean;
  hasHighlight: boolean;
  pdbId: string;
  representation: 'cartoon' | 'ball-stick' | 'surface';
  onResetColors: () => void;
  onToggleAllLigands: () => void;
  onToggleAllExpanded: () => void;
  onRepresentationChange: (rep: 'cartoon' | 'ball-stick' | 'surface') => void;
  // Actions
  pluginRef: React.MutableRefObject<any>;
  onResetCamera: () => void;
  onFocusHighlighted: () => void;
  onScreenshot: () => void;
  onToggleSpin: () => void;
  onToggleEDMap: () => void;
  onToggleBackground: () => void;
  onToggleFullscreen: () => void;
  onAssemblyChange: (id: string) => void;
  onEdMapLevelChange: (level: number) => void;
}

export function ViewerToolbar({
  structureLoaded,
  isSpinning,
  edMapActive,
  edMapLevel,
  backgroundMode,
  darkMode,
  isFullscreen,
  assemblies,
  currentAssembly,
  assemblyDescriptions,
  assemblySwitching,
  hasHighlight,
  pdbId,
  representation,
  onResetColors,
  onToggleAllLigands,
  onToggleAllExpanded,
  onRepresentationChange,
  pluginRef,
  onResetCamera,
  onFocusHighlighted,
  onScreenshot,
  onToggleSpin,
  onToggleEDMap,
  onToggleBackground,
  onToggleFullscreen,
  onAssemblyChange,
  onEdMapLevelChange,
}: ViewerToolbarProps) {
  const { locale } = useI18n();
  return (
    <>
      {/* ─── Enhanced Overlay Toolbar (Top-Left) ─── */}
      <div className="absolute top-3 left-3 z-10">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-claude-surface/60 backdrop-blur-md border border-claude-border-light/60 shadow-sm">
          {/* Reset Camera */}
          <ToolbarButton
            onClick={onResetCamera}
            icon={<RotateCcw className="w-3.5 h-3.5" />}
            label={locale === "zh" ? "重置视角" : "Reset Camera"}
          />

          {/* Focus on Highlighted */}
          {hasHighlight && (
            <ToolbarButton
              onClick={onFocusHighlighted}
              icon={<Crosshair className="w-3.5 h-3.5" />}
              label={locale === "zh" ? "聚焦选中" : "Focus on Selection"}
              active
            />
          )}

          {/* Screenshot */}
          <ToolbarButton
            onClick={onScreenshot}
            icon={<Camera className="w-3.5 h-3.5" />}
            label={locale === "zh" ? "截图 (PNG)" : "Screenshot (PNG)"}
            disabled={!structureLoaded}
          />

          {/* Toggle Spin */}
          <ToolbarButton
            onClick={onToggleSpin}
            icon={<RefreshCw className={`w-3.5 h-3.5 ${isSpinning ? 'animate-spin' : ''}`} />}
            label={isSpinning ? 'Stop Rotation' : 'Auto-Rotate'}
            active={isSpinning}
            disabled={!structureLoaded}
          />

          {/* Toggle Density */}
          <ToolbarButton
            onClick={onToggleEDMap}
            icon={<Boxes className="w-3.5 h-3.5" />}
            label={edMapActive ? 'Density: ON' : 'Density: OFF'}
            active={edMapActive}
            disabled={!structureLoaded}
          />

          {/* Toggle Background */}
          <ToolbarButton
            onClick={onToggleBackground}
            icon={getBackgroundIcon(backgroundMode, darkMode)}
            label={`Background: ${BACKGROUND_LABELS[backgroundMode]}`}
          />

          {/* Fullscreen */}
          <ToolbarButton
            onClick={onToggleFullscreen}
            icon={isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
            label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          />

          {/* Separator */}
          <div className="w-px h-5 bg-claude-border-light mx-0.5" />

          {/* View on RCSB */}
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={`https://www.rcsb.org/structure/${pdbId.toUpperCase()}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center w-7 h-7 rounded-md
                           backdrop-blur-sm border bg-claude-surface/80 border-claude-border-light
                           text-claude-text-secondary hover:text-claude-text hover:bg-claude-surface
                           hover:border-claude-border shadow-sm transition-all duration-150"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              className="bg-claude-surface text-claude-text border border-claude-border shadow-lg"
            >
              View on RCSB PDB
            </TooltipContent>
          </Tooltip>

          {/* Separator */}
          <div className="w-px h-5 bg-claude-border-light mx-0.5" />

          {/* Reset colors */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onResetColors}
                className="flex items-center justify-center w-7 h-7 rounded-md backdrop-blur-sm border bg-claude-surface/80 border-claude-border-light text-claude-text-secondary hover:text-claude-accent hover:bg-claude-surface hover:border-claude-border shadow-sm transition-all duration-150"
              >
                <Palette className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="bg-claude-surface text-claude-text border border-claude-border shadow-lg">
              Reset all colors
            </TooltipContent>
          </Tooltip>

          {/* Show/Hide all ligands */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onToggleAllLigands}
                className="flex items-center justify-center w-7 h-7 rounded-md backdrop-blur-sm border bg-claude-surface/80 border-claude-border-light text-claude-text-secondary hover:text-claude-accent hover:bg-claude-surface hover:border-claude-border shadow-sm transition-all duration-150"
              >
                <Layers className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="bg-claude-surface text-claude-text border border-claude-border shadow-lg">
              Show/Hide all ligands
            </TooltipContent>
          </Tooltip>

          {/* Expand/Collapse all */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onToggleAllExpanded}
                className="flex items-center justify-center w-7 h-7 rounded-md backdrop-blur-sm border bg-claude-surface/80 border-claude-border-light text-claude-text-secondary hover:text-claude-accent hover:bg-claude-surface hover:border-claude-border shadow-sm transition-all duration-150"
              >
                <Dna className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="bg-claude-surface text-claude-text border border-claude-border shadow-lg">
              Expand/Collapse all
            </TooltipContent>
          </Tooltip>

          {/* Separator */}
          <div className="w-px h-5 bg-claude-border-light mx-0.5" />

          {/* Cartoon rep */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onRepresentationChange?.('cartoon')}
                className="flex items-center justify-center w-7 h-7 rounded-md backdrop-blur-sm border bg-claude-surface/80 border-claude-border-light text-claude-text-secondary hover:text-claude-accent hover:bg-claude-surface hover:border-claude-border shadow-sm transition-all duration-150"
              >
                <Hexagon className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="bg-claude-surface text-claude-text border border-claude-border shadow-lg">
              Cartoon
            </TooltipContent>
          </Tooltip>

          {/* Ball-stick rep */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onRepresentationChange?.('ball-stick')}
                className="flex items-center justify-center w-7 h-7 rounded-md backdrop-blur-sm border bg-claude-surface/80 border-claude-border-light text-claude-text-secondary hover:text-claude-accent hover:bg-claude-surface hover:border-claude-border shadow-sm transition-all duration-150"
              >
                <FlaskConical className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="bg-claude-surface text-claude-text border border-claude-border shadow-lg">
              Ball &amp; Stick
            </TooltipContent>
          </Tooltip>

          {/* Surface rep */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onRepresentationChange?.('surface')}
                className="flex items-center justify-center w-7 h-7 rounded-md backdrop-blur-sm border bg-claude-surface/80 border-claude-border-light text-claude-text-secondary hover:text-claude-accent hover:bg-claude-surface hover:border-claude-border shadow-sm transition-all duration-150"
              >
                <Dna className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="bg-claude-surface text-claude-text border border-claude-border shadow-lg">
              Surface
            </TooltipContent>
          </Tooltip>
        </div>

        {/* ED Map Level Panel */}
        {edMapActive && structureLoaded && (
          <EDMapPanel edMapLevel={edMapLevel} onEdMapLevelChange={onEdMapLevelChange} />
        )}

        {/* Assembly switcher panel */}
        <AssemblySwitcher
          assemblies={assemblies}
          currentAssembly={currentAssembly}
          assemblyDescriptions={assemblyDescriptions}
          assemblySwitching={assemblySwitching}
          onAssemblyChange={onAssemblyChange}
        />
      </div>
    </>
  );
}