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
            for (const c of interactions.slice(0, 20)) {
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
              try { plugin.managers.structure.selection.clear(); } catch (err) { console.warn('[viz:focus] selection.clear failed:', err); }

              for (const { chain, resno } of residueList) {
                try {
                  const loci = await lociFromResidue(viewer, { chain, resno });
                  if (loci && !isLociEmpty(loci)) {
                    plugin.managers.structure.selection.add(loci);
                  }
                } catch (err) { console.warn(`[viz:focus] lociFromResidue failed for ${chain}:${resno}:`, err); }
              }

              await new Promise(r => setTimeout(r, 150));

              const boundary = plugin.managers.structure.selection.getBoundary();
              if (boundary?.sphere) {
                const center = boundary.sphere.center;
                // R143: Apply VLM zoom multiplier if set (Plan D integration)
                const baseRadius = (boundary.sphere.radius ?? 20) + 5;
                const radius = vlmZoomMultiplier ? baseRadius * vlmZoomMultiplier : baseRadius;
                console.log(`[viz:focus] Center: (${center.x?.toFixed(1)}, ${center.y?.toFixed(1)}, ${center.z?.toFixed(1)}), Radius: ${radius.toFixed(1)} Å${vlmZoomMultiplier ? ` (VLM zoom: ${vlmZoomMultiplier}x)` : ''}`);
                plugin.managers.camera.focusSphere({
                  center: center,
                  radius: radius,
                });
                await new Promise(r => setTimeout(r, 300));
              } else {
                console.warn('[viz:focus] No boundary, using fallback focus');
                const first = residueList[0];
                const loci = await lociFromResidue(viewer, { chain: first.chain, resno: first.resno });
                if (loci) {
                  plugin.managers.camera.focusLoci(loci, { minRadius: 25 });
                  await new Promise(r => setTimeout(r, 300));
                }
              }

              try { plugin.managers.structure.selection.clear(); } catch (err) { console.warn('[viz:focus] post-focus selection.clear failed:', err); }
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
          const data = getFirstStructureData(plugin);
          if (!data) return;

          // R148: Collect ALL interface residues (not just first 20) for side chain display
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

          const Q = (viewer as any)?.Q ?? (window as any).molstar?.lib?.molscript;
          if (!Q) return;

          // R148: Build a SINGLE union expression for all interface residues
          // instead of creating separate components per residue.
          // This is more efficient and ensures all side chains are visible.
          // We use atomGroups with a chain-test OR residue-test for each residue.
          // Since Molstar's union is complex in the prebuilt bundle, we create
          // one component per residue but increase the limit to cover all.
          const residueList = Array.from(residueSet);
          console.log(`[viz:show_sidechains] Showing ${residueList.length} interface residue side chains`);

          for (const key of residueList.slice(0, 30)) { // R148: increased from 10 to 30
            const [chain, resno] = key.split(":");
            try {
              const expr = Q.struct.generator.atomGroups({
                'chain-test': Q.core.rel.eq([Q.struct.atomProperty.macromolecular.auth_asym_id(), chain]),
                'residue-test': Q.core.rel.eq([Q.struct.atomProperty.macromolecular.auth_seq_id(), parseInt(resno, 10)]),
              });
              const loci = await plugin.managers.structure.selection.getLociFromExpression(expr, data);
              if (loci && !isLociEmpty(loci)) {
                const component = await plugin.managers.structure.component.createComponent(data, {
                  loci,
                  label: `Interface ${chain}:${resno}`,
                  tags: ['interface-sidechain', 'structure-component-static-polymer'],
                });
                if (component) {
                  await plugin.managers.structure.component.addRepresentations(
                    component,
                    'ball-and-stick',
                    { sizeFactor: 0.8 }
                  );
                }
              }
            } catch (err) { console.warn(`[viz:show_sidechains] failed for ${chain}:${resno}:`, err); }
          }
        }, "show_sidechains");

        await safe(async () => {
          let interactions = params?.interactions as Array<Record<string, unknown>> | undefined;
          if (!Array.isArray(interactions) || interactions.length === 0) return;

          // R148: ONLY draw distance lines for H-bonds and salt bridges
          // (NOT hydrophobic contacts — those don't have specific atom pairs).
          // Also only draw if both atom1 AND atom2 are specified, so the line
          // connects the actual interacting atoms, not CA carbons.
          const hbondInteractions = interactions.filter(c => {
            const type = (c.type as string | undefined)?.toLowerCase() ?? '';
            const hasAtoms = c.atom1 && c.atom2;
            // Only draw lines for hbonds and salt_bridges with atom-level data
            return (type === 'hbond' || type === 'salt_bridge' || type === 'salt-bridge') && hasAtoms;
          });

          console.log(`[viz:draw_lines] Drawing ${hbondInteractions.length} distance lines (from ${interactions.length} total interactions — only hbonds/salt_bridges with atom data)`);

          for (const c of hbondInteractions) {
            try {
              // R148: Pass atom1/atom2 to lociFromResidue so the distance line
              // connects the SPECIFIC interacting atoms (e.g. NH1-OE1), not CA.
              const r1 = await lociFromResidue(viewer, {
                chain: c.chain1 as string,
                resno: c.resno1 as number,
              }, c.atom1 as string | undefined);
              const r2 = await lociFromResidue(viewer, {
                chain: c.chain2 as string,
                resno: c.resno2 as number,
              }, c.atom2 as string | undefined);
              if (r1 && r2) {
                await plugin.managers.structure.measurement.addDistance(r1, r2);
              }
            } catch (err) { console.warn(`[viz:draw_lines] failed for ${c.chain1}:${c.resno1}(${c.atom1})-${c.chain2}:${c.resno2}(${c.atom2}):`, err); }
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
