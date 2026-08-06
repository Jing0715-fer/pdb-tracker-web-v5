"use client";

/**
 * Hook to execute a single LlmCommand against the Molstar viewer.
 * Ported from Molcraft's unified-left-panel useRunCommand.
 */
import { useState } from "react";
import { useAppStore } from "@/lib/molcraft/store";
import { executeCommand } from "@/lib/molcraft/commands";
import type { LlmCommand } from "@/lib/molcraft/command-schema";

export function useRunCommand() {
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const logCommand = useAppStore((s) => s.logCommand);
  const [busy, setBusy] = useState(false);

  const run = async (cmd: LlmCommand) => {
    if (!viewer) {
      toast("Viewer not ready yet", "error");
      return null;
    }
    setBusy(true);
    try {
      const res = await executeCommand(viewer, cmd);
      logCommand({ type: cmd.type, ok: res.ok, detail: res.detail });
      if (res.ok) toast(res.detail ?? "Done", "success");
      else toast(res.detail ?? "Failed", "error");
      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logCommand({ type: cmd.type, ok: false, detail: msg });
      toast(`Command failed: ${msg}`, "error");
      return { ok: false, detail: msg };
    } finally {
      setBusy(false);
    }
  };

  return { run, busy };
}
