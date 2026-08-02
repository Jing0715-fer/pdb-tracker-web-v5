'use client';

import { motion } from 'framer-motion';
import {
  Microscope,
  Atom,
  Waves,
  Boxes,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * MethodBadge
 *
 * A visually enhanced badge for PDB structure methods (Cryo-EM, X-ray, NMR).
 * Each method has:
 *   - A unique gradient color
 *   - An icon
 *   - A short label
 *   - A subtle glow effect
 *
 * Also exports MethodDot (a smaller dot-only variant for compact lists)
 * and MethodIcon (just the icon with method color).
 */

type MethodType = 'Cryo-EM' | 'X-ray' | 'NMR' | 'Other';

interface MethodConfig {
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  gradient: string;
  color: string;
  glow: string;
}

const METHOD_CONFIG: Record<MethodType, MethodConfig> = {
  'Cryo-EM': {
    label: 'Cryo-EM',
    shortLabel: 'EM',
    icon: Microscope,
    gradient: 'from-[#2d8f8f] to-[#1a6b6b]',
    color: '#2d8f8f',
    glow: 'rgba(45, 143, 143, 0.3)',
  },
  'X-ray': {
    label: 'X-ray',
    shortLabel: 'XR',
    icon: Atom,
    gradient: 'from-[#7c5cbf] to-[#5a3d99]',
    color: '#7c5cbf',
    glow: 'rgba(124, 92, 191, 0.3)',
  },
  'NMR': {
    label: 'NMR',
    shortLabel: 'NMR',
    icon: Waves,
    gradient: 'from-[#c9872e] to-[#a06b1a]',
    color: '#c9872e',
    glow: 'rgba(201, 135, 46, 0.3)',
  },
  'Other': {
    label: 'Other',
    shortLabel: '··',
    icon: Boxes,
    gradient: 'from-[#94a3b8] to-[#64748b]',
    color: '#94a3b8',
    glow: 'rgba(148, 163, 184, 0.3)',
  },
};

export function normalizeMethod(method: string | undefined | null): MethodType {
  if (!method) return 'Other';
  const m = method.toUpperCase();
  if (m.includes('CRYO') || m.includes('EM') || m === 'ELECTRON MICROSCOPY') return 'Cryo-EM';
  if (m.includes('X-RAY') || m.includes('XRAY') || m.includes('DIFFRACTION')) return 'X-ray';
  if (m.includes('NMR') || m.includes('SOLUTION NMR') || m.includes('SOLID-STATE NMR')) return 'NMR';
  return 'Other';
}

interface MethodBadgeProps {
  method: string | undefined | null;
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
  showLabel?: boolean;
  className?: string;
}

export function MethodBadge({
  method,
  size = 'sm',
  showIcon = true,
  showLabel = true,
  className,
}: MethodBadgeProps) {
  const config = METHOD_CONFIG[normalizeMethod(method)];
  const Icon = config.icon;

  const sizeClasses = {
    sm: { badge: 'h-5 px-1.5 text-[9px] gap-0.5 whitespace-nowrap leading-none', icon: 'h-2.5 w-2.5 shrink-0' },
    md: { badge: 'h-6 px-2 text-[10px] gap-1 whitespace-nowrap leading-none', icon: 'h-3 w-3 shrink-0' },
    lg: { badge: 'h-7 px-2.5 text-[11px] gap-1 whitespace-nowrap leading-none', icon: 'h-3.5 w-3.5 shrink-0' },
  };

  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        'inline-flex items-center justify-center rounded-md font-semibold text-white shadow-sm overflow-hidden',
        `bg-gradient-to-br ${config.gradient}`,
        sizeClasses[size].badge,
        className
      )}
      style={{
        boxShadow: `0 1px 3px ${config.glow}`,
      }}
      title={config.label}
    >
      {showIcon && <Icon className={sizeClasses[size].icon} />}
      {showLabel && <span className="truncate">{config.label}</span>}
    </motion.span>
  );
}

export function MethodDot({ method, size = 8 }: { method: string | undefined | null; size?: number }) {
  const config = METHOD_CONFIG[normalizeMethod(method)];
  return (
    <span
      className="inline-block rounded-full"
      style={{
        width: size,
        height: size,
        backgroundColor: config.color,
        boxShadow: `0 0 0 2px ${config.glow}`,
      }}
      title={config.label}
    />
  );
}

export function MethodIcon({ method, className }: { method: string | undefined | null; className?: string }) {
  const config = METHOD_CONFIG[normalizeMethod(method)];
  const Icon = config.icon;
  return (
    <span
      className={cn('inline-flex items-center justify-center', className)}
      style={{ color: config.color }}
      title={config.label}
    >
      <Icon className="h-full w-full" />
    </span>
  );
}

export { METHOD_CONFIG };
