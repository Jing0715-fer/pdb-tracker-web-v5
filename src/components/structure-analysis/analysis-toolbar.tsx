"use client";

/**
 * Structure Analysis toolbar — load PDB / AlphaFold / EMDB structures,
 * upload files, and control the viewer display.
 *
 * Ported from Molcraft's top-bar.tsx, restyled to match pdb-tracker-web-v4's
 * Claude/terracotta theme.
 */
import { useState, useCallback, useRef, useEffect } from "react";
import {
  Search,
  Loader2,
  Upload,
  RotateCcw,
  Camera,
  Sun,
  Moon,
  Box,
  FlaskConical,
  Atom,
  Play,
  Pause,
  Maximize2,
  Layers,
  Palette,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAppStore, type LoadedStructure } from "@/lib/molcraft/store";
import { executeCommand } from "@/lib/molcraft/commands";
import { parsePdb } from "@/lib/molcraft/structure-utils";
import { toast as sonnerToast } from "sonner";
import { RcsbSearch } from "./rcsb-search";

export function AnalysisToolbar() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<"pdb" | "alphafafold" | "emdb">("pdb");
  const [spinning, setSpinning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const viewer = useAppStore((s) => s.viewer);
  const addStructure = useAppStore((s) => s.addStructure);
  const setStructureFileCache = useAppStore((s) => s.setStructureFileCache);
  const toast = useAppStore((s) => s.toast);
  const logCommand = useAppStore((s) => s.logCommand);
  const viewerBgDark = useAppStore((s) => s.viewerBgDark);
  const setViewerBgDark = useAppStore((s) => s.setViewerBgDark);
  const structures = useAppStore((s) => s.structures);

  const handleLoadPdb = useCallback(
    async (id: string, src: "pdb" | "alphafafold" | "emdb" = "pdb") => {
      if (!viewer || !id) return;
      // Dismiss the AnalysisTour overlay if it's open so the user sees the
      // structure loading progress without the dark mask blocking the view.
      // Also cancels any pending auto-open of the tour.
      window.dispatchEvent(new CustomEvent("sa:close-tour"));
      window.dispatchEvent(new CustomEvent("sa:structure-loading"));
      setLoading(true);
      try {
        if (src === "pdb") {
          const res = await executeCommand(viewer, { type: "load_pdb", id });
          if (!res.ok) {
            toast(`Load failed: ${res.detail}`, "error");
            return;
          }
          let pdbText = "";
          try {
            const pdbRes = await fetch(
              `https://files.rcsb.org/download/${id.toUpperCase()}.pdb`
            );
            if (pdbRes.ok) pdbText = await pdbRes.text();
          } catch {}
          let metadata: LoadedStructure["metadata"] | undefined;
          if (pdbText) {
            try {
              const parsed = parsePdb(pdbText);
              metadata = {
                chains: parsed.chains,
                numAtoms: parsed.numAtoms,
                numResidues: parsed.numResidues,
                title: parsed.title || undefined,
              };
            } catch {}
          }
          addStructure({
            id,
            label: id.toUpperCase(),
            source: "pdb",
            loadedAt: Date.now(),
            pdbText: pdbText || undefined,
            metadata,
          });
        } else if (src === "alphafafold") {
          await executeCommand(viewer, { type: "load_alphafold", uniprotId: id });
          addStructure({
            id,
            label: `AF-${id}`,
            source: "alphafold",
            loadedAt: Date.now(),
          });
        } else if (src === "emdb") {
          await executeCommand(viewer, { type: "load_emdb", emdbId: id, detail: 3 });
          addStructure({
            id,
            label: id.toUpperCase(),
            source: "emdb",
            loadedAt: Date.now(),
          });
        }
        logCommand({ type: `load_${src}`, ok: true, detail: id });
        toast(`Loaded ${id}`, "success");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logCommand({ type: `load_${src}`, ok: false, detail: msg });
        toast(`Load failed: ${msg}`, "error");
      } finally {
        setLoading(false);
      }
    },
    [viewer, addStructure, toast, logCommand]
  );

  const handleFileUpload = useCallback(
    async (files: FileList | null) => {
      if (!viewer || !files || files.length === 0) return;
      // Dismiss the AnalysisTour overlay (same as handleLoadPdb).
      window.dispatchEvent(new CustomEvent("sa:close-tour"));
      window.dispatchEvent(new CustomEvent("sa:structure-loading"));
      setLoading(true);
      try {
        const fileData: Array<{ name: string; text: string; format: "pdb" | "cif" }> =
          [];
        for (const f of Array.from(files)) {
          try {
            const text = await f.text();
            const ext = f.name.split(".").pop()?.toLowerCase() ?? "pdb";
            const format: "pdb" | "cif" =
              ext === "cif" || ext === "mmcif" ? "cif" : "pdb";
            setStructureFileCache(f.name, text, format);
            fileData.push({ name: f.name, text, format });
          } catch {}
        }
        await viewer.loadFiles(Array.from(files));
        for (const f of Array.from(files)) {
          const fd = fileData.find((d) => d.name === f.name);
          let metadata: LoadedStructure["metadata"] | undefined;
          let pdbText: string | undefined;
          if (fd && fd.format === "pdb") {
            pdbText = fd.text;
            try {
              const parsed = parsePdb(fd.text);
              metadata = {
                chains: parsed.chains,
                numAtoms: parsed.numAtoms,
                numResidues: parsed.numResidues,
                title: parsed.title || undefined,
              };
            } catch {}
          }
          addStructure({
            id: f.name,
            label: f.name,
            source: "file",
            loadedAt: Date.now(),
            pdbText,
            metadata,
          });
        }
        toast(`Loaded ${files.length} file(s)`, "success");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast(`File load failed: ${msg}`, "error");
      } finally {
        setLoading(false);
      }
    },
    [viewer, addStructure, toast, setStructureFileCache]
  );

  // Listen for drag-and-drop file upload events from the viewer area
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<FileList>).detail;
      if (detail && detail.length > 0) {
        handleFileUpload(detail);
      }
    };
    window.addEventListener("sa:upload-files", handler as EventListener);
    return () => window.removeEventListener("sa:upload-files", handler as EventListener);
  }, [handleFileUpload]);

  const handleSubmit = () => {
    const id = query.trim();
    if (!id) return;
    const upper = id.toUpperCase();
    if (source === "pdb" && /^[A-Z0-9]{4}$/.test(upper)) {
      handleLoadPdb(upper, "pdb");
    } else if (source === "alphafafold" && /^[A-Z0-9]+$/.test(upper)) {
      handleLoadPdb(upper, "alphafafold");
    } else if (source === "emdb" && /^EMD-\d+$/i.test(upper)) {
      handleLoadPdb(upper, "emdb");
    } else if (source === "emdb" && /^\d+$/.test(id)) {
      handleLoadPdb(`EMD-${id}`, "emdb");
    } else {
      toast("Invalid ID format", "error");
    }
    setQuery("");
  };

  const handleResetCamera = async () => {
    if (!viewer) return;
    await executeCommand(viewer, { type: "reset_camera" });
  };

  const handleSnapshot = async () => {
    if (!viewer) return;
    try {
      const data = await viewer.plugin.helpers.viewportScreenshot?.getImageDataUri();
      if (data) {
        const a = document.createElement("a");
        a.href = data;
        a.download = `snapshot-${Date.now()}.png`;
        a.click();
        toast("Snapshot saved", "success");
      }
    } catch {
      toast("Snapshot failed", "error");
    }
  };

  const handleToggleSpin = async () => {
    if (!viewer) return;
    try {
      await executeCommand(viewer, { type: spinning ? "stop_animation" : "toggle_spin", ...(spinning ? {} : { speed: 1 }) });
      setSpinning(!spinning);
      toast(spinning ? "Spin stopped" : "Spin started", "info");
    } catch {
      toast("Toggle spin failed", "error");
    }
  };

  const handleFitToScreen = async () => {
    if (!viewer) return;
    try {
      const plugin = viewer.plugin;
      plugin.managers.structure.hierarchy.current.structures.forEach((s: any) => {
        plugin.managers.camera.focusSpheres(s.components);
      });
      toast("Fit to screen", "info");
    } catch {
      // Fallback: reset camera
      await executeCommand(viewer, { type: "reset_camera" });
    }
  };

  const handleRepresentationChange = async (preset: string) => {
    if (!viewer || structures.length === 0) return;
    try {
      await executeCommand(viewer, { type: "set_representation", preset, structures: "all" });
      // Update store
      structures.forEach((s) => {
        useAppStore.getState().updateStructureStyle(s.id, {
          representation: preset as any,
        });
      });
      toast(`Representation: ${preset}`, "info");
    } catch {
      toast("Representation change failed", "error");
    }
  };

  const handleColorSchemeChange = async (theme: string) => {
    if (!viewer || structures.length === 0) return;
    try {
      await executeCommand(viewer, { type: "set_color_theme", theme, structures: "all" });
      structures.forEach((s) => {
        useAppStore.getState().updateStructureStyle(s.id, {
          colorScheme: theme as any,
        });
      });
      toast(`Color: ${theme}`, "info");
    } catch {
      toast("Color change failed", "error");
    }
  };

  return (
    <div className="flex items-center gap-2 border-b border-claude-border bg-claude-surface px-3 py-2">
      {/* Source selector */}
      <Select
        value={source}
        onValueChange={(v) => setSource(v as "pdb" | "alphafafold" | "emdb")}
      >
        <SelectTrigger className="h-8 w-[120px] text-xs" data-tour="source-selector">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="pdb">
            <span className="flex items-center gap-1.5">
              <Box className="h-3 w-3" /> PDB
            </span>
          </SelectItem>
          <SelectItem value="alphafafold">
            <span className="flex items-center gap-1.5">
              <Atom className="h-3 w-3" /> AlphaFold
            </span>
          </SelectItem>
          <SelectItem value="emdb">
            <span className="flex items-center gap-1.5">
              <FlaskConical className="h-3 w-3" /> EMDB
            </span>
          </SelectItem>
        </SelectContent>
      </Select>

      {/* Search input */}
      <div className="relative flex-1 max-w-xs">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-claude-text-muted" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder={
            source === "pdb"
              ? "PDB ID (e.g. 1CBS)"
              : source === "alphafafold"
              ? "UniProt ID"
              : "EMD-XXXX"
          }
          className="h-8 pl-7 text-xs"
        />
      </div>

      <Button
        size="sm"
        className="h-8 text-xs"
        disabled={loading || !viewer}
        onClick={handleSubmit}
      >
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Search className="h-3 w-3" />
        )}
        Load
      </Button>

      {/* RCSB structure search */}
      <div data-tour="rcsb-search">
        <RcsbSearch
          onLoadPdb={(id) => handleLoadPdb(id.toUpperCase(), "pdb")}
          disabled={!viewer}
        />
      </div>

      {/* File upload */}
      <Button
        size="sm"
        variant="outline"
        className="h-8 text-xs"
        disabled={!viewer}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="h-3 w-3" />
        Upload
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdb,.cif,.mmcif,.ent"
        className="hidden"
        onChange={(e) => {
          handleFileUpload(e.target.files);
          e.target.value = "";
        }}
      />

      <div className="mx-1 h-5 w-px bg-claude-border" />

      {/* Representation quick-switcher */}
      {structures.length > 0 && (
        <Select onValueChange={handleRepresentationChange} value="">
          <SelectTrigger className="h-8 w-[110px] text-xs" >
            <Layers className="h-3 w-3 mr-1" />
            <SelectValue placeholder="Representation" />
          </SelectTrigger>
          <SelectContent>
            {["cartoon", "stick", "line", "sphere", "surface"].map((r) => (
              <SelectItem key={r} value={r} className="text-xs capitalize">
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Color scheme quick-switcher */}
      {structures.length > 0 && (
        <Select onValueChange={handleColorSchemeChange} value="">
          <SelectTrigger className="h-8 w-[100px] text-xs">
            <Palette className="h-3 w-3 mr-1" />
            <SelectValue placeholder="Color" />
          </SelectTrigger>
          <SelectContent>
            {[
              { value: "chain", label: "By Chain" },
              { value: "element", label: "By Element" },
              { value: "secondary", label: "By Secondary" },
              { value: "spectrum", label: "Spectrum" },
              { value: "bfactor", label: "By B-factor" },
              { value: "residue", label: "By Residue" },
              { value: "charge", label: "By Charge" },
            ].map((c) => (
              <SelectItem key={c.value} value={c.value} className="text-xs">
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Viewer controls */}
      <div data-tour="viewer-controls" className="flex items-center gap-0.5">
        <Button
          size="sm"
          variant="ghost"
          className="h-8 px-2 text-xs"
          disabled={!viewer}
          onClick={handleFitToScreen}
          title="Fit to screen"
        >
        <Maximize2 className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 px-2 text-xs"
        disabled={!viewer}
        onClick={handleResetCamera}
        title="Reset camera"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="sm"
        variant={spinning ? "default" : "ghost"}
        className="h-8 px-2 text-xs"
        disabled={!viewer}
        onClick={handleToggleSpin}
        title={spinning ? "Stop spin" : "Start spin"}
      >
        {spinning ? (
          <Pause className="h-3.5 w-3.5" />
        ) : (
          <Play className="h-3.5 w-3.5" />
        )}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 px-2 text-xs"
        disabled={!viewer}
        onClick={handleSnapshot}
        title="Snapshot"
      >
        <Camera className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 px-2 text-xs"
        onClick={() => setViewerBgDark(!viewerBgDark)}
        title="Toggle background"
      >
        {viewerBgDark ? (
          <Sun className="h-3.5 w-3.5" />
        ) : (
          <Moon className="h-3.5 w-3.5" />
        )}
      </Button>
      </div>

      {/* Example structures */}
      <div className="ml-auto flex items-center gap-1.5">
        <span className="text-[10px] text-claude-text-muted">Examples:</span>
        {["1CBS", "6LU7", "4HHB"].map((id) => (
          <Button
            key={id}
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[10px] font-mono text-claude-accent hover:text-claude-accent-hover"
            disabled={loading || !viewer}
            onClick={() => handleLoadPdb(id, "pdb")}
          >
            {id}
          </Button>
        ))}
        {structures.length > 0 && (
          <Badge variant="secondary" className="ml-1 text-[10px]">
            {structures.length} loaded
          </Badge>
        )}
      </div>
    </div>
  );
}
