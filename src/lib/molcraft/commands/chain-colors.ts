/**
 * Chain color mapping — resolves the EXACT color Molstar's built-in
 * `chain-id` color theme assigns to each chain, so 3D labels can be tinted
 * with the SAME color as the chain they annotate ("label的颜色和链的颜色
 * 不一致" fix).
 *
 * PRIMARY path: run the actual theme factory from the plugin's color theme
 * registry (`plugin.representation.structure.themes.colorThemeRegistry`) on
 * the loaded structure and query `theme.color(location)` at the first atom of
 * every chain. This is the same factory `updateRepresentationsTheme` uses, so
 * the result is correct by construction — including serial offsets from
 * empty-auth asym ids (e.g. water asym entries that consume serial 0) and any
 * future palette changes.
 *
 * FALLBACK path (registry not reachable on the prebuilt bundle): replicate the
 * theme's serial assignment (mol-theme/color/chain-id.js, molstar 5.11.0):
 * iterate `model.properties.structAsymMap` in order, key by AUTH asym id
 * (NOT skipping empty ones — they consume a serial exactly like the theme
 * does), then color = 'many-distinct'[serial % 25].
 */

import type { MolstarPlugin } from "../types";
import { getFirstStructureData } from "./structure-helpers";
import { collectChainIds } from "./recipe-viz";

/** Molstar's default chain-id palette ('many-distinct', mol-util/color/lists.js). */
export const MANY_DISTINCT_CHAIN_COLORS: readonly number[] = [
  // dark-2
  0x1b9e77, 0xd95f02, 0x7570b3, 0xe7298a, 0x66a61e, 0xe6ab02, 0xa6761d, 0x666666,
  // set-1
  0xe41a1c, 0x377eb8, 0x4daf4a, 0x984ea3, 0xff7f00, 0xffff33, 0xa65628, 0xf781bf, 0x999999,
  // set-2
  0x66c2a5, 0xfc8d62, 0x8da0cb, 0xe78ac3, 0xa6d854, 0xffd92f, 0xe5c494, 0xb3b3b3,
];

/** Color used when the chain cannot be resolved (must stay readable on black). */
export const FALLBACK_CHAIN_COLOR = 0xffffff;

/**
 * PRIMARY: query the real chain-id theme factory for each chain's color.
 * Returns an empty map when any required piece is unavailable.
 */
function getChainColorMapFromThemeFactory(plugin: MolstarPlugin): Map<string, number> {
  const map = new Map<string, number>();
  try {
    const data = getFirstStructureData(plugin) as any;
    if (!data) return map;
    const themes = (plugin as any)?.representation?.structure?.themes;
    const provider = themes?.colorThemeRegistry?.get?.("chain-id");
    if (!provider || typeof provider.factory !== "function") return map;

    // defaultValues = PD.getDefaultValues(ChainIdColorThemeParams) — exactly
    // what updateRepresentationsTheme computes for a name-only theme update.
    const theme = provider.factory({ structure: data }, provider.defaultValues);
    if (!theme || typeof theme.color !== "function") return map;

    const SE = (window as any).molstar?.lib?.structure?.StructureElement;
    const SP = (window as any).molstar?.lib?.structure?.StructureProperties;
    if (!SE || !SP) return map;

    for (const unit of data.units) {
      if (unit.kind !== 0) continue; // atomic only
      if (!unit.elements || unit.elements.length === 0) continue;
      const loc = SE.Location.create(data, unit, unit.elements[0]);
      const chainId: string = SP.chain.auth_asym_id(loc) || SP.chain.label_asym_id(loc);
      if (!chainId || map.has(chainId)) continue;
      const color = theme.color(loc);
      if (typeof color === "number") map.set(chainId, color);
    }
  } catch (err) {
    console.warn("[chain-colors] theme factory query failed:", err);
    return new Map<string, number>();
  }
  return map;
}

/**
 * FALLBACK: replicate the chain-id theme's serial assignment from
 * structAsymMap + the 'many-distinct' palette. Empty auth ids consume a
 * serial (the theme assigns them one) but get no label-color entry.
 */
function getChainColorMapFromReplication(plugin: MolstarPlugin): Map<string, number> {
  const colorMap = new Map<string, number>();
  try {
    const data = getFirstStructureData(plugin) as
      | { models?: Array<{ properties?: { structAsymMap?: unknown } }> }
      | null;
    const models = data?.models;
    if (Array.isArray(models) && models.length > 0) {
      const seen = new Set<string>();
      let serial = 0;
      for (const m of models) {
        const asymMap = m?.properties?.structAsymMap as
          | Map<string, { auth_id?: string }>
          | undefined
          | null;
        if (!asymMap || typeof asymMap.forEach !== "function") continue;
        asymMap.forEach((value, labelId) => {
          // The theme's 'auth' mode keys the serial map by the AUTH asym id.
          const authId =
            typeof value?.auth_id === "string" && value.auth_id !== ""
              ? value.auth_id
              : labelId;
          if (typeof authId !== "string" || authId === "") return;
          if (seen.has(authId)) return;
          seen.add(authId);
          colorMap.set(authId, MANY_DISTINCT_CHAIN_COLORS[serial % MANY_DISTINCT_CHAIN_COLORS.length]);
          serial++;
        });
      }
    }
  } catch (err) {
    console.warn("[chain-colors] structAsymMap walk failed:", err);
  }

  // Last resort: derive from first-seen unit traversal order (file order).
  if (colorMap.size === 0) {
    try {
      const chains = collectChainIds(plugin);
      chains.forEach((c, i) =>
        colorMap.set(c, MANY_DISTINCT_CHAIN_COLORS[i % MANY_DISTINCT_CHAIN_COLORS.length])
      );
    } catch (err) {
      console.warn("[chain-colors] collectChainIds fallback failed:", err);
    }
  }
  return colorMap;
}

/**
 * auth-chain-id → color matching the chain-id theme for the loaded structure.
 * Tries the real theme factory first; falls back to the replication.
 */
export function getChainColorMap(plugin: MolstarPlugin): Map<string, number> {
  const fromFactory = getChainColorMapFromThemeFactory(plugin);
  if (fromFactory.size > 0) return fromFactory;
  return getChainColorMapFromReplication(plugin);
}

/** Convenience: the theme-matching color for one chain (fallback: white). */
export function getChainLabelColor(
  plugin: MolstarPlugin,
  chain: string | undefined,
  colorMap?: Map<string, number>
): number {
  if (!chain) return FALLBACK_CHAIN_COLOR;
  const map = colorMap ?? getChainColorMap(plugin);
  return map.get(chain) ?? FALLBACK_CHAIN_COLOR;
}
