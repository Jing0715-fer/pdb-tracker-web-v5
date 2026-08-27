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
 */
export function agentLabelOptions(opts: {
  text: string;
  color?: number;
  slot?: number;
  fontSize?: number;
}): {
  labelParams: Record<string, unknown>;
  reprTags: string[];
} {
  const slot = opts.slot ?? 0;
  const attachment = ATTACHMENTS[slot % ATTACHMENTS.length];
  const ring = Math.floor(slot / ATTACHMENTS.length);
  const tetherLength = Math.min(1.6 + ring * 1.1, 4.9); // PD max 5
  return {
    labelParams: {
      customText: opts.text,
      textColor: opts.color ?? 0xffffff,
      textSize: opts.fontSize ?? 0.55,
      sizeFactor: 0.55,
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
