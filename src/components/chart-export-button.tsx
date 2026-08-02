'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, FileImage, FileCode, X } from 'lucide-react';
import { useChartExport } from '@/hooks/use-chart-export';
import { useI18n } from '@/lib/i18n';

/**
 * ChartExportButton
 *
 * A button that, when clicked, shows a dropdown with export options:
 *   - Export as PNG (2x resolution)
 *   - Export as SVG (vector)
 *
 * The button finds the closest SVG element within the `containerRef` (or the
 * closest ancestor with a `.recharts-wrapper` class) and exports it.
 *
 * Usage:
 *   <div ref={containerRef}>
 *     <ResponsiveContainer>...recharts...</ResponsiveContainer>
 *     <ChartExportButton containerRef={containerRef} chartName="method-distribution" />
 *   </div>
 */

interface ChartExportButtonProps {
  containerRef?: React.RefObject<HTMLElement | null>;
  chartName?: string;
  className?: string;
  /** If no containerRef, find the closest .recharts-wrapper ancestor */
  autoFind?: boolean;
}

export function ChartExportButton({
  containerRef,
  chartName = 'chart',
  className = '',
  autoFind = true,
}: ChartExportButtonProps) {
  const { locale } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [exporting, setExporting] = useState<'png' | 'svg' | null>(null);
  const containerDivRef = useRef<HTMLDivElement>(null);
  const { exportToSVG, exportToPNG } = useChartExport();

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerDivRef.current && !containerDivRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const findChartContainer = (): HTMLElement | null => {
    if (containerRef?.current) return containerRef.current;
    if (autoFind && containerDivRef.current) {
      // Walk up to find a parent with .recharts-wrapper
      let el: HTMLElement | null = containerDivRef.current.parentElement;
      while (el) {
        if (el.querySelector('.recharts-wrapper')) return el;
        el = el.parentElement;
      }
    }
    return null;
  };

  const handleExportPNG = () => {
    const container = findChartContainer();
    setExporting('png');
    setTimeout(() => {
      exportToPNG(container, chartName, 2);
      setExporting(null);
      setIsOpen(false);
    }, 100);
  };

  const handleExportSVG = () => {
    const container = findChartContainer();
    setExporting('svg');
    setTimeout(() => {
      exportToSVG(container, chartName);
      setExporting(null);
      setIsOpen(false);
    }, 100);
  };

  return (
    <div ref={containerDivRef} className={`relative ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium text-claude-text-muted hover:text-claude-text hover:bg-claude-border-light dark:hover:bg-[#2b2926] transition-all"
        title={locale === 'zh' ? '导出图表' : 'Export chart'}
        aria-label={locale === 'zh' ? '导出图表' : 'Export chart'}
      >
        <Download className="h-3 w-3" />
        <span className="hidden sm:inline">{locale === 'zh' ? '导出' : 'Export'}</span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.96 }}
            transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
            className="glass-dropdown absolute right-0 top-full mt-1 w-36 rounded-lg overflow-hidden z-50 shadow-lg border border-claude-border dark:border-[#3d3832]"
          >
            <div className="py-1">
              <button
                onClick={handleExportPNG}
                disabled={exporting !== null}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926] transition-colors disabled:opacity-50"
              >
                <FileImage className="h-3 w-3 text-claude-text-muted" />
                <span>{exporting === 'png' ? (locale === 'zh' ? '导出中…' : 'Exporting…') : 'PNG'}</span>
                <span className="ml-auto text-[9px] text-claude-text-muted">2x</span>
              </button>
              <button
                onClick={handleExportSVG}
                disabled={exporting !== null}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926] transition-colors disabled:opacity-50"
              >
                <FileCode className="h-3 w-3 text-claude-text-muted" />
                <span>{exporting === 'svg' ? (locale === 'zh' ? '导出中…' : 'Exporting…') : 'SVG'}</span>
                <span className="ml-auto text-[9px] text-claude-text-muted">{locale === 'zh' ? '矢量' : 'vector'}</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
