'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  RotateCcw,
  ExternalLink,
  Loader2,
  AlertTriangle,
  Camera,
  RefreshCw,
  Sun,
  Moon,
  Maximize,
  Minimize,
  Layers,
  Crosshair,
  Download,
  Waves,
  SlidersHorizontal,
  Ruler,
  X,
  EyeOff,
  Palette,
  Eye,
  Box,
  FlaskConical,
  Hexagon,
  Focus,
  Undo2,
  ZoomIn,
  Pipette,
  ChevronRight,
  MousePointerClick,
  Boxes,
  Dna,
  FoldVertical,
  UnfoldVertical,
} from 'lucide-react';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import {
  isChunkLoadError,
  importWithRetry,
  BACKGROUND_COLORS,
  BACKGROUND_LABELS,
  PRESET_COLORS,
  createChainSelectionQuery,
  getMolstarModules,
  checkWebGL,
  MolstarModules,
  ContextMenuState,
  HoverInfoState,
  detectLigandCodes,
} from './molecule-plugin-init';
import {
  ToolbarButton,
  formatCount,
  getBackgroundIcon,
} from './molecule-controls';
import { useI18n } from '@/lib/i18n';
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

export type BackgroundMode = 'theme' | 'white' | 'dark' | 'transparent';

export interface ViewerActions {
  toggleSpin: () => void;
  screenshot: () => void;
  resetCamera: () => void;
  isSpinning: boolean;
  focusOnTarget: (target: string, type: 'entity' | 'ligand') => void;
  focusOnResidue: (chainId: string, residueNumber: number) => void;
}

export interface MoleculeViewerProps {
  pdbId: string;
  highlightEntity?: string | null;
  highlightLigand?: string | null;
  entityColors?: Record<string, string>;
  ligandColors?: Record<string, string>;
  ligandVisibility?: Record<string, boolean>;
  selectedEntities?: Set<string>;
  selectedLigands?: Set<string>;
  soloLigand?: string | null;
  entityVisibility?: Record<string, boolean>;
  soloEntity?: string | null;
  onEntityClick?: (entityKey: string) => void;
  onLigandClick?: (ligandCode: string) => void;
  onEntityHover?: (entityKey: string | null) => void;
  onLigandHover?: (ligandCode: string | null) => void;
  onEntitiesLoaded?: (entities: EntityInfo[]) => void;
  onLigandsDetected?: (ligandCodes: string[]) => void;
  onEntityColorChange?: (entityKey: string, color: string) => void;
  onLigandColorChange?: (ligandCode: string, color: string) => void;
  onResetColors?: () => void;
  onToggleAllLigands?: () => void;
  onToggleAllExpanded?: () => void;
  onRepresentationChange?: (rep: 'cartoon' | 'ball-stick' | 'surface') => void;
  representation?: 'cartoon' | 'ball-stick' | 'surface';
  darkMode?: boolean;
  overlayPdbId?: string | null;
  overlayColorHex?: string;
  showStatsPdbId?: string | null;
  viewerActionsRef?: React.MutableRefObject<ViewerActions | null>;
  onFocusIn3D?: (target: string) => void;
}

// ─── Background colors ──────────────────────────────────────────────────

// (BACKGROUND_COLORS and BACKGROUND_LABELS imported from molecule-plugin-init.ts)

// ─── (ToolbarButton imported from molecule-controls.tsx)

// ─── Helper: resolve ligand code from clicked entity ──────────────────

// Eager WebGL probe — runs once per page. Centralizing it keeps the three
// useState(() => …) blocks below (loading, error, webglNotAvailable) in
// sync and avoids repeating the canvas allocation.
let cachedWebGLAvailable: boolean | null = null;
function detectWebGLAvailable(): boolean {
  if (cachedWebGLAvailable !== null) return cachedWebGLAvailable;
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    cachedWebGLAvailable = false;
    return false;
  }
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    const glCtx = gl as WebGLRenderingContext | null;
    const ctorName = glCtx ? (glCtx as WebGL2RenderingContext).constructor.name : '';
    const ok = ctorName === 'WebGL2RenderingContext' || ctorName === 'WebGLRenderingContext';
    cachedWebGLAvailable = ok;
    return ok;
  } catch {
    cachedWebGLAvailable = false;
    return false;
  }
}

function resolveLigandCode(
  entityId: number,
  entityDesc: string | any[],
  entityData: EntityInfo[],
  knownLigandCodes: string[]
): string | null {
  // Primary: match against known ligand codes using chem_comp_ids from entity data
  const entity = entityData.find((e) => e.entity_id === entityId);

  if (entity?.chem_comp_ids && entity.chem_comp_ids.length > 0) {
    for (const ccId of entity.chem_comp_ids) {
      const upper = ccId.toUpperCase();
      if (upper !== 'HOH' && knownLigandCodes.includes(upper)) {
        return upper;
      }
    }
    // Return first non-water chem_comp_id if no match in known codes
    for (const ccId of entity.chem_comp_ids) {
      const upper = ccId.toUpperCase();
      if (upper !== 'HOH') return upper;
    }
  }

  // Fallback: try to match description against known ligand codes
  const desc = Array.isArray(entityDesc)
    ? entityDesc[0]
    : entityDesc;
  if (typeof desc === 'string') {
    for (const code of knownLigandCodes) {
      if (desc.toUpperCase().includes(code)) {
        return code;
      }
    }
    // Last resort: extract code from description
    const match = desc.match(/(?:^|\s)\(([A-Z][A-Z0-9]{1,2})\)/);
    if (match) return match[1];
    return desc.slice(0, 3).toUpperCase();
  }

  return null;
}

// ─── (PRESET_COLORS imported from molecule-plugin-init.ts)

// ─── (ContextMenuState and HoverInfoState imported from molecule-plugin-init.ts)

export function MoleculeViewer({
  pdbId,
  highlightEntity,
  highlightLigand,
  entityColors,
  ligandColors,
  ligandVisibility,
  selectedEntities,
  selectedLigands,
  onEntityClick,
  onLigandClick,
  onEntityHover,
  onLigandHover,
  onEntitiesLoaded,
  onLigandsDetected,
  onEntityColorChange,
  onLigandColorChange,
  onResetColors,
  onToggleAllLigands,
  onToggleAllExpanded,
  onRepresentationChange,
  representation = 'cartoon',
  darkMode = false,
  overlayPdbId,
  overlayColorHex,
  showStatsPdbId,
  soloLigand,
  entityVisibility,
  soloEntity,
  viewerActionsRef,
  onFocusIn3D,
}: MoleculeViewerProps) {
  const { locale } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const pluginRef = useRef<any>(null);
  const loadedPdbRef = useRef<string | null>(null);
  const loadedOverlayRef = useRef<string | null>(null);
  // Loaded-overlay state mirrors the ref so render-time JSX can show the
  // overlay indicator without accessing a ref during render.
  const [loadedOverlay, setLoadedOverlay] = useState<string | null>(null);
  const disposedRef = useRef(false); // Track disposed state for async operations

  const [loading, setLoading] = useState<boolean>(() => !detectWebGLAvailable());
  const [error, setError] = useState<string | null>(() =>
    detectWebGLAvailable()
      ? null
      : 'WebGL is not available in your browser. Please try a different browser or enable hardware acceleration.'
  );
  const [structureLoaded, setStructureLoaded] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [pluginReady, setPluginReady] = useState(false);
  const [initAttempt, setInitAttempt] = useState(0); // Incremented on retry to re-trigger init effect

  // Toolbar state
  const [isSpinning, setIsSpinning] = useState(false);
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('theme');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [assemblies, setAssemblies] = useState<string[]>([]);
  const [assemblyDescriptions, setAssemblyDescriptions] = useState<Record<string, string>>({});
  const [currentAssembly, setCurrentAssembly] = useState<string>('1');
  const [assemblySwitching, setAssemblySwitching] = useState(false);

  // Stats state
  const [atomCount, setAtomCount] = useState<number>(0);
  const [residueCount, setResidueCount] = useState<number>(0);

  // Focus state - show focus button when something is highlighted
  const [hasHighlight, setHasHighlight] = useState(false);

  // ED Map state
  const [edMapActive, setEdMapActive] = useState(false);
  const [edMapLevel, setEdMapLevel] = useState(1.0);

  // Track entity data after loading
  const entityDataRef = useRef<EntityInfo[]>([]);

  // Known ligand codes for improved click detection
  const knownLigandCodesRef = useRef<string[]>([]);

  // Per-ligand components created flag
  const perLigandComponentsCreatedRef = useRef(false);

  // Track when ligands are detected (for per-ligand component creation)
  const [ligandsReady, setLigandsReady] = useState(false);

  // Track when entity data is loaded (for per-chain component creation)
  const [entitiesReady, setEntitiesReady] = useState(false);

  // State flag to signal that per-ligand components have been created
  // (used as a dependency for visibility/solo effects so they re-run after components exist)
  const [perLigandComponentsReady, setPerLigandComponentsReady] = useState(false);

  // Per-chain components created flag
  const perChainComponentsCreatedRef = useRef(false);

  // State flag to signal that per-chain components have been created
  // (used as a dependency for entity visibility/solo effects so they re-run after components exist)
  const [perChainComponentsReady, setPerChainComponentsReady] = useState(false);

  // Measurement tooltip state
  const lastClickLociRef = useRef<{
    x: number;
    y: number;
    z: number;
    label: string;
    timestamp: number;
  } | null>(null);
  const [measurementTooltip, setMeasurementTooltip] = useState<{
    distance: number;
    from: string;
    to: string;
  } | null>(null);
  const measurementTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Isolate mode state
  const isolatedChainRef = useRef<string | null>(null);
  const [isolateMode, setIsolateMode] = useState<string | null>(null);
  const lastClickTimeRef = useRef<number>(0);
  const lastClickEntityRef = useRef<string | null>(null);

  // Mouse position for tooltip positioning.
  // The ref is kept for callbacks that don't need to trigger renders; the
  // state mirrors it so render-time tooltip positioning can read the latest
  // value without accessing a ref during render.
  const mousePositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });

  // Wrapper (viewer container) dimensions. The ref is used by callbacks that
  // need imperative access (e.g. centering the color-picker context menu);
  // the state mirrors it so render-time tooltip/menu positioning can read
  // the latest value without accessing a ref during render. Updated by a
  // ResizeObserver below.
  const [wrapperSize, setWrapperSize] = useState<{ width: number; height: number }>({
    width: 400,
    height: 400,
  });

  // Isolate mode toggle function ref (used by click handler)
  const toggleIsolateModeRef = useRef<(
    entityKey: string,
    chainId: string
  ) => void>(() => {});

  // Hover info tooltip state
  const [hoverInfo, setHoverInfo] = useState<HoverInfoState | null>(null);
  const hoverInfoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // ─── Persistent 3D selection state ─────────────────────────────────
  const [selectedItem, setSelectedItem] = useState<{
    type: 'entity' | 'ligand';
    key: string;
    chainId?: string;
    entityId?: number;
    entityDesc?: string;
    organism?: string;
    residueCount?: number;
    ligandCode?: string;
    ligandName?: string;
    ligandType?: string;
  } | null>(null);

  // Ref to track previous highlight surface representations for cleanup
  const highlightSurfaceRefs = useRef<string[]>([]);

  // Track last hovered item for right-click context menu (component-level ref)
  const lastHoveredItemRef = useRef<{
    type: 'entity' | 'ligand';
    key: string;
    chainId?: string;
    entityId?: number;
    entityDesc?: string;
    organism?: string;
    residueCount?: number;
    ligandCode?: string;
    ligandName?: string;
    ligandType?: string;
  } | null>(null);

  // Store callback refs to avoid re-subscribing to Molstar events
  const callbackRefs = useRef({
    onEntityClick,
    onLigandClick,
    onEntityHover,
    onLigandHover,
    onEntitiesLoaded,
    onLigandsDetected,
    onEntityColorChange,
    onLigandColorChange,
    pdbId,
  });
  // Keep callback refs in sync with latest props/callbacks after every render.
  // (react-hooks/refs forbids writing refs during render.)
  useEffect(() => {
    callbackRefs.current = {
      onEntityClick,
      onLigandClick,
      onEntityHover,
      onLigandHover,
      onEntitiesLoaded,
      onLigandsDetected,
      onEntityColorChange,
      onLigandColorChange,
      pdbId,
    };
  });

  // ─── Keep wrapper dimensions in state for render-time positioning ───
  // The viewer wrapper can be resized by layout changes (toolbar toggles,
  // window resize, panel collapse). A ResizeObserver keeps state in sync
  // so tooltip/menu positioning in JSX can read the latest size without
  // touching a ref during render.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const update = () => {
      const rect = wrapper.getBoundingClientRect();
      setWrapperSize({
        width: rect.width || wrapper.clientWidth || 400,
        height: rect.height || wrapper.clientHeight || 400,
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, []);

  // ─── Background color based on mode ──────────────────────────────────
  const getBackgroundColor = useCallback(() => {
    if (backgroundMode === 'theme') {
      return darkMode ? 0x1a1917 : 0xfaf8f5;
    }
    return BACKGROUND_COLORS[backgroundMode];
  }, [darkMode, backgroundMode]);

  // ─── Count atoms/residues from plugin ────────────────────────────────
  const updateStats = useCallback(async () => {
    const plugin = pluginRef.current;
    if (!plugin) return;

    try {
      let totalAtoms = 0;
      let totalResidues = 0;

      const hierarchy = plugin.managers.structure.hierarchy.current;
      if (!hierarchy) return;

      for (const structure of hierarchy.structures) {
        const s = structure.cell?.obj?.data;
        if (!s) continue;

        try {
          const { StructureProperties } = await getMolstarModules();
          const models = s.models;
          if (models) {
            for (const model of models) {
              try {
                const atomicRanges = model.atomicHierarchy;
                if (atomicRanges) {
                  totalAtoms += atomicRanges.atoms._rowCount || 0;
                }
                const chainData = model.atomicHierarchy.chainAtomSegments;
                if (chainData) {
                  totalResidues += chainData.count || 0;
                }
              } catch {
                // fallback: just count from structure
              }
            }
          }

          // Simpler fallback: count from element count
          if (totalAtoms === 0) {
            const elementCount = s.elementCount || 0;
            totalAtoms = elementCount;
          }
        } catch {
          // fallback
        }
      }

      if (totalAtoms > 0) setAtomCount(totalAtoms);
      if (totalResidues > 0) setResidueCount(totalResidues);
    } catch {
      // ignore stats errors
    }
  }, []);

  // Ref to always access latest updateStats without adding it to effect deps.
  // Updated after every render to satisfy react-hooks/refs (no ref writes in render).
  const updateStatsRef = useRef(updateStats);
  useEffect(() => {
    updateStatsRef.current = updateStats;
  });

  // ─── WebGL availability check ──────────────────────────────────────
  // WebGL availability is constant for the lifetime of the document, so we
  // evaluate it eagerly via the state initializer (avoids the cascading
  // render that comes from calling setState() inside an effect).
  const [webglNotAvailable, setWebglNotAvailable] = useState<boolean>(() => !detectWebGLAvailable());

  const checkWebGL = useCallback((): boolean => {
    // Cached result from the eager WebGL probe. The browser cannot acquire
    // WebGL during the initial render and then lose it within the same
    // document lifetime, so reusing the boolean is safe here.
    return !webglNotAvailable;
  }, [webglNotAvailable]);

  // ─── Initialize Molstar plugin ───────────────────────────────────────
  // This effect runs ONCE when the container is available. It does NOT
  // depend on getBackgroundColor — background changes are handled by the
  // separate background update effect below.
  useEffect(() => {
    if (!containerRef.current) return;
    // WebGL availability is computed eagerly via the webglNotAvailable state
    // initializer above, so by the time this effect runs we already know
    // whether Molstar can mount. Skipping the effect entirely (rather than
    // calling setState here) satisfies react-hooks/set-state-in-effect.
    if (webglNotAvailable) return;

    disposedRef.current = false;

    async function initPlugin() {
      try {
        const [{ createPluginUI }, { DefaultPluginUISpec }, { renderReact18 }] = await Promise.all(
          [
            importWithRetry(() =>
              import('molstar/lib/mol-plugin-ui/index.js')
            ),
            importWithRetry(() =>
              import('molstar/lib/mol-plugin-ui/spec.js')
            ),
            importWithRetry(() =>
              import('molstar/lib/mol-plugin-ui/react18.js')
            ),
          ]
        );

        if (disposedRef.current || !containerRef.current) return;

        // Pre-load Molstar modules for later use
        await getMolstarModules();

        if (disposedRef.current || !containerRef.current) return;

        const plugin = await createPluginUI({
          target: containerRef.current,
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

        if (disposedRef.current) {
          plugin.dispose();
          return;
        }

        // Verify the plugin actually mounted a canvas (WebGL context was acquired)
        const canvasEl = containerRef.current.querySelector('canvas');
        if (!canvasEl) {
          plugin.dispose();
          if (!disposedRef.current) {
            setWebglNotAvailable(true);
            setError('WebGL is not available in your browser. Please try a different browser or enable hardware acceleration.');
            setLoading(false);
          }
          return;
        }

        pluginRef.current = plugin;
        setPluginReady(true);

        // Set a default background color (light mode warm white).
        // The separate background update effect handles dynamic changes.
        try {
          const { PluginCommands } = await getMolstarModules();
          PluginCommands.Canvas3D.SetSettings(plugin, {
            settings: {
              renderer: {
                ...plugin.canvas3d?.props.renderer,
                backgroundColor: 0xfaf8f5,
              },
            },
          });
        } catch {
          // ignore background color setting errors during init
        }
      } catch (err) {
        if (!disposedRef.current) {
          console.error('[MoleculeViewer] Failed to initialize Molstar:', err);
          // Check if the error is WebGL-related
          const errMsg = err instanceof Error ? err.message : String(err);
          if (errMsg.toLowerCase().includes('webgl') || errMsg.toLowerCase().includes('context')) {
            setWebglNotAvailable(true);
            setError('WebGL is not available in your browser. Please try a different browser or enable hardware acceleration.');
          } else {
            setError(locale === 'zh' ? '3D 查看器初始化失败，请刷新页面。' : 'Failed to initialize 3D viewer. Please refresh the page.');
          }
          setLoading(false);
        }
      }
    }

    initPlugin();

    return () => {
      disposedRef.current = true;
      if (pluginRef.current) {
        try {
          pluginRef.current.dispose();
        } catch {
          // ignore dispose errors
        }
        pluginRef.current = null;
      }
      setPluginReady(false);
      loadedPdbRef.current = null;
      loadedOverlayRef.current = null;
      setLoadedOverlay(null);
      if (measurementTimeoutRef.current) {
        clearTimeout(measurementTimeoutRef.current);
      }
      setStructureLoaded(false);
    };
  }, [initAttempt]);

  // ─── Update background on theme/mode change ──────────────────────────
  // Also fires when pluginReady changes so the correct background is applied
  // after the plugin first initializes (the init effect sets a default light bg).
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
              backgroundColor: getBackgroundColor(),
            },
          },
        });
      } catch {
        // ignore
      }
    })();
  }, [darkMode, backgroundMode, pluginReady, getBackgroundColor]);

  // ─── Fullscreen change listener ──────────────────────────────────────
  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // ─── Escape key handler: clear selection and close context menu ────
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setSelectedItem(null);
        setContextMenu(null);
        // Clear Molstar highlights
        const plugin = pluginRef.current;
        if (plugin) {
          getMolstarModules().then(({ PluginCommands }) => {
            try {
              PluginCommands.Interactivity.ClearHighlights(plugin);
            } catch {
              // ignore
            }
          });
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ─── Click-on-empty to deselect ─────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleMouseDown(e: MouseEvent) {
      // If clicking directly on the canvas container (not a UI overlay),
      // we rely on the Molstar click subscription to set selection.
      // If Molstar doesn't fire a click event (clicked on empty space),
      // we clear selection after a short delay.
    }

    // We use a click-based approach: if no Molstar click fires within 200ms,
    // clear the selection
    let clickTimeout: ReturnType<typeof setTimeout> | null = null;

    function handleContainerClick(e: MouseEvent) {
      // Set a timeout to clear selection; the Molstar click handler will cancel it
      clickTimeout = setTimeout(() => {
        setSelectedItem(null);
      }, 200);
    }

    container.addEventListener('click', handleContainerClick);
    return () => {
      container.removeEventListener('click', handleContainerClick);
      if (clickTimeout) clearTimeout(clickTimeout);
    };
  }, []);

  // Ref to cancel the deselect timeout from Molstar click handler
  const deselectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Track mouse position for measurement tooltip ───────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleMouseMove(e: MouseEvent) {
      const rect = container!.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      mousePositionRef.current = { x, y };
      setMousePosition({ x, y });
    }

    container.addEventListener('mousemove', handleMouseMove);
    return () => container.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // ─── Isolate mode toggle ─────────────────────────────────────────────
  const toggleIsolateMode = useCallback(
    async (entityKey: string, chainId: string) => {
      const plugin = pluginRef.current;
      if (!plugin) return;

      try {
        const hierarchy = plugin.managers.structure.hierarchy.current;
        if (!hierarchy) return;

        // If already isolated on this chain, show all
        if (isolatedChainRef.current === chainId) {
          for (const structure of hierarchy.structures) {
            for (const component of structure.components) {
              plugin.managers.structure.hierarchy.toggleVisibility(
                [component],
                'show'
              );
            }
          }
          isolatedChainRef.current = null;
          setIsolateMode(null);
          return;
        }

        // Isolate this chain: hide non-matching, show matching
        for (const structure of hierarchy.structures) {
          for (const component of structure.components) {
            const compKey = component.key || '';
            const compLabel = component.cell?.obj?.label || '';

            const matches =
              compKey.toLowerCase().includes(chainId.toLowerCase()) ||
              compLabel.toLowerCase().includes(chainId.toLowerCase());

            if (matches) {
              plugin.managers.structure.hierarchy.toggleVisibility(
                [component],
                'show'
              );
            } else {
              plugin.managers.structure.hierarchy.toggleVisibility(
                [component],
                'hide'
              );
            }
          }
        }

        isolatedChainRef.current = chainId;
        setIsolateMode(entityKey);
      } catch (err) {
        console.warn('[MoleculeViewer] Isolate mode error:', err);
      }
    },
    []
  );

  // Keep isolate toggle ref updated after every render
  // (react-hooks/refs forbids writing refs during render).
  useEffect(() => {
    toggleIsolateModeRef.current = toggleIsolateMode;
  });

  // ─── Load PDB structure ──────────────────────────────────────────────
  // Uses pluginReady state + pdbId as the only stable dependencies.
  // Callbacks (onEntitiesLoaded, onLigandsDetected) are read via callbackRefs
  // to avoid infinite re-renders from unstable function references.
  useEffect(() => {
    if (!pdbId || !pluginReady || !pluginRef.current) return;
    if (loadedPdbRef.current === pdbId) return;

    const plugin = pluginRef.current;
    let cancelled = false;

    async function loadStructure() {
      setLoading(true);
      setError(null);
      setStructureLoaded(false);
      setLoadProgress(10);
      setAtomCount(0);
      setResidueCount(0);
      setAssemblies([]);
      setCurrentAssembly('1');
      setLigandsReady(false);
      setEntitiesReady(false);
      perLigandComponentsCreatedRef.current = false;
      setPerLigandComponentsReady(false);
      perChainComponentsCreatedRef.current = false;
      setPerChainComponentsReady(false);

      try {
        const { PluginCommands } = await getMolstarModules();

        if (cancelled || !plugin) return;

        setLoadProgress(20);

        // Clear existing state - safely remove all structures
        try {
          // Use the hierarchy manager to remove all structures
          const hierarchy = plugin.managers.structure.hierarchy.current;
          if (hierarchy && hierarchy.structures.length > 0) {
            for (const s of hierarchy.structures) {
              try {
                await PluginCommands.State.RemoveObject(plugin, {
                  state: plugin.state.data,
                  ref: s.cell?.transform?.ref,
                });
              } catch {
                // ignore individual removal errors
              }
            }
          }
        } catch {
          // Fallback: try removing the root data node
          try {
            PluginCommands.State.RemoveObject(plugin, {
              state: plugin.state.data,
              ref: plugin.state.data.tree.root.ref,
            });
          } catch {
            // might fail if nothing loaded yet - that's fine
          }
        }

        if (cancelled) return;

        setLoadProgress(30);

        // Use proxy API to load CIF from RCSB (avoids CORS issues)
        const url = `/api/pdb-download/${pdbId.toUpperCase()}`;

        // Pre-check if the PDB file exists before attempting Molstar download
        try {
          const checkResp = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
          if (!checkResp.ok) {
            const errBody = await checkResp.json().catch(() => ({}));
            throw new Error(errBody.error || `PDB ${pdbId.toUpperCase()} not found on RCSB (${checkResp.status})`);
          }
        } catch (prefetchErr: any) {
          // Only block on explicit "not found" / 404 errors from the server.
          // Network errors, CORS issues, timeouts, etc. should not prevent
          // the main download attempt — Molstar may still succeed.
          if (prefetchErr instanceof Error && (prefetchErr.message?.includes('not found') || prefetchErr.message?.includes('404'))) {
            throw prefetchErr;
          }
          // Network/timeout/CORS errors: continue and let Molstar try
        }

        // Helper: check if an error is a network/timeout (not a 404)
        const isNetworkError = (err: any): boolean => {
          const msg = err instanceof Error ? err.message : String(err);
          return (
            (msg.includes('network') || msg.includes('fetch') || msg.includes('Failed to fetch') || msg.includes('timeout') || msg.includes('abort'))
            && !msg.includes('not found')
            && !msg.includes('404')
          );
        };

        // Try downloading with 1 retry on network errors, then RCSB direct fallback
        const rcsbDirectUrl = `https://files.rcsb.org/download/${pdbId.toUpperCase()}.cif`;
        let data: any;
        let lastError: any = null;

        for (let attempt = 0; attempt <= 1; attempt++) {
          try {
            if (cancelled || !plugin) throw new Error('Cancelled');
            data = await plugin.builders.data.download(
              { url, isBinary: false, label: pdbId.toUpperCase() },
              { state: { isGhost: true } }
            );
            break; // success
          } catch (dlErr: any) {
            lastError = dlErr;
            if (isNetworkError(dlErr) && attempt === 0) {
              // Wait 1 second and retry once
              await new Promise(resolve => setTimeout(resolve, 1000));
              continue;
            }
            if (isNetworkError(dlErr) && attempt === 1) {
              // Proxy failed twice with network error — try direct RCSB as fallback
              // (may fail due to CORS in the browser, but worth attempting)
              console.warn('[MoleculeViewer] Proxy failed, trying direct RCSB:', rcsbDirectUrl);
              try {
                data = await plugin.builders.data.download(
                  { url: rcsbDirectUrl, isBinary: false, label: pdbId.toUpperCase() },
                  { state: { isGhost: true } }
                );
                break; // success via direct RCSB
              } catch (_rcsbErr) {
                // Direct RCSB also failed (likely CORS) — throw the original error
                throw lastError;
              }
            }
            throw dlErr;
          }
        }


        if (cancelled) return;

        setLoadProgress(50);

        // Parse to trajectory
        const trajectory = await plugin.builders.structure.parseTrajectory(
          data,
          'mmcif'
        );


        if (cancelled) return;

        setLoadProgress(70);

        // Apply the 'default' preset which creates polymer/ligand/water components
        await plugin.builders.structure.hierarchy.applyPreset(
          trajectory,
          'default'
        );


        if (cancelled) return;

        setLoadProgress(85);

        loadedPdbRef.current = pdbId;
        setStructureLoaded(true);
        setLoadProgress(100);

        // Mark loading as done BEFORE async entity/assembly fetches
        // so the viewer appears immediately while metadata loads in background
        setLoading(false);

        // Delay stats update to let structure render
        setTimeout(() => {
          updateStatsRef.current();
        }, 500);

        // ─── Non-critical background fetches (assembly & entity data) ────
        // These run after the structure is visible. Failures are non-fatal.

        // Detect assemblies from the loaded structure
        try {
          const state = plugin.state.data;
          const assemblyOptions: string[] = [];
          const descriptions: Record<string, string> = {};
          // Try to enumerate assemblies from the model data
          const models = state.selectQ((q: any) => q.ofType('plugin-state-object.model'));
          if (models.length > 0) {
            const modelObj = models[0].obj;
            if (modelObj?.data?.symmetry?.assemblies) {
              const assems = modelObj.data.symmetry.assemblies;
              if (assems && assems.length > 1) {
                for (let i = 0; i < assems.length; i++) {
                  assemblyOptions.push(String(i + 1));
                  // Extract assembly details/description
                  const a = assems[i];
                  const details: string[] = [];
                  if (a.oligomeric_state) details.push(a.oligomeric_state);
                  if (a.details) details.push(a.details);
                  if (details.length > 0) {
                    descriptions[String(i + 1)] = details.join(' — ');
                  }
                }
              }
            }
          }
          setAssemblies(assemblyOptions);
          setAssemblyDescriptions(descriptions);
        } catch {
          // ignore assembly detection errors
        }

        // Fetch assembly descriptions from RCSB Data API for richer info
        try {
          // Note: fetch the first assembly explicitly; /assembly/{pdbId} alone returns 404 if no default
          const asmRes = await fetch(
            `https://data.rcsb.org/rest/v1/core/assembly/${pdbId.toUpperCase()}/1`,
            { headers: { 'Accept': 'application/json' } }
          );
          if (asmRes.ok) {
            const asmData = await asmRes.json();
            if (Array.isArray(asmData)) {
              const richerDesc: Record<string, string> = {};
              for (let i = 0; i < asmData.length; i++) {
                const entry = asmData[i];
                const parts: string[] = [];
                if (entry?.rcsb_assembly_info?.oligomeric_state) {
                  parts.push(entry.rcsb_assembly_info.oligomeric_state);
                }
                if (entry?.rcsb_assembly_info?.details) {
                  parts.push(entry.rcsb_assembly_info.details);
                }
                if (parts.length > 0) {
                  richerDesc[String(i + 1)] = parts.join(' — ');
                }
              }
              if (Object.keys(richerDesc).length > 0) {
                setAssemblyDescriptions(prev => ({ ...prev, ...richerDesc }));
              }
            }
          }
        } catch {
          // ignore RCSB assembly API errors
        }

        // Fetch entity info from our API (non-blocking, uses callbackRefs)
        try {
          const entityRes = await fetch(`/api/entities/${pdbId}`);
          if (cancelled) return;
          if (entityRes.ok) {
            const entityJson = await entityRes.json();
            const entities: EntityInfo[] = entityJson.entities || [];
            entityDataRef.current = entities;
            // Use callbackRefs to avoid stale closure and dependency issues
            callbackRefs.current.onEntitiesLoaded?.(entities);

            // Signal that entity data is available (for per-chain component creation)
            setEntitiesReady(true);

            // Detect and report ligands
            const ligCodes = detectLigandCodes(entities);
            knownLigandCodesRef.current = ligCodes;
            callbackRefs.current.onLigandsDetected?.(ligCodes);
            setLigandsReady(true);
          }
        } catch (err) {
          console.warn('[MoleculeViewer] Failed to fetch entity data:', err);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[MoleculeViewer] Failed to load structure:', err);
          // Provide more specific error messages
          let errorMessage = `Failed to load ${pdbId.toUpperCase()}`;
          if (err instanceof Error) {
            const msg = err.message || '';
            if (msg.includes('network') || msg.includes('fetch') || msg.includes('Failed to fetch')) {
              errorMessage = `Network error loading ${pdbId.toUpperCase()} — check your connection`;
            } else if (msg.includes('404') || msg.includes('not found')) {
              errorMessage = `${pdbId.toUpperCase()} not found in RCSB PDB`;
            } else if (msg.includes('parse') || msg.includes('trajectory')) {
              errorMessage = `Error parsing ${pdbId.toUpperCase()} structure data`;
            } else if (msg.includes('chunk') || msg.includes('import')) {
              errorMessage = `Viewer module failed to load — try refreshing the page`;
            }
          }
          setError(errorMessage);
          setLoading(false);
          setLoadProgress(0);
          // Reset loadedPdbRef so retry can work
          loadedPdbRef.current = null;
        }
      }
    }

    loadStructure();

    return () => {
      cancelled = true;
    };
  }, [pdbId, pluginReady]);

  // ─── Create per-ligand Molstar components ───────────────────────────
  // After the structure loads AND ligand codes are detected, create a separate
  // Molstar component for each ligand code. This enables per-ligand visibility
  // toggling and proper solo mode, since Molstar's default preset creates a
  // single "ligand" component containing ALL ligands.
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

        // Create per-ligand components using the component manager
        for (const ligCode of ligCodes) {
          const expression = MS.struct.generator.atomGroups({
            'atom-test': MS.core.rel.eq([MS.ammp('label_comp_id'), ligCode])
          });
          const ligQuery = SSQ(
            `Ligand ${ligCode}`,
            expression,
            { category: 'Ligand', isHidden: true }
          );

          try {
            await plugin.managers.structure.component.add(
              {
                selection: ligQuery,
                options: {
                  checkExisting: true,
                  label: `Ligand ${ligCode}`,
                },
                representation: 'ball-and-stick',
              },
              hierarchy.structures
            );
          } catch (e) {
            console.warn(`[MoleculeViewer] Failed to create per-ligand component for ${ligCode}:`, e);
          }
        }

        // Now tag the newly created components for easy identification.
        // The component manager's add() method doesn't support tags directly,
        // so we update the state transform tags after creation.
        const updatedHierarchy = plugin.managers.structure.hierarchy.current;
        if (updatedHierarchy) {
          for (const structure of updatedHierarchy.structures) {
            for (const component of structure.components) {
              const compLabel = component.cell?.obj?.label || '';
              // Find components we just created by their "Ligand XXX" label pattern
              const ligMatch = compLabel.match(/^Ligand ([A-Z0-9]+)$/);
              if (ligMatch) {
                const code = ligMatch[1];
                // Update tags on the state transform
                try {
                  const existingTags: string[] = component.cell?.transform?.tags || [];
                  const newTags = [...new Set([...existingTags, 'ligand', `ligand-${code}`])];
                  if (component.cell?.transform) {
                    component.cell.transform.tags = newTags;
                  }
                } catch {
                  // Tags update is best-effort
                }
              }
            }
          }
        }

        // Hide the default "ligand" component (contains all ligands)
        for (const structure of updatedHierarchy.structures) {
          for (const component of structure.components) {
            const compKey = component.key || '';
            if (compKey === 'structure-component-static-ligand') {
              plugin.managers.structure.hierarchy.toggleVisibility([component], 'hide');
            }
          }
        }

        perLigandComponentsCreatedRef.current = true;
        // Signal that per-ligand components are ready so visibility/solo effects re-run
        setPerLigandComponentsReady(true);
      } catch (err) {
        console.warn('[MoleculeViewer] Per-ligand component creation error:', err);
      }
    })();
  }, [structureLoaded, ligandsReady]);

  // ─── Create per-chain Molstar components ─────────────────────────────
  // After the structure loads AND entity data is available, create a separate
  // Molstar component for each polymer chain. This enables per-chain visibility
  // toggling and solo mode, since Molstar's default preset creates a single
  // "polymer" component containing ALL chains.
  useEffect(() => {
    const plugin = pluginRef.current;
    if (!plugin || !structureLoaded || !entitiesReady) return;
    if (perChainComponentsCreatedRef.current) return;

    (async () => {
      try {
        const entities = entityDataRef.current;
        if (!entities || entities.length === 0) return;

        const hierarchy = plugin.managers.structure.hierarchy.current;
        if (!hierarchy || hierarchy.structures.length === 0) return;

        const { MolScriptBuilder: MS, StructureSelectionQuery: SSQ, Script, compile } = await getMolstarModules();

        // Collect all polymer chain IDs
        const polymerChains: { chainId: string; entityId: number; moleculeType: string }[] = [];
        for (const entity of entities) {
          const mt = entity.molecule_type.toLowerCase();
          // Skip water, ligands, bound, non-polymer
          if (mt.includes('water')) continue;
          if (mt.includes('bound') || mt === 'non-polymer') continue;
          // Skip short peptide ligands
          const maxChainLength = Math.max(...entity.chains.map(c => c.length ?? 0), 0);
          const isShortPeptide = (mt.includes('polypeptide') && maxChainLength <= 10 && maxChainLength > 0);
          if (isShortPeptide) continue;

          for (const chain of entity.chains) {
            polymerChains.push({ chainId: chain.chain, entityId: entity.entity_id, moleculeType: entity.molecule_type });
          }
        }

        if (polymerChains.length === 0) return;


        // Create per-chain components using StructureSelectionQuery (same pattern as per-ligand)
        for (const { chainId } of polymerChains) {
          // Use atomGroups with chain-test for proper selection
          const expression = MS.struct.generator.atomGroups({
            'chain-test': MS.core.rel.eq([MS.ammp('auth_asym_id'), chainId])
          });

          const chainQuery = SSQ(
            `Chain ${chainId}`,
            expression,
            { category: 'Chain' }
          );

          try {
            await plugin.managers.structure.component.add(
              {
                selection: chainQuery,
                options: {
                  checkExisting: false,
                  label: `Chain ${chainId}`,
                },
                representation: 'cartoon',
              },
              hierarchy.structures
            );
          } catch (e) {
            console.warn(`[MoleculeViewer] Failed to create per-chain component for ${chainId}:`, e);
          }
        }

        // Tag the newly created components
        const updatedHierarchy = plugin.managers.structure.hierarchy.current;
        if (updatedHierarchy) {
          // Verify per-chain components were actually created
          let chainComponentsFound = 0;
          for (const structure of updatedHierarchy.structures) {
            for (const component of structure.components) {
              const compLabel = component.cell?.obj?.label || '';
              const chainMatch = compLabel.match(/^Chain ([A-Za-z0-9]+)$/);
              if (chainMatch) {
                chainComponentsFound++;
                const cid = chainMatch[1];
                try {
                  const existingTags: string[] = component.cell?.transform?.tags || [];
                  const newTags = [...new Set([...existingTags, 'chain', `chain-${cid}`])];
                  if (component.cell?.transform) {
                    component.cell.transform.tags = newTags;
                  }
                } catch {
                  // Tags update is best-effort
                }
              }
            }
          }


          // Only hide the default polymer component if we successfully created per-chain components
          if (chainComponentsFound >= polymerChains.length) {
            for (const structure of updatedHierarchy.structures) {
              for (const component of structure.components) {
                const compKey = component.key || '';
                if (compKey === 'structure-component-static-polymer') {
                  plugin.managers.structure.hierarchy.toggleVisibility([component], 'hide');
                }
              }
            }
          } else {
            console.warn(`[MoleculeViewer] Not all per-chain components were created (${chainComponentsFound}/${polymerChains.length}), keeping default polymer component visible`);
          }
        }

        perChainComponentsCreatedRef.current = true;
        setPerChainComponentsReady(true);
      } catch (err) {
        console.warn('[MoleculeViewer] Per-chain component creation error:', err);
      }
    })();
  }, [structureLoaded, entitiesReady]);

  // ─── Load overlay structure (second structure in same viewer) ──────────
  useEffect(() => {
    if (!overlayPdbId || !pluginRef.current || !structureLoaded) return;
    if (loadedOverlayRef.current === overlayPdbId) return;

    const plugin = pluginRef.current;
    let cancelled = false;

    async function loadOverlay() {
      try {
        const { Color } = await getMolstarModules();
        if (cancelled || !plugin) return;

        // Download and parse the overlay structure WITHOUT clearing existing
        const url = `https://files.rcsb.org/download/${(overlayPdbId ?? '').toUpperCase()}.cif`;
        const data = await plugin.builders.data.download(
          { url, isBinary: false, label: (overlayPdbId ?? '').toUpperCase() },
          { state: { isGhost: true } }
        );

        if (cancelled) return;

        const trajectory = await plugin.builders.structure.parseTrajectory(
          data,
          'mmcif'
        );

        if (cancelled) return;

        // Apply preset
        await plugin.builders.structure.hierarchy.applyPreset(
          trajectory,
          'default'
        );

        if (cancelled) return;

        loadedOverlayRef.current = overlayPdbId ?? null;
        setLoadedOverlay(overlayPdbId ?? null);

        // Apply overlay color to all components of the second structure
        const overlayColor = overlayColorHex || '#ea580c';
        const colorNum = parseInt(overlayColor.replace('#', ''), 16);

        // Wait a bit for components to be created
        setTimeout(async () => {
          if (cancelled || !plugin) return;
          try {
            const hierarchy = plugin.managers.structure.hierarchy.current;
            if (!hierarchy) return;

            // The overlay structure is the second one in the hierarchy
            const structures = hierarchy.structures;
            if (structures.length < 2) return;

            const overlayStructure = structures[structures.length - 1];
            for (const component of overlayStructure.components) {
              try {
                await plugin.managers.structure.component.updateRepresentationsTheme(
                  [component],
                  {
                    color: 'uniform' as const,
                    colorParams: { value: Color(colorNum) },
                  }
                );
              } catch {
                // ignore per-component color errors
              }
            }
          } catch {
            // ignore hierarchy errors
          }
        }, 800);
      } catch (err) {
        console.warn('[MoleculeViewer] Failed to load overlay structure:', err);
      }
    }

    loadOverlay();

    return () => {
      cancelled = true;
    };
  }, [overlayPdbId, structureLoaded, overlayColorHex]);

  // ─── Apply entity/chain colors ────────────────────────────────────────
  useEffect(() => {
    if (!pluginRef.current || !structureLoaded || !entityColors) return;
    if (Object.keys(entityColors).length === 0) return;

    const plugin = pluginRef.current;

    let cancelled = false;

    (async () => {
      try {
        const { Color, MolScriptBuilder, StructureSelectionQuery, StructureSelectionQueries } = await getMolstarModules();

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

        // Apply each chain color — skip errors per chain to avoid node-not-found crashes
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
        console.warn('[MoleculeViewer] applyEntityColors error:', e);
      }
    })();

    return () => { cancelled = true; };
  }, [entityColors, structureLoaded, perChainComponentsReady]);

  // ─── Apply ligand colors ──────────────────────────────────────────────
  useEffect(() => {
    if (!pluginRef.current || !structureLoaded || !ligandColors) return;
    if (Object.keys(ligandColors).length === 0) return;

    const plugin = pluginRef.current;

    (async () => {
      try {
        const { Color, MolScriptBuilder, compile, StructureSelectionQuery, StructureSelectionQueries } = await getMolstarModules();

        // Build a ligand color map from ligandColors
        const ligandPalette: Record<string, number> = {};
        for (const [ligCode, colorHex] of Object.entries(ligandColors)) {
          const colorNum = parseInt(colorHex.replace('#', ''), 16);
          ligandPalette[ligCode] = colorNum;
        }

        if (Object.keys(ligandPalette).length === 0) return;

        // Use overpaint for per-ligand coloring, similar to per-chain coloring.
        // The default preset creates a single "ligand" component containing ALL ligands,
        // so we need to use MolScriptBuilder with label_comp_id matching for individual ligands.
        await plugin.dataTransaction(async () => {
          // Clear existing ligand overpaint
          try {
            for (const [ligCode] of Object.entries(ligandPalette)) {
              const expression = MolScriptBuilder.struct.generator.atomGroups({
                'atom-test': MolScriptBuilder.core.rel.eq([
                  MolScriptBuilder.ammp('label_comp_id'), ligCode
                ])
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
            }
          } catch { /* ignore reset errors */ }

          // Apply each ligand color as an overpaint layer using MolScriptBuilder
          for (const [ligCode, colorNum] of Object.entries(ligandPalette)) {
            try {
              const expression = MolScriptBuilder.struct.generator.atomGroups({
                'atom-test': MolScriptBuilder.core.rel.eq([
                  MolScriptBuilder.ammp('label_comp_id'), ligCode
                ])
              });
              const ligQuery = StructureSelectionQuery(
                `Ligand ${ligCode}`,
                expression,
                { category: 'Ligand', isHidden: true }
              );

              await plugin.managers.structure.component.applyTheme({
                selection: ligQuery,
                action: { name: 'color' as const, params: { color: Color(colorNum) } },
                representations: [],
              });
            } catch (e) {
              console.warn(`[MoleculeViewer] Per-ligand color failed for ${ligCode}:`, e);
            }
          }
        }, { canUndo: 'Update Ligand Colors' });

        // Also handle any per-ligand components that may exist (non-default preset)
        const hierarchy = plugin.managers.structure.hierarchy.current;
        if (hierarchy) {
          for (const structure of hierarchy.structures) {
            for (const component of structure.components) {
              const compKey = component.key || '';
              const compLabel = component.cell?.obj?.label || '';
              const compTags: string[] = component.cell?.transform?.tags || [];

              if (component.representations.length === 0) continue;

              // For the default single-ligand component, we already applied overpaint above
              // Skip the default component that contains ALL ligands
              if (compKey === 'structure-component-static-ligand') continue;

              // For individual ligand components, apply uniform color directly
              for (const [ligCode, colorHex] of Object.entries(ligandColors)) {
                // Match by tag (e.g. "ligand-HEM") or exact label (e.g. "Ligand HEM")
                const hasLigandTag = compTags.some(t => t === `ligand-${ligCode}`);
                const labelMatches = compLabel === `Ligand ${ligCode}`;
                // Fallback for legacy components
                const keyOrLabelIncludes = compLabel.toLowerCase().includes(ligCode.toLowerCase()) ||
                  compKey.toLowerCase().includes(ligCode.toLowerCase());

                if (hasLigandTag || labelMatches || keyOrLabelIncludes) {
                  const colorNum = parseInt(colorHex.replace('#', ''), 16);
                  try {
                    await plugin.managers.structure.component.updateRepresentationsTheme(
                      [component],
                      {
                        color: 'uniform' as const,
                        colorParams: { value: Color(colorNum) },
                      }
                    );
                  } catch {
                    // ignore per-component color errors
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        console.warn('[MoleculeViewer] Ligand color error:', err);
      }
    })();
  }, [ligandColors, structureLoaded]);

  // ─── Ligand visibility ────────────────────────────────────────────────
  // With per-ligand components, we match by tag `ligand-{code}` or label `Ligand {code}`.
  // Falls back to label/key matching for legacy components.
  // Also depends on `perLigandComponentsReady` to re-apply visibility after components are created.
  useEffect(() => {
    if (!pluginRef.current || !structureLoaded || !ligandVisibility) return;
    if (!perLigandComponentsReady) return;

    const plugin = pluginRef.current;
    const hierarchy = plugin.managers.structure.hierarchy.current;
    if (!hierarchy) return;

    for (const structure of hierarchy.structures) {
      for (const component of structure.components) {
        const compKey = component.key || '';
        const compLabel = component.cell?.obj?.label || '';
        const compTags: string[] = component.cell?.transform?.tags || [];

        // Skip the default all-ligands component — visibility is managed per-ligand
        if (compKey === 'structure-component-static-ligand') continue;

        for (const [ligCode, visible] of Object.entries(ligandVisibility)) {
          // Match per-ligand component by tag (e.g. "ligand-HEM") or label (e.g. "Ligand HEM")
          const hasLigandTag = compTags.some(t => t === `ligand-${ligCode}`);
          const labelMatches = compLabel === `Ligand ${ligCode}`;
          // Fallback: also match if label contains the ligand code (Molstar may add suffixes)
          const labelIncludes = compLabel !== `Ligand ${ligCode}` &&
            compLabel.toLowerCase().includes(ligCode.toLowerCase());
          // Fallback for legacy components
          const keyOrLabelIncludes = compLabel.toLowerCase().includes(ligCode.toLowerCase()) ||
            compKey.toLowerCase().includes(ligCode.toLowerCase());

          if (hasLigandTag || labelMatches || labelIncludes || keyOrLabelIncludes) {
            plugin.managers.structure.hierarchy.toggleVisibility(
              [component],
              visible ? 'show' : 'hide'
            );
          }
        }
      }
    }
  }, [ligandVisibility, structureLoaded, perLigandComponentsReady]);

  // ─── Entity (chain) visibility ──────────────────────────────────────────
  // Match per-chain components by tag `chain-{chainId}` or label `Chain {chainId}`.
  // Depends on `perChainComponentsReady` so it re-runs after per-chain components exist.
  useEffect(() => {
    if (!pluginRef.current || !structureLoaded || !entityVisibility) return;
    if (!perChainComponentsReady) return;

    const plugin = pluginRef.current;
    const hierarchy = plugin.managers.structure.hierarchy.current;
    if (!hierarchy) return;

    for (const structure of hierarchy.structures) {
      for (const component of structure.components) {
        const compKey = component.key || '';
        const compLabel = component.cell?.obj?.label || '';
        const compTags: string[] = component.cell?.transform?.tags || [];

        for (const [entityKey, visible] of Object.entries(entityVisibility)) {
          const chainId = entityKey.split('.')[1];
          if (!chainId) continue;

          // Match per-chain component by tag (e.g. "chain-A") or label (e.g. "Chain A")
          const hasChainTag = compTags.some(t => t === `chain-${chainId}` || t === `chain-${chainId.toLowerCase()}`);
          const labelMatches = compLabel === `Chain ${chainId}`;
          const keyExactMatch = compKey === chainId || compKey === `chain-${chainId}`;

          if (hasChainTag || labelMatches || keyExactMatch) {
            plugin.managers.structure.hierarchy.toggleVisibility(
              [component],
              visible ? 'show' : 'hide'
            );
          }
        }
      }
    }
  }, [entityVisibility, structureLoaded, perChainComponentsReady]);

  // ─── Solo ligand mode (show only ligand + surroundings) ──────────
  // With per-ligand components, solo mode hides ALL other components (including
  // polymer) and shows ONLY the solo ligand component, then focuses the camera.
  // When exiting solo mode, all components are restored to visible.
  // Depends on `perLigandComponentsReady` so it re-runs after per-ligand components exist.
  useEffect(() => {
    const plugin = pluginRef.current;
    if (!plugin || !structureLoaded) return;

    (async () => {
      try {
        const hierarchy = plugin.managers.structure.hierarchy.current;
        if (!hierarchy) return;

        if (!soloLigand) {
          // Exit solo mode: show all components (except the hidden default ligand/polymer components)
          for (const structure of hierarchy.structures) {
            for (const component of structure.components) {
              const compKey = component.key || '';
              // Keep the default all-ligands component hidden if per-ligand components exist
              if (compKey === 'structure-component-static-ligand' && perLigandComponentsCreatedRef.current) {
                plugin.managers.structure.hierarchy.toggleVisibility([component], 'hide');
                continue;
              }
              // Keep the default polymer component hidden if per-chain components exist
              if (compKey === 'structure-component-static-polymer' && perChainComponentsCreatedRef.current) {
                plugin.managers.structure.hierarchy.toggleVisibility([component], 'hide');
                continue;
              }
              // Respect ligand visibility: check if this per-ligand component should be hidden
              if (ligandVisibility && compKey !== 'structure-component-static-ligand') {
                const compLabel = component.cell?.obj?.label || '';
                const compTags: string[] = component.cell?.transform?.tags || [];
                let matchedLigCode: string | null = null;
                for (const [ligCode] of Object.entries(ligandVisibility)) {
                  const hasLigandTag = compTags.some(t => t === `ligand-${ligCode}`);
                  const labelMatches = compLabel === `Ligand ${ligCode}`;
                  const labelIncludes = compLabel.toLowerCase().includes(ligCode.toLowerCase());
                  if (hasLigandTag || labelMatches || labelIncludes) {
                    matchedLigCode = ligCode;
                    break;
                  }
                }
                if (matchedLigCode && ligandVisibility[matchedLigCode] === false) {
                  plugin.managers.structure.hierarchy.toggleVisibility([component], 'hide');
                  continue;
                }
              }
              // Also respect entity visibility when exiting solo ligand mode
              if (entityVisibility && compKey !== 'structure-component-static-ligand') {
                const compLabel = component.cell?.obj?.label || '';
                const compTags: string[] = component.cell?.transform?.tags || [];
                let skipShow = false;
                for (const [eKey, eVisible] of Object.entries(entityVisibility)) {
                  if (eVisible === false) {
                    const eChainId = eKey.split('.')[1];
                    if (eChainId) {
                      const eHasChainTag = compTags.some(t => t === `chain-${eChainId}` || t === `chain-${eChainId.toLowerCase()}`);
                      const eLabelMatches = compLabel === `Chain ${eChainId}`;
                      const eKeyExactMatch = compKey === eChainId || compKey === `chain-${eChainId}`;
                      if (eHasChainTag || eLabelMatches || eKeyExactMatch) {
                        plugin.managers.structure.hierarchy.toggleVisibility([component], 'hide');
                        skipShow = true;
                        break;
                      }
                    }
                  }
                }
                if (skipShow) continue;
              }
              plugin.managers.structure.hierarchy.toggleVisibility([component], 'show');
            }
          }
          return;
        }

        // Solo mode: hide everything, then show ONLY the solo ligand
        for (const structure of hierarchy.structures) {
          for (const component of structure.components) {
            const compKey = component.key || '';
            const compLabel = component.cell?.obj?.label || '';
            const compTags: string[] = component.cell?.transform?.tags || [];

            // Match the solo ligand component by tag or label
            const hasLigandTag = compTags.some(t => t === `ligand-${soloLigand}`);
            const labelMatches = compLabel === `Ligand ${soloLigand}`;
            // Fallback: label includes the ligand code
            const labelIncludes = compLabel.toLowerCase().includes(soloLigand.toLowerCase());
            const isSoloLigand = hasLigandTag || labelMatches || labelIncludes;

            if (isSoloLigand) {
              plugin.managers.structure.hierarchy.toggleVisibility([component], 'show');
            } else {
              plugin.managers.structure.hierarchy.toggleVisibility([component], 'hide');
            }
          }
        }

        // Auto-focus on the solo ligand - reset camera to default view
        plugin.managers?.camera?.reset(undefined, 600);
      } catch (err) {
        console.warn('[MoleculeViewer] Solo ligand mode error:', err);
      }
    })();
  }, [soloLigand, structureLoaded, perLigandComponentsReady, ligandVisibility, entityVisibility]);

  // ─── Solo entity mode (show only this chain) ────────────────────────────
  useEffect(() => {
    const plugin = pluginRef.current;
    if (!plugin || !structureLoaded) return;

    (async () => {
      try {
        const hierarchy = plugin.managers.structure.hierarchy.current;
        if (!hierarchy) return;

        if (!soloEntity) {
          // Exit solo entity mode: restore all visibility
          for (const structure of hierarchy.structures) {
            for (const component of structure.components) {
              const compKey = component.key || '';
              const compLabel = component.cell?.obj?.label || '';
              const compTags: string[] = component.cell?.transform?.tags || [];

              // Keep the default all-ligands component hidden if per-ligand components exist
              if (compKey === 'structure-component-static-ligand' && perLigandComponentsCreatedRef.current) {
                plugin.managers.structure.hierarchy.toggleVisibility([component], 'hide');
                continue;
              }
              // Keep the default polymer component hidden if per-chain components exist
              if (compKey === 'structure-component-static-polymer' && perChainComponentsCreatedRef.current) {
                plugin.managers.structure.hierarchy.toggleVisibility([component], 'hide');
                continue;
              }

              let skipShow = false;

              // Check ligand visibility
              if (ligandVisibility && compKey !== 'structure-component-static-ligand') {
                let matchedLigCode: string | null = null;
                for (const [ligCode] of Object.entries(ligandVisibility)) {
                  const hasLigandTag = compTags.some(t => t === `ligand-${ligCode}`);
                  const labelMatches = compLabel === `Ligand ${ligCode}`;
                  const labelIncludes = compLabel.toLowerCase().includes(ligCode.toLowerCase());
                  if (hasLigandTag || labelMatches || labelIncludes) {
                    matchedLigCode = ligCode;
                    break;
                  }
                }
                if (matchedLigCode && ligandVisibility[matchedLigCode] === false) {
                  plugin.managers.structure.hierarchy.toggleVisibility([component], 'hide');
                  skipShow = true;
                }
              }

              // Check entity visibility
              if (!skipShow && entityVisibility) {
                for (const [eKey, eVisible] of Object.entries(entityVisibility)) {
                  if (eVisible === false) {
                    const eChainId = eKey.split('.')[1];
                    if (eChainId) {
                      const eHasChainTag = compTags.some(t => t === `chain-${eChainId}` || t === `chain-${eChainId.toLowerCase()}`);
                      const eLabelMatches = compLabel === `Chain ${eChainId}`;
                      const eKeyExactMatch = compKey === eChainId || compKey === `chain-${eChainId}`;
                      if (eHasChainTag || eLabelMatches || eKeyExactMatch) {
                        plugin.managers.structure.hierarchy.toggleVisibility([component], 'hide');
                        skipShow = true;
                        break;
                      }
                    }
                  }
                }
              }

              if (!skipShow) {
                plugin.managers.structure.hierarchy.toggleVisibility([component], 'show');
              }
            }
          }
          return;
        }

        // Enter solo entity mode: hide everything, show only the solo chain
        const chainId = soloEntity.split('.')[1];
        if (!chainId) return;

        for (const structure of hierarchy.structures) {
          for (const component of structure.components) {
            const compKey = component.key || '';
            const compLabel = component.cell?.obj?.label || '';
            const compTags: string[] = component.cell?.transform?.tags || [];

            const hasChainTag = compTags.some(t => t === `chain-${chainId}` || t === `chain-${chainId.toLowerCase()}`);
            const labelMatches = compLabel === `Chain ${chainId}`;
            const keyExactMatch = compKey === chainId || compKey === `chain-${chainId}`;
            const isSoloChain = hasChainTag || labelMatches || keyExactMatch;

            if (isSoloChain) {
              plugin.managers.structure.hierarchy.toggleVisibility([component], 'show');
            } else {
              plugin.managers.structure.hierarchy.toggleVisibility([component], 'hide');
            }
          }
        }

        // Auto-focus on the solo chain - reset camera to default view
        plugin.managers?.camera?.reset(undefined, 600);
      } catch (err) {
        console.warn('[MoleculeViewer] Solo entity mode error:', err);
      }
    })();
  }, [soloEntity, structureLoaded, perLigandComponentsReady, perChainComponentsReady, ligandVisibility, entityVisibility]);

  // ─── Highlight entity/ligand (enhanced: bright glow + auto-focus + dim) ─
  useEffect(() => {
    const plugin = pluginRef.current;
    if (!plugin || !structureLoaded) return;

    const hasTarget = !!(highlightEntity || highlightLigand);
    setHasHighlight(hasTarget);

    (async () => {
      try {
        const { PluginCommands } = await getMolstarModules();

        // Clear previous highlights
        PluginCommands.Interactivity.ClearHighlights(plugin);

        // ─── Clean up previous highlight surface representations ───
        // Remove surface representations that were added for highlight glow
        try {
          const hierarchy = plugin.managers.structure.hierarchy.current;
          if (hierarchy) {
            for (const structure of hierarchy.structures) {
              for (const component of structure.components) {
                const reprs = [...component.representations];
                for (const repr of reprs) {
                  // Note: params.type is an object {name, params} in Molstar;
                  // use .name to get the string representation type name.
                  const reprType = repr.cell?.transform?.params?.type?.name || repr.cell?.transform?.params?.type;
                  const reprLabel = repr.cell?.obj?.label || '';
                  // Remove surface reprs we added for highlight glow
                  if (reprType === 'molecular-surface' && reprLabel.includes('[highlight]')) {
                    try {
                      await plugin.managers.structure.component.removeRepresentations(
                        [component],
                        repr
                      );
                    } catch { /* ignore */ }
                  }
                }
              }
            }
          }
        } catch {
          // ignore cleanup errors
        }

        // ─── Focus mode: dim non-highlighted elements ───
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
                    opacity: hasTarget ? 0.4 : 0,
                  },
                },
                // Make highlight color bright yellow-orange
                highlight: {
                  ...(currentProps as any).highlight,
                  color: 0xffb800,
                },
              } as any,
            });
          }
        } catch {
          // dimming/highlight color not supported in this Molstar version, ignore
        }

        const highlightTarget = highlightEntity || highlightLigand;

        if (highlightTarget) {
          const hierarchy =
            plugin.managers.structure.hierarchy.current;
          if (hierarchy) {
            let focusedAny = false;
            for (const structure of hierarchy.structures) {
              for (const component of structure.components) {
                const compKey = component.key || '';
                const compLabel =
                  component.cell?.obj?.label || '';
                const compTags: string[] = component.cell?.transform?.tags || [];

                let matches = false;
                if (highlightEntity) {
                  const chainId = highlightEntity.split('.')[1];
                  if (chainId) {
                    // Match per-chain components by tag or label
                    const hasChainTag = compTags.some(t => t === `chain-${chainId}` || t === `chain-${chainId.toLowerCase()}`);
                    const labelMatches = compLabel === `Chain ${chainId}`;
                    const keyExactMatch = compKey === chainId || compKey === `chain-${chainId}`;
                    // Also check default polymer component (has all chains) — but only if per-chain components don't exist yet
                    const isDefaultPolymer = compKey === 'structure-component-static-polymer' && !perChainComponentsCreatedRef.current;
                    matches = hasChainTag || labelMatches || keyExactMatch || isDefaultPolymer;
                  }
                } else if (highlightLigand) {
                  // With per-ligand components, match by tag `ligand-{code}` or label `Ligand {code}`.
                  // Fall back to matching the default all-ligands component.
                  const hasLigandTag = compTags.some(t => t === `ligand-${highlightLigand}`);
                  const labelMatches = compLabel === `Ligand ${highlightLigand}`;
                  const fallbackMatch = compKey === 'structure-component-static-ligand';
                  matches = hasLigandTag || labelMatches || fallbackMatch;
                }

                if (matches) {
                  const refs = component.representations.map(
                    (r: any) => r.cell?.transform?.ref
                  );
                  if (refs.length > 0) {
                    PluginCommands.Interactivity.Object.Highlight(
                      plugin,
                      {
                        state: plugin.state.data,
                        ref: refs,
                      }
                    );
                    focusedAny = true;
                  }
                }
              }
            }
            // Auto-focus camera on the highlighted entity/ligand
            if (focusedAny) {
              plugin.managers?.camera?.reset(undefined, 400);
            }

            // Apply per-ligand highlight overpaint for more precise visual feedback
            // This paints a bright highlight on the specific ligand while the
            // component-level highlight above enables dimming of other elements.
            if (highlightLigand) {
              try {
                const { MolScriptBuilder: MS, StructureSelectionQuery: SSQ, Color } = await getMolstarModules();
                const expression = MS.struct.generator.atomGroups({
                  'atom-test': MS.core.rel.eq([MS.ammp('label_comp_id'), highlightLigand])
                });
                const ligQuery = SSQ(
                  `Highlight Ligand ${highlightLigand}`,
                  expression,
                  { category: 'Ligand', isHidden: true }
                );

                // Apply a bright orange-yellow highlight overpaint
                await plugin.managers.structure.component.applyTheme({
                  selection: ligQuery,
                  action: { name: 'color' as const, params: { color: Color(0xffb800) } },
                  representations: [],
                });
              } catch (e) {
                console.warn('[MoleculeViewer] Per-ligand highlight overpaint failed:', e);
              }
            }
          }
        }
      } catch (err) {
        console.warn('[MoleculeViewer] Highlight error:', err);
      }
    })();
  }, [highlightEntity, highlightLigand, structureLoaded]);

  // ─── Representation switching ──────────────────────────────────────────
  // Colors are applied separately by the entity/ligand color effects.
  useEffect(() => {
    const plugin = pluginRef.current;
    if (!plugin || !structureLoaded) return;

    (async () => {
      try {
        const hierarchy =
          plugin.managers.structure.hierarchy.current;
        if (!hierarchy) return;

        const reprTypeMap: Record<string, string> = {
          cartoon: 'cartoon',
          'ball-stick': 'ball-and-stick',
          surface: 'molecular-surface',
        };

        const targetRepr = reprTypeMap[representation] || 'cartoon';

        for (const structure of hierarchy.structures) {
          for (const component of structure.components) {
            if (component.representations.length === 0) continue;

            const oldReprs = [...component.representations];
            const compLabel = component.cell?.obj?.label || 'unknown';

            // Check if any existing representation already matches the target type
            // If so, skip this component to avoid unnecessary re-rendering
            // Note: params.type is an object {name, params} in Molstar;
            // use .name to get the string representation type name.
            const hasTargetRepr = oldReprs.some((r: any) => {
              const reprType = r.cell?.transform?.params?.type?.name || r.cell?.transform?.params?.type;
              return reprType === targetRepr;
            });

            // Remove non-matching representations first (e.g., old highlight surfaces)
            const nonMatchingReprs = oldReprs.filter((r: any) => {
              const reprType = r.cell?.transform?.params?.type?.name || r.cell?.transform?.params?.type;
              const reprLabel = r.cell?.obj?.label || '';
              // Keep highlight surface reprs (they're managed by the highlight effect)
              if (reprType === 'molecular-surface' && reprLabel.includes('[highlight]')) {
                return false;
              }
              return reprType !== targetRepr;
            });

            console.log('[ReprSwitch]', compLabel, 'target:', targetRepr,
              'existing:', oldReprs.map((r: any) => r.cell?.transform?.params?.type?.name || r.cell?.transform?.params?.type),
              'hasTarget:', hasTargetRepr, 'toRemove:', nonMatchingReprs.length);

            if (hasTargetRepr && nonMatchingReprs.length === 0) {
              // Already has the target representation and no stale ones to clean up
              continue;
            }

            try {
              // Add the target representation if not already present
              if (!hasTargetRepr) {
                await plugin.managers.structure.component.addRepresentation(
                  [component],
                  targetRepr
                );
              }

              // Remove old non-matching representations
              for (const oldRepr of nonMatchingReprs) {
                try {
                  const oldReprType = oldRepr.cell?.transform?.params?.type?.name || oldRepr.cell?.transform?.params?.type;
                  console.log('[ReprSwitch] Removing', oldReprType, 'from', compLabel);
                  await plugin.managers.structure.component.removeRepresentations(
                    [component],
                    oldRepr
                  );
                  console.log('[ReprSwitch] Removed', oldReprType, 'from', compLabel);
                } catch (e) {
                  console.warn('[ReprSwitch] Failed to remove repr from', compLabel, e);
                }
              }
            } catch (e) {
              // Some representations may not be available for all components
              console.warn('[ReprSwitch] Error for', compLabel, e);
            }
          }
        }
      } catch (err) {
        console.warn('[MoleculeViewer] Representation switch error:', err);
      }
    })();
  }, [representation, structureLoaded]);

  // ─── Selection State Synchronization from props ───────────────────────
  // Apply Molstar visual selection when selectedEntities/selectedLigands change
  useEffect(() => {
    const plugin = pluginRef.current;
    if (!plugin || !structureLoaded) return;

    (async () => {
      try {
        const { PluginCommands } = await getMolstarModules();

        // Clear any existing selection highlights
        PluginCommands.Interactivity.ClearHighlights(plugin);

        const hasAnySelection = (selectedEntities && selectedEntities.size > 0) ||
          (selectedLigands && selectedLigands.size > 0);

        // Dim non-selected if there are selections
        try {
          const currentProps = plugin.canvas3d?.props;
          if (currentProps) {
            PluginCommands.Canvas3D.SetSettings(plugin, {
              settings: {
                ...currentProps,
                select: {
                  ...(currentProps as any).select,
                  dim: {
                    color: 0x333333,
                    opacity: hasAnySelection ? 0.5 : 0,
                  },
                },
                // Selection uses a distinct bright cyan color (different from hover highlight)
                highlight: {
                  ...(currentProps as any).highlight,
                  color: 0x00d4ff,
                },
              } as any,
            });
          }
        } catch {
          // ignore settings errors
        }

        const hierarchy = plugin.managers.structure.hierarchy.current;
        if (!hierarchy) return;

        for (const structure of hierarchy.structures) {
          for (const component of structure.components) {
            const compKey = component.key || '';
            const compLabel = component.cell?.obj?.label || '';
            const compTags: string[] = component.cell?.transform?.tags || [];
            let shouldSelect = false;

            // Check entity selections
            if (selectedEntities && selectedEntities.size > 0) {
              for (const entityKey of selectedEntities) {
                const chainId = entityKey.split('.')[1];
                if (chainId) {
                  if (compKey.toLowerCase().includes(chainId.toLowerCase()) ||
                    compLabel.toLowerCase().includes(chainId.toLowerCase())) {
                    shouldSelect = true;
                    break;
                  }
                }
              }
            }

            // Check ligand selections
            if (!shouldSelect && selectedLigands && selectedLigands.size > 0) {
              const isLigand = compKey.toLowerCase().includes('ligand') ||
                compKey.toLowerCase().includes('non-polymer') ||
                compTags.some(t => t === 'ligand') ||
                compLabel.startsWith('Ligand ');
              if (isLigand) {
                for (const ligCode of selectedLigands) {
                  const hasLigandTag = compTags.some(t => t === `ligand-${ligCode}`);
                  const labelMatches = compLabel === `Ligand ${ligCode}`;
                  if (hasLigandTag || labelMatches ||
                    compLabel.toLowerCase().includes(ligCode.toLowerCase()) ||
                    compKey.toLowerCase().includes(ligCode.toLowerCase())) {
                    shouldSelect = true;
                    break;
                  }
                }
              }
            }

            if (shouldSelect && component.representations.length > 0) {
              const refs = component.representations.map((r: any) => r.cell?.transform?.ref).filter(Boolean);
              PluginCommands.Interactivity.Object.Highlight(plugin, {
                state: plugin.state.data,
                ref: refs,
              });
            }
          }
        }
      } catch (err) {
        console.warn('[MoleculeViewer] Selection sync error:', err);
      }
    })();
  }, [selectedEntities, selectedLigands, structureLoaded]);

  // ─── Click & hover detection (enhanced) ──────────────────────────────
  useEffect(() => {
    const plugin = pluginRef.current;
    if (!plugin) return;

    let modulesReady = false;
    let cachedModules: MolstarModules | null = null;

    getMolstarModules().then((m) => {
      cachedModules = m;
      modulesReady = true;
    });

    const clickSub = plugin.behaviors.interactivity.click.subscribe(
      (event: any) => {
        if (!modulesReady || !cachedModules) return;
        try {
          const loci = event.current?.loci;
          if (!loci) return;

          const { StructureProperties, StructureElement } = cachedModules;

          if (StructureElement.Loci.is(loci)) {
            const location =
              StructureElement.Loci.getFirstLocation(loci);
            if (!location) return;

            const chainId =
              StructureProperties.chain.auth_asym_id(location);
            const entityId =
              StructureProperties.entity.id(location);
            const entityDesc =
              StructureProperties.entity.pdbx_description(location);
            const entityType =
              StructureProperties.entity.type(location);

            // Get atom coordinates for distance measurement
            const atomX = StructureProperties.atom.x(location);
            const atomY = StructureProperties.atom.y(location);
            const atomZ = StructureProperties.atom.z(location);

            if (entityType === 'water') return;

            const {
              onEntityClick: eClick,
              onLigandClick: lClick,
              pdbId: currentPdbId,
            } = callbackRefs.current;

            const entityKey = `${currentPdbId}.${chainId}`;

            // ─── Double-click detection for isolate mode ───
            const now = Date.now();
            const isDoubleClick =
              now - lastClickTimeRef.current < 400 &&
              lastClickEntityRef.current === entityKey;

            lastClickTimeRef.current = now;
            lastClickEntityRef.current = entityKey;

            if (isDoubleClick) {
              toggleIsolateModeRef.current(entityKey, chainId);
              return;
            }

            // Determine click label for measurement
            let clickLabel = entityKey;
            if (
              entityType === 'non-polymer' ||
              entityType === 'macrolide'
            ) {
              const resolvedCode = resolveLigandCode(
                entityId,
                entityDesc,
                entityDataRef.current,
                knownLigandCodesRef.current
              );
              if (resolvedCode) clickLabel = resolvedCode;
            } else {
              // Check if this polymer entity is a known peptide ligand
              const entityData = entityDataRef.current;
              const entity = entityData.find(
                (e) => e.entity_id === entityId
              );
              const maxChainLength = Math.max(
                ...(entity?.chains.map((c) => c.length ?? 0) || [0]),
                0
              );
              const isShortPeptide =
                entity &&
                entity.molecule_type
                  .toLowerCase()
                  .includes('polypeptide') &&
                maxChainLength > 0 &&
                maxChainLength <= 10;
              if (isShortPeptide && entity?.chains[0]) {
                clickLabel = `PEP_${entity.chains[0].chain}`;
              }
            }

            // ─── Shift+click for distance measurement ───
            const isShiftClick = event.modifiers?.shift;

            if (isShiftClick && lastClickLociRef.current) {
              const dx = atomX - lastClickLociRef.current.x;
              const dy = atomY - lastClickLociRef.current.y;
              const dz = atomZ - lastClickLociRef.current.z;
              const distance = Math.sqrt(
                dx * dx + dy * dy + dz * dz
              );

              setMeasurementTooltip({
                distance,
                from: lastClickLociRef.current.label,
                to: clickLabel,
              });

              // Auto-dismiss after 5 seconds
              if (measurementTimeoutRef.current) {
                clearTimeout(measurementTimeoutRef.current);
              }
              measurementTimeoutRef.current = setTimeout(() => {
                setMeasurementTooltip(null);
              }, 5000);

              // Don't trigger normal click behavior for shift+click measurement
              return;
            }

            // Store this click for potential distance measurement
            lastClickLociRef.current = {
              x: atomX,
              y: atomY,
              z: atomZ,
              label: clickLabel,
              timestamp: Date.now(),
            };

            // ─── Cancel deselect timeout (Molstar click did fire) ───
            if (deselectTimeoutRef.current) {
              clearTimeout(deselectTimeoutRef.current);
              deselectTimeoutRef.current = null;
            }

            // ─── Normal click: determine entity vs ligand ───
            if (
              entityType === 'non-polymer' ||
              entityType === 'macrolide'
            ) {
              // Improved ligand code resolution using entity data
              const ligCode = resolveLigandCode(
                entityId,
                entityDesc,
                entityDataRef.current,
                knownLigandCodesRef.current
              );
              if (ligCode) {
                const resolvedCode = ligCode.toUpperCase();
                lClick?.(resolvedCode);
                // Set persistent selection for ligand
                const entity = entityDataRef.current.find((e) => e.entity_id === entityId);
                setSelectedItem({
                  type: 'ligand',
                  key: resolvedCode,
                  entityId,
                  ligandCode: resolvedCode,
                  ligandName: typeof entityDesc === 'string' ? entityDesc : resolvedCode,
                  ligandType: entity?.molecule_type || 'non-polymer',
                });
              }
            } else {
              // Check if this polymer entity is actually a known ligand
              // (e.g., peptide inhibitor)
              const entityData = entityDataRef.current;
              const entity = entityData.find(
                (e) => e.entity_id === entityId
              );
              const maxChainLength = Math.max(
                ...(entity?.chains.map((c) => c.length ?? 0) || [0]),
                0
              );
              const isShortPeptide =
                entity &&
                entity.molecule_type
                  .toLowerCase()
                  .includes('polypeptide') &&
                maxChainLength > 0 &&
                maxChainLength <= 10;

              if (isShortPeptide && entity?.chains[0]) {
                const pepCode = `PEP_${entity.chains[0].chain}`;
                lClick?.(pepCode);
                // Set persistent selection for peptide ligand
                setSelectedItem({
                  type: 'ligand',
                  key: pepCode,
                  chainId: entity.chains[0].chain,
                  entityId,
                  ligandCode: pepCode,
                  ligandName: entity.description,
                  ligandType: entity.molecule_type,
                });
              } else {
                eClick?.(entityKey);
                // Set persistent selection for entity
                const totalResidues = entity?.chains.reduce(
                  (sum, c) => sum + (c.length || 0), 0
                ) || 0;
                setSelectedItem({
                  type: 'entity',
                  key: entityKey,
                  chainId,
                  entityId,
                  entityDesc: entity?.description || (typeof entityDesc === 'string' ? entityDesc : ''),
                  organism: entity?.organism || '',
                  residueCount: totalResidues,
                });
              }
            }
          }
        } catch (err) {
          console.warn('[MoleculeViewer] Click detection error:', err);
        }
      }
    );

    // Track last hovered item for right-click context menu (using component-level ref)
    const lastHoveredRef = lastHoveredItemRef;

    const hoverSub = plugin.behaviors.interactivity.hover.subscribe(
      (event: any) => {
        if (!modulesReady || !cachedModules) return;
        try {
          const loci = event.current?.loci;
          if (!loci) {
            callbackRefs.current.onEntityHover?.(null);
            callbackRefs.current.onLigandHover?.(null);
            lastHoveredRef.current = null;
            // Clear hover tooltip after a short delay
            if (hoverInfoTimeoutRef.current) clearTimeout(hoverInfoTimeoutRef.current);
            hoverInfoTimeoutRef.current = setTimeout(() => setHoverInfo(null), 300);
            return;
          }

          const { StructureProperties, StructureElement } = cachedModules;

          if (StructureElement.Loci.is(loci)) {
            const location =
              StructureElement.Loci.getFirstLocation(loci);
            if (!location) return;

            const chainId =
              StructureProperties.chain.auth_asym_id(location);
            const entityId =
              StructureProperties.entity.id(location);
            const entityDesc =
              StructureProperties.entity.pdbx_description(location);
            const entityType =
              StructureProperties.entity.type(location);

            const {
              onEntityHover: eHover,
              onLigandHover: lHover,
              pdbId: currentPdbId,
            } = callbackRefs.current;

            const entityData = entityDataRef.current;

            if (
              entityType === 'non-polymer' ||
              entityType === 'macrolide'
            ) {
              // Improved ligand code resolution using entity data
              const ligCode = resolveLigandCode(
                entityId,
                entityDesc,
                entityData,
                knownLigandCodesRef.current
              );
              const resolvedCode = ligCode?.toUpperCase() ?? null;
              lHover?.(resolvedCode);

              // Update hover info tooltip
              if (resolvedCode) {
                const entity = entityData.find((e) => e.entity_id === entityId);
                lastHoveredRef.current = {
                  type: 'ligand',
                  key: resolvedCode,
                  entityId,
                  ligandCode: resolvedCode,
                  ligandName: typeof entityDesc === 'string' ? entityDesc : resolvedCode,
                  ligandType: entity?.molecule_type || 'non-polymer',
                };
                if (hoverInfoTimeoutRef.current) clearTimeout(hoverInfoTimeoutRef.current);
                setHoverInfo({
                  x: mousePositionRef.current.x,
                  y: mousePositionRef.current.y,
                  type: 'ligand',
                  ligandCode: resolvedCode,
                  ligandName: typeof entityDesc === 'string' ? entityDesc : resolvedCode,
                  ligandType: entity?.molecule_type || 'non-polymer',
                });
              }
            } else if (entityType !== 'water') {
              // Check if this polymer entity is a known peptide ligand
              const entity = entityData.find(
                (e) => e.entity_id === entityId
              );
              const maxChainLength = Math.max(
                ...(entity?.chains.map((c) => c.length ?? 0) || [0]),
                0
              );
              const isShortPeptide =
                entity &&
                entity.molecule_type
                  .toLowerCase()
                  .includes('polypeptide') &&
                maxChainLength > 0 &&
                maxChainLength <= 10;

              if (isShortPeptide && entity?.chains[0]) {
                const pepCode = `PEP_${entity.chains[0].chain}`;
                lHover?.(pepCode);
                lastHoveredRef.current = {
                  type: 'ligand',
                  key: pepCode,
                  chainId: entity.chains[0].chain,
                  entityId,
                  ligandCode: pepCode,
                  ligandName: entity.description,
                  ligandType: entity.molecule_type,
                };
                if (hoverInfoTimeoutRef.current) clearTimeout(hoverInfoTimeoutRef.current);
                setHoverInfo({
                  x: mousePositionRef.current.x,
                  y: mousePositionRef.current.y,
                  type: 'ligand',
                  ligandCode: pepCode,
                  ligandName: entity.description,
                  ligandType: entity.molecule_type,
                });
              } else {
                const entityKey = `${currentPdbId}.${chainId}`;
                eHover?.(entityKey);

                // Update hover info tooltip with entity data
                const totalResidues = entity?.chains.reduce(
                  (sum, c) => sum + (c.length || 0), 0
                ) || 0;
                lastHoveredRef.current = {
                  type: 'entity',
                  key: entityKey,
                  chainId,
                  entityId,
                  entityDesc: entity?.description || (typeof entityDesc === 'string' ? entityDesc : ''),
                  organism: entity?.organism || '',
                  residueCount: totalResidues,
                };
                if (hoverInfoTimeoutRef.current) clearTimeout(hoverInfoTimeoutRef.current);
                setHoverInfo({
                  x: mousePositionRef.current.x,
                  y: mousePositionRef.current.y,
                  type: 'entity',
                  chainId,
                  entityDesc: entity?.description || (typeof entityDesc === 'string' ? entityDesc : ''),
                  organism: entity?.organism || '',
                  residueCount: totalResidues,
                });
              }
            }
          }
        } catch (err) {
          // ignore hover errors
        }
      }
    );

    // ─── Right-click context menu handler ─────────────────────────────────
    const handleContextMenu = (e: MouseEvent) => {
      // Only intercept if we have a last hovered item from Molstar
      if (!lastHoveredRef.current) return;
      e.preventDefault();
      e.stopPropagation();

      const item = lastHoveredRef.current;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();

      setContextMenu({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        type: item.type,
        key: item.key,
        chainId: item.chainId,
        entityId: item.entityId,
        showColorPicker: false,
        entityDesc: item.entityDesc,
        organism: item.organism,
        residueCount: item.residueCount,
        ligandCode: item.ligandCode,
        ligandName: item.ligandName,
        ligandType: item.ligandType,
      });
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('contextmenu', handleContextMenu);
    }

    return () => {
      clickSub?.unsubscribe?.();
      hoverSub?.unsubscribe?.();
      if (container) {
        container.removeEventListener('contextmenu', handleContextMenu);
      }
    };
  }, []); // Intentionally empty: uses callbackRefs for current callback values

  // ─── Reset camera handler ────────────────────────────────────────────
  const handleResetCamera = useCallback(async () => {
    const plugin = pluginRef.current;
    if (!plugin) return;

    try {
      const { PluginCommands } = await getMolstarModules();
      PluginCommands.Camera.Reset(plugin, { durationMs: 400 });
    } catch {
      // ignore
    }
  }, []);

  // ─── Focus on highlighted entity/ligand ──────────────────────────────
  const handleFocusHighlighted = useCallback(async () => {
    const plugin = pluginRef.current;
    if (!plugin) return;
    plugin.managers?.camera?.reset(undefined, 400);
  }, []);

  // ─── Focus on a specific target (entity or ligand) ──────────────────
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

      const hierarchy = plugin.managers.structure.hierarchy.current;
      if (hierarchy) {
        for (const structure of hierarchy.structures) {
          for (const component of structure.components) {
            const compKey = component.key || '';
            const compLabel = component.cell?.obj?.label || '';
            const compTags: string[] = component.cell?.transform?.tags || [];

            let matches = false;
            if (type === 'entity') {
              const chainId = target.split('.')[1];
              if (chainId) {
                const hasChainTag = compTags.some(t => t === `chain-${chainId}` || t === `chain-${chainId.toLowerCase()}`);
                const labelMatches = compLabel === `Chain ${chainId}`;
                const keyExactMatch = compKey === chainId || compKey === `chain-${chainId}`;
                const isDefaultPolymer = compKey === 'structure-component-static-polymer' && !perChainComponentsCreatedRef.current;
                matches = hasChainTag || labelMatches || keyExactMatch || isDefaultPolymer;
              }
            } else {
              // Ligand: match by tag or label
              const hasLigandTag = compTags.some(t => t === `ligand-${target}`);
              const labelMatches = compLabel === `Ligand ${target}`;
              const fallbackMatch = compKey === 'structure-component-static-ligand';
              matches = hasLigandTag || labelMatches || fallbackMatch;
            }

            if (matches) {
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

      // Focus camera on target - just reset to default view (most reliable)
      try {
        const cam = plugin.managers?.camera;
        if (cam?.reset) {
          cam.reset(undefined, 400);
        }
      } catch (focusErr) {
        console.warn('[MoleculeViewer] Focus on target error:', focusErr);
      }
    } catch (err) {
      console.warn('[MoleculeViewer] Focus on target error:', err);
    }
  }, [structureLoaded]);

  // ─── Focus on residue handler ──────────────────────────────────────────
  const handleFocusOnResidue = useCallback(async (chainId: string, residueNumber: number) => {
    const plugin = pluginRef.current;
    if (!plugin || !structureLoaded) return;

    try {
      const { PluginCommands } = await getMolstarModules();

      // Clear previous highlights
      PluginCommands.Interactivity.ClearHighlights(plugin);

      // Apply dimming
      try {
        const currentProps = plugin.canvas3d?.props;
        if (currentProps) {
          PluginCommands.Canvas3D.SetSettings(plugin, {
            settings: {
              ...currentProps,
              select: {
                ...(currentProps as any).select,
                dim: { color: 0x444444, opacity: 0.4 },
              },
              highlight: {
                ...(currentProps as any).highlight,
                color: 0xffb800,
              },
            } as any,
          });
        }
      } catch { /* dimming not supported */ }

      // Highlight the residue's chain component
      const hierarchy = plugin.managers.structure.hierarchy.current;
      if (hierarchy) {
        for (const structure of hierarchy.structures) {
          for (const component of structure.components) {
            const compKey = component.key || '';
            const compLabel = component.cell?.obj?.label || '';
            const compTags: string[] = component.cell?.transform?.tags || [];

            // Match the chain component
            const hasChainTag = compTags.some(t => t === `chain-${chainId}` || t === `chain-${chainId.toLowerCase()}`);
            const labelMatches = compLabel === `Chain ${chainId}`;
            const keyExactMatch = compKey === chainId || compKey === `chain-${chainId}`;

            if (hasChainTag || labelMatches || keyExactMatch) {
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

      // Focus camera on the residue position
      plugin.managers?.camera?.reset(undefined, 400);
    } catch (err) {
      console.warn('[MoleculeViewer] Focus on residue error:', err);
    }
  }, [structureLoaded]);

  // ─── Screenshot handler ──────────────────────────────────────────────
  const handleScreenshot = useCallback(async () => {
    const plugin = pluginRef.current;
    if (!plugin) return;

    try {
      // Try Molstar's built-in screenshot helper first
      if (plugin.helpers.viewportScreenshot) {
        await plugin.helpers.viewportScreenshot.download({
          name: pdbId.toUpperCase(),
          transparency: backgroundMode === 'transparent' ? 'scene' : undefined,
        });
        return;
      }

      // Fallback: capture from canvas directly
      const canvas = containerRef.current?.querySelector('canvas');
      if (!canvas) return;

      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `${pdbId.toUpperCase()}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.warn('[MoleculeViewer] Screenshot error:', err);
    }
  }, [pdbId, backgroundMode]);

  // ─── Toggle spin/rotation ────────────────────────────────────────────
  const handleToggleSpin = useCallback(async () => {
    const plugin = pluginRef.current;
    if (!plugin) return;

    try {
      const { PluginCommands } = await getMolstarModules();
      const newSpinState = !isSpinning;

      // Toggle auto-rotation via Canvas3D settings
      if (plugin.canvas3d) {
        const currentProps = plugin.canvas3d.props;
        const trackball = currentProps.trackball;

        // Use the correct MappedStatic format for spin: { name: 'spin'|'off', params: {...} }
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
      console.warn('[MoleculeViewer] Spin toggle error:', err);
    }
  }, [isSpinning]);

  // ─── Expose viewer actions to parent via ref ──────────────────────────
  // Using a ref callback pattern to avoid dependency on useCallback references
  // which are defined later in the component.
  // Refs are updated after every render to satisfy react-hooks/refs
  // (no ref writes allowed during render).
  const viewerActionsRefInternal = useRef(viewerActionsRef);
  const isSpinningRef = useRef(isSpinning);
  useEffect(() => {
    viewerActionsRefInternal.current = viewerActionsRef;
    isSpinningRef.current = isSpinning;
  });

  // Update the viewerActionsRef after all handlers are defined
  // We use a layout effect pattern that runs after every render
  useEffect(() => {
    if (viewerActionsRefInternal.current) {
      viewerActionsRefInternal.current.current = {
        toggleSpin: handleToggleSpin,
        screenshot: handleScreenshot,
        resetCamera: handleResetCamera,
        isSpinning: isSpinningRef.current,
        focusOnTarget: handleFocusOnTarget,
        focusOnResidue: handleFocusOnResidue,
      };
    }
  });

  // ─── Toggle background ───────────────────────────────────────────────
  const handleToggleBackground = useCallback(() => {
    const modes: BackgroundMode[] = ['theme', 'white', 'dark', 'transparent'];
    const currentIndex = modes.indexOf(backgroundMode);
    const nextMode = modes[(currentIndex + 1) % modes.length];
    setBackgroundMode(nextMode);
  }, [backgroundMode]);

  // ─── Toggle Density (Volume Streaming) ─────────────────────────
  const handleToggleEDMap = useCallback(async () => {
    const newActive = !edMapActive;
    setEdMapActive(newActive);

    const plugin = pluginRef.current;
    if (!plugin || !structureLoaded) return;

    try {
      const { PluginStateObject, StateSelection, PluginCommands } = await getMolstarModules();
      const { InitVolumeStreaming } = await import('molstar/lib/mol-plugin/behavior/dynamic/volume-streaming/transformers.js');

      if (!newActive) {
        // Remove all density volumes
        const volumes = plugin.state.data.select(StateSelection.ofType(PluginStateObject.Volume));
        for (const vol of volumes) {
          plugin.state.data.removeObject(vol.transform.ref);
        }
        return;
      }

      // Find the current structure cell
      const structureCells = plugin.state.data.select(StateSelection.ofType(PluginStateObject.Molecule.Structure));
      if (!structureCells || structureCells.length === 0) {
        console.warn('[MoleculeViewer] No structure cell found for density loading');
        setEdMapActive(false);
        return;
      }

      const structureCell = structureCells[0];

      // Use InitVolumeStreaming via PluginCommands.State.ApplyAction
      await PluginCommands.State.ApplyAction(plugin, {
        state: plugin.state.data,
        action: InitVolumeStreaming.create({
          method: 'x-ray',
          entries: [{ id: pdbId.toUpperCase() }],
          defaultView: 'selection-box',
          options: {
            serverUrl: 'https://www.ebi.ac.uk/pdbe/densities/x-ray/',
            emContourProvider: 'pdbe',
            channelParams: {},
          },
        }),
        ref: structureCell.transform.ref,
      });
    } catch (err) {
      console.warn('[MoleculeViewer] Density load error:', err);
      setEdMapActive(false);
    }
  }, [edMapActive, pdbId, structureLoaded]);

  // ─── Fullscreen toggle ───────────────────────────────────────────────
  const handleToggleFullscreen = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    if (!document.fullscreenElement) {
      wrapper.requestFullscreen().catch(() => {
        // ignore fullscreen errors
      });
    } else {
      document.exitFullscreen().catch(() => {
        // ignore
      });
    }
  }, []);

  // ─── Assembly change ─────────────────────────────────────────────────
  const handleAssemblyChange = useCallback(async (assemblyId: string) => {
    const plugin = pluginRef.current;
    if (!plugin) return;

    setAssemblySwitching(true);
    setCurrentAssembly(assemblyId);

    try {
      const hierarchy = plugin.managers.structure.hierarchy.current;
      if (!hierarchy) return;

      for (const structure of hierarchy.structures) {
        const model = structure.model;
        if (!model) continue;

        // Try to update the assembly
        const params = {
          assembly: { id: assemblyId },
        };

        try {
          await plugin.managers.structure.hierarchy.updateStructure(
            [structure],
            params as any
          );
        } catch {
          // Assembly update might not be supported for this structure
        }
      }
    } catch (err) {
      console.warn('[MoleculeViewer] Assembly change error:', err);
    }

    // Brief animation delay for visual feedback
    setTimeout(() => {
      setAssemblySwitching(false);
    }, 300);
  }, []);

  // ─── Retry loading ───────────────────────────────────────────────────
  const handleRetry = useCallback(() => {
    setError(null);
    setWebglNotAvailable(false);
    loadedPdbRef.current = null;
    setStructureLoaded(false);
    setLoadProgress(0);

    if (pluginRef.current) {
      // Plugin exists — just re-trigger the structure load
      setPluginReady(false);
      requestAnimationFrame(() => {
        setPluginReady(true);
      });
    } else {
      // Plugin doesn't exist (e.g., WebGL was previously unavailable).
      // Increment initAttempt to re-trigger the init effect.
      setLoading(true);
      setInitAttempt((prev) => prev + 1);
    }
  }, []);

  // ─── Re-load when pdbId changes (reset loaded ref) ───────────────────
  // react-hooks/set-state-in-effect forbids synchronous setState() inside an
  // effect. The previous implementation did exactly that whenever pdbId
  // changed. The React-recommended pattern is to detect the change during
  // render and reset state there — setState() during render is allowed by
  // React (it queues an immediate re-render without committing intermediate
  // state). Refs that don't drive render output are cleared in an effect
  // after React has observed the new pdbId.
  const [prevPdbId, setPrevPdbId] = useState(pdbId);
  if (prevPdbId !== pdbId) {
    setPrevPdbId(pdbId);
    setStructureLoaded(false);
    setIsolateMode(null);
    setMeasurementTooltip(null);
    setSelectedItem(null);
  }
  useEffect(() => {
    loadedPdbRef.current = null;
    entityDataRef.current = [];
    knownLigandCodesRef.current = [];
    isolatedChainRef.current = null;
    lastClickLociRef.current = null;
    highlightSurfaceRefs.current = [];
  }, [pdbId]);

  // ─── Background mode icon ────────────────────────────────────────────
  const getBackgroundIcon = useCallback(() => {
    switch (backgroundMode) {
      case 'white':
        return <Sun className="w-3.5 h-3.5" />;
      case 'dark':
        return <Moon className="w-3.5 h-3.5" />;
      case 'transparent':
        return <Layers className="w-3.5 h-3.5" />;
      default:
        return darkMode ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />;
    }
  }, [backgroundMode, darkMode]);

  // ─── Representation label ────────────────────────────────────────────
  const representationLabel = representation === 'ball-stick' ? 'Ball & Stick' :
    representation.charAt(0).toUpperCase() + representation.slice(1);

  // ─── Close context menu on outside click ────────────────────────────
  useEffect(() => {
    if (!contextMenu) return;
    function handleClickOutside(e: MouseEvent) {
      setContextMenu(null);
    }
    // Delay to avoid immediately closing from the right-click that opened it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [contextMenu]);

  // ─── Context menu action handlers ──────────────────────────────────────
  const handleContextMenuColorChange = useCallback((color: string) => {
    if (!contextMenu) return;
    if (contextMenu.type === 'entity') {
      callbackRefs.current.onEntityColorChange?.(contextMenu.key, color);
    } else {
      callbackRefs.current.onLigandColorChange?.(contextMenu.key, color);
    }
    setContextMenu(null);
  }, [contextMenu]);

  const handleContextMenuToggleVisibility = useCallback(() => {
    if (!contextMenu) return;
    const plugin = pluginRef.current;
    if (!plugin) return;
    const hierarchy = plugin.managers.structure.hierarchy.current;
    if (!hierarchy) return;

    const key = contextMenu.key;
    for (const structure of hierarchy.structures) {
      for (const component of structure.components) {
        const compKey = component.key || '';
        const compLabel = component.cell?.obj?.label || '';
        const compTags: string[] = component.cell?.transform?.tags || [];
        let matches = false;
        if (contextMenu.type === 'entity') {
          const chainId = key.split('.')[1];
          if (chainId) {
            matches = compKey.toLowerCase().includes(chainId.toLowerCase()) ||
              compLabel.toLowerCase().includes(chainId.toLowerCase());
          }
        } else {
          const isLigand = compKey.toLowerCase().includes('ligand') ||
            compKey.toLowerCase().includes('non-polymer') ||
            compTags.some(t => t === 'ligand') ||
            compLabel.startsWith('Ligand ');
          if (isLigand) {
            const hasLigandTag = compTags.some(t => t === `ligand-${key}`);
            const labelMatches = compLabel === `Ligand ${key}`;
            matches = hasLigandTag || labelMatches ||
              compLabel.toLowerCase().includes(key.toLowerCase()) ||
              compKey.toLowerCase().includes(key.toLowerCase());
          }
        }
        if (matches) {
          plugin.managers.structure.hierarchy.toggleVisibility([component], 'toggle');
        }
      }
    }
    setContextMenu(null);
  }, [contextMenu]);

  const handleContextMenuFocus = useCallback(async () => {
    if (!contextMenu) return;
    const plugin = pluginRef.current;
    if (!plugin) return;
    plugin.managers?.camera?.reset(undefined, 400);
    setContextMenu(null);
  }, [contextMenu]);

  const handleContextMenuRepresentation = useCallback(async (rep: 'cartoon' | 'ball-stick' | 'surface') => {
    if (!contextMenu) return;
    const plugin = pluginRef.current;
    if (!plugin) return;

    const key = contextMenu.key;
    const hierarchy = plugin.managers.structure.hierarchy.current;
    if (!hierarchy) return;

    for (const structure of hierarchy.structures) {
      for (const component of structure.components) {
        const compKey = component.key || '';
        const compLabel = component.cell?.obj?.label || '';
        const compTags: string[] = component.cell?.transform?.tags || [];
        let matches = false;
        if (contextMenu.type === 'entity') {
          const chainId = key.split('.')[1];
          if (chainId) {
            matches = compKey.toLowerCase().includes(chainId.toLowerCase()) ||
              compLabel.toLowerCase().includes(chainId.toLowerCase());
          }
        } else {
          const isLigand = compKey.toLowerCase().includes('ligand') ||
            compKey.toLowerCase().includes('non-polymer') ||
            compTags.some(t => t === 'ligand') ||
            compLabel.startsWith('Ligand ');
          if (isLigand) {
            const hasLigandTag = compTags.some(t => t === `ligand-${key}`);
            const labelMatches = compLabel === `Ligand ${key}`;
            matches = hasLigandTag || labelMatches ||
              compLabel.toLowerCase().includes(key.toLowerCase()) ||
              compKey.toLowerCase().includes(key.toLowerCase());
          }
        }
        if (matches && component.representations.length > 0) {
          try {
            // Remove existing representations and add the new one
            const reprType = rep === 'ball-stick' ? 'ball-and-stick' : rep === 'surface' ? 'molecular-surface' : 'cartoon';

            // First remove old non-matching representations for this component
            const oldReprs = [...component.representations];
            const nonMatchingReprs = oldReprs.filter((r: any) => {
              const rType = r.cell?.transform?.params?.type?.name || r.cell?.transform?.params?.type;
              return rType !== reprType;
            });

            // Add the target representation if not already present
            const hasTarget = oldReprs.some((r: any) => {
              const rType = r.cell?.transform?.params?.type?.name || r.cell?.transform?.params?.type;
              return rType === reprType;
            });

            if (!hasTarget) {
              await plugin.managers.structure.component.addRepresentation([component], reprType);
            }

            // Remove old non-matching representations
            for (const oldRepr of nonMatchingReprs) {
              try {
                await plugin.managers.structure.component.removeRepresentations(
                  [component],
                  oldRepr
                );
              } catch {
                // ignore removal errors
              }
            }
          } catch {
            // Some representations may not be available
          }
        }
      }
    }
    setContextMenu(null);
  }, [contextMenu]);

  const handleContextMenuIsolate = useCallback(() => {
    if (!contextMenu) return;
    const key = contextMenu.key;
    const chainId = contextMenu.chainId || key.split('.')[1];
    if (chainId) {
      toggleIsolateModeRef.current(key, chainId);
    }
    setContextMenu(null);
  }, [contextMenu]);

  const handleContextMenuResetColor = useCallback(async () => {
    if (!contextMenu) return;
    const plugin = pluginRef.current;
    if (!plugin) return;

    const key = contextMenu.key;

    try {
      const { MolScriptBuilder, StructureSelectionQuery, StructureSelectionQueries } = await getMolstarModules();

      if (contextMenu.type === 'entity') {
        // For entity/chain colors, clear overpaint for this specific chain
        // and also reset the color theme for per-chain components
        const chainId = key.split('.')[1];
        if (chainId) {
          try {
            // Clear overpaint for this chain using applyTheme with resetColor
            // Use MolScriptBuilder instead of Script.toExpression (string parsing fails for chain queries)
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
          } catch { /* ignore overpaint reset errors */ }

          // Also reset any per-chain components
          const hierarchy = plugin.managers.structure.hierarchy.current;
          if (hierarchy) {
            for (const structure of hierarchy.structures) {
              for (const component of structure.components) {
                const compKey = component.key || '';
                const compLabel = component.cell?.obj?.label || '';
                const compTags: string[] = component.cell?.transform?.tags || [];

                const hasChainTag = compTags.some(t => t === `chain-${chainId}` || t === `chain-${chainId.toLowerCase()}`);
                const labelMatches = compLabel === `Chain ${chainId}`;
                const keyExactMatch = compKey === chainId || compKey === `chain-${chainId}`;

                if ((hasChainTag || labelMatches || keyExactMatch) && component.representations.length > 0) {
                  try {
                    await plugin.managers.structure.component.updateRepresentationsTheme(
                      [component],
                      { color: 'default' as const }
                    );
                  } catch { /* ignore */ }
                }
              }
            }
          }
        }
      } else {
        // For ligand colors, reset the color theme on matching ligand components
        const hierarchy = plugin.managers.structure.hierarchy.current;
        if (hierarchy) {
          for (const structure of hierarchy.structures) {
            for (const component of structure.components) {
              const compKey = component.key || '';
              const compLabel = component.cell?.obj?.label || '';
              const compTags: string[] = component.cell?.transform?.tags || [];
              const isLigand = compKey.toLowerCase().includes('ligand') ||
                compKey.toLowerCase().includes('non-polymer') ||
                compTags.some(t => t === 'ligand') ||
                compLabel.startsWith('Ligand ');
              const hasLigandTag = compTags.some(t => t === `ligand-${key}`);
              const labelMatches = compLabel === `Ligand ${key}`;
              const matchesLigand = hasLigandTag || labelMatches ||
                compLabel.toLowerCase().includes(key.toLowerCase()) ||
                compKey.toLowerCase().includes(key.toLowerCase());
              if (isLigand && matchesLigand &&
                  component.representations.length > 0) {
                try {
                  await plugin.managers.structure.component.updateRepresentationsTheme(
                    [component],
                    { color: 'default' as const }
                  );
                } catch { /* ignore */ }
              }
            }
          }
        }
      }
    } catch {
      // ignore
    }

    // Also notify parent about the color reset (empty string = reset)
    if (contextMenu.type === 'entity') {
      callbackRefs.current.onEntityColorChange?.(contextMenu.key, '');
    } else {
      callbackRefs.current.onLigandColorChange?.(contextMenu.key, '');
    }
    setContextMenu(null);
  }, [contextMenu]);

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <div
      ref={wrapperRef}
      className="relative flex-1 w-full h-full min-h-[300px] overflow-hidden rounded-lg bg-claude-bg"
    >
      {/* Molstar viewer container */}
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ minHeight: '300px' }}
      />

      {/* ─── Hover Info Tooltip ────────────────────────────────────────── */}
      {hoverInfo && !contextMenu && (
        <div
          className="absolute z-20 pointer-events-none"
          style={{
            left: Math.min(hoverInfo.x + 16, wrapperSize.width - 220),
            top: Math.max(hoverInfo.y - 10, 8),
          }}
        >
          <div className="px-3 py-2 rounded-lg bg-claude-surface/90 backdrop-blur-md border border-claude-border shadow-lg max-w-[200px] hover-info-tooltip">
            {hoverInfo.type === 'entity' ? (
              <>
                <div className="flex items-center gap-1.5 mb-1">
                  <Hexagon className="w-3 h-3 text-claude-accent flex-shrink-0" />
                  <span className="text-[10px] font-mono font-bold text-claude-text">
                    Chain {hoverInfo.chainId}
                  </span>
                </div>
                {hoverInfo.entityDesc && (
                  <p className="text-[9px] text-claude-text-secondary leading-tight mb-0.5 truncate" title={hoverInfo.entityDesc}>
                    {hoverInfo.entityDesc}
                  </p>
                )}
                {hoverInfo.organism && (
                  <p className="text-[8px] text-claude-text-muted italic truncate" title={hoverInfo.organism}>
                    {hoverInfo.organism}
                  </p>
                )}
                {hoverInfo.residueCount != null && hoverInfo.residueCount > 0 && (
                  <span className="text-[8px] text-claude-text-muted">
                    {hoverInfo.residueCount} residues
                  </span>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5 mb-1">
                  <FlaskConical className="w-3 h-3 text-amber-500 flex-shrink-0" />
                  <span className="text-[10px] font-mono font-bold text-claude-text">
                    {hoverInfo.ligandCode}
                  </span>
                </div>
                {hoverInfo.ligandName && hoverInfo.ligandName !== hoverInfo.ligandCode && (
                  <p className="text-[9px] text-claude-text-secondary leading-tight mb-0.5 truncate" title={hoverInfo.ligandName}>
                    {hoverInfo.ligandName}
                  </p>
                )}
                {hoverInfo.ligandType && (
                  <span className="text-[8px] text-claude-text-muted">
                    {hoverInfo.ligandType}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ─── Right-Click Context Menu (Enhanced & Polished) ──────────── */}
      {contextMenu && (
        <div
          className="absolute z-30"
          style={{
            left: Math.min(contextMenu.x, wrapperSize.width - (contextMenu.showColorPicker ? 220 : 200)),
            top: Math.min(contextMenu.y, wrapperSize.height - (contextMenu.showColorPicker ? 360 : 320)),
          }}
        >
          <div className="min-w-[180px] max-w-[220px] rounded-xl bg-claude-surface/95 backdrop-blur-xl border border-claude-border shadow-2xl overflow-hidden context-menu-enter">
            {/* Header with item info */}
            <div className="px-3 py-2 border-b border-claude-border-light bg-gradient-to-r from-claude-accent/10 to-claude-accent/5">
              <div className="flex items-center gap-2">
                {contextMenu.type === 'entity' ? (
                  <div className="w-5 h-5 rounded-md bg-claude-accent/20 flex items-center justify-center">
                    <Hexagon className="w-3 h-3 text-claude-accent" />
                  </div>
                ) : (
                  <div className="w-5 h-5 rounded-md bg-amber-500/20 flex items-center justify-center">
                    <FlaskConical className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-semibold uppercase tracking-wider text-claude-text-muted">
                      {contextMenu.type === 'entity' ? 'Chain' : 'Ligand'}
                    </span>
                    <span className="text-[10px] font-mono font-bold text-claude-text">
                      {contextMenu.type === 'entity' ? contextMenu.chainId || contextMenu.key.split('.')[1] : contextMenu.key}
                    </span>
                  </div>
                  {(contextMenu.entityDesc || contextMenu.ligandName) && (
                    <p className="text-[8px] text-claude-text-muted truncate mt-0.5" title={contextMenu.entityDesc || contextMenu.ligandName}>
                      {contextMenu.entityDesc || contextMenu.ligandName}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Menu items */}
            <div className="py-0.5">
              {/* Change Color - with inline picker */}
              <button
                onClick={() => setContextMenu({ ...contextMenu, showColorPicker: !contextMenu.showColorPicker })}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[10px] text-claude-text-secondary hover:bg-claude-accent-light hover:text-claude-accent transition-colors text-left"
              >
                <Palette className="w-3.5 h-3.5" />
                Change Color
                <ChevronRight className={`w-3 h-3 ml-auto transition-transform ${contextMenu.showColorPicker ? 'rotate-90' : ''}`} />
              </button>

              {/* Inline Color Picker (always visible when expanded) */}
              {contextMenu.showColorPicker && (
                <div className="px-3 py-2 border-b border-claude-border-light bg-claude-bg/30">
                  <div className="grid grid-cols-5 gap-1.5">
                    {PRESET_COLORS.map((color) => {
                      const currentColor = contextMenu.type === 'entity'
                        ? entityColors?.[contextMenu.key]
                        : ligandColors?.[contextMenu.key];
                      const isActive = currentColor?.toLowerCase() === color.toLowerCase();
                      return (
                        <button
                          key={color}
                          onClick={() => handleContextMenuColorChange(color)}
                          className={`w-7 h-7 rounded-md transition-all duration-150 hover:scale-110 hover:shadow-md
                            ${isActive ? 'ring-2 ring-claude-accent ring-offset-1 ring-offset-claude-surface scale-110' : 'border border-claude-border-light/50'}`}
                          style={{ backgroundColor: color }}
                          title={color}
                        />
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2 mt-2 pt-1.5 border-t border-claude-border-light">
                    <Pipette className="w-3 h-3 text-claude-text-muted flex-shrink-0" />
                    <input
                      type="color"
                      onChange={(e) => handleContextMenuColorChange(e.target.value)}
                      className="w-7 h-7 rounded-md cursor-pointer border border-claude-border bg-transparent"
                      title={locale === "zh" ? "自定义颜色" : "Custom color"}
                    />
                    <span className="text-[8px] text-claude-text-muted">Custom</span>
                  </div>
                </div>
              )}

              {/* Reset Color */}
              <button
                onClick={handleContextMenuResetColor}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[10px] text-claude-text-secondary hover:bg-claude-accent-light hover:text-claude-accent transition-colors text-left"
              >
                <Undo2 className="w-3.5 h-3.5" />
                Reset Color
              </button>

              <div className="border-t border-claude-border-light my-0.5" />

              {/* Focus on This */}
              <button
                onClick={handleContextMenuFocus}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[10px] text-claude-text-secondary hover:bg-claude-accent-light hover:text-claude-accent transition-colors text-left"
              >
                <ZoomIn className="w-3.5 h-3.5" />
                Focus on This
              </button>

              {/* Toggle Visibility */}
              <button
                onClick={handleContextMenuToggleVisibility}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[10px] text-claude-text-secondary hover:bg-claude-accent-light hover:text-claude-accent transition-colors text-left"
              >
                {contextMenu.type === 'entity' ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                Show / Hide
              </button>

              {/* Isolate This Chain (only for entities) */}
              {contextMenu.type === 'entity' && contextMenu.chainId && (
                <button
                  onClick={handleContextMenuIsolate}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[10px] text-claude-text-secondary hover:bg-claude-accent-light hover:text-claude-accent transition-colors text-left"
                >
                  <EyeOff className="w-3.5 h-3.5" />
                  Isolate Chain
                </button>
              )}

              {/* Representation submenu */}
              <div className="border-t border-claude-border-light my-0.5" />
              <div className="px-3 py-1 text-[8px] font-semibold uppercase tracking-wider text-claude-text-muted">
                {locale === 'zh' ? '表观模式' : 'Representation'}
              </div>
              <button
                onClick={() => handleContextMenuRepresentation('cartoon')}
                className="w-full flex items-center gap-2.5 px-3 py-1 text-[9px] text-claude-text-secondary hover:bg-claude-accent-light hover:text-claude-accent transition-colors text-left"
              >
                <Box className="w-3 h-3" />
                {locale === 'zh' ? '卡通' : 'Cartoon'}
              </button>
              <button
                onClick={() => handleContextMenuRepresentation('ball-stick')}
                className="w-full flex items-center gap-2.5 px-3 py-1 text-[9px] text-claude-text-secondary hover:bg-claude-accent-light hover:text-claude-accent transition-colors text-left"
              >
                <FlaskConical className="w-3 h-3" />
                {locale === 'zh' ? '球棒' : 'Ball & Stick'}
              </button>
              <button
                onClick={() => handleContextMenuRepresentation('surface')}
                className="w-full flex items-center gap-2.5 px-3 py-1 text-[9px] text-claude-text-secondary hover:bg-claude-accent-light hover:text-claude-accent transition-colors text-left"
              >
                <Hexagon className="w-3 h-3" />
                {locale === 'zh' ? '表面' : 'Surface'}
              </button>
            </div>

            {/* Footer hint */}
            <div className="px-3 py-1.5 border-t border-claude-border-light bg-claude-bg/30">
              <span className="text-[7px] text-claude-text-muted">{locale === 'zh' ? '按 Esc 关闭' : 'Esc to close'}</span>
            </div>
          </div>
        </div>
      )}

      {/* ─── Measurement Tooltip Overlay ──────────────────────────────── */}
      {measurementTooltip && (
        <div
          className="absolute z-30 pointer-events-auto"
          style={{
            left: Math.min(mousePosition.x + 16, wrapperSize.width - 200),
            top: Math.min(mousePosition.y - 40, wrapperSize.height - 60),
          }}
        >
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg glass-panel-strong border border-claude-accent/30 shadow-lg animate-in fade-in slide-in-from-bottom-1 duration-200">
            <Ruler className="w-3.5 h-3.5 text-claude-accent flex-shrink-0" />
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] font-mono font-bold text-claude-accent">
                {measurementTooltip.distance.toFixed(2)} Å
              </span>
              <span className="text-[9px] text-claude-text-muted">
                {measurementTooltip.from} → {measurementTooltip.to}
              </span>
            </div>
            <button
              onClick={() => setMeasurementTooltip(null)}
              className="ml-1 p-0.5 rounded text-claude-text-muted hover:text-claude-text transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* ─── Isolate Mode Indicator ──────────────────────────────────── */}
      {isolateMode && (
        <div className="absolute top-3 right-3 z-10">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg glass-panel-strong border border-amber-400/30 shadow-lg animate-in fade-in slide-in-from-top-1 duration-200">
            <EyeOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-300">
              Isolated: {isolateMode.split('.')[1]}
            </span>
            <button
              onClick={() => {
                toggleIsolateModeRef.current(isolateMode, isolateMode.split('.')[1]);
              }}
              className="ml-1 p-0.5 rounded text-claude-text-muted hover:text-claude-text transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* ─── Enhanced Overlay Toolbar (Top-Left) ─── */}
      <div className="absolute top-3 left-3 z-10">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-claude-surface/60 backdrop-blur-md border border-claude-border-light/60 shadow-sm">
          {/* Reset Camera */}
          <ToolbarButton
            onClick={handleResetCamera}
            icon={<RotateCcw className="w-3.5 h-3.5" />}
            label={locale === 'zh' ? '重置相机' : 'Reset Camera'}
          />

          {/* Focus on Highlighted */}
          {hasHighlight && (
            <ToolbarButton
              onClick={handleFocusHighlighted}
              icon={<Crosshair className="w-3.5 h-3.5" />}
              label={locale === 'zh' ? '聚焦选中' : 'Focus on Selection'}
              active
            />
          )}

          {/* Screenshot */}
          <ToolbarButton
            onClick={handleScreenshot}
            icon={<Camera className="w-3.5 h-3.5" />}
            label={locale === 'zh' ? '截图（PNG）' : 'Screenshot (PNG)'}
            disabled={!structureLoaded}
          />

          {/* Toggle Spin */}
          <ToolbarButton
            onClick={handleToggleSpin}
            icon={<RefreshCw className={`w-3.5 h-3.5 ${isSpinning ? 'animate-spin' : ''}`} />}
            label={isSpinning ? (locale === 'zh' ? '停止旋转' : 'Stop Rotation') : (locale === 'zh' ? '自动旋转' : 'Auto-Rotate')}
            active={isSpinning}
            disabled={!structureLoaded}
          />

          {/* Toggle Density */}
          <ToolbarButton
            onClick={handleToggleEDMap}
            icon={<Boxes className="w-3.5 h-3.5" />}
            label={edMapActive ? (locale === 'zh' ? '密度：开' : 'Density: ON') : (locale === 'zh' ? '密度：关' : 'Density: OFF')}
            active={edMapActive}
            disabled={!structureLoaded}
          />

          {/* Toggle Background */}
          <ToolbarButton
            onClick={handleToggleBackground}
            icon={getBackgroundIcon()}
            label={locale === 'zh' ? `背景：${BACKGROUND_LABELS[backgroundMode]}` : `Background: ${BACKGROUND_LABELS[backgroundMode]}`}
          />

          {/* Fullscreen */}
          <ToolbarButton
            onClick={handleToggleFullscreen}
            icon={isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
            label={isFullscreen ? (locale === 'zh' ? '退出全屏' : 'Exit Fullscreen') : (locale === 'zh' ? '全屏' : 'Fullscreen')}
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
                           hover:border-claude-border shadow-sm transition-all duration-150 viewer-toolbar-polish"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              className="bg-claude-surface text-claude-text border border-claude-border shadow-lg"
            >
              {locale === 'zh' ? '在 RCSB PDB 上查看' : 'View on RCSB PDB'}
            </TooltipContent>
          </Tooltip>

          {/* Separator */}
          <div className="w-px h-5 bg-claude-border-light mx-0.5" />

          {/* Reset colors */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onResetColors ?? (() => {})}
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
                onClick={onToggleAllLigands ?? (() => {})}
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
                onClick={onToggleAllExpanded ?? (() => {})}
                className="flex items-center justify-center w-7 h-7 rounded-md backdrop-blur-sm border bg-claude-surface/80 border-claude-border-light text-claude-text-secondary hover:text-claude-accent hover:bg-claude-surface hover:border-claude-border shadow-sm transition-all duration-150"
              >
                <UnfoldVertical className="w-3.5 h-3.5" />
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

        {/* ED Map Level Panel (shown when density is active) */}
        {edMapActive && structureLoaded && (
          <div
            className="mt-1.5 p-2 rounded-lg bg-claude-surface/70 backdrop-blur-md border border-claude-border-light/60 shadow-sm"
          >
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
              onChange={(e) => setEdMapLevel(parseFloat(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer
                         bg-claude-border-light accent-claude-accent"
            />
            <div className="flex justify-between text-[7px] text-claude-text-muted mt-0.5">
              <span>0.5σ</span>
              <span>2Fo-Fc</span>
              <span>3.0σ</span>
            </div>
          </div>
        )}

        {/* Assembly switcher panel (only shown if multiple assemblies) */}
        {assemblies.length > 1 && (
          <div
            className={`mt-1.5 p-1.5 rounded-lg gradient-border bg-claude-surface/70 backdrop-blur-md border border-claude-border-light/60 shadow-sm
                       transition-all duration-300 ${assemblySwitching ? 'opacity-70 scale-[0.98]' : 'opacity-100 scale-100'}`}
          >
            <div className="flex items-center gap-1 mb-1">
              <Layers className="w-3 h-3 text-claude-accent flex-shrink-0" />
              <span className="text-[9px] font-semibold uppercase tracking-wider text-claude-text-muted">
                Assembly
              </span>
            </div>
            {/* Segmented control buttons */}
            <div className="flex rounded-md overflow-hidden border border-claude-border-light">
              {assemblies.map((id) => (
                <button
                  key={id}
                  onClick={() => handleAssemblyChange(id)}
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
            {/* Assembly description from RCSB data */}
            {assemblyDescriptions[currentAssembly] && (
              <p className="text-[8px] text-claude-text-muted mt-1 leading-tight truncate" title={assemblyDescriptions[currentAssembly]}>
                {assemblyDescriptions[currentAssembly]}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ─── Viewer Stats Overlay (Bottom) ────────────────────────────── */}
      {structureLoaded && !loading && (
        <div className="absolute bottom-3 left-3 right-3 z-10 pointer-events-none">
          <div className="flex items-center justify-between gap-3 px-3 py-1.5 rounded-lg glass-panel-strong">
            <div className="flex items-center gap-3">
              {/* Representation type */}
              <span className="text-[10px] font-medium text-claude-text-secondary flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-claude-accent" />
                {representationLabel}
              </span>

              {/* Atom count */}
              <span className="text-[10px] font-mono text-claude-text-muted count-tick">
                {formatCount(atomCount)} atoms
              </span>

              {/* Residue count */}
              {residueCount > 0 && (
                <span className="text-[10px] font-mono text-claude-text-muted count-tick">
                  {formatCount(residueCount)} residues
                </span>
              )}

              {/* ED Map badge */}
              {edMapActive && (
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded
                               bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400
                               flex items-center gap-0.5">
                  <Waves className="w-2.5 h-2.5" />
                  EDMap
                </span>
              )}
            </div>

            {/* Interaction hints */}
            <span className="text-[8px] text-claude-text-muted hidden sm:inline-flex items-center gap-1">
              <span className="opacity-50">Shift+Click: measure</span>
              <span className="opacity-30">·</span>
              <span className="opacity-50">Dbl-click: isolate</span>
            </span>

            {/* PDB ID with link */}
            <a
              href={`https://www.rcsb.org/structure/${(showStatsPdbId || pdbId).toUpperCase()}`}
              target="_blank"
              rel="noopener noreferrer"
              className="pointer-events-auto text-[10px] font-mono font-bold text-claude-accent
                         hover:text-claude-accent-hover transition-colors"
            >
              {(showStatsPdbId || pdbId).toUpperCase()}
            </a>
            {/* Overlay PDB ID indicator */}
            {overlayPdbId && loadedOverlay === overlayPdbId && (
              <span className="flex items-center gap-1 text-[9px]">
                <span className="text-claude-text-muted">+</span>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: overlayColorHex || '#ea580c' }} />
                <span className="font-mono font-bold" style={{ color: overlayColorHex || '#ea580c' }}>
                  {(overlayPdbId ?? '').toUpperCase()}
                </span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* ─── Loading Overlay (Enhanced) ───────────────────────────────── */}
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center
                       bg-claude-bg/80 backdrop-blur-sm z-20">
          {/* Animated molecule icon */}
          <div className="relative mb-4">
            <div className="w-16 h-16 rounded-2xl bg-claude-accent-light flex items-center justify-center
                           animate-pulse">
              <svg
                className="w-8 h-8 text-claude-accent"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <circle cx="4" cy="6" r="2" />
                <circle cx="20" cy="6" r="2" />
                <circle cx="4" cy="18" r="2" />
                <circle cx="20" cy="18" r="2" />
                <line x1="9.5" y1="10.5" x2="5.5" y2="7.5" />
                <line x1="14.5" y1="10.5" x2="18.5" y2="7.5" />
                <line x1="9.5" y1="13.5" x2="5.5" y2="16.5" />
                <line x1="14.5" y1="13.5" x2="18.5" y2="16.5" />
              </svg>
            </div>
          </div>

          {/* Progress bar */}
          <div className="w-48 h-1.5 rounded-full bg-claude-border-light overflow-hidden data-flow-bar">
            <div
              className="h-full rounded-full viewer-progress-gradient transition-all duration-500 ease-out progress-pulse"
              style={{ width: `${loadProgress}%` }}
            />
          </div>

          <p className="text-sm text-claude-text font-medium mb-1">
            {locale === 'zh' ? `加载 ${pdbId.toUpperCase()} 中…` : `Loading ${pdbId.toUpperCase()}...`}
          </p>
          <p className="text-xs text-claude-text-muted">
            {loadProgress < 30
              ? (locale === 'zh' ? '正在连接 RCSB PDB…' : 'Connecting to RCSB PDB...')
              : loadProgress < 60
              ? (locale === 'zh' ? '正在下载结构数据…' : 'Downloading structure data...')
              : loadProgress < 90
              ? (locale === 'zh' ? '正在渲染 3D 结构…' : 'Rendering 3D structure...')
              : (locale === 'zh' ? '即将完成…' : 'Almost ready...')}
          </p>

          {/* Subtle loading animation dots */}
          <div className="flex items-center gap-1 mt-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-claude-accent"
                style={{
                  animation: `indicator-pulse 1.5s ease-in-out ${i * 0.3}s infinite`,
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* ─── Error Overlay (Enhanced with Retry) ──────────────────────── */}
      {error && !loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center
                       viewer-error-bg backdrop-blur-sm z-20">
          <div className={`rounded-2xl flex items-center justify-center mb-4 depth-float
                         ${webglNotAvailable ? 'w-16 h-16 bg-amber-100 dark:bg-amber-900/20' : 'w-14 h-14 bg-red-100 dark:bg-red-900/20'}`}>
            {webglNotAvailable ? (
              <Box className="w-8 h-8 text-amber-600 dark:text-amber-400" />
            ) : (
              <AlertTriangle className="w-7 h-7 text-claude-top" />
            )}
          </div>

          <p className="text-sm text-claude-text font-medium mb-1 text-center px-6">
            {error}
          </p>
          <p className="text-xs text-claude-text-muted mb-4 text-center">
            {webglNotAvailable
              ? (locale === 'zh' ? '3D 渲染需要 WebGL 支持' : '3D rendering requires WebGL support')
              : (locale === 'zh' ? '无法加载 3D 结构' : 'Unable to load the 3D structure')}
          </p>

          <div className="flex items-center gap-2">
            {/* Retry button */}
            <button
              onClick={handleRetry}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                         rounded-md bg-claude-accent text-white
                         hover:bg-claude-accent-hover transition-colors shadow-sm"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {locale === 'zh' ? '重试' : 'Retry'}
            </button>

            {/* RCSB link */}
            <a
              href={`https://www.rcsb.org/structure/${pdbId.toUpperCase()}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                         rounded-md border border-claude-border
                         bg-claude-surface text-claude-text-secondary
                         hover:text-claude-text hover:bg-claude-accent-light transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              {locale === 'zh' ? '在 RCSB 上查看' : 'View on RCSB'}
            </a>

            {/* Load from RCSB directly — opens RCSB 3D viewer in a new tab */}
            <a
              href={`https://www.rcsb.org/3d-view/${pdbId.toUpperCase()}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                         rounded-md border border-claude-border
                         bg-claude-surface text-claude-text-secondary
                         hover:text-claude-text hover:bg-claude-accent-light transition-colors"
            >
              <Hexagon className="w-3.5 h-3.5" />
              Load from RCSB directly
            </a>

            {/* Download CIF */}
            <a
              href={`https://files.rcsb.org/download/${pdbId.toUpperCase()}.cif`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                         rounded-md border border-claude-border
                         bg-claude-surface text-claude-text-secondary
                         hover:text-claude-text hover:bg-claude-accent-light transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              CIF File
            </a>
          </div>
        </div>
      )}

      {/* ─── Floating Action Panel for Selected Items ─────────────────── */}
      {selectedItem && !contextMenu && (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl
                         bg-claude-surface/85 backdrop-blur-xl border border-claude-border
                         shadow-2xl animate-in fade-in slide-in-from-bottom-3 duration-300">
            {/* Item info */}
            <div className="flex items-center gap-2 min-w-0">
              {selectedItem.type === 'entity' ? (
                <>
                  <div className="w-7 h-7 rounded-lg bg-claude-accent/20 flex items-center justify-center flex-shrink-0">
                    <Hexagon className="w-4 h-4 text-claude-accent" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-mono font-bold text-claude-text">
                        Chain {selectedItem.chainId}
                      </span>
                      {selectedItem.residueCount != null && selectedItem.residueCount > 0 && (
                        <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-claude-accent/10 text-claude-accent font-medium">
                          {selectedItem.residueCount} res
                        </span>
                      )}
                    </div>
                    {selectedItem.entityDesc && (
                      <p className="text-[9px] text-claude-text-muted truncate max-w-[140px]" title={selectedItem.entityDesc}>
                        {selectedItem.entityDesc}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="w-7 h-7 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                    <FlaskConical className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-mono font-bold text-claude-text">
                        {selectedItem.ligandCode}
                      </span>
                      {selectedItem.ligandType && (
                        <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium">
                          {selectedItem.ligandType === 'non-polymer' ? 'Ligand' : selectedItem.ligandType}
                        </span>
                      )}
                    </div>
                    {selectedItem.ligandName && selectedItem.ligandName !== selectedItem.ligandCode && (
                      <p className="text-[9px] text-claude-text-muted truncate max-w-[140px]" title={selectedItem.ligandName}>
                        {selectedItem.ligandName}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Divider */}
            <div className="w-px h-7 bg-claude-border-light" />

            {/* Quick action buttons */}
            <div className="flex items-center gap-1">
              {/* Change Color */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => {
                      // Open context menu at the panel's position as a color picker trigger
                      setContextMenu({
                        x: (wrapperRef.current?.clientWidth || 400) / 2 - 100,
                        y: (wrapperRef.current?.clientHeight || 400) - 80,
                        type: selectedItem.type,
                        key: selectedItem.key,
                        chainId: selectedItem.chainId,
                        entityId: selectedItem.entityId,
                        showColorPicker: true,
                        entityDesc: selectedItem.entityDesc,
                        organism: selectedItem.organism,
                        residueCount: selectedItem.residueCount,
                        ligandCode: selectedItem.ligandCode,
                        ligandName: selectedItem.ligandName,
                        ligandType: selectedItem.ligandType,
                      });
                    }}
                    className="flex items-center justify-center w-8 h-8 rounded-lg
                               bg-claude-bg/60 border border-claude-border-light
                               text-claude-text-secondary hover:text-claude-accent
                               hover:border-claude-accent/30 hover:bg-claude-accent-light
                               transition-all duration-150"
                  >
                    <Palette className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="bg-claude-surface text-claude-text border border-claude-border shadow-lg">
                  Change Color
                </TooltipContent>
              </Tooltip>

              {/* Focus */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => {
                      const plugin = pluginRef.current;
                      if (!plugin) return;
                      plugin.managers?.camera?.reset(undefined, 400);
                    }}
                    className="flex items-center justify-center w-8 h-8 rounded-lg
                               bg-claude-bg/60 border border-claude-border-light
                               text-claude-text-secondary hover:text-claude-accent
                               hover:border-claude-accent/30 hover:bg-claude-accent-light
                               transition-all duration-150"
                  >
                    <Crosshair className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="bg-claude-surface text-claude-text border border-claude-border shadow-lg">
                  Focus
                </TooltipContent>
              </Tooltip>

              {/* Isolate (only for entities with chainId) */}
              {selectedItem.type === 'entity' && selectedItem.chainId && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => {
                        toggleIsolateModeRef.current(selectedItem.key, selectedItem.chainId!);
                      }}
                      className="flex items-center justify-center w-8 h-8 rounded-lg
                                 bg-claude-bg/60 border border-claude-border-light
                                 text-claude-text-secondary hover:text-amber-600
                                 hover:border-amber-400/30 hover:bg-amber-50
                                 dark:hover:bg-amber-900/20
                                 transition-all duration-150"
                    >
                      <EyeOff className="w-4 h-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="bg-claude-surface text-claude-text border border-claude-border shadow-lg">
                    Isolate Chain
                  </TooltipContent>
                </Tooltip>
              )}

              {/* Deselect */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => {
                      setSelectedItem(null);
                      // Also clear Molstar highlights
                      const plugin = pluginRef.current;
                      if (plugin) {
                        getMolstarModules().then(({ PluginCommands }) => {
                          try {
                            PluginCommands.Interactivity.ClearHighlights(plugin);
                            // Reset dimming
                            const currentProps = plugin.canvas3d?.props;
                            if (currentProps) {
                              PluginCommands.Canvas3D.SetSettings(plugin, {
                                settings: {
                                  ...currentProps,
                                  select: {
                                    ...(currentProps as any).select,
                                    dim: { color: 0x000000, opacity: 0 },
                                  },
                                } as any,
                              });
                            }
                          } catch { /* ignore */ }
                        });
                      }
                    }}
                    className="flex items-center justify-center w-8 h-8 rounded-lg
                               bg-claude-bg/60 border border-claude-border-light
                               text-claude-text-secondary hover:text-red-500
                               hover:border-red-300/30 hover:bg-red-50
                               dark:hover:bg-red-900/20
                               transition-all duration-150"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="bg-claude-surface text-claude-text border border-claude-border shadow-lg">
                  Deselect (Esc)
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MoleculeViewer;
