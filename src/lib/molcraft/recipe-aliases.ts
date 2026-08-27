/**
 * Recipe Aliases — Shared recipe name normalization.
 *
 * This module is isomorphic (no client/server-only imports) so it can be
 * imported from both client components (commands.ts, chat-tab.tsx) and
 * server routes (/api/analyze/run/route.ts).
 *
 * The LLM sometimes returns non-canonical recipe names like "interface"
 * instead of "all_interactions", or "hbond" instead of "hbonds". This
 * function maps those aliases to the canonical recipe IDs registered in
 * cli-registry.ts.
 */

/** Canonical recipe names recognized by the system. */
export const CANONICAL_RECIPES = [
  "hbonds", "salt_bridges", "hydrophobic_contacts", "all_interactions",
  "pairwise_interactions",
  "binding_pocket", "druggability", "virtual_screening", "druglike_screening",
  "ligand_interactions", "disulfide_bonds", "metal_coordination",
  "aromatic_stacking", "water_bridges", "sasa", "electrostatic",
  "apbs_electrostatic", "ramachandran", "bfactor_stats",
  "secondary_structure_simple", "interface_residues", "detect_pockets",
  "oligomer_analysis", "surface_residues", "rmsd", "conformational_changes",
  "protonation_states", "summary", "distances", "contact_map",
  "sequence_align", "sequence_features", "structure_validation",
  // R134: Additional recipes
  "align_and_superpose", "align_save_transformed", "cross_pdb_rmsd",
  "cross_pdb_rmsd_aligned", "blast_chain_id", "entity_analysis",
  "per_residue_rmsd_two",
] as const;

/** Alias → canonical recipe name mapping. */
const RECIPE_ALIASES: Record<string, string> = {
  // Interface / interactions
  "interface": "all_interactions",
  "interactions": "all_interactions",
  "all_interactions": "all_interactions",
  "interface_residues": "interface_residues",
  "interface_residue": "interface_residues",
  // R161: pairwise chain-pair analysis
  "pairwise_interactions": "pairwise_interactions",
  "pairwise": "pairwise_interactions",
  "chain_pairs": "pairwise_interactions",
  "chain_pair": "pairwise_interactions",
  "all_pairs": "pairwise_interactions",
  "all_chain_pairs": "pairwise_interactions",
  "pairwise_chain_interactions": "pairwise_interactions",
  "inter_chain": "pairwise_interactions",
  "interchain": "pairwise_interactions",
  "cross_chain": "pairwise_interactions",
  // Hydrogen bonds
  "hbond": "hbonds",
  "h_bonds": "hbonds",
  "h-bonds": "hbonds",
  "hydrogen_bonds": "hbonds",
  "hbonds": "hbonds",
  // Salt bridges
  "salt_bridge": "salt_bridges",
  "salt-bridges": "salt_bridges",
  "saltbridge": "salt_bridges",
  "salt_bridges": "salt_bridges",
  // Hydrophobic
  "hydrophobic": "hydrophobic_contacts",
  "hydrophobics": "hydrophobic_contacts",
  "hydrophobic_contacts": "hydrophobic_contacts",
  // Binding pocket
  "binding_pocket": "binding_pocket",
  "pocket": "binding_pocket",
  "pockets": "detect_pockets",
  // Druggability
  "drug": "druggability",
  "druggable": "druggability",
  "druggability": "druggability",
  // Ligand
  "ligand": "ligand_interactions",
  "ligand_contacts": "ligand_interactions",
  "ligand_interactions": "ligand_interactions",
  // Disulfide
  "disulfide": "disulfide_bonds",
  "disulfide_bonds": "disulfide_bonds",
  // Metal
  "metal": "metal_coordination",
  "metal_coordination": "metal_coordination",
  // Aromatic stacking
  "aromatic": "aromatic_stacking",
  "stacking": "aromatic_stacking",
  "aromatic_stacking": "aromatic_stacking",
  // Water
  "water": "water_bridges",
  "water_bridged": "water_bridges",
  "water_bridges": "water_bridges",
  // SASA
  "sas": "sasa",
  "surface_area": "sasa",
  "sasa": "sasa",
  // Ramachandran
  "rama": "ramachandran",
  "ramachandran": "ramachandran",
  // B-factor
  "bfactor": "bfactor_stats",
  "b_factor": "bfactor_stats",
  "b-factor": "bfactor_stats",
  "bfactor_stats": "bfactor_stats",
  // Secondary structure
  "secondary_structure": "secondary_structure_simple",
  "secstruct": "secondary_structure_simple",
  "secondary_structure_simple": "secondary_structure_simple",
  // Oligomer
  "oligomer": "oligomer_analysis",
  "oligomer_analysis": "oligomer_analysis",
  // Surface residues
  "surface": "surface_residues",
  "surface_residues": "surface_residues",
  // Validation
  "validation": "structure_validation",
  "structure_validation": "structure_validation",
  // Protonation
  "protonation": "protonation_states",
  "protonation_states": "protonation_states",
  // Conformational
  "conformation": "conformational_changes",
  "conformational": "conformational_changes",
  "conformational_changes": "conformational_changes",
  // RMSD
  "rmsd": "rmsd",
  // Electrostatic
  "electrostatic": "electrostatic",
  "apbs": "apbs_electrostatic",
  "apbs_electrostatic": "apbs_electrostatic",
  // Virtual screening
  "virtual_screening": "virtual_screening",
  "screening": "virtual_screening",
  "druglike_screening": "druglike_screening",
  // Summary
  "summary": "summary",
  // Distances
  "distances": "distances",
  "distance": "distances",
  // Contact map
  "contact_map": "contact_map",
  "contactmap": "contact_map",
};

/**
 * Normalize a recipe name to its canonical form.
 *
 * Handles common LLM aliases like "interface" → "all_interactions",
 * "hbond" → "hbonds", etc. If the recipe name is not a known alias,
 * returns it unchanged (the caller can check against CANONICAL_RECIPES).
 *
 * @example
 * normalizeRecipeName("interface") // → "all_interactions"
 * normalizeRecipeName("hbond") // → "hbonds"
 * normalizeRecipeName("all_interactions") // → "all_interactions"
 * normalizeRecipeName("unknown_recipe") // → "unknown_recipe"
 */
export function normalizeRecipeName(recipe: string): string {
  if (!recipe || typeof recipe !== "string") return recipe;
  const normalized = recipe.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return RECIPE_ALIASES[normalized] || recipe;
}

/**
 * Check if a recipe name is canonical (after normalization).
 */
export function isCanonicalRecipe(recipe: string): boolean {
  const normalized = normalizeRecipeName(recipe);
  return (CANONICAL_RECIPES as readonly string[]).includes(normalized);
}

/**
 * Get the list of recipes that produce visualizable results (suitable
 * for screenshot capture).
 */
export function getVisualizableRecipes(): Set<string> {
  return new Set([
    "binding_pocket", "druggability", "all_interactions", "hbonds",
    "pairwise_interactions",
    "salt_bridges", "hydrophobic_contacts", "ligand_interactions",
    "disulfide_bonds", "metal_coordination", "aromatic_stacking",
    "water_bridges", "sasa", "electrostatic", "apbs_electrostatic",
    "virtual_screening", "druglike_screening", "interface_residues",
    "secondary_structure_simple", "bfactor_stats", "rmsd",
    "detect_pockets", "oligomer_analysis", "surface_residues",
    "conformational_changes", "protonation_states", "summary",
  ]);
}
