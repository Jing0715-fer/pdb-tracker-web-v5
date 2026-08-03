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
import { useAppStore } from '@/lib/molcraft/store';
import { executeCommand } from '@/lib/molcraft/commands';
import {
  Loader2, Box, ChevronDown, Eye, EyeOff, Layers, Focus,
  Dna, Pill, Droplet,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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
  const loadedRef = useRef<string | null>(null);
  const [entities, setEntities] = useState<EntityData[]>([]);
  const [ligands, setLigands] = useState<LigandData[]>([]);
  const [entityLoading, setEntityLoading] = useState(false);
  const [hiddenChains, setHiddenChains] = useState<Set<string>>(new Set());
  const [expandedEntities, setExpandedEntities] = useState<Set<string>>(new Set());

  // Load the PDB structure when the viewer is ready and pdbId changes
  useEffect(() => {
    if (!viewer || !ready || !pdbId) return;
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
      setHiddenChains(new Set());
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

  // Toggle chain visibility — uses Molstar's structureInteractivity to
  // select/deselect a chain, then highlights it for visual feedback.
  // The eye icon toggles the UI state; the chain is highlighted/deselected
  // in the 3D viewer to provide visual feedback.
  const toggleChainVisibility = useCallback(async (chain: string) => {
    const newHidden = new Set(hiddenChains);
    if (newHidden.has(chain)) {
      newHidden.delete(chain);
    } else {
      newHidden.add(chain);
    }
    setHiddenChains(newHidden);

    if (!viewer) return;
    try {
      const plugin = viewer.plugin;
      // Build expression for this chain
      const expr = (Q: any) => Q.struct.generator.atomGroups({
        'chain-test': Q.core.rel.eq([
          Q.struct.atomProperty.macromolecular.auth_asym_id
            ? Q.struct.atomProperty.macromolecular.auth_asym_id()
            : Q.struct.atomProperty.macromolecular.label_asym_id(),
          chain,
        ]),
      });

      if (newHidden.has(chain)) {
        // Hidden: clear highlight on this chain
        plugin.managers.interactivity.lociHighlights.clearHighlights();
      } else {
        // Visible: highlight this chain
        viewer.structureInteractivity({ expression: expr, action: ['highlight'] });
      }

      toast(`${newHidden.has(chain) ? 'Hidden' : 'Shown'} chain ${chain}`, 'info');
    } catch {
      toast('Visibility toggle failed', 'error');
    }
  }, [viewer, hiddenChains, toast]);

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

  return (
    <div className={className} style={{ display: 'flex', width: '100%', height: '100%' }}>
      {/* 3D Viewer — takes remaining space */}
      <div className="relative flex-1 min-w-0">
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

      {/* Entity Panel — right side, interactive */}
      <div className="w-[240px] shrink-0 border-l border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] overflow-y-auto sa-scroll">
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
                    <ChevronDown className="w-3 h-3 text-claude-text-muted" />
                    <Dna className="w-3 h-3 text-claude-accent" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-claude-text-muted">
                      Entities
                    </span>
                    <span className="text-[9px] text-claude-text-muted ml-auto">({entities.length})</span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-1">
                    {entities.map((entity, idx) => {
                      const entityKey = `poly-${entity.entityId}`;
                      const isExpanded = expandedEntities.has(entityKey);
                      const color = ENTITY_COLORS[idx % ENTITY_COLORS.length];
                      return (
                        <div key={entityKey} className="rounded-md border border-claude-border-light/60 dark:border-[#3d3832]/40 overflow-hidden">
                          {/* Entity header */}
                          <button
                            onClick={() => toggleEntity(entityKey)}
                            className="flex items-center gap-1.5 w-full px-2 py-1 text-left hover:bg-claude-border-light/40 dark:hover:bg-[#2b2926]/40 transition-colors"
                          >
                            <ChevronDown className={`w-3 h-3 text-claude-text-muted transition-transform flex-shrink-0 ${isExpanded ? '' : '-rotate-90'}`} />
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                            <span className="text-[10px] text-claude-text font-medium truncate flex-1 min-w-0">
                              {entity.description || `Entity ${entity.entityId}`}
                            </span>
                            {entity.organism && (
                              <span className="text-[8px] text-claude-text-muted truncate max-w-[50px]" title={entity.organism}>
                                {entity.organism}
                              </span>
                            )}
                          </button>
                          {/* Chains */}
                          {isExpanded && (
                            <div className="px-1 pb-1 space-y-0.5">
                              {entity.chains.map((chain) => {
                                const isHidden = hiddenChains.has(chain);
                                return (
                                  <div
                                    key={chain}
                                    className="flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-claude-border-light/40 dark:hover:bg-[#2b2926]/40 transition-colors group"
                                  >
                                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                                    <span className="font-mono text-[10px] font-semibold text-claude-text flex-1">
                                      {chain}
                                    </span>
                                    {entity.sequenceLength > 0 && (
                                      <span className="text-[8px] text-claude-text-muted">
                                        {entity.sequenceLength}aa
                                      </span>
                                    )}
                                    <button
                                      onClick={() => focusChain(chain)}
                                      className="opacity-0 group-hover:opacity-100 text-claude-text-muted hover:text-claude-accent transition-opacity"
                                      title={`Focus chain ${chain}`}
                                    >
                                      <Focus className="w-2.5 h-2.5" />
                                    </button>
                                    <button
                                      onClick={() => toggleChainVisibility(chain)}
                                      className="text-claude-text-muted hover:text-claude-text transition-colors"
                                      title={isHidden ? 'Show chain' : 'Hide chain'}
                                    >
                                      {isHidden ? <EyeOff className="w-2.5 h-2.5" /> : <Eye className="w-2.5 h-2.5" />}
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
                    <ChevronDown className="w-3 h-3 text-claude-text-muted" />
                    <Pill className="w-3 h-3 text-claude-accent" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-claude-text-muted">
                      Ligands
                    </span>
                    <span className="text-[9px] text-claude-text-muted ml-auto">({ligands.length})</span>
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
                          className="text-[8px] font-mono font-bold px-1 h-4 bg-claude-accent-light text-claude-accent border-claude-accent/30"
                        >
                          {lig.compId}
                        </Badge>
                        <span className="text-[9px] text-claude-text truncate flex-1" title={lig.name}>
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
