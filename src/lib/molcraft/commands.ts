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
  buildNonPolymerLoci,
} from "./commands/structure-helpers";
import {
  snapshotMeasurementRefs,
  diffMeasurementRefs,
  removeMeasurementCells,
  clearAllMeasurements,
} from "./commands/measurement-utils";
import { restoreHiddenChains, restoreHiddenNonPolymer, __resetVizMeasurementRefs, buildResidueLoci } from "./commands/recipe-viz";
import { getChainColorMap, getChainLabelColor } from "./commands/chain-colors";
import { getLociCenter, getLabelSizeRatios } from "./commands/label-sizing";
import { clearVizTransparency } from "./commands/cartoon-transparency";
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
  restoreCameraStateKeep,
  getCurrentCameraState,
  applyCameraAngle,
  saveUserCameraState,
  restoreUserCameraState,
  __resetCameraState,
} from "./commands/camera";
import { showInteractionsAround, clearInteractions } from "./commands/interactions";
import { setTrackballAnimate } from "./commands/animation";
import {
  agentLabelOptions,
  countAgentLabels,
  removeAgentLabels,
  AGENT_LABEL_TAG,
} from "./commands/label-lifecycle";
import { applyRecipeVisualization } from "./commands/recipe-viz";
import { alignStructures } from "./commands/alignment";
import {
  clearAllSelectionVisuals,
  clearAllSelectionVisualsAndWait,
} from "./commands/selection-utils";

// Re-export CommandResult so existing `import { CommandResult }` callers work.
export type { CommandResult } from "./commands/types";

// ============================================================
// executeCommand — main entry point
// ============================================================

/**
 * R161: capture_multi_angle mutex — serializes screenshot sessions.
 *
 * The auto-capture loop (fired after pdb_analyze) and any explicit
 * capture_multi_angle tool call can otherwise run CONCURRENTLY: they fight
 * over camera state, duplicate labels, and race the measurement-count
 * cleanup, producing duplicated/garbled screenshots. This queue guarantees
 * only one capture session runs at a time.
 */
let captureChain: Promise<unknown> = Promise.resolve();
function enqueueCapture<T>(fn: () => Promise<T>): Promise<T> {
  const run = captureChain.then(fn, fn);
  // Keep the chain alive even if this capture fails.
  captureChain = run.catch(() => undefined);
  return run;
}

/**
 * R164 (MOL-003 / UI-004): Drain the capture queue + reset module state.
 *
 * Called from clearViewerStructures (use-agent-session.ts) BEFORE the
 * structure is removed. Without this:
 * 1. A capture_multi_angle queued behind `enqueueCapture` against the
 *    OLD (now removed) structure would keep running, throwing errors
 *    against undefined component refs.
 * 2. The next session's first capture_multi_angle would call
 *    restoreUserCameraState(plugin) onto a snapshot taken against the
 *    OLD structure's coordinate frame, leaving the camera at a
 *    degenerate angle pointing at empty space.
 *
 * The drain works by:
 *  - Replacing captureChain with a resolved promise so any new
 *    enqueueCapture runs immediately (no waiting on the stale queue).
 *  - The previously-queued task's `fn` callback will still run (it's
 *    already in-flight), but its cleanup branch is best-effort and
 *    tolerates missing components (R143 safe() wrappers).
 *  - Also calls __resetCameraState() to clear savedCameraState +
 *    savedUserCameraState so the next session starts fresh.
 */
export function __drainCaptureQueue(): void {
  // Replace the chain — any prior task already in flight continues,
  // but new enqueueCapture calls won't wait on it.
  captureChain = Promise.resolve();
  // Reset the module-level camera snapshots so the next session's
  // first capture doesn't restore a stale coordinate frame.
  try {
    __resetCameraState();
  } catch (err) {
    console.warn('[__drainCaptureQueue] could not reset camera state:', err);
  }
  // MOL2-08: also reset the recipe-viz measurement-ref tracking — the
  // tracked refs belonged to the removed structure's state tree and
  // would otherwise be re-counted as "leaked" cells by the next
  // session's cleanup_previous (inflated leak logs).
  try {
    __resetVizMeasurementRefs();
  } catch (err) {
    console.warn('[__drainCaptureQueue] could not reset viz measurement refs:', err);
  }
  console.log('[__drainCaptureQueue] capture chain drained + camera state reset');
}

/** R164 (MOL-003 / UI-004): alias matching camera.ts's __resetCameraState name. */
export function __resetCaptureState(): void {
  __drainCaptureQueue();
}

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
            // R167 (MOL-M3): `selection.getLociFromExpression` does NOT exist
            // in the prebuilt bundle — the old MolScript-expression call threw
            // a TypeError into this catch block, so the component-scan below
            // was unreachable and focus_ligand always failed with a raw
            // "TypeError" message. Order is now: (1) component-scan (bundle-
            // safe), (2) non-polymer unit traversal (bundle-safe).
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
            const nonPolymerLoci = buildNonPolymerLoci(plugin);
            if (nonPolymerLoci && !isLociEmpty(nonPolymerLoci)) {
              plugin.managers.camera.focusLoci(nonPolymerLoci, { minRadius: 15 });
              return { ok: true, detail: `Focused all ligands (non-polymer traversal)` };
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
        // R173: LLM-added labels used the bundle's DEFAULT placement
        // (middle-center, NO tether, offsetZ 0) — the text rendered AT the
        // residue center, depth-tested against the cartoon, half-buried.
        // As the camera rotated, different glyph parts got occluded, which
        // reads as "label 偏移 / 没有重新定位". Use the R170 floating
        // placement (tether + offsetZ + background) + the agent tag so the
        // toolbar show/hide toggle covers these labels too.
        const slot = countAgentLabels(plugin);
        await plugin.managers.structure.measurement.addLabel(loci, {
          ...agentLabelOptions({ text: cmd.text ?? "", slot }),
        } as any);
        return { ok: true, detail: "Label added" };
      }

      // R173: re-add (and persist) the analysis residue labels after a
      // capture pipeline has cleaned them up — called by the agent-session
      // auto-capture flow when it finishes, so the user keeps an annotated
      // view they can freely rotate and toggle from the toolbar.
      case "show_analysis_labels": {
        const labels = cmd.labels ?? [];
        if (labels.length === 0) return { ok: false, detail: "No labels provided" };
        // Replace any previous agent labels (this is the single source of
        // truth for what the post-analysis view shows).
        await removeAgentLabels(plugin);
        const chainColorMap = getChainColorMap(plugin);
        let added = 0;
        let slot = 0;
        for (const lbl of labels) {
          try {
            if (lbl.chain === undefined || lbl.resno === undefined) continue;
            let loci: unknown = null;
            const singleResult = buildResidueLoci(plugin, [{ chain: lbl.chain, resno: lbl.resno }]);
            if (singleResult) loci = singleResult.loci;
            if (!loci) loci = await lociFromResidue(viewer, { chain: lbl.chain, resno: lbl.resno });
            if (!loci) continue;
            const color = getChainLabelColor(plugin, lbl.chain, chainColorMap);
            await plugin.managers.structure.measurement.addLabel(loci, {
              ...agentLabelOptions({ text: lbl.text ?? "", color, slot: slot++, fontSize: cmd.labelFontSize ?? 0.55 }),
            } as any);
            added++;
          } catch (err) {
            console.warn(`[show_analysis_labels] label "${lbl.text}" failed:`, err);
          }
        }
        // R173: force a redraw so the freshly persisted labels render
        // immediately (the animation loop covers this in normal browsers;
        // the explicit draw makes throttled/background tabs reliable too).
        try {
          plugin.canvas3d?.requestDraw?.();
        } catch {
          /* ignore */
        }
        return { ok: added > 0, detail: `Persisted ${added}/${labels.length} residue labels (toggle with the Labels toolbar button)` };
      }

      case "clear_measurements":
        // R170: `measurement.clear()` does not exist on the prebuilt bundle —
        // use the state-tree group deletion instead (was a silent no-op).
        await clearAllMeasurements(plugin);
        return { ok: true, detail: "Measurements cleared" };

      // ---------- Interactions ----------
      case "show_interactions": {
        const radius = cmd.radius ?? 8;
        const targetLoci = await resolveInteractionsTarget(viewer, cmd.target);
        if (!targetLoci)
          return { ok: false, detail: "Could not resolve interactions target" };
        // MOL2-04: showInteractionsAround now returns whether the neighborhood
        // component was actually created — the old ok:true "Showing neighborhood
        // within X Å" was reported even though the MolScript `within` query is
        // unavailable on the prebuilt bundle and NOTHING was ever created.
        const neighborhoodCreated = await showInteractionsAround(plugin, targetLoci, radius);
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
        if (!neighborhoodCreated) {
          return {
            ok: false,
            detail: `Could not create the ${radius} Å neighborhood view (no atoms found near the target, or the spatial lookup is unavailable) — use the Analysis charts for contact lists`,
          };
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
        // R161: deselectAll() actually clears the green canvas marks.
        clearAllSelectionVisuals(plugin);
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
          let slot = countAgentLabels(plugin);
          for (const lbl of cmd.labels) {
            try {
              if (lbl.chain !== undefined && lbl.resno !== undefined) {
                const loci = await lociFromResidue(viewer, {
                  chain: lbl.chain,
                  resno: lbl.resno,
                });
                if (loci) {
                  // R173: floating placement + agent tag (see label_residue —
                  // the old flat/default placement rendered half-buried,
                  // depth-occluded text that looked detached while rotating).
                  await plugin.managers.structure.measurement.addLabel(loci, {
                    ...agentLabelOptions({ text: lbl.text ?? "", slot: slot++ }),
                  } as any);
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
      // R161: Serialized through enqueueCapture to prevent concurrent capture
      // sessions (auto-capture + explicit capture) from racing each other.
      case "capture_multi_angle":
        return await enqueueCapture(() => executeMultiAngleCapture(viewer, cmd));


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
            // R170: the prebuilt bundle does NOT expose `lib.molscript`
            // (verified: lib = structure/volume/shape/loci/math/plugin/
            // extensions) — this fallback path ALWAYS ran, and the old
            // "toggle the whole Polymer" behavior hid/showed EVERY chain at
            // once instead of the requested one. Use the bundle-verified
            // loci-based chain visibility instead (same mechanism as the
            // pairwise per-pair view): hide the polymer + create cartoon
            // stand-ins for every chain that should stay visible.
            const { hideOtherChains, restoreHiddenChains, collectChainIds } =
              await import('./commands/recipe-viz');
            if (action === "show") {
              // Restore the full (unfiltered) view — approximation of
              // "show chain X" when the per-chain state isn't tracked.
              await restoreHiddenChains(plugin);
              return { ok: true, detail: `Chain ${chain} (show — full view restored)` };
            }
            if (action === "toggle") {
              // No tracked per-chain state on this path — treat toggle as
              // hide (the common agent intent: "focus on the rest").
              console.warn('[toggle_component_visibility] toggle → hide (per-chain state untracked on the fallback path)');
            }
            const all = collectChainIds(plugin);
            const keep = all.filter((c) => c !== chain);
            if (keep.length === 0) {
              return { ok: false, detail: `Cannot hide the only chain (${chain})` };
            }
            await hideOtherChains(plugin, keep, true);
            return { ok: true, detail: `Chain ${chain} hidden (${keep.join(", ")} visible)` };
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
              // R167 (MOL-M5): labelParams wrapper — see label_residue.
              await plugin.managers.structure.measurement.addLabel(loci as any, {
                labelParams: { customText: `${r.resname}${r.resno} (${catLabel})` },
              } as any);
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
          min_volume: cmd.minVolume ?? 100, // R169 (MOL-L3): was cmd.minDepth — schema field now matches the semantic (volume, Å³)
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


// ============================================================
// R161: executeMultiAngleCapture — the capture_multi_angle body, extracted
// from the executeCommand switch so it can be serialized through the
// enqueueCapture mutex (prevents auto-capture + explicit capture races).
// ============================================================

async function executeMultiAngleCapture(
  viewer: MolstarViewer,
  cmd: Extract<LlmCommand, { type: "capture_multi_angle" }>
): Promise<CommandResult> {
  const plugin = viewer.plugin;
  const angles = cmd.angles ?? (["front", "side", "top", "back"] as const);
  const width = cmd.width ?? 1200;
  const height = cmd.height ?? 800;

  // Round 62: Apply recipe-specific visualization before capturing
  const vizParams = cmd.vizParams as Record<string, unknown> | undefined;
  // R170: the R151 `isRecapture` skip was REMOVED — see the comment at the
  // applyRecipeVisualization call below for why every capture (including
  // VLM-recapture iterations) now re-applies the visualization.

  // R163: Snapshot the USER's current camera BEFORE the recipe visualization
  // focuses the interface. Restored at the very end so the user's view is not
  // left locked at the analysis-focused position after the LLM analysis.
  // (On VLM-recapture iterations the camera is already back at the user view
  // restored by the previous iteration, so re-saving is still correct.)
  saveUserCameraState(plugin);

  // R137→R167 (MOL-M4): measurement refs BEFORE any visualization/label is
  // added, so the cleanup later removes exactly what THIS capture added —
  // never user-added measurements. The old count-delta + removeLast strategy
  // silently degraded to meas.clear() because `removeLast` does not exist on
  // the prebuilt bundle's MeasurementManager (its only occurrence in
  // molstar.js is an internal linked-list method), wiping USER measurements.
  // Ref-based deletion also covers the recipe-viz draw_interaction_lines
  // distances, which the old count-based approach (snapshot AFTER
  // applyRecipeVisualization) missed entirely.
  // Null = state shape unexpected → legacy clear() fallback.
  const measBeforeRefs = snapshotMeasurementRefs(plugin);
  // R164 (MOL-004): set to true once the visualization/label-adding pass has
  // actually started. The finally-cleanup only touches measurements when we
  // know we may have added some — otherwise an early throw (before any label
  // was added) would meas.clear() the USER's own measurements.
  let labelsAdded = false;

  // R164 (MOL-004): ALL capture cleanup, extracted into a local function so
  // it can run from a finally block. Previously this logic only executed on
  // the happy path — any mid-capture throw (applyRecipeVisualization
  // internals, dynamic-import failure, render errors) skipped it entirely
  // and leaked labels, interface components and the camera lock into every
  // subsequent operation. Every step is individually guarded: a failing
  // cleanup step must neither mask the original capture error nor abort the
  // remaining cleanup steps.
  const cleanupCapture = async (): Promise<void> => {
    // Step 1 — R167 (MOL-M4): selective measurement cleanup by state-cell
    // refs. Only the measurement cells added during THIS capture (viz
    // distances + residue labels) are deleted; user measurements survive.
    try {
      if (labelsAdded) {
        const measAfterRefs = snapshotMeasurementRefs(plugin);
        if (measAfterRefs !== null && measBeforeRefs !== null) {
          const delta = diffMeasurementRefs(measBeforeRefs, measAfterRefs);
          if (delta.length > 0) {
            const removed = await removeMeasurementCells(plugin, delta);
            console.log(`[capture_multi_angle] removed ${removed}/${delta.length} capture-added measurement cells`);
          }
        } else {
          // R170: `measurement.clear()` does NOT exist on the prebuilt
          // bundle's MeasurementManager (TypeError, silently swallowed for
          // months). The bundle-safe equivalent deletes the whole
          // 'measurement-group' subtree. Conservative: only reached when the
          // ref snapshot shape is unexpected.
          await clearAllMeasurements(plugin);
        }
        // MOL2-08: the viz-added measurement refs (draw_interaction_lines /
        // draw_pair_labels in recipe-viz) are part of the delta just removed
        // (or of the cleared measurement group) — reset the tracking list so
        // the NEXT analysis's cleanup_previous doesn't re-count the dead
        // refs as "leaked" cells. Only done when this step succeeded: on a
        // thrown error the tracking stays intact as the leak safety net.
        __resetVizMeasurementRefs();
      }
    } catch (err) {
      console.warn("[capture_multi_angle] label cleanup failed:", err);
    }

    // Step 2 — Round 91/R148 interface sidechain component cleanup
    // (matches the 'interface-sidechain' tag instead of label text).
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
          // R167: `structure.component.remove` does not exist in the prebuilt
          // bundle — use hierarchy.remove (bundle-verified API).
          try { plugin.managers.structure.hierarchy.remove([c], true); } catch (err) { console.warn('[capture_multi_angle] failed to remove interface component:', err); }
        }
      }
    } catch (err) { console.warn('[capture_multi_angle] interface component cleanup failed:', err); }

    // Step 2b — R170: restore chains hidden by the pairwise per-pair view
    // (hide_other_chains in recipe-viz hides the polymer + creates per-chain
    // components; restore un-hides the polymer and removes the stand-ins).
    try { await restoreHiddenChains(plugin); } catch (err) { console.warn('[capture_multi_angle] chain visibility restore failed:', err); }

    // Step 2c — R171: remove the viz-added cartoon transparency layers
    // (applied by the interactions-family recipe viz). The user's live view
    // must not stay semi-transparent after the analysis finishes.
    try { await clearVizTransparency(plugin); } catch (err) { console.warn('[capture_multi_angle] transparency restore failed:', err); }

    // Step 2d — MOL2-01: restore the water/ligand components hidden by the
    // recipe-viz hide_non_polymer step (un-hide the preset's own components,
    // remove the stand-ins we created). Without this, one interactions-family
    // analysis permanently removed ligands (HEM!) from the live view.
    try { await restoreHiddenNonPolymer(plugin); } catch (err) { console.warn('[capture_multi_angle] non-polymer visibility restore failed:', err); }

    // R119: No background restore needed — we didn't change it (see above).

    // Step 3 — R157/R161 clear selection and highlights (removes green
    // selection box from the live viewer after capture). Uses deselectAll()
    // — the clearHighlights() variant never existed on lociSelects.
    try { clearAllSelectionVisuals(plugin); } catch (err) { console.warn('[capture_multi_angle] selection cleanup failed:', err); }

    // Step 4 — R130 restore the focused analysis view first (keeps
    // savedCameraState for potential VLM-recapture iterations that need it
    // as angle base), then R163 restore the USER's pre-analysis view — the
    // camera must not stay locked at the focused-interface position after
    // the LLM analysis finishes.
    // (User-reported: "执行完LLM分析后视角还是被锁定的")
    try { restoreCameraStateKeep(plugin); } catch (err) { console.warn('[capture_multi_angle] camera state restore failed:', err); }
    try { restoreUserCameraState(plugin); } catch (err) { console.warn('[capture_multi_angle] user camera restore failed:', err); }
    // Let the restored view settle before handing control back.
    try {
      await new Promise(r => setTimeout(r, 200));
      await nextFrame();
    } catch (err) { console.warn('[capture_multi_angle] post-cleanup settle failed:', err); }
  };

  // R164 (MOL-004): the whole capture body runs inside try/finally so
  // cleanupCapture() executes on EVERY exit path — success, the
  // "All captures failed" early return, AND thrown errors.
  try {
  // R167 (MOL-M4): from here on we may add measurements (viz distances,
  // residue labels) — the finally-cleanup is allowed to remove the
  // measurement ref delta (measBeforeRefs was snapshotted above).
  labelsAdded = true;
  // R170: applyRecipeVisualization now runs on EVERY capture — including
  // VLM-recapture iterations. The R151 "skip on recapture" optimization
  // predated the R164 finally-cleanup: each capture_multi_angle call cleans
  // up its own viz at the end, so iteration 2+ used to start with the
  // sidechain sticks / H-bond lines / hidden chains ALREADY REMOVED and
  // only re-added the text labels — recaptured screenshots silently lost
  // every viz element (a root cause of the "侧链未显示" VLM feedback).
  // Re-applying is now idempotent (cleanup_previous inside the viz resets
  // state) and lets the VLM's _focusRadiusMultiplier zoom hints take effect
  // on the re-focus.
  await applyRecipeVisualization(viewer, cmd.recipe, vizParams);
  // Round 78: Reduced from 300ms to 150ms — visualization renders fast
  // for camera focus operations; 150ms is enough for Molstar to settle
  await new Promise((r) => setTimeout(r, 150));

        // Round 74: Add residue labels to the 3D view before capturing
        // R167 (MOL-004): the ref-based delta cleanup replaced the old
        // beforeMeasCount count snapshot — measBeforeRefs was taken before
        // applyRecipeVisualization above, so labels added here are covered.
        if (Array.isArray(cmd.labels) && cmd.labels.length > 0) {
          // R160: Use buildResidueLoci for labels to avoid selection side effects.
          // lociFromResidue's fallback path calls selection.clear() + structureInteractivity
          // which creates the green selection box visible in screenshots.
          // buildResidueLoci uses StructureElement directly (no selection).
          const { buildResidueLoci } = await import('./commands/recipe-viz');

          // ----------------------------------------------------------------
          // R170: tether-accurate label placement — replaces the R163
          // golden-angle SPIRAL shader offsets.
          //
          // Diagnosis (4HHB A-B pairwise, live-canvas + VLM verified on the
          // label-qa harness): the R163 offsetX/offsetY spiral displaced the
          // WHOLE label+tether assembly away from the residue — the tether's
          // anchor end floated next to the residue instead of touching it
          // ("labels point to wrong positions"), while at offset 0 labels
          // were OCCLUDED by the cartoon (depth-tested at the loci
          // bounding-sphere center). Neither placement let the VLM associate
          // a label with its residue.
          //
          // The R170 formula (each element VLM-verified with real 4HHB A-B
          // pairwise data):
          //   - offsetX/offsetY = 0: the text-box anchor stays AT the residue
          //     (attachment places the box on a side of it) and the tether
          //     connects box -> residue precisely.
          //   - offsetZ = 12 (Å toward the camera): pulls the label in front
          //     of the local cartoon so it is never depth-occluded.
          //   - 8 outer attachments cycled + tetherLength rings (1.6 +
          //     ring * 1.1, capped at the PD max 5): successive labels sit on
          //     different sides at increasing distance — anti-overlap
          //     without breaking the anchor.
          //   - translucent dark background box (opacity 0.5): the earlier
          //     "no background" request predates anchor-accurate placement;
          //     now that labels sit ON the structure, the box is what keeps
          //     them readable over the busy cartoon (VLM: readable).
          // ----------------------------------------------------------------
          const ATTACHMENTS = [
            'top-center', 'top-right', 'middle-right', 'bottom-right',
            'bottom-center', 'bottom-left', 'middle-left', 'top-left',
          ] as const;

          // ----------------------------------------------------------------
          // R171 pass 1 — resolve every label's loci FIRST (single-residue,
          // non-destructive; same R160 buildResidueLoci → lociFromResidue
          // fallback chain as before), so per-label sizing can be planned
          // from the anchors' real camera distances before anything is drawn.
          // ----------------------------------------------------------------
          type LabelSpec = NonNullable<typeof cmd.labels>[number];
          const prepared: Array<{ lbl: LabelSpec; loci: unknown }> = [];
          for (const lbl of cmd.labels) {
            if (lbl.chain === undefined || lbl.resno === undefined) continue;
            try {
              let loci: unknown = null;
              const singleResult = buildResidueLoci(plugin, [{ chain: lbl.chain, resno: lbl.resno }]);
              if (singleResult) {
                loci = singleResult.loci;
              }
              // Fallback to lociFromResidue if buildResidueLoci failed
              if (!loci) {
                loci = await lociFromResidue(viewer, {
                  chain: lbl.chain,
                  resno: lbl.resno,
                });
              }
              if (loci) prepared.push({ lbl, loci });
            } catch (err) {
              console.warn(
                `[capture_multi_angle] label "${lbl.text}" failed:`,
                err
              );
            }
          }

          if (prepared.length > 0) {
            // R171: label colors that MATCH the cartoon — the chain-id color
            // theme assigns chains the 'many-distinct' palette (A teal,
            // B orange, …), NOT the previously hard-coded red/blue/green map.
            // getChainColorMap replicates the theme's exact serial logic
            // (structAsymMap order), so each label is tinted with the same
            // color as the chain it belongs to ("label的颜色和链的颜色不一致").
            const chainColorMap = getChainColorMap(plugin);

            // R171: distance-compensated sizing — labels render as true 3D
            // text whose screen size shrinks ~1/view-distance; anchors deeper
            // in the interface got unreadably small. Ratios scale BOTH
            // textSize and sizeFactor (both multiply glyph size) by the
            // anchor's effective depth relative to the mean, clamped.
            const ratios = getLabelSizeRatios(
              plugin,
              prepared.map((p) => getLociCenter(p.loci)),
              12 // the offsetZ labels render with (see addLabel below)
            );

            let labelIdx = 0;
            for (let idx = 0; idx < prepared.length; idx++) {
              const { lbl, loci } = prepared[idx];
              try {
                const labelColor = getChainLabelColor(plugin, lbl.chain, chainColorMap);

                // R170 tether-accurate placement for this label
                const i = labelIdx++;
                const attachment = ATTACHMENTS[i % ATTACHMENTS.length];
                const ring = Math.floor(i / ATTACHMENTS.length);
                const tetherLength = Math.min(1.6 + ring * 1.1, 4.9);
                const ratio = ratios[idx] ?? 1;

                await plugin.managers.structure.measurement.addLabel(loci, {
                  labelParams: {
                    customText: lbl.text ?? "",
                    textColor: labelColor,
                    // Molstar's own measurement labels use textSize 0.5 ×
                    // sizeFactor 1.0; 0.55 keeps them compact but legible.
                    // R171: × ratio — far labels render as large as near ones.
                    textSize: (cmd.labelFontSize ?? 0.55) * ratio,
                    sizeFactor: 0.55 * ratio,
                    offsetX: 0,               // R170: anchor stays at the residue
                    offsetY: 0,
                    offsetZ: 12,              // R170: clear the cartoon toward the camera (Å)
                    borderWidth: 0.2,          // glyph outline stroke
                    borderColor: 0x101010,    // dark outline → readable on any bg
                    background: true,          // R170: translucent box — readable over the cartoon
                    backgroundColor: 0x000000,
                    backgroundOpacity: 0.5,
                    backgroundMargin: 0.12,
                    attachment,
                    tether: true,               // callout line from the box to the residue anchor
                    tetherLength,               // R170: ring-spread, PD max 5
                    tetherBaseWidth: 0.25,
                  },
                  // R173: tag the transform so the toolbar show/hide toggle
                  // and the next analysis's label replacement can find these
                  // cells by tag (the bundle's addLabel forwards reprTags).
                  reprTags: [AGENT_LABEL_TAG],
                } as any);
              } catch (err) {
                console.warn(
                  `[capture_multi_angle] label "${lbl.text}" failed:`,
                  err
                );
              }
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

        // R161: Clear selection and highlights BEFORE capturing (not after)
        // This ensures no green selection box appears in any screenshot.
        // R161 fix: the old `lociSelects.clearHighlights()` call was a no-op
        // (method doesn't exist in the prebuilt bundle — TypeError swallowed
        // by try/catch), so green boxes persisted. deselectAll() is the real API.
        await clearAllSelectionVisualsAndWait(plugin, 120);

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

        // R164 (MOL-004): the label-delta removal, interface-component
        // removal, selection clearing and camera restores all live in
        // cleanupCapture() above — executed by the finally block below on
        // EVERY exit path (including this early return, which previously
        // skipped the cleanup and leaked labels/components/camera-lock).

        return {
          ok: true,
          detail: `Captured ${results.length} angles for ${cmd.recipe}`,
          data: {
            recipe: cmd.recipe,
            label: cmd.label ?? cmd.recipe,
            screenshots: results,
          },
        };
  } catch (err) {
    // R164 (MOL-004): log, then let the finally block run the cleanup BEFORE
    // the error propagates — the caller (executeCommand's outer try/catch →
    // { ok: false }) still sees the original failure, but the viewer is no
    // longer left with leaked labels/components/camera-lock.
    console.warn('[capture_multi_angle] capture failed — running cleanup before rethrow:', err);
    throw err;
  } finally {
    // Cleanup must never mask the original error: every step inside
    // cleanupCapture is individually guarded, so this await cannot reject.
    await cleanupCapture();
  }
}
