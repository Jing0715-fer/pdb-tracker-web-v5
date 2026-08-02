'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from 'next-themes';
import {
  X, Sun, Moon, Monitor, Palette, SlidersHorizontal,
  Eye, Bell, Keyboard, Info, RotateCcw, ChevronRight,
  Dna, BarChart3, Microscope, FileText, Languages,
  Database, Download, Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { exportSettings, importSettings } from '@/lib/settings-backup';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useI18n } from '@/lib/i18n';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  useAppSettings,
  ALL_ACTIVITY_TYPES,
  SORT_FIELD_OPTIONS,
  PAGE_SIZE_OPTIONS,
  ABSTRACT_TRUNCATION_OPTIONS,
  DEFAULT_SETTINGS,
} from '@/hooks/use-app-settings';
import type { AppSettings } from '@/hooks/use-app-settings';
import { toast } from 'sonner';
import { DatabaseSettingsPanel } from '@/components/database-settings-panel';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  settings: AppSettings;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  updateSettings: (partial: Partial<AppSettings>) => void;
  resetSettings: () => void;
  toggleActivityType: (typeId: string) => void;
}

// ─── Keyboard Shortcuts Reference ──────────────────────────────────────────────

function useKeyboardShortcuts() {
  const { t } = useI18n();
  return [
    { keys: '1', description: t.shortcutWeekly },
    { keys: '2', description: t.shortcutEval },
    { keys: '3', description: t.shortcutLit },
    { keys: 'Escape', description: t.shortcutEscape },
    { keys: '⌘K', description: t.shortcutCmdK },
    { keys: 'B', description: t.shortcutBookmark },
    { keys: '←/→', description: t.shortcutNavigate },
  ];
}

// ─── Section Header Component ──────────────────────────────────────────────────

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-claude-accent">{icon}</span>
      <h3 className="text-xs font-semibold text-claude-text uppercase tracking-wider">{title}</h3>
    </div>
  );
}

// ─── Setting Row Component ─────────────────────────────────────────────────────

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <div className="flex-1 min-w-0">
        <Label className="text-xs font-medium text-claude-text leading-tight">{label}</Label>
        {description && (
          <p className="text-[10px] text-claude-text-muted mt-0.5 leading-tight">{description}</p>
        )}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

// ─── Main Settings Panel Component ─────────────────────────────────────────────

export function SettingsPanel({
  open,
  onClose,
  settings,
  updateSetting,
  updateSettings,
  resetSettings,
  toggleActivityType,
}: SettingsPanelProps) {
  const { setTheme } = useTheme();
  const { t, locale, setLocale } = useI18n();
  const KEYBOARD_SHORTCUTS = useKeyboardShortcuts();
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  const handleThemeChange = (value: string) => {
    const themeVal = value as 'light' | 'dark' | 'system';
    updateSetting('theme', themeVal);
    setTheme(themeVal);
  };

  const handleReset = () => {
    resetSettings();
    setTheme(DEFAULT_SETTINGS.theme);
    setResetDialogOpen(false);
    toast.success('Settings reset', { description: 'All preferences have been restored to defaults' });
  };

  // Handle Escape key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/30 dark:bg-black/50 z-40"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 w-full sm:w-[380px] z-50 bg-claude-surface dark:bg-[#242220] border-l border-claude-border dark:border-[#3d3832] shadow-2xl flex flex-col"
            onKeyDown={handleKeyDown}
          >
            {/* Panel Header */}
            <div className="flex-shrink-0 px-5 py-4 border-b border-claude-border dark:border-[#3d3832] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-claude-accent" />
                <h2 className="text-sm font-bold text-claude-text">Settings</h2>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="h-7 w-7 p-0 text-claude-text-muted hover:text-claude-text"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 space-y-6">

              {/* ─── 1. Appearance ─────────────────────────────────────────── */}
              <section>
                <SectionHeader icon={<Palette className="h-3.5 w-3.5" />} title={t.appearance} />

                {/* Theme */}
                <div className="mb-3">
                  <Label className="text-xs font-medium text-claude-text mb-2 block">{t.theme}</Label>
                  <RadioGroup
                    value={settings.theme}
                    onValueChange={handleThemeChange}
                    className="flex gap-2"
                  >
                    {[
                      { value: 'light', label: t.themeLight, icon: <Sun className="h-3.5 w-3.5" /> },
                      { value: 'dark', label: t.themeDark, icon: <Moon className="h-3.5 w-3.5" /> },
                      { value: 'system', label: t.themeSystem, icon: <Monitor className="h-3.5 w-3.5" /> },
                    ].map((opt) => (
                      <label
                        key={opt.value}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-md border cursor-pointer transition-all text-xs font-medium ${
                          settings.theme === opt.value
                            ? 'border-claude-accent bg-claude-accent/10 text-claude-accent'
                            : 'border-claude-border dark:border-[#3d3832] text-claude-text-muted hover:border-claude-accent/50 hover:text-claude-text'
                        }`}
                      >
                        <RadioGroupItem value={opt.value} className="sr-only" />
                        {opt.icon}
                        {opt.label}
                      </label>
                    ))}
                  </RadioGroup>
                </div>

                {/* Language */}
                <div className="mb-3">
                  <Label className="text-xs font-medium text-claude-text mb-2 block flex items-center gap-1.5">
                    <Languages className="h-3.5 w-3.5" /> {t.language}
                  </Label>
                  <RadioGroup
                    value={locale}
                    onValueChange={(v) => setLocale(v as 'en' | 'zh')}
                    className="flex gap-2"
                  >
                    {[
                      { value: 'en', label: 'English' },
                      { value: 'zh', label: '中文' },
                    ].map((opt) => (
                      <label
                        key={opt.value}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-md border cursor-pointer transition-all text-xs font-medium ${
                          locale === opt.value
                            ? 'border-claude-accent bg-claude-accent/10 text-claude-accent'
                            : 'border-claude-border dark:border-[#3d3832] text-claude-text-muted hover:border-claude-accent/50 hover:text-claude-text'
                        }`}
                      >
                        <RadioGroupItem value={opt.value} className="sr-only" />
                        {opt.label}
                      </label>
                    ))}
                  </RadioGroup>
                </div>
                <SettingRow
                  label={t.compactMode}
                  description={t.compactModeDesc}
                >
                  <Switch
                    checked={settings.compactMode}
                    onCheckedChange={(v) => updateSetting('compactMode', v)}
                  />
                </SettingRow>

                {/* Card Style */}
                <SettingRow label={t.cardStyle} description={t.cardStyleDesc}>
                  <Select
                    value={settings.cardStyle}
                    onValueChange={(v) => updateSetting('cardStyle', v as 'default' | 'glass' | 'flat')}
                  >
                    <SelectTrigger className="h-7 w-[110px] text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">{t.cardStyleDefault}</SelectItem>
                      <SelectItem value="glass">{t.cardStyleGlass}</SelectItem>
                      <SelectItem value="flat">{t.cardStyleFlat}</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
              </section>

              <Separator className="bg-claude-border dark:bg-[#3d3832]" />

              {/* ─── 2. Default Behavior ───────────────────────────────────── */}
              <section>
                <SectionHeader icon={<SlidersHorizontal className="h-3.5 w-3.5" />} title={t.defaultBehavior} />

                {/* Default Mode */}
                <SettingRow label={t.defaultMode} description={locale === 'zh' ? '启动时显示的模式' : 'Mode shown on app startup'}>
                  <Select
                    value={settings.defaultMode}
                    onValueChange={(v) => updateSetting('defaultMode', v as 'weekly' | 'evaluation' | 'literature')}
                  >
                    <SelectTrigger className="h-7 w-[110px] text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">{t.modeWeeklyFull}</SelectItem>
                      <SelectItem value="evaluation">{t.modeEvaluationFull}</SelectItem>
                      <SelectItem value="literature">{t.modeLiteratureFull}</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>

                {/* Default Sort Field */}
                <SettingRow label={t.defaultSort} description={t.defaultSortDesc}>
                  <Select
                    value={settings.defaultSortField}
                    onValueChange={(v) => updateSetting('defaultSortField', v)}
                  >
                    <SelectTrigger className="h-7 w-[120px] text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SORT_FIELD_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SettingRow>

                {/* Default Sort Direction */}
                <SettingRow label={t.sortDirection}>
                  <Select
                    value={settings.defaultSortDir}
                    onValueChange={(v) => updateSetting('defaultSortDir', v as 'asc' | 'desc')}
                  >
                    <SelectTrigger className="h-7 w-[110px] text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="desc">{t.sortDirDesc}</SelectItem>
                      <SelectItem value="asc">{t.sortDirAsc}</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>

                {/* Default Page Size */}
                <SettingRow label={t.pageSize} description={locale === 'zh' ? '每页显示条目数' : 'Entries per page'}>
                  <Select
                    value={String(settings.defaultPageSize)}
                    onValueChange={(v) => updateSetting('defaultPageSize', Number(v))}
                  >
                    <SelectTrigger className="h-7 w-[80px] text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((size) => (
                        <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SettingRow>
              </section>

              <Separator className="bg-claude-border dark:bg-[#3d3832]" />

              {/* ─── 3. Data Display ───────────────────────────────────────── */}
              <section>
                <SectionHeader icon={<Eye className="h-3.5 w-3.5" />} title={t.dataDisplay} />

                <SettingRow
                  label={t.showNmrResolution}
                  description={t.showNmrResolutionDesc}
                >
                  <Switch
                    checked={settings.showNmrResolution}
                    onCheckedChange={(v) => updateSetting('showNmrResolution', v)}
                  />
                </SettingRow>

                <SettingRow
                  label={t.showLigandChips}
                  description={t.showLigandChipsDesc}
                >
                  <Switch
                    checked={settings.showLigandChips}
                    onCheckedChange={(v) => updateSetting('showLigandChips', v)}
                  />
                </SettingRow>

                <SettingRow
                  label={t.showMethodBadges}
                  description={t.showMethodBadgesDesc}
                >
                  <Switch
                    checked={settings.showMethodBadges}
                    onCheckedChange={(v) => updateSetting('showMethodBadges', v)}
                  />
                </SettingRow>

                <SettingRow
                  label={t.abstractTruncation}
                  description={t.abstractTruncationDesc}
                >
                  <Select
                    value={String(settings.abstractTruncation)}
                    onValueChange={(v) => updateSetting('abstractTruncation', Number(v))}
                  >
                    <SelectTrigger className="h-7 w-[100px] text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ABSTRACT_TRUNCATION_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SettingRow>
              </section>

              <Separator className="bg-claude-border dark:bg-[#3d3832]" />

              {/* ─── 4. Notifications ──────────────────────────────────────── */}
              <section>
                <SectionHeader icon={<Bell className="h-3.5 w-3.5" />} title={t.notifications} />

                <SettingRow
                  label={t.enableNotifications}
                  description={t.enableNotificationsDesc}
                >
                  <Switch
                    checked={settings.enableNotifications}
                    onCheckedChange={(v) => updateSetting('enableNotifications', v)}
                  />
                </SettingRow>

                <SettingRow
                  label={t.notificationSound}
                  description={t.notificationSoundDesc}
                >
                  <Switch
                    checked={settings.notificationSound}
                    onCheckedChange={(v) => updateSetting('notificationSound', v)}
                    disabled={!settings.enableNotifications}
                  />
                </SettingRow>

                {/* Activity Types */}
                <div className="mt-2">
                  <Label className="text-xs font-medium text-claude-text mb-2 block">
                    Activity Types
                  </Label>
                  <div className="space-y-2 pl-1">
                    {ALL_ACTIVITY_TYPES.map((type) => (
                      <label
                        key={type.id}
                        className={`flex items-center gap-2 text-xs cursor-pointer ${
                          !settings.enableNotifications ? 'opacity-50 pointer-events-none' : ''
                        }`}
                      >
                        <Checkbox
                          checked={settings.activityTypes.includes(type.id)}
                          onCheckedChange={() => toggleActivityType(type.id)}
                          disabled={!settings.enableNotifications}
                          className="h-3.5 w-3.5"
                        />
                        <span className="mr-1 flex-shrink-0">{
                          type.iconKey === 'dna' ? <Dna className="h-3.5 w-3.5 text-[#2d8f8f]" /> :
                          type.iconKey === 'bar-chart' ? <BarChart3 className="h-3.5 w-3.5 text-[#7c5cbf]" /> :
                          type.iconKey === 'microscope' ? <Microscope className="h-3.5 w-3.5 text-[#c96442]" /> :
                          <FileText className="h-3.5 w-3.5 text-[#c9872e]" />
                        }</span>
                        <span className="text-claude-text-secondary">{type.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </section>

              <Separator className="bg-claude-border dark:bg-[#3d3832]" />

              {/* ─── 5. Keyboard Shortcuts ─────────────────────────────────── */}
              <section>
                <SectionHeader icon={<Keyboard className="h-3.5 w-3.5" />} title={t.keyboardShortcuts} />

                <div className="rounded-md border border-claude-border dark:border-[#3d3832] overflow-hidden">
                  {KEYBOARD_SHORTCUTS.map((shortcut, i) => (
                    <div
                      key={shortcut.keys}
                      className={`flex items-center justify-between px-3 py-2 ${
                        i > 0 ? 'border-t border-claude-border dark:border-[#3d3832]' : ''
                      }`}
                    >
                      <span className="text-[11px] text-claude-text-secondary">{shortcut.description}</span>
                      <kbd className="inline-flex items-center gap-0.5 text-[10px] font-mono text-claude-text-muted bg-claude-bg dark:bg-[#1a1917] px-1.5 py-0.5 rounded border border-claude-border dark:border-[#3d3832]">
                        {shortcut.keys}
                      </kbd>
                    </div>
                  ))}
                </div>
              </section>

              <Separator className="bg-claude-border dark:bg-[#3d3832]" />

              {/* ─── 6. About ──────────────────────────────────────────────── */}
              <section>
                <SectionHeader icon={<Database className="h-3.5 w-3.5" />} title="Database Management" />
                <DatabaseSettingsPanel />
              </section>

              <section>
                <SectionHeader icon={<Info className="h-3.5 w-3.5" />} title={t.about} />

                <div className="space-y-2 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-claude-text-muted">{t.version}</span>
                    <span className="font-mono text-claude-text-secondary">1.0.0</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-claude-text-muted">{t.dataSource}</span>
                    <span className="text-claude-text-secondary">RCSB PDB + PubMed</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-claude-text-muted">{t.storage}</span>
                    <span className="font-mono text-claude-text-secondary">localStorage</span>
                  </div>
                </div>

                {/* Backup & Restore */}
                <div className="mt-4 space-y-2">
                  <div className="text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider">
                    {locale === 'zh' ? '备份与恢复' : 'Backup & Restore'}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-8 text-[11px]"
                      onClick={() => exportSettings()}
                    >
                      <Download className="h-3 w-3 mr-1.5" />
                      {locale === 'zh' ? '导出设置' : 'Export Settings'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-8 text-[11px]"
                      onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = '.json';
                        input.onchange = (e) => {
                          const file = (e.target as HTMLInputElement).files?.[0];
                          if (file) {
                            importSettings(file).then(() => {
                              setTimeout(() => window.location.reload(), 1500);
                            });
                          }
                        };
                        input.click();
                      }}
                    >
                      <Upload className="h-3 w-3 mr-1.5" />
                      {locale === 'zh' ? '导入设置' : 'Import Settings'}
                    </Button>
                  </div>
                </div>

                {/* Reset All Settings */}
                <div className="mt-4">
                  <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full h-8 text-[11px] border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                      >
                        <RotateCcw className="h-3 w-3 mr-1.5" />
                        {t.resetAllSettings}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="bg-claude-surface dark:bg-[#242220] border-claude-border dark:border-[#3d3832]">
                      <AlertDialogHeader>
                        <AlertDialogTitle className="text-claude-text">{t.resetSettingsQuestion}</AlertDialogTitle>
                        <AlertDialogDescription className="text-claude-text-muted">
                          {t.resetSettingsWarning}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="text-claude-text-secondary">{t.cancelBtn}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleReset}
                          className="bg-red-600 text-white hover:bg-red-700"
                        >
                          {t.resetBtn}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </section>

              {/* Bottom padding for safe scrolling */}
              <div className="h-4" />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
