/**
 * Label lifecycle management — tag-based visibility & placement for agent labels.
 *
 * WHY THIS MODULE EXISTS (user report: "label 好像还是会偏移，是转角度的时候
 * label 没有重新定位？另外 label 要增加一个显示和隐藏的选项，可自由选择"):
 *
 *   1. BURIED LABELS LOOK "OFFSET". Several addLabel call sites
 *      (label_residue, capture_snapshot, click-to-label) used the bundle's
 *      DEFAULT placement: attachment 'middle-center', NO tether, offsetZ 0.
 *      The text renders exactly AT the residue's bounding-sphere center and
 *      is depth-tested against the cartoon — half of the glyphs sink behind
 *      the structure. As the camera rotates, different parts of the text get
 *      occluded, which reads exactly as "the label drifts / is not
 *      repositioned when I rotate". The R170-verified floating placement
 *      (tether + offsetZ toward camera + translucent background + outer
 *      attachment) fixes this: the callout is never occluded and its tether
 *      pins it to the residue at every angle.
 *
 *   2. FLAT PARAMS WERE DROPPED. `mm.addLabel(loci, { customText })` silently
 *      loses the text — the bundle's addLabel only spreads `n?.labelParams`
 *      and `n?.visualParams`. Those call sites rendered Molstar's default
 *      loci description instead of the requested text. Every site now goes
 *      through this module's placement factory.
 *
 *   3. SHOW/HIDE TOGGLE. The bundle's addLabel DOES forward `reprTags` to the
 *      representation transform (`{ tags: n?.reprTags }`), and the state tree
 *      supports `state.updateCellState(ref, { isHidden })` — the exact
 *      mechanism behind Molstar's built-in eye-icon toggles. Tagging every
 *      agent-added label `agent-label` lets the toolbar toggle them all
 *      without deleting them, and lets a new analysis remove the previous
 *      run's labels precisely (no more count-delta heuristics for labels).
 */

import type { MolstarPlugin } from "../types";
import { getCameraPosition } from "./label-sizing";

/** Transform tag applied to every agent/analysis residue label. */
export const AGENT_LABEL_TAG = "agent-label";

/** The 8 outer attachment slots used to spread consecutive labels (R170). */
const ATTACHMENTS = [
  'top-center', 'top-right', 'middle-right', 'bottom-right',
  'bottom-center', 'bottom-left', 'middle-left', 'top-left',
] as const;

interface StateCell {
  transform?: { ref?: string; tags?: unknown };
}

/**
 * Collect state-transform refs whose transform tags include `tag`.
 * `state.cells` is a Map<ref, cell>.
 */
export function findRefsByTag(plugin: MolstarPlugin, tag: string): string[] {
  const refs: string[] = [];
  try {
    const state = plugin.state.data as unknown as {
      cells?: Map<string, StateCell> | { forEach: (cb: (cell: StateCell, ref: string) => void) => void };
    };
    const cells = state?.cells;
    if (!cells || typeof cells.forEach !== "function") return refs;
    cells.forEach((cell, ref) => {
      const tags = cell?.transform?.tags;
      if (Array.isArray(tags) && tags.includes(tag)) refs.push(ref);
    });
  } catch (err) {
    console.warn(`[label-lifecycle] findRefsByTag(${tag}) failed:`, err);
  }
  return refs;
}

/** Count agent labels currently in the state tree (hidden or visible). */
export function countAgentLabels(plugin: MolstarPlugin): number {
  return findRefsByTag(plugin, AGENT_LABEL_TAG).length;
}

/**
 * Show/hide all agent labels WITHOUT deleting them — the eye-icon mechanism
 * (`state.updateCellState(ref, { isHidden })`). Returns affected count.
 */
export function setAgentLabelsVisible(plugin: MolstarPlugin, visible: boolean): number {
  const refs = findRefsByTag(plugin, AGENT_LABEL_TAG);
  if (refs.length === 0) return 0;
  let changed = 0;
  try {
    const state = plugin.state.data as unknown as {
      updateCellState?: (ref: string, s: { isHidden: boolean }) => void;
    };
    if (typeof state.updateCellState !== "function") {
      console.warn("[label-lifecycle] state.updateCellState unavailable in this bundle");
      return 0;
    }
    for (const ref of refs) {
      try {
        state.updateCellState(ref, { isHidden: !visible });
        changed++;
      } catch (err) {
        console.warn(`[label-lifecycle] updateCellState(${ref}) failed:`, err);
      }
    }
    try {
      plugin.canvas3d?.requestDraw?.();
    } catch {
      /* ignore */
    }
  } catch (err) {
    console.warn("[label-lifecycle] setAgentLabelsVisible failed:", err);
  }
  return changed;
}

/** Remove all agent labels (tag `agent-label`) from the state tree. */
export async function removeAgentLabels(plugin: MolstarPlugin): Promise<number> {
  const refs = findRefsByTag(plugin, AGENT_LABEL_TAG);
  if (refs.length === 0) return 0;
  try {
    const data = (plugin as unknown as {
      state?: { data?: { build?: () => unknown; cells?: { has?: (ref: string) => boolean } } };
    }).state?.data;
    if (typeof data?.build !== "function") return 0;
    const builder = data.build() as {
      delete?: (ref: string) => unknown;
      commit?: () => Promise<unknown>;
    } | undefined;
    if (typeof builder?.delete !== "function" || typeof builder.commit !== "function") {
      return 0;
    }
    let removed = 0;
    for (const ref of refs) {
      try {
        if (data.cells && typeof data.cells.has === "function" && !data.cells.has(ref)) continue;
        builder.delete(ref);
        removed++;
      } catch {
        /* ref no longer valid — skip */
      }
    }
    if (removed > 0) await builder.commit();
    // R175: drop the anchor registrations for the deleted cells (and stop
    // the didDraw watcher when no labels remain).
    pruneAgentLabelAnchors(plugin);
    return removed;
  } catch (err) {
    console.warn("[label-lifecycle] removeAgentLabels failed:", err);
    return 0;
  }
}

/**
 * Build the addLabel options for an agent label with the R170-verified
 * floating placement.
 *
 * @param opts.text      label text
 * @param opts.color     24-bit text color (defaults to white)
 * @param opts.slot      attachment slot index — cycle 0..7 for consecutive
 *                       labels so they spread around their anchors instead of
 *                       stacking (ring growth like the capture pipeline)
 * @param opts.fontSize  base text size (default 0.55, matches the capture
 *                       pipeline's per-residue labels)
 * @param opts.sizeRatio R175 distance-compensation multiplier (default 1) —
 *                       scales BOTH textSize and sizeFactor so a far label
 *                       renders as large on screen as a near one.
 */
export function agentLabelOptions(opts: {
  text: string;
  color?: number;
  slot?: number;
  fontSize?: number;
  sizeRatio?: number;
}): {
  labelParams: Record<string, unknown>;
  reprTags: string[];
} {
  const slot = opts.slot ?? 0;
  const attachment = ATTACHMENTS[slot % ATTACHMENTS.length];
  const ring = Math.floor(slot / ATTACHMENTS.length);
  const tetherLength = Math.min(1.6 + ring * 1.1, 4.9); // PD max 5
  const base = opts.fontSize ?? 0.55;
  const ratio = opts.sizeRatio ?? 1;
  return {
    labelParams: {
      customText: opts.text,
      textColor: opts.color ?? 0xffffff,
      textSize: base * ratio,
      sizeFactor: base * ratio,
      // R170 floating placement: ZERO screen offsets — the billboard assembly
      // (box + tether + glyphs) anchors AT the residue and follows it at
      // every camera angle.
      offsetX: 0,
      offsetY: 0,
      offsetZ: 12, // Å toward the camera — clears the local cartoon, no occlusion
      borderWidth: 0.2,
      borderColor: 0x101010,
      // Translucent dark box keeps the text readable over any background and
      // renders the tether visibly (tether quads use backgroundColor).
      background: true,
      backgroundColor: 0x000000,
      backgroundOpacity: 0.5,
      backgroundMargin: 0.12,
      attachment,
      tether: true,
      tetherLength,
      tetherBaseWidth: 0.25,
    },
    reprTags: [AGENT_LABEL_TAG],
  };
}

// ============================================================
// R175: live distance-compensated label sizing.
//
// User report: "标签还是存在由于视觉远近看起来差异过大" — the R171
// creation-time compensation only held for the camera position at label
// creation; the PERSISTED post-analysis labels (show_analysis_labels via
// agentLabelOptions) had NO compensation at all, and any camera move after
// creation re-introduced the size spread (Molstar text is true 3D geometry
// whose screen size shrinks ~1/view-distance).
//
// Fix: register every agent label's anchor center at creation, subscribe to
// canvas3d.didDraw, and whenever the camera moves re-normalize each label's
// textSize/sizeFactor so ALL labels render the SAME screen size
// (worldSize_i = baseSize · dist_i / meanDist ⇒ screenSize ∝ 1/meanDist —
// equal for every label, scaling naturally with zoom). State updates go
// through a single build/commit per refresh (the same StateBuilder API the
// bundle's own eye-icon / addLabel machinery uses).
// ============================================================

/** The toward-camera offset labels render with (Å) — mirrors agentLabelOptions. */
const LIVE_LABEL_OFFSET_Z = 12;

interface AgentLabelAnchor {
  center: [number, number, number];
  /** Base font size (textSize == sizeFactor at ratio 1). */
  baseSize: number;
}

interface LabelResizeState {
  anchors: Map<string, AgentLabelAnchor>;
  sub?: { unsubscribe: () => void };
  /** R175: 1s camera-position poll timer (the reliability net trigger). */
  pollTimer?: ReturnType<typeof setInterval> | null;
  lastCam: [number, number, number] | null;
  lastMean: number;
  lastRun: number;
  pending: boolean;
}

const resizeStates = new WeakMap<MolstarPlugin, LabelResizeState>();

function getResizeState(plugin: MolstarPlugin): LabelResizeState {
  let s = resizeStates.get(plugin);
  if (!s) {
    s = { anchors: new Map(), lastCam: null, lastMean: 0, lastRun: 0, pending: false };
    resizeStates.set(plugin, s);
  }
  return s;
}

interface StateDataLike {
  cells?: Map<string, { transform?: { ref?: string; params?: unknown } }>;
  build?: () => {
    to: (ref: string | { ref?: string }) => {
      update: (params: unknown) => unknown;
    };
    commit: () => Promise<unknown>;
  };
}

function getStateData(plugin: MolstarPlugin): StateDataLike | null {
  const data = (plugin as unknown as { state?: { data?: StateDataLike } }).state?.data;
  return data ?? null;
}

/**
 * Register an agent label's anchor so the live resizer can compensate its
 * size. `ref` is the label representation cell's ref (the
 * StateObjectSelector.ref from addLabel's return value).
 */
export function registerAgentLabelAnchor(
  plugin: MolstarPlugin,
  ref: string,
  center: [number, number, number],
  baseSize: number,
): void {
  const st = getResizeState(plugin);
  st.anchors.set(ref, { center, baseSize });
}

/** Drop anchor registrations whose cells no longer exist; returns live count. */
export function pruneAgentLabelAnchors(plugin: MolstarPlugin): number {
  const st = getResizeState(plugin);
  const data = getStateData(plugin);
  const cells = data?.cells;
  if (cells && typeof cells.has === "function") {
    for (const ref of st.anchors.keys()) {
      if (!cells.has(ref)) st.anchors.delete(ref);
    }
  }
  if (st.anchors.size === 0) {
    stopAgentLabelResizeWatcher(plugin);
  }
  return st.anchors.size;
}

/** Stop the didDraw watcher + camera poll (no labels left / cleanup). */
export function stopAgentLabelResizeWatcher(plugin: MolstarPlugin): void {
  const st = getResizeState(plugin);
  if (st.sub) {
    try {
      st.sub.unsubscribe();
    } catch {
      /* ignore */
    }
    st.sub = undefined;
  }
  if (st.pollTimer != null) {
    clearInterval(st.pollTimer);
    st.pollTimer = null;
  }
  st.lastCam = null;
}

/**
 * Re-normalize every registered agent label's size for the CURRENT camera so
 * all of them render the same screen size. Prunes dead refs, updates live
 * cells via one build/commit, and is safe to call at any time (returns 0 when
 * there is nothing to do).
 */
export async function refreshAgentLabelSizes(plugin: MolstarPlugin): Promise<number> {
  const st = getResizeState(plugin);
  if (st.anchors.size === 0) return 0;
  const data = getStateData(plugin);
  const cells = data?.cells;
  if (!cells || typeof cells.has !== "function" || typeof data?.build !== "function") return 0;

  const cam = getCameraPosition(plugin);
  if (!cam) return 0;
  st.lastCam = cam;

  // Prune dead refs + measure effective (label-plane) distances.
  const dists: Array<{ ref: string; eff: number; anchor: AgentLabelAnchor; params: Record<string, unknown> }> = [];
  for (const [ref, anchor] of st.anchors) {
    if (!cells.has(ref)) {
      st.anchors.delete(ref);
      continue;
    }
    const cell = cells.get(ref);
    const params = cell?.transform?.params;
    if (!params || typeof params !== "object") continue;
    const dx = anchor.center[0] - cam[0];
    const dy = anchor.center[1] - cam[1];
    const dz = anchor.center[2] - cam[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const eff = Math.max(d - LIVE_LABEL_OFFSET_Z, 1);
    dists.push({ ref, eff, anchor, params: params as Record<string, unknown> });
  }
  if (dists.length === 0) {
    stopAgentLabelResizeWatcher(plugin);
    return 0;
  }

  const mean = dists.reduce((s, x) => s + x.eff, 0) / dists.length;
  st.lastMean = mean;

  const b = data.build();
  let queued = 0;
  for (const { ref, eff, anchor, params } of dists) {
    // All labels the same screen size: worldSize ∝ effective depth. Clamped
    // so a deeply buried outlier doesn't blow up into a giant box.
    const ratio = Math.min(Math.max(eff / mean, 0.6), 2.8);
    const size = Math.round(anchor.baseSize * ratio * 1000) / 1000;
    const cur = params.textSize;
    if (typeof cur === "number" && Math.abs(cur - size) < 0.03) continue; // no-op guard
    b.to(ref).update({ ...params, textSize: size, sizeFactor: size });
    queued++;
  }
  if (queued > 0) {
    try {
      await b.commit();
    } catch (err) {
      console.warn("[label-lifecycle] refreshAgentLabelSizes commit failed:", err);
      return 0;
    }
  }
  if (st.anchors.size === 0) stopAgentLabelResizeWatcher(plugin);
  return queued;
}

/** didDraw subscription throttle + camera-poll cadence + move threshold. */
const RESIZE_THROTTLE_MS = 350;
const RESIZE_POLL_MS = 1_000;
const RESIZE_MOVE_REL = 0.02; // camera moved > 2% of mean label distance

/**
 * Start the live-resize watcher (idempotent). Two complementary triggers:
 *
 *  1. canvas3d.didDraw — the fast path: re-normalizes right after a render
 *     caused by a camera move (drag, focus, animation).
 *  2. a 1s camera-position poll — the reliability net. The didDraw
 *     subscription proved fragile in browser testing (a subscriber that
 *     throws — or certain mid-render state commits — can silently dispose
 *     it, after which camera moves stop re-sizing labels entirely), and
 *     off-screen renders (viewport screenshots) don't emit didDraw at all.
 *     The poll reads one Vec3 per second and triggers the same refresh when
 *     the camera actually moved, so labels stay equal-sized regardless of
 *     which renders fire events.
 *
 * The didDraw handler is fully try/catch-wrapped so an exception can never
 * propagate into the Subject (which would dispose the subscription).
 */
export function ensureAgentLabelResizeWatcher(plugin: MolstarPlugin): void {
  const st = getResizeState(plugin);
  if (st.sub) return;

  const maybeRefresh = () => {
    let cam: [number, number, number] | null = null;
    try {
      cam = getCameraPosition(plugin);
    } catch {
      return;
    }
    if (!cam) return;
    if (st.lastCam && st.lastMean > 0) {
      const dx = cam[0] - st.lastCam[0];
      const dy = cam[1] - st.lastCam[1];
      const dz = cam[2] - st.lastCam[2];
      const moved = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (moved < Math.max(1, st.lastMean * RESIZE_MOVE_REL)) return;
    }
    st.pending = true;
    void refreshAgentLabelSizes(plugin)
      .catch(() => {})
      .finally(() => {
        st.pending = false;
      });
  };

  // Trigger 1: didDraw (fast path), fully guarded.
  try {
    const didDraw = (plugin as unknown as {
      canvas3d?: { didDraw?: { subscribe?: (fn: () => void) => { unsubscribe: () => void } } };
    }).canvas3d?.didDraw;
    if (didDraw && typeof didDraw.subscribe === "function") {
      const sub = didDraw.subscribe(() => {
        try {
          if (st.pending) return;
          const now = Date.now();
          if (now - st.lastRun < RESIZE_THROTTLE_MS) return;
          st.lastRun = now;
          maybeRefresh();
        } catch {
          /* never let an exception reach the Subject */
        }
      });
      st.sub = { unsubscribe: () => { try { sub.unsubscribe(); } catch { /* ignore */ } } };
    } else {
      console.warn("[label-lifecycle] canvas3d.didDraw unavailable — falling back to polling only");
      st.sub = { unsubscribe: () => { /* poll-only mode */ } };
    }
  } catch {
    console.warn("[label-lifecycle] didDraw subscription failed — polling only");
    st.sub = { unsubscribe: () => { /* poll-only mode */ } };
  }

  // Trigger 2: 1s camera poll (reliability net) — kept on the resize state
  // so stopAgentLabelResizeWatcher clears it with the watcher.
  if (st.pollTimer == null) {
    st.pollTimer = setInterval(() => {
      try {
        if (st.pending) return;
        maybeRefresh();
      } catch {
        /* ignore */
      }
    }, RESIZE_POLL_MS);
  }
}

/**
 * R175: one-stop addLabel for agent labels — applies the floating placement,
 * tags the transform (toolbar toggle), registers the anchor for live
 * distance-compensated resizing, and starts the didDraw watcher.
 *
 * @returns true when the label was created.
 */
export async function addAgentLabel(
  plugin: MolstarPlugin,
  loci: unknown,
  opts: {
    text: string;
    color?: number;
    slot?: number;
    fontSize?: number;
    sizeRatio?: number;
    /** anchor world position (Loci.getCenter) — enables live resizing. */
    center?: [number, number, number] | null;
  },
): Promise<boolean> {
  const mm = (plugin as unknown as {
    managers?: { structure?: { measurement?: { addLabel?: (l: unknown, o: unknown) => Promise<{ representation?: { ref?: string } }> } } };
  }).managers?.structure?.measurement;
  if (!mm || typeof mm.addLabel !== "function") return false;
  try {
    const added = await mm.addLabel(loci, agentLabelOptions(opts) as never);
    const ref = added?.representation?.ref;
    if (opts.center && typeof ref === "string") {
      registerAgentLabelAnchor(plugin, ref, opts.center, opts.fontSize ?? 0.55);
      ensureAgentLabelResizeWatcher(plugin);
    }
    return true;
  } catch (err) {
    console.warn(`[label-lifecycle] addAgentLabel("${opts.text}") failed:`, err);
    return false;
  }
}
