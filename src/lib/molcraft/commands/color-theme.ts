/**
 * Color theme normalization — maps LLM-friendly color theme names to Molstar's
 * actual built-in color theme names.
 *
 * Extracted from commands.ts (R138) as part of the module split.
 */

/**
 * Map LLM-friendly color theme aliases to Molstar's actual built-in color theme
 * names. Returns `null` if the theme is not recognized.
 *
 * Molstar's valid built-in color themes (verified against
 * node_modules/molstar/lib/mol-theme/color/):
 *   uniform, chain-id, entity-id, entity-source, model-index, structure-index,
 *   residue-name, element-symbol, element-index, sequence-id, hydrophobicity,
 *   occupancy, uncertainty, polymer-id, polymer-index, operator-hkl,
 *   operator-name, partial-charge, formal-charge, residue-charge,
 *   secondary-structure, molecule-type, carbohydrate-symbol, cartoon,
 *   illustrative, shape-group, trajectory-index, unit-index, volume-value,
 *   volume-segment, volume-instance, external-structure, external-volume, atom-id
 *
 * Passing an unrecognized theme into `updateRepresentationsTheme` breaks the
 * representation and the structure visually disappears, so we explicitly
 * validate here.
 */
export function normalizeColorTheme(theme: string | undefined): string | null {
  if (!theme || typeof theme !== "string") return null;
  const t = theme.trim().toLowerCase().replace(/[\s_-]+/g, "-");

  // Direct canonical match — the complete list of Molstar built-in color themes.
  const CANONICAL = new Set([
    "uniform", "chain-id", "entity-id", "entity-source", "model-index",
    "structure-index", "residue-name", "element-symbol", "element-index",
    "sequence-id", "hydrophobicity", "occupancy", "uncertainty",
    "polymer-id", "polymer-index", "operator-hkl", "operator-name",
    "partial-charge", "formal-charge", "residue-charge",
    "secondary-structure", "molecule-type", "carbohydrate-symbol",
    "cartoon", "illustrative", "shape-group", "trajectory-index",
    "unit-index", "volume-value", "volume-segment", "volume-instance",
    "external-structure", "external-volume", "atom-id",
  ]);
  if (CANONICAL.has(t)) return t;

  // Alias map — LLM-friendly names → canonical Molstar theme names.
  const ALIASES: Record<string, string> = {
    "chain": "chain-id",
    "chainid": "chain-id",
    "by-chain": "chain-id",
    "bychain": "chain-id",
    "colorbychain": "chain-id",
    "element": "element-symbol",
    "by-element": "element-symbol",
    "byelement": "element-symbol",
    "colorbyelement": "element-symbol",
    "residue": "residue-name",
    "by-residue": "residue-name",
    "byresidue": "residue-name",
    "amino-acid": "residue-name",
    "aminoacid": "residue-name",
    "sequence": "sequence-id",
    "by-sequence": "sequence-id",
    "bysequence": "sequence-id",
    "seq": "sequence-id",
    "seqid": "sequence-id",
    "hydrophobic": "hydrophobicity",
    "by-hydrophobicity": "hydrophobicity",
    "entity": "entity-id",
    "model": "model-index",
    "structure": "structure-index",
    "polymer": "polymer-index",
    // R137: bfactor → uncertainty (NOT a self-map — "bfactor" is invalid)
    "bfactor": "uncertainty",
    "b-factor": "uncertainty",
    "bfact": "uncertainty",
    "temperature": "uncertainty",
    // R137: secondary-structure aliases
    "secondary": "secondary-structure",
    "ss": "secondary-structure",
    "secstruc": "secondary-structure",
    "helix-sheet": "secondary-structure",
    // R137: charge aliases
    "charge": "partial-charge",
    "partial": "partial-charge",
    "electrostatic": "partial-charge",
    "formal": "formal-charge",
    "residue-charge-name": "residue-charge",
    "molecule": "molecule-type",
    "mol-type": "molecule-type",
    "occupancy": "occupancy",
    "uncertainty": "uncertainty",
  };
  if (ALIASES[t]) return ALIASES[t];

  return null;
}

/** Human-readable Chinese label for a residue category. */
export function categoryLabel(cat: string): string {
  switch (cat) {
    case "hydrophobic": return "疏水";
    case "polar": return "极性";
    case "positive": return "正电";
    case "negative": return "负电";
    case "glycine": return "甘氨酸";
    default: return "其他";
  }
}

/** Convert a hex color string (#rrggbb) to a number. */
export function hexToNumber(hex: string): number {
  const clean = hex.replace("#", "");
  return parseInt(clean, 16);
}
