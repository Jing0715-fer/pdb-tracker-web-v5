"use client";

/**
 * Pure helper functions and small components extracted from chat-tab.tsx
 * to reduce the main file's compilation memory footprint.
 *
 * Extracted in Round 28 to address the 4GB sandbox OOM issue:
 *   - formatAnalysisResults  (~175 lines)
 *   - describeCommand         (~50 lines)
 *   - highlightSearch         (~20 lines)
 *   - STEP_LABELS              (~8 lines)
 *   - CodeBlockCopyButton     (~22 lines)
 *   - analyzeSentiment, generateQuickReplies  (message helpers)
 *
 * These have NO dependency on ChatTab's internal state — they are pure
 * functions or self-contained components that only need React + lucide icons.
 */

import { useState, useCallback } from "react";
import { Check, Copy, Brain, Cog, Terminal, X } from "lucide-react";
import type { LlmCommand } from "@/lib/molcraft/command-schema";

// ============================================================
// Analysis result formatting
// ============================================================

/**
 * Format analysis results into a readable markdown summary.
 * Shows key residues, interaction pairs with distances, binding pocket
 * composition, catalytic residue detection, and formatted tables.
 *
 * Field mappings verified against actual recipe outputs:
 * - hbonds: {total_hbonds, hbonds[], top_residue_pairs[]}
 *   — bonds have chain1/resno1/resname1/atom1/chain2/resno2/resname2/atom2/distance_A
 * - salt_bridges: {chain1, chain2, cutoff, total_salt_bridges, salt_bridges[]}
 *   — items have chain1/resno1/resname1/chain2/resno2/resname2/distance_A
 * - hydrophobic_contacts: {chain1, chain2, cutoff, total_atom_contacts, total_residue_pairs, top_residue_pairs[]}
 * - all_interactions: {chain1, chain2, total, salt_bridges(count), hbonds(count), hydrophobic(count), interactions[]}
 * - binding_pocket: {ligand, radius_A, pocket_residue_count, estimated_volume_A3, composition{}, residues[]}
 */
export function formatAnalysisResults(
  results: Array<{ type: string; ok: boolean; detail?: string; data?: unknown }>,
): string {
  const sections: string[] = [];
  for (const r of results) {
    if (!r.ok || !r.data) continue;
    const data = r.data as Record<string, unknown>;
    const recipe = (data as Record<string, unknown>)?.recipe as string || "";
    // The analysis result is wrapped twice:
    //   r.data = analysisResult = { kind, recipe, data: <apiResponse> }
    //   apiResponse = { recipe, ok, pdbId, data: <actual results>, stdout, stderr }
    // So the actual results live at `data.data.data`. Fall back gracefully
    // for recipes that return a flat object (no inner `.data`).
    const outer = (data as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
    const rd =
      outer && typeof outer === "object" && outer.data && typeof outer.data === "object"
        ? (outer.data as Record<string, unknown>)
        : (outer as Record<string, unknown>) || data;

    if (recipe === "hbonds") {
      const bonds = (rd?.hbonds as unknown[]) || (rd?.bonds as unknown[]) || [];
      const count = (rd?.total_hbonds as number) ?? (rd?.count as number) ?? (Array.isArray(bonds) ? bonds.length : 0);
      // Round 70: For large counts (>100), show summary instead of listing all
      const isLargeSet = count > 100;
      const displayCount = isLargeSet ? 10 : 20;
      sections.push(`### Hydrogen Bonds (${count} found${isLargeSet ? " — showing top 10 by distance" : ""})`);
      if (count > 0 && Array.isArray(bonds)) {
        const residues = new Set<string>();
        const pairs: string[] = bonds.slice(0, displayCount).map((c: any) => {
          // Round 70: Fix field name mapping — recipe outputs donor_*/acceptor_* fields
          const r1name = c.donor_resname || c.resname1 || "?";
          const r1no = c.donor_resno || c.resno1 || "?";
          const r1chain = c.donor_chain || c.chain1 || "?";
          const r2name = c.acceptor_resname || c.resname2 || "?";
          const r2no = c.acceptor_resno || c.resno2 || "?";
          const r2chain = c.acceptor_chain || c.chain2 || "?";
          const a1 = c.donor_atom || c.atom1 || "";
          const a2 = c.acceptor_atom || c.atom2 || "";
          const r1 = `${r1name}${r1no}(${r1chain})`;
          const r2 = `${r2name}${r2no}(${r2chain})`;
          residues.add(r1); residues.add(r2);
          const angleStr = c.angle_deg != null ? `, ${c.angle_deg}°` : "";
          return `- ${r1} ${a1} → ${r2} ${a2} (${c.distance_A||c.distance||"?"} Å${angleStr})`;
        });
        // For large sets, show unique residue count instead of all residues
        if (isLargeSet) {
          sections.push(`**Unique residues involved:** ${residues.size} residues across ${count} H-bonds`);
        } else {
          sections.push(`**Key residues:** ${[...residues].slice(0, 15).join(", ")}`);
        }
        sections.push(""); sections.push(`**Top ${displayCount} interactions:**`);
        sections.push(pairs.join("\n"));
        if (count > displayCount) sections.push(`\n*...and ${count - displayCount} more*`);
        // Top residue pairs (frequency) from the recipe
        const topPairs = rd?.top_residue_pairs as unknown[];
        if (Array.isArray(topPairs) && topPairs.length > 0) {
          sections.push("");
          sections.push("**Hotspot residue pairs (by frequency):**");
          sections.push(topPairs.slice(0, 10).map((p: any) => `- ${p.pair} (${p.count} contacts)`).join("\n"));
        }
      } else { sections.push("*No hydrogen bonds detected.*"); }
    }
    else if (recipe === "salt_bridges") {
      const bridges = (rd?.salt_bridges as unknown[]) || [];
      const count = (rd?.total_salt_bridges as number) ?? (Array.isArray(bridges) ? bridges.length : 0);
      sections.push(`### Salt Bridges (${count} found)`);
      if (count > 0 && Array.isArray(bridges)) {
        const residues = new Set<string>();
        const pairs: string[] = bridges.slice(0, 15).map((c: any) => {
          // Round 70: Fix field name mapping — recipe outputs pos_*/neg_* fields
          const r1name = c.pos_resname || c.resname1 || "?";
          const r1no = c.pos_resno || c.resno1 || "?";
          const r1chain = c.pos_chain || c.chain1 || "?";
          const r2name = c.neg_resname || c.resname2 || "?";
          const r2no = c.neg_resno || c.resno2 || "?";
          const r2chain = c.neg_chain || c.chain2 || "?";
          const r1 = `${r1name}${r1no}(${r1chain})`;
          const r2 = `${r2name}${r2no}(${r2chain})`;
          residues.add(r1); residues.add(r2);
          return `- ${r1}(+) ↔ ${r2}(−) (${c.distance_A||c.distance||"?"} Å)`;
        });
        sections.push(`**Key residues:** ${[...residues].join(", ")}`);
        sections.push(""); sections.push("**Interactions:**");
        sections.push(pairs.join("\n"));
      } else { sections.push("*No salt bridges detected.*"); }
    }
    else if (recipe === "hydrophobic_contacts") {
      const total = (rd?.total_atom_contacts as number) ?? 0;
      const pairs = (rd?.total_residue_pairs as number) ?? 0;
      sections.push(`### Hydrophobic Contacts (${total} atom contacts, ${pairs} residue pairs)`);
      const top = rd?.top_residue_pairs as unknown[];
      if (Array.isArray(top) && top.length > 0) {
        sections.push("**Top residue pairs:**");
        sections.push(top.slice(0, 10).map((p: any) => `- ${p.pair} (${p.contacts} contacts)`).join("\n"));
      }
    }
    else if (recipe === "all_interactions") {
      const total = (rd?.total as number) ?? 0;
      const sb = (rd?.salt_bridges as number) ?? 0;
      const hb = (rd?.hbonds as number) ?? 0;
      const hp = (rd?.hydrophobic as number) ?? 0;
      const chain1 = (rd?.chain1 as string) || "?";
      const chain2 = (rd?.chain2 as string) || "?";
      sections.push(`### All Interactions — ${chain1} ↔ ${chain2} (${total} total)`);
      if (total === 0) {
        sections.push("*No inter-chain contacts detected within cutoffs.*");
      } else {
        sections.push(`| Type | Count | % |`);
        sections.push(`|------|------|---|`);
        const pct = (n: number) => total > 0 ? Math.round((n / total) * 100) : 0;
        sections.push(`| H-bonds | ${hb} | ${pct(hb)}% |`);
        sections.push(`| Salt bridges | ${sb} | ${pct(sb)}% |`);
        sections.push(`| Hydrophobic | ${hp} | ${pct(hp)}% |`);
        const interactions = rd?.interactions as unknown[];
        if (Array.isArray(interactions) && interactions.length > 0) {
          sections.push("");
          sections.push("**Top interactions (sorted by distance):**");
          sections.push(interactions.slice(0, 20).map((c: any) => {
            const r1 = `${c.resname1||"?"}${c.resno1||"?"}(${c.chain1||"?"})`;
            const r2 = `${c.resname2||"?"}${c.resno2||"?"}(${c.chain2||"?"})`;
            const t = c.type || "?";
            const icon = t === "hbond" ? "[H-bond]" : t === "salt_bridge" ? "[salt]" : t === "hydrophobic" ? "[hydro]" : "-";
            return `- ${icon} ${r1} ${c.atom1||""} ↔ ${r2} ${c.atom2||""} (${c.distance_A||"?"} Å)`;
          }).join("\n"));
          if (total > 20) sections.push(`\n*...and ${total - 20} more*`);
          // Highlight key residues (appearing in multiple contacts)
          const residueCounts: Record<string, number> = {};
          for (const c of interactions as any[]) {
            const r1 = `${c.resname1||"?"}${c.resno1||"?"}(${c.chain1||"?"})`;
            const r2 = `${c.resname2||"?"}${c.resno2||"?"}(${c.chain2||"?"})`;
            residueCounts[r1] = (residueCounts[r1] || 0) + 1;
            residueCounts[r2] = (residueCounts[r2] || 0) + 1;
          }
          const hotspots = Object.entries(residueCounts)
            .filter(([, n]) => n >= 2)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);
          if (hotspots.length > 0) {
            sections.push("");
            sections.push(`**Interface hotspots** (≥2 contacts each):`);
            sections.push(hotspots.map(([r, n]) => `- ${r} — ${n} contacts`).join("\n"));
          }
        }
      }
    }
    else if (recipe === "binding_pocket") {
      const residues = (rd?.residues as unknown[]) || [];
      const volume = (rd?.estimated_volume_A3 as string|number) || (rd?.estimated_volume as string|number) || "?";
      const ligand = (rd?.ligand as string) || "?";
      const radius = (rd?.radius_A as string|number) || (rd?.radius as string|number) || "?";
      const count = (rd?.pocket_residue_count as number) ?? (Array.isArray(residues) ? residues.length : 0);
      const composition = (rd?.composition as Record<string, number>) || {};
      sections.push(`### Binding Pocket (${ligand}, ${radius} Å, ${count} residues, ~${volume} Å³)`);
      sections.push(`| Property | Value |`);
      sections.push(`|----------|-------|`);
      sections.push(`| Total residues | ${count} |`);
      sections.push(`| Volume | ${volume} Å³ |`);
      for (const [type, n] of Object.entries(composition)) {
        sections.push(`| ${type} | ${n} (${count > 0 ? Math.round(Number(n)/count*100) : 0}%) |`);
      }
      if (Array.isArray(residues) && residues.length > 0) {
        sections.push("");
        const residueList = residues.slice(0, 20).map((r: any) => {
          const name = r.resname || r.residue_name || r.amino_acid || r.name || "?";
          const num = r.resno || r.residue_number || r.resNum || "?";
          const chain = r.chain || r.chain_id || "A";
          // Round 70: Fix distance field — recipe outputs min_dist_A, not min_dist
          const dist = r.min_dist_A ?? r.min_dist ?? r.distance ?? r.dist ?? "?";
          return `${name}${num}(${chain}) ${dist}Å`;
        });
        sections.push(`**Pocket residues:** ${residueList.join(", ")}`);
        if (count > 20) sections.push(`\n*...and ${count - 20} more*`);
        // Detect catalytic residues (CYS145, HIS41 for Mpro; common catalytic dyad)
        const catalytic = residues.filter((r: any) => {
          const n = Number(r.resno || r.residue_number || 0);
          return [41, 145].includes(n);
        });
        if (catalytic.length > 0) {
          sections.push(`\n**Catalytic residues detected:** ${catalytic.map((r:any) => `${r.resname||"?"}${r.resno||r.residue_number||"?"}`).join(", ")}`);
        }
      }
    }
    else if (recipe === "ramachandran") {
      const favoured = rd?.favoured ?? rd?.favoured_pct ?? rd?.favoured_percent ?? "?";
      const outliers = rd?.outliers ?? rd?.outlier_pct ?? rd?.outlier_count ?? 0;
      sections.push(`### Ramachandran: Favoured ${favoured}%, Outliers ${outliers}%`);
    }
    else if (recipe === "sasa") {
      sections.push(`### SASA: ${rd?.total_sasa||rd?.total_sasa_A2||rd?.total||"?"} Å²`);
    }
    else if (recipe === "bfactor" || recipe === "bfactor_stats") {
      // Output format: { chains: { "A": { chain, mean, min, max, std, ... }, "B": {...} }, total_chains }
      const chainsMap = rd?.chains as Record<string, any> | undefined;
      if (chainsMap && typeof chainsMap === 'object' && !Array.isArray(chainsMap)) {
        const chainEntries = Object.values(chainsMap).filter(c => c && typeof c === 'object');
        if (chainEntries.length > 0) {
          const allMeans = chainEntries.map(c => c.mean).filter(Boolean);
          const allMins = chainEntries.map(c => c.min).filter(Boolean);
          const allMaxs = chainEntries.map(c => c.max).filter(Boolean);
          const mean = allMeans.length > 0 ? (allMeans.reduce((a: number, b: number) => a + b, 0) / allMeans.length).toFixed(1) : "?";
          const min = allMins.length > 0 ? Math.min(...allMins).toFixed(1) : "?";
          const max = allMaxs.length > 0 ? Math.max(...allMaxs).toFixed(1) : "?";
          sections.push(`### B-factor: Mean ${mean}, Min ${min}, Max ${max}`);
          sections.push(`**Per-chain:** ${chainEntries.map((c: any) => `Chain ${c.chain}: mean ${c.mean?.toFixed(1)||"?"}`).join(", ")}`);
        } else {
          sections.push(`### B-factor: (no chain data)`);
        }
      } else {
        sections.push(`### B-factor: Mean ${rd?.mean||"?"}, Min ${rd?.min||"?"}, Max ${rd?.max||"?"}`);
      }
    }
    else if (recipe === "druggability") {
      const score = rd?.druggability_score ?? "?";
      const cls = rd?.classification ?? "?";
      sections.push(`### Druggability: Score ${score}/100, Classification: ${cls}`);
      if (rd?.pocket_volume_A3) sections.push(`- Pocket volume: ${rd.pocket_volume_A3} Å³`);
      if (rd?.hydrophobic_pct) sections.push(`- Hydrophobic: ${rd.hydrophobic_pct}%, Polar: ${rd.polar_pct}%, Charged: ${rd.charged_pct}%`);
    }
    else if (recipe === "virtual_screening") {
      const hits = rd?.ranked_hits || [];
      sections.push(`### Virtual Screening: ${rd?.num_fragments_screened||"?"} fragments screened, best Ki ${rd?.best_ki_uM||"?"} μM`);
      if (hits.length > 0) {
        sections.push(`**Top hits:**`);
        sections.push(hits.slice(0, 5).map((h: any) => `- ${h.name} (Ki ${h.ki_uM} μM, score ${h.score})`).join('\n'));
      }
    }
    else if (recipe === "ligand_interactions") {
      const contacts = rd?.contacts || rd?.interactions || [];
      sections.push(`### Ligand Interactions: ${rd?.total_contacts||contacts.length||"?"} contacts`);
      if (contacts.length > 0) {
        sections.push(contacts.slice(0, 10).map((c: any) => `- ${c.resname||"?"}${c.resno||"?"}(${c.chain||"?"}) ${c.atom||""} ↔ ${c.ligand_atom||c.atom_name||""} (${c.distance_A||c.distance||"?"} Å)`).join('\n'));
      }
    }
    else if (recipe === "detect_pockets") {
      const pockets = rd?.pockets || [];
      sections.push(`### Pocket Detection: ${rd?.num_pockets||pockets.length||"?"} pockets found`);
      if (pockets.length > 0) {
        sections.push(pockets.slice(0, 5).map((p: any) => `- Pocket ${p.id||"?"}: volume ${p.volume||"?"} Å³, ${p.residue_count||"?"} residues`).join('\n'));
      }
    }
    else if (recipe === "entity_analysis") {
      sections.push(`### Entity Analysis: ${rd?.total_entities||"?"} entities, ${rd?.n_chains||rd?.total_chains||"?"} chains`);
      if (rd?.entities) {
        sections.push(rd.entities.slice(0, 5).map((e: any) => `- ${e.entity_id}: ${e.type} (${e.description||e.header||"?"})`).join('\n'));
      }
    }
    else if (recipe === "disulfide_bonds") {
      const bonds = rd?.bonds || [];
      sections.push(`### Disulfide Bonds: ${rd?.count||bonds.length||"?"} bonds`);
      if (bonds.length > 0) {
        sections.push(bonds.slice(0, 10).map((b: any) => `- ${b.chain1||"?"}${b.resno1||"?"} ↔ ${b.chain2||"?"}${b.resno2||"?"} (${b.distance_A||"?"} Å)`).join('\n'));
      }
    }
    else if (recipe === "aromatic_stacking") {
      const stackings = rd?.interactions || rd?.stackings || [];
      const total = rd?.total_aromatic_interactions ?? rd?.total ?? stackings.length ?? "?";
      sections.push(`### Aromatic Stacking: ${total} interactions (π-π: ${rd?.pi_pi_count||"?"}, cation-π: ${rd?.cation_pi_count||"?"})`);
    }
    else if (recipe === "water_bridges") {
      const bridges = rd?.bridges || rd?.interactions || [];
      const total = rd?.total_water_bridges ?? rd?.total ?? bridges.length ?? "?";
      sections.push(`### Water Bridges: ${total} bridges`);
    }
    else if (recipe === "metal_coordination") {
      sections.push(`### Metal Coordination: ${rd?.total_metals||"?"} metals, ${rd?.total_sites||rd?.total_metal_sites||"?"} sites`);
    }
    else if (recipe === "contact_map") {
      sections.push(`### Contact Map: ${rd?.total_ca_contacts||rd?.total_contacts||"?"} Cα contacts`);
    }
    else if (recipe === "oligomer_analysis") {
      sections.push(`### Oligomer Analysis: ${rd?.oligomer_type||rd?.oligomeric_state||rd?.assembly||"?"} (${rd?.is_homomer ? "homomer" : "heteromer"}, ${rd?.n_interfaces||"?"} interfaces)`);
    }
    else if (recipe === "surface_residues") {
      sections.push(`### Surface Residues: ${rd?.surface_count||rd?.total||rd?.count||"?"} surface, ${rd?.buried_count||"?"} buried (${rd?.surface_pct||"?"}% surface)`);
    }
    else if (recipe === "structure_validation") {
      sections.push(`### Structure Validation: ${rd?.quality||"?"} quality, ${rd?.clash_count||rd?.clashscore||"?"} clashes, ${rd?.rama_outlier_pct||rd?.ramachandran_outliers||"?"}% outliers`);
    }
    else if (recipe === "secondary_structure_simple") {
      sections.push(`### Secondary Structure: ${rd?.alpha_helix_pct||"?"}% α-helix, ${rd?.beta_sheet_pct||"?"}% β-sheet, ${rd?.coil_pct||"?"}% coil, ${rd?.turn_pct||"?"}% turn`);
    }
    else if (recipe === "sequence_features") {
      // Output format: { chains: [{ chain, sequence_length, molecular_weight_Da, isoelectric_point_pI, ... }], n_chains_analyzed }
      const chains = rd?.chains as any[] || [];
      if (chains.length > 0 && Array.isArray(chains)) {
        const totalLen = chains.reduce((s: number, c: any) => s + (c.sequence_length || c.length || 0), 0);
        const totalMw = chains.reduce((s: number, c: any) => s + (c.molecular_weight_Da || c.mw || c.molecular_weight || 0), 0);
        const mwKDa = totalMw > 1000 ? (totalMw / 1000).toFixed(1) : totalMw.toFixed(1);
        sections.push(`### Sequence Features: ${totalLen} residues, MW ${mwKDa} kDa (${chains.length} chains)`);
        sections.push(chains.slice(0, 5).map((c: any) => `- Chain ${c.chain}: ${c.sequence_length||c.length||"?"} aa, MW ${((c.molecular_weight_Da||c.mw||0)/1000).toFixed(1)} kDa, pI ${c.isoelectric_point_pI?.toFixed(1)||c.pi?.toFixed(1)||"?"}`).join('\n'));
      } else {
        sections.push(`### Sequence Features: ${rd?.length||rd?.sequence_length||"?"} residues, MW ${rd?.molecular_weight||rd?.mw||"?"} kDa`);
      }
    }
    else if (recipe === "interface_residues") {
      // Output format: { chain1_interface_residues: [...], chain2_interface_residues: [...], total_atom_pairs }
      const r1 = rd?.chain1_interface_residues || rd?.interface_residues || rd?.residues || [];
      const r2 = rd?.chain2_interface_residues || [];
      const total = rd?.total_atom_pairs ?? r1.length + r2.length ?? "?";
      sections.push(`### Interface Residues: ${r1.length} on chain ${rd?.chain1||"?"}, ${r2.length} on chain ${rd?.chain2||"?"} (${total} atom pairs)`);
    }
    else if (recipe === "protonation_states") {
      sections.push(`### Protonation States (pH ${rd?.pH||"?"}): ${rd?.total_ionizable||"?"} ionizable residues, net charge ${rd?.net_charge||"?"}`);
      if (rd?.residues && Array.isArray(rd.residues)) {
        const charged = rd.residues.filter((r: any) => Math.abs(r.charge_at_pH) >= 0.5);
        sections.push(`**Fully charged residues:** ${charged.map((r: any) => `${r.resname}${r.resno}(${r.charge_at_pH > 0 ? "+" : "-"})`).join(", ") || "none"}`);
      }
    }
    else if (recipe === "conformational_changes") {
      sections.push(`### Conformational Changes: Mean B-factor ${rd?.mean_bfactor||"?"} ± ${rd?.std_bfactor||"?"}, ${rd?.flexible_residues||"?"} flexible, ${rd?.rigid_residues||"?"} rigid`);
      const regions = rd?.top_flexible_regions;
      if (Array.isArray(regions) && regions.length > 0) {
        sections.push(`**Top flexible regions:**`);
        sections.push(regions.slice(0, 5).map((r: any) => `- Residue ${r.start_resno}: RMSD ${r.rmsd}`).join('\n'));
      }
    }
    else if (recipe === "druglike_screening") {
      sections.push(`### Druglike Screening: Score ${rd?.druglike_score||"?"}/100, Lipinski: ${rd?.lipinski_assessment||"?"}`);
      if (rd?.admet_prediction) {
        const a = rd.admet_prediction;
        sections.push(`**ADMET:** Absorption ${a.absorption||"?"}, Permeability ${a.permeability||"?"}, Stability ${a.metabolic_stability||"?"}, Toxicity ${a.toxicity_risk||"?"}`);
      }
      if (rd?.pocket_volume_A3) sections.push(`- Pocket volume: ${rd.pocket_volume_A3} Å³`);
    }
    else if (recipe) {
      sections.push(`### ${recipe}\n\`\`\`json\n${JSON.stringify(rd).slice(0,500)}\n\`\`\``);
    }
  }
  return sections.length > 0 ? sections.join("\n") : "";
}

// ============================================================
// Command description
// ============================================================

/**
 * Convert a command object to a human-readable description.
 * Used in the command preview panel before execution.
 */
export function describeCommand(cmd: LlmCommand): string {
  switch (cmd.type) {
    case "load_pdb": return `Load PDB ${cmd.id}`;
    case "load_alphafold": return `Load AlphaFold ${cmd.uniprotId}`;
    case "load_emdb": return `Load EMDB ${cmd.emdbId}`;
    case "load_structure_url": return `Load structure from URL`;
    case "load_structure_data": return `Load structure data`;
    case "set_representation": return `Set representation: ${cmd.preset}`;
    case "set_color_theme": return `Color by ${cmd.theme}`;
    case "set_uniform_color": return `Set uniform color ${cmd.color}`;
    case "focus_residue": return `Focus on residue ${cmd.chain || ""}${cmd.resno || ""}`;
    case "focus_ligand": return `Focus on ligand ${cmd.compId}`;
    case "focus_chain": return `Focus on chain ${cmd.chain}`;
    case "focus_selection": return `Focus on selection`;
    case "reset_camera": return `Reset camera`;
    case "measure_distance": return `Measure distance`;
    case "measure_angle": return `Measure angle`;
    case "measure_dihedral": return `Measure dihedral`;
    case "label_residue": return `Label residue`;
    case "show_interactions": return `Show interactions`;
    case "clear_measurements": return `Clear measurements`;
    case "clear_interactions": return `Clear interactions`;
    case "toggle_spin": return `Toggle spin`;
    case "toggle_rock": return `Toggle rock`;
    case "stop_animation": return `Stop animation`;
    case "export_snapshot": return `Export snapshot`;
    case "capture_snapshot": return `Capture snapshot${cmd.label ? ": " + cmd.label : ""}`;
    case "select": return `Select`;
    case "clear_selection": return `Clear selection`;
    case "toggle_component_visibility": return `Toggle ${cmd.component} visibility`;
    case "load_volume_url": return `Load volume`;
    case "align_structures": return `Align structures`;
    case "set_background": return `Set background ${cmd.color}`;
    case "set_granularity": return `Set granularity: ${cmd.granularity}`;
    case "analyze_metadata": return `Get metadata for ${cmd.id}`;
    case "analyze_interface": return `Analyze interface (assembly ${cmd.assembly || 1})`;
    case "analyze_cli_list": return `List available CLI tools`;
    case "analyze_run": {
      const p = cmd.params as Record<string, unknown> | undefined;
      const chainInfo = p?.chain1 && p?.chain2 ? ` (${p.chain1}↔${p.chain2})` : "";
      return `Run ${cmd.recipe}${chainInfo}`;
    }
    case "show_electrostatic_surface": return `Show electrostatic surface`;
    case "show_druggable_pocket": return `Show druggable pocket (${cmd.ligandCompId})`;
    case "run_virtual_screening": return `Run virtual screening (${cmd.fragmentSet || "druglike"})`;
    case "detect_pockets": return `Detect pockets`;
    default: return cmd.type || "unknown";
  }
}

// ============================================================
// Agent step labels
// ============================================================

/** Map an agentStep to a human-readable label + icon. */
export const STEP_LABELS: Record<string, { label: string; icon: typeof Brain }> = {
  "thinking": { label: "Thinking…", icon: Brain },
  "calling-llm": { label: "Calling LLM…", icon: Brain },
  "parsing": { label: "Parsing response…", icon: Cog },
  "executing": { label: "Executing commands…", icon: Terminal },
  "done": { label: "Done", icon: Check },
  "error": { label: "Error", icon: X },
};

// ============================================================
// Search highlighting
// ============================================================

/**
 * Highlight search matches in text.
 * Returns an array of text segments with match flags for rendering.
 */
export function highlightSearch(text: string, query: string): Array<{ text: string; match: boolean }> {
  if (!query.trim()) return [{ text, match: false }];
  const q = query.trim();
  const lowerText = text.toLowerCase();
  const lowerQ = q.toLowerCase();
  const segments: Array<{ text: string; match: boolean }> = [];
  let lastIndex = 0;
  let idx = lowerText.indexOf(lowerQ);
  while (idx !== -1) {
    if (idx > lastIndex) {
      segments.push({ text: text.slice(lastIndex, idx), match: false });
    }
    segments.push({ text: text.slice(idx, idx + q.length), match: true });
    lastIndex = idx + q.length;
    idx = lowerText.indexOf(lowerQ, lastIndex);
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), match: false });
  }
  return segments.length > 0 ? segments : [{ text, match: false }];
}

// ============================================================
// Code block copy button
// ============================================================

/**
 * Copy button for code blocks in assistant messages.
 * Shows a Copy icon, changes to Check for 1.5s after copying.
 */
export function CodeBlockCopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => { /* ignore */ }
    );
  }, [code]);
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-0.5 text-[8px] text-claude-text-muted hover:text-claude-accent transition-colors"
      title="Copy code"
    >
      {copied ? <Check className="h-2.5 w-2.5 text-green-600" /> : <Copy className="h-2.5 w-2.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
