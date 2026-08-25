/**
 * Recipe visualization — apply recipe-specific 3D visualizations before capture.
 *
 * Extracted from commands.ts (R138) as part of the module split.
 *
 * This function inspects the recipe ID and the analysis result data to
 * determine the best visualization, then applies it via the Molstar API.
 * For example:
 *   - binding_pocket → focus on ligand + set representation to show pocket
 *   - all_interactions → show interactions + focus on interface
 *   - druggability → show druggable pocket surface
 *   - hbonds → show interactions (H-bonds)
 *   - virtual_screening → show top hit pose
 *
 * The function is best-effort — if any visualization step fails, it logs a
 * warning and continues. The screenshot will still be captured even if
 * visualization is not applied.
 */

import type { MolstarViewer, MolstarPlugin } from "../types";
import { getStructures, collectComponents, getFirstStructureData, isLociEmpty } from "./structure-helpers";
import { lociFromResidue } from "./loci";
import { normalizeColorTheme } from "./color-theme";
import { nextFrame } from "./screenshot-utils";

/**
 * R154: Build a StructureElement.Loci for a specific residue (and optionally atom)
 * by directly traversing structure units — NOT using MolScript builder (which is
 * not available in the prebuilt bundle).
 *
 * This mirrors the approach in measure.ts showResidueSidechain: iterate all
 * atomic units, find elements matching the residue spec, build a loci.
 *
 * Returns { loci, expr } where loci is the StructureElement.Loci and expr is
 * the Expression (via SE.Loci.toExpression) for use with tryCreateComponentFromExpression.
 */
export function buildResidueLoci(
  plugin: MolstarPlugin,
  refs: Array<{ chain: string; resno: number; atomName?: string }>
): { loci: unknown; expr: unknown } | null {
  const bundle = (window as any).molstar;
  const SE = bundle?.lib?.structure?.StructureElement;
  const SP = bundle?.lib?.structure?.StructureProperties;
  if (!SE || !SP) {
    console.warn("[buildResidueLoci] StructureElement/Properties not available");
    return null;
  }

  const structs = plugin.managers.structure.hierarchy.current.structures;
  if (!structs.length) return null;
  const sr = structs[0];
  const data = sr?.cell?.obj?.data;
  if (!data) return null;

  // Build a set of residue keys for fast lookup
  const refSet = new Set<string>();
  const atomMap = new Map<string, string | undefined>(); // key -> atomName
  for (const ref of refs) {
    const key = `${ref.chain}:${ref.resno}`;
    refSet.add(key);
    if (ref.atomName) {
      atomMap.set(key, ref.atomName);
    }
  }

  // Find ALL elements matching any of the residue specs
  const elementsByUnit = new Map<unknown, number[]>();
  for (const unit of data.units) {
    if (unit.kind !== 0) continue; // atomic only
    const indices: number[] = [];
    for (let i = 0; i < unit.elements.length; i++) {
      const loc = SE.Location.create(data, unit, i);
      const chainId = SP.chain.auth_asym_id(loc) || SP.chain.label_asym_id(loc);
      const resno = SP.residue.auth_seq_id(loc);
      const key = `${chainId}:${resno}`;
      if (!refSet.has(key)) continue;

      // If atomName is specified, filter by atom name
      const atomName = atomMap.get(key);
      if (atomName) {
        const atomId = SP.atom.label_atom_id(loc);
        if (atomId !== atomName) continue;
      }

      indices.push(i);
    }
    if (indices.length > 0) {
      elementsByUnit.set(unit, indices);
    }
  }

  if (elementsByUnit.size === 0) return null;

  // Build the elements array for the loci
  const elements: Array<{ unit: unknown; indices: number[] }> = [];
  elementsByUnit.forEach((indices, unit) => {
    elements.push({ unit, indices });
  });

  // Create a StructureElement.Loci and convert to expression
  const loci = new SE.Loci(data, elements);
  const expr = SE.Loci.toExpression(loci);
  return { loci, expr };
}

export async function applyRecipeVisualization(
  viewer: MolstarViewer,
  recipe: string,
  params?: Record<string, unknown>
): Promise<void> {
  try {
    const plugin = (viewer as unknown as { plugin?: MolstarPlugin }).plugin;
    if (!plugin) return;

    // Helper: safely execute a visualization step, logging errors
    const safe = async (fn: () => Promise<void>, label: string) => {
      try {
        await fn();
      } catch (err) {
        console.warn(`[viz:${recipe}] ${label} failed:`, err);
      }
    };

    // R140: Normalize the vizParams data structure.
    //
    // The auto-capture path passes `analysisData = result.analysisResult.data`
    // which has the shape: { recipe, ok, pdbId, format, data: { chain1, chain2, interactions, ... } }
    //
    // But applyRecipeVisualization expects params.chain1, params.interactions, etc.
    // at the TOP LEVEL. Without this normalization, the interaction data is
    // nested under params.data and never read, so the camera doesn't focus on
    // the interface and side chains aren't shown.
    //
    // This step unwraps the nested .data so all the recipe cases can access
    // chain1/chain2/interactions directly from `params`.
    if (params && typeof params === 'object') {
      const innerData = (params as any).data;
      if (innerData && typeof innerData === 'object') {
        // Merge inner data keys to the top level (without overwriting existing top-level keys)
        for (const key of Object.keys(innerData)) {
          if ((params as any)[key] === undefined) {
            (params as any)[key] = innerData[key];
          }
        }
        console.log(`[viz:${recipe}] Normalized nested data — keys: ${Object.keys(params).join(', ')}`);
      }
    }

    // R143: Read VLM hints from the capture loop (Plan D integration).
    // These are set by applyVlmHints() in vlm-capture-loop.ts and control
    // camera zoom/focus for re-capture iterations.
    const vlmZoomMultiplier = (params as any)?._focusRadiusMultiplier as number | undefined;
    const vlmFocusHint = (params as any)?._vlmFocusHint as string | undefined;
    if (vlmZoomMultiplier || vlmFocusHint) {
      console.log(`[viz:${recipe}] VLM hints: zoomMultiplier=${vlmZoomMultiplier ?? 'none'}, focusHint=${vlmFocusHint ?? 'none'}`);
    }

    // Helper to apply a representation preset (cartoon, surface, etc.)
    // R89: Only apply if the current representation is different —
    // re-applying the same preset can cause a brief structure removal.
    const applyPreset = async (preset: string) => {
      const structs = getStructures(plugin);
      if (structs.length === 0) return;
      try {
        const components = collectComponents(plugin, structs);
        if (components.length > 0) {
          const currentTypes = components.map((c: any) =>
            c?.cell?.transform?.params?.type ||
            c?.cell?.obj?.data?.type ||
            c?.cell?.obj?.label?.toLowerCase() || ''
          );
          const presetLower = preset.toLowerCase();
          const alreadyApplied = currentTypes.some((t: string) =>
            t.includes(presetLower) || (presetLower === 'cartoon' && t.includes('cartoon')) ||
            (presetLower === 'surface' && t.includes('surface')) ||
            (presetLower === 'putty' && t.includes('putty')) ||
            (presetLower === 'ball-and-stick' && t.includes('ball'))
          );
          if (alreadyApplied) return;
        }
      } catch (err) { console.warn('[applyPreset] representation check failed, falling through:', err); }
      await plugin.managers.structure.component.applyPreset(structs, preset);
      await nextFrame();
      await nextFrame();
    };

    // Helper to apply a color theme
    const applyColorTheme = async (theme: string) => {
      const structs = getStructures(plugin);
      const components = collectComponents(plugin, structs);
      if (components.length === 0) return;
      const normalized = normalizeColorTheme(theme);
      if (normalized) {
        plugin.managers.structure.component.updateRepresentationsTheme(
          components,
          { color: normalized }
        );
      } else {
        console.warn(`[applyColorTheme] unknown theme "${theme}" — skipping`);
      }
    };

    switch (recipe) {
      case "binding_pocket":
      case "ligand_interactions": {
        const ligandCompId = params?.ligandCompId as string | undefined;
        if (ligandCompId) {
          await safe(async () => {
            const loci = await lociFromResidue(viewer, { compId: ligandCompId });
            if (loci) plugin.managers.camera.focusLoci(loci, { minRadius: 15 });
          }, "focus_ligand");
        } else {
          await safe(async () => {
            const data = getFirstStructureData(plugin);
            if (!data) return;
            const Q = (viewer as any)?.Q ?? (window as any).molstar?.lib?.molscript;
            if (Q) {
              const expr = Q.struct.generator.atomGroups({
                'chain-test': Q.core.logic.in([Q.struct.atomProperty.macromolecular.entityType(), 'non-polymer'])
              });
              const loci = await plugin.managers.structure.selection.getLociFromExpression(expr, data);
              if (loci && !isLociEmpty(loci)) {
                plugin.managers.camera.focusLoci(loci, { minRadius: 15 });
              }
            }
          }, "focus_all_ligands");
        }
        await safe(async () => { await applyColorTheme("chain-id"); }, "color_chain");
        break;
      }

      case "all_interactions":
      case "hbonds":
      case "salt_bridges":
      case "hydrophobic_contacts":
      case "interface_residues":
      case "oligomer_analysis": {
          // R157: Clean up ALL previous visualization artifacts before applying new one.
        // This prevents label/line/sidechain/water/ligand accumulation across analyses.
        await safe(async () => {
          // Clear all measurements (distance lines, labels)
          try { plugin.managers.structure.measurement.clear(); } catch (err) { console.warn('[viz:cleanup] measurement.clear failed:', err); }
          // R157: Clear selection and highlights (removes green selection box)
          try { plugin.managers.structure.selection.clear(); } catch (err) { console.warn('[viz:cleanup] selection.clear failed:', err); }
          try { plugin.managers.interactivity.lociSelects.clearHighlights(); } catch (err) { /* best-effort */ }
          try { plugin.managers.interactivity.lociHighlights.clearHighlights(); } catch (err) { /* best-effort */ }
          // Remove previous components (sidechains, water, ligand, and ANY ball-and-stick)
          const structs = getStructures(plugin);
          let removedCount = 0;
          for (const s of structs) {
            const toRemove: any[] = [];
            for (const c of (s.components ?? [])) {
              const tags = c?.cell?.transform?.tags;
              const label = c?.cell?.obj?.label;
              // R159: Remove ALL components that have our tags OR are named Water/Ligand
              // Also remove components with keyTag prefix 'structure-component-'
              // that are sidechain/water/ligand related
              const hasTag = Array.isArray(tags) && (
                tags.includes('interface-sidechain') ||
                tags.includes('water-hide') ||
                tags.includes('ligand-hide') ||
                tags.some((t: string) => t.startsWith('structure-component-sidechain') ||
                         t.startsWith('structure-component-Water') ||
                         t.startsWith('structure-component-Ligand') ||
                         t.startsWith('structure-component-interface-sidechains'))
              );
              const hasLabel = label && (
                label.includes("Interface ") ||
                label.includes("sidechain") ||
                label === "Water" ||
                label === "Ligand"
              );
              if (hasTag || hasLabel) {
                toRemove.push(c);
              }
            }
            for (const c of toRemove) {
              try { plugin.managers.structure.component.remove(c); removedCount++; } catch (err) { console.warn('[viz:cleanup] remove failed:', err); }
            }
          }
          console.log(`[viz:cleanup] Removed ${removedCount} previous components`);
        }, "cleanup_previous");

        // R156: Hide water AND ligand using tryCreateComponentStatic
        // R155 used buildResidueLoci which was unreliable — the loci/expression
        // might not match correctly. tryCreateComponentStatic uses Molstar's
        // internal Queries.internal.water() and StructureSelectionQueries.ligand
        // which are the official, tested ways to select water/ligand.
        await safe(async () => {
          const structs = getStructures(plugin);
          if (structs.length === 0) return;
          const sr = structs[0];

          // Hide water using static component type 'water'
          try {
            const waterComponent = await plugin.builders.structure.tryCreateComponentStatic(
              sr.cell, 'water', { label: 'Water', tags: ['water-hide'] }
            );
            if (waterComponent) {
              plugin.managers.structure.hierarchy.toggleVisibility([waterComponent], 'hide');
              console.log('[viz:hide] Hidden water (static)');
            }
          } catch (err) { console.warn('[viz:hide] water failed:', err); }

          // Hide ligand using static component type 'ligand'
          try {
            const ligandComponent = await plugin.builders.structure.tryCreateComponentStatic(
              sr.cell, 'ligand', { label: 'Ligand', tags: ['ligand-hide'] }
            );
            if (ligandComponent) {
              plugin.managers.structure.hierarchy.toggleVisibility([ligandComponent], 'hide');
              console.log('[viz:hide] Hidden ligand (static)');
            }
          } catch (err) { console.warn('[viz:hide] ligand failed:', err); }
        }, "hide_non_polymer");

        await safe(async () => {
          let interactions = params?.interactions as Array<Record<string, unknown>> | undefined;
          const chain1 = params?.chain1 as string | undefined;
          const chain2 = params?.chain2 as string | undefined;
          // R132: Normalize interface_residues data format
          if (!Array.isArray(interactions) || interactions.length === 0) {
            const c1Res = params ? (params as any).chain1_interface_residues as Array<Record<string, unknown>> : undefined;
            const c2Res = params ? (params as any).chain2_interface_residues as Array<Record<string, unknown>> : undefined;
            if (Array.isArray(c1Res) && Array.isArray(c2Res)) {
              interactions = [];
              for (const r of c1Res) {
                if (r.contacts && Array.isArray(r.contacts)) {
                  for (const c of r.contacts) {
                    interactions.push({
                      chain1: chain1, resno1: r.resno, resname1: r.name,
                      chain2: c.to_chain, resno2: c.to_res, resname2: c.to_name,
                      atom1: c.atom, atom2: undefined,
                    });
                  }
                }
              }
              console.log(`[viz] Converted interface_residues data: ${interactions.length} interactions`);
            }
          }

          if (chain1 && chain2 && Array.isArray(interactions) && interactions.length > 0) {
            const residueSet = new Set<string>();
            const residueList: Array<{ chain: string; resno: number }> = [];
            for (const c of interactions) {
              const ch1 = c.chain1 as string;
              const rn1 = c.resno1 as number;
              const ch2 = c.chain2 as string;
              const rn2 = c.resno2 as number;
              if (ch1 && rn1) {
                const key = `${ch1}:${rn1}`;
                if (!residueSet.has(key)) {
                  residueSet.add(key);
                  residueList.push({ chain: ch1, resno: rn1 });
                }
              }
              if (ch2 && rn2) {
                const key = `${ch2}:${rn2}`;
                if (!residueSet.has(key)) {
                  residueSet.add(key);
                  residueList.push({ chain: ch2, resno: rn2 });
                }
              }
            }

            console.log(`[viz:focus] ${residueList.length} interface residues for ${chain1}-${chain2}`);

            if (residueList.length > 0) {
              // R158: Use buildResidueLoci to get loci, then focusLoci (official API)
              // This avoids selection.add() (green box) and getBoundary issues.
              const focusRefs = residueList.map(r => ({ chain: r.chain, resno: r.resno }));
              const focusResult = buildResidueLoci(plugin, focusRefs);

              if (focusResult && focusResult.loci) {
                // R158: Use focusLoci — Molstar's official API for focusing a loci.
                // It computes the bounding sphere internally and animates the camera.
                // R151: Use minRadius for wider view + VLM zoom multiplier
                const baseMinRadius = 25 + 15; // R151: wider view
                const minRadius = vlmZoomMultiplier ? baseMinRadius * vlmZoomMultiplier : baseMinRadius;
                plugin.managers.camera.focusLoci(focusResult.loci, { minRadius });
                console.log(`[viz:focus] focusLoci called with minRadius=${minRadius}`);
                await new Promise(r => setTimeout(r, 500)); // R158: wait for camera animation
              } else {
                console.warn('[viz:focus] buildResidueLoci returned null, falling back to camera.reset');
                plugin.managers.camera.reset();
                await new Promise(r => setTimeout(r, 200));
              }
            }
          } else if (chain1 && chain2) {
            plugin.managers.camera.reset();
            await new Promise(r => setTimeout(r, 100));
          }
        }, "focus_interface");

        await safe(async () => {
          let interactions = params?.interactions as Array<Record<string, unknown>> | undefined;
          if (!Array.isArray(interactions) || interactions.length === 0) {
            const c1Res = params ? (params as any).chain1_interface_residues as Array<Record<string, unknown>> : undefined;
            const c2Res = params ? (params as any).chain2_interface_residues as Array<Record<string, unknown>> : undefined;
            if (Array.isArray(c1Res) && Array.isArray(c2Res)) {
              interactions = [];
              for (const r of [...c1Res, ...c2Res]) {
                interactions.push({ chain1: r.resno ? chain1 : chain2, resno1: r.resno, chain2: chain2, resno2: r.resno });
              }
            }
          }
          if (!Array.isArray(interactions) || interactions.length === 0) return;

          const structs = getStructures(plugin);
          if (structs.length === 0) return;
          const sr = structs[0];
          const data = sr?.cell?.obj?.data;
          if (!data) return;

          // R152: Collect ALL interface residues for side chain display
          const residueSet = new Set<string>();
          for (const c of interactions) {
            const ch1 = c.chain1 as string;
            const rn1 = c.resno1 as number;
            const ch2 = c.chain2 as string;
            const rn2 = c.resno2 as number;
            if (ch1 && rn1) residueSet.add(`${ch1}:${rn1}`);
            if (ch2 && rn2) residueSet.add(`${ch2}:${rn2}`);
          }

          if (residueSet.size === 0) return;

          const residueList = Array.from(residueSet);
          console.log(`[viz:show_sidechains] Showing ${residueList.length} interface residue side chains`);

          // R154: Use buildResidueLoci (StructureElement-based, NOT MolScript Q)
          // to build loci for ALL interface residues at once, then create a
          // single component with ball-and-stick representation.
          const refs = residueList.slice(0, 30).map(key => {
            const [chain, resnoStr] = key.split(":");
            return { chain, resno: parseInt(resnoStr, 10) };
          });

          const result = buildResidueLoci(plugin, refs);
          if (result) {
            const structs = getStructures(plugin);
            const sr = structs[0];
            const tag = `interface-sidechains-${Date.now()}`;
            const component = await plugin.builders.structure.tryCreateComponentFromExpression(
              sr.cell, result.expr, tag, { tags: ['interface-sidechain'] }
            );
            if (component) {
              // R157: Even smaller ball-and-stick for clean side chain display
              await plugin.builders.structure.representation.addRepresentation(component, {
                type: "ball-and-stick",
                typeParams: {
                  sizeFactor: 0.2,       // R157: much smaller balls (was 0.3)
                  bondScale: 0.15,       // R157: much thinner bonds (was 0.25)
                  bondSpacing: 0.05,
                  aromaticBonds: true,
                  multipleBonds: true,
                  ignoreHydrogens: true,
                },
                colorTheme: { name: "element-symbol", params: {} },
              });
              console.log(`[viz:show_sidechains] Created ball-and-stick component for ${refs.length} residues`);
            } else {
              console.warn('[viz:show_sidechains] tryCreateComponentFromExpression returned undefined');
            }
          } else {
            console.warn('[viz:show_sidechains] buildResidueLoci returned null — no matching residues found');
          }
        }, "show_sidechains");

        await safe(async () => {
          let interactions = params?.interactions as Array<Record<string, unknown>> | undefined;
          if (!Array.isArray(interactions) || interactions.length === 0) return;

          // R148: ONLY draw distance lines for H-bonds and salt bridges
          const hbondInteractions = interactions.filter(c => {
            const type = (c.type as string | undefined)?.toLowerCase() ?? '';
            const hasAtoms = c.atom1 && c.atom2;
            return (type === 'hbond' || type === 'salt_bridge' || type === 'salt-bridge') && hasAtoms;
          });

          console.log(`[viz:draw_lines] Drawing ${hbondInteractions.length} distance lines`);

          // R154: Use buildResidueLoci for atom-level loci (NOT MolScript Q)
          for (const c of hbondInteractions) {
            try {
              const chain1 = c.chain1 as string;
              const resno1 = c.resno1 as number;
              const atom1 = c.atom1 as string;
              const chain2 = c.chain2 as string;
              const resno2 = c.resno2 as number;
              const atom2 = c.atom2 as string;

              // Build atom-level loci for each interacting atom
              const result1 = buildResidueLoci(plugin, [{ chain: chain1, resno: resno1, atomName: atom1 }]);
              const result2 = buildResidueLoci(plugin, [{ chain: chain2, resno: resno2, atomName: atom2 }]);

              if (result1 && result2) {
                await plugin.managers.structure.measurement.addDistance(result1.loci, result2.loci);
                console.log(`[viz:draw_lines] Added: ${chain1}:${resno1}(${atom1}) — ${chain2}:${resno2}(${atom2})`);
              } else {
                console.warn(`[viz:draw_lines] Atoms not found: ${chain1}:${resno1}(${atom1}) or ${chain2}:${resno2}(${atom2})`);
              }
            } catch (err) { console.warn(`[viz:draw_lines] failed:`, err); }
          }
        }, "draw_interaction_lines");

        await safe(async () => { await applyColorTheme("chain-id"); }, "color_chain");
        break;
      }

      case "druggability": {
        const ligandCompId = params?.ligandCompId as string | undefined;
        if (ligandCompId) {
          await safe(async () => {
            const loci = await lociFromResidue(viewer, { compId: ligandCompId });
            if (loci) plugin.managers.camera.focusLoci(loci, { minRadius: 18 });
          }, "focus_druggable_pocket");
        }
        await safe(async () => { await applyColorTheme("hydrophobicity"); }, "color_hydrophobicity");
        break;
      }

      case "virtual_screening":
      case "druglike_screening": {
        const ligandCompId = params?.ligandCompId as string | undefined;
        if (ligandCompId) {
          await safe(async () => {
            const loci = await lociFromResidue(viewer, { compId: ligandCompId });
            if (loci) plugin.managers.camera.focusLoci(loci, { minRadius: 16 });
          }, "focus_screening_pocket");
        }
        await safe(async () => { await applyColorTheme("element-symbol"); }, "color_element");
        break;
      }

      case "disulfide_bonds":
      case "metal_coordination":
      case "aromatic_stacking":
      case "water_bridges": {
        await safe(async () => {
          const data = getFirstStructureData(plugin);
          if (!data) return;
          const structs = getStructures(plugin);
          if (structs.length > 0 && structs[0].components) {
            for (const c of structs[0].components) {
              const tags = c?.cell?.transform?.tags;
              if (Array.isArray(tags) && tags.includes("structure-component-static-chain")) {
                const loci = c.cell?.obj?.data?.sourceSelection?.loci;
                if (loci && !isLociEmpty(loci)) {
                  plugin.managers.camera.focusLoci(loci, { minRadius: 20 });
                  return;
                }
              }
            }
          }
        }, "focus_chain_for_special_bonds");
        await safe(async () => { await applyColorTheme("element-symbol"); }, "color_element");
        break;
      }

      case "sasa":
      case "surface_residues": {
        await safe(async () => { await applyColorTheme("hydrophobicity"); }, "color_hydrophobicity");
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_surface");
        break;
      }

      case "electrostatic":
      case "apbs_electrostatic": {
        await safe(async () => { await applyColorTheme("partial-charge"); }, "color_charge");
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_electrostatic");
        break;
      }

      case "bfactor_stats": {
        await safe(async () => { await applyColorTheme("uncertainty"); }, "color_bfactor");
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_bfactor");
        break;
      }

      case "secondary_structure_simple": {
        await safe(async () => { await applyColorTheme("secondary-structure"); }, "color_ss");
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_ss");
        break;
      }

      case "rmsd":
      case "conformational_changes":
      case "per_residue_rmsd_two": {
        await safe(async () => { await applyColorTheme("uncertainty"); }, "color_rmsd");
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_rmsd");
        break;
      }

      case "detect_pockets": {
        await safe(async () => { await applyColorTheme("chain-id"); }, "color_chain");
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_pocket_detection");
        break;
      }

      case "summary": {
        await safe(async () => { await applyColorTheme("sequence-id"); }, "color_spectrum");
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_summary");
        break;
      }

      case "ramachandran": {
        await safe(async () => { await applyColorTheme("secondary-structure"); }, "color_ss_rama");
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_ramachandran");
        break;
      }

      case "contact_map": {
        await safe(async () => { await applyColorTheme("chain-id"); }, "color_chain_cm");
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_contact_map");
        break;
      }

      case "distances":
      case "align_and_superpose":
      case "align_save_transformed":
      case "cross_pdb_rmsd":
      case "cross_pdb_rmsd_aligned": {
        await safe(async () => { await applyColorTheme("chain-id"); }, "color_chain_align");
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_alignment");
        break;
      }

      case "entity_analysis": {
        await safe(async () => { await applyColorTheme("entity-id"); }, "color_entity");
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_entity");
        break;
      }

      case "protonation_states": {
        await safe(async () => { await applyColorTheme("element-symbol"); }, "color_protonation");
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_protonation");
        break;
      }

      case "sequence_align":
      case "sequence_features": {
        await safe(async () => { await applyColorTheme("sequence-id"); }, "color_seq");
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_sequence");
        break;
      }

      case "structure_validation": {
        await safe(async () => { await applyColorTheme("uncertainty"); }, "color_validation");
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_validation");
        break;
      }

      case "blast_chain_id": {
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_for_blast");
        break;
      }

      default: {
        await safe(async () => { plugin.managers.camera.reset(); }, "reset_default");
        break;
      }
    }
  } catch (err) {
    console.warn(`[applyRecipeVisualization:${recipe}] overall error:`, err);
  }
}
