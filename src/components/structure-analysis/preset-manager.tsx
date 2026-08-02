"use client";

/**
 * Chart Presets Panel — save and load chart parameter combinations.
 *
 * Allows users to save their favorite chart configurations (e.g. Ramachandran
 * with specific region filters, SASA with specific chain selection) and
 * quickly re-apply them later.
 */
import { useState } from "react";
import {
  Bookmark,
  Save,
  Trash2,
  Play,
  X,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  useAppStore,
  type ChartPreset,
} from "@/lib/molcraft/store";

interface PresetManagerProps {
  chartId: string;
  chartLabel: string;
  currentParams: Record<string, unknown>;
  onApplyPreset: (params: Record<string, unknown>) => void;
}

export function PresetManager({
  chartId,
  chartLabel,
  currentParams,
  onApplyPreset,
}: PresetManagerProps) {
  const [expanded, setExpanded] = useState(false);
  const [presetName, setPresetName] = useState("");
  const chartPresets = useAppStore((s) => s.chartPresets);
  const saveChartPreset = useAppStore((s) => s.saveChartPreset);
  const deleteChartPreset = useAppStore((s) => s.deleteChartPreset);
  const toast = useAppStore((s) => s.toast);

  const presetsForChart = chartPresets.filter((p) => p.chartId === chartId);

  const handleSave = () => {
    if (!presetName.trim()) {
      toast("Enter a preset name", "error");
      return;
    }
    const preset: ChartPreset = {
      id: `preset-${Date.now()}`,
      name: presetName.trim(),
      chartId,
      chartLabel,
      params: currentParams,
      createdAt: Date.now(),
    };
    saveChartPreset(preset);
    setPresetName("");
    toast(`Preset "${preset.name}" saved`, "success");
  };

  const handleApply = (preset: ChartPreset) => {
    onApplyPreset(preset.params);
    toast(`Applied preset "${preset.name}"`, "info");
  };

  const handleDelete = (id: string, name: string) => {
    deleteChartPreset(id);
    toast(`Deleted preset "${name}"`, "info");
  };

  return (
    <div className="rounded-md border border-claude-border bg-claude-bg p-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 text-[10px] font-medium text-claude-text-secondary hover:text-claude-text"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <Bookmark className="h-3 w-3 text-claude-accent" />
        Presets
        {presetsForChart.length > 0 && (
          <Badge variant="outline" className="ml-0.5 px-1 py-0 text-[7px]">
            {presetsForChart.length}
          </Badge>
        )}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {/* Save new preset */}
          <div className="flex gap-1">
            <Input
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              placeholder="Preset name..."
              className="h-6 text-[10px]"
            />
            <Button
              size="sm"
              className="h-6 w-6 p-0 shrink-0"
              onClick={handleSave}
              title="Save preset"
            >
              <Save className="h-3 w-3" />
            </Button>
          </div>

          {/* Existing presets */}
          {presetsForChart.length > 0 ? (
            <div className="space-y-1">
              {presetsForChart.map((preset) => (
                <div
                  key={preset.id}
                  className="flex items-center gap-1 rounded border border-claude-border bg-claude-surface p-1 group"
                >
                  <button
                    onClick={() => handleApply(preset)}
                    className="flex flex-1 items-center gap-1 text-left text-[10px] hover:text-claude-accent"
                    title="Apply preset"
                  >
                    <Play className="h-2.5 w-2.5 text-claude-accent" />
                    <span className="truncate font-medium">{preset.name}</span>
                  </button>
                  <span className="text-[8px] text-claude-text-muted">
                    {new Date(preset.createdAt).toLocaleDateString()}
                  </span>
                  <button
                    onClick={() => handleDelete(preset.id, preset.name)}
                    className="text-claude-text-muted opacity-0 group-hover:opacity-100 hover:text-destructive"
                    title="Delete preset"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-[9px] text-claude-text-muted py-1">
              No saved presets yet
            </p>
          )}
        </div>
      )}
    </div>
  );
}
