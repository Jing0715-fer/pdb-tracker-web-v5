"use client";

import { useEffect, useState } from "react";
import type { MolstarGlobal } from "@/lib/molcraft/types";

/**
 * Loads the prebuilt Molstar bundle (`/molstar.js`) and exposes the
 * `window.molstar` global. The bundle is an IIFE that assigns to
 * `window.molstar`, so we just inject a <script> tag and wait.
 *
 * Singleton: if multiple components call this hook (e.g. StructureAnalysisView
 * AND a lazily-mounted PdbViewerModal), only ONE script tag is injected.
 * Subsequent callers poll for the global instead of re-injecting.
 *
 * We also intentionally do NOT remove the script tag on unmount — the IIFE's
 * side effects (window.molstar assignment) are idempotent and safe to reuse
 * for future viewer instances. Removing the tag doesn't "unload" the JS.
 */
declare global {
  interface Window {
    molstar?: MolstarGlobal;
    __molstarScriptLoading?: boolean;
  }
}

export function useMolstarLoader() {
  const [molstar, setMolstar] = useState<MolstarGlobal | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    function check(): boolean {
      if (cancelled) return false;
      if (typeof window === "undefined") return false;
      const m = window.molstar;
      if (m && m.Viewer) {
        setMolstar(m);
        return true;
      }
      return false;
    }

    // If the global is already present, use it immediately.
    if (check()) return;

    // If a script is already loading (another MolstarViewer instance mounted
    // first), don't inject a second one — just poll for the global.
    if (window.__molstarScriptLoading) {
      pollInterval = setInterval(() => {
        if (check() && pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
      }, 50);
      return () => {
        cancelled = true;
        if (pollInterval) clearInterval(pollInterval);
      };
    }

    window.__molstarScriptLoading = true;
    const script = document.createElement("script");
    script.src = "/molstar.js";
    script.async = true;
    script.onload = () => {
      // Give the IIFE a tick to assign the global.
      setTimeout(() => {
        if (!check()) {
          setError("Molstar bundle loaded but global not found");
        }
      }, 50);
    };
    script.onerror = () => setError("Failed to load /molstar.js");
    document.head.appendChild(script);

    return () => {
      cancelled = true;
      // Intentionally do NOT remove the script tag or clear
      // window.__molstarScriptLoading — the global is reusable.
    };
  }, []);

  return { molstar, error };
}
