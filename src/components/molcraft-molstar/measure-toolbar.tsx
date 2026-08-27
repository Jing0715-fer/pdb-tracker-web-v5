'use client';

/**
 * MeasureToolbar — a unified, self-contained measurement toolbar used by
 * BOTH 3D viewers (the modal PdbViewerLite AND the full StructureAnalysisView).
 *
 * Why this exists:
 *   Previously the two viewers each had their own hand-rolled measure UI:
 *     - PdbViewerLite (modal): a top-left bar with 4 mode buttons + undo/copy/
 *       download/export/clear actions, and a separate "picking status hint"
 *       shown below it when measuring.
 *     - StructureAnalysisView (full page): a top-right panel with 4 mode
 *       buttons that WRAPPED into a 2×2 grid because of `maxWidth:220`, which
 *       made users think there were only 2 buttons. The picking progress
 *       (0/2) lived inside the same panel as a separate inline row.
 *
 *   Bug 1 (user report): "the 3D structure top-right small window showing 0/2
 *   atom picking only has 2 buttons" — caused by the 2×2 wrap. The user asked
 *   to merge that panel with the modal's top-left 4-button toolbar and use one
 *   unified style (keeping all functionality).
 *
 * This component is that unified style. It always shows all 4 mode buttons in
 * a single row (no wrapping), inlines the picking progress (0/2) next to the
 * active mode button, and surfaces undo/copy/download/export/clear actions
 * only when measurements exist. The collapsed/expandable measurements list is
 * toggled by a chevron button.
 *
 * All state is read from the shared Zustand store, so a single instance works
 * regardless of which viewer is mounted.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '@/lib/molcraft/store';
import { clearAllMeasurements } from '@/lib/molcraft/commands/measurement-utils';
import {
  setAgentLabelsVisible,
  countAgentLabels,
} from '@/lib/molcraft/commands/label-lifecycle';
import {
  Ruler, Triangle, Sigma, Tag, X, Copy, Download, Undo2, FileText,
  ChevronDown, ChevronRight, Trash2, Eye, EyeOff,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export interface MeasureToolbarProps {
  /** Structure ID used for export filenames + report titles. */
  pdbId?: string;
  /** Extra class on the root container. */
  className?: string;
}

export function MeasureToolbar({ pdbId, className = '' }: MeasureToolbarProps) {
  const viewer = useAppStore((s) => s.viewer);
  const measureMode = useAppStore((s) => s.measureMode);
  const setMeasureMode = useAppStore((s) => s.setMeasureMode);
  const measurements = useAppStore((s) => s.measurements);
  const measureProgress = useAppStore((s) => s.measureProgress);
  const pickedAtoms = useAppStore((s) => s.pickedAtoms);
  const removeMeasurement = useAppStore((s) => s.removeMeasurement);
  const clearMeasurements = useAppStore((s) => s.clearMeasurements);
  const clearInteractionLines = useAppStore((s) => s.clearInteractionLines);
  const toast = useAppStore((s) => s.toast);
  const addReport = useAppStore((s) => s.addReport);

  const [showList, setShowList] = useState(false);

  // ── R173: residue-label show/hide toggle ────────────────────────────
  // Every agent/analysis label is tagged `agent-label` at creation. The
  // toggle flips isHidden on those state cells (Molstar's own eye-icon
  // mechanism) WITHOUT deleting them, so the user can freely switch labels
  // on/off while rotating the structure ("label 要增加一个显示和隐藏的选项，
  // 可自由选择"). The count polls the state tree so the enabled state stays
  // truthful no matter how labels were added (analysis auto-capture,
  // show_analysis_labels, LLM label_residue, click-to-label).
  const agentLabelsVisible = useAppStore((s) => s.agentLabelsVisible);
  const setLabelsVisible = useAppStore((s) => s.setAgentLabelsVisible);
  const agentLabelCount = useAppStore((s) => s.agentLabelCount);
  const setAgentLabelCount = useAppStore((s) => s.setAgentLabelCount);

  useEffect(() => {
    if (!viewer?.plugin) return;
    const plugin = viewer.plugin;
    const sync = () => {
      const n = countAgentLabels(plugin);
      if (useAppStore.getState().agentLabelCount !== n) {
        setAgentLabelCount(n);
      }
    };
    sync();
    const id = window.setInterval(sync, 2000);
    return () => window.clearInterval(id);
  }, [viewer?.plugin, setAgentLabelCount]);

  const handleToggleLabels = useCallback(() => {
    const plugin = viewer?.plugin;
    if (!plugin) return;
    const next = !agentLabelsVisible;
    const affected = setAgentLabelsVisible(plugin, next);
    setLabelsVisible(next);
    toast(
      affected === 0
        ? '当前没有可切换的残基标签'
        : next
          ? `已显示 ${affected} 个残基标签`
          : `已隐藏 ${affected} 个残基标签`,
      'info',
    );
  }, [viewer, agentLabelsVisible, setLabelsVisible, toast]);

  // ── Actions ────────────────────────────────────────────────────────────
  const handleClearAll = useCallback(() => {
    clearMeasurements();
    clearInteractionLines();
    if (viewer) {
      try {
        // R170: bundle-safe clear (`measurement.clear()` does not exist on
        // the prebuilt bundle — this button used to silently do nothing).
        void clearAllMeasurements(viewer.plugin);
      } catch { /* ignore */ }
    }
    toast('Measurements cleared', 'info');
  }, [viewer, clearMeasurements, clearInteractionLines, toast]);

  const handleUndo = useCallback(() => {
    if (measurements.length === 0) return;
    const last = measurements[0]; // newest is at index 0 (addMeasurement unshifts)
    removeMeasurement(last.id);
    toast(`Removed: ${last.label}`, 'info');
  }, [measurements, removeMeasurement, toast]);

  const handleCopyCSV = useCallback(() => {
    if (measurements.length === 0) return;
    const header = 'mode,label,detail,timestamp';
    const rows = measurements.map((m) => {
      const ts = new Date(m.ts).toISOString();
      const label = `"${m.label.replace(/"/g, '""')}"`;
      const detail = `"${m.detail.replace(/"/g, '""')}"`;
      return `${m.mode},${label},${detail},${ts}`;
    });
    const csv = [header, ...rows].join('\n');
    navigator.clipboard.writeText(csv).then(
      () => toast(`Copied ${measurements.length} measurements as CSV`, 'success'),
      () => toast('Copy failed', 'error'),
    );
  }, [measurements, toast]);

  const handleDownloadJSON = useCallback(() => {
    if (measurements.length === 0) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      structure: pdbId ?? 'unknown',
      count: measurements.length,
      measurements: measurements.map((m) => ({
        id: m.id,
        mode: m.mode,
        label: m.label,
        detail: m.detail,
        atoms: m.atoms,
        timestamp: new Date(m.ts).toISOString(),
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `measurements-${pdbId ?? 'export'}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Downloaded ${measurements.length} measurements as JSON`, 'success');
  }, [measurements, pdbId, toast]);

  const handleExportToReport = useCallback(() => {
    if (measurements.length === 0) return;
    const lines: string[] = [
      `# Measurement Report — ${pdbId ?? 'Structure'}`,
      '',
      `**Generated:** ${new Date().toISOString()}`,
      `**Structure:** ${pdbId ?? 'unknown'}`,
      `**Total measurements:** ${measurements.length}`,
      '',
      `| # | Type | Label | Value | Timestamp |`,
      `|---|------|-------|-------|-----------|`,
    ];
    measurements.forEach((m, i) => {
      const ts = new Date(m.ts).toLocaleString();
      lines.push(`| ${i + 1} | ${m.mode} | ${m.label} | ${m.detail} | ${ts} |`);
    });
    lines.push('');
    const byType: Record<string, number> = {};
    measurements.forEach((m) => {
      byType[m.mode] = (byType[m.mode] || 0) + 1;
    });
    lines.push(`## Summary`);
    Object.entries(byType).forEach(([type, count]) => {
      lines.push(`- **${type}**: ${count} measurement${count > 1 ? 's' : ''}`);
    });
    addReport({
      id: `report-${Date.now()}`,
      title: `Measurements — ${pdbId ?? 'Structure'} (${new Date().toLocaleDateString()})`,
      markdown: lines.join('\n'),
      createdAt: Date.now(),
    });
    toast(`Added ${measurements.length} measurements to Reports`, 'success');
  }, [measurements, pdbId, addReport, toast]);

  // ── Render ─────────────────────────────────────────────────────────────
  const MODE_BUTTONS: Array<{
    mode: 'distance' | 'angle' | 'dihedral' | 'label';
    Icon: typeof Ruler;
    label: string;
    title: string;
    needed: number;
  }> = [
    { mode: 'distance', Icon: Ruler, label: 'Distance', title: 'Click 2 atoms to measure distance', needed: 2 },
    { mode: 'angle', Icon: Triangle, label: 'Angle', title: 'Click 3 atoms to measure angle', needed: 3 },
    { mode: 'dihedral', Icon: Sigma, label: 'Dihedral', title: 'Click 4 atoms to measure dihedral', needed: 4 },
    { mode: 'label', Icon: Tag, label: 'Label', title: 'Click 1 atom to label it', needed: 1 },
  ];

  return (
    <div
      className={`inline-flex flex-col gap-1 bg-claude-surface/95 dark:bg-[#242220]/95 backdrop-blur-md rounded-lg border border-claude-border/60 dark:border-[#3d3832]/60 p-1 shadow-md ${className}`}
      style={{ minWidth: 0 }}
      role="toolbar"
      aria-label="Measurement tools"
    >
      {/* Row 1: 4 mode buttons (always in a single row, no wrap) + picking progress + count + actions */}
      <div className="flex items-center gap-1 flex-wrap">
        {/* 4 mode buttons — flex-nowrap ensures all 4 stay on one row */}
        <div className="flex items-center gap-0.5 flex-nowrap" role="group" aria-label="Measurement modes">
          {MODE_BUTTONS.map(({ mode, Icon, label, title }) => {
            const active = measureMode === mode;
            return (
              <button
                key={mode}
                onClick={() => setMeasureMode(active ? 'off' : mode)}
                disabled={!viewer}
                title={title}
                aria-label={title}
                aria-pressed={active}
                className={`flex items-center gap-1 h-7 px-2 rounded-md text-[10px] font-medium transition-all whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${
                  active
                    ? 'bg-claude-accent text-white shadow-sm shadow-claude-accent/30'
                    : 'text-claude-text-muted hover:text-claude-text hover:bg-claude-accent-light/30'
                }`}
              >
                <Icon className="h-3 w-3 shrink-0" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        {/* R173: residue-label show/hide toggle — flips isHidden on every
            state cell tagged `agent-label` (analysis labels AND
            click-to-label). Disabled when no labels exist. */}
        <div className="h-4 w-px bg-claude-border/60 dark:bg-[#3d3832]/60 mx-0.5" aria-hidden="true" />
        <button
          onClick={handleToggleLabels}
          disabled={!viewer || agentLabelCount === 0}
          title={
            agentLabelCount === 0
              ? '暂无残基标签（运行分析或点击原子添加标签后可用）'
              : agentLabelsVisible
                ? `隐藏 ${agentLabelCount} 个残基标签`
                : `显示 ${agentLabelCount} 个残基标签`
          }
          aria-label={agentLabelsVisible ? 'Hide residue labels' : 'Show residue labels'}
          aria-pressed={agentLabelsVisible}
          className={`flex items-center gap-1 h-7 px-2 rounded-md text-[10px] font-medium transition-all whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${
            agentLabelsVisible
              ? 'bg-claude-accent-light/60 text-claude-accent border border-claude-accent/30'
              : 'text-claude-text-muted hover:text-claude-text hover:bg-claude-accent-light/30'
          }`}
        >
          {agentLabelsVisible ? <Eye className="h-3 w-3 shrink-0" /> : <EyeOff className="h-3 w-3 shrink-0" />}
          <span>Labels</span>
          {agentLabelCount > 0 && (
            <span className="font-mono text-[9px] leading-none bg-claude-accent-light/60 rounded px-1 py-0.5">
              {agentLabelCount}
            </span>
          )}
        </button>

        {/* Picking progress (inline, only when actively picking) */}
        {measureMode !== 'off' && (
          <div className="flex items-center gap-1 bg-claude-accent-light/40 rounded-md border border-claude-accent/30 px-1.5 py-0.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-claude-accent opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-claude-accent" />
            </span>
            <span className="text-[10px] text-claude-accent font-medium">Picking</span>
            <span className="font-mono font-bold text-claude-accent bg-claude-accent-light/60 rounded px-1 py-0.5 text-[9px] leading-none">
              {measureProgress.picked}/{measureProgress.needed}
            </span>
            <span className="text-[9px] text-claude-text-muted hidden sm:inline">
              {measureProgress.picked === 0
                ? `click ${measureProgress.needed} atom${measureProgress.needed > 1 ? 's' : ''}`
                : measureProgress.picked < measureProgress.needed
                ? `${measureProgress.needed - measureProgress.picked} more…`
                : 'done'}
            </span>
            <button
              onClick={() => setMeasureMode('off')}
              className="ml-0.5 text-claude-text-muted hover:text-destructive transition-colors"
              title="Cancel picking (Esc)"
              aria-label="Cancel picking"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        )}

        {/* Separator + measurement actions (only when measurements exist) */}
        {measurements.length > 0 && (
          <>
            <div className="h-4 w-px bg-claude-border/60 dark:bg-[#3d3832]/60 mx-0.5" />
            <Badge
              variant="outline"
              className="h-5 px-1.5 text-[10px] font-mono bg-claude-accent-light text-claude-accent border-claude-accent/30 cursor-pointer"
              title={`${measurements.length} measurement${measurements.length > 1 ? 's' : ''} — click to ${showList ? 'collapse' : 'expand'} list`}
              onClick={() => setShowList((v) => !v)}
            >
              {measurements.length}
            </Badge>
            <button
              onClick={() => setShowList((v) => !v)}
              className="grid h-6 w-6 place-items-center rounded-md text-claude-text-muted hover:text-claude-accent hover:bg-claude-accent-light/30 transition-colors"
              title={showList ? 'Hide measurements list' : 'Show measurements list'}
              aria-label={showList ? 'Hide measurements list' : 'Show measurements list'}
            >
              {showList ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
            <button
              onClick={handleUndo}
              className="grid h-6 w-6 place-items-center rounded-md text-claude-text-muted hover:text-claude-accent hover:bg-claude-accent-light/30 transition-colors"
              title="Undo last measurement (Ctrl+Z)"
              aria-label="Undo last measurement"
            >
              <Undo2 className="h-3 w-3" />
            </button>
            <button
              onClick={handleCopyCSV}
              className="grid h-6 w-6 place-items-center rounded-md text-claude-text-muted hover:text-claude-accent hover:bg-claude-accent-light/30 transition-colors"
              title="Copy as CSV"
              aria-label="Copy measurements as CSV"
            >
              <Copy className="h-3 w-3" />
            </button>
            <button
              onClick={handleDownloadJSON}
              className="grid h-6 w-6 place-items-center rounded-md text-claude-text-muted hover:text-claude-accent hover:bg-claude-accent-light/30 transition-colors"
              title="Download as JSON"
              aria-label="Download measurements as JSON"
            >
              <Download className="h-3 w-3" />
            </button>
            <button
              onClick={handleExportToReport}
              className="grid h-6 w-6 place-items-center rounded-md text-claude-text-muted hover:text-claude-accent hover:bg-claude-accent-light/30 transition-colors"
              title="Export to Reports (markdown)"
              aria-label="Export measurements to report"
            >
              <FileText className="h-3 w-3" />
            </button>
            <button
              onClick={handleClearAll}
              className="grid h-6 w-6 place-items-center rounded-md text-claude-text-muted hover:text-destructive hover:bg-destructive/10 transition-colors"
              title="Clear all measurements"
              aria-label="Clear all measurements"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </>
        )}
      </div>

      {/* Row 2: picked atoms list (only when actively picking and user has picked ≥1) */}
      {measureMode !== 'off' && pickedAtoms.length > 0 && (
        <div className="flex flex-col gap-0.5 bg-claude-bg/60 dark:bg-[#1a1917]/60 rounded-md border border-claude-accent/20 px-1.5 py-1 max-w-[280px]">
          {pickedAtoms.map((label, i) => (
            <div key={i} className="flex items-center gap-1 text-[10px] leading-tight">
              <span className="font-mono text-claude-accent font-bold shrink-0">{i + 1}.</span>
              <span className="font-mono text-claude-text truncate">{label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Row 3: measurements list (collapsible) */}
      {showList && measurements.length > 0 && (
        <div className="flex flex-col gap-0.5 bg-claude-bg/60 dark:bg-[#1a1917]/60 rounded-md border border-claude-border/40 dark:border-[#3d3832]/40 px-1.5 py-1 max-h-40 overflow-y-auto sa-scroll max-w-[320px]">
          {measurements.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[10px] hover:bg-claude-accent-light/40 group transition-colors"
            >
              <span className="font-mono text-claude-text-muted shrink-0 uppercase text-[9px] w-12">{m.mode}</span>
              <span className="font-mono text-claude-text truncate flex-1" title={m.label}>{m.label}</span>
              <span className="font-mono text-claude-accent font-semibold shrink-0">{m.detail}</span>
              <button
                onClick={() => { removeMeasurement(m.id); toast('Removed', 'info'); }}
                className="opacity-0 group-hover:opacity-100 text-claude-text-muted hover:text-destructive transition-opacity shrink-0"
                title="Remove this measurement"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
