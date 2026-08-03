'use client';

import { useEffect, useState } from 'react';

/**
 * useWebVitals
 *
 * Tracks Core Web Vitals (CLS, LCP, FID, FCP, TTFB) using the
 * built-in Performance API. No external dependencies.
 *
 * Displays metrics in development mode only.
 * Metrics are also logged to console for debugging.
 */

export interface VitalMetric {
  name: string;
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  unit: string;
}

const RATINGS: Record<string, [number, number]> = {
  CLS: [0.1, 0.25],
  LCP: [2500, 4000],
  FID: [100, 300],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

function getRating(name: string, value: number): 'good' | 'needs-improvement' | 'poor' {
  const thresholds = RATINGS[name];
  if (!thresholds) return 'good';
  if (value <= thresholds[0]) return 'good';
  if (value <= thresholds[1]) return 'needs-improvement';
  return 'poor';
}

export function useWebVitals() {
  const [metrics, setMetrics] = useState<VitalMetric[]>([]);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;

    const collected: VitalMetric[] = [];

    const addMetric = (name: string, value: number, unit: string) => {
      const metric: VitalMetric = { name, value, rating: getRating(name, value), unit };
      collected.push(metric);
      setMetrics([...collected]);
      console.debug(`[Web Vitals] ${name}: ${value.toFixed(2)}${unit} (${metric.rating})`);
    };

    // FCP (First Contentful Paint)
    const fcpEntry = performance.getEntriesByName('first-contentful-paint')[0];
    if (fcpEntry) {
      addMetric('FCP', fcpEntry.startTime, 'ms');
    }

    // TTFB (Time to First Byte)
    const navEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    if (navEntry) {
      addMetric('TTFB', navEntry.responseStart - navEntry.requestStart, 'ms');
    }

    // LCP (Largest Contentful Paint)
    const lcpObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      const lastEntry = entries[entries.length - 1];
      if (lastEntry) {
        addMetric('LCP', lastEntry.startTime, 'ms');
      }
    });
    try {
      lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch { /* not supported */ }

    // CLS (Cumulative Layout Shift)
    let clsValue = 0;
    const clsObserver = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        const layoutShift = entry as any;
        if (!layoutShift.hadRecentInput) {
          clsValue += layoutShift.value;
        }
      }
      addMetric('CLS', clsValue, '');
    });
    try {
      clsObserver.observe({ type: 'layout-shift', buffered: true });
    } catch { /* not supported */ }

    // FID (First Input Delay)
    const fidObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      const firstInput = entries[0] as any;
      if (firstInput) {
        addMetric('FID', firstInput.processingStart - firstInput.startTime, 'ms');
      }
    });
    try {
      fidObserver.observe({ type: 'first-input', buffered: true });
    } catch { /* not supported */ }

    return () => {
      lcpObserver.disconnect();
      clsObserver.disconnect();
      fidObserver.disconnect();
    };
  }, []);

  return metrics;
}

/**
 * WebVitalsIndicator
 *
 * A compact indicator showing Web Vitals status in the footer area.
 * Only visible in development mode.
 */

export function WebVitalsIndicator() {
  const metrics = useWebVitals();
  const [show, setShow] = useState(false);

  if (process.env.NODE_ENV !== 'development' || metrics.length === 0) return null;

  const ratingColors = {
    good: 'text-[#16a34a]',
    'needs-improvement': 'text-[#c9872e]',
    poor: 'text-[#dc2626]',
  };

  return (
    <div className="relative">
      <button
        onClick={() => setShow(!show)}
        className="inline-flex items-center gap-1 text-[9px] text-claude-text-muted hover:text-claude-text transition-colors"
        title="Web Vitals"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${metrics.every(m => m.rating === 'good') ? 'bg-[#16a34a]' : 'bg-[#c9872e]'}`} />
        <span className="hidden md:inline">Vitals</span>
      </button>
      {show && (
        <div className="absolute bottom-full right-0 mb-1 w-48 rounded-lg border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] shadow-lg p-2 z-50">
          <div className="text-[9px] font-bold uppercase tracking-wider text-claude-text-muted mb-1.5">Web Vitals</div>
          {metrics.map(m => (
            <div key={m.name} className="flex items-center justify-between text-[10px] py-0.5">
              <span className="text-claude-text-secondary">{m.name}</span>
              <span className={`font-mono font-medium ${ratingColors[m.rating]}`}>
                {m.value.toFixed(m.unit === 'ms' ? 0 : 3)}{m.unit}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
