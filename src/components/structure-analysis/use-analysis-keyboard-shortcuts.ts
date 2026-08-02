"use client";

/**
 * Keyboard shortcuts for the Structure Analysis module.
 *
 * Only active when the Analysis module is mounted. Shortcuts:
 *   S     → Toggle spin animation
 *   R     → Reset camera
 *   F     → Fit to screen
 *   P     → Snapshot (export PNG)
 *   B     → Toggle background (dark/light)
 *   1-5   → Switch representation (cartoon/stick/line/sphere/surface)
 *   C     → Cycle color scheme
 *   L     → Focus load input
 *   Esc   → Clear selection / interactions
 *   ?     → Show shortcut hints (future)
 *
 * Shortcuts are ignored when the user is typing in an input/textarea/select
 * or when a modifier key (Ctrl/Cmd/Alt/Meta) is held.
 */
import { useEffect } from "react";
import { useAppStore } from "@/lib/molcraft/store";
import { executeCommand } from "@/lib/molcraft/commands";

export function useAnalysisKeyboardShortcuts(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if modifier keys are held (let browser/OS handle)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Skip if user is typing in an input/textarea/select
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable ||
          target.getAttribute("role") === "combobox" ||
          target.getAttribute("role") === "textbox")
      ) {
        return;
      }

      const viewer = useAppStore.getState().viewer;
      if (!viewer) return;

      const key = e.key.toLowerCase();

      switch (key) {
        case "s":
          e.preventDefault();
          // Toggle spin — we read the current state from a data attribute
          // set by the toolbar button, or just call the command
          executeCommand(viewer, { type: "toggle_spin", speed: 1 }).catch(() => {});
          break;

        case "r":
          e.preventDefault();
          executeCommand(viewer, { type: "reset_camera" }).catch(() => {});
          break;

        case "f":
          e.preventDefault();
          try {
            const plugin = viewer.plugin;
            plugin.managers.structure.hierarchy.current.structures.forEach(
              (s: any) => {
                plugin.managers.camera.focusSpheres(s.components);
              }
            );
          } catch {
            executeCommand(viewer, { type: "reset_camera" }).catch(() => {});
          }
          break;

        case "p":
          e.preventDefault();
          try {
            viewer.plugin.helpers.viewportScreenshot
              ?.getImageDataUri()
              .then((data: string) => {
                if (data) {
                  const a = document.createElement("a");
                  a.href = data;
                  a.download = `snapshot-${Date.now()}.png`;
                  a.click();
                  useAppStore.getState().toast("Snapshot saved", "success");
                }
              })
              .catch(() => {});
          } catch {}
          break;

        case "b":
          e.preventDefault();
          useAppStore.getState().setViewerBgDark(
            !useAppStore.getState().viewerBgDark
          );
          break;

        case "1":
        case "2":
        case "3":
        case "4":
        case "5": {
          e.preventDefault();
          const reps = ["cartoon", "stick", "line", "sphere", "surface"] as const;
          const preset = reps[parseInt(key) - 1];
          if (preset) {
            executeCommand(viewer, {
              type: "set_representation",
              preset,
              structures: "all",
            }).catch(() => {});
            const structures = useAppStore.getState().structures;
            structures.forEach((s) => {
              useAppStore.getState().updateStructureStyle(s.id, {
                representation: preset,
              });
            });
            useAppStore.getState().toast(`Representation: ${preset}`, "info");
          }
          break;
        }

        case "c":
          e.preventDefault();
          // Cycle color scheme
          const schemes = [
            "chain",
            "element",
            "secondary",
            "spectrum",
            "bfactor",
            "residue",
            "charge",
          ] as const;
          const structures = useAppStore.getState().structures;
          if (structures.length > 0) {
            const current = structures[0].style?.colorScheme ?? "spectrum";
            const idx = schemes.indexOf(current as any);
            const next = schemes[(idx + 1) % schemes.length];
            executeCommand(viewer, {
              type: "set_color_theme",
              theme: next,
              structures: "all",
            }).catch(() => {});
            structures.forEach((s) => {
              useAppStore.getState().updateStructureStyle(s.id, {
                colorScheme: next as any,
              });
            });
            useAppStore.getState().toast(`Color: ${next}`, "info");
          }
          break;

        case "escape":
          e.preventDefault();
          executeCommand(viewer, { type: "clear_interactions" }).catch(() => {});
          executeCommand(viewer, { type: "clear_measurements" }).catch(() => {});
          break;

        case "?":
        case "/":
          // Only trigger help with Shift+? (which produces "?")
          if (key === "/" && !e.shiftKey) return;
          e.preventDefault();
          // Dispatch a custom event to open the help dialog
          window.dispatchEvent(new CustomEvent("sa:toggle-shortcut-help"));
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled]);
}
