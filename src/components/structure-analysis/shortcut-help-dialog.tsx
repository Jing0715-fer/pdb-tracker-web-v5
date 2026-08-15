"use client";

/**
 * Keyboard Shortcuts Help Dialog — shows all available keyboard shortcuts
 * for the Structure Analysis module.
 *
 * Triggered by pressing "?" or clicking the help button.
 */
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Keyboard, Microscope, Camera, Box, Palette, Layers } from "lucide-react";

interface ShortcutGroup {
  title: string;
  icon: React.ReactNode;
  shortcuts: Array<{ keys: string; description: string }>;
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Viewer Controls",
    icon: <Microscope className="h-4 w-4 text-claude-accent" />,
    shortcuts: [
      { keys: "S", description: "Toggle spin animation" },
      { keys: "R", description: "Reset camera to default position" },
      { keys: "F", description: "Fit all structures to screen" },
      { keys: "P", description: "Export PNG snapshot" },
      { keys: "B", description: "Toggle background (dark/light)" },
      { keys: "Esc", description: "Clear interactions & measurements" },
    ],
  },
  {
    title: "Representation",
    icon: <Layers className="h-4 w-4 text-claude-accent" />,
    shortcuts: [
      { keys: "1", description: "Cartoon representation" },
      { keys: "2", description: "Stick representation" },
      { keys: "3", description: "Line representation" },
      { keys: "4", description: "Sphere representation" },
      { keys: "5", description: "Surface representation" },
    ],
  },
  {
    title: "Color & Navigation",
    icon: <Palette className="h-4 w-4 text-claude-accent" />,
    shortcuts: [
      { keys: "C", description: "Cycle color scheme (chain → element → ...)" },
      { keys: "4", description: "Switch to Analysis module (global)" },
      { keys: "1", description: "Switch to Weekly module (global)" },
      { keys: "2", description: "Switch to Evaluation module (global)" },
      { keys: "3", description: "Switch to Literature module (global)" },
    ],
  },
];

interface ShortcutHelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShortcutHelpDialog({ open, onOpenChange }: ShortcutHelpDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-claude-text">
            <Keyboard className="h-5 w-5 text-claude-accent" />
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription className="text-claude-text-secondary">
            Available shortcuts in the Structure Analysis module. Shortcuts are
            disabled when typing in input fields.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-4">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <div className="mb-2 flex items-center gap-2">
                {group.icon}
                <h3 className="text-xs font-semibold uppercase tracking-wide text-claude-text-secondary">
                  {group.title}
                </h3>
              </div>
              <div className="space-y-1">
                {group.shortcuts.map((s, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-claude-accent-light/50 transition-colors"
                  >
                    <span className="text-xs text-claude-text">
                      {s.description}
                    </span>
                    <kbd className="sa-kbd text-[10px]">{s.keys}</kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-center gap-2 rounded-md border border-claude-border bg-claude-bg p-2.5">
          <Box className="h-3.5 w-3.5 shrink-0 text-claude-text-muted" />
          <p className="text-[10px] text-claude-text-muted">
            Tip: Press <kbd className="sa-kbd">?</kbd> anytime to open this help.
            Shortcuts only work when the Analysis module is active and the
            viewer is ready.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
