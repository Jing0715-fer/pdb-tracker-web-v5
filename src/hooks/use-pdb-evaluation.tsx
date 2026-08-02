'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import type { Evaluation, EvalPdbStructure, EvalBlastResult, EvaluationReport, EvalRow, PdbEntry } from '@/lib/pdb-types';

export interface BatchSubTarget {
  uniprotId: string;
  proteinName: string;
  geneName: string;
  organism: string;
  bestScore: number;
  pdbCount: number;
  blastCount: number;
}

export interface EvalBatch {
  isBatch: true;
  batchId: string;
  title: string;
  subTargetCount: number;
  combinedReport: string;
  createdAt: string;
}

export interface ComplexGroup {
  id: string;
  name: string;
  uniprotIds: string[];
  createdAt: number;
}

export interface UsePdbEvaluationParams {
  mode: 'weekly' | 'evaluation';
  selectedEvalId: string | null;
}

export interface UsePdbEvaluationReturn {
  // Evaluation data
  evaluations: Evaluation[];
  setEvaluations: React.Dispatch<React.SetStateAction<Evaluation[]>>;
  selectedEval: Evaluation | null;
  setSelectedEval: React.Dispatch<React.SetStateAction<Evaluation | null>>;
  selectedEvalStructure: (EvalPdbStructure & { isBlast?: boolean }) | null;
  setSelectedEvalStructure: React.Dispatch<React.SetStateAction<(EvalPdbStructure & { isBlast?: boolean }) | null>>;
  evalReports: EvaluationReport[];
  setEvalReports: React.Dispatch<React.SetStateAction<EvaluationReport[]>>;
  loadingEvals: boolean;
  setLoadingEvals: React.Dispatch<React.SetStateAction<boolean>>;
  loadingEvalDetail: boolean;

  // Evaluation groups (batch)
  expandedEvalGroups: Set<string>;
  setExpandedEvalGroups: React.Dispatch<React.SetStateAction<Set<string>>>;
  evalBatches: EvalBatch[];
  setEvalBatches: React.Dispatch<React.SetStateAction<EvalBatch[]>>;
  evalBatchSubTargets: Record<string, BatchSubTarget[]>;
  setEvalBatchSubTargets: React.Dispatch<React.SetStateAction<Record<string, BatchSubTarget[]>>>;
  selectedBatchId: string | null;
  setSelectedBatchId: React.Dispatch<React.SetStateAction<string | null>>;
  batchFetchedEvals: Record<string, Evaluation>;
  setBatchFetchedEvals: React.Dispatch<React.SetStateAction<Record<string, Evaluation>>>;
  lastFetchedBatchIdRef: React.MutableRefObject<string | null>;

  // Batch note dialog
  batchNoteDialogOpen: boolean;
  setBatchNoteDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  batchNoteText: string;
  setBatchNoteText: React.Dispatch<React.SetStateAction<string>>;

  // Complex evaluation groups
  complexGroups: ComplexGroup[];
  setComplexGroups: React.Dispatch<React.SetStateAction<ComplexGroup[]>>;
  showComplexDialog: boolean;
  setShowComplexDialog: React.Dispatch<React.SetStateAction<boolean>>;
  complexName: string;
  setComplexName: React.Dispatch<React.SetStateAction<string>>;
  complexInput: string;
  setComplexInput: React.Dispatch<React.SetStateAction<string>>;
  selectedComplexId: string | null;
  setSelectedComplexId: React.Dispatch<React.SetStateAction<string | null>>;
  expandedComplexId: string | null;
  setExpandedComplexId: React.Dispatch<React.SetStateAction<string | null>>;
  complexFetchedEvals: Record<string, Evaluation>;
  setComplexFetchedEvals: React.Dispatch<React.SetStateAction<Record<string, Evaluation>>>;
  complexEvalData: {
    group: ComplexGroup;
    subEvals: Evaluation[];
    allStructures: (EvalPdbStructure & { _type: 'structure'; _sourceUniport: string })[];
    allBlasts: (EvalBlastResult & { _type: 'blast'; _sourceUniport: string })[];
    sharedStructureMap: Map<string, number>;
  } | null;

  // Complex callbacks
  addComplexGroup: () => void;
  removeComplexGroup: (id: string) => void;

  // Eval context menu
  evalContextMenu: { x: number; y: number; uniprotId: string } | null;
  setEvalContextMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; uniprotId: string } | null>>;

  // Compare mode
  compareMode: boolean;
  setCompareMode: React.Dispatch<React.SetStateAction<boolean>>;
  compareWeekId: string | null;
  setCompareWeekId: React.Dispatch<React.SetStateAction<string | null>>;
  compareEntries: PdbEntry[];
  setCompareEntries: React.Dispatch<React.SetStateAction<PdbEntry[]>>;
}

export function usePdbEvaluation({ mode, selectedEvalId }: UsePdbEvaluationParams): UsePdbEvaluationReturn {
  // ── Evaluation Mode Data ──
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [selectedEval, setSelectedEval] = useState<Evaluation | null>(null);
  const [selectedEvalStructure, setSelectedEvalStructure] = useState<(EvalPdbStructure & { isBlast?: boolean }) | null>(null);
  const [evalReports, setEvalReports] = useState<EvaluationReport[]>([]);
  const [loadingEvals, setLoadingEvals] = useState(true);
  const [loadingEvalDetail, setLoadingEvalDetail] = useState(false);

  // ── Evaluation Group (Batch) State ──
  const [expandedEvalGroups, setExpandedEvalGroups] = useState<Set<string>>(new Set());
  const [evalBatches, setEvalBatches] = useState<EvalBatch[]>([]);
  const [evalBatchSubTargets, setEvalBatchSubTargets] = useState<Record<string, BatchSubTarget[]>>({});
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [batchFetchedEvals, setBatchFetchedEvals] = useState<Record<string, Evaluation>>({});
  // Track which batchId was last used to populate batchFetchedEvals
  const lastFetchedBatchIdRef = useRef<string | null>(null);

  // ── Batch Note Dialog ──
  const [batchNoteDialogOpen, setBatchNoteDialogOpen] = useState(false);
  const [batchNoteText, setBatchNoteText] = useState('');

  // ── Compare Mode ──
  const [compareMode, setCompareMode] = useState(false);
  const [compareWeekId, setCompareWeekId] = useState<string | null>(null);
  const [compareEntries, setCompareEntries] = useState<PdbEntry[]>([]);

  // ── Complex Evaluation Mode ──
  const [complexGroups, setComplexGroups] = useState<ComplexGroup[]>([]);
  const [showComplexDialog, setShowComplexDialog] = useState(false);
  const [complexName, setComplexName] = useState('');
  const [complexInput, setComplexInput] = useState('');
  const [selectedComplexId, setSelectedComplexId] = useState<string | null>(null);
  const [expandedComplexId, setExpandedComplexId] = useState<string | null>(null);

  // ── Eval Context Menu (Right-Click) ──
  const [evalContextMenu, setEvalContextMenu] = useState<{ x: number; y: number; uniprotId: string } | null>(null);

  // ── Persist complex groups ──
  useEffect(() => {
    try { localStorage.setItem('pdb-complex-groups', JSON.stringify(complexGroups)); } catch { /* ignore */ }
  }, [complexGroups]);

  const addComplexGroup = useCallback(() => {
    const ids = complexInput.split(/[\s,;]+/).filter(id => id.trim().length > 0).map(id => id.trim().toUpperCase());
    if (ids.length < 2) { toast('At least 2 UniProt IDs required'); return; }
    const newGroup = {
      id: `complex-${Date.now()}`,
      name: complexName.trim() || ids.join(' + '),
      uniprotIds: ids,
      createdAt: Date.now(),
    };
    setComplexGroups(prev => [...prev, newGroup]);
    setComplexName('');
    setComplexInput('');
    setShowComplexDialog(false);
    toast(`Created complex group: ${newGroup.name}`, { description: `${ids.length} UniProt IDs` });
  }, [complexName, complexInput]);

  const removeComplexGroup = useCallback((id: string) => {
    setComplexGroups(prev => prev.filter(g => g.id !== id));
    if (selectedComplexId === id) setSelectedComplexId(null);
    if (expandedComplexId === id) setExpandedComplexId(null);
  }, [selectedComplexId, expandedComplexId]);

  // ── Fetch Evaluations ──
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/evaluations');
        const data = await res.json();
        setEvaluations(data.individualEvals || []);
        setEvalBatches(data.batches || []);
        setEvalBatchSubTargets(data.batchSubTargets || {});
      } catch (e) { console.error('Failed to fetch evaluations:', e); }
      finally { setLoadingEvals(false); }
    }
    load();
  }, []);

  // ── Fetch Evaluation Detail ──
  useEffect(() => {
    if (mode !== 'evaluation' || !selectedEvalId) return;
    let cancelled = false;
    async function load() {
      setLoadingEvalDetail(true);
      try {
        const res = await fetch(`/api/evaluations/${selectedEvalId}`);
        if (!cancelled) {
          const data = await res.json();
          setSelectedEval(data);
        }
      } catch (e) { console.error('Failed to fetch evaluation detail:', e); }
      finally { if (!cancelled) setLoadingEvalDetail(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [mode, selectedEvalId]);

  // ── Fetch Evaluation Reports ──
  useEffect(() => {
    if (mode !== 'evaluation') return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/evaluation-reports');
        if (!cancelled) {
          const data = await res.json();
          setEvalReports(data);
        }
      } catch (e) { console.error('Failed to fetch evaluation reports:', e); }
    }
    load();
    return () => { cancelled = true; };
  }, [mode]);

  // ── Batch evaluation data - fetch any missing evals for batch sub-targets ──
  useEffect(() => {
    if (!selectedBatchId) return;
    // Only skip if we already fetched sub-targets for THIS specific batch
    if (lastFetchedBatchIdRef.current === selectedBatchId) return;
    const subs = evalBatchSubTargets[selectedBatchId] || [];
    const missingIds = subs.map((sub: BatchSubTarget) => sub.uniprotId as string).filter(uid => !evaluations.find(e => e.uniprotId === uid) && !batchFetchedEvals[uid]);
    if (missingIds.length === 0) {
      lastFetchedBatchIdRef.current = selectedBatchId;
      return;
    }
    let cancelled = false;
    async function fetchMissing() {
      const results: Record<string, Evaluation> = {};
      for (const uid of missingIds) {
        try {
          const res = await fetch(`/api/evaluations/${uid}`);
          if (res.ok) {
            const data = await res.json();
            results[uid] = data;
          }
        } catch { /* ignore */ }
      }
      if (!cancelled && Object.keys(results).length > 0) {
        setBatchFetchedEvals(prev => ({ ...prev, ...results }));
        lastFetchedBatchIdRef.current = selectedBatchId;
      }
    }
    fetchMissing();
    return () => { cancelled = true; };
  }, [selectedBatchId, evalBatchSubTargets, evaluations, batchFetchedEvals]);

  // ── Complex evaluation data - merge data from multiple evaluations ──
  // Also fetch any missing evals (e.g. batch evaluations not in the main evaluations list)
  const [complexFetchedEvals, setComplexFetchedEvals] = useState<Record<string, Evaluation>>({});
  useEffect(() => {
    if (!selectedComplexId) return;
    const group = complexGroups.find(g => g.id === selectedComplexId);
    if (!group) return;
    const missingIds = group.uniprotIds.filter(uid => !evaluations.find(e => e.uniprotId === uid) && !complexFetchedEvals[uid]);
    if (missingIds.length === 0) return;
    let cancelled = false;
    async function fetchMissing() {
      const results: Record<string, Evaluation> = {};
      for (const uid of missingIds) {
        try {
          const res = await fetch(`/api/evaluations/${uid}`);
          if (res.ok) {
            const data = await res.json();
            results[uid] = data;
          }
        } catch { /* ignore */ }
      }
      if (!cancelled && Object.keys(results).length > 0) {
        setComplexFetchedEvals(prev => ({ ...prev, ...results }));
      }
    }
    fetchMissing();
    return () => { cancelled = true; };
  }, [selectedComplexId, complexGroups, evaluations, complexFetchedEvals]);

  const complexEvalData = useMemo(() => {
    if (!selectedComplexId) return null;
    const group = complexGroups.find(g => g.id === selectedComplexId);
    if (!group) return null;
    const subEvals = group.uniprotIds.map(uid => {
      return evaluations.find(e => e.uniprotId === uid) || complexFetchedEvals[uid];
    }).filter(Boolean) as Evaluation[];
    // Merge all PDB structures and BLAST results
    const allStructures: (EvalPdbStructure & { _type: 'structure'; _sourceUniport: string })[] = [];
    const allBlasts: (EvalBlastResult & { _type: 'blast'; _sourceUniport: string })[] = [];
    subEvals.forEach(ev => {
      (ev.pdbStructures || []).forEach(s => allStructures.push({ ...s, _type: 'structure', _sourceUniport: ev.uniprotId }));
      (ev.blastResults || []).forEach(b => allBlasts.push({ ...b, _type: 'blast', _sourceUniport: ev.uniprotId }));
    });
    // Build shared structure map: PDB ID → number of sub-targets it appears in
    const sharedStructureMap = new Map<string, number>();
    subEvals.forEach(ev => {
      const pdbIds = new Set((ev.pdbStructures || []).map(s => s.pdbId));
      pdbIds.forEach(pdbId => {
        sharedStructureMap.set(pdbId, (sharedStructureMap.get(pdbId) || 0) + 1);
      });
    });
    // Deduplicate structures: keep first occurrence of each pdbId across sub-targets
    const seenPdbIds = new Set<string>();
    const dedupedStructures: (EvalPdbStructure & { _type: 'structure'; _sourceUniport: string })[] = [];
    allStructures.forEach(s => {
      if (seenPdbIds.has(s.pdbId)) return;
      seenPdbIds.add(s.pdbId);
      (s as any)._sharedCount = sharedStructureMap.get(s.pdbId) || 0;
      dedupedStructures.push(s);
    });
    return { group, subEvals, allStructures: dedupedStructures, allBlasts, sharedStructureMap };
  }, [selectedComplexId, complexGroups, evaluations, complexFetchedEvals]);

  // ── Fetch Compare Entries ──
  useEffect(() => {
    if (!compareMode || !compareWeekId) {
      // Defer the clear to next tick so setCompareEntries is not called
      // synchronously in the effect body (avoids react-hooks/set-state-in-effect).
      const handle = setTimeout(() => setCompareEntries([]), 0);
      return () => clearTimeout(handle);
    }
    let cancelled = false;
    async function load() {
      try {
        const params = new URLSearchParams();
        params.set('week', compareWeekId ?? '');
        const res = await fetch(`/api/entries?${params}`);
        if (!cancelled) {
          const data = await res.json();
          setCompareEntries(data);
        }
      } catch (e) { console.error('Failed to fetch compare entries:', e); }
    }
    load();
    return () => { cancelled = true; };
  }, [compareMode, compareWeekId]);

  return {
    // Evaluation data
    evaluations,
    setEvaluations,
    selectedEval,
    setSelectedEval,
    selectedEvalStructure,
    setSelectedEvalStructure,
    evalReports,
    setEvalReports,
    loadingEvals,
    setLoadingEvals,
    loadingEvalDetail,

    // Evaluation groups (batch)
    expandedEvalGroups,
    setExpandedEvalGroups,
    evalBatches,
    setEvalBatches,
    evalBatchSubTargets,
    setEvalBatchSubTargets,
    selectedBatchId,
    setSelectedBatchId,
    batchFetchedEvals,
    setBatchFetchedEvals,
    lastFetchedBatchIdRef,

    // Batch note dialog
    batchNoteDialogOpen,
    setBatchNoteDialogOpen,
    batchNoteText,
    setBatchNoteText,

    // Complex evaluation groups
    complexGroups,
    setComplexGroups,
    showComplexDialog,
    setShowComplexDialog,
    complexName,
    setComplexName,
    complexInput,
    setComplexInput,
    selectedComplexId,
    setSelectedComplexId,
    expandedComplexId,
    setExpandedComplexId,
    complexFetchedEvals,
    setComplexFetchedEvals,
    complexEvalData,

    // Complex callbacks
    addComplexGroup,
    removeComplexGroup,

    // Eval context menu
    evalContextMenu,
    setEvalContextMenu,

    // Compare mode
    compareMode,
    setCompareMode,
    compareWeekId,
    setCompareWeekId,
    compareEntries,
    setCompareEntries,
  };
}
