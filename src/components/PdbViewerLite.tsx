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
 *  3. Shows an interactive entity/chain/ligand panel beside the 3D canvas
 *     (replicating the old PdbStructureViewer's entity panel functionality)
 *  4. Cleans up on unmount
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { MolstarViewer } from '@/components/molcraft-molstar/molstar-viewer';
import { MeasureOverlay } from '@/components/molcraft-molstar/measure-overlay';
import { useAppStore } from '@/lib/molcraft/store';
import { executeCommand } from '@/lib/molcraft/commands';
import { useAtomPicking } from '@/components/structure-analysis/use-atom-picking';
import {
  Loader2, ChevronDown, Eye, EyeOff, Layers, Focus,
  Dna, Pill, Droplet, Ruler, Triangle, MousePointerClick, X,
  Sigma, Tag,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible';

interface PdbViewerLiteProps {
  pdbId: string;
  className?: string;
}

interface EntityData {
  entityId: string;
  chains: string[];
  authChains: string[];
  sequenceLength: number;
  description: string;
  organism: string;
  entityType: string;
  geneName?: string;
  moleculeType?: string;
}

interface LigandData {
  entityId: string;
  compId: string;
  name: string;
  formulaWeight: number | null;
}

const ENTITY_COLORS = [
  '#c96442', '#2d8f8f', '#7c5cbf', '#c9872e',
  '#16a34a', '#ea580c', '#dc2626', '#0891b2',
  '#7c3aed', '#db2777',
];

export function PdbViewerLite({ pdbId, className }: PdbViewerLiteProps) {
  const viewer = useAppStore((s) => s.viewer);
  const ready = useAppStore((s) => s.ready);
  const toast = useAppStore((s) => s.toast);
  const measureMode = useAppStore((s) => s.measureMode);
  const setMeasureMode = useAppStore((s) => s.setMeasureMode);
  const measurements = useAppStore((s) => s.measurements);
  const measureProgress = useAppStore((s) => s.measureProgress);
  const pickedAtoms = useAppStore((s) => s.pickedAtoms);
  const removeMeasurement = useAppStore((s) => s.removeMeasurement);
  const clearMeasurements = useAppStore((s) => s.clearMeasurements);
  const clearInteractionLines = useAppStore((s) => s.clearInteractionLines);
  const loadedRef = useRef<string | null>(null);
  // Track the viewer instance used for the current loaded pdbId. When the
  // viewer reference changes (e.g. modal reopened with a new MolstarViewer),
  // we reset loadedRef so the structure reloads against the new viewer.
  // This is the belt-and-suspenders fix for the "second PDB doesn't load"
  // bug (the primary fix is the guarded store clear in molstar-viewer.tsx).
  const loadedViewerRef = useRef<typeof viewer>(null);
  const [entities, setEntities] = useState<EntityData[]>([]);
  const [ligands, setLigands] = useState<LigandData[]>([]);
  const [entityLoading, setEntityLoading] = useState(false);
  const [expandedEntities, setExpandedEntities] = useState<Set<string>>(new Set());
  // Visibility: track which chains are hidden (like old PdbStructureViewer)
  const [chainVisibility, setChainVisibility] = useState<Record<string, boolean>>({});
  // Solo mode: when set, only this chain is visible (like old 'show only')
  const [soloChain, setSoloChain] = useState<string | null>(null);

  // Enable Molcraft-style click-to-pick atom selection for distance/angle measurement
  useAtomPicking();

  // Load the PDB structure when the viewer is ready and pdbId changes.
  // Also reload when the viewer instance itself changes (modal reopen),
  // even if pdbId is the same — the old viewer was disposed.
  useEffect(() => {
    if (!viewer || !ready || !pdbId) return;
    if (loadedViewerRef.current !== viewer) {
      // New viewer instance — discard any prior load tracking.
      loadedViewerRef.current = viewer;
      loadedRef.current = null;
    }
    if (loadedRef.current === pdbId) return;

    loadedRef.current = pdbId;
    let cancelled = false;

    (async () => {
      try {
        const res = await executeCommand(viewer, { type: 'load_pdb', id: pdbId });
        if (cancelled) return;
        if (!res.ok) {
          toast(`Failed to load ${pdbId}: ${res.detail}`, "error");
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        toast(`Load error: ${msg}`, "error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [viewer, ready, pdbId, toast]);

  // Fetch entity data from RCSB Data API
  useEffect(() => {
    if (!pdbId || !/^[a-zA-Z0-9]{4}$/.test(pdbId)) return;
    let cancelled = false;
    // Use microtask to avoid set-state-in-effect lint rule
    Promise.resolve().then(() => {
      if (cancelled) return;
      setEntityLoading(true);
      setEntities([]);
      setLigands([]);
      setChainVisibility({});
      setSoloChain(null);
    });
    fetch(`/api/analyze/metadata?id=${pdbId}&interfaces=0`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data) {
          if (!cancelled) setEntityLoading(false);
          return;
        }
        const polys: EntityData[] = (data.polymers ?? []).map((p: any) => ({
          entityId: p.entityId,
          chains: p.chains ?? [],
          authChains: p.authChains ?? p.chains ?? [],
          sequenceLength: p.sequenceLength ?? 0,
          description: p.description ?? '',
          organism: p.organism ?? '',
          entityType: p.entityType ?? '',
          geneName: p.geneName ?? p.gene_name ?? undefined,
          moleculeType: p.moleculeType ?? p.molecule_type ?? p.entityType ?? undefined,
        }));
        const nonpolys: LigandData[] = (data.nonpolymers ?? []).map((np: any) => ({
          entityId: np.entityId,
          compId: np.compId ?? '',
          name: np.name ?? '',
          formulaWeight: np.formulaWeight ?? null,
        }));
        if (!cancelled) {
          setEntities(polys);
          setLigands(nonpolys);
          if (polys.length > 0) {
            setExpandedEntities(new Set([`poly-${polys[0].entityId}`]));
          }
          setEntityLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setEntityLoading(false);
      });
    return () => { cancelled = true; };
  }, [pdbId]);

  // Focus on a specific chain in the 3D viewer
  const focusChain = useCallback(async (chain: string) => {
    if (!viewer) return;
    try {
      const res = await executeCommand(viewer, { type: 'focus_chain', chain });
      if (res.ok) {
        toast(`Focused chain ${chain}`, 'info');
      } else {
        toast(`Focus failed: ${res.detail}`, 'error');
      }
    } catch (err) {
      toast('Focus failed', 'error');
    }
  }, [viewer, toast]);

  // Focus on a specific ligand
  const focusLigand = useCallback(async (compId: string) => {
    if (!viewer) return;
    try {
      const res = await executeCommand(viewer, { type: 'focus_ligand', compId });
      if (res.ok) {
        toast(`Focused ligand ${compId}`, 'info');
      } else {
        toast(`Focus failed: ${res.detail}`, 'error');
      }
    } catch (err) {
      toast('Focus failed', 'error');
    }
  }, [viewer, toast]);

  // Apply visibility to all chains in the 3D viewer.
  // Uses the toggle_component_visibility command which creates per-chain
  // components on demand (via tryCreateComponentStatic) and toggles them.
  // The previous approach tried to match component labels like "Chain A" but
  // Molstar creates "Polymer"/"Ligand"/"Water" components, not per-chain.
  const applyChainVisibility = useCallback(async () => {
    if (!viewer) return;
    const allChains = entities.flatMap(e => e.chains);
    for (const chain of allChains) {
      let action: 'show' | 'hide';
      if (soloChain) {
        action = chain === soloChain ? 'show' : 'hide';
      } else {
        action = chainVisibility[chain] === false ? 'hide' : 'show';
      }
      try {
        await executeCommand(viewer, {
          type: 'toggle_component_visibility',
          component: chain,
          action,
        });
      } catch {
        // ignore individual chain errors
      }
    }
  }, [viewer, entities, chainVisibility, soloChain]);

  // Apply visibility whenever chainVisibility or soloChain changes
  useEffect(() => {
    if (!ready || !viewer) return;
    applyChainVisibility();
  }, [ready, viewer, applyChainVisibility]);

  // Toggle a single chain's visibility (eye icon)
  const toggleChainVisibility = useCallback((chain: string) => {
    setChainVisibility(prev => ({
      ...prev,
      [chain]: prev[chain] === false ? true : false,
    }));
    // Clear solo mode when toggling individual chains
    setSoloChain(null);
    toast(`Chain ${chain} ${chainVisibility[chain] === false ? 'shown' : 'hidden'}`, 'info');
  }, [chainVisibility, toast]);

  // Solo a chain (show only this chain, hide all others)
  const toggleSoloChain = useCallback((chain: string) => {
    setSoloChain(prev => prev === chain ? null : chain);
    toast(soloChain === chain ? `Exit solo mode` : `Solo: showing only chain ${chain}`, 'info');
  }, [soloChain, toast]);

  // Toggle entity expansion
  const toggleEntity = useCallback((entityKey: string) => {
    setExpandedEntities(prev => {
      const next = new Set(prev);
      if (next.has(entityKey)) next.delete(entityKey);
      else next.add(entityKey);
      return next;
    });
  }, []);

  // Clear on unmount
  useEffect(() => {
    return () => {
      loadedRef.current = null;
    };
  }, []);

  const hasEntityData = entities.length > 0 || ligands.length > 0;

  // Clear all measurements + Molstar measurement manager + overlay lines
  const handleClearMeasurements = useCallback(() => {
    clearMeasurements();
    clearInteractionLines();
    if (viewer) {
      try {
        viewer.plugin.managers.structure.measurement.clear();
      } catch { /* ignore */ }
    }
    toast('Measurements cleared', 'info');
  }, [viewer, clearMeasurements, clearInteractionLines, toast]);

  return (
    <div className={className} style={{ display: 'flex', width: '100%', height: '100%' }}>
      {/* 3D Viewer — takes remaining space */}
      <div className="relative flex-1 min-w-0">
        <MolstarViewer className="absolute inset-0" />
        {/* 2D canvas overlay — draws measurement lines/spheres/labels on
            top of the 3D viewport. pointer-events:none so clicks pass through. */}
        <MeasureOverlay />

        {/* Measurement toolbar — top-left overlay */}
        {ready && (
          <div className="absolute top-2 left-2 z-20 flex items-center gap-1 bg-claude-surface/90 dark:bg-[#242220]/90 backdrop-blur-sm rounded-lg border border-claude-border/60 dark:border-[#3d3832]/60 p-1 shadow-sm">
            <Button
              size="sm"
              variant={measureMode === 'distance' ? 'default' : 'ghost'}
              className={`h-7 px-2 text-[10px] gap-1 ${measureMode === 'distance' ? 'bg-claude-accent text-white' : ''}`}
              disabled={!viewer}
              onClick={() => setMeasureMode(measureMode === 'distance' ? 'off' : 'distance')}
              title="Click 2 atoms to measure distance"
            >
              <Ruler className="h-3 w-3" />
              Distance
            </Button>
            <Button
              size="sm"
              variant={measureMode === 'angle' ? 'default' : 'ghost'}
              className={`h-7 px-2 text-[10px] gap-1 ${measureMode === 'angle' ? 'bg-claude-accent text-white' : ''}`}
              disabled={!viewer}
              onClick={() => setMeasureMode(measureMode === 'angle' ? 'off' : 'angle')}
              title="Click 3 atoms to measure angle"
            >
              <Triangle className="h-3 w-3" />
              Angle
            </Button>
            <Button
              size="sm"
              variant={measureMode === 'dihedral' ? 'default' : 'ghost'}
              className={`h-7 px-2 text-[10px] gap-1 ${measureMode === 'dihedral' ? 'bg-claude-accent text-white' : ''}`}
              disabled={!viewer}
              onClick={() => setMeasureMode(measureMode === 'dihedral' ? 'off' : 'dihedral')}
              title="Click 4 atoms to measure dihedral"
            >
              <Sigma className="h-3 w-3" />
              Dihedral
            </Button>
            <Button
              size="sm"
              variant={measureMode === 'label' ? 'default' : 'ghost'}
              className={`h-7 px-2 text-[10px] gap-1 ${measureMode === 'label' ? 'bg-claude-accent text-white' : ''}`}
              disabled={!viewer}
              onClick={() => setMeasureMode(measureMode === 'label' ? 'off' : 'label')}
              title="Click 1 atom to label it"
            >
              <Tag className="h-3 w-3" />
              Label
            </Button>
            {measurements.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[10px] gap-1 text-claude-text-muted hover:text-destructive"
                onClick={handleClearMeasurements}
                title="Clear all measurements"
              >
                <X className="h-3 w-3" />
                Clear
              </Button>
            )}
          </div>
        )}

        {/* Picking status hint */}
        {measureMode !== 'off' && ready && (
          <div className="absolute top-12 left-2 z-20 flex flex-col gap-1">
            <div className="flex items-center gap-1 bg-claude-accent/10 backdrop-blur-sm rounded-md border border-claude-accent/30 px-2 py-1">
              <MousePointerClick className="h-3 w-3 text-claude-accent animate-pulse" />
              <span className="text-[10px] text-claude-accent font-medium">
                Click {measureProgress.needed} atom{measureProgress.needed > 1 ? 's' : ''} in the viewer… ({measureProgress.picked}/{measureProgress.needed})
              </span>
              <button
                onClick={() => setMeasureMode('off')}
                className="ml-1 text-claude-text-muted hover:text-destructive"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
            {pickedAtoms.length > 0 && (
              <div className="flex flex-col gap-0.5 bg-claude-surface/90 dark:bg-[#242220]/90 backdrop-blur-sm rounded-md border border-claude-border/60 dark:border-[#3d3832]/60 px-2 py-1 max-w-[260px]">
                {pickedAtoms.map((label, i) => (
                  <div key={i} className="flex items-center gap-1 text-[10px]">
                    <span className="font-mono text-claude-accent font-bold">{i + 1}.</span>
                    <span className="font-mono text-claude-text truncate">{label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Measurement list — bottom-left overlay */}
        {measurements.length > 0 && ready && (
          <div className="absolute bottom-2 left-2 z-20 bg-claude-surface/90 dark:bg-[#242220]/90 backdrop-blur-sm rounded-md border border-claude-border/60 dark:border-[#3d3832]/60 p-1.5 shadow-sm max-w-[300px]">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-semibold uppercase tracking-wide text-claude-text-muted">
                Measurements ({measurements.length})
              </span>
              <button
                onClick={handleClearMeasurements}
                className="text-claude-text-muted hover:text-destructive"
                title="Clear all"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
            <div className="space-y-0.5 max-h-32 overflow-y-auto sa-scroll">
              {measurements.map((m) => (
                <div key={m.id} className="flex items-center gap-1.5 text-[10px] group">
                  <span
                    className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor:
                        m.mode === 'distance' ? '#f59e0b' :
                        m.mode === 'angle' ? '#8b5cf6' :
                        m.mode === 'dihedral' ? '#06b6d4' :
                        '#6b7280',
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-claude-text truncate font-semibold">{m.label}</div>
                    <div className="text-[9px] text-claude-accent truncate">{m.detail}</div>
                  </div>
                  <button
                    onClick={() => removeMeasurement(m.id)}
                    className="opacity-0 group-hover:opacity-100 text-claude-text-muted hover:text-destructive transition-opacity flex-shrink-0"
                    title="Remove this measurement"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Entity Panel — right side, interactive */}
      <div className="w-[260px] shrink-0 border-l border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] overflow-y-auto sa-scroll">
        {entityLoading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-5 w-5 animate-spin text-claude-accent" />
          </div>
        ) : !hasEntityData ? (
          <div className="flex flex-col items-center justify-center gap-2 p-4">
            <Layers className="h-5 w-5 text-claude-border" />
            <span className="text-[10px] text-claude-text-muted text-center">
              No entity data available
            </span>
          </div>
        ) : (
          <div className="p-1.5 space-y-1">
            {/* Polymer Entities */}
            {entities.length > 0 && (
              <Collapsible open={true}>
                <CollapsibleTrigger asChild>
                  <button className="flex items-center gap-1.5 w-full px-2 py-1.5 hover:bg-claude-border-light/40 dark:hover:bg-[#2b2926]/40 transition-colors">
                    <ChevronDown className="w-3.5 h-3.5 text-claude-text-muted" />
                    <Dna className="w-3.5 h-3.5 text-claude-accent" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-claude-text-muted">
                      Entities
                    </span>
                    <span className="text-[10px] text-claude-text-muted ml-auto">({entities.length})</span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-1">
                    {entities.map((entity, idx) => {
                      const entityKey = `poly-${entity.entityId}`;
                      const isExpanded = expandedEntities.has(entityKey);
                      const color = ENTITY_COLORS[idx % ENTITY_COLORS.length];
                      const totalResidues = entity.sequenceLength * entity.chains.length;
                      return (
                        <div key={entityKey} className="rounded-md border border-claude-border-light/60 dark:border-[#3d3832]/40 overflow-hidden">
                          {/* Entity header */}
                          <button
                            onClick={() => toggleEntity(entityKey)}
                            className="flex items-center gap-1.5 w-full px-2 py-1 text-left hover:bg-claude-border-light/40 dark:hover:bg-[#2b2926]/40 transition-colors"
                          >
                            <ChevronDown className={`w-3.5 h-3.5 text-claude-text-muted transition-transform flex-shrink-0 ${isExpanded ? '' : '-rotate-90'}`} />
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                            <span className="text-xs text-claude-text font-medium truncate flex-1 min-w-0">
                              {entity.description || `Entity ${entity.entityId}`}
                            </span>
                            {entity.geneName && (
                              <span className="text-[10px] px-1 py-0.5 rounded bg-claude-accent-light text-claude-accent border border-claude-accent/20 font-semibold truncate max-w-[60px]" title={entity.geneName}>
                                {entity.geneName}
                              </span>
                            )}
                            {totalResidues > 0 && (
                              <span className="text-[10px] text-claude-text-muted whitespace-nowrap" title={`${totalResidues} total residues`}>
                                {totalResidues.toLocaleString()} res
                              </span>
                            )}
                          </button>
                          {/* Entity details + chains */}
                          {isExpanded && (
                            <div className="px-1.5 pb-1 space-y-0.5">
                              {/* Entity meta */}
                              <div className="text-[10px] text-claude-text-muted space-y-0.5 px-1 pb-1 border-b border-claude-border-light/40 dark:border-[#3d3832]/40 mb-1">
                                {entity.moleculeType && entity.moleculeType !== entity.entityType && (
                                  <div><span className="text-claude-text-muted">Type:</span> <span className="text-claude-text-secondary">{entity.moleculeType}</span></div>
                                )}
                                {entity.organism && (
                                  <div className="truncate"><span className="text-claude-text-muted">Organism:</span> <span className="text-claude-text-secondary">{entity.organism}</span></div>
                                )}
                                {entity.authChains.length > 0 && (
                                  <div><span className="text-claude-text-muted">Auth chains:</span> <span className="font-mono text-claude-text-secondary">{entity.authChains.join(', ')}</span></div>
                                )}
                              </div>
                              {/* Chain list */}
                              {entity.chains.map((chain) => {
                                const isHidden = chainVisibility[chain] === false;
                                const isSolo = soloChain === chain;
                                const isDimmed = soloChain !== null && !isSolo;
                                return (
                                  <div
                                    key={chain}
                                    className={`flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-claude-border-light/40 dark:hover:bg-[#2b2926]/40 transition-colors group ${isDimmed ? 'opacity-40' : ''}`}
                                  >
                                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                                    <span className="font-mono text-xs font-semibold text-claude-text flex-1">
                                      Chain {chain}
                                    </span>
                                    {entity.sequenceLength > 0 && (
                                      <span className="text-[10px] text-claude-text-muted whitespace-nowrap">
                                        {entity.sequenceLength}aa
                                      </span>
                                    )}
                                    <button
                                      onClick={() => focusChain(chain)}
                                      className="opacity-0 group-hover:opacity-100 text-claude-text-muted hover:text-claude-accent transition-opacity"
                                      title={`Focus chain ${chain}`}
                                    >
                                      <Focus className="w-3 h-3" />
                                    </button>
                                    {/* Solo button (show only this chain) */}
                                    <button
                                      onClick={() => toggleSoloChain(chain)}
                                      className={`transition-opacity ${isSolo ? 'opacity-100 text-claude-accent' : 'opacity-0 group-hover:opacity-100 text-claude-text-muted hover:text-claude-accent'}`}
                                      title={isSolo ? 'Exit solo mode' : 'Solo: show only this chain'}
                                    >
                                      <Layers className="w-3 h-3" />
                                    </button>
                                    {/* Visibility toggle (eye icon) */}
                                    <button
                                      onClick={() => toggleChainVisibility(chain)}
                                      className="text-claude-text-muted hover:text-claude-text transition-colors"
                                      title={isHidden ? 'Show chain' : 'Hide chain'}
                                    >
                                      {isHidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Ligands */}
            {ligands.length > 0 && (
              <Collapsible open={true}>
                <CollapsibleTrigger asChild>
                  <button className="flex items-center gap-1.5 w-full px-2 py-1.5 hover:bg-claude-border-light/40 dark:hover:bg-[#2b2926]/40 transition-colors">
                    <ChevronDown className="w-3.5 h-3.5 text-claude-text-muted" />
                    <Pill className="w-3.5 h-3.5 text-claude-accent" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-claude-text-muted">
                      Ligands
                    </span>
                    <span className="text-[10px] text-claude-text-muted ml-auto">({ligands.length})</span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-0.5">
                    {ligands.map((lig) => (
                      <div
                        key={`lig-${lig.entityId}`}
                        className="flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-claude-border-light/40 dark:hover:bg-[#2b2926]/40 transition-colors group"
                      >
                        <Badge
                          variant="outline"
                          className="text-[10px] font-mono font-bold px-1.5 h-5 bg-claude-accent-light text-claude-accent border-claude-accent/30"
                        >
                          {lig.compId}
                        </Badge>
                        <span className="text-xs text-claude-text truncate flex-1" title={lig.name}>
                          {lig.name}
                        </span>
                        <button
                          onClick={() => focusLigand(lig.compId)}
                          className="opacity-0 group-hover:opacity-100 text-claude-text-muted hover:text-claude-accent transition-opacity"
                          title={`Focus ligand ${lig.compId}`}
                        >
                          <Focus className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
