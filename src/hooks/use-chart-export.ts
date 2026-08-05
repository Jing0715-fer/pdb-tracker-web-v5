'use client';

import { useCallback } from 'react';

/**
 * useChartExport
 *
 * A hook that provides functions to export chart containers as PNG or SVG.
 * Works by finding SVG elements within a container ref and serializing them.
 *
 * Supported formats:
 *   - SVG: Serializes the SVG element to a .svg file
 *   - PNG: Rasterizes the SVG to a canvas, then exports as .png
 *
 * Usage:
 *   const { exportToSVG, exportToPNG } = useChartExport();
 *   <div ref={containerRef}>...chart...</div>
 *   <button onClick={() => exportToSVG(containerRef.current, 'my-chart')}>Export SVG</button>
 */

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'chart';
}

function getSvgString(svg: SVGSVGElement): string {
  const serializer = new XMLSerializer();
  let svgString = serializer.serializeToString(svg);

  // Ensure XML namespace is present
  if (!svgString.includes('xmlns=')) {
    svgString = svgString.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  return svgString;
}

export function useChartExport() {
  const exportToSVG = useCallback((container: HTMLElement | null, chartName: string = 'chart') => {
    if (!container) return;
    const svg = container.querySelector('svg');
    if (!svg) {
      console.warn('No SVG found in container for export');
      return;
    }

    const svgString = getSvgString(svg);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const filename = `${sanitizeFilename(chartName)}.svg`;
    downloadBlob(blob, filename);
  }, []);

  const exportToPNG = useCallback((container: HTMLElement | null, chartName: string = 'chart', scale: number = 2) => {
    if (!container) return;
    const svg = container.querySelector('svg');
    if (!svg) {
      console.warn('No SVG found in container for export');
      return;
    }

    const svgString = getSvgString(svg);
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      const svgRect = svg.getBoundingClientRect();
      const width = svgRect.width || svg.viewBox.baseVal.width || 800;
      const height = svgRect.height || svg.viewBox.baseVal.height || 400;

      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        return;
      }

      // White background (for dark mode charts)
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      URL.revokeObjectURL(url);

      canvas.toBlob((blob) => {
        if (blob) {
          const filename = `${sanitizeFilename(chartName)}.png`;
          downloadBlob(blob, filename);
        }
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      console.error('Failed to load SVG for PNG export');
    };
    img.src = url;
  }, []);

  return { exportToSVG, exportToPNG };
}
