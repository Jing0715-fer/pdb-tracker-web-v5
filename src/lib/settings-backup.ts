'use client';

import { toast } from 'sonner';

/**
 * Settings backup/restore utilities.
 * Exports/imports all user preferences stored in localStorage.
 */

const SETTING_KEYS = [
  'pdb-bookmarks',
  'pdb-recently-viewed',
  'pdb-recent-searches',
  'pdb-recent-searches-header',
  'pdb-view-density',
  'pdb-structure-notes',
  'pdb-notification-prefs',
  'pdb-tracker:tour-completed',
  'pdb-tracker:analysis-tour-seen',
  'theme',
  'pdb-app-settings',
];

interface BackupData {
  version: string;
  exportedAt: string;
  settings: Record<string, string>;
}

export function exportSettings(): void {
  const settings: Record<string, string> = {};
  for (const key of SETTING_KEYS) {
    const value = localStorage.getItem(key);
    if (value !== null) {
      settings[key] = value;
    }
  }

  const backup: BackupData = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    settings,
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pdb-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  toast.success('Settings exported', {
    description: `${Object.keys(settings).length} settings saved to backup file`,
  });
}

export function importSettings(file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string) as BackupData;
        if (!data.settings || typeof data.settings !== 'object') {
          throw new Error('Invalid backup file format');
        }

        let count = 0;
        for (const [key, value] of Object.entries(data.settings)) {
          if (SETTING_KEYS.includes(key)) {
            localStorage.setItem(key, value);
            count++;
          }
        }

        toast.success('Settings imported', {
          description: `${count} settings restored. Please reload the page to apply.`,
        });
        resolve();
      } catch (err) {
        toast.error('Import failed', {
          description: err instanceof Error ? err.message : 'Invalid backup file',
        });
        reject(err);
      }
    };
    reader.onerror = () => {
      toast.error('Failed to read file');
      reject(new Error('FileReader error'));
    };
    reader.readAsText(file);
  });
}
