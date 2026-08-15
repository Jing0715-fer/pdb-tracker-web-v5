'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Atom,
  TrendingUp,
  FlaskConical,
  BookOpen,
  ArrowRight,
  Database,
  Zap,
  Star,
  Microscope,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * QuickActions
 *
 * A polished quick-action panel shown in the Weekly mode sidebar or above
 * the structure table. Provides one-click access to:
 *   - Load demo data (if DB is empty)
 *   - Run weekly report generator
 *   - Switch to Evaluation mode
 *   - Switch to Literature mode
 *   - Open Run Center
 *
 * Also shows a "Featured Structure" card with rotating highlights when
 * demo data is available.
 */

interface FeaturedStructure {
  pdbId: string;
  title: string;
  method: string;
  resolution: number;
  journal: string;
  reason: string;
}

const FEATURED_STRUCTURES: FeaturedStructure[] = [
  {
    pdbId: '7KQR',
    title: 'SARS-CoV-2 Spike (Open State)',
    method: 'Cryo-EM',
    resolution: 2.8,
    journal: 'Nature',
    reason: 'New epitopes revealed for vaccine design',
  },
  {
    pdbId: '6LU7',
    title: 'SARS-CoV-2 Main Protease Mpro',
    method: 'X-ray',
    resolution: 2.1,
    journal: 'Nature',
    reason: 'Key drug target for COVID-19 antivirals',
  },
  {
    pdbId: '7V4Q',
    title: 'GABA-A Receptor + Diazepam',
    method: 'Cryo-EM',
    resolution: 2.6,
    journal: 'Nature',
    reason: 'First structure with benzodiazepine bound',
  },
  {
    pdbId: '4HHB',
    title: 'Human Hemoglobin (deoxy)',
    method: 'X-ray',
    resolution: 1.7,
    journal: 'Nature',
    reason: 'Classic structure — oxygen transport mechanism',
  },
  {
    pdbId: '5N3K',
    title: 'Beta-2 Adrenergic Receptor',
    method: 'X-ray',
    resolution: 2.0,
    journal: 'Nature',
    reason: 'GPCR signaling breakthrough',
  },
];

interface QuickActionsProps {
  hasData: boolean;
  onLoadDemo?: () => void;
  onOpenRunCenter?: () => void;
  onSwitchMode?: (mode: 'evaluation' | 'literature' | 'analysis') => void;
  className?: string;
}

export function QuickActions({
  hasData,
  onLoadDemo,
  onOpenRunCenter,
  onSwitchMode,
  className,
}: QuickActionsProps) {
  const [featuredIndex, setFeaturedIndex] = useState(0);

  // Rotate featured structure every 8 seconds
  useEffect(() => {
    if (!hasData) return;
    const timer = setInterval(() => {
      setFeaturedIndex((prev) => (prev + 1) % FEATURED_STRUCTURES.length);
    }, 8000);
    return () => clearInterval(timer);
  }, [hasData]);

  const featured = FEATURED_STRUCTURES[featuredIndex];

  const quickActions = [
    {
      icon: Database,
      label: 'Load Demo Data',
      description: '30 structures + 3 evaluations',
      color: 'from-[#2d8f8f] to-[#1a6b6b]',
      onClick: onLoadDemo,
      visible: !hasData,
    },
    {
      icon: Zap,
      label: 'Run Center',
      description: 'Generate reports & evaluations',
      color: 'from-claude-accent to-[#d4784f]',
      onClick: onOpenRunCenter,
      visible: true,
    },
    {
      icon: FlaskConical,
      label: 'Evaluate Target',
      description: 'Assess druggability',
      color: 'from-[#7c5cbf] to-[#5a3d99]',
      onClick: () => onSwitchMode?.('evaluation'),
      visible: true,
    },
    {
      icon: BookOpen,
      label: 'Literature',
      description: 'Search PubMed papers',
      color: 'from-[#c9872e] to-[#a06b1a]',
      onClick: () => onSwitchMode?.('literature'),
      visible: true,
    },
    {
      icon: Microscope,
      label: 'Structure Analysis',
      description: '3D viewer + 24 charts',
      color: 'from-[#2d8f8f] to-[#7c5cbf]',
      onClick: () => onSwitchMode?.('analysis'),
      visible: true,
    },
  ].filter((a) => a.visible);

  return (
    <div className={cn('quick-start-panel', className)}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-claude-accent/15">
          <Sparkles className="h-3.5 w-3.5 text-claude-accent" />
        </div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-claude-text">
          Quick Actions
        </h3>
      </div>

      {/* Action items */}
      <div className="flex flex-col gap-1.5 mb-3">
        {quickActions.map((action, i) => (
          <motion.button
            key={action.label}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className="quick-start-item group"
            onClick={action.onClick}
          >
            <div
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br shadow-sm transition-transform group-hover:scale-110',
                action.color
              )}
            >
              <action.icon className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="flex-1 min-w-0 text-left">
              <div className="text-xs font-medium text-claude-text">
                {action.label}
              </div>
              <div className="text-[10px] text-claude-text-muted truncate">
                {action.description}
              </div>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-claude-text-muted opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
          </motion.button>
        ))}
      </div>

      {/* Featured Structure (only when data exists) */}
      <AnimatePresence mode="wait">
        {hasData && (
          <motion.div
            key={featured.pdbId}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="rounded-lg border border-claude-accent/20 bg-gradient-to-br from-claude-accent/5 to-transparent p-3"
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <Star className="h-3 w-3 text-claude-accent fill-claude-accent" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-claude-accent">
                Featured Structure
              </span>
            </div>
            <div className="flex items-start gap-2">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-claude-accent/10 font-mono text-[10px] font-bold text-claude-accent">
                {featured.pdbId}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-claude-text line-clamp-2">
                  {featured.title}
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <Badge variant="secondary" className="h-4 text-[9px] px-1">
                    {featured.method}
                  </Badge>
                  <span className="text-[10px] text-claude-text-muted">
                    {featured.resolution}Å · {featured.journal}
                  </span>
                </div>
                <div className="text-[10px] text-claude-text-secondary mt-1 italic">
                  {featured.reason}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats summary when data exists */}
      {hasData && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-claude-border/40 bg-white/40 dark:bg-[#242220]/40 p-2 text-center">
            <div className="text-sm font-bold gradient-text-accent">30</div>
            <div className="text-[9px] text-claude-text-muted">Structures</div>
          </div>
          <div className="rounded-lg border border-claude-border/40 bg-white/40 dark:bg-[#242220]/40 p-2 text-center">
            <div className="text-sm font-bold gradient-text-accent">3</div>
            <div className="text-[9px] text-claude-text-muted">Evaluations</div>
          </div>
          <div className="rounded-lg border border-claude-border/40 bg-white/40 dark:bg-[#242220]/40 p-2 text-center">
            <div className="text-sm font-bold gradient-text-accent">8</div>
            <div className="text-[9px] text-claude-text-muted">Papers</div>
          </div>
        </div>
      )}
    </div>
  );
}
