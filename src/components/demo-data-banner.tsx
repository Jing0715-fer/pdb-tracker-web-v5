'use client';

import { useState, useEffect } from 'react';
import { Database, Sparkles, Loader2, CheckCircle2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';

/**
 * DemoDataBanner
 *
 * Shows a dismissible banner at the top of the page when the database
 * is empty, offering to seed demo data with one click. After seeding,
 * the banner disappears and the user sees populated dashboards.
 *
 * Visibility logic:
 *   - Only shows if the DB has 0 PDB structures AND 0 evaluations
 *   - Once seeded, sets localStorage flag so it doesn't re-check
 *   - User can dismiss (hide for this session)
 */
export function DemoDataBanner() {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Check if demo data is needed
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Don't show if user already dismissed this session or already seeded
    if (sessionStorage.getItem('pdb-tracker:demo-banner-dismissed')) {
      setDismissed(true);
      return;
    }
    if (localStorage.getItem('pdb-tracker:demo-seeded')) {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/seed-demo', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        // Show banner only if DB is empty
        if (!data.isSeeded) {
          setVisible(true);
        }
      } catch {
        // Network error — don't bother the user
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSeed = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/seed-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.ok) {
        setSeeded(true);
        localStorage.setItem('pdb-tracker:demo-seeded', 'true');
        // Reload after a short delay to show the success state
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem('pdb-tracker:demo-banner-dismissed', '1');
  };

  if (dismissed || seeded) {
    return (
      <AnimatePresence>
        {seeded && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[150] flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 shadow-lg dark:border-emerald-800 dark:bg-emerald-950"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
              Demo data loaded! Reloading page…
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.3 }}
          className="border-b border-claude-border bg-gradient-to-r from-claude-accent-light/40 via-claude-surface to-claude-accent-light/20"
        >
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-claude-accent/15">
              <Sparkles className="h-4 w-4 text-claude-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-claude-text">
                Welcome to PDB Structure Tracker!
              </p>
              <p className="text-xs text-claude-text-muted">
                Your database is empty. Load demo data to explore all features —
                30 sample structures, 3 evaluations, and 8 literature papers.
              </p>
            </div>
            <Button
              size="sm"
              className="h-8 shrink-0 gap-1.5 text-xs"
              onClick={handleSeed}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Seeding…
                </>
              ) : (
                <>
                  <Database className="h-3.5 w-3.5" />
                  Load Demo Data
                </>
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 shrink-0 px-2"
              onClick={handleDismiss}
              title="Dismiss"
            >
              <X className="h-4 w-4 text-claude-text-muted" />
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
