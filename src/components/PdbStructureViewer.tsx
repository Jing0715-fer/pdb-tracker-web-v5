'use client';

// molstar CSS: imported lazily inside the component (see loadViewerResources)
// to keep it out of the initial compile graph. A static `import "molstar/...css"`
// forces webpack/turbopack to trace molstar's package.json exports on first
// compile, which OOMs 4GB/no-swap sandboxes.
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from 'next-themes';
import {
  RotateCcw,
  ExternalLink,
  Loader2,
  AlertCircle,
  Camera,
  RefreshCw,
  Maximize,
  Minimize,
  Layers,
  Crosshair,
  Eye,
  EyeOff,
  Palette,
  Check,
  ChevronDown,
  Hexagon,
  FlaskConical,
  Dna,
  Box,
  Sun,
  Moon,
  FoldVertical,
  UnfoldVertical,
  Maximize2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from '@/components/ui/hover-card';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import { AnimatePresence, motion } from 'framer-motion';
import { useI18n } from '@/lib/i18n';

// ─── Types ──────────────────────────────────────────────────────────────────

type RepresentationType = 'cartoon' | 'ball-stick' | 'surface';
type BackgroundMode = 'theme' | 'white' | 'dark' | 'transparent';

interface PdbStructureViewerProps {
  pdbId: string;
  className?: string;
  /** Layout mode: 'stacked' = entity panel below canvas (default), 'side-by-side' = entity panel on the right */
  layout?: 'stacked' | 'side-by-side';
}

export interface ChainInfo {
  chain: string;
  asym_id: string;
  length: number | null;
}

export interface EntityInfo {
  entity_id: number;
  molecule_type: string;
  description: string;
  organism: string;
  gene_name: string;
  chem_comp_ids: string[];
  chains: ChainInfo[];
}

interface LigandData {
  code: string;
  name: string;
  formula: string | null;
  weight: number | null;
  type: string | null;
  description: string | null;
  imageUrl: string | null;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const BACKGROUND_COLORS: Record<BackgroundMode, number> = {
  theme: 0xfaf8f5,
  white: 0xffffff,
  dark: 0x1a1917,
  transparent: 0x000000,
};

const BACKGROUND_LABELS: Record<BackgroundMode, string> = {
  theme: 'Theme',
  white: 'White',
  dark: 'Dark',
  transparent: 'Transparent',
};

const PRESET_COLORS = [
  '#e53e3e', '#dd6b20', '#d69e2e', '#38a169', '#3182ce',
  '#805ad5', '#d53f8c', '#00b5d8', '#718096', '#1a202c',
  '#48bb78', '#ed8936', '#9f7aea', '#fc8181', '#f6e05e',
];

type MoleculeBadge = 'POL' | 'DNA' | 'RNA' | 'WAT' | 'LIG' | 'OTHER';

const BADGE_STYLES: Record<MoleculeBadge, string> = {
  POL: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  DNA: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  RNA: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  WAT: 'bg-gray-100 text-gray-600 dark:bg-gray-800/60 dark:text-gray-400',
  LIG: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  OTHER: 'bg-gray-100 text-gray-600 dark:bg-gray-800/60 dark:text-gray-400',
};

const LIGAND_TYPE_COLORS: Record<string, string> = {
  ION: 'text-blue-600 dark:text-blue-400',
  COENZYME: 'text-green-600 dark:text-green-400',
  NUCLEOTIDE: 'text-purple-600 dark:text-purple-400',
  COFACTOR: 'text-amber-600 dark:text-amber-400',
  SUGAR: 'text-pink-600 dark:text-pink-400',
  SOLVENT: 'text-gray-500 dark:text-gray-400',
};

function getMoleculeBadge(moleculeType: string): MoleculeBadge {
  const mt = moleculeType.toLowerCase();
  if (mt.includes('polydeoxyribonucleotide')) return 'DNA';
  if (mt.includes('polyribonucleotide')) return 'RNA';
  if (mt.includes('carbohydrate') || mt.includes('polypeptide')) return 'POL';
  if (mt.includes('water')) return 'WAT';
  if (mt.includes('bound') || mt.includes('non-polymer') || mt.includes('ligand')) return 'LIG';
  return 'OTHER';
}

function detectLigandCodes(entities: EntityInfo[]): string[] {
  const codes = new Set<string>();
  for (const entity of entities) {
    for (const ccId of entity.chem_comp_ids) {
      const upper = ccId.toUpperCase();
      if (upper !== 'HOH' && !/^ION$|^MG$|^CA$|^NA$|^CL$|^K$|^ZN$|^FE$|^CU$|^MN$/i.test(ccId)) {
        codes.add(upper);
      }
    }
  }
  return Array.from(codes);
}

function formatCount(count: number): string {
  if (count === 0) return '—';
  if (count >= 1_000_000) return (count / 1_000_000).toFixed(1) + 'M';
  if (count >= 1_000) return (count / 1_000).toFixed(1) + 'K';
  return count.toString();
}

// ─── Molstar Module Helpers ─────────────────────────────────────────────────

interface MolstarModules {
  PluginCommands: any;
  Color: any;
  Script: any;
  StructureSelectionQuery: any;
  StructureSelectionQueries: any;
  MolScriptBuilder: any;
  compile: any;
  StateSelection: any;
  PluginStateObject: any;
  StructureProperties: any;
  StructureElement: any;
}

let molstarModulesCache: MolstarModules | null = null;

function isChunkLoadError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message || '';
    return (
      msg.includes('Failed to load chunk') ||
      msg.includes('Loading chunk') ||
      msg.includes('Importing a module script failed') ||
      (err.name === 'TypeError' && msg.includes('Failed to fetch dynamically imported module'))
    );
  }
  return false;
}

async function importWithRetry<T>(importFn: () => Promise<T>, retries = 1, delayMs = 1500): Promise<T> {
  try {
    return await importFn();
  } catch (err) {
    if (retries > 0 && isChunkLoadError(err)) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return importWithRetry(importFn, retries - 1, delayMs);
    }
    throw err;
  }
}

async function getMolstarModules(): Promise<MolstarModules> {
  if (molstarModulesCache && molstarModulesCache.MolScriptBuilder && molstarModulesCache.compile) {
    return molstarModulesCache;
  }
  molstarModulesCache = null;

  // Lazily load molstar CSS only when the viewer is actually mounted.
  // A static top-level `import "molstar/...css"` forces webpack/turbopack
  // to trace molstar's package.json exports on first compile, which OOMs
  // 4GB/no-swap sandboxes. Dynamic import keeps it in a separate chunk.
  await import('molstar/build/viewer/molstar.css');

  const [pc, color, script, ssq, msb, comp, ss, pso, sp, se] = await Promise.all([
    importWithRetry(() => import('molstar/lib/mol-plugin/commands.js')),
    importWithRetry(() => import('molstar/lib/mol-util/color/index.js')),
    importWithRetry(() => import('molstar/lib/mol-script/script.js')),
    importWithRetry(() => import('molstar/lib/mol-plugin-state/helpers/structure-selection-query.js')),
    importWithRetry(() => import('molstar/lib/mol-script/language/builder.js')),
    importWithRetry(() => import('molstar/lib/mol-script/runtime/query/compiler.js')),
    importWithRetry(() => import('molstar/lib/mol-state/state/selection.js')),
    importWithRetry(() => import('molstar/lib/mol-plugin-state/objects.js')),
    importWithRetry(() => import('molstar/lib/mol-model/structure/structure/properties.js')),
    importWithRetry(() => import('molstar/lib/mol-model/structure/structure/element.js')),
  ]);

  // The structure-selection-query module may export StructureSelectionQueries in addition to StructureSelectionQuery
  const StructureSelectionQueries = (ssq as any).StructureSelectionQueries || ssq.StructureSelectionQuery;

  const modules: MolstarModules = {
    PluginCommands: pc.PluginCommands,
    Color: color.Color,
    Script: script.Script,
    StructureSelectionQuery: ssq.StructureSelectionQuery,
    StructureSelectionQueries,
    MolScriptBuilder: msb.MolScriptBuilder,
    compile: comp.compile,
    StateSelection: ss.StateSelection,
    PluginStateObject: pso.PluginStateObject,
    StructureProperties: sp.StructureProperties,
    StructureElement: se.StructureElement,
  };

  molstarModulesCache = modules;
  return modules;
}

function checkWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return false;
    return (
      (gl as WebGL2RenderingContext).constructor.name === 'WebGL2RenderingContext' ||
      (gl as WebGLRenderingContext).constructor.name === 'WebGLRenderingContext'
    );
  } catch {
    return false;
  }
}

// Helper: create a per-chain selection query using MolScriptBuilder
function createChainSelectionQuery(MS: any, chainId: string) {
  return MS.struct.generator.atomGroups({
    'chain-test': MS.core.rel.eq([MS.ammp('auth_asym_id'), chainId])
  });
}

// ─── Ligand Data Cache ──────────────────────────────────────────────────────

const ligandCache = new Map<string, LigandData | null>();

function useLigandData(code: string): { data: LigandData | null; loading: boolean } {
  const cached = ligandCache.get(code) ?? null;
  const isCached = ligandCache.has(code);
  const [data, setData] = useState<LigandData | null>(cached);
  const [loading, setLoading] = useState(!isCached);

  useEffect(() => {
    if (isCached) return;
    let cancelled = false;

    fetch(`/api/ligand/${code}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled) return;
        const ligandData: LigandData | null = json
          ? {
              code: json.code || code,
              name: json.name || code,
              formula: json.formula || null,
              weight: typeof json.weight === 'number' && !isNaN(json.weight) ? json.weight : null,
              type: json.type || null,
              description: json.description || null,
              imageUrl: json.imageUrl || null,
            }
          : null;
        ligandCache.set(code, ligandData);
        setData(ligandData);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        ligandCache.set(code, null);
        setData(null);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [code, isCached]);

  return { data, loading };
}

// ─── Color Picker Popup ─────────────────────────────────────────────────────

function ColorPickerPopup({
  currentColor,
  onColorChange,
  onClose,
  anchorRef,
}: {
  currentColor: string;
  onColorChange: (color: string) => void;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Calculate position from anchor and update on scroll/resize
  useEffect(() => {
    function updatePosition() {
      if (anchorRef?.current) {
        const rect = anchorRef.current.getBoundingClientRect();
        const popupWidth = 170;
        const popupHeight = 180;
        const viewportW = window.innerWidth;
        const viewportH = window.innerHeight;

        let top = rect.bottom + 4;
        let left = rect.left - 30;

        // If popup would go below viewport, show above the anchor instead
        if (top + popupHeight > viewportH - 8) {
          top = rect.top - popupHeight - 4;
        }
        // If popup would go right of viewport, shift left
        if (left + popupWidth > viewportW - 8) {
          left = viewportW - popupWidth - 8;
        }
        // Ensure left is not negative
        if (left < 8) left = 8;
        // Ensure top is not negative
        if (top < 8) top = 8;

        setPos({ top, left });
      }
    }

    updatePosition();

    // Close on scroll (position would be stale)
    const handleScroll = () => onClose();
    window.addEventListener('scroll', handleScroll, true); // capture to catch all scroll events
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [anchorRef, onClose]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const popupContent = (
    <div
      ref={ref}
      className="fixed z-[9999] p-2 rounded-lg shadow-xl border border-claude-border bg-claude-surface"
      style={{ minWidth: 150, ...(pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }) }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="grid grid-cols-5 gap-1.5 mb-2">
        {PRESET_COLORS.map((color) => (
          <button
            key={color}
            onClick={(e) => { e.stopPropagation(); onColorChange(color); }}
            className="w-6 h-6 rounded-md border-2 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-claude-accent/50"
            style={{
              backgroundColor: color,
              borderColor: currentColor.toLowerCase() === color.toLowerCase() ? 'var(--claude-accent)' : 'transparent',
            }}
            title={color}
          >
            {currentColor.toLowerCase() === color.toLowerCase() && (
              <Check className="w-3.5 h-3.5 text-white mx-auto drop-shadow-sm" />
            )}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 pt-1 border-t border-claude-border-light">
        <label className="text-[10px] text-claude-text-muted font-medium">Custom:</label>
        <input
          type="color"
          value={currentColor}
          onChange={(e) => onColorChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className="w-6 h-6 rounded cursor-pointer border border-claude-border bg-transparent"
        />
        <span className="text-[10px] font-mono text-claude-text-secondary">
          {currentColor.toUpperCase()}
        </span>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="mt-2 w-full py-1 text-[10px] font-medium rounded bg-claude-accent-light text-claude-accent hover:bg-claude-accent hover:text-white transition-colors"
      >
        Done
      </button>
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(popupContent, document.body);
  }
  return popupContent;
}

// ─── Ligand Hover Card ──────────────────────────────────────────────────────

function LigandHoverCard({ code, children }: { code: string; children: React.ReactNode }) {
  const { data, loading } = useLigandData(code);

  return (
    <HoverCard openDelay={400} closeDelay={200}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        side="left"
        align="start"
        className="w-64 p-0 overflow-hidden border border-claude-border bg-claude-surface shadow-xl"
      >
        <div className="h-24 bg-claude-bg flex items-center justify-center border-b border-claude-border-light overflow-hidden relative">
          {loading ? (
            <Loader2 className="w-5 h-5 text-claude-accent animate-spin" />
          ) : data?.imageUrl ? (
            <img
              src={data.imageUrl}
              alt={`${code} 2D structure`}
              className="w-full h-full object-cover object-center"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
              }}
            />
          ) : (
            <span className="font-mono text-4xl font-bold text-claude-text-muted">{code}</span>
          )}
        </div>
        <div className="p-2.5">
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-claude-text leading-tight truncate">
                {loading ? code : data?.name || code}
              </p>
              <p className="text-[10px] font-mono text-claude-accent font-bold">{code}</p>
            </div>
            {data?.type && (
              <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-claude-border-light whitespace-nowrap ${LIGAND_TYPE_COLORS[data.type] || 'text-claude-text-secondary'}`}>
                {data.type}
              </span>
            )}
          </div>
          {data?.formula && (
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[9px] text-claude-text-muted font-medium uppercase">Formula:</span>
              <span className="text-[10px] font-mono text-claude-text-secondary">{data.formula}</span>
            </div>
          )}
          {data?.weight != null && typeof data.weight === 'number' && !isNaN(data.weight) && (
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[9px] text-claude-text-muted font-medium uppercase">MW:</span>
              <span className="text-[10px] font-mono text-claude-text-secondary">{data.weight.toFixed(2)} Da</span>
            </div>
          )}
          {data?.description && (
            <p className="text-[10px] text-claude-text-muted leading-relaxed mt-1 line-clamp-3">{data.description}</p>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

// ─── Toolbar Button ─────────────────────────────────────────────────────────

function ToolbarButton({
  onClick,
  icon,
  label,
  active,
  disabled,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          disabled={disabled}
          className={`flex items-center justify-center w-7 h-7 rounded-md backdrop-blur-sm border transition-all duration-150
                     disabled:opacity-40 disabled:cursor-not-allowed
                     ${active
                       ? 'bg-claude-accent text-white border-claude-accent/60 shadow-sm'
                       : 'bg-claude-surface/80 border-claude-border-light text-claude-text-secondary hover:text-claude-text hover:bg-claude-surface hover:border-claude-border shadow-sm'
                     }`}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="bg-claude-surface text-claude-text border border-claude-border shadow-lg">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Molecule Badge Tag ─────────────────────────────────────────────────────

function MoleculeBadgeTag({ type }: { type: string }) {
  const badge = getMoleculeBadge(type);
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded tracking-wider uppercase ${BADGE_STYLES[badge]}`}>
      {badge}
    </span>
  );
}

// ─── Chain Row Item ─────────────────────────────────────────────────────────

function ChainRowItem({
  chain,
  pdbId,
  entityColors,
  entityVisibility,
  soloEntity,
  onColorDotClick,
  onEntityVisibilityChange,
  onSoloEntity,
  onFocusOnTarget,
}: {
  chain: ChainInfo;
  pdbId: string;
  entityColors: Record<string, string>;
  entityVisibility: Record<string, boolean>;
  soloEntity: string | null;
  onColorDotClick: (e: React.MouseEvent, type: 'entity' | 'ligand', key: string) => void;
  onEntityVisibilityChange: (entityKey: string, visible: boolean) => void;
  onSoloEntity: (entityKey: string | null) => void;
  onFocusOnTarget: (target: string, type: 'entity' | 'ligand') => void;
}) {
  const { t, locale } = useI18n();
  const chainKey = `${pdbId}.${chain.chain}`;
  const color = entityColors[chainKey] || '#718096';
  const isVisible = soloEntity ? soloEntity === chainKey : entityVisibility[chainKey] !== false;
  const isSolo = soloEntity === chainKey;

  return (
    <div
      className={`relative flex items-center gap-1 px-1.5 py-0.5 rounded-md transition-all duration-150
                ${isSolo ? 'ring-1 ring-amber-400/60 bg-amber-50 dark:bg-amber-900/20' : ''}
                ${!isVisible ? 'opacity-40' : 'hover:bg-claude-border-light/60 dark:hover:bg-[#2b2926]/60'}`}
    >
      {/* Color dot */}
      <button
        onClick={(e) => onColorDotClick(e, 'entity', chainKey)}
        className="w-3 h-3 rounded-full flex-shrink-0 border border-white/30 dark:border-gray-500/50 shadow-sm hover:scale-125 transition-transform focus:outline-none"
        style={{ backgroundColor: color }}
        aria-label={t.changeColor}
        title={t.changeColor}
      />

      {/* Chain ID badge */}
      <span className="text-[10px] font-mono font-bold text-claude-text bg-claude-border-light dark:bg-[#2b2926] px-1.5 py-0.5 rounded">
        {chain.chain}
      </span>

      {/* Length */}
      {chain.length != null && (
        <span className="text-[9px] text-claude-text-muted">{chain.length} res</span>
      )}

      <div className="flex-1" />

      {/* Focus button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={(e) => { e.stopPropagation(); onFocusOnTarget(chainKey, 'entity'); }}
            className="p-0.5 rounded text-claude-text-muted hover:text-claude-accent hover:bg-claude-accent-light transition-colors flex-shrink-0"
          >
            <Crosshair className="w-3 h-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" className="bg-claude-surface text-claude-text border border-claude-border shadow-lg">Focus in 3D</TooltipContent>
      </Tooltip>

      {/* Solo button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={(e) => { e.stopPropagation(); onSoloEntity(isSolo ? null : chainKey); }}
            className={`p-0.5 rounded transition-colors flex-shrink-0 ${
              isSolo
                ? 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30'
                : 'text-claude-text-muted hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20'
            }`}
            title={isSolo ? (locale === 'zh' ? '退出单独模式' : 'Exit solo mode') : (locale === 'zh' ? '单独模式：仅显示此链' : 'Solo: show only this chain')}
          >
            <Maximize2 className="w-3 h-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" className="bg-claude-surface text-claude-text border border-claude-border shadow-lg">
          {isSolo ? 'Exit Solo Mode' : 'Solo Mode'}
        </TooltipContent>
      </Tooltip>

      {/* Visibility toggle */}
      <button
        onClick={(e) => { e.stopPropagation(); onEntityVisibilityChange(chainKey, !isVisible); }}
        className={`p-0.5 rounded transition-colors flex-shrink-0 ${isVisible ? 'text-claude-text-secondary hover:text-claude-accent' : 'text-claude-text-muted'}`}
        title={isVisible ? (locale === 'zh' ? '隐藏链' : 'Hide chain') : (locale === 'zh' ? '显示链' : 'Show chain')}
      >
        {isVisible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
      </button>
    </div>
  );
}

// ─── Ligand Row Item ────────────────────────────────────────────────────────

function LigandRowItem({
  code,
  ligandColors,
  ligandVisibility,
  soloLigand,
  onColorDotClick,
  onLigandVisibilityChange,
  onSoloLigand,
  onFocusOnTarget,
}: {
  code: string;
  ligandColors: Record<string, string>;
  ligandVisibility: Record<string, boolean>;
  soloLigand: string | null;
  onColorDotClick: (e: React.MouseEvent, type: 'entity' | 'ligand', key: string) => void;
  onLigandVisibilityChange: (ligandCode: string, visible: boolean) => void;
  onSoloLigand: (ligandCode: string | null) => void;
  onFocusOnTarget: (target: string, type: 'entity' | 'ligand') => void;
}) {
  const { t, locale } = useI18n();
  const color = ligandColors[code] || '#d69e2e';
  const isVisible = soloLigand ? soloLigand === code : ligandVisibility[code] !== false;
  const isSolo = soloLigand === code;

  return (
    <div className="relative">
      <LigandHoverCard code={code}>
        <div
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md cursor-pointer transition-all duration-150
                    ${isSolo ? 'ring-1 ring-amber-400/60 bg-amber-50 dark:bg-amber-900/20' : ''}
                    ${!isVisible ? 'opacity-40' : 'hover:bg-claude-border-light/60 dark:hover:bg-[#2b2926]/60'}`}
        >
          {/* Color dot */}
          <button
            onClick={(e) => onColorDotClick(e, 'ligand', code)}
            className="w-3 h-3 rounded-full flex-shrink-0 border border-white/30 dark:border-gray-500/50 shadow-sm hover:scale-125 transition-transform focus:outline-none"
            style={{ backgroundColor: color }}
            aria-label={t.changeLigandColor}
            title={locale === 'zh' ? '更改颜色' : 'Change color'}
          />

          {/* Ligand code badge */}
          <span className="text-[10px] font-mono font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded">
            {code}
          </span>

          <div className="flex-1" />

          {/* Focus button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={(e) => { e.stopPropagation(); onFocusOnTarget(code, 'ligand'); }}
                className="p-0.5 rounded text-claude-text-muted hover:text-claude-accent hover:bg-claude-accent-light transition-colors flex-shrink-0"
              >
                <Crosshair className="w-3 h-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" className="bg-claude-surface text-claude-text border border-claude-border shadow-lg">Focus in 3D</TooltipContent>
          </Tooltip>

          {/* Solo button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={(e) => { e.stopPropagation(); onSoloLigand(isSolo ? null : code); }}
                className={`p-0.5 rounded transition-colors flex-shrink-0 ${
                  isSolo
                    ? 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30'
                    : 'text-claude-text-muted hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                }`}
                title={isSolo ? (locale === 'zh' ? '退出单独模式' : 'Exit solo mode') : (locale === 'zh' ? '单独模式：仅显示此配体' : 'Solo: show only this ligand')}
              >
                <Maximize2 className="w-3 h-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" className="bg-claude-surface text-claude-text border border-claude-border shadow-lg">
              {isSolo ? 'Exit Solo Mode' : 'Solo Mode'}
            </TooltipContent>
          </Tooltip>

          {/* Visibility toggle */}
          <button
            onClick={(e) => { e.stopPropagation(); onLigandVisibilityChange(code, !isVisible); }}
            className={`p-0.5 rounded transition-colors flex-shrink-0 ${isVisible ? 'text-claude-text-secondary hover:text-claude-accent' : 'text-claude-text-muted'}`}
            title={isVisible ? (locale === 'zh' ? '隐藏配体' : 'Hide ligand') : (locale === 'zh' ? '显示配体' : 'Show ligand')}
          >
            {isVisible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
          </button>
        </div>
      </LigandHoverCard>
    </div>
  );
}

// ─── Main PdbStructureViewer Component ──────────────────────────────────────

export function PdbStructureViewer({ pdbId, className = '', layout = 'stacked' }: PdbStructureViewerProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  // Fix: locale was previously referenced as a free variable in JSX rendered
  // before the useI18n() call site at the bottom of this component (and the
  // existing useI18n() calls at lines 572 / 671 are inside OTHER components:
  // ChainRowItem and LigandRowItem — different closures). Adding the hook
  // here makes locale available to all JSX in PdbStructureViewer's render.
  const { locale } = useI18n();

  const containerRef = useRef<HTMLDivElement>(null);
  const pluginRef = useRef<any>(null);
  const loadedPdbRef = useRef<string | null>(null);
  const disposedRef = useRef(false);
  const entityDataRef = useRef<EntityInfo[]>([]);
  const knownLigandCodesRef = useRef<string[]>([]);
  const perLigandComponentsCreatedRef = useRef(false);
  const perChainComponentsCreatedRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pluginReady, setPluginReady] = useState(false);
  const [structureLoaded, setStructureLoaded] = useState(false);
  const [webglNotAvailable, setWebglNotAvailable] = useState(false);

  // Toolbar state
  const [isSpinning, setIsSpinning] = useState(false);
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('theme');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [representation, setRepresentation] = useState<RepresentationType>('cartoon');

  // Stats
  const [atomCount, setAtomCount] = useState(0);
  const [residueCount, setResidueCount] = useState(0);

  // Entity/ligand state
  const [entities, setEntities] = useState<EntityInfo[]>([]);
  const [ligandCodes, setLigandCodes] = useState<string[]>([]);
  const [entityColors, setEntityColors] = useState<Record<string, string>>({});
  const [ligandColors, setLigandColors] = useState<Record<string, string>>({});
  const [entityVisibility, setEntityVisibility] = useState<Record<string, boolean>>({});
  const [ligandVisibility, setLigandVisibility] = useState<Record<string, boolean>>({});
  const [soloEntity, setSoloEntity] = useState<string | null>(null);
  const [soloLigand, setSoloLigand] = useState<string | null>(null);
  const [ligandsReady, setLigandsReady] = useState(false);
  const [entitiesReady, setEntitiesReady] = useState(false);
  const [perLigandComponentsReady, setPerLigandComponentsReady] = useState(false);
  const [perChainComponentsReady, setPerChainComponentsReady] = useState(false);

  // Color picker state — includes the anchor element so we render ONE popup at the top level
  const [colorPickerTarget, setColorPickerTarget] = useState<{
    type: 'entity' | 'ligand';
    key: string;
    anchor: HTMLElement | null;
  } | null>(null);

  // Entity panel collapse state
  const [entitiesExpanded, setEntitiesExpanded] = useState(true);
  const [ligandsExpanded, setLigandsExpanded] = useState(true);
  const [collapsedChains, setCollapsedChains] = useState<Record<string, boolean>>({});

  const [mounted, setMounted] = useState(() => true);

  // Background color based on mode
  const bgColor = useMemo(() => {
    if (backgroundMode === 'theme') return isDark ? 0x1a1917 : 0xfaf8f5;
    return BACKGROUND_COLORS[backgroundMode];
  }, [isDark, backgroundMode]);

  // ─── Reset state on pdbId change ──────────────────────────────────────
  // All state below is initialized to its reset values, so we can clear it
  // during render when pdbId changes (idiomatic React: avoid setState in effect).
  const [prevPdbId, setPrevPdbId] = useState(pdbId);
  if (pdbId !== prevPdbId) {
    setPrevPdbId(pdbId);
    setEntities([]);
    setLigandCodes([]);
    setEntityColors({});
    setLigandColors({});
    setEntityVisibility({});
    setLigandVisibility({});
    setSoloEntity(null);
    setSoloLigand(null);
    setLigandsReady(false);
    setEntitiesReady(false);
    setPerLigandComponentsReady(false);
    setPerChainComponentsReady(false);
    setAtomCount(0);
    setResidueCount(0);
    setColorPickerTarget(null);
    setCollapsedChains({});
  }

  // Refs are reset in an effect (refs can't be touched during render).
  useEffect(() => {
    perLigandComponentsCreatedRef.current = false;
    perChainComponentsCreatedRef.current = false;
  }, [pdbId]);

  // ─── Initialize Molstar plugin ────────────────────────────────────────
  useEffect(() => {
    // Don't attempt init until the component is mounted and the container ref is available
    if (!mounted || !containerRef.current) return;

    let disposed = false;

    async function initPlugin() {
      if (!checkWebGL()) {
        if (!disposed) {
          setWebglNotAvailable(true);
          setError('WebGL is not available in your browser. Please try a different browser or enable hardware acceleration.');
          setLoading(false);
        }
        return;
      }

      if (disposed || !containerRef.current) return;

      try {
        const [{ createPluginUI }, { DefaultPluginUISpec }, { renderReact18 }] = await Promise.all([
          importWithRetry(() => import('molstar/lib/mol-plugin-ui/index.js')),
          importWithRetry(() => import('molstar/lib/mol-plugin-ui/spec.js')),
          importWithRetry(() => import('molstar/lib/mol-plugin-ui/react18.js')),
        ]);

        if (disposed || !containerRef.current) return;

        // Pre-load Molstar modules for later use
        await getMolstarModules();

        if (disposed || !containerRef.current) return;

        // Create a custom render function that properly manages the React 18 root lifecycle.
        // The key challenge: React 18's createRoot() rejects containers that are already part
        // of a React tree (detected via __reactContainer$ on ancestor elements).
        // Solution: Create a detached DOM element as the render target, then append it to our
        // container. This way createRoot won't find any React tree ancestry.
        const container = containerRef.current;
        container.innerHTML = '';
        const detachedTarget = document.createElement('div');
        detachedTarget.style.width = '100%';
        detachedTarget.style.height = '100%';
        container.appendChild(detachedTarget);

        const plugin = await createPluginUI({
          target: detachedTarget,
          render: renderReact18,
          spec: {
            ...DefaultPluginUISpec(),
            layout: {
              initial: {
                isExpanded: false,
                showControls: false,
                controlsDisplay: 'reactive',
                regionState: {
                  top: 'hidden' as any,
                  left: 'hidden' as any,
                  right: 'hidden' as any,
                  bottom: 'hidden' as any,
                },
              },
            },
            components: {
              controls: {
                top: 'none' as any,
                left: 'none' as any,
                right: 'none' as any,
                bottom: 'none' as any,
              },
            },
          } as any,
        });

        if (disposed) {
          plugin.dispose();
          return;
        }

        pluginRef.current = plugin;
        setPluginReady(true);

        // Set initial background
        try {
          const { PluginCommands } = await getMolstarModules();
          PluginCommands.Canvas3D.SetSettings(plugin, {
            settings: {
              renderer: {
                ...plugin.canvas3d?.props.renderer,
                backgroundColor: bgColor,
              },
            },
          });
        } catch { /* ignore */ }

        // Set up a ResizeObserver to handle container size changes.
        // Mol* needs to be notified when its container resizes so it can update the WebGL canvas.
        const resizeObs = new ResizeObserver(() => {
          try {
            if (plugin && !disposed) {
              plugin.canvas3d?.requestResize?.();
            }
          } catch { /* ignore resize errors */ }
        });
        resizeObs.observe(container);

        // Store observer for cleanup (using a closure ref)
        (pluginRef as any).__resizeObs = resizeObs;
      } catch (err) {
        if (!disposed) {
          console.error('[PdbStructureViewer] initPlugin error:', err);
          const errMsg = err instanceof Error ? err.message : String(err);
          if (errMsg.toLowerCase().includes('webgl') || errMsg.toLowerCase().includes('context')) {
            setWebglNotAvailable(true);
            setError('WebGL is not available. Please try a different browser.');
          } else {
            setError(locale === 'zh' ? '3D 查看器初始化失败，请刷新页面。' : 'Failed to initialize 3D viewer. Please refresh the page.');
          }
          setLoading(false);
        }
      }
    }

    initPlugin();

    return () => {
      disposed = true;
      const plugin = pluginRef.current;
      const container = containerRef.current;

      if (plugin) {
        try { plugin.dispose(); } catch { /* ignore */ }
      }
      if (container) {
        container.innerHTML = '';
      }
      // Clean up resize observer stored on pluginRef
      if ((pluginRef as any).__resizeObs) {
        try { ((pluginRef as any).__resizeObs as ResizeObserver).disconnect(); } catch { /* ignore */ }
        (pluginRef as any).__resizeObs = undefined;
      }

      pluginRef.current = null;
      setPluginReady(false);
      loadedPdbRef.current = null;
      setStructureLoaded(false);
    };
  }, [mounted]);

  // ─── Update background on theme/mode change ───────────────────────────
  useEffect(() => {
    const plugin = pluginRef.current;
    if (!plugin) return;
    (async () => {
      try {
        const { PluginCommands } = await getMolstarModules();
        PluginCommands.Canvas3D.SetSettings(plugin, {
          settings: {
            renderer: {
              ...plugin.canvas3d?.props.renderer,
              backgroundColor: bgColor,
            },
          },
        });
      } catch { /* ignore */ }
    })();
  }, [bgColor, pluginReady]);

  // ─── Fullscreen change listener ───────────────────────────────────────
  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // ─── Load PDB structure ───────────────────────────────────────────────
  useEffect(() => {
    if (!pdbId || !pluginReady || !pluginRef.current) return;
    if (loadedPdbRef.current === pdbId) return;

    const plugin = pluginRef.current;
    let cancelled = false;

    async function loadStructure() {
      setLoading(true);
      setError(null);
      setStructureLoaded(false);
      setAtomCount(0);
      setResidueCount(0);
      setLigandsReady(false);
      setEntitiesReady(false);
      perLigandComponentsCreatedRef.current = false;
      setPerLigandComponentsReady(false);
      perChainComponentsCreatedRef.current = false;
      setPerChainComponentsReady(false);

      try {
        const { PluginCommands } = await getMolstarModules();
        if (cancelled || !plugin) return;

        // Clear existing structures
        try {
          const hierarchy = plugin.managers.structure.hierarchy.current;
          if (hierarchy && hierarchy.structures.length > 0) {
            for (const s of hierarchy.structures) {
              try {
                await PluginCommands.State.RemoveObject(plugin, {
                  state: plugin.state.data,
                  ref: s.cell?.transform?.ref,
                });
              } catch { /* ignore */ }
            }
          }
        } catch { /* ignore */ }

        if (cancelled) return;

        // Fetch CIF data manually using fetch() (avoids Mol* internal CORS issues),
        // then load into Mol* via blob URL.
        const proxyUrl = `/api/pdb-download/${pdbId.toUpperCase()}`;
        const directUrl = `https://files.rcsb.org/download/${pdbId.toUpperCase()}.cif`;

        let cifContent: string | null = null;
        let lastError: any = null;

        // Try proxy API first, then direct RCSB as fallback
        const fetchUrls = [proxyUrl, directUrl];
        for (const url of fetchUrls) {
          try {
            if (cancelled) throw new Error('Cancelled');
            const response = await fetch(url, {
              signal: AbortSignal.timeout(30000),
            });
            if (response.ok) {
              cifContent = await response.text();
              break;
            } else {
              lastError = new Error(`HTTP ${response.status} for ${url}`);
            }
          } catch (fetchErr: any) {
            lastError = fetchErr;
            continue;
          }
        }

        if (!cifContent) {
          throw lastError || new Error(`PDB ${pdbId.toUpperCase()} not found`);
        }

        if (cancelled) return;

        // Create a blob URL from the fetched CIF content so Mol* can download it
        // without CORS issues (blob URLs are same-origin).
        const blob = new Blob([cifContent], { type: 'chemical/x-cif' });
        const blobUrl = URL.createObjectURL(blob);

        let data: any;
        try {
          data = await plugin.builders.data.download(
            { url: blobUrl, isBinary: false, label: pdbId.toUpperCase() },
            { state: { isGhost: true } }
          );
        } catch (dlErr: any) {
          URL.revokeObjectURL(blobUrl);
          throw dlErr;
        }

        // Clean up blob URL after Mol* has finished downloading
        // Delay revocation to ensure Mol* has fully consumed the data
        setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);

        if (cancelled || !data) {
          if (!data) throw new Error('Failed to create data source from CIF content');
          return;
        }

        const trajectory = await plugin.builders.structure.parseTrajectory(data, 'mmcif');
        if (cancelled) return;

        await plugin.builders.structure.hierarchy.applyPreset(trajectory, 'default');
        if (cancelled) return;

        loadedPdbRef.current = pdbId;
        setStructureLoaded(true);
        setLoading(false);

        // Update stats
        setTimeout(async () => {
          if (cancelled || !plugin) return;
          try {
            let totalAtoms = 0;
            let totalResidues = 0;
            const hierarchy = plugin.managers.structure.hierarchy.current;
            for (const structure of hierarchy.structures) {
              const s = structure.cell?.obj?.data;
              if (!s) continue;
              const elementCount = s.elementCount || 0;
              if (elementCount > 0) totalAtoms += elementCount;
            }
            if (totalAtoms > 0) setAtomCount(totalAtoms);
            if (totalResidues > 0) setResidueCount(totalResidues);
          } catch { /* ignore */ }
        }, 500);

        // Fetch entity data
        try {
          const entityRes = await fetch(`/api/entities/${pdbId}`);
          if (cancelled) return;
          if (entityRes.ok) {
            const entityJson = await entityRes.json();
            const entityList: EntityInfo[] = entityJson.entities || [];
            entityDataRef.current = entityList;
            setEntities(entityList);
            setEntitiesReady(true);

            const ligCodes = detectLigandCodes(entityList);
            knownLigandCodesRef.current = ligCodes;
            setLigandCodes(ligCodes);
            setLigandsReady(true);

            // Set default colors for entities based on chain
            const defaultColors: Record<string, string> = {};
            const chainColors = ['#3182ce', '#e53e3e', '#38a169', '#805ad5', '#dd6b20', '#d53f8c', '#00b5d8', '#d69e2e'];
            let colorIdx = 0;
            for (const entity of entityList) {
              for (const chain of entity.chains) {
                const key = `${pdbId}.${chain.chain}`;
                if (!defaultColors[key]) {
                  defaultColors[key] = chainColors[colorIdx % chainColors.length];
                  colorIdx++;
                }
              }
            }
            setEntityColors(prev => ({ ...defaultColors, ...prev }));

            // Default ligand colors
            const defaultLigColors: Record<string, string> = {};
            for (const code of ligCodes) {
              defaultLigColors[code] = '#d69e2e';
            }
            setLigandColors(prev => ({ ...defaultLigColors, ...prev }));
          }
        } catch (err) {
          console.warn('[PdbStructureViewer] Failed to fetch entity data:', err);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[PdbStructureViewer] Failed to load structure:', err);
          let errorMessage = `Failed to load ${pdbId.toUpperCase()}`;
          if (err instanceof Error) {
            const msg = err.message || '';
            if (msg.includes('network') || msg.includes('fetch') || msg.includes('Failed to fetch')) {
              errorMessage = `Network error loading ${pdbId.toUpperCase()} — check your connection`;
            } else if (msg.includes('404') || msg.includes('not found')) {
              errorMessage = `${pdbId.toUpperCase()} not found in RCSB PDB`;
            }
          }
          setError(errorMessage);
          setLoading(false);
          loadedPdbRef.current = null;
        }
      }
    }

    loadStructure();
    return () => { cancelled = true; };
  }, [pdbId, pluginReady]);

  // ─── Fetch entity data independently (doesn't require 3D viewer) ──────
  useEffect(() => {
    if (!pdbId) return;
    let cancelled = false;

    async function fetchEntityData() {
      try {
        const entityRes = await fetch(`/api/entities/${pdbId}`);
        if (cancelled) return;
        if (entityRes.ok) {
          const entityJson = await entityRes.json();
          const entityList: EntityInfo[] = entityJson.entities || [];
          entityDataRef.current = entityList;
          setEntities(entityList);
          setEntitiesReady(true);

          const ligCodes = detectLigandCodes(entityList);
          knownLigandCodesRef.current = ligCodes;
          setLigandCodes(ligCodes);
          setLigandsReady(true);

          // Set default colors for entities based on chain
          const defaultColors: Record<string, string> = {};
          const chainColors = ['#3182ce', '#e53e3e', '#38a169', '#805ad5', '#dd6b20', '#d53f8c', '#00b5d8', '#d69e2e'];
          let colorIdx = 0;
          for (const entity of entityList) {
            for (const chain of entity.chains) {
              const key = `${pdbId}.${chain.chain}`;
              if (!defaultColors[key]) {
                defaultColors[key] = chainColors[colorIdx % chainColors.length];
                colorIdx++;
              }
            }
          }
          setEntityColors(prev => ({ ...defaultColors, ...prev }));

          // Default ligand colors
          const defaultLigColors: Record<string, string> = {};
          for (const code of ligCodes) {
            defaultLigColors[code] = '#d69e2e';
          }
          setLigandColors(prev => ({ ...defaultLigColors, ...prev }));
        }
      } catch (err) {
        console.warn('[PdbStructureViewer] Failed to fetch entity data:', err);
      }
    }

    // Only fetch if entities haven't been loaded yet (structure loading will also try)
    if (!entitiesReady) {
      fetchEntityData();
    }

    return () => { cancelled = true; };
  }, [pdbId]);

  // ─── Create per-ligand Molstar components ─────────────────────────────
  useEffect(() => {
    const plugin = pluginRef.current;
    if (!plugin || !structureLoaded || !ligandsReady) return;
    if (perLigandComponentsCreatedRef.current) return;

    (async () => {
      try {
        const hierarchy = plugin.managers.structure.hierarchy.current;
        if (!hierarchy || hierarchy.structures.length === 0) return;

        const ligCodes = knownLigandCodesRef.current;
        if (!ligCodes || ligCodes.length === 0) return;

        const { MolScriptBuilder: MS, StructureSelectionQuery: SSQ } = await getMolstarModules();

        for (const ligCode of ligCodes) {
          const expression = MS.struct.generator.atomGroups({
            'atom-test': MS.core.rel.eq([MS.ammp('label_comp_id'), ligCode])
          });
          const ligQuery = SSQ(`Ligand ${ligCode}`, expression, { category: 'Ligand', isHidden: true });

          try {
            await plugin.managers.structure.component.add(
              {
                selection: ligQuery,
                options: { checkExisting: true, label: `Ligand ${ligCode}` },
                representation: 'ball-and-stick',
              },
              hierarchy.structures
            );
          } catch (e) {
            console.warn(`[PdbStructureViewer] Failed to create per-ligand component for ${ligCode}:`, e);
          }
        }

        // Hide the default "ligand" component
        for (const structure of hierarchy.structures) {
          for (const component of structure.components) {
            const label = component.cell?.obj?.label || '';
            if (label.toLowerCase() === 'ligand' || label.toLowerCase() === 'ligands') {
              try {
                plugin.managers.structure.hierarchy.toggleVisibility([component], 'hide');
              } catch { /* ignore */ }
            }
          }
        }

        perLigandComponentsCreatedRef.current = true;
        setPerLigandComponentsReady(true);
      } catch (err) {
        console.warn('[PdbStructureViewer] Per-ligand component creation error:', err);
        // Mark as ready even on error so visibility/color effects can proceed
        perLigandComponentsCreatedRef.current = true;
        setPerLigandComponentsReady(true);
      }
    })();
  }, [structureLoaded, ligandsReady]);

  // ─── Create per-chain Molstar components ──────────────────────────────
  useEffect(() => {
    const plugin = pluginRef.current;
    if (!plugin || !structureLoaded || !entitiesReady) return;
    if (perChainComponentsCreatedRef.current) return;

    (async () => {
      try {
        const hierarchy = plugin.managers.structure.hierarchy.current;
        if (!hierarchy || hierarchy.structures.length === 0) return;

        const { MolScriptBuilder: MS, StructureSelectionQuery: SSQ } = await getMolstarModules();

        for (const entity of entityDataRef.current) {
          // Skip water and non-polymer entities
          const badge = getMoleculeBadge(entity.molecule_type);
          if (badge === 'WAT') continue;

          for (const chainInfo of entity.chains) {
            const expression = MS.struct.generator.atomGroups({
              'chain-test': MS.core.rel.eq([MS.ammp('auth_asym_id'), chainInfo.chain])
            });
            const chainQuery = SSQ(`Chain ${chainInfo.chain}`, expression, { category: 'Chain', isHidden: true });

            try {
              await plugin.managers.structure.component.add(
                {
                  selection: chainQuery,
                  options: { checkExisting: true, label: `Chain ${chainInfo.chain}` },
                  representation: representation === 'ball-stick' ? 'ball-and-stick' : representation === 'surface' ? 'molecular-surface' : 'cartoon',
                },
                hierarchy.structures
              );
            } catch (e) {
              console.warn(`[PdbStructureViewer] Failed to create per-chain component for ${chainInfo.chain}:`, e);
            }
          }
        }

        // Hide default polymer component
        for (const structure of hierarchy.structures) {
          for (const component of structure.components) {
            const label = (component.cell?.obj?.label || '').toLowerCase();
            if (label === 'polymer' || label === 'chain' || label.startsWith('polymer')) {
              try {
                plugin.managers.structure.hierarchy.toggleVisibility([component], 'hide');
              } catch { /* ignore */ }
            }
          }
        }

        perChainComponentsCreatedRef.current = true;
        setPerChainComponentsReady(true);
      } catch (err) {
        console.warn('[PdbStructureViewer] Per-chain component creation error:', err);
        // Mark as ready even on error so visibility/color effects can proceed
        perChainComponentsCreatedRef.current = true;
        setPerChainComponentsReady(true);
      }
    })();
  }, [structureLoaded, entitiesReady]);

  // ─── Apply entity colors in Molstar ───────────────────────────────────
  // Uses a two-pronged approach:
  //   1. updateRepresentationsTheme for per-chain components (direct theme change — reliable)
  //   2. applyTheme overpaint as fallback for default polymer component
  useEffect(() => {
    const plugin = pluginRef.current;
    if (!plugin || !structureLoaded) return;
    if (!entityColors || Object.keys(entityColors).length === 0) return;

    let cancelled = false;

    (async () => {
      try {
        const { Color, MolScriptBuilder, StructureSelectionQuery } = await getMolstarModules();

        const hierarchy = plugin.managers.structure.hierarchy.current;
        if (!hierarchy || cancelled) return;

        // Build a chain color map from entityColors
        const chainPalette: Record<string, number> = {};
        for (const [entityKey, colorHex] of Object.entries(entityColors)) {
          const chainId = entityKey.split('.')[1];
          if (chainId) {
            const colorNum = parseInt(colorHex.replace('#', ''), 16);
            chainPalette[chainId] = colorNum;
          }
        }

        if (Object.keys(chainPalette).length === 0) return;

        // Strategy 1: Use updateRepresentationsTheme for per-chain components (most reliable)
        for (const structure of hierarchy.structures) {
          for (const component of structure.components) {
            const label = component.cell?.obj?.label || '';
            const chainMatch = label.match(/^Chain\s+(.+)$/);
            if (!chainMatch) continue;

            const chainId = chainMatch[1];
            const colorNum = chainPalette[chainId];
            if (colorNum === undefined) continue;

            if (component.representations.length > 0) {
              try {
                await plugin.managers.structure.component.updateRepresentationsTheme(
                  [component],
                  {
                    color: 'uniform' as const,
                    colorParams: { value: Color(colorNum) },
                  }
                );
              } catch { /* ignore per-component theme errors */ }
            }
          }
        }

        if (cancelled) return;

        // Strategy 2: Use applyTheme overpaint as fallback for default polymer component
        for (const [chainId, colorNum] of Object.entries(chainPalette)) {
          if (cancelled) break;
          try {
            const expression = createChainSelectionQuery(MolScriptBuilder, chainId);
            const chainQuery = StructureSelectionQuery(
              `Chain ${chainId}`,
              expression,
              { category: 'Chain', isHidden: true }
            );

            await plugin.managers.structure.component.applyTheme({
              selection: chainQuery,
              action: { name: 'color' as const, params: { color: Color(colorNum) } },
              representations: [],
            });
          } catch (e) {
            // Suppress per-chain color failures (node not in tree, etc.)
          }
        }
      } catch (e) {
        console.warn('[PdbStructureViewer] applyEntityColors error:', e);
      }
    })();

    return () => { cancelled = true; };
  }, [entityColors, structureLoaded, representation, perChainComponentsReady]);

  // ─── Apply ligand colors in Molstar ───────────────────────────────────
  // Uses a two-pronged approach: updateRepresentationsTheme + applyTheme overpaint
  useEffect(() => {
    const plugin = pluginRef.current;
    if (!plugin || !structureLoaded) return;
    if (!ligandColors || Object.keys(ligandColors).length === 0) return;

    let cancelled = false;

    (async () => {
      try {
        const { MolScriptBuilder: MS, Color, StructureSelectionQuery } = await getMolstarModules();

        const hierarchy = plugin.managers.structure.hierarchy.current;
        if (!hierarchy || cancelled) return;

        // Build ligand color map
        const ligandPalette: Record<string, number> = {};
        for (const [ligCode, colorHex] of Object.entries(ligandColors)) {
          const colorNum = parseInt(colorHex.replace('#', ''), 16);
          ligandPalette[ligCode] = colorNum;
        }

        // Strategy 1: Use updateRepresentationsTheme for per-ligand components (most reliable)
        for (const structure of hierarchy.structures) {
          for (const component of structure.components) {
            const label = component.cell?.obj?.label || '';
            const ligMatch = label.match(/^Ligand\s+(.+)$/);
            if (!ligMatch) continue;

            const ligCode = ligMatch[1];
            const colorNum = ligandPalette[ligCode];
            if (colorNum === undefined) continue;

            if (component.representations.length > 0) {
              try {
                await plugin.managers.structure.component.updateRepresentationsTheme(
                  [component],
                  {
                    color: 'uniform' as const,
                    colorParams: { value: Color(colorNum) },
                  }
                );
              } catch { /* ignore per-component theme errors */ }
            }
          }
        }

        if (cancelled) return;

        // Strategy 2: Use applyTheme overpaint as fallback
        for (const [ligCode, colorHex] of Object.entries(ligandColors)) {
          if (cancelled) break;
          try {
            const expression = MS.struct.generator.atomGroups({
              'atom-test': MS.core.rel.eq([MS.ammp('label_comp_id'), ligCode])
            });
            const ligQuery = StructureSelectionQuery(
              `Ligand ${ligCode}`,
              expression,
              { category: 'Ligand', isHidden: true }
            );

            const colorNum = parseInt(colorHex.replace('#', ''), 16);
            await plugin.managers.structure.component.applyTheme({
              selection: ligQuery,
              action: { name: 'color' as const, params: { color: Color(colorNum) } },
              representations: [],
            });
          } catch (e) {
            // Suppress per-ligand color failures
          }
        }
      } catch { /* ignore */ }
    })();

    return () => { cancelled = true; };
  }, [ligandColors, structureLoaded, representation, perLigandComponentsReady]);

  // ─── Entity visibility effect ─────────────────────────────────────────
  useEffect(() => {
    const plugin = pluginRef.current;
    if (!plugin || !perChainComponentsReady) return;

    (async () => {
      try {
        const hierarchy = plugin.managers.structure.hierarchy.current;
        if (!hierarchy) return;

        for (const structure of hierarchy.structures) {
          for (const component of structure.components) {
            const label = component.cell?.obj?.label || '';
            const chainMatch = label.match(/^Chain\s+(.+)$/);
            if (!chainMatch) continue;

            const chainId = chainMatch[1];
            const entityKey = `${pdbId}.${chainId}`;

            // If a solo entity is set, show only that one
            let shouldShow: boolean;
            if (soloEntity) {
              shouldShow = entityKey === soloEntity;
            } else {
              shouldShow = entityVisibility[entityKey] !== false;
            }

            try {
              plugin.managers.structure.hierarchy.toggleVisibility(
                [component],
                shouldShow ? 'show' : 'hide'
              );
            } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }
    })();
  }, [entityVisibility, soloEntity, perChainComponentsReady, pdbId]);

  // ─── Ligand visibility effect ─────────────────────────────────────────
  useEffect(() => {
    const plugin = pluginRef.current;
    if (!plugin || !perLigandComponentsReady) return;

    (async () => {
      try {
        const hierarchy = plugin.managers.structure.hierarchy.current;
        if (!hierarchy) return;

        for (const structure of hierarchy.structures) {
          for (const component of structure.components) {
            const label = component.cell?.obj?.label || '';
            const ligMatch = label.match(/^Ligand\s+(.+)$/);
            if (!ligMatch) continue;

            const ligCode = ligMatch[1];

            let shouldShow: boolean;
            if (soloLigand) {
              shouldShow = ligCode === soloLigand;
            } else {
              shouldShow = ligandVisibility[ligCode] !== false;
            }

            try {
              plugin.managers.structure.hierarchy.toggleVisibility(
                [component],
                shouldShow ? 'show' : 'hide'
              );
            } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }
    })();
  }, [ligandVisibility, soloLigand, perLigandComponentsReady]);

  // ─── Actions ──────────────────────────────────────────────────────────

  const handleResetCamera = useCallback(async () => {
    const plugin = pluginRef.current;
    if (!plugin) return;
    try {
      const { PluginCommands } = await getMolstarModules();
      PluginCommands.Camera.Reset(plugin, { durationMs: 600 });
    } catch (err) {
      console.warn('[PdbStructureViewer] Reset camera error:', err);
    }
  }, []);

  const handleScreenshot = useCallback(async () => {
    const plugin = pluginRef.current;
    if (!plugin) return;
    try {
      // Try Molstar's built-in screenshot helper first
      if (plugin.helpers?.viewportScreenshot) {
        await plugin.helpers.viewportScreenshot.download({
          name: pdbId.toUpperCase(),
          transparency: backgroundMode === 'transparent' ? 'scene' : undefined,
        });
        return;
      }

      // Fallback: capture from canvas directly
      const canvas = containerRef.current?.querySelector('canvas');
      if (canvas) {
        const dataUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = `${pdbId.toUpperCase()}.png`;
        link.href = dataUrl;
        link.click();
        return;
      }

      // Last resort: try exportScreenshots
      const canvas3d = plugin.canvas3d;
      if (canvas3d) {
        const dataUrl = await canvas3d.exportScreenshots([
          { width: canvas3d.webgl.maxViewportDimension, height: canvas3d.webgl.maxViewportDimension },
        ]);
        if (dataUrl && dataUrl[0]?.data) {
          const link = document.createElement('a');
          link.href = dataUrl[0].data;
          link.download = `${pdbId.toUpperCase()}-screenshot.png`;
          link.click();
        }
      }
    } catch (err) {
      console.warn('[PdbStructureViewer] Screenshot failed:', err);
    }
  }, [pdbId, backgroundMode]);

  const handleToggleSpin = useCallback(async () => {
    const plugin = pluginRef.current;
    if (!plugin) return;
    try {
      const { PluginCommands } = await getMolstarModules();
      const newSpinState = !isSpinning;

      // Toggle auto-rotation via Canvas3D trackball animate setting
      if (plugin.canvas3d) {
        const currentProps = plugin.canvas3d.props;
        const trackball = currentProps.trackball;

        if (newSpinState) {
          PluginCommands.Canvas3D.SetSettings(plugin, {
            settings: {
              trackball: {
                ...trackball,
                animate: { name: 'spin', params: { speed: 0.5, axis: [0, -1, 0] } },
              },
            },
          });
        } else {
          PluginCommands.Canvas3D.SetSettings(plugin, {
            settings: {
              trackball: {
                ...trackball,
                animate: { name: 'off' },
              },
            },
          });
        }
      }

      setIsSpinning(newSpinState);
    } catch (err) {
      console.warn('[PdbStructureViewer] Toggle spin error:', err);
    }
  }, [isSpinning]);

  const handleToggleBackground = useCallback(() => {
    const modes: BackgroundMode[] = ['theme', 'white', 'dark', 'transparent'];
    const idx = modes.indexOf(backgroundMode);
    setBackgroundMode(modes[(idx + 1) % modes.length]);
  }, [backgroundMode]);

  const handleToggleFullscreen = useCallback(() => {
    const wrapper = containerRef.current?.closest('.pdb-viewer-wrapper');
    const target = wrapper || containerRef.current;
    if (!target) return;

    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      target.requestFullscreen();
    }
  }, []);

  const handleFocusOnTarget = useCallback(async (target: string, type: 'entity' | 'ligand') => {
    const plugin = pluginRef.current;
    if (!plugin || !structureLoaded) return;

    try {
      const { PluginCommands } = await getMolstarModules();

      // Clear previous highlights
      PluginCommands.Interactivity.ClearHighlights(plugin);

      // Apply dimming to non-target elements
      try {
        const currentProps = plugin.canvas3d?.props;
        if (currentProps) {
          PluginCommands.Canvas3D.SetSettings(plugin, {
            settings: {
              ...currentProps,
              select: {
                ...(currentProps as any).select,
                dim: {
                  color: 0x444444,
                  opacity: 0.4,
                },
              },
              highlight: {
                ...(currentProps as any).highlight,
                color: 0xffb800,
              },
            } as any,
          });
        }
      } catch {
        // dimming not supported
      }

      // Find the matching component and highlight it
      const hierarchy = plugin.managers.structure.hierarchy.current;
      if (hierarchy) {
        for (const structure of hierarchy.structures) {
          for (const component of structure.components) {
            const label = component.cell?.obj?.label || '';
            let matches = false;

            if (type === 'entity') {
              const chainId = target.split('.')[1];
              if (chainId) {
                matches = label === `Chain ${chainId}`;
              }
            } else {
              matches = label === `Ligand ${target}`;
            }

            if (matches && component.representations.length > 0) {
              const refs = component.representations.map((r: any) => r.cell?.transform?.ref).filter(Boolean);
              if (refs.length > 0) {
                PluginCommands.Interactivity.Object.Highlight(plugin, {
                  state: plugin.state.data,
                  ref: refs,
                });
              }
            }
          }
        }
      }

      // Focus camera on target using per-component focus
      try {
        const { MolScriptBuilder: MS, compile, Script } = await getMolstarModules();
        let expression: any;
        if (type === 'entity') {
          const chainId = target.split('.')[1];
          if (!chainId) return;
          expression = MS.struct.generator.atomGroups({
            'chain-test': MS.core.rel.eq([MS.ammp('auth_asym_id'), chainId])
          });
        } else {
          expression = MS.struct.generator.atomGroups({
            'atom-test': MS.core.rel.eq([MS.ammp('label_comp_id'), target])
          });
        }

        const compiled = compile(expression);
        const script = Script(compiled, 'mol-script');
        const selection = await plugin.managers.structure.selection.fromSelectionScript(script, { focus: true });
        if (selection) {
          plugin.managers.camera.focusSelection(selection);
        } else {
          // Fallback: just reset camera
          plugin.managers?.camera?.reset(undefined, 400);
        }
      } catch {
        // If selection-based focus fails, just reset camera
        plugin.managers?.camera?.reset(undefined, 400);
      }
    } catch (err) {
      console.warn('[PdbStructureViewer] Focus error:', err);
    }
  }, [structureLoaded]);

  const changeRepresentation = useCallback(async (type: RepresentationType) => {
    setRepresentation(type);
    const plugin = pluginRef.current;
    if (!plugin) return;

    // Map internal type to Molstar representation type string
    // Valid Molstar types: cartoon, ball-and-stick, molecular-surface, gaussian-surface, etc.
    const molstarReprType = type === 'ball-stick' ? 'ball-and-stick' : type === 'surface' ? 'molecular-surface' : 'cartoon';

    try {
      const { Color } = await getMolstarModules();

      // Wrap the entire representation change in a single dataTransaction
      // to ensure the remove + add happens atomically. Without this,
      // switching from surface to ball-and-stick can leave the surface
      // mesh visible because the WebGL cleanup hasn't completed before
      // the new representation is added.
      await plugin.dataTransaction(async () => {
        const hierarchy = plugin.managers.structure.hierarchy.current;
        if (!hierarchy || hierarchy.structures.length === 0) return;

        // Collect per-chain and per-ligand components, also track default components
        const chainComponents: any[] = [];
        const ligandComponents: any[] = [];
        const defaultComponents: any[] = [];

        for (const structure of hierarchy.structures) {
          for (const component of structure.components) {
            const label = component.cell?.obj?.label || '';
            if (label.startsWith('Chain ')) {
              chainComponents.push(component);
            } else if (label.startsWith('Ligand ')) {
              ligandComponents.push(component);
            } else {
              defaultComponents.push(component);
            }
          }
        }

        // 1. Remove all existing representations from per-chain and per-ligand components
        const allCustomComponents = [...chainComponents, ...ligandComponents];
        if (allCustomComponents.length > 0) {
          // Collect all representation refs to remove explicitly (with null safety)
          const reprsToRemove: any[] = [];
          for (const comp of allCustomComponents) {
            for (const repr of comp.representations) {
              if (repr?.cell?.transform?.ref) reprsToRemove.push(repr);
            }
          }
          if (reprsToRemove.length > 0) {
            try {
              await plugin.managers.structure.hierarchy.remove(reprsToRemove, true);
            } catch {
              // Fallback: use the component manager's removeRepresentations
              try {
                const p = plugin.managers.structure.component.removeRepresentations(allCustomComponents);
                if (p) await p;
              } catch { /* ignore */ }
            }
          } else {
            // No valid reprs found via ref, try the component manager approach directly
            try {
              const p = plugin.managers.structure.component.removeRepresentations(allCustomComponents);
              if (p) await p;
            } catch { /* ignore */ }
          }
        }

        // 2. Also handle default polymer component: remove its existing representations
        for (const defaultComp of defaultComponents) {
          const label = (defaultComp.cell?.obj?.label || '').toLowerCase();
          if (label === 'polymer' || label === 'chain' || label.startsWith('polymer')) {
            const defaultReprs = [...defaultComp.representations].filter((r: any) => r?.cell?.transform?.ref);
            if (defaultReprs.length > 0) {
              try {
                await plugin.managers.structure.hierarchy.remove(defaultReprs, true);
              } catch { /* ignore */ }
            }
          }
        }

        // 3. Add new representations for per-chain components
        if (chainComponents.length > 0) {
          const p = plugin.managers.structure.component.addRepresentation(chainComponents, molstarReprType);
          if (p) await p;
        }

        // 4. Add ball-and-stick for per-ligand components
        if (ligandComponents.length > 0) {
          const p = plugin.managers.structure.component.addRepresentation(ligandComponents, 'ball-and-stick');
          if (p) await p;
        }

        // 5. Re-add representation to default polymer component (stays hidden)
        for (const defaultComp of defaultComponents) {
          const label = (defaultComp.cell?.obj?.label || '').toLowerCase();
          if (label === 'polymer' || label === 'chain' || label.startsWith('polymer')) {
            try {
              const p = plugin.managers.structure.component.addRepresentation([defaultComp], molstarReprType);
              if (p) await p;
              try {
                plugin.managers.structure.hierarchy.toggleVisibility([defaultComp], 'hide');
              } catch { /* ignore */ }
            } catch { /* ignore */ }
          }
        }
      }, { canUndo: 'Change Representation' });

      // 6. Re-apply colors after the transaction completes
      //    Wait briefly for new representations to be ready in the state tree
      await new Promise(resolve => setTimeout(resolve, 100));

      const updatedHierarchy = plugin.managers.structure.hierarchy.current;
      for (const structure of updatedHierarchy.structures) {
        for (const component of structure.components) {
          const label = component.cell?.obj?.label || '';
          const chainMatch = label.match(/^Chain\s+(.+)$/);
          const ligMatch = label.match(/^Ligand\s+(.+)$/);

          if (chainMatch) {
            const chainId = chainMatch[1];
            const entityKey = `${pdbId}.${chainId}`;
            const colorHex = entityColors[entityKey];
            if (colorHex && component.representations.length > 0) {
              try {
                const colorNum = parseInt(colorHex.replace('#', ''), 16);
                await plugin.managers.structure.component.updateRepresentationsTheme(
                  [component],
                  { color: 'uniform' as const, colorParams: { value: Color(colorNum) } }
                );
              } catch { /* ignore */ }
            }
          } else if (ligMatch) {
            const ligCode = ligMatch[1];
            const colorHex = ligandColors[ligCode];
            if (colorHex && component.representations.length > 0) {
              try {
                const colorNum = parseInt(colorHex.replace('#', ''), 16);
                await plugin.managers.structure.component.updateRepresentationsTheme(
                  [component],
                  { color: 'uniform' as const, colorParams: { value: Color(colorNum) } }
                );
              } catch { /* ignore */ }
            }
          }
        }
      }
    } catch (err) {
      console.error('[PdbStructureViewer] Failed to change representation:', err);
    }
  }, [entityColors, ligandColors, pdbId]);

  const handleResetColors = useCallback(async () => {
    const chainColors = ['#3182ce', '#e53e3e', '#38a169', '#805ad5', '#dd6b20', '#d53f8c', '#00b5d8', '#d69e2e'];
    const defaultEntityColors: Record<string, string> = {};
    let colorIdx = 0;
    for (const entity of entities) {
      for (const chain of entity.chains) {
        const key = `${pdbId}.${chain.chain}`;
        defaultEntityColors[key] = chainColors[colorIdx % chainColors.length];
        colorIdx++;
      }
    }
    setEntityColors(defaultEntityColors);

    const defaultLigColors: Record<string, string> = {};
    for (const code of ligandCodes) {
      defaultLigColors[code] = '#d69e2e';
    }
    setLigandColors(defaultLigColors);

    // Also reset any overpaint on the 3D view
    const plugin = pluginRef.current;
    if (plugin && structureLoaded) {
      try {
        const { MolScriptBuilder, StructureSelectionQuery } = await getMolstarModules();
        const hierarchy = plugin.managers.structure.hierarchy.current;
        if (hierarchy) {
          for (const entity of entities) {
            for (const chain of entity.chains) {
              try {
                const chainId = chain.chain;
                const expression = createChainSelectionQuery(MolScriptBuilder, chainId);
                const chainQuery = StructureSelectionQuery(
                  `Chain ${chainId}`,
                  expression,
                  { category: 'Chain', isHidden: true }
                );
                await plugin.managers.structure.component.applyTheme({
                  selection: chainQuery,
                  action: { name: 'resetColor' as const, params: {} },
                  representations: [],
                });
              } catch { /* ignore */ }
            }
          }
          // Also reset ligand overpaint
          for (const ligCode of ligandCodes) {
            try {
              const { MolScriptBuilder: MS } = await getMolstarModules();
              const expression = MS.struct.generator.atomGroups({
                'atom-test': MS.core.rel.eq([MS.ammp('label_comp_id'), ligCode])
              });
              const ligQuery = StructureSelectionQuery(
                `Ligand ${ligCode}`,
                expression,
                { category: 'Ligand', isHidden: true }
              );
              await plugin.managers.structure.component.applyTheme({
                selection: ligQuery,
                action: { name: 'resetColor' as const, params: {} },
                representations: [],
              });
            } catch { /* ignore */ }
          }
        }
      } catch { /* ignore reset errors */ }
    }
  }, [entities, ligandCodes, pdbId, structureLoaded]);

  const handleToggleAllLigands = useCallback(() => {
    const allVisible = ligandCodes.every(code => ligandVisibility[code] !== false);
    const newVis: Record<string, boolean> = {};
    for (const code of ligandCodes) {
      newVis[code] = !allVisible;
    }
    setLigandVisibility(newVis);
    setSoloLigand(null);
  }, [ligandCodes, ligandVisibility]);

  const handleToggleAllExpanded = useCallback(() => {
    const allExpanded = entitiesExpanded && ligandsExpanded;
    setEntitiesExpanded(!allExpanded);
    setLigandsExpanded(!allExpanded);
    if (!allExpanded) {
      // Expand all chains too
      const newCollapsed: Record<string, boolean> = {};
      setCollapsedChains(newCollapsed);
    }
  }, [entitiesExpanded, ligandsExpanded]);

  const handleColorDotClick = useCallback((e: React.MouseEvent, type: 'entity' | 'ligand', key: string) => {
    e.stopPropagation();
    const anchorEl = e.currentTarget as HTMLElement;
    setColorPickerTarget(prev => {
      if (prev?.type === type && prev?.key === key) return null;
      return { type, key, anchor: anchorEl };
    });
  }, []);

  const closeColorPicker = useCallback(() => {
    setColorPickerTarget(null);
  }, []);

  const handleEntityColorChange = useCallback((entityKey: string, color: string) => {
    setEntityColors(prev => ({ ...prev, [entityKey]: color }));
  }, []);

  const handleLigandColorChange = useCallback((ligandCode: string, color: string) => {
    setLigandColors(prev => ({ ...prev, [ligandCode]: color }));
  }, []);

  const handleEntityVisibilityChange = useCallback((entityKey: string, visible: boolean) => {
    setEntityVisibility(prev => ({ ...prev, [entityKey]: visible }));
    if (!visible) {
      setSoloEntity(prev => prev === entityKey ? null : prev);
    }
  }, []);

  const handleLigandVisibilityChange = useCallback((ligandCode: string, visible: boolean) => {
    setLigandVisibility(prev => ({ ...prev, [ligandCode]: visible }));
    if (!visible) {
      setSoloLigand(prev => prev === ligandCode ? null : prev);
    }
  }, []);

  const handleSoloEntity = useCallback((entityKey: string | null) => {
    setSoloEntity(entityKey);
    if (entityKey) {
      setSoloLigand(null);
    }
  }, []);

  const handleSoloLigand = useCallback((ligandCode: string | null) => {
    setSoloLigand(ligandCode);
    if (ligandCode) {
      setSoloEntity(null);
    }
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────

  if (!mounted) return null;

  const backgroundIcon = backgroundMode === 'dark' ? <Moon className="w-3.5 h-3.5" /> : backgroundMode === 'white' ? <Sun className="w-3.5 h-3.5" /> : isDark ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />;

  const isSideBySide = layout === 'side-by-side';

  // ─── Entity Panel Content (shared between layouts) ──────────────────────
  const entityPanelContent = (entities.length > 0 || ligandCodes.length > 0) ? (
    <div className={`${isSideBySide ? '' : 'border-t border-claude-border/40 dark:border-[#3d3832]/40 bg-claude-surface dark:bg-[#242220] max-h-72'} overflow-y-auto pdb-entity-scroll`}>
      {/* Entities Section */}
      {entities.length > 0 && (
        <Collapsible open={entitiesExpanded} onOpenChange={setEntitiesExpanded}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-1.5 w-full px-2.5 py-1.5 hover:bg-claude-border-light/40 dark:hover:bg-[#2b2926]/40 transition-colors">
              <ChevronDown className={`w-3 h-3 text-claude-text-muted transition-transform ${entitiesExpanded ? '' : '-rotate-90'}`} />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-claude-text-muted">{locale === 'zh' ? '实体' : 'Entities'}</span>
              <span className="text-[9px] text-claude-text-muted ml-1">({entities.length})</span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-1.5 pb-1.5 space-y-0.5">
              {entities.map((entity) => {
                const badge = getMoleculeBadge(entity.molecule_type);
                if (badge === 'WAT') return null;
                const entityKey = `${pdbId}.entity-${entity.entity_id}`;
                const isExpanded = !collapsedChains[entityKey];
                const totalResidues = entity.chains.reduce((sum, c) => sum + (c.length ?? 0), 0);

                return (
                  <div key={entity.entity_id} className="rounded-md border border-claude-border-light/60 dark:border-[#3d3832]/40 overflow-hidden">
                    {/* Entity header */}
                    <button
                      onClick={() => setCollapsedChains(prev => ({ ...prev, [entityKey]: !prev[entityKey] }))}
                      className="flex items-center gap-1.5 w-full px-2 py-1 text-left hover:bg-claude-border-light/40 dark:hover:bg-[#2b2926]/40 transition-colors"
                    >
                      <ChevronDown className={`w-3 h-3 text-claude-text-muted transition-transform flex-shrink-0 ${isExpanded ? '' : '-rotate-90'}`} />
                      <MoleculeBadgeTag type={entity.molecule_type} />
                      <span className="text-[10px] text-claude-text font-medium truncate flex-1 min-w-0">
                        {entity.description || `Entity ${entity.entity_id}`}
                      </span>
                      {entity.organism && (
                        <span className="text-[8px] text-claude-text-muted truncate max-w-[60px]" title={entity.organism}>
                          {entity.organism}
                        </span>
                      )}
                      {entity.gene_name && (
                        <span className="text-[8px] px-1 py-0.5 rounded bg-claude-accent-light text-claude-accent border border-claude-accent/20 font-semibold truncate max-w-[50px]">
                          {entity.gene_name}
                        </span>
                      )}
                      {totalResidues > 0 && (
                        <span className="text-[8px] text-claude-text-muted whitespace-nowrap" title={`${totalResidues} total residues`}>
                          {totalResidues.toLocaleString()} res
                        </span>
                      )}
                    </button>

                    {/* Chains */}
                    {isExpanded && (
                      <div className="px-1 pb-1 space-y-0.5">
                        {entity.chains.map((chain) => (
                          <ChainRowItem
                            key={chain.chain}
                            chain={chain}
                            pdbId={pdbId}
                            entityColors={entityColors}
                            entityVisibility={entityVisibility}
                            soloEntity={soloEntity}
                            onColorDotClick={handleColorDotClick}
                            onEntityVisibilityChange={handleEntityVisibilityChange}
                            onSoloEntity={handleSoloEntity}
                            onFocusOnTarget={handleFocusOnTarget}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Ligands Section */}
      {ligandCodes.length > 0 && (
        <Collapsible open={ligandsExpanded} onOpenChange={setLigandsExpanded}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-1.5 w-full px-2.5 py-1.5 hover:bg-claude-border-light/40 dark:hover:bg-[#2b2926]/40 transition-colors border-t border-claude-border-light/40 dark:border-[#3d3832]/30">
              <ChevronDown className={`w-3 h-3 text-claude-text-muted transition-transform ${ligandsExpanded ? '' : '-rotate-90'}`} />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-claude-text-muted">{locale === 'zh' ? '配体' : 'Ligands'}</span>
              <span className="text-[9px] text-claude-text-muted ml-1">({ligandCodes.length})</span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-1.5 pb-1.5 space-y-0.5">
              {ligandCodes.map((code) => (
                <LigandRowItem
                  key={code}
                  code={code}
                  ligandColors={ligandColors}
                  ligandVisibility={ligandVisibility}
                  soloLigand={soloLigand}
                  onColorDotClick={handleColorDotClick}
                  onLigandVisibilityChange={handleLigandVisibilityChange}
                  onSoloLigand={handleSoloLigand}
                  onFocusOnTarget={handleFocusOnTarget}
                />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  ) : null;

  return (
    <div className={`pdb-viewer-wrapper flex flex-col rounded-lg border border-claude-border/60 dark:border-[#3d3832]/60 overflow-hidden bg-[#faf8f5] dark:bg-[#1a1917] ${isSideBySide ? 'h-full w-full' : ''} ${className}`}>
      {/* ─── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-0.5 px-1.5 py-1 bg-claude-border-light/50 dark:bg-[#2b2926]/50 border-b border-claude-border/40 dark:border-[#3d3832]/40 overflow-x-auto flex-shrink-0">
        <span className="text-[10px] font-mono font-bold text-claude-accent mr-1 uppercase tracking-wider flex-shrink-0">
          {pdbId}
        </span>
        <div className="w-px h-3.5 bg-claude-border/60 dark:bg-[#3d3832]/60 flex-shrink-0" />

        <ToolbarButton onClick={handleResetCamera} icon={<RotateCcw className="w-3.5 h-3.5" />} label="Reset Camera" />
        <ToolbarButton onClick={handleScreenshot} icon={<Camera className="w-3.5 h-3.5" />} label="Screenshot (PNG)" disabled={!structureLoaded} />
        <ToolbarButton onClick={handleToggleSpin} icon={<RefreshCw className={`w-3.5 h-3.5 ${isSpinning ? 'animate-spin' : ''}`} />} label={isSpinning ? 'Stop Rotation' : 'Auto-Rotate'} active={isSpinning} disabled={!structureLoaded} />
        <ToolbarButton onClick={handleToggleBackground} icon={backgroundIcon} label={`Background: ${BACKGROUND_LABELS[backgroundMode]}`} />
        <ToolbarButton onClick={handleToggleFullscreen} icon={isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />} label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'} />

        <div className="w-px h-3.5 bg-claude-border/60 dark:bg-[#3d3832]/60 flex-shrink-0" />

        {/* Representation buttons */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => changeRepresentation('cartoon')}
              className={`flex items-center justify-center w-7 h-7 rounded-md border transition-all duration-150 flex-shrink-0 ${
                representation === 'cartoon'
                  ? 'bg-claude-accent text-white border-claude-accent/60 shadow-sm'
                  : 'bg-claude-surface/80 border-claude-border-light text-claude-text-secondary hover:text-claude-text hover:bg-claude-surface hover:border-claude-border shadow-sm'
              }`}
            >
              <Hexagon className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="bg-claude-surface text-claude-text border border-claude-border shadow-lg">Cartoon</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => changeRepresentation('ball-stick')}
              className={`flex items-center justify-center w-7 h-7 rounded-md border transition-all duration-150 flex-shrink-0 ${
                representation === 'ball-stick'
                  ? 'bg-claude-accent text-white border-claude-accent/60 shadow-sm'
                  : 'bg-claude-surface/80 border-claude-border-light text-claude-text-secondary hover:text-claude-text hover:bg-claude-surface hover:border-claude-border shadow-sm'
              }`}
            >
              <FlaskConical className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="bg-claude-surface text-claude-text border border-claude-border shadow-lg">Ball &amp; Stick</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => changeRepresentation('surface')}
              className={`flex items-center justify-center w-7 h-7 rounded-md border transition-all duration-150 flex-shrink-0 ${
                representation === 'surface'
                  ? 'bg-claude-accent text-white border-claude-accent/60 shadow-sm'
                  : 'bg-claude-surface/80 border-claude-border-light text-claude-text-secondary hover:text-claude-text hover:bg-claude-surface hover:border-claude-border shadow-sm'
              }`}
            >
              <Dna className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="bg-claude-surface text-claude-text border border-claude-border shadow-lg">Surface</TooltipContent>
        </Tooltip>

        <div className="w-px h-3.5 bg-claude-border/60 dark:bg-[#3d3832]/60 flex-shrink-0" />

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleResetColors}
              className="flex items-center justify-center w-7 h-7 rounded-md backdrop-blur-sm border bg-claude-surface/80 border-claude-border-light text-claude-text-secondary hover:text-claude-accent hover:bg-claude-surface hover:border-claude-border shadow-sm transition-all duration-150 flex-shrink-0"
            >
              <Palette className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="bg-claude-surface text-claude-text border border-claude-border shadow-lg">Reset all colors</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleToggleAllLigands}
              className="flex items-center justify-center w-7 h-7 rounded-md backdrop-blur-sm border bg-claude-surface/80 border-claude-border-light text-claude-text-secondary hover:text-claude-accent hover:bg-claude-surface hover:border-claude-border shadow-sm transition-all duration-150 flex-shrink-0"
            >
              <Layers className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="bg-claude-surface text-claude-text border border-claude-border shadow-lg">Show/Hide all ligands</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleToggleAllExpanded}
              className="flex items-center justify-center w-7 h-7 rounded-md backdrop-blur-sm border bg-claude-surface/80 border-claude-border-light text-claude-text-secondary hover:text-claude-accent hover:bg-claude-surface hover:border-claude-border shadow-sm transition-all duration-150 flex-shrink-0"
            >
              {entitiesExpanded && ligandsExpanded ? <FoldVertical className="w-3.5 h-3.5" /> : <UnfoldVertical className="w-3.5 h-3.5" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="bg-claude-surface text-claude-text border border-claude-border shadow-lg">Expand/Collapse all</TooltipContent>
        </Tooltip>

        <div className="w-px h-3.5 bg-claude-border/60 dark:bg-[#3d3832]/60 flex-shrink-0" />

        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href={`https://www.rcsb.org/structure/${pdbId.toUpperCase()}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center w-7 h-7 rounded-md backdrop-blur-sm border bg-claude-surface/80 border-claude-border-light text-claude-text-secondary hover:text-claude-text hover:bg-claude-surface hover:border-claude-border shadow-sm transition-all duration-150 flex-shrink-0"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="bg-claude-surface text-claude-text border border-claude-border shadow-lg">View on RCSB PDB</TooltipContent>
        </Tooltip>
      </div>

      {/* ─── 3D Viewer + Entity Panel ──────────────────────────────────── */}
      {isSideBySide ? (
        /* Side-by-side layout for modal: 3D ~70% | Entity panel ~30% */
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* 3D Canvas - left side (~70%) */}
          <div className="relative min-w-0 flex-1 overflow-hidden" style={{ flexBasis: '70%' }}>
            {loading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#faf8f5]/80 dark:bg-[#1a1917]/80 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-3">
                  <Box className="h-8 w-8 text-claude-accent animate-pulse" />
                  <div className="flex items-center gap-2 text-xs text-claude-text-muted">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Loading {pdbId}...</span>
                  </div>
                  <div className="w-48 h-1.5 bg-claude-border-light dark:bg-[#2b2926] rounded-full overflow-hidden">
                    <div className="h-full bg-claude-accent/40 rounded-full animate-pulse" style={{ width: '60%' }} />
                  </div>
                </div>
              </div>
            )}
            {error && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#faf8f5]/80 dark:bg-[#1a1917]/80">
                <div className="flex flex-col items-center gap-2 p-4 text-center">
                  <AlertCircle className="h-6 w-6 text-amber-500" />
                  <p className="text-xs text-claude-text-secondary max-w-[200px]">{error}</p>
                </div>
              </div>
            )}

            {/* Stats overlay */}
            {structureLoaded && (atomCount > 0 || residueCount > 0) && (
              <div className="absolute bottom-2 left-2 z-10 flex items-center gap-2 px-2 py-1 rounded-md bg-claude-surface/60 backdrop-blur-sm border border-claude-border-light/60">
                <span className="text-[10px] font-medium text-claude-text-secondary flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-claude-accent" />
                  {representation === 'cartoon' ? 'Cartoon' : representation === 'ball-stick' ? 'Ball & Stick' : 'Surface'}
                </span>
                <span className="text-[10px] font-mono text-claude-text-muted">{formatCount(atomCount)} atoms</span>
                {residueCount > 0 && (
                  <span className="text-[10px] font-mono text-claude-text-muted">{formatCount(residueCount)} residues</span>
                )}
              </div>
            )}

            <div ref={containerRef} className="absolute inset-0 molstar-viewer" />
          </div>

          {/* Entity Panel - right side (~30%), clearly separated */}
          <div className="min-w-[240px] max-w-[380px] border-l border-claude-border/60 dark:border-[#3d3832]/60 bg-claude-surface dark:bg-[#242220] overflow-y-auto pdb-entity-scroll" style={{ flex: '0 0 30%' }}>
            {entityPanelContent || (
              /* Show loading state when entities haven't loaded yet */
              <div className="h-full flex flex-col items-center justify-center gap-2 px-4 py-6">
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 text-claude-accent animate-spin" />
                    <span className="text-[10px] text-claude-text-muted">{locale === 'zh' ? '实体加载中…' : 'Loading entities...'}</span>
                  </>
                ) : structureLoaded ? (
                  <>
                    <Layers className="h-4 w-4 text-claude-border" />
                    <span className="text-[10px] text-claude-text-muted text-center">{locale === 'zh' ? '无实体数据' : 'No entity data available'}</span>
                  </>
                ) : error ? (
                  <>
                    <AlertCircle className="h-4 w-4 text-amber-500" />
                    <span className="text-[10px] text-claude-text-muted text-center">{locale === 'zh' ? '加载失败' : 'Failed to load'}</span>
                  </>
                ) : (
                  <>
                    <Layers className="h-4 w-4 text-claude-border" />
                    <span className="text-[10px] text-claude-text-muted">{locale === 'zh' ? '等待中…' : 'Waiting...'}</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Stacked layout (default) */
        <>
          <div className="relative" style={{ height: '340px' }}>
            {loading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#faf8f5]/80 dark:bg-[#1a1917]/80 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-3">
                  <Box className="h-8 w-8 text-claude-accent animate-pulse" />
                  <div className="flex items-center gap-2 text-xs text-claude-text-muted">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Loading {pdbId}...</span>
                  </div>
                  <div className="w-48 h-1.5 bg-claude-border-light dark:bg-[#2b2926] rounded-full overflow-hidden">
                    <div className="h-full bg-claude-accent/40 rounded-full animate-pulse" style={{ width: '60%' }} />
                  </div>
                </div>
              </div>
            )}
            {error && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#faf8f5]/80 dark:bg-[#1a1917]/80">
                <div className="flex flex-col items-center gap-2 p-4 text-center">
                  <AlertCircle className="h-6 w-6 text-amber-500" />
                  <p className="text-xs text-claude-text-secondary max-w-[200px]">{error}</p>
                </div>
              </div>
            )}

            {/* Stats overlay */}
            {structureLoaded && (atomCount > 0 || residueCount > 0) && (
              <div className="absolute bottom-2 left-2 z-10 flex items-center gap-2 px-2 py-1 rounded-md bg-claude-surface/60 backdrop-blur-sm border border-claude-border-light/60">
                <span className="text-[10px] font-medium text-claude-text-secondary flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-claude-accent" />
                  {representation === 'cartoon' ? 'Cartoon' : representation === 'ball-stick' ? 'Ball & Stick' : 'Surface'}
                </span>
                <span className="text-[10px] font-mono text-claude-text-muted">{formatCount(atomCount)} atoms</span>
                {residueCount > 0 && (
                  <span className="text-[10px] font-mono text-claude-text-muted">{formatCount(residueCount)} residues</span>
                )}
              </div>
            )}

            <div ref={containerRef} className="w-full h-full molstar-viewer" />
          </div>

          {/* Entity Panel below canvas */}
          {entityPanelContent}
        </>
      )}

      {/* Fullscreen modal overlay (only for stacked layout) */}
      {!isSideBySide && (
        <AnimatePresence>
          {isFullscreen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
              onClick={() => setIsFullscreen(false)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="w-full max-w-5xl h-[80vh] rounded-xl overflow-hidden border border-claude-border/60 dark:border-[#3d3832]/60 shadow-2xl bg-[#faf8f5] dark:bg-[#1a1917]"
                onClick={(e) => e.stopPropagation()}
              >
                <PdbStructureViewerFullscreen
                  pdbId={pdbId}
                  isDark={isDark}
                  onClose={() => setIsFullscreen(false)}
                />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* ─── Single Global Color Picker Popup ───────────────────────────────── */}
      {colorPickerTarget && (
        <ColorPickerPopup
          key={`${colorPickerTarget.type}-${colorPickerTarget.key}`}
          currentColor={
            colorPickerTarget.type === 'entity'
              ? entityColors[colorPickerTarget.key] || '#718096'
              : ligandColors[colorPickerTarget.key] || '#d69e2e'
          }
          onColorChange={(newColor) => {
            if (colorPickerTarget.type === 'entity') {
              handleEntityColorChange(colorPickerTarget.key, newColor);
            } else {
              handleLigandColorChange(colorPickerTarget.key, newColor);
            }
          }}
          onClose={closeColorPicker}
          anchorRef={{ current: colorPickerTarget.anchor }}
        />
      )}
    </div>
  );
}

// ─── Fullscreen Viewer ──────────────────────────────────────────────────────

function PdbStructureViewerFullscreen({
  pdbId,
  isDark,
  onClose,
}: {
  pdbId: string;
  isDark: boolean;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pluginRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [representation, setRepresentation] = useState<RepresentationType>('cartoon');
  const [isSpinning, setIsSpinning] = useState(false);

  const bgColor = isDark ? 0x1a1917 : 0xfaf8f5;

  useEffect(() => {
    const init = async () => {
      if (!containerRef.current) return;

      try {
        setLoading(true);
        setError(null);

        const { createPluginUI } = await import('molstar/lib/mol-plugin-ui');
        const { renderReact18 } = await import('molstar/lib/mol-plugin-ui/react18');
        const { DefaultPluginUISpec } = await import('molstar/lib/mol-plugin-ui/spec');

        containerRef.current.innerHTML = '';

        const plugin = await createPluginUI({
          target: containerRef.current,
          render: renderReact18,
          spec: {
            ...DefaultPluginUISpec(),
            layout: {
              initial: {
                isExpanded: false,
                showControls: false,
                regionState: { top: 'hidden', left: 'hidden', right: 'hidden', bottom: 'hidden' },
              },
            },
            components: {
              remoteState: 'none',
              controls: { top: 'none', left: 'none', right: 'none', bottom: 'none' },
            },
          },
        });

        pluginRef.current = plugin;

        const { PluginCommands } = await import('molstar/lib/mol-plugin/commands');
        const { Color } = await import('molstar/lib/mol-util/color/index');

        PluginCommands.Canvas3D.SetSettings(plugin, {
          settings: (props: any) => { props.renderer.backgroundColor = Color(bgColor); },
        });

        const url = `/api/pdb-download/${pdbId.toUpperCase()}`;
        const data = await plugin.builders.data.download(
          { url, isBinary: false },
          { state: { isGhost: true } }
        );
        const trajectory = await plugin.builders.structure.parseTrajectory(data, 'mmcif');
        await plugin.builders.structure.hierarchy.applyPreset(trajectory, 'default', {
          structure: { name: 'model', params: {} },
          showUnitcell: false,
          representationPreset: 'auto',
        });

        setLoading(false);
      } catch (err) {
        console.error('Failed to initialize fullscreen Mol* viewer:', err);
        setError(`Failed to load PDB structure "${pdbId}".`);
        setLoading(false);
      }
    };

    init();

    return () => {
      if (pluginRef.current) {
        pluginRef.current.dispose();
        pluginRef.current = null;
      }
    };
  }, [pdbId, bgColor]);

  const changeRepresentation = useCallback(async (type: RepresentationType) => {
    const plugin = pluginRef.current;
    if (!plugin) return;
    setRepresentation(type);

    // Map internal type to Molstar representation type string
    const molstarReprType = type === 'ball-stick' ? 'ball-and-stick' : type === 'surface' ? 'molecular-surface' : 'cartoon';

    try {
      // Wrap the entire representation change in a single dataTransaction
      // to ensure the remove + add happens atomically, preventing the old
      // surface mesh from remaining visible when switching to ball-and-stick.
      await plugin.dataTransaction(async () => {
        const hierarchy = plugin.managers.structure.hierarchy.current;
        if (!hierarchy || hierarchy.structures.length === 0) return;

        for (const structure of hierarchy.structures) {
          // Collect all representation refs to remove (with null safety)
          const reprsToRemove: any[] = [];
          for (const component of structure.components) {
            for (const repr of component.representations) {
              if (repr?.cell?.transform?.ref) reprsToRemove.push(repr);
            }
          }

          // Remove all representations explicitly
          if (reprsToRemove.length > 0) {
            try {
              await plugin.managers.structure.hierarchy.remove(reprsToRemove, true);
            } catch {
              // Fallback
              try {
                const p = plugin.managers.structure.component.removeRepresentations(structure.components);
                if (p) await p;
              } catch { /* ignore */ }
            }
          } else {
            // Fallback: try component manager directly
            try {
              const p = plugin.managers.structure.component.removeRepresentations(structure.components);
              if (p) await p;
            } catch { /* ignore */ }
          }

          // Add new representations
          const p = plugin.managers.structure.component.addRepresentation(structure.components, molstarReprType);
          if (p) await p;
        }
      }, { canUndo: 'Change Representation' });
    } catch (err) {
      console.error('Failed to change representation:', err);
    }
  }, []);

  const handleToggleSpin = useCallback(async () => {
    const plugin = pluginRef.current;
    if (!plugin) return;
    try {
      const { PluginCommands } = await getMolstarModules();
      const newSpinState = !isSpinning;

      if (plugin.canvas3d) {
        const currentProps = plugin.canvas3d.props;
        const trackball = currentProps.trackball;

        if (newSpinState) {
          PluginCommands.Canvas3D.SetSettings(plugin, {
            settings: {
              trackball: {
                ...trackball,
                animate: { name: 'spin', params: { speed: 0.5, axis: [0, -1, 0] } },
              },
            },
          });
        } else {
          PluginCommands.Canvas3D.SetSettings(plugin, {
            settings: {
              trackball: {
                ...trackball,
                animate: { name: 'off' },
              },
            },
          });
        }
      }

      setIsSpinning(newSpinState);
    } catch { /* ignore */ }
  }, [isSpinning]);

  const handleResetCamera = useCallback(async () => {
    const plugin = pluginRef.current;
    if (!plugin) return;
    try {
      const { PluginCommands } = await getMolstarModules();
      PluginCommands.Camera.Reset(plugin, { durationMs: 600 });
    } catch (err) {
      console.warn('[PdbStructureViewer] Reset camera error:', err);
    }
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-3 py-2 bg-claude-border-light/50 dark:bg-[#2b2926]/50 border-b border-claude-border/40 dark:border-[#3d3832]/40">
        <Box className="h-4 w-4 text-claude-accent" />
        <span className="text-sm font-mono font-bold text-claude-accent uppercase tracking-wider">{pdbId}</span>
        <span className="text-xs text-claude-text-muted ml-1">3D Structure Viewer</span>
        <div className="w-px h-4 bg-claude-border/60 dark:bg-[#3d3832]/60 mx-1.5" />

        <button onClick={handleResetCamera} className="p-1.5 rounded text-claude-text-muted hover:text-claude-accent hover:bg-claude-border-light/60 dark:hover:bg-[#3d3832]/40 transition-colors" title="Reset Camera">
          <RotateCcw className="h-4 w-4" />
        </button>
        <button onClick={handleToggleSpin} className={`p-1.5 rounded transition-colors ${isSpinning ? 'text-claude-accent bg-claude-accent-light' : 'text-claude-text-muted hover:text-claude-accent hover:bg-claude-border-light/60 dark:hover:bg-[#3d3832]/40'}`} title={isSpinning ? 'Stop Rotation' : 'Auto-Rotate'}>
          <RefreshCw className={`h-4 w-4 ${isSpinning ? 'animate-spin' : ''}`} />
        </button>

        <div className="w-px h-4 bg-claude-border/60 dark:bg-[#3d3832]/60 mx-1.5" />

        <button onClick={() => changeRepresentation('cartoon')} className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${representation === 'cartoon' ? 'bg-claude-accent/15 text-claude-accent' : 'text-claude-text-muted hover:text-claude-text-secondary hover:bg-claude-border-light/60 dark:hover:bg-[#3d3832]/40'}`}>Cartoon</button>
        <button onClick={() => changeRepresentation('ball-stick')} className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${representation === 'ball-stick' ? 'bg-claude-accent/15 text-claude-accent' : 'text-claude-text-muted hover:text-claude-text-secondary hover:bg-claude-border-light/60 dark:hover:bg-[#3d3832]/40'}`}>Ball &amp; Stick</button>
        <button onClick={() => changeRepresentation('surface')} className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${representation === 'surface' ? 'bg-claude-accent/15 text-claude-accent' : 'text-claude-text-muted hover:text-claude-text-secondary hover:bg-claude-border-light/60 dark:hover:bg-[#3d3832]/40'}`}>Surface</button>

        <div className="flex-1" />

        <a href={`https://www.rcsb.org/structure/${pdbId}`} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded text-claude-text-muted hover:text-claude-accent hover:bg-claude-border-light/60 dark:hover:bg-[#3d3832]/40 transition-colors">
          <ExternalLink className="h-4 w-4" />
        </a>
        <button onClick={onClose} className="p-1.5 rounded text-claude-text-muted hover:text-claude-accent hover:bg-claude-border-light/60 dark:hover:bg-[#3d3832]/40 transition-colors">
          <Minimize className="h-4 w-4" />
        </button>
      </div>

      {/* Viewer area */}
      <div className="relative flex-1">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#faf8f5]/80 dark:bg-[#1a1917]/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <Box className="h-10 w-10 text-claude-accent animate-pulse" />
              <div className="flex items-center gap-2 text-sm text-claude-text-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Loading {pdbId}...</span>
              </div>
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#faf8f5]/80 dark:bg-[#1a1917]/80">
            <div className="flex flex-col items-center gap-2 p-4 text-center">
              <AlertCircle className="h-8 w-8 text-amber-500" />
              <p className="text-sm text-claude-text-secondary">{error}</p>
            </div>
          </div>
        )}
        <div ref={containerRef} className="w-full h-full molstar-viewer" />
      </div>
    </div>
  );
}

// ─── Lazy-Loading Wrapper ───────────────────────────────────────────────────

export function PdbStructureViewerLazy({ pdbId, className = '', layout = 'stacked' }: PdbStructureViewerProps) {
  const { locale } = useI18n();
  const [shouldLoad, setShouldLoad] = useState(false);

  if (!shouldLoad) {
    return (
      <button
        onClick={() => setShouldLoad(true)}
        className={`flex items-center justify-center gap-2 w-full h-[80px] rounded-lg border border-dashed border-claude-border/60 dark:border-[#3d3832]/60 bg-claude-border-light/20 dark:bg-[#2b2926]/20 hover:bg-claude-border-light/40 dark:hover:bg-[#2b2926]/40 transition-colors cursor-pointer ${className}`}
      >
        <Box className="h-5 w-5 text-claude-accent/60" />
        <span className="text-xs font-medium text-claude-text-muted">{locale === 'zh' ? '加载 3D 查看器' : 'Load 3D Viewer'}</span>
      </button>
    );
  }

  return <PdbStructureViewer pdbId={pdbId} className={className} />;
}
