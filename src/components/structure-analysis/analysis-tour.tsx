"use client";

/**
 * Analysis Module Tour — interactive onboarding for the Structure Analysis module.
 *
 * Highlights key UI elements with spotlight overlays and step-by-step
 * instructions. Triggered by a "Tour" button in the toolbar or automatically
 * on first visit.
 */
import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Microscope,
  Upload,
  Search,
  Layers,
  Activity,
  Box,
  Keyboard,
  ChevronRight,
  ChevronLeft,
  X,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface TourStep {
  selector: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  placement?: "bottom" | "top" | "left" | "right" | "center";
}

const TOUR_STEPS: TourStep[] = [
  {
    selector: '[data-tour="source-selector"]',
    title: "Load Structures",
    description:
      "Choose your data source — PDB ID, AlphaFold UniProt ID, or EMDB map code. Type the ID and press Load, or use the Search button to find structures by keyword.",
    icon: <Upload className="h-4 w-4 text-claude-accent" />,
    placement: "bottom",
  },
  {
    selector: '[data-tour="rcsb-search"]',
    title: "RCSB Search",
    description:
      "Search the entire RCSB PDB database by keyword (e.g. 'hemoglobin', 'kinase'). Results show title, method, resolution, and organism. Click any result to load it instantly.",
    icon: <Search className="h-4 w-4 text-claude-accent" />,
    placement: "bottom",
  },
  {
    selector: '[data-tour="viewer-controls"]',
    title: "Viewer Controls",
    description:
      "Quick-switch representation (cartoon/stick/sphere/surface), fit to screen, toggle spin, capture snapshots, and switch background color. Use keyboard shortcuts for faster access.",
    icon: <Layers className="h-4 w-4 text-claude-accent" />,
    placement: "bottom",
  },
  {
    selector: '[data-tour="left-panel"]',
    title: "Structures & Analysis",
    description:
      "The Structures tab shows loaded structures with inline controls. The Measure tab lets you measure distances and add labels. The Analysis tab contains 24 analysis charts in 6 categories.",
    icon: <Box className="h-4 w-4 text-claude-accent" />,
    placement: "right",
  },
  {
    selector: '[data-tour="analysis-charts"]',
    title: "24 Analysis Charts",
    description:
      "Click any chart tile to open it. Categories include Geometry (Ramachandran, B-factor), Interactions (H-bonds, disulfides), Ligand & Assembly, Drug Discovery (druggability, screening), and Quality (SASA, validation). Each chart supports CSV/JSON export.",
    icon: <Activity className="h-4 w-4 text-claude-accent" />,
    placement: "right",
  },
  {
    selector: '[data-tour="right-panel"]',
    title: "Reports & History",
    description:
      "The Reports tab saves markdown analysis reports. The History tab shows command log and alignment history. Use the Save/Load buttons to persist your analysis session to a JSON file.",
    icon: <CheckCircle2 className="h-4 w-4 text-claude-accent" />,
    placement: "left",
  },
  {
    selector: '[data-tour="status-bar"]',
    title: "Live Status Bar",
    description:
      "Always-visible stats: viewer status, structure count, active structure, atom/residue counts, background mode, last command, and command count. Click the ? button for keyboard shortcuts.",
    icon: <Keyboard className="h-4 w-4 text-claude-accent" />,
    placement: "top",
  },
];

const STORAGE_KEY = "pdb-tracker:analysis-tour-seen";

export function AnalysisTour() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const currentStep = TOUR_STEPS[step];
  const isLastStep = step === TOUR_STEPS.length - 1;

  // Auto-open on first visit. The delay is kept short (1.2s) so the tour
  // appears right after the viewer finishes initializing. If the user
  // interacts with the toolbar (loads a structure, clicks an example, etc.)
  // before the tour opens, we cancel the auto-open to avoid interrupting
  // their action.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      if (!seen) {
        let cancelled = false;
        const timer = setTimeout(() => {
          if (!cancelled) setOpen(true);
        }, 1200);
        // If the user starts loading a structure before the tour opens,
        // cancel the auto-open and mark the tour as seen so it won't
        // reappear on next visit.
        const cancelHandler = () => {
          cancelled = true;
          clearTimeout(timer);
          try {
            localStorage.setItem(STORAGE_KEY, "1");
          } catch {}
        };
        window.addEventListener("sa:structure-loading", cancelHandler);
        return () => {
          cancelled = true;
          clearTimeout(timer);
          window.removeEventListener("sa:structure-loading", cancelHandler);
        };
      }
    } catch {}
  }, []);

  // Update target position on step change
  useLayoutEffect(() => {
    if (!open || !currentStep) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTargetRect(null);
      return;
    }
    if (currentStep.placement === "center") {
      setTargetRect(null);
      return;
    }
    const updatePosition = () => {
      const el = document.querySelector(currentStep.selector);
      if (el) {
        const rect = el.getBoundingClientRect();
        setTargetRect(rect);
      } else {
        setTargetRect(null);
      }
    };
    updatePosition();
    // Update on resize/scroll
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, step, currentStep]);

  const handleClose = () => {
    setOpen(false);
    setStep(0);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {}
  };

  // Listen for programmatic close events (e.g. when user clicks an example
  // structure button while the tour is still open). This lets the toolbar
  // dismiss the tour before loading a structure so the click isn't blocked
  // by the dark overlay.
  useEffect(() => {
    const handler = () => {
      setOpen(false);
      setStep(0);
      try {
        localStorage.setItem(STORAGE_KEY, "1");
      } catch {}
    };
    window.addEventListener("sa:close-tour", handler);
    return () => window.removeEventListener("sa:close-tour", handler);
  }, []);

  // Escape key closes the tour
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open]);

  // Listen for programmatic tour open events
  useEffect(() => {
    const handler = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener("sa:open-tour", handler);
    return () => window.removeEventListener("sa:open-tour", handler);
  }, []);

  const handleNext = () => {
    if (isLastStep) {
      handleClose();
    } else {
      setStep((s) => s + 1);
    }
  };

  const handlePrev = () => {
    setStep((s) => Math.max(0, s - 1));
  };

  if (!open || !currentStep) return null;

  // Calculate tooltip position
  const getTooltipStyle = (): React.CSSProperties => {
    if (!targetRect || currentStep.placement === "center") {
      return {
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      };
    }

    const placement = currentStep.placement ?? "bottom";
    const spacing = 12;
    const tooltipWidth = 360;
    const tooltipHeight = 200;

    switch (placement) {
      case "bottom":
        return {
          top: targetRect.bottom + spacing,
          left: Math.max(
            spacing,
            Math.min(
              targetRect.left + targetRect.width / 2 - tooltipWidth / 2,
              window.innerWidth - tooltipWidth - spacing
            )
          ),
          maxWidth: tooltipWidth,
        };
      case "top":
        return {
          top: Math.max(spacing, targetRect.top - tooltipHeight - spacing),
          left: Math.max(
            spacing,
            Math.min(
              targetRect.left + targetRect.width / 2 - tooltipWidth / 2,
              window.innerWidth - tooltipWidth - spacing
            )
          ),
          maxWidth: tooltipWidth,
        };
      case "right":
        return {
          top: Math.max(
            spacing,
            targetRect.top + targetRect.height / 2 - tooltipHeight / 2
          ),
          left: targetRect.right + spacing,
          maxWidth: Math.min(tooltipWidth, window.innerWidth - targetRect.right - spacing * 2),
        };
      case "left":
        return {
          top: Math.max(
            spacing,
            targetRect.top + targetRect.height / 2 - tooltipHeight / 2
          ),
          left: Math.max(spacing, targetRect.left - tooltipWidth - spacing),
          maxWidth: Math.min(tooltipWidth, targetRect.left - spacing * 2),
        };
      default:
        return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
    }
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={overlayRef}
          className="fixed inset-0 z-[9999] pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Spotlight overlay — pointer-events-none so clicks pass through
              to the toolbar buttons underneath. The tooltip card below has
              pointer-events-auto so it remains interactive. Users can close
              the tour via the X button, Skip button, or Escape key. */}
          <div className="absolute inset-0 pointer-events-none">
            {targetRect ? (
              <>
                {/* Dark overlay with transparent hole */}
                <div
                  className="absolute inset-0 bg-black/50"
                  style={{
                    clipPath: `polygon(0 0, 0 100%, ${targetRect.left}px 100%, ${targetRect.left}px ${targetRect.top}px, ${targetRect.right}px ${targetRect.top}px, ${targetRect.right}px ${targetRect.bottom}px, ${targetRect.left}px ${targetRect.bottom}px, ${targetRect.left}px 100%, 100% 100%, 100% 0)`,
                  }}
                />
                {/* Highlight border */}
                <motion.div
                  className="absolute border-2 border-claude-accent rounded-md pointer-events-none"
                  style={{
                    top: targetRect.top - 4,
                    left: targetRect.left - 4,
                    width: targetRect.width + 8,
                    height: targetRect.height + 8,
                  }}
                  initial={{ boxShadow: "0 0 0 0 rgba(201, 100, 66, 0.5)" }}
                  animate={{ boxShadow: "0 0 0 8px rgba(201, 100, 66, 0.15)" }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    repeatType: "reverse",
                  }}
                />
              </>
            ) : (
              <div className="absolute inset-0 bg-black/50" />
            )}
          </div>

          {/* Tooltip card */}
          <motion.div
            className="absolute pointer-events-auto"
            style={getTooltipStyle()}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.25 }}
          >
            <div className="sa-tour-card rounded-xl border border-claude-border bg-claude-surface shadow-2xl p-4 w-[360px] max-w-[90vw]">
              {/* Header */}
              <div className="flex items-start gap-3 mb-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-claude-accent-light">
                  {currentStep.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-claude-text">
                    {currentStep.title}
                  </h3>
                  <p className="text-[9px] text-claude-text-muted mt-0.5">
                    Step {step + 1} of {TOUR_STEPS.length}
                  </p>
                </div>
                <button
                  onClick={handleClose}
                  className="text-claude-text-muted hover:text-destructive transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Description */}
              <p className="text-[11px] text-claude-text-secondary leading-relaxed mb-4">
                {currentStep.description}
              </p>

              {/* Progress dots */}
              <div className="flex items-center gap-1 mb-3">
                {TOUR_STEPS.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1 rounded-full transition-all ${
                      i === step
                        ? "w-6 bg-claude-accent"
                        : i < step
                        ? "w-1.5 bg-claude-accent/50"
                        : "w-1.5 bg-claude-border"
                    }`}
                  />
                ))}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={handlePrev}
                  disabled={step === 0}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Back
                </Button>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px] text-claude-text-muted"
                    onClick={handleClose}
                  >
                    Skip
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-[11px] gap-1"
                    onClick={handleNext}
                  >
                    {isLastStep ? (
                      <>
                        <Sparkles className="h-3.5 w-3.5" />
                        Finish
                      </>
                    ) : (
                      <>
                        Next
                        <ChevronRight className="h-3.5 w-3.5" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

/** Hook to programmatically open the tour. */
export function useAnalysisTour() {
  const [open, setOpen] = useState(false);
  const openTour = () => setOpen(true);
  const closeTour = () => setOpen(false);

  // Listen for tour open events
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("sa:open-tour", handler);
    return () => window.removeEventListener("sa:open-tour", handler);
  }, []);

  return { open, openTour, closeTour };
}
