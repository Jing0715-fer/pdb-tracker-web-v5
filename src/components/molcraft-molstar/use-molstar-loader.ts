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
 * A FAILED load is different: its tag is removed and the loading flag is
 * cleared (see onerror) so the next mount can retry with a fresh injection.
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
      // UI-006: bounded poll. Previously this branch polled forever: when the
      // first mount's <script> FAILED, its onerror left
      // window.__molstarScriptLoading = true and the dead tag in the DOM, so
      // every later mount spun here eternally showing
      // "Initializing 3D Viewer...". Now (a) the owner's onerror removes the
      // tag and clears the flag, letting the next mount re-inject, and
      // (b) this poll gives up — with an error — when the flag is cleared
      // without a global appearing, or after 60 × 500ms = 30s.
      let polls = 0;
      const MAX_POLLS = 60;
      pollInterval = setInterval(() => {
        if (check()) {
          if (pollInterval) clearInterval(pollInterval);
          pollInterval = null;
          return;
        }
        if (!window.__molstarScriptLoading) {
          // The mount that owned the script failed and cleaned up — don't
          // keep waiting for a global that will never appear.
          if (pollInterval) clearInterval(pollInterval);
          pollInterval = null;
          if (!cancelled) setError("Failed to load /molstar.js");
          return;
        }
        polls += 1;
        if (polls >= MAX_POLLS) {
          if (pollInterval) clearInterval(pollInterval);
          pollInterval = null;
          if (!cancelled) setError("Timed out waiting for /molstar.js to load");
        }
      }, 500);
      return () => {
        cancelled = true;
        if (pollInterval) clearInterval(pollInterval);
      };
    }

    window.__molstarScriptLoading = true;
    const script = document.createElement("script");
    // r177: cache-buster — the bundle was patched (font cache key fix), and the
    // bare URL is heuristic-cached by browsers; the query forces a fresh fetch.
    script.src = "/molstar.js?v=r177b";
    script.async = true;
    script.onload = () => {
      // Give the IIFE a tick to assign the global.
      setTimeout(() => {
        if (!check()) {
          setError("Molstar bundle loaded but global not found");
        }
      }, 50);
    };
    // UI-006: on failure, remove the dead tag and clear the loading flag so
    // the NEXT mount can inject a fresh <script> instead of polling forever.
    // (The unmount cleanup below still intentionally keeps both — on success
    // the global is reusable.)
    script.onerror = () => {
      try {
        document.head.removeChild(script);
      } catch {
        /* tag already gone */
      }
      window.__molstarScriptLoading = false;
      if (!cancelled) setError("Failed to load /molstar.js");
    };
    document.head.appendChild(script);

    return () => {
      cancelled = true;
      // Intentionally do NOT remove the script tag or clear
      // window.__molstarScriptLoading — the global is reusable.
    };
  }, []);

  return { molstar, error };
}
