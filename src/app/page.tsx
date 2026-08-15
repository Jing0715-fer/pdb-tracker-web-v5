'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { ErrorBoundary } from '@/components/error-boundary';

const PdbTracker = dynamic(() => import('@/components/pdb-tracker'), {
  ssr: false,
  loading: () => <div className="fixed inset-0 z-50 flex items-center justify-center bg-claude-bg"><div className="flex flex-col items-center gap-4"><div className="w-12 h-12 border-4 border-claude-accent border-t-transparent rounded-full animate-spin" /><p className="text-claude-text-secondary text-sm">Loading PDB Tracker...</p></div></div>,
});

export default function Home() {
  return (
    <div className="h-screen flex flex-col bg-claude-bg overflow-hidden">
      <main className="flex-1 flex min-h-0">
        <ErrorBoundary>
          <Suspense fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-claude-bg">
              <div className="flex flex-col items-center gap-4">
                <div className="w-12 h-12 border-4 border-claude-accent border-t-transparent rounded-full animate-spin" />
                <p className="text-claude-text-secondary text-sm">Loading PDB Tracker...</p>
              </div>
            </div>
          }>
            <PdbTracker />
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}
