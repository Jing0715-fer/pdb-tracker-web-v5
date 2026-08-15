'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useTypewriter } from '@/components/ui/pdb-animated';

// ─── Floating Particles Background ─────────────────────────────────────────

function FloatingParticles() {
  const particles = React.useMemo(() => [
    { size: 3, x: 15, y: 25, dur: 6, delay: 0 },
    { size: 2, x: 75, y: 35, dur: 8, delay: 1 },
    { size: 4, x: 45, y: 65, dur: 7, delay: 2 },
    { size: 2, x: 85, y: 75, dur: 9, delay: 0.5 },
    { size: 3, x: 25, y: 85, dur: 7.5, delay: 1.5 },
    { size: 2, x: 55, y: 15, dur: 6.5, delay: 3 },
  ], []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map((p, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            width: p.size,
            height: p.size,
            left: `${p.x}%`,
            top: `${p.y}%`,
            background: i % 2 === 0
              ? 'rgba(201, 100, 66, 0.15)'
              : 'rgba(45, 143, 143, 0.12)',
          }}
          animate={{
            y: [0, -20, 0],
            x: [0, (i % 2 === 0 ? 8 : -8), 0],
            opacity: [0.3, 0.7, 0.3],
          }}
          transition={{
            duration: p.dur,
            delay: p.delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
}

// ─── Molecular SVG Illustration ────────────────────────────────────────────

function MolecularIllustration() {
  return (
    <motion.svg
      width="120"
      height="100"
      viewBox="0 0 120 100"
      className="opacity-20 dark:opacity-10"
      animate={{ rotate: [0, 2, -2, 0] }}
      transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
    >
      {/* Protein backbone helix */}
      <path
        d="M 10 50 C 20 30, 35 25, 45 40 C 55 55, 65 30, 75 45 C 85 60, 95 35, 110 50"
        fill="none"
        stroke="var(--claude-accent, #c96442)"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.6"
      />
      {/* Alpha carbon atoms */}
      {[
        { cx: 10, cy: 50 }, { cx: 45, cy: 40 }, { cx: 75, cy: 45 }, { cx: 110, cy: 50 },
      ].map((atom, i) => (
        <motion.circle
          key={i}
          cx={atom.cx}
          cy={atom.cy}
          r="4"
          fill="var(--claude-accent, #c96442)"
          opacity="0.5"
          animate={{ r: [4, 5, 4] }}
          transition={{ duration: 3, delay: i * 0.5, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
      {/* Side chains */}
      {[
        { x1: 45, y1: 40, x2: 40, y2: 25 },
        { x1: 75, y1: 45, x2: 85, y2: 30 },
        { x1: 110, y1: 50, x2: 105, y2: 35 },
      ].map((bond, i) => (
        <g key={i}>
          <line
            x1={bond.x1} y1={bond.y1} x2={bond.x2} y2={bond.y2}
            stroke="var(--claude-cryoem, #2d8f8f)"
            strokeWidth="1.5"
            opacity="0.4"
          />
          <circle cx={bond.x2} cy={bond.y2} r="3" fill="var(--claude-cryoem, #2d8f8f)" opacity="0.4" />
        </g>
      ))}
    </motion.svg>
  );
}

// ─── Suggestion Chip ────────────────────────────────────────────────────────

interface Suggestion {
  icon: React.ReactNode;
  text: string;
}

// ─── Action Button Config ───────────────────────────────────────────────────

interface ActionConfig {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
}

// ─── Enhanced Empty State Props ─────────────────────────────────────────────

interface EnhancedEmptyStateProps {
  /** Lucide icon component for the empty state */
  icon?: React.ReactNode;
  /** Title text — will have typewriter animation */
  title: string;
  /** Description text */
  description: string;
  /** Optional action button */
  action?: ActionConfig;
  /** Optional suggestion chips */
  suggestions?: Suggestion[];
  /** Accent color for gradient text and glow (default: accent) */
  accentColor?: string;
  /** Optional CSS className */
  className?: string;
}

// ─── Enhanced Empty State Component ─────────────────────────────────────────

export function EnhancedEmptyState({
  icon,
  title,
  description,
  action,
  suggestions,
  accentColor = 'var(--claude-accent, #c96442)',
  className,
}: EnhancedEmptyStateProps) {
  const { displayedText, isComplete } = useTypewriter(title, 25);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className={`relative flex flex-col items-center justify-center h-full min-h-[400px] px-4 py-12 ${className || ''}`}
    >
      {/* Floating particles background */}
      <FloatingParticles />

      {/* Molecular illustration */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <MolecularIllustration />
      </div>

      {/* Animated icon */}
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        className="mb-6 relative z-10"
      >
        <div className="relative">
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center"
            style={{
              background: `linear-gradient(135deg, color-mix(in srgb, ${accentColor} 10%, transparent), color-mix(in srgb, ${accentColor} 5%, transparent))`,
              border: `1px solid color-mix(in srgb, ${accentColor} 15%, transparent)`,
            }}
          >
            <div style={{ color: accentColor, opacity: 0.7 }}>{icon}</div>
          </div>
          <motion.div
            animate={{ opacity: [0.2, 0.6, 0.2], scale: [1, 1.2, 1] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute -top-1 -right-1 w-3 h-3 rounded-full"
            style={{ backgroundColor: accentColor, opacity: 0.3 }}
          />
          <motion.div
            animate={{ opacity: [0.15, 0.5, 0.15] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
            className="absolute -bottom-1 -left-1 w-2 h-2 rounded-full bg-claude-cryoem"
            style={{ opacity: 0.2 }}
          />
        </div>
      </motion.div>

      {/* Title with gradient text + typewriter */}
      <h3
        className="text-lg font-semibold mb-2 relative z-10 bg-clip-text text-transparent"
        style={{
          backgroundImage: `linear-gradient(135deg, var(--claude-text) 0%, ${accentColor} 100%)`,
        }}
      >
        {displayedText}
        {!isComplete && (
          <span className="typewriter-cursor" />
        )}
      </h3>

      {/* Description */}
      <p className="text-sm text-claude-text-muted max-w-md text-center leading-relaxed relative z-10 mb-6">
        {description}
      </p>

      {/* Action button with glow */}
      {action && (
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={action.onClick}
          className="relative z-10 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white transition-all duration-200"
          style={{
            backgroundColor: accentColor,
            boxShadow: `0 0 0px ${accentColor}00, 0 2px 8px ${accentColor}33`,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = `0 0 16px ${accentColor}44, 0 4px 12px ${accentColor}33`;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = `0 0 0px ${accentColor}00, 0 2px 8px ${accentColor}33`;
          }}
        >
          {action.icon}
          {action.label}
        </motion.button>
      )}

      {/* Suggestion chips with staggered entrance */}
      {suggestions && suggestions.length > 0 && (
        <div className="mt-8 flex flex-wrap justify-center gap-2 max-w-[480px] relative z-10">
          {suggestions.map((suggestion, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + i * 0.08, duration: 0.3 }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border border-claude-border/60 dark:border-[#3d3832]/60 bg-claude-border-light/30 dark:bg-[#1a1917]/30 text-claude-text-secondary cursor-default hover:border-claude-accent/30 transition-colors"
            >
              <span className="opacity-50">{suggestion.icon}</span>
              {suggestion.text}
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
