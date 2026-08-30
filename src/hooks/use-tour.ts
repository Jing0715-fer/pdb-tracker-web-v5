'use client';

import { useState, useEffect, useCallback, useRef, type RefObject } from 'react';
import { toast } from 'sonner';
import { buildTourSteps, type TourStepConfig } from '@/components/tour-overlay';
import { useI18n } from '@/lib/i18n';

export const TOUR_COMPLETED_KEY = 'pdb-tracker:tour-completed';

export interface TourRefs {
  modeSwitcherRef?: RefObject<HTMLElement | null>;
  searchRef?: RefObject<HTMLElement | null>;
  /** DB Setup Wizard dialog content — spotlighted by the 数据库配置 step. */
  dbWizardContentRef?: RefObject<HTMLElement | null>;
  /** Run Center dialog content area — spotlighted by the 运行中心 step. */
  runCenterContentRef?: RefObject<HTMLElement | null>;
  /** Tab content panel (below the TabsList) — spotlighted by the
      评估/文献/周报 module steps so the tour highlights the module panel. */
  tabContentRef?: RefObject<HTMLElement | null>;
}

export interface UseTourOptions {
  mounted: boolean;
  refs?: TourRefs;
  autoStartDelay?: number;
  /** Called when a step with onEnter='openDbWizard' is entered. */
  onOpenDbWizard?: () => void;
  /** Called when a step with onExit='closeDbWizard' is left. */
  onCloseDbWizard?: () => void;
  /** Called when a step with onEnter='openRunCenter' is entered. Receives
      the optional tab to switch to (e.g. 'evaluation' / 'literature' /
      'weekly') so the host can both open the Run Center dialog AND switch
      its tab in a single callback. */
  onOpenRunCenter?: (tab?: string) => void;
  /** Called when a step with onExit='closeRunCenter' is left. */
  onCloseRunCenter?: () => void;
  /** Called to switch the Run Center tab (for module steps). */
  onSwitchTab?: (tab: string) => void;
  /** Called when a step with onEnter='switchEval' is entered. */
  onSwitchEval?: () => void;
  /** Called when a step with onEnter='switchLit' is entered. */
  onSwitchLit?: () => void;
  /** Called when a step with onEnter='switchWeekly' is entered. */
  onSwitchWeekly?: () => void;
  /**
   * When true, skip the "数据库配置" tour step (the one whose onEnter is
   * 'openDbWizard'). Use this when the user has already confirmed a
   * database — the wizard would be empty / confusing in that case.
   * Auto-applied from the first-run DB check on the host page.
   */
  skipDbStep?: boolean;
}

export interface UseTourReturn {
  tourActive: boolean;
  tourStep: number;
  setTourStep: (s: number) => void;
  /**
   * Advance to the next step, skipping the database step when
   * `skipDbStep` was passed to the hook. Returns whether the tour reached
   * the end (caller can decide what to do — usually just close the overlay).
   */
  nextStep: () => boolean;
  /** Move one step back, skipping the database step when configured. */
  prevStep: () => void;
  finishTour: () => void;
  startTour: () => void;
  steps: TourStepConfig[];
}

function buildSteps(t: any, refs?: TourRefs): TourStepConfig[] {
  const localizedSteps = buildTourSteps(t);
  return localizedSteps.map((step, i) => {
    let targetRef: TourStepConfig['targetRef'];
    // Step 0 (welcome) and step 8 (start using) are centered — no spotlight.
    // Step index 1 = Mode Switcher → spotlight mode switcher
    if (i === 1) targetRef = refs?.modeSwitcherRef;
    // Step index 2 = Database Setup → spotlight DB wizard dialog
    else if (i === 2) targetRef = refs?.dbWizardContentRef;
    // Step index 3 = Run Center → spotlight the Run Center dialog content area
    else if (i === 3) targetRef = refs?.runCenterContentRef;
    // Step indices 4 / 5 / 6 = Eval / Lit / Weekly → spotlight the tab content
    // panel (below the TabsList) so the tour highlights the module panel.
    else if (i === 4 || i === 5 || i === 6) targetRef = refs?.tabContentRef;
    // Step index 7 = Search & Shortcuts → spotlight search box
    else if (i === 7) targetRef = refs?.searchRef;
    return { ...step, targetRef };
  });
}

export function useTour({
  mounted,
  refs,
  autoStartDelay = 1500,
  onOpenDbWizard,
  onCloseDbWizard,
  onOpenRunCenter,
  onCloseRunCenter,
  onSwitchTab,
  onSwitchEval,
  onSwitchLit,
  onSwitchWeekly,
  skipDbStep = false,
}: UseTourOptions): UseTourReturn {
  const { t } = useI18n();
  const [tourActive, setTourActive] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const autoStartedRef = useRef(false);
  const prevStepRef = useRef(-1);
  // Latest skipDbStep value, accessible from the step-enter effect without
  // re-triggering it on every change. Updated in an effect (not during render)
  // to satisfy react-hooks/refs.
  const skipDbStepRef = useRef(skipDbStep);
  useEffect(() => {
    skipDbStepRef.current = skipDbStep;
  }, [skipDbStep]);
  // Build localized steps from the current locale
  const localizedSteps = buildTourSteps(t);

  // Auto-start on first visit (desktop only)
  useEffect(() => {
    if (!mounted) return;
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    if (typeof window !== 'undefined' && window.innerWidth < 768) return;
    try {
      const completed = localStorage.getItem(TOUR_COMPLETED_KEY);
      if (!completed) {
        const timer = setTimeout(() => {
          setTourActive(true);
          setTourStep(0);
        }, autoStartDelay);
        return () => clearTimeout(timer);
      }
    } catch { /* ignore */ }
  }, [mounted, autoStartDelay]);

  // Handle step enter/exit actions. The new step order:
  //   0: 欢迎 (centered)
  //   1: 模式切换 (spotlight)
  //   2: 数据库配置 (open DB wizard on enter, close on exit)
  //   3: 运行中心 (open Run Center on enter; dialog stays open for steps 4-6)
  //   4: 评估模块 (open Run Center + switch to evaluation tab)
  //   5: 文献模块 (open Run Center + switch to literature tab)
  //   6: 周报模块 (open Run Center + switch to weekly tab; close on exit)
  //   7: 搜索与快捷键 (spotlight)
  //   8: 开始使用 (centered)
  useEffect(() => {
    if (!tourActive) return;
    const step = localizedSteps[tourStep];
    if (!step) return;

    // ── Exit previous step actions ──
    if (prevStepRef.current >= 0 && prevStepRef.current !== tourStep) {
      const prevStep = localizedSteps[prevStepRef.current];
      if (prevStep?.onExit === 'closeDbWizard' && onCloseDbWizard) {
        onCloseDbWizard();
      }
      if (prevStep?.onExit === 'closeRunCenter' && onCloseRunCenter) {
        onCloseRunCenter();
      }
    }

    // ── Enter current step actions ──
    if (step.onEnter === 'openDbWizard' && onOpenDbWizard) {
      onOpenDbWizard();
    }
    if (step.onEnter === 'openRunCenter') {
      // Step 3 (运行中心): close DB wizard first (left over from step 2), then
      // open the Run Center dialog (default to evaluation tab).
      if (onCloseDbWizard) onCloseDbWizard();
      if (onOpenRunCenter) onOpenRunCenter('evaluation');
    }
    if (step.onEnter === 'switchEval') {
      // Steps 4-6 also open the Run Center (in case the user navigated here
      // directly via 上一步/下一步 without going through step 3) AND switch
      // to the matching tab in a single callback.
      if (onOpenRunCenter) onOpenRunCenter('evaluation');
      else if (onSwitchTab) onSwitchTab('evaluation');
      if (onSwitchEval) onSwitchEval();
    }
    if (step.onEnter === 'switchLit') {
      if (onOpenRunCenter) onOpenRunCenter('literature');
      else if (onSwitchTab) onSwitchTab('literature');
      if (onSwitchLit) onSwitchLit();
    }
    if (step.onEnter === 'switchWeekly') {
      if (onOpenRunCenter) onOpenRunCenter('weekly');
      else if (onSwitchTab) onSwitchTab('weekly');
      if (onSwitchWeekly) onSwitchWeekly();
    }

    prevStepRef.current = tourStep;
  }, [
    tourActive,
    tourStep,
    localizedSteps,
    onOpenDbWizard,
    onCloseDbWizard,
    onOpenRunCenter,
    onCloseRunCenter,
    onSwitchTab,
    onSwitchEval,
    onSwitchLit,
    onSwitchWeekly,
  ]);

  // Clean up on finish
  const finishTour = useCallback(() => {
    // Close any open dialogs
    if (onCloseDbWizard) onCloseDbWizard();
    if (onCloseRunCenter) onCloseRunCenter();
    setTourActive(false);
    setTourStep(0);
    prevStepRef.current = -1;
    try {
      localStorage.setItem(TOUR_COMPLETED_KEY, 'true');
    } catch { /* ignore */ }
    toast(t.tourCompleted, {
      description: t.tourCompletedDesc,
    });
  }, [onCloseDbWizard, onCloseRunCenter, t]);

  const startTour = useCallback(() => {
    setTourActive(true);
    setTourStep(0);
    prevStepRef.current = -1;
  }, []);

  // nextStep / prevStep — advance the tour, skipping the database step
  // (the one whose onEnter is 'openDbWizard') when skipDbStep is true.
  // The DB step's onEnter callback is also skipped so we don't auto-open
  // the wizard behind the user's back when they've already confirmed a DB.
  const nextStep = useCallback((): boolean => {
    let reachedEnd = false;
    setTourStep((cur) => {
      let next = cur + 1;
      while (
        skipDbStepRef.current &&
        localizedSteps[next]?.onEnter === 'openDbWizard'
      ) {
        next += 1;
      }
      if (next >= localizedSteps.length) {
        // Reached the end — finish.
        reachedEnd = true;
        return cur;
      }
      return next;
    });
    if (reachedEnd) {
      finishTour();
      return true;
    }
    return false;
  }, [finishTour, localizedSteps]);

  const prevStep = useCallback(() => {
    setTourStep((cur) => {
      let prev = cur - 1;
      while (
        skipDbStepRef.current &&
        localizedSteps[prev]?.onEnter === 'openDbWizard' &&
        prev > 0
      ) {
        prev -= 1;
      }
      return Math.max(0, prev);
    });
  }, [localizedSteps]);

  const steps = buildSteps(t, refs);

  return { tourActive, tourStep, setTourStep, nextStep, prevStep, finishTour, startTour, steps };
}
