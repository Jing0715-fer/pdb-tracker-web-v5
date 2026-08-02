'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Database,
  Trash2,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Boxes,
  FlaskConical,
  BookOpen,
  FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

/**
 * DatabaseSettingsPanel
 *
 * A panel showing current database statistics with "Load Demo Data" and
 * "Clear All Data" buttons. Designed to be embedded in the Settings dialog
 * or shown as a standalone card.
 *
 * Features:
 *   - Live DB counts (structures, evaluations, papers, snapshots, reports)
 *   - Load Demo Data button (seeds 30+8+3 sample records)
 *   - Clear All Data button (wipes DB back to empty) with confirmation dialog
 *   - Auto-refreshes counts after each operation
 *   - Animated stat cards with icons
 */

interface DbStats {
  pdbStructures: number;
  weeklySnapshots: number;
  weeklyReports: number;
  evaluations: number;
  pubMedArticles: number;
  literatureDigests: number;
  isSeeded: boolean;
}

export function DatabaseSettingsPanel({ onAfterChange }: { onAfterChange?: () => void }) {
  const [stats, setStats] = useState<DbStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/seed-demo', { cache: 'no-store' });
      if (res.ok) {
        setStats(await res.json());
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const handleLoadDemo = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/seed-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      const data = await res.json();
      if (data.ok) {
        setMessage({ type: 'success', text: `Demo data loaded: ${data.stats.pdbStructures} structures, ${data.stats.evaluations} evaluations, ${data.stats.pubMedArticles} papers.` });
        await fetchStats();
        onAfterChange?.();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to load demo data.' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Network error.' });
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    setClearing(true);
    setMessage(null);
    try {
      const res = await fetch('/api/seed-demo', { method: 'DELETE' });
      const data = await res.json();
      if (data.ok) {
        setMessage({ type: 'success', text: `Cleared ${data.totalDeleted} records from database.` });
        await fetchStats();
        onAfterChange?.();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to clear data.' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Network error.' });
    } finally {
      setClearing(false);
    }
  };

  const statCards = [
    { icon: Boxes, label: 'Structures', value: stats?.pdbStructures ?? 0, color: 'from-[#2d8f8f] to-[#1a6b6b]' },
    { icon: FlaskConical, label: 'Evaluations', value: stats?.evaluations ?? 0, color: 'from-[#7c5cbf] to-[#5a3d99]' },
    { icon: BookOpen, label: 'Papers', value: stats?.pubMedArticles ?? 0, color: 'from-[#c9872e] to-[#a06b1a]' },
    { icon: FileText, label: 'Reports', value: stats?.weeklyReports ?? 0, color: 'from-[#16a34a] to-[#15803d]' },
  ];

  return (
    <div className="quick-start-panel">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-claude-accent/15">
          <Database className="h-3.5 w-3.5 text-claude-accent" />
        </div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-claude-text">
          Database Management
        </h3>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        {statCards.map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.05 }}
            className="rounded-lg border border-claude-border/40 dark:border-[#3d3832]/40 bg-white/40 dark:bg-[#1a1917]/40 p-2 text-center"
          >
            <div className={`mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br ${card.color}`}>
              <card.icon className="h-3 w-3 text-white" />
            </div>
            <div className="text-base font-bold text-claude-text tabular-nums">
              {card.value}
            </div>
            <div className="text-[9px] text-claude-text-muted uppercase tracking-wider">
              {card.label}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 mb-3">
        <Button
          size="sm"
          variant="outline"
          className="h-8 flex-1 gap-1.5 text-xs"
          onClick={handleLoadDemo}
          disabled={loading || clearing}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {loading ? 'Loading…' : 'Load Demo Data'}
        </Button>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="h-8 flex-1 gap-1.5 text-xs text-red-600 hover:text-red-700 border-red-200 hover:border-red-300 dark:border-red-900 dark:text-red-400"
              disabled={loading || clearing || !stats?.isSeeded}
            >
              {clearing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              {clearing ? 'Clearing…' : 'Clear All Data'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Clear All Data?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete all {stats?.pdbStructures ?? 0} structures,
                {' '}{stats?.evaluations ?? 0} evaluations, and {stats?.pubMedArticles ?? 0} papers
                from the database. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleClear}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                Yes, Clear All Data
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Status message */}
      <AnimatePresence>
        {message && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className={`flex items-center gap-2 rounded-lg p-2 text-xs ${
              message.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                : 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
            }`}
          >
            {message.type === 'success' ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="flex-1">{message.text}</span>
            <button
              onClick={() => setMessage(null)}
              className="text-current opacity-60 hover:opacity-100"
            >
              ×
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
