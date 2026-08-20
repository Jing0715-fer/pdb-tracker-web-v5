/**
 * ToolCallCard — renders a tool/call + tool/result pair as a compact card.
 *
 * Shows the tool name, a friendly title, the parsed arguments, and (once the
 * result arrives) the result summary or error. Uses the tool's presentCall
 * card kind to pick an icon + accent color.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Check, X, Wrench, Box, Ruler, Camera, FlaskConical, AlertCircle, RotateCcw, Copy, Timer, ZoomIn, X as XClose, ChevronLeft, ChevronRight, Crosshair } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/molcraft/store';
import type { ConversationNode } from './use-agent-session';

const CARD_META: Record<
  string,
  { icon: typeof Box; accent: string; bg: string; border: string; label: string }
> = {
  pdb: { icon: Box, accent: 'text-emerald-600', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', label: 'STRUCTURE' },
  measure: { icon: Ruler, accent: 'text-sky-600', bg: 'bg-sky-500/10', border: 'border-sky-500/30', label: 'MEASURE' },
  screenshot: { icon: Camera, accent: 'text-purple-600', bg: 'bg-purple-500/10', border: 'border-purple-500/30', label: 'CAPTURE' },
  analysis: { icon: FlaskConical, accent: 'text-amber-600', bg: 'bg-amber-500/10', border: 'border-amber-500/30', label: 'ANALYSIS' },
  generic: { icon: Wrench, accent: 'text-claude-accent', bg: 'bg-claude-accent/10', border: 'border-claude-border', label: 'TOOL' },
};

/** Infer the card category from a tool name. */
function inferCategory(toolName: string): string {
  const name = toolName.toLowerCase();
  if (name.startsWith('pdb_load') || name.startsWith('load_') || name.includes('representation') || name.includes('color') || name.includes('camera') || name.includes('focus') || name.includes('background') || name.includes('spin') || name.includes('rock') || name.includes('visibility') || name.includes('select') || name.includes('label') || name.includes('clear')) {
    return 'pdb';
  }
  if (name.includes('measure') || name.includes('distance') || name.includes('angle') || name.includes('dihedral')) {
    return 'measure';
  }
  if (name.includes('capture') || name.includes('screenshot') || name.includes('snapshot') || name.includes('export') || name.includes('recapture')) {
    return 'screenshot';
  }
  if (name.includes('analyze') || name.includes('fetch') || name.includes('interface') || name.includes('interactions') || name.includes('align') || name.includes('pocket') || name.includes('screening') || name.includes('electrostatic') || name.includes('detect')) {
    return 'analysis';
  }
  return 'generic';
}

export function ToolCallCard({ node }: { node: Extract<ConversationNode, { kind: 'tool-call' }> }) {
  const category = inferCategory(node.name);
  const meta = CARD_META[category] ?? CARD_META['generic']!;
  const Icon = meta.icon;
  const status = node.status;
  const [copied, setCopied] = useState(false);

  const handleCopyResult = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!node.result) return;
    try {
      const text = typeof node.result === 'string' ? node.result : JSON.stringify(node.result, null, 2);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="flex justify-start animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-start gap-2 max-w-[92%]">
        <div
          className={cn(
            'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border',
            meta.bg,
            meta.border,
          )}
        >
          <Icon className={cn('h-3.5 w-3.5', meta.accent)} />
        </div>
        <div className={cn('rounded-2xl rounded-tl-sm border bg-claude-bg-surface overflow-hidden min-w-0 flex-1', meta.border)}>
          {/* Header */}
          <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-claude-bg-elevated/50 border-b border-claude-border">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className={cn('text-[9px] font-bold px-1 py-0.5 rounded', meta.bg, meta.accent)}>
                {meta.label}
              </span>
              <code className={cn('text-xs font-semibold truncate', meta.accent)}>
                {node.name}
              </code>
              <span className="text-[10px] text-claude-text-muted truncate">·</span>
              <span className="text-[10px] text-claude-text-muted truncate">
                {describeArgs(node.name, node.args)}
              </span>
            </div>
            <StatusPill status={status} startedAt={node.startedAt} durationMs={node.durationMs} />
          </div>

          {/* Arguments (collapsible if verbose) */}
          {Object.keys(node.args).length > 0 && (
            <details className="group px-3 py-1.5">
              <summary className="cursor-pointer select-none text-[10px] text-claude-text-muted hover:text-claude-text flex items-center gap-1">
                <span className="inline-block transition-transform group-open:rotate-90">▸</span>
                arguments
              </summary>
              <pre className="mt-1 text-[10px] text-claude-text-muted overflow-x-auto rounded bg-claude-bg-base p-2 font-mono leading-relaxed">
                {JSON.stringify(node.args, null, 2)}
              </pre>
            </details>
          )}

          {/* Result */}
          {status === 'ok' && node.result != null && (
            <div className="group/result px-3 py-2 border-t border-claude-border relative">
              <ResultView name={node.name} result={node.result} />
              <button
                onClick={handleCopyResult}
                className="absolute top-1.5 right-1.5 opacity-0 group-hover/result:opacity-100 transition-opacity flex items-center justify-center h-5 w-5 rounded bg-claude-bg-surface border border-claude-border shadow-sm hover:border-claude-accent/50 hover:text-claude-accent text-claude-text-muted"
                title="复制结果"
              >
                {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
              </button>
            </div>
          )}
          {status === 'error' && (
            <div className="px-3 py-2 border-t border-claude-border bg-red-500/5">
              <div className="flex items-start gap-1.5 text-xs text-red-700 dark:text-red-300">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span className="break-words flex-1">{node.error ?? 'execution failed'}</span>
                {/* R113.6: Retry button for failed tool calls */}
                <button
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('agent-retry-tool', {
                      detail: { callId: node.callId, name: node.name, args: node.args },
                    }));
                  }}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium text-red-600 hover:bg-red-500/10 transition-colors shrink-0"
                  title="Retry this tool call"
                >
                  <RotateCcw className="h-3 w-3" />
                  重试
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status, startedAt, durationMs }: { status: string; startedAt?: number; durationMs?: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (status !== 'running' && status !== 'pending') return;
    if (!startedAt) return;
    // Use a flag to avoid setState on first render (react-hooks rule)
    let mounted = true;
    const update = () => { if (mounted) setElapsed(Date.now() - (startedAt ?? Date.now())); };
    update();
    const i = setInterval(update, 100);
    return () => { mounted = false; clearInterval(i); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, startedAt]);
  if (status === 'running' || status === 'pending') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-claude-accent shrink-0 font-mono">
        <Loader2 className="h-3 w-3 animate-spin" />
        {status}
        {startedAt && status === 'running' && <span className="tabular-nums">{formatElapsed(elapsed)}</span>}
        {durationMs != null && (status === 'ok' || status === 'error') && (
          <span className="flex items-center gap-0.5 tabular-nums opacity-60">
            <Timer className="h-2.5 w-2.5" />
            {durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`}
          </span>
        )}
      </span>
    );
  }
  if (status === 'ok') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-emerald-600 shrink-0">
        <Check className="h-3 w-3" />
        ok
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[10px] text-red-600 shrink-0">
      <X className="h-3 w-3" />
      error
    </span>
  );
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

function ResultView({ name, result }: { name: string; result: unknown }) {
  // Check for screenshot data (capture_snapshot or capture_multi_angle)
  const screenshots = extractScreenshots(name, result);
  if (screenshots.length > 0) {
    return <ScreenshotResult name={name} screenshots={screenshots} result={result} />;
  }
  // R115.2: Show auto-capture pending/error for pdb_analyze results
  const r = result as any;
  if (name === 'pdb_analyze' && r) {
    if (r.autoCapturePending && !r.autoCapture) {
      return (
        <div className="text-xs">
          <div className="flex items-center gap-1.5 text-[10px] text-claude-text-muted">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>正在自动截图 + VLM 分析...</span>
          </div>
          <ResultText name={name} result={result} />
        </div>
      );
    }
    if (r.autoCaptureError) {
      return (
        <div className="text-xs">
          <div className="flex items-center gap-1.5 text-[10px] text-amber-600 mb-1">
            <AlertCircle className="h-3 w-3" />
            <span>截图失败: {r.autoCaptureError}</span>
          </div>
          <ResultText name={name} result={result} />
        </div>
      );
    }
    // If auto-capture completed, show the screenshots
    if (r.autoCapture) {
      const autoScreenshots = extractScreenshots('capture_multi_angle', r.autoCapture);
      if (autoScreenshots.length > 0) {
        const captureMs = r.autoCapture.captureDurationMs;
        const vlmMs = r.autoCapture.vlmDurationMs;
        const vlmIterations = r.autoCapture.vlmIterations;
        const vlmAcceptable = r.autoCapture.vlmAcceptable;
        return (
          <div className="text-xs">
            {/* R116.2: Show timing for auto-capture + VLM */}
            {/* R142: Show VLM iteration count + acceptable status */}
            {(captureMs != null || vlmMs != null || vlmIterations != null) && (
              <div className="flex items-center gap-2 text-[9px] text-claude-text-muted mb-1 flex-wrap">
                {captureMs != null && (
                  <span className="flex items-center gap-0.5">
                    <Timer className="h-2.5 w-2.5" />
                    截图 {captureMs < 1000 ? `${captureMs}ms` : `${(captureMs / 1000).toFixed(1)}s`}
                  </span>
                )}
                {vlmMs != null && (
                  <span className="flex items-center gap-0.5">
                    <Timer className="h-2.5 w-2.5" />
                    VLM {vlmMs < 1000 ? `${vlmMs}ms` : `${(vlmMs / 1000).toFixed(1)}s`}
                    {vlmMs < 1000 && <span className="text-emerald-500">(缓存)</span>}
                  </span>
                )}
                {vlmIterations != null && vlmIterations > 1 && (
                  <span className="flex items-center gap-0.5 text-claude-accent">
                    <RotateCcw className="h-2.5 w-2.5" />
                    {vlmIterations}轮迭代
                  </span>
                )}
                {vlmAcceptable != null && (
                  <span className={`px-1 py-0.5 rounded-full text-[8px] ${vlmAcceptable ? 'bg-emerald-500/20 text-emerald-600' : 'bg-amber-500/20 text-amber-600'}`}>
                    {vlmAcceptable ? '✓ 质量 acceptable' : '⚠ 需改进'}
                  </span>
                )}
              </div>
            )}
            <ScreenshotResult name="capture_multi_angle" screenshots={autoScreenshots} result={r.autoCapture} />
            <ResultText name={name} result={result} />
          </div>
        );
      }
    }
  }
  const text =
    typeof result === 'string'
      ? result
      : JSON.stringify(result, null, 2);
  // Keep it readable — cap at ~1500 chars with a "show more".
  const truncated = text.length > 1500;
  return (
    <div className="text-xs">
      <div className="text-[10px] uppercase tracking-wide text-claude-text-muted mb-1">
        result · {name}
      </div>
      <pre className="whitespace-pre-wrap break-words text-claude-text-muted font-mono leading-relaxed text-[10px] max-h-48 overflow-y-auto">
        {truncated ? text.slice(0, 1500) + '\n…(truncated)' : text}
      </pre>
    </div>
  );
}

/** Extract screenshot data URIs from tool results. */
function extractScreenshots(name: string, result: unknown): Array<{ dataUri: string; angle?: string; label?: string; cameraState?: { position: [number, number, number]; target: [number, number, number]; up: [number, number, number] } }> {
  if (!result || typeof result !== 'object') return [];
  const r = result as Record<string, unknown>;
  // capture_snapshot: { ok: true, data: { dataUri, label, angle } }
  if (name === 'capture_snapshot' && r.data) {
    const data = r.data as Record<string, unknown>;
    if (data.dataUri) {
      return [{
        dataUri: String(data.dataUri),
        angle: String(data.angle || ''),
        label: String(data.label || ''),
        cameraState: data.cameraState as { position: [number, number, number]; target: [number, number, number]; up: [number, number, number] } | undefined,
      }];
    }
  }
  // capture_multi_angle: { ok: true, data: { screenshots: [{ dataUri, angle, label, cameraState }] } }
  if (name === 'capture_multi_angle' && r.data) {
    const data = r.data as Record<string, unknown>;
    if (Array.isArray(data.screenshots)) {
      return (data.screenshots as Array<Record<string, unknown>>).map((s) => ({
        dataUri: String(s.dataUri || ''),
        angle: String(s.angle || ''),
        label: String(s.label || ''),
        cameraState: s.cameraState as { position: [number, number, number]; target: [number, number, number]; up: [number, number, number] } | undefined,
      })).filter((s) => s.dataUri);
    }
  }
  return [];
}

/** Render screenshot images in the tool card. */
// R113.4: Carousel with VLM commentary, quality badges, best highlight
function ScreenshotResult({ name, screenshots, result }: {
  name: string;
  screenshots: Array<{ dataUri: string; angle?: string; label?: string; cameraState?: { position: [number, number, number]; target: [number, number, number]; up: [number, number, number] } }>;
  result: unknown;
}) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [showRaw, setShowRaw] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [restoringView, setRestoringView] = useState(false);

  // R113.3: Extract VLM result from the tool result
  // R140: Also check vlmPending for explicit capture_multi_angle calls
  const vlmResult = (result as any)?.vlmResult || (result as any)?.autoCapture?.vlmResult;
  const vlmPending = (result as any)?.vlmPending || (result as any)?.autoCapture?.vlmPending;
  const vlmError = (result as any)?.vlmError || (result as any)?.autoCapture?.vlmError;
  const quality = vlmResult?.quality as string | undefined;
  const issues = vlmResult?.issues as string[] | undefined;
  const comments = vlmResult?.comments as string[] | undefined;
  const scores = vlmResult?.scores as number[] | undefined;
  const bestIndex = vlmResult?.bestIndex as number | undefined;

  const current = screenshots[currentIdx];
  if (!current) return null;

  const qualityColor = quality === 'acceptable' ? 'bg-emerald-500/80'
    : quality === 'degraded' ? 'bg-amber-500/80'
    : quality === 'unacceptable' ? 'bg-red-500/80'
    : 'bg-slate-500/80';
  const qualityLabel = quality === 'acceptable' ? '✓ 良好'
    : quality === 'degraded' ? '⚠ 一般'
    : quality === 'unacceptable' ? '✗ 不合格'
    : null;

  return (
    <div className="text-xs">
      {/* Header */}
      <div className="text-[10px] uppercase tracking-wide text-claude-text-muted mb-1.5 flex items-center justify-between">
        <span>result · {name}</span>
        <div className="flex items-center gap-1.5">
          {qualityLabel && (
            <span className={`px-1.5 py-0.5 rounded-full text-[9px] text-white ${qualityColor}`}>
              {qualityLabel}
            </span>
          )}
          <span className="text-[9px] normal-case">{screenshots.length} 截图</span>
        </div>
      </div>

      {/* Main carousel image */}
      <div className="relative rounded-lg border border-claude-border overflow-hidden bg-black group">
        <img
          src={current.dataUri}
          alt={current.label || current.angle || `screenshot ${currentIdx + 1}`}
          className="w-full h-auto block max-h-64 object-contain cursor-zoom-in"
          onClick={() => setZoomed(true)}
        />

        {/* R140: Zoom hint overlay (appears on hover) */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-black/70 text-white text-[9px]">
            <ZoomIn className="h-3 w-3" />
            <span>点击放大</span>
          </div>
        </div>

        {/* Best image badge */}
        {bestIndex === currentIdx && (
          <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-claude-accent/90 text-white">
            ★ 最佳
          </div>
        )}

        {/* Score badge */}
        {scores && currentIdx < scores.length && (
          <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-mono bg-black/70 text-white">
            {scores[currentIdx]}/10
          </div>
        )}

        {/* Angle/label overlay */}
        {(current.angle || current.label) && (
          <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[9px] px-2 py-0.5 flex items-center justify-between">
            <span className="truncate">{current.angle || current.label}</span>
            <span className="text-[8px] opacity-60">{currentIdx + 1}/{screenshots.length}</span>
          </div>
        )}

        {/* Navigation arrows */}
        {screenshots.length > 1 && (
          <>
            <button
              onClick={() => setCurrentIdx((currentIdx - 1 + screenshots.length) % screenshots.length)}
              className="absolute left-1 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 text-xs"
            >
              ‹
            </button>
            <button
              onClick={() => setCurrentIdx((currentIdx + 1) % screenshots.length)}
              className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 text-xs"
            >
              ›
            </button>
          </>
        )}
      </div>

      {/* R140: Fullscreen zoom modal */}
      {zoomed && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setZoomed(false)}
        >
          {/* Close button */}
          <button
            onClick={() => setZoomed(false)}
            className="absolute top-4 right-4 h-10 w-10 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition-colors"
          >
            <XClose className="h-5 w-5" />
          </button>

          {/* Navigation arrows in fullscreen */}
          {screenshots.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setCurrentIdx((currentIdx - 1 + screenshots.length) % screenshots.length); }}
                className="absolute left-4 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition-colors"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setCurrentIdx((currentIdx + 1) % screenshots.length); }}
                className="absolute right-4 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition-colors"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}

          {/* Full-size image */}
          <img
            src={current.dataUri}
            alt={current.label || current.angle || `screenshot ${currentIdx + 1}`}
            className="max-w-[95vw] max-h-[90vh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />

          {/* Info bar */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-white/10 text-white text-xs flex items-center gap-3">
            <span>{current.angle || current.label || `screenshot ${currentIdx + 1}`}</span>
            <span className="opacity-60">·</span>
            <span>{currentIdx + 1} / {screenshots.length}</span>
            {bestIndex === currentIdx && (
              <>
                <span className="opacity-60">·</span>
                <span className="text-yellow-300">★ 最佳</span>
              </>
            )}
            {scores && currentIdx < scores.length && (
              <>
                <span className="opacity-60">·</span>
                <span className="font-mono">{scores[currentIdx]}/10</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* R140: VLM pending state for explicit capture_multi_angle */}
      {vlmPending && !vlmResult && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-claude-text-muted">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>VLM 分析中...</span>
        </div>
      )}
      {/* R140: VLM error state */}
      {vlmError && !vlmResult && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-amber-600">
          <AlertCircle className="h-3 w-3" />
          <span>VLM 失败: {vlmError}</span>
        </div>
      )}

      {/* VLM commentary */}
      {comments && currentIdx < comments.length && comments[currentIdx] && (
        <div className="mt-1.5 px-2 py-1 rounded bg-claude-accent/5 border border-claude-accent/20 text-[10px] text-claude-text">
          <span className="font-medium text-claude-accent">VLM: </span>
          {comments[currentIdx]}
        </div>
      )}

      {/* Issues (if quality is not acceptable) */}
      {quality && quality !== 'acceptable' && issues && currentIdx < issues.length && issues[currentIdx] && (
        <div className="mt-1 px-2 py-1 rounded bg-amber-500/5 border border-amber-500/20 text-[10px] text-amber-700 dark:text-amber-400">
          <span className="font-medium">问题: </span>
          {issues[currentIdx]}
        </div>
      )}

      {/* R144: Restore camera view button — restores the view that was active
          when this screenshot was captured, so the user can explore that angle
          interactively in the 3D viewer. */}
      {current?.cameraState && (
        <button
          onClick={async () => {
            const viewer = useAppStore.getState().viewer;
            if (!viewer?.plugin || !current.cameraState) return;
            setRestoringView(true);
            try {
              const { restoreCameraViewState } = await import('@/lib/molcraft/commands/camera');
              restoreCameraViewState(viewer.plugin, current.cameraState);
              console.log(`[R144] Restored camera view for angle "${current.angle}"`);
            } catch (err) {
              console.warn('[R144] Failed to restore camera view:', err);
            } finally {
              setTimeout(() => setRestoringView(false), 500);
            }
          }}
          disabled={restoringView}
          className="mt-1.5 flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-claude-accent/10 border border-claude-accent/30 text-claude-accent hover:bg-claude-accent/20 transition-colors disabled:opacity-50"
          title="恢复此截图对应的相机视角到3D查看器"
        >
          {restoringView ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Crosshair className="h-3 w-3" />
          )}
          恢复视角
        </button>
      )}

      {/* Thumbnail strip */}
      {screenshots.length > 1 && (
        <div className="mt-1.5 flex gap-1 overflow-x-auto">
          {screenshots.map((s, i) => (
            <button
              key={i}
              onClick={() => setCurrentIdx(i)}
              className={`relative shrink-0 h-10 w-14 rounded border overflow-hidden transition-all ${
                i === currentIdx ? 'border-claude-accent ring-1 ring-claude-accent' : 'border-claude-border opacity-60 hover:opacity-100'
              }`}
            >
              <img src={s.dataUri} alt="" className="w-full h-full object-cover" />
              {bestIndex === i && (
                <div className="absolute top-0 right-0 h-2 w-2 bg-claude-accent rounded-full" />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Collapsible raw result */}
      <button
        onClick={() => setShowRaw(!showRaw)}
        className="mt-1.5 text-[10px] text-claude-text-muted hover:text-claude-text"
      >
        {showRaw ? '▼' : '▶'} 查看原始数据
      </button>
      {showRaw && (
        <pre className="mt-1 whitespace-pre-wrap break-words text-claude-text-muted font-mono leading-relaxed text-[10px] max-h-32 overflow-y-auto">
          {JSON.stringify(result, null, 2).slice(0, 500)}{'\n…(truncated)'}
        </pre>
      )}
    </div>
  );
}

// R115.2: Helper to show text result for pdb_analyze
function ResultText({ name, result }: { name: string; result: unknown }) {
  const r = result as any;
  const text = typeof result === 'string' ? result : r?.detail || JSON.stringify(result, null, 2).slice(0, 300);
  return (
    <details className="mt-1.5">
      <summary className="cursor-pointer text-[10px] text-claude-text-muted hover:text-claude-text select-none">
        查看分析结果
      </summary>
      <pre className="mt-1 whitespace-pre-wrap break-words text-claude-text-muted font-mono leading-relaxed text-[10px] max-h-32 overflow-y-auto">
        {text}
      </pre>
    </details>
  );
}

function describeArgs(name: string, args: Record<string, unknown>): string {
  const keys = Object.keys(args);
  if (keys.length === 0) return '';
  // Pick the most informative argument.
  const id = args.id ?? args.pdbId ?? args.uniprotId ?? args.emdbId;
  if (id) return String(id);
  const recipe = args.recipe;
  if (recipe) {
    const chain = args.chain1 ?? args.chain;
    return chain ? `${recipe} (${chain})` : String(recipe);
  }
  const preset = args.preset ?? args.theme;
  if (preset) return String(preset);
  const compId = args.compId ?? args.ligandCompId;
  if (compId) return String(compId);
  return keys.slice(0, 3).join(', ');
}
