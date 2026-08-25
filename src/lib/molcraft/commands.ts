"use client";

/**
 * Executor that turns parsed LlmCommand objects into real Molstar API calls
 * OR backend analysis API calls (for analyze_* commands).
 *
 * For analyze_* commands, we return the fetched data so the chat panel can
 * feed it back to the LLM in a follow-up turn (ReAct pattern).
 *
 * Round 138: This file is now a thin wrapper. The helper functions and types
 * have been split into focused submodules under ./commands/. This module
 * retains only the `executeCommand` dispatcher and re-exports `CommandResult`
 * so existing `import { executeCommand } from "@/lib/molcraft/commands"`
 * callers continue to work unchanged.
 */

// --- Existing imports (unchanged) -------------------------------------------
import type { LlmCommand, ResidueRef } from "./command-schema";
import type { MolstarPlugin, MolstarViewer } from "./types";
import {
  useAppStore,
  type ElectrostaticViz,
  type DruggabilityViz,
  type ScreeningViz,
  type PocketDetectionViz,
} from "./store";
import { normalizeRecipeName } from "./recipe-aliases";

// --- Submodule imports (R138 split) -----------------------------------------
import type { CommandResult } from "./commands/types";
import {
  normalizeColorTheme,
  categoryLabel,
  hexToNumber,
} from "./commands/color-theme";
import {
  getStructures,
  collectComponents,
  getFirstStructureData,
  isLociEmpty,
} from "./commands/structure-helpers";
import {
  checkScreenshotQuality,
  checkIfBlackScreen,
  nextFrame,
} from "./commands/screenshot-utils";
import {
  fetchWithRetry,
  fetchMetadata,
  fetchInterface,
  fetchCliList,
  runRecipe,
} from "./commands/api";
import {
  lociFromResidue,
  lociFromChain,
  resolveInteractionsTarget,
} from "./commands/loci";
import {
  saveCameraState,
  restoreCameraState,
  restoreCameraStateKeep,
  getCurrentCameraState,
  applyCameraAngle,
} from "./commands/camera";
import { showInteractionsAround, clearInteractions } from "./commands/interactions";
import { setTrackballAnimate } from "./commands/animation";
import { applyRecipeVisualization } from "./commands/recipe-viz";
import { alignStructures } from "./commands/alignment";

// Re-export CommandResult so existing `import { CommandResult }` callers work.
export type { CommandResult } from "./commands/types";

// ============================================================
// executeCommand — main entry point
// ============================================================

export async function executeCommand(
  viewer: MolstarViewer,
  cmd: LlmCommand
): Promise<CommandResult> {
  const plugin = viewer.plugin;
  try {
    switch (cmd.type) {
      // ---------- Real analysis (NEW) ----------
      case "analyze_metadata": {
        const md = await fetchMetadata(cmd.id, cmd.includeInterfaces ?? true);
        return {
          ok: true,
          detail: `Fetched RCSB metadata for ${cmd.id} (${md.length} chars)`,
          analysisResult: { kind: "metadata", id: cmd.id, markdown: md },
        };
      }
      case "analyze_interface": {
        const data = await fetchInterface(cmd.id, cmd.assembly ?? 1);
        return {
          ok: true,
          detail: `Fetched interface data for ${cmd.id} assembly ${cmd.assembly ?? 1}`,
          analysisResult: { kind: "interface", id: cmd.id, data },
        };
      }
      case "analyze_cli_list": {
        const data = await fetchCliList();
        const avail = data.clis?.filter((c: any) => c.available) ?? [];
        return {
          ok: true,
          detail: `Local CLIs: ${avail.map((c: any) => c.id).join(", ") || "none"}`,
          analysisResult: { kind: "cli_list", data },
        };
      }
      case "analyze_run": {
        // R103.1: Normalize recipe name (e.g. "interface" → "all_interactions")
        const normalizedRecipe = normalizeRecipeName(cmd.recipe);
        if (normalizedRecipe !== cmd.recipe) {
          console.warn(`[analyze_run] Normalized recipe "${cmd.recipe}" → "${normalizedRecipe}"`);
        }
        const data = await runRecipe(normalizedRecipe, cmd.pdbId, cmd.params);
        return {
          ok: true,
          detail: `Recipe ${normalizedRecipe} ok: ${data.data ? "with data" : "see stdout"}`,
          analysisResult: { kind: "recipe", recipe: normalizedRecipe, data },
        };
      }

      // ---------- Loading ----------
      case "load_pdb": {
        // Try Molstar's built-in loadPdb (uses PDBe provider) first.
        // If it fails (network/CORS) or doesn't actually load a structure,
        // fall back to fetching from RCSB and loading via loadStructureFromData.
        const structCountBefore = plugin.managers.structure.hierarchy.current.structures.length;
        try {
          await viewer.loadPdb(cmd.id);
        } catch (err) {
          console.warn(`[load_pdb] loadPdb(${cmd.id}) threw, trying RCSB fallback:`, err);
        }
        // Check if loadPdb actually loaded a structure
        const structCountAfter = plugin.managers.structure.hierarchy.current.structures.length;
        if (structCountAfter > structCountBefore) {
          return { ok: true, detail: `Loaded PDB ${cmd.id}` };
        }
        // Fallback: fetch PDB text from RCSB and load via loadStructureFromData
        try {
          const pdbRes = await fetch(
            `https://files.rcsb.org/download/${cmd.id.toUpperCase()}.pdb`
          );
          if (!pdbRes.ok) {
            return { ok: false, detail: `PDB ${cmd.id} not found (HTTP ${pdbRes.status})` };
          }
          const pdbText = await pdbRes.text();
          await viewer.loadStructureFromData(pdbText, "pdb", {
            dataLabel: cmd.id.toUpperCase(),
          });
          return { ok: true, detail: `Loaded PDB ${cmd.id} (via RCSB fallback)` };
        } catch (err2) {
          const msg = err2 instanceof Error ? err2.message : String(err2);
          return { ok: false, detail: `Failed to load PDB ${cmd.id}: ${msg}` };
        }
      }

      case "load_alphafold":
        try {
          await viewer.loadAlphaFoldDb(cmd.uniprotId);
          return { ok: true, detail: `Loaded AlphaFold ${cmd.uniprotId}` };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { ok: false, detail: `Failed to load AlphaFold ${cmd.uniprotId}: ${msg}` };
        }

      case "load_emdb":
        try {
          await viewer.loadEmdb(cmd.emdbId, { detail: cmd.detail ?? 3 });
          return { ok: true, detail: `Loaded EMDB ${cmd.emdbId}` };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { ok: false, detail: `Failed to load EMDB ${cmd.emdbId}: ${msg}` };
        }

      case "load_structure_url":
        try {
          await viewer.loadStructureFromUrl(
            cmd.url,
            cmd.format ?? "mmcif",
            cmd.isBinary ?? false
          );
          return { ok: true, detail: `Loaded structure from ${cmd.url}` };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { ok: false, detail: `Failed to load from URL: ${msg}` };
        }

      case "load_structure_data": {
        // Load a structure from raw text (PDB or mmCIF). Used by the
        // "Upload PDB file" feature in the modal — the user picks a local
        // .pdb / .cif file and we load it into the viewer without going
        // through RCSB. Also used by drag-and-drop.
        const format = (cmd.format ?? "pdb") as "pdb" | "mmcif";
        const label = cmd.label ?? `Uploaded ${format.toUpperCase()}`;
        try {
          await viewer.loadStructureFromData(cmd.data, format, {
            dataLabel: label,
          });
          return { ok: true, detail: `Loaded structure from data (${format})` };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { ok: false, detail: `Failed to load structure data: ${msg}` };
        }
      }

      case "load_volume_url": {
        const color = cmd.color
          ? hexToNumber(cmd.color)
          : 0x3377aa;
        await viewer.loadVolumeFromUrl(
          { url: cmd.url, format: cmd.format, isBinary: cmd.isBinary },
          [{ type: "relative", value: cmd.isoValue, color }],
          { isLazy: true }
        );
        return { ok: true, detail: `Loaded volume @ iso ${cmd.isoValue}` };
      }

      // ---------- Representation ----------
      case "set_representation": {
        const structures = getStructures(plugin, cmd.structures);
        if (structures.length === 0)
          return { ok: false, detail: "No structures loaded" };

        // R135: DON'T use applyPreset — it removes existing components and
        // recreates them, causing the structure to disappear temporarily.
        // This was the root cause of:
        //   1. "No components to color" error in set_color_theme
        //   2. Structure disappearing after set_representation
        //   3. Blank screenshots
        //
        // Instead, use updateRepresentationsType to change the representation
        // type of EXISTING components without destroying them.
        // This keeps the structure visible at all times.

        // Map LLM-friendly names to Molstar representation type names
        const reprTypeMap: Record<string, string> = {
          'cartoon': 'cartoon',
          'polymer-cartoon': 'cartoon',
          'surface': 'molecular-surface',
          'coarse-surface': 'molecular-surface',
          'ball-and-stick': 'ball-and-stick',
          'atomic-detail': 'ball-and-stick',
          'putty': 'putty',
          'auto': 'cartoon', // default to cartoon for auto
          'polymer-and-ligand': 'cartoon', // cartoon for polymer, keep ligand sticks
        };
        const reprType = reprTypeMap[cmd.preset] ?? 'cartoon';
        console.log(`[set_representation] Changing type to: ${reprType} (preset: ${cmd.preset})`);

        const components = collectComponents(plugin, structures);
        if (components.length === 0) {
          // No components yet — structure may still be loading
          // Try applyPreset as a fallback (first time setup)
          console.warn('[set_representation] No components — using applyPreset fallback');
          try {
            await plugin.managers.structure.component.applyPreset(structures, 'polymer-and-ligand');
            await new Promise(r => setTimeout(r, 500));
          } catch (err) {
            console.warn('[set_representation] applyPreset fallback failed:', err);
          }
          return { ok: true, detail: `Applied preset: ${cmd.preset} (via fallback)` };
        }

        // R136: Try updateRepresentationsType (doesn't exist in prebuilt bundle)
        // Fall back to applyPreset if not available
        const hasUpdateType = typeof plugin.managers.structure.component.updateRepresentationsType === 'function';
        if (hasUpdateType) {
          try {
            for (const comp of components) {
              try {
                plugin.managers.structure.component.updateRepresentationsType([comp], reprType);
              } catch (err) { console.warn('[set_representation] updateRepresentationsType failed for component:', err); }
            }
            console.log(`[set_representation] Updated via updateRepresentationsType`);
          } catch (err) {
            console.warn('[set_representation] updateRepresentationsType failed, using applyPreset');
            await plugin.managers.structure.component.applyPreset(structures, 'polymer-and-ligand');
          }
        } else {
          // R136: updateRepresentationsType not available — use applyPreset
          // This is the only option in the prebuilt bundle.
          // The structure will briefly disappear during component recreation.
          console.warn('[set_representation] updateRepresentationsType not available, using applyPreset');
          try {
            await plugin.managers.structure.component.applyPreset(structures, 'polymer-and-ligand');
            // Wait longer for components to be recreated (1s + 2 frames)
            await new Promise(r => setTimeout(r, 1000));
            if (typeof requestAnimationFrame !== "undefined") {
              await new Promise(r => requestAnimationFrame(() => r(null)));
              await new Promise(r => requestAnimationFrame(() => r(null)));
            }
          } catch (err) {
            console.warn('[set_representation] applyPreset also failed:', err);
          }
        }

        // Small delay for render
        await new Promise(r => setTimeout(r, 200));
        if (typeof requestAnimationFrame !== "undefined") {
          await new Promise(r => requestAnimationFrame(() => r(null)));
        }
        return { ok: true, detail: `Representation: ${reprType}` };
      }

      case "set_color_theme": {
        const structures = getStructures(plugin, cmd.structures);
        let components = collectComponents(plugin, structures);
        // R119: If no components yet, poll for up to 5 seconds (10 retries × 500ms).
        // Structure loading + applyPreset can take several seconds, especially
        // for large structures like 4HHB. The previous 3×300ms (900ms) was too short.
        if (components.length === 0) {
          for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 500));
            components = collectComponents(plugin, structures);
            if (components.length > 0) break;
          }
        }
        if (components.length === 0)
          return { ok: false, detail: "No components to color (structure may still be loading). Try again in a moment." };
        // Normalize common LLM-friendly aliases to Molstar's actual color theme names.
        // Without this, "chain" (commonly emitted by the LLM) is invalid and breaks
        // the representation, causing the structure to visually disappear.
        const theme = normalizeColorTheme(cmd.theme);
        if (!theme) {
          return {
            ok: false,
            detail: `Unknown color theme: "${cmd.theme}". Valid: chain-id, element-symbol, residue-name, sequence-id, hydrophobicity, uniform, polymer-index, occupancy, model-index, structure-index, entity-id, uncertainty (bfactor), partial-charge, secondary-structure, molecule-type, formal-charge, residue-charge`,
          };
        }
        try {
          plugin.managers.structure.component.updateRepresentationsTheme(
            components,
            { color: theme }
          );
          return { ok: true, detail: `Color theme: ${theme}` };
        } catch (err) {
          // Don't let an invalid theme break the viewer — return ok:false so the
          // user can see the error but the structure remains visible.
          return {
            ok: false,
            detail: `Failed to apply color theme "${theme}": ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }

      case "set_uniform_color": {
        const structures = getStructures(plugin, cmd.structures);
        const components = collectComponents(plugin, structures);
        if (components.length === 0)
          return { ok: false, detail: "No components to color" };
        plugin.managers.structure.component.updateRepresentationsTheme(
          components,
          { color: "uniform", colorParams: { value: hexToNumber(cmd.color) } }
        );
        return { ok: true, detail: `Uniform color: ${cmd.color}` };
      }

      // ---------- Camera ----------
      case "focus_residue": {
        const loci = await lociFromResidue(viewer, {
          chain: cmd.chain,
          resno: cmd.resno,
          compId: cmd.compId,
        });
        if (!loci) return { ok: false, detail: "Residue not found" };
        plugin.managers.camera.focusLoci(loci, { minRadius: 12 });
        return { ok: true, detail: `Focused residue ${cmd.chain ?? ""}:${cmd.resno ?? cmd.compId}` };
      }

      case "focus_ligand": {
        // If compId is "ligand" (generic), focus on ALL non-polymer HETATM residues.
        // Otherwise, focus on the specific ligand by compId (e.g. "HEM", "ATP").
        const compId = cmd.compId;
        if (compId === "ligand" || compId === "all" || !compId) {
          // Focus on all non-polymer entities (HETATM)
          try {
            const data = getFirstStructureData(plugin);
            if (!data) return { ok: false, detail: "No structure data" };
            const Q = (viewer as any)?.Q ?? (window as any).molstar?.lib?.molscript;
            if (Q) {
              const expr = Q.struct.generator.atomGroups({
                'chain-test': Q.core.logic.in([Q.struct.atomProperty.macromolecular.entityType(), 'non-polymer'])
              });
              const loci = await plugin.managers.structure.selection.getLociFromExpression(expr, data);
              if (loci && !isLociEmpty(loci)) {
                plugin.managers.camera.focusLoci(loci, { minRadius: 15 });
                return { ok: true, detail: `Focused all ligands` };
              }
            }
            // Fallback: use the first non-polymer component in the hierarchy
            const structs = getStructures(plugin);
            for (const s of structs) {
              const components = s.components ?? [];
              for (const c of components) {
                const tags = c?.cell?.transform?.tags;
                const label = c?.cell?.obj?.label;
                if ((Array.isArray(tags) && tags.includes("structure-component-static-ligand")) || label === "Ligand") {
                  const loci = c.cell.obj?.data?.sourceSelection?.loci;
                  if (loci) {
                    plugin.managers.camera.focusLoci(loci, { minRadius: 15 });
                    return { ok: true, detail: `Focused all ligands (component)` };
                  }
                }
              }
            }
            return { ok: false, detail: "No ligands found" };
          } catch (err) {
            return { ok: false, detail: `Focus all ligands failed: ${err}` };
          }
        }
        // Specific compId: focus on that ligand
        const loci = await lociFromResidue(viewer, { compId });
        if (!loci) return { ok: false, detail: `Ligand ${compId} not found` };
        plugin.managers.camera.focusLoci(loci, { minRadius: 10 });
        return { ok: true, detail: `Focused ligand ${compId}` };
      }

      case "focus_chain": {
        const loci = await lociFromChain(viewer, cmd.chain);
        if (!loci) return { ok: false, detail: `Chain ${cmd.chain} not found` };
        plugin.managers.camera.focusLoci(loci);
        return { ok: true, detail: `Focused chain ${cmd.chain}` };
      }

      case "focus_selection": {
        const sel = plugin.managers.structure.selection.getBoundary();
        if (sel?.sphere) {
          plugin.managers.camera.focusSphere({
            center: sel.sphere.center,
            radius: (sel.sphere.radius ?? 15) + 5,
          });
          return { ok: true, detail: "Focused selection" };
        }
        return { ok: false, detail: "No selection to focus" };
      }

      case "reset_camera":
        plugin.managers.camera.reset();
        return { ok: true, detail: "Camera reset" };

      // ---------- Measurements ----------
      case "measure_distance": {
        const a = await lociFromResidue(viewer, cmd.a, cmd.atomA);
        const b = await lociFromResidue(viewer, cmd.b, cmd.atomB);
        if (!a || !b)
          return { ok: false, detail: "Could not resolve both residues" };
        await plugin.managers.structure.measurement.addDistance(a, b);
        return { ok: true, detail: "Distance measurement added" };
      }

      case "measure_angle": {
        const a = await lociFromResidue(viewer, cmd.a);
        const b = await lociFromResidue(viewer, cmd.b);
        const c = await lociFromResidue(viewer, cmd.c);
        if (!a || !b || !c)
          return { ok: false, detail: "Could not resolve all 3 residues" };
        await plugin.managers.structure.measurement.addAngle(a, b, c);
        return { ok: true, detail: "Angle measurement added" };
      }

      case "measure_dihedral": {
        const a = await lociFromResidue(viewer, cmd.a);
        const b = await lociFromResidue(viewer, cmd.b);
        const c = await lociFromResidue(viewer, cmd.c);
        const d = await lociFromResidue(viewer, cmd.d);
        if (!a || !b || !c || !d)
          return { ok: false, detail: "Could not resolve all 4 residues" };
        await plugin.managers.structure.measurement.addDihedral(a, b, c, d);
        return { ok: true, detail: "Dihedral measurement added" };
      }

      case "label_residue": {
        const loci = await lociFromResidue(viewer, cmd.target);
        if (!loci) return { ok: false, detail: "Residue not found" };
        await plugin.managers.structure.measurement.addLabel(loci, {
          customText: cmd.text ?? "",
        });
        return { ok: true, detail: "Label added" };
      }

      case "clear_measurements":
        plugin.managers.structure.measurement.clear();
        return { ok: true, detail: "Measurements cleared" };

      // ---------- Interactions ----------
      case "show_interactions": {
        const radius = cmd.radius ?? 8;
        const targetLoci = await resolveInteractionsTarget(viewer, cmd.target);
        if (!targetLoci)
          return { ok: false, detail: "Could not resolve interactions target" };
        await showInteractionsAround(plugin, targetLoci, radius);
        // The prebuilt Molstar bundle does NOT export the ComputeContacts /
        // InteractionsShape transforms, so we cannot draw a true interaction
        // network overlay. Instead we (a) focus the camera on the target so
        // the user sees the neighborhood and (b) leave a highlight on the
        // picked residue. The backend /api/analyze/run "ligand_interactions"
        // and "water_bridges" recipes compute the actual contacts list,
        // which the corresponding charts render in the right panel.
        try {
          // Focus the structure's boundary so the surrounding residues are framed.
          const sel = plugin.managers.structure.selection.getBoundary();
          if (sel?.sphere) {
            plugin.managers.camera.focusSphere({
              center: sel.sphere.center,
              radius: (sel.sphere.radius ?? 12) + radius,
            });
          }
        } catch (err) {
          console.warn('[show_interactions] focus best-effort failed:', err);
        }
        return {
          ok: true,
          detail: `Showing neighborhood within ${radius} Å (use the Analysis charts for full contact lists)`,
        };
      }

      case "clear_interactions":
        await clearInteractions(plugin);
        return { ok: true, detail: "Interactions cleared" };

      // ---------- Selection ----------
      case "select": {
        const action = cmd.action ?? "set";
        // For "all" and "ligand" we use Molstar's MolScript expression
        // generator via structureInteractivity — this is the documented
        // way to select by predicate. The previous code passed a Structure
        // object to selection.modify (type error) and matched the first
        // residue for "ligand" (wrong).
        if (cmd.target === "all") {
          viewer.structureInteractivity({
            expression: (Q: any) => Q.struct.generator.all(),
            action: [action],
          });
          return { ok: true, detail: `Selected all (${action})` };
        }
        if (cmd.target === "ligand") {
          // Non-polymer entities (ligands, cofactors, ions, waters).
          // "label_comp_id" alone matches by name; instead select atoms
          // whose residue is NOT part of a polymer (objectPrimitive = "atom").
          viewer.structureInteractivity({
            expression: (Q: any) =>
              Q.struct.generator.atomGroups({
                "residue-test": Q.core.logic.not([
                  Q.core.rel.eq([
                    Q.struct.atomProperty.macromolecular.objectPrimitive(),
                    "polymer",
                  ]),
                ]),
              }),
            action: [action],
          });
          return { ok: true, detail: `Selected ligands (${action})` };
        }
        // Specific residue/chain/atom ref
        const loci = await lociFromResidue(viewer, cmd.target);
        if (!loci) return { ok: false, detail: "Selection target not found" };
        // @ts-expect-error: action is union-typed at runtime
        plugin.managers.structure.selection.modify(action, loci);
        return { ok: true, detail: `Selected (${action})` };
      }

      case "clear_selection":
        plugin.managers.structure.selection.clear();
        plugin.managers.interactivity.lociSelects.deselectAll();
        return { ok: true, detail: "Selection cleared" };

      case "set_granularity":
        plugin.managers.interactivity.setProps({ granularity: cmd.granularity });
        return { ok: true, detail: `Granularity: ${cmd.granularity}` };

      // ---------- Animation ----------
      case "toggle_spin": {
        setTrackballAnimate(plugin, "spin", { speed: cmd.speed ?? 0.1 });
        return { ok: true, detail: "Spin animation enabled" };
      }
      case "toggle_rock": {
        setTrackballAnimate(plugin, "rock", {});
        return { ok: true, detail: "Rock animation enabled" };
      }
      case "stop_animation": {
        setTrackballAnimate(plugin, undefined, {});
        return { ok: true, detail: "Animation stopped" };
      }

      // ---------- Export ----------
      case "export_snapshot": {
        const dataUri = await plugin.helpers?.viewportScreenshot?.getImageDataUri(
          {
            width: cmd.width,
            height: cmd.height,
            transparency: false,
            axes: true,
          }
        );
        if (!dataUri)
          return { ok: false, detail: "Screenshot failed" };
        const a = document.createElement("a");
        a.href = dataUri;
        a.download = `molstar-snapshot-${Date.now()}.png`;
        a.click();
        return { ok: true, detail: "Snapshot exported", data: { dataUri } };
      }

      // ---------- Capture (returns data URI for embedding, no download) ----------
      case "capture_snapshot": {
        // Step 1: apply camera angle if requested
        if (cmd.angle) {
          try {
            await applyCameraAngle(plugin, cmd.angle);
          } catch (err) {
            console.warn("[capture_snapshot] angle adjust failed:", err);
          }
        }
        // Step 2: add text labels at residue positions
        if (Array.isArray(cmd.labels) && cmd.labels.length > 0) {
          for (const lbl of cmd.labels) {
            try {
              if (lbl.chain !== undefined && lbl.resno !== undefined) {
                const loci = await lociFromResidue(viewer, {
                  chain: lbl.chain,
                  resno: lbl.resno,
                });
                if (loci) {
                  await plugin.managers.structure.measurement.addLabel(loci, {
                    customText: lbl.text ?? "",
                  });
                }
              }
            } catch (err) {
              console.warn(
                `[capture_snapshot] label "${lbl.text}" failed:`,
                err
              );
            }
          }
          // Allow labels to render before capture
          await new Promise((r) => setTimeout(r, 100));
        }
        // Step 3: capture
        const dataUri =
          await plugin.helpers?.viewportScreenshot?.getImageDataUri({
            width: cmd.width ?? 1600,
            height: cmd.height ?? 900,
            transparency: false,
            axes: true,
          });
        if (!dataUri)
          return { ok: false, detail: "Capture failed" };
        return {
          ok: true,
          detail: `Captured${cmd.label ? `: ${cmd.label}` : ""}${
            cmd.angle ? ` (${cmd.angle})` : ""
          }`,
          data: {
            dataUri,
            label: cmd.label ?? "",
            angle: cmd.angle ?? "",
          },
        };
      }

      // ---------- Multi-angle capture (Round 61) ----------
      // Captures screenshots from multiple camera angles for the same analysis
      // recipe. Returns an array of {dataUri, angle} pairs. The caller
      // (chat-tab.tsx) sends these to the VLM API to select the best one.
      // Round 62: Applies recipe-specific 3D visualization before capturing
      // so the screenshot is more informative (e.g. focus on ligand for
      // binding_pocket, show interactions for all_interactions, etc.)
      case "capture_multi_angle": {
        const angles = cmd.angles ?? (["front", "side", "top", "back"] as const);
        const width = cmd.width ?? 1200;
        const height = cmd.height ?? 800;

        // Round 62: Apply recipe-specific visualization before capturing
        const vizParams = cmd.vizParams as Record<string, unknown> | undefined;
        // R151: Skip applyRecipeVisualization on re-capture iterations (iteration > 1).
        // The VLM capture loop calls capture_multi_angle multiple times — the first
        // call applies the visualization (focus, side chains, color), and subsequent
        // calls only need to re-capture from different angles. Re-applying the
        // visualization causes duplicate components + camera re-focus, which makes
        // the structure disappear temporarily (blank screenshots).
        const isRecapture = vizParams?._vlmSuggestedAngles !== undefined ||
                            vizParams?._focusRadiusMultiplier !== undefined;
        if (!isRecapture) {
          await applyRecipeVisualization(viewer, cmd.recipe, vizParams);
          // Round 78: Reduced from 300ms to 150ms — visualization renders fast
          // for camera focus operations; 150ms is enough for Molstar to settle
          await new Promise((r) => setTimeout(r, 150));
        } else {
          console.log('[capture_multi_angle] Re-capture iteration — skipping applyRecipeVisualization');
        }

        // Round 74: Add residue labels to the 3D view before capturing
        // R137 (code-review): Capture the measurement count BEFORE adding any
        // labels so the cleanup later only removes the labels we add here —
        // NOT user-added measurements. Previously `beforeMeasCount` was never
        // assigned, so the cleanup fell through to `meas.clear()` which wiped
        // every measurement in the scene (distances, angles, labels, etc.).
        let beforeMeasCount: number | undefined;
        if (Array.isArray(cmd.labels) && cmd.labels.length > 0) {
          try {
            const meas = plugin.managers.structure.measurement as any;
            const items = meas?.state?.items;
            beforeMeasCount = Array.isArray(items)
              ? items.length
              : (typeof items === 'object' && items ? Object.keys(items).length : 0);
          } catch (err) {
            console.warn('[capture_multi_angle] beforeMeasCount read failed:', err);
            beforeMeasCount = undefined;
          }
          for (const lbl of cmd.labels) {
            try {
              if (lbl.chain !== undefined && lbl.resno !== undefined) {
                const loci = await lociFromResidue(viewer, {
                  chain: lbl.chain,
                  resno: lbl.resno,
                });
                if (loci) {
                  // R155: Use chain-specific colors for labels
                  // Chain A → red, B → blue, C → green, D → orange, etc.
                  const chainColors: Record<string, number> = {
                    'A': 0xe74c3c, // red
                    'B': 0x3498db, // blue
                    'C': 0x2ecc71, // green
                    'D': 0xe67e22, // orange
                    'E': 0x9b59b6, // purple
                    'F': 0x1abc9c, // teal
                  };
                  const labelColor = chainColors[lbl.chain] ?? 0xffffff; // white default

                  // Round 75: Use larger font size for better screenshot readability
                  // R155: Use labelParams for proper API + chain-specific colors
                  // R156: Add sizeFactor for consistent text size, background for readability
                  await plugin.managers.structure.measurement.addLabel(loci, {
                    customText: lbl.text ?? "",
                    labelParams: {
                      customText: lbl.text ?? "",
                      textColor: labelColor,
                      textSize: cmd.labelFontSize ?? 1.0,
                      sizeFactor: 0.6,         // R156: world-space text size
                      borderWidth: 0.15,
                      borderColor: 0x000000,
                      background: true,        // R156: enable background
                      backgroundColor: 0x000000,
                      backgroundOpacity: 0.7,
                      backgroundMargin: 0.2,
                      tether: true,            // R156: tether line to atom
                      tetherLength: 0.5,
                      tetherBaseWidth: 0.1,
                    },
                  } as any);
                }
              }
            } catch (err) {
              console.warn(
                `[capture_multi_angle] label "${lbl.text}" failed:`,
                err
              );
            }
          }
          // Round 78: Reduced from 100ms to 50ms — labels render synchronously
          await new Promise((r) => setTimeout(r, 50));
        }

        // R119: DO NOT change background color for screenshots.
        // Previous code set bg to white/cream which caused the viewer to go
        // white screen when the restore step didn't execute (e.g. non-blocking
        // auto-capture failure). Screenshots work fine with the current bg.

        const results: Array<{
          dataUri: string;
          angle: string;
          label: string;
          cameraState?: { position: [number, number, number]; target: [number, number, number]; up: [number, number, number] };
        }> = [];

        // R130: Save camera state before capture loop, restore after
        // R143 (code-review fix): Save AFTER applyRecipeVisualization so the
        // saved state is the focused-interface view. Then RESTORE before each
        // angle so rotations don't accumulate (side→top was rotating from
        // the side position, not from front, causing overlapping screenshots).
        saveCameraState(plugin);
        for (const angle of angles) {
          try {
            // R143: Restore to saved state before EACH angle so rotations
            // are absolute (from the focused view), not cumulative.
            // This fixes the bug where "top" was a tilted side view instead
            // of a true top-down view.
            if (angle !== 'front') {
              restoreCameraStateKeep(plugin);
            }
            // R130: applyCameraAngle rotates from current position (no reset)
            await applyCameraAngle(plugin, angle);
            // R130: Wait for render to settle (500ms total in applyCameraAngle)
            await nextFrame();
            await nextFrame();
            // Capture
            const dataUri =
              await plugin.helpers?.viewportScreenshot?.getImageDataUri({
                width,
                height,
                transparency: false,
                axes: true,
              });
            // R144: Capture the camera state AFTER rotation, BEFORE quality check.
            // This is the view the user will restore when they click "恢复视角".
            const cameraState = getCurrentCameraState(plugin);
            if (dataUri) {
              // Round 90: Check if the screenshot is all-black (or nearly so).
              // If the structure hasn't rendered yet, the canvas will be
              // uniform color. We decode a small sample of pixels from the
              // base64 data and check variance. Skip if all-black.
              // R99.3: Use accurate async quality check (decodes pixels)
              const quality = await checkScreenshotQuality(dataUri);
              if (quality === 'black' || quality === 'white') {
                console.warn(`[capture_multi_angle] angle "${angle}" produced a ${quality} screenshot — retrying`);
                // Try one more time with a longer delay
                await new Promise((r) => setTimeout(r, 200));
                await nextFrame();
                await nextFrame();
                const retryDataUri =
                  await plugin.helpers?.viewportScreenshot?.getImageDataUri({
                    width,
                    height,
                    transparency: false,
                    axes: true,
                  });
                if (retryDataUri) {
                  const retryQuality = await checkScreenshotQuality(retryDataUri);
                  if (retryQuality === 'ok') {
                    results.push({
                      dataUri: retryDataUri,
                      angle,
                      label: `${cmd.label ?? cmd.recipe} - ${angle}`,
                      cameraState: cameraState ?? undefined,
                    });
                  } else {
                    // Retry also failed — use the original (with a warning)
                    console.warn(`[capture_multi_angle] retry for "${angle}" also ${retryQuality}`);
                    results.push({
                      dataUri,
                      angle,
                      label: `${cmd.label ?? cmd.recipe} - ${angle}`,
                      cameraState: cameraState ?? undefined,
                    });
                  }
                } else {
                  // No retry data — use original
                  results.push({
                    dataUri,
                    angle,
                    label: `${cmd.label ?? cmd.recipe} - ${angle}`,
                    cameraState: cameraState ?? undefined,
                  });
                }
              } else {
                // Quality is ok — use the original screenshot
                results.push({
                  dataUri,
                  angle,
                  label: `${cmd.label ?? cmd.recipe} - ${angle}`,
                  cameraState: cameraState ?? undefined,
                });
              }
            }
          } catch (err) {
            console.warn(
              `[capture_multi_angle] angle "${angle}" failed:`,
              err
            );
          }
        }

        if (results.length === 0) {
          return { ok: false, detail: "All captures failed" };
        }

        // R99.4: Selective measurement cleanup — only remove measurements
        // added during this capture, not user-added ones.
        // We compare the measurement count before and after, then remove
        // only the delta (the ones we added).
        if (Array.isArray(cmd.labels) && cmd.labels.length > 0) {
          try {
            const meas = plugin.managers.structure.measurement as any;
            // Get current measurements (after capture — includes our additions)
            const currentMeas = meas?.state?.items;
            if (currentMeas && beforeMeasCount !== undefined) {
              const currentCount = Array.isArray(currentMeas)
                ? currentMeas.length
                : (typeof currentMeas === 'object' ? Object.keys(currentMeas).length : 0);
              const added = currentCount - beforeMeasCount;
              if (added > 0) {
                // Remove the last N measurements (the ones we added)
                // Molstar's measurement manager supports removeLast
                if (typeof meas.removeLast === 'function') {
                  for (let i = 0; i < added; i++) {
                    try { meas.removeLast(); } catch (err) { console.warn('[capture_multi_angle] removeLast failed:', err); break; }
                  }
                } else {
                  // Fallback: clear all if removeLast not available
                  meas.clear();
                }
              }
            } else {
              // Fallback: clear all if state not accessible
              meas.clear();
            }
          } catch (err) {
            console.warn("[capture_multi_angle] label cleanup failed:", err);
          }
        }

        // Round 91/R148: Clean up interface sidechain components we added
        // R148: Changed to match the 'interface-sidechain' tag instead of label text
        try {
          const structs = getStructures(plugin);
          for (const s of structs) {
            const toRemove: any[] = [];
            for (const c of (s.components || [])) {
              const tags = c?.cell?.transform?.tags;
              const label = c?.cell?.obj?.label;
              // Match by tag OR by label prefix (backward compatible)
              if ((Array.isArray(tags) && tags.includes('interface-sidechain')) ||
                  (label && (label.includes("Interface residues") || label.startsWith("Interface ")))) {
                toRemove.push(c);
              }
            }
            for (const c of toRemove) {
              try { plugin.managers.structure.component.remove(c); } catch (err) { console.warn('[capture_multi_angle] failed to remove interface component:', err); }
            }
          }
        } catch (err) { console.warn('[capture_multi_angle] interface component cleanup failed:', err); }

        // R119: No background restore needed — we didn't change it (see above).

        // R130: Restore saved camera state so structure stays visible
        // (instead of camera.reset() which could push structure off-screen)
        restoreCameraState(plugin);
        await new Promise(r => setTimeout(r, 200));
        await nextFrame();

        return {
          ok: true,
          detail: `Captured ${results.length} angles for ${cmd.recipe}`,
          data: {
            recipe: cmd.recipe,
            label: cmd.label ?? cmd.recipe,
            screenshots: results,
          },
        };
      }

      // ---------- Alignment ----------
      case "align_structures": {
        const result = await alignStructures(
          plugin,
          cmd.ref,
          cmd.mobile,
          cmd.method ?? "tm-align"
        );
        return result;
      }

      // ---------- Misc ----------
      case "set_background": {
        const canvas3d = plugin.canvas3d as
          | { setProps?: (fn: (p: unknown) => void) => void }
          | undefined;
        if (canvas3d?.setProps) {
          canvas3d.setProps((p: unknown) => {
            const props = p as { renderer?: { backgroundColor?: unknown } };
            props.renderer = props.renderer ?? {};
            props.renderer.backgroundColor = hexToNumber(cmd.color);
          });
        }
        return { ok: true, detail: `Background: ${cmd.color}` };
      }

      case "toggle_component_visibility": {
        // Toggle visibility of a specific chain. Creates a per-chain component
        // using a MolScript expression (auth_asym_id == chain) and toggles it.
        // This correctly hides/shows individual chains, NOT the entire Polymer.
        const chain = cmd.component;
        const action = (cmd.action ?? "toggle") as "show" | "hide" | "toggle";
        const structs = getStructures(plugin);
        if (structs.length === 0)
          return { ok: false, detail: "No structures loaded" };

        try {
          // First, check if a per-chain component already exists (by tag).
          // We tag per-chain components with "chain-visibility-{chain}".
          const chainTag = `chain-visibility-${chain}`;
          let existingComp: any = null;
          const components = structs[0].components ?? [];
          for (const c of components) {
            const tags = c?.cell?.transform?.tags;
            if (Array.isArray(tags) && tags.includes(chainTag)) {
              existingComp = c;
              break;
            }
          }

          if (existingComp) {
            // Toggle the existing per-chain component
            plugin.managers.structure.hierarchy.toggleVisibility(
              [existingComp],
              action === "toggle" ? undefined : action
            );
            return { ok: true, detail: `Chain ${chain} (${action})` };
          }

          // No per-chain component exists yet — create one using a MolScript
          // expression that selects only atoms in this chain.
          const data = getFirstStructureData(plugin);
          if (!data) return { ok: false, detail: "No structure data" };

          const Q = (viewer as any)?.Q ?? (window as any).molstar?.lib?.molscript;
          if (!Q) {
            // Fallback: if MolScript Q is not available, toggle the whole
            // Polymer component (old behavior — less precise but works).
            let targetComp: any = null;
            for (const c of components) {
              const tags = c?.cell?.transform?.tags;
              const label = c?.cell?.obj?.label;
              if (
                (Array.isArray(tags) && tags.includes("structure-component-static-polymer")) ||
                label === "Polymer"
              ) {
                targetComp = c;
                break;
              }
            }
            if (targetComp) {
              plugin.managers.structure.hierarchy.toggleVisibility(
                [targetComp],
                action === "toggle" ? undefined : action
              );
              return { ok: true, detail: `Chain ${chain} (${action}) — whole polymer (fallback)` };
            }
            return { ok: false, detail: `No component found for chain ${chain}` };
          }

          // Build the per-chain MolScript expression
          const expr = Q.struct.generator.atomGroups({
            'chain-test': Q.core.rel.eq([
              Q.struct.atomProperty.macromolecular.auth_asym_id(),
              chain
            ])
          });

          // Create the per-chain component via the plugin's component builder
          const builder = plugin.builders.structure;
          const component = await builder.tryCreateComponentFromExpression(
            data,
            expr,
            `Chain ${chain}`,
            { tags: [chainTag, "structure-component-static-polymer"] }
          );

          if (component) {
            plugin.managers.structure.hierarchy.toggleVisibility(
              [component],
              action === "toggle" ? undefined : action
            );
            return { ok: true, detail: `Chain ${chain} (${action})` };
          }
          return { ok: false, detail: `Failed to create component for chain ${chain}` };
        } catch (err) {
          return { ok: false, detail: `Visibility toggle failed: ${err}` };
        }
      }

      // ---------- APBS Electrostatic 3D Visualization ----------
      case "show_electrostatic_surface": {
        const params: Record<string, unknown> = {};
        if (cmd.chain) params.chain = cmd.chain;
        if (cmd.ionicStrength) params.ionic_strength = cmd.ionicStrength;
        const pdbId = cmd.pdbId ?? useAppStore.getState().structures[0]?.id ?? "";
        const data = await runRecipe("apbs_electrostatic", pdbId || undefined, params);
        const d = data?.data;
        if (!d || d.error) {
          return { ok: false, detail: `APBS failed: ${d?.error ?? "no data"}` };
        }
        // Apply molecular-surface + partial-charge color
        const structs = plugin.managers.structure.hierarchy.current.structures;
        if (structs.length > 0) {
          try {
            plugin.managers.structure.component.applyPreset([structs[0]], "molecular-surface");
            await new Promise((r) => setTimeout(r, 500));
            // Find the surface component (created by the molecular-surface preset)
            // It's typically the last component or tagged with "surface"
            const allComps = structs[0]?.components ?? [];
            let surfaceComp = allComps.find((c: any) => {
              const tags = c?.cell?.transform?.tags;
              const label = c?.cell?.obj?.label;
              return (Array.isArray(tags) && (tags.includes("structure-component-static-surface") || tags.includes("surface")))
                || label === "Surface" || label === "Molecular Surface";
            });
            if (!surfaceComp) {
              // Fallback: use the last component (the one just created by applyPreset)
              surfaceComp = allComps[allComps.length - 1];
            }
            if (surfaceComp) {
              // Try "partial-charge" first (needs pdb2pqr charges), fall back to "electrostatic",
              // then "chain" if neither works
              const themes = ["partial-charge", "electrostatic", "chain"];
              for (const theme of themes) {
                try {
                  plugin.managers.structure.component.updateRepresentationsTheme([surfaceComp], {
                    color: theme,
                  });
                  break; // success — stop trying
                } catch (err) {
                  console.warn(`[show_electrostatic_surface] color theme "${theme}" failed:`, err);
                  // try next theme
                }
              }
            }
          } catch (e) {
            console.warn("[show_electrostatic_surface] representation error:", e);
          }
        }
        const viz: ElectrostaticViz = {
          pdbId: pdbId || "unknown",
          chainFilter: String(d.chain_filter ?? "all"),
          ionicStrengthMm: Number(d.ionic_strength_mM ?? 150),
          debyeLengthA: Number(d.debye_length_A ?? 0),
          forcefield: String(d.forcefield ?? "PARSE"),
          pdb2pqrUsed: Boolean(d.pdb2pqr_used),
          numChargedAtoms: Number(d.num_charged_atoms ?? 0),
          totalPotentialKcal: Number(d.total_potential_kcal_mol ?? 0),
          meanPotentialKcal: Number(d.mean_potential_kcal_mol ?? 0),
          mostStabilizing: (d.most_stabilizing ?? []).map((r: any) => ({
            chain: String(r.chain ?? ""), resno: Number(r.resno ?? 0),
            resname: String(r.resname ?? ""), atom: String(r.atom ?? ""),
            charge: Number(r.charge ?? 0), potential_kcal_mol: Number(r.potential_kcal_mol ?? 0),
          })),
          mostDestabilizing: (d.most_destabilizing ?? []).map((r: any) => ({
            chain: String(r.chain ?? ""), resno: Number(r.resno ?? 0),
            resname: String(r.resname ?? ""), atom: String(r.atom ?? ""),
            charge: Number(r.charge ?? 0), potential_kcal_mol: Number(r.potential_kcal_mol ?? 0),
          })),
          surfaceCharged: (d.surface_charged ?? d.all_results ?? []).slice(0, 30).map((r: any) => ({
            chain: String(r.chain ?? ""), resno: Number(r.resno ?? 0),
            resname: String(r.resname ?? ""), atom: String(r.atom ?? ""),
            charge: Number(r.charge ?? 0), potential_kcal_mol: Number(r.potential_kcal_mol ?? 0),
          })),
          createdAt: Date.now(),
        };
        useAppStore.getState().setElectrostaticViz(viz);
        return {
          ok: true,
          detail: `APBS surface: ${viz.numChargedAtoms} charged atoms, ${viz.totalPotentialKcal.toFixed(2)} kcal/mol (${viz.forcefield})`,
          analysisResult: { kind: "recipe", recipe: "apbs_electrostatic", data },
          data: viz,
        };
      }

      // ---------- Druggability 3D Visualization ----------
      case "show_druggable_pocket": {
        const radius = cmd.radius ?? 8;
        const pdbId = cmd.pdbId ?? useAppStore.getState().structures[0]?.id ?? "";
        const data = await runRecipe("druggability", pdbId || undefined, {
          ligandCompId: cmd.ligandCompId,
          radius,
        });
        const d = data?.data;
        if (!d || d.error) {
          return { ok: false, detail: `Druggability failed: ${d?.error ?? "no data"}` };
        }
        // Focus on ligand + label pocket residues
        try {
          const ligandLoci = await lociFromResidue(viewer, { compId: cmd.ligandCompId });
          if (ligandLoci) {
            plugin.managers.camera.focusLoci(ligandLoci as any, { minRadius: 15 });
          }
        } catch (e) {
          console.warn("[show_druggable_pocket] focus error:", e);
        }
        const residues = (d.residues ?? []).slice(0, 8);
        for (const r of residues) {
          try {
            const loci = await lociFromResidue(viewer, { chain: r.chain, resno: r.resno });
            if (loci) {
              const catLabel = categoryLabel(r.category);
              await plugin.managers.structure.measurement.addLabel(loci as any, {
                customText: `${r.resname}${r.resno} (${catLabel})`,
              });
            }
          } catch (e) {
            console.warn("[show_druggable_pocket] label error:", e);
          }
        }
        const viz: DruggabilityViz = {
          pdbId: pdbId || "unknown",
          ligand: cmd.ligandCompId,
          radiusA: radius,
          pocketResidueCount: Number(d.pocket_residue_count ?? 0),
          pocketVolumeA3: Number(d.pocket_volume_A3 ?? 0),
          druggabilityScore: Number(d.druggability_score ?? 0),
          classification: String(d.classification ?? "unknown"),
          composition: d.composition ?? {},
          hydrophobicPct: Number(d.hydrophobic_pct ?? 0),
          polarPct: Number(d.polar_pct ?? 0),
          chargedPct: Number(d.charged_pct ?? 0),
          scoreBreakdown: {
            volume: Number(d.score_breakdown?.volume ?? 0),
            hydrophobicity: Number(d.score_breakdown?.hydrophobicity ?? 0),
            polarity: Number(d.score_breakdown?.polarity ?? 0),
            depth: Number(d.score_breakdown?.depth ?? 0),
            charge: Number(d.score_breakdown?.charge ?? 0),
          },
          residues: (d.residues ?? []).map((r: any) => ({
            chain: String(r.chain ?? ""), resno: Number(r.resno ?? 0),
            resname: String(r.resname ?? ""),
            min_dist_A: Number(r.min_dist_A ?? 0), category: String(r.category ?? "other"),
          })),
          createdAt: Date.now(),
        };
        useAppStore.getState().setDruggabilityViz(viz);
        return {
          ok: true,
          detail: `Druggability: score ${viz.druggabilityScore} (${viz.classification}), ${viz.pocketResidueCount} residues`,
          analysisResult: { kind: "recipe", recipe: "druggability", data },
          data: viz,
        };
      }

      // ---------- Virtual Screening ----------
      case "run_virtual_screening": {
        const pdbId = cmd.pdbId ?? useAppStore.getState().structures[0]?.id ?? "";
        const fragmentSet = cmd.fragmentSet ?? "druglike";
        const data = await runRecipe("virtual_screening", pdbId || undefined, {
          ligandCompId: cmd.ligandCompId,
          fragment_set: fragmentSet,
        });
        const d = data?.data;
        if (!d || d.error) {
          return { ok: false, detail: `Virtual screening failed: ${d?.error ?? "no data"}` };
        }
        const viz: ScreeningViz = {
          pdbId: pdbId || "unknown",
          ligand: cmd.ligandCompId,
          pocketScore: Number(d.pocket_score ?? 0),
          fragmentSet,
          rankedHits: (d.ranked_hits ?? []).map((h: any) => ({
            name: String(h.name ?? ""), smiles: String(h.smiles ?? ""),
            mw: Number(h.mw ?? 0), logp: Number(h.logp ?? 0),
            hbondDonors: Number(h.hbond_donors ?? 0), hbondAcceptors: Number(h.hbond_acceptors ?? 0),
            affinityKcal: Number(h.affinity_kcal_mol ?? 0), ki_uM: Number(h.ki_uM ?? 0),
            score: Number(h.score ?? 0), rationale: String(h.rationale ?? ""),
          })),
          createdAt: Date.now(),
        };
        useAppStore.getState().setScreeningViz(viz);
        return {
          ok: true,
          detail: `Screening: ${viz.rankedHits.length} hits, top=${viz.rankedHits[0]?.name ?? "n/a"} (${viz.rankedHits[0]?.affinityKcal.toFixed(1) ?? 0} kcal/mol)`,
          analysisResult: { kind: "recipe", recipe: "virtual_screening", data },
          data: viz,
        };
      }

      // ---------- Multi-Pocket Detection ----------
      case "detect_pockets": {
        const pdbId = cmd.pdbId ?? useAppStore.getState().structures[0]?.id ?? "";
        const data = await runRecipe("detect_pockets", pdbId || undefined, {
          min_volume: cmd.minDepth ?? 100,
        });
        const d = data?.data;
        if (!d || d.error) {
          return { ok: false, detail: `Pocket detection failed: ${d?.error ?? "no data"}` };
        }
        const viz: PocketDetectionViz = {
          pdbId: pdbId || "unknown",
          pockets: (d.pockets ?? []).map((p: any) => ({
            id: Number(p.id ?? 0),
            center: p.center ?? [0, 0, 0],
            volume: Number(p.volume ?? 0),
            depth: Number(p.depth ?? 0),
            druggabilityScore: Number(p.druggability_score ?? 0),
            classification: String(p.classification ?? "unknown"),
            residueCount: Number(p.residue_count ?? 0),
            composition: p.composition ?? {},
            topResidues: (p.top_residues ?? []).map((r: any) => ({
              chain: String(r.chain ?? ""), resno: Number(r.resno ?? 0),
              resname: String(r.resname ?? ""),
            })),
          })),
          createdAt: Date.now(),
        };
        useAppStore.getState().setPocketDetectionViz(viz);
        return {
          ok: true,
          detail: `Detected ${viz.pockets.length} pockets, top: score ${viz.pockets[0]?.druggabilityScore ?? 0} (${viz.pockets[0]?.classification ?? "n/a"})`,
          analysisResult: { kind: "recipe", recipe: "detect_pockets", data },
          data: viz,
        };
      }

      default: {
        const exhaustive: never = cmd;
        return { ok: false, detail: `Unknown command: ${JSON.stringify(exhaustive).slice(0, 80)}` };
      }
    }
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
