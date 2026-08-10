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
      sections.push(`### 🤝 Hydrogen Bonds (${count} found)`);
      if (count > 0 && Array.isArray(bonds)) {
        const residues = new Set<string>();
        const pairs: string[] = bonds.slice(0, 20).map((c: any) => {
          const r1 = `${c.resname1||"?"}${c.resno1||"?"}(${c.chain1||"?"})`;
          const r2 = `${c.resname2||"?"}${c.resno2||"?"}(${c.chain2||"?"})`;
          residues.add(r1); residues.add(r2);
          return `- ${r1} ${c.atom1||""} → ${r2} ${c.atom2||""} (${c.distance_A||c.distance||"?"} Å)`;
        });
        sections.push(`**Key residues:** ${[...residues].slice(0, 15).join(", ")}`);
        sections.push(""); sections.push("**Top interactions:**");
        sections.push(pairs.join("\n"));
        if (count > 20) sections.push(`\n*...and ${count - 20} more*`);
        // Top residue pairs (frequency) from the recipe
        const topPairs = rd?.top_residue_pairs as unknown[];
        if (Array.isArray(topPairs) && topPairs.length > 0) {
          sections.push("");
          sections.push("**Hotspot residue pairs:**");
          sections.push(topPairs.slice(0, 8).map((p: any) => `- ${p.pair} (${p.count} contacts)`).join("\n"));
        }
      } else { sections.push("*No hydrogen bonds detected.*"); }
    }
    else if (recipe === "salt_bridges") {
      const bridges = (rd?.salt_bridges as unknown[]) || [];
      const count = (rd?.total_salt_bridges as number) ?? (Array.isArray(bridges) ? bridges.length : 0);
      sections.push(`### ⚡ Salt Bridges (${count} found)`);
      if (count > 0 && Array.isArray(bridges)) {
        const residues = new Set<string>();
        const pairs: string[] = bridges.slice(0, 15).map((c: any) => {
          const r1 = `${c.resname1||"?"}${c.resno1||"?"}(${c.chain1||"?"})`;
          const r2 = `${c.resname2||"?"}${c.resno2||"?"}(${c.chain2||"?"})`;
          residues.add(r1); residues.add(r2);
          return `- ${r1} ↔ ${r2} (${c.distance_A||c.distance||"?"} Å)`;
        });
        sections.push(`**Key residues:** ${[...residues].join(", ")}`);
        sections.push(""); sections.push("**Interactions:**");
        sections.push(pairs.join("\n"));
      } else { sections.push("*No salt bridges detected.*"); }
    }
    else if (recipe === "hydrophobic_contacts") {
      const total = (rd?.total_atom_contacts as number) ?? 0;
      const pairs = (rd?.total_residue_pairs as number) ?? 0;
      sections.push(`### 💧 Hydrophobic Contacts (${total} atom contacts, ${pairs} residue pairs)`);
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
      sections.push(`### 🔄 All Interactions — ${chain1} ↔ ${chain2} (${total} total)`);
      if (total === 0) {
        sections.push("*No inter-chain contacts detected within cutoffs.*");
      } else {
        sections.push(`| Type | Count | % |`);
        sections.push(`|------|------|---|`);
        const pct = (n: number) => total > 0 ? Math.round((n / total) * 100) : 0;
        sections.push(`| 🤝 H-bonds | ${hb} | ${pct(hb)}% |`);
        sections.push(`| ⚡ Salt bridges | ${sb} | ${pct(sb)}% |`);
        sections.push(`| 💧 Hydrophobic | ${hp} | ${pct(hp)}% |`);
        const interactions = rd?.interactions as unknown[];
        if (Array.isArray(interactions) && interactions.length > 0) {
          sections.push("");
          sections.push("**Top interactions (sorted by distance):**");
          sections.push(interactions.slice(0, 20).map((c: any) => {
            const r1 = `${c.resname1||"?"}${c.resno1||"?"}(${c.chain1||"?"})`;
            const r2 = `${c.resname2||"?"}${c.resno2||"?"}(${c.chain2||"?"})`;
            const t = c.type || "?";
            const icon = t === "hbond" ? "🤝" : t === "salt_bridge" ? "⚡" : t === "hydrophobic" ? "💧" : "•";
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
            sections.push(`🔑 **Interface hotspots** (≥2 contacts each):`);
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
      sections.push(`### 💊 Binding Pocket (${ligand}, ${radius} Å, ${count} residues, ~${volume} Å³)`);
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
          const dist = r.min_dist || r.distance || r.dist || "?";
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
          sections.push(`\n🔑 **Catalytic residues detected:** ${catalytic.map((r:any) => `${r.resname||"?"}${r.resno||r.residue_number||"?"}`).join(", ")}`);
        }
      }
    }
    else if (recipe === "ramachandran") {
      sections.push(`### 📐 Ramachandran: Favoured ${rd?.favoured||rd?.favoured_percent||"?"}%, Outliers ${rd?.outliers||rd?.outlier_count||0}`);
    }
    else if (recipe === "sasa") {
      sections.push(`### 🌐 SASA: ${rd?.total_sasa||rd?.total||"?"} Å²`);
    }
    else if (recipe === "bfactor") {
      sections.push(`### 🌡️ B-factor: Mean ${rd?.mean||"?"}, Min ${rd?.min||"?"}, Max ${rd?.max||"?"}`);
    }
    else if (recipe) {
      sections.push(`### 📊 ${recipe}\n\`\`\`json\n${JSON.stringify(rd).slice(0,500)}\n\`\`\``);
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
