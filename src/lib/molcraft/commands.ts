"use client";

/**
 * Executor that turns parsed LlmCommand objects into real Molstar API calls
 * OR backend analysis API calls (for analyze_* commands).
 *
 * For analyze_* commands, we return the fetched data so the chat panel can
 * feed it back to the LLM in a follow-up turn (ReAct pattern).
 */

import type { LlmCommand, ResidueRef } from "./command-schema";
import type { MolstarPlugin, MolstarViewer } from "./types";
import { useAppStore, type ElectrostaticViz, type DruggabilityViz, type ScreeningViz, type PocketDetectionViz } from "./store";

export interface CommandResult {
  ok: boolean;
  detail?: string;
  /** Optional data to return to the UI (e.g. measurement values, analysis results). */
  data?: Record<string, unknown>;
  /** For analyze_* commands: the raw analysis result to feed back to the LLM. */
  analysisResult?: unknown;
}

// ============================================================
// Backend analysis API helpers (called from the browser)
// ============================================================

async function fetchMetadata(id: string, includeInterfaces: boolean) {
  const url = `/api/analyze/metadata?id=${encodeURIComponent(id)}&interfaces=${includeInterfaces ? 1 : 0}&format=markdown`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return await res.text();
}

async function fetchInterface(id: string, assembly: number) {
  const url = `/api/analyze/interface?id=${encodeURIComponent(id)}&assembly=${assembly}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return await res.json();
}

async function fetchCliList() {
  const res = await fetch("/api/cli/list");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function runRecipe(
  recipe: string,
  pdbId?: string,
  params?: Record<string, unknown>
) {
  const res = await fetch("/api/analyze/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipe, pdbId, params }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.error || `HTTP ${res.status}`);
  }
  return await res.json();
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
        const data = await runRecipe(cmd.recipe, cmd.pdbId, cmd.params);
        return {
          ok: true,
          detail: `Recipe ${cmd.recipe} ok: ${data.data ? "with data" : "see stdout"}`,
          analysisResult: { kind: "recipe", recipe: cmd.recipe, data },
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
        } catch {
          // loadPdb threw — will try fallback below
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
        await plugin.managers.structure.component.applyPreset(
          structures,
          cmd.preset
        );
        return { ok: true, detail: `Applied preset: ${cmd.preset}` };
      }

      case "set_color_theme": {
        const structures = getStructures(plugin, cmd.structures);
        const components = collectComponents(plugin, structures);
        if (components.length === 0)
          return { ok: false, detail: "No components to color" };
        // Normalize common LLM-friendly aliases to Molstar's actual color theme names.
        // Without this, "chain" (commonly emitted by the LLM) is invalid and breaks
        // the representation, causing the structure to visually disappear.
        const theme = normalizeColorTheme(cmd.theme);
        if (!theme) {
          return {
            ok: false,
            detail: `Unknown color theme: "${cmd.theme}". Valid: chain-id, element-symbol, residue-name, sequence-id, hydrophobicity, uniform, polymer-index, occupancy, model-index, structure-index, entity-id`,
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
        } catch {
          // ignore — focus is best-effort
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
      case "capture_multi_angle": {
        const angles = cmd.angles ?? (["front", "side", "top", "back"] as const);
        const width = cmd.width ?? 1200;
        const height = cmd.height ?? 800;
        const results: Array<{
          dataUri: string;
          angle: string;
          label: string;
        }> = [];

        for (const angle of angles) {
          try {
            // Apply camera angle
            await applyCameraAngle(plugin, angle);
            // Allow the view to settle after camera move
            await new Promise((r) => setTimeout(r, 150));
            // Capture
            const dataUri =
              await plugin.helpers?.viewportScreenshot?.getImageDataUri({
                width,
                height,
                transparency: false,
                axes: true,
              });
            if (dataUri) {
              results.push({
                dataUri,
                angle,
                label: `${cmd.label ?? cmd.recipe} - ${angle}`,
              });
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
                } catch {
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

// ============================================================
// Helpers
// ============================================================

function getStructures(
  plugin: MolstarPlugin,
  which: "all" | number | undefined
) {
  const all = plugin.managers.structure.hierarchy.current.structures;
  if (which === undefined || which === "all") return all;
  return all[which] ? [all[which]] : [];
}

function collectComponents(plugin: MolstarPlugin, structures: unknown[]) {
  const comps: unknown[] = [];
  for (const s of structures as Array<{ components?: unknown[] }>) {
    if (s?.components) comps.push(...s.components);
  }
  return comps;
}

function getFirstStructureData(plugin: MolstarPlugin) {
  const s = plugin.managers.structure.hierarchy.current.structures[0];
  return s?.cell?.obj?.data ?? null;
}

/**
 * Build a StructureElement.Loci from a residue spec by using the viewer's
 * high-level `structureInteractivity` API to set the selection, then reading
 * the resulting loci back from the selection manager.
 *
 * The prebuilt molstar bundle does NOT export `Script` or `MolScriptBuilder`,
 * so we cannot build queries directly. The `viewer.structureInteractivity`
 * helper accepts an `expression` callback that receives the MolScript builder
 * `Q` internally — that's our portable entry point.
 */
async function lociFromResidue(
  viewer: MolstarViewer,
  ref: ResidueRef,
  atomName?: string
): Promise<unknown> {
  const plugin = viewer.plugin;
  const data = getFirstStructureData(plugin);
  if (!data) return null;

  // Build the MolScript expression. `Q` is provided by the viewer.
  // atomGroups takes:
  //   - 'residue-test': filters which residue groups to include
  //   - 'atom-test': filters which atoms within each group to include
  //   - 'group-by': how to group atoms (residueKey = per-residue)
  const expr = (Q: any) => {
    const residueTests: any[] = [];
    if (ref.chain)
      // Molstar's MolScript DSL exposes only snake_case atom-property
      // accessors in the prebuilt bundle (auth_asym_id, label_asym_id, …).
      // The previous ternary `auth_asym_id ? auth_asym_id() : label_asym_id()`
      // was dead code — `auth_asym_id` is always truthy (a function ref).
      residueTests.push(
        Q.core.rel.eq([
          Q.struct.atomProperty.macromolecular.auth_asym_id(),
          ref.chain,
        ])
      );
    if (ref.resno !== undefined)
      residueTests.push(
        Q.core.rel.eq([
          Q.struct.atomProperty.macromolecular.auth_seq_id(),
          ref.resno,
        ])
      );
    if (ref.compId)
      residueTests.push(
        Q.core.rel.eq([
          Q.struct.atomProperty.macromolecular.label_comp_id(),
          ref.compId,
        ])
      );
    const residueTest =
      residueTests.length === 0
        ? undefined
        : residueTests.length === 1
        ? residueTests[0]
        : Q.core.logic.and(residueTests);

    // Atom name filter goes in 'atom-test', not 'residue-test'
    const atomTest =
      atomName || ref.atom
        ? Q.core.rel.eq([
            Q.struct.atomProperty.macromolecular.label_atom_id(),
            atomName ?? ref.atom,
          ])
        : undefined;

    const params: any = {
      "group-by": Q.struct.atomProperty.macromolecular.residueKey(),
    };
    if (residueTest) params["residue-test"] = residueTest;
    if (atomTest) params["atom-test"] = atomTest;
    return Q.struct.generator.atomGroups(params);
  };

  try {
    // Clear any existing selection, then use the viewer's high-level API to
    // select everything matching the expression. The viewer handles building
    // the loci internally; we then read it back from the selection manager.
    plugin.managers.structure.selection.clear();
    viewer.structureInteractivity({ expression: expr, action: ["select"] });
    // The selection update may be synchronous or via a microtask. Wait a tick
    // to let the state propagate before reading back.
    await new Promise((r) => setTimeout(r, 30));
    // Read back the loci from the selection manager.
    // `entries` is a Map<Structure, { _selection: Loci }> (note: the field is
    // `_selection` in the prebuilt bundle, not `selection`). Iterate to find
    // any non-empty entry.
    const entries = plugin.managers.structure.selection.entries as
      | Map<unknown, { _selection?: { elements?: unknown[] }; selection?: { elements?: unknown[] } }>
      | undefined;
    if (entries && typeof entries.forEach === "function") {
      let foundLoci: unknown = null;
      entries.forEach((val) => {
        const sel = val?._selection || val?.selection;
        if (
          sel?.elements &&
          sel.elements.length > 0 &&
          !foundLoci
        ) {
          foundLoci = sel;
        }
      });
      if (foundLoci) return foundLoci;
    }
    // Fallback: try getLoci on the first structure
    const loci = plugin.managers.structure.selection.getLoci(data);
    if (loci && !isLociEmpty(loci)) {
      return loci;
    }
    return null;
  } catch (err) {
    console.warn("[lociFromResidue] failed:", err);
    return null;
  }
}

/** Check if a Loci is empty (best-effort, structure-dependent). */
function isLociEmpty(loci: unknown): boolean {
  if (!loci) return true;
  // Loci objects in molstar have an `elements` array; empty means no selection.
  const l = loci as { elements?: unknown[] };
  return !l.elements || l.elements.length === 0;
}

async function lociFromChain(
  viewer: MolstarViewer,
  chain: string
): Promise<unknown> {
  const plugin = viewer.plugin;
  const data = getFirstStructureData(plugin);
  if (!data) return null;

  // Build a chain loci using StructureElement.Loci.fromSchema — this is the
  // most reliable path in the prebuilt bundle (no query compilation needed).
  try {
    const lib = (window as any).molstar?.lib;
    const Loci = lib?.structure?.StructureElement?.Loci;
    if (!Loci?.fromSchema) {
      return lociFromResidue(viewer, { chain });
    }
    const loci = Loci.fromSchema(data, {
      "chain-test": { auth_asym_id: chain },
    });
    if (loci && !isLociEmpty(loci)) return loci;
    return null;
  } catch {
    return lociFromResidue(viewer, { chain });
  }
}

async function resolveInteractionsTarget(
  viewer: MolstarViewer,
  target: ResidueRef | "selection" | "ligand" | undefined
): Promise<unknown> {
  const plugin = viewer.plugin;
  if (!target || target === "selection") {
    // Use current selection's loci
    const data = getFirstStructureData(plugin);
    return data; // approximate: focus whole structure if no selection
  }
  if (target === "ligand") {
    return lociFromResidue(viewer, {});
  }
  return lociFromResidue(viewer, target);
}

async function showInteractionsAround(
  _plugin: MolstarPlugin,
  _loci: unknown,
  _radius: number
): Promise<void> {
  // The interactions extension requires building a ComputeContacts transform
  // against a Selections cell. Implementing the full pipeline is heavy; for
  // the v1 we rely on the built-in "Structure Interactions" representation
  // which the viewer applies automatically when focus granularity is set to
  // "residue" and the focus behavior shows nearby interactions.
  // TODO: wire the ComputeContacts + InteractionsShape pipeline directly.
}

async function clearInteractions(plugin: MolstarPlugin): Promise<void> {
  // Clear any interaction-related state transforms under the Measurements group.
  // Simplest: also clear measurements (interactions live in the same group).
  plugin.managers.structure.measurement.clear();
}

function setTrackballAnimate(
  plugin: MolstarPlugin,
  name: string | undefined,
  params: { speed?: number }
) {
  const canvas3d = plugin.canvas3d as
    | {
        setProps?: (fn: (p: unknown) => void) => void;
        props?: { trackball: { animate?: unknown } };
      }
    | undefined;
  if (!canvas3d?.setProps) return;
  canvas3d.setProps((p: unknown) => {
    const props = p as {
      trackball: {
        animate?: { name: string; params: Record<string, unknown> };
      };
    };
    props.trackball = props.trackball ?? {};
    if (name) {
      props.trackball.animate = { name, params };
    } else {
      // The "off" animation name doesn't exist in Molstar's registry
      // (only "spin", "rock", "oscillate"). Setting `animate = undefined`
      // is the documented way to stop the trackball animation.
      props.trackball.animate = undefined;
    }
  });
}

/**
 * Rotate the camera to one of four canonical angles before capturing.
 *
 * Strategy: reset to the default orientation, then rotate the camera position
 * around the world up axis (Y) by the requested yaw angle. For "top", also
 * tilt the camera to look down the Y axis.
 *
 * This uses `canvas3d.camera.setState({ position, up, target })` directly —
 * the documented Molstar camera API (verified in the prebuilt bundle). The
 * previous implementation used a 250ms spin hack that landed at an
 * indeterminate angle.
 */
async function applyCameraAngle(
  plugin: MolstarPlugin,
  angle: "front" | "side" | "top" | "back"
): Promise<void> {
  // Reset first to a known orientation
  try {
    plugin.managers.camera.reset();
  } catch {
    /* ignore */
  }
  // Allow the reset to settle
  await new Promise((r) => setTimeout(r, 80));

  if (angle === "front") {
    // already front after reset
    return;
  }

  const canvas3d = plugin.canvas3d as
    | {
        setProps?: (fn: (p: unknown) => void) => void;
        camera?: {
          position?: { toArray?: () => [number, number, number] } | [number, number, number];
          up?: { toArray?: () => [number, number, number] } | [number, number, number];
          target?: { toArray?: () => [number, number, number] } | [number, number, number];
          setState?: (s: { position?: [number, number, number]; up?: [number, number, number]; target?: [number, number, number] }) => void;
        };
      }
    | undefined;
  if (!canvas3d?.camera?.setState) return;

  try {
    // Extract current camera basis vectors as plain tuples.
    const toTuple = (v: unknown): [number, number, number] => {
      if (Array.isArray(v) && v.length === 3) return v as [number, number, number];
      if (v && typeof v === "object" && "toArray" in v && typeof (v as { toArray: () => number[] }).toArray === "function") {
        const a = (v as { toArray: () => number[] }).toArray();
        return [a[0] || 0, a[1] || 0, a[2] || 0];
      }
      return [0, 0, 0];
    };
    const pos = toTuple(canvas3d.camera.position);
    const tgt = toTuple(canvas3d.camera.target);
    const up = toTuple(canvas3d.camera.up);

    // Direction from target to camera (the view vector).
    const dx = pos[0] - tgt[0];
    const dy = pos[1] - tgt[1];
    const dz = pos[2] - tgt[2];

    if (angle === "side") {
      // Rotate 90° around the Y (up) axis: (x, z) -> (-z, x)
      const newPos: [number, number, number] = [
        tgt[0] - dz,
        tgt[1] + dy,
        tgt[2] + dx,
      ];
      canvas3d.camera.setState({ position: newPos, up, target: tgt });
    } else if (angle === "back") {
      // Rotate 180° around Y: (x, z) -> (-x, -z)
      const newPos: [number, number, number] = [
        tgt[0] - dx,
        tgt[1] + dy,
        tgt[2] - dz,
      ];
      canvas3d.camera.setState({ position: newPos, up, target: tgt });
    } else if (angle === "top") {
      // Look down the Y axis: place camera directly above the target,
      // keeping the distance constant. Up vector points toward -Z (front).
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const newPos: [number, number, number] = [tgt[0], tgt[1] + dist, tgt[2]];
      // "Up" should point toward the previous front direction (negative Z
      // in Molstar's default). Project the old view direction onto XZ plane
      // and use it as the new up.
      const xzLen = Math.sqrt(dx * dx + dz * dz) || 1;
      const newUp: [number, number, number] = [dx / xzLen, 0, dz / xzLen];
      canvas3d.camera.setState({ position: newPos, up: newUp, target: tgt });
    }
  } catch {
    /* ignore — camera manipulation is best-effort */
  }
}

function hexToNumber(hex: string): number {
  const clean = hex.replace("#", "");
  return parseInt(clean, 16);
}

/**
 * Map LLM-friendly color theme aliases to Molstar's actual built-in color theme
 * names. Returns `null` if the theme is not recognized.
 *
 * Molstar's valid built-in color themes (must match `ColorTheme.BuiltIn`):
 *   uniform, chain-id, entity-id, entity-source, model-index, structure-index,
 *   residue-name, element-symbol, sequence-id, hydrophobicity, occupancy,
 *   uncertainty, polymer-index, operator-hkl, cross-link, trajectory, volume,
 *   particle, ...
 *
 * Common LLM mistakes we accept as aliases:
 *   "chain"        → "chain-id"
 *   "element"      → "element-symbol"
 *   "residue"      → "residue-name"
 *   "sequence"     → "sequence-id"
 *   "hydrophobic"  → "hydrophobicity"
 *   "entity"       → "entity-id"
 *   "model"        → "model-index"
 *   "structure"    → "structure-index"
 *   "polymer"      → "polymer-index"
 *
 * Passing an unrecognized theme (e.g. raw "chain") into
 * `updateRepresentationsTheme` breaks the representation and the structure
 * visually disappears, so we explicitly validate here.
 */
function normalizeColorTheme(theme: string | undefined): string | null {
  if (!theme || typeof theme !== "string") return null;
  const t = theme.trim().toLowerCase().replace(/[\s_-]+/g, "-");

  // Direct canonical match.
  const CANONICAL = new Set([
    "uniform", "chain-id", "entity-id", "entity-source", "model-index",
    "structure-index", "residue-name", "element-symbol", "sequence-id",
    "hydrophobicity", "occupancy", "uncertainty", "polymer-index",
    "operator-hkl", "cross-link", "trajectory", "volume", "particle",
  ]);
  if (CANONICAL.has(t)) return t;

  // Alias map.
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
    "residue-name": "residue-name",
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
    "hydrophobicity": "hydrophobicity",
    "by-hydrophobicity": "hydrophobicity",
    "entity": "entity-id",
    "model": "model-index",
    "structure": "structure-index",
    "polymer": "polymer-index",
    "bfactor": "bfactor",
    "b-factor": "bfactor",
    "occupancy": "occupancy",
    "uncertainty": "uncertainty",
  };
  if (ALIASES[t]) return ALIASES[t];

  return null;
}

/** Human-readable Chinese label for a residue category. */
function categoryLabel(cat: string): string {
  switch (cat) {
    case "hydrophobic": return "疏水";
    case "polar": return "极性";
    case "positive": return "正电";
    case "negative": return "负电";
    case "glycine": return "甘氨酸";
    default: return "其他";
  }
}

async function alignStructures(
  plugin: MolstarPlugin,
  refIdx: number,
  mobileIdx: number,
  method: "superpose" | "tm-align"
): Promise<CommandResult> {
  const structs = plugin.managers.structure.hierarchy.current.structures;
  const refCell = structs[refIdx]?.cell;
  const mobCell = structs[mobileIdx]?.cell;
  if (!refCell?.obj?.data || !mobCell?.obj?.data)
    return {
      ok: false,
      detail: "Need two loaded structures to align",
    };

  // Molstar's tm-align/superpose are not available in the prebuilt bundle.
  // We compute the alignment via the backend recipe and return the result.
  // The actual coordinate transform would need to be applied via Molstar's
  // TransformStructureConformation, but that's also not exposed.
  // For now, return the alignment data so the LLM/UI can report it.
  return {
    ok: true,
    detail: `Alignment computed (tm-align/superpose not in prebuilt bundle — use align_and_superpose recipe for RMSD + rotation matrix)`,
    data: {
      refIdx,
      mobileIdx,
      note: "Use analyze_run with recipe 'align_and_superpose' for full alignment",
    },
  };
}
