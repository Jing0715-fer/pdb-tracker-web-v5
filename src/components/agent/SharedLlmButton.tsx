/**
 * SharedLlmButton — R180: the small shared-LLM settings entry for the Run
 * Center page.
 *
 * The Run Center modules (evaluation classic / DSH, literature, weekly) and
 * the Agent chat now share ONE LLM configuration, stored server-side in
 * `.hermes/` (per-provider key/model + default provider id) — exactly the
 * store the chat's ProvidersPanel manages. This button replaces the old
 * localStorage-based "LLM Config" block:
 *
 *   - compact pill showing the effective provider / model;
 *   - popover: provider select + model select (writes the shared store via
 *     POST /api/agent/providers — setDefault / defaultModel);
 *   - "manage API keys" opens the SAME ProvidersPanel modal the Agent chat
 *     uses (add key / test / set default / delete).
 *
 * Changing the default here also changes what the chat uses for NEW sessions
 * — that's the "sharing" contract.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Cpu, ChevronDown, Loader2, KeyRound, RefreshCw, Check, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ProvidersPanel } from '@/components/agent/ProvidersPanel';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface ProviderModel {
  id: string;
  name: string;
  contextWindow?: number;
}

interface ProviderInfo {
  id: string;
  displayName: string;
  label: string;
  baseURL: string;
  apiKeyEnv: string;
  defaultModel: string;
  models: ProviderModel[];
  supportsToolCalling: boolean;
  docsUrl: string;
  available: boolean;
  hasApiKey: boolean;
  hasBaseURLOverride: boolean;
  effectiveModel: string;
}

interface Props {
  className?: string;
}

export function SharedLlmButton({ className }: Props) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [defaultProvider, setDefaultProvider] = useState<string>('zai');
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  // Custom model entry (per-provider, resets when the popover reopens).
  const [customModel, setCustomModel] = useState('');
  const [useCustomModel, setUseCustomModel] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/agent/providers');
      if (!res.ok) return;
      const data = (await res.json()) as { providers?: ProviderInfo[]; defaultProvider?: string };
      setProviders(data.providers ?? []);
      setDefaultProvider(data.defaultProvider ?? 'zai');
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setCustomModel('');
      setUseCustomModel(false);
      void refresh();
    }
  }, [open, refresh]);

  // Fetch once on mount so the pill label shows the real provider/model
  // before the popover is ever opened.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-read the shared store after the ProvidersPanel modal closes (the user
  // may have added a key or switched the default provider in there).
  useEffect(() => {
    if (!keysOpen && open) void refresh();
  }, [keysOpen, open, refresh]);

  const current = providers.find((p) => p.id === defaultProvider);
  const availableProviders = providers.filter((p) => p.available);
  const modelValue = useCustomModel
    ? customModel
    : current?.effectiveModel || current?.defaultModel || '';
  const providerModels = current?.models ?? [];

  /** Switch the shared default provider (chat new sessions follow too). */
  const pickProvider = async (providerId: string) => {
    setDefaultProvider(providerId);
    setUseCustomModel(false);
    setCustomModel('');
    try {
      await fetch('/api/agent/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId, setDefault: true }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
      void refresh();
    } catch {
      /* ignore */
    }
  };

  /** Persist the shared default model for the current provider. */
  const saveModel = async (model: string) => {
    if (!model.trim() || !current) return;
    try {
      await fetch('/api/agent/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: current.id, defaultModel: model.trim() }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
      void refresh();
    } catch {
      /* ignore */
    }
  };

  const isZh = locale === 'zh';

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'h-7 gap-1.5 px-2.5 text-xs font-normal hover:bg-claude-border-light dark:hover:bg-[#2b2926] border-claude-border dark:border-[#3d3832]',
              className,
            )}
            title={t.llmSettingsTitle}
          >
            <Cpu className="h-3.5 w-3.5 text-claude-text-muted dark:text-[#9b9590] shrink-0" />
            <span className="font-medium text-claude-text dark:text-[#e8e4dd]">LLM</span>
            <span className="font-mono text-muted-foreground max-w-[220px] truncate">
              {loading && providers.length === 0
                ? (isZh ? '…' : '…')
                : `${current?.displayName ?? defaultProvider}${modelValue ? ` · ${modelValue}` : ''}`}
            </span>
            <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0 gap-0 overflow-hidden">
          {/* Header */}
          <div className="px-3.5 py-2.5 border-b border-claude-border/50 bg-claude-bg-elevated/30">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Cpu className="h-3.5 w-3.5 text-claude-accent shrink-0" />
                <span className="text-xs font-semibold text-claude-text dark:text-[#e8e4dd] truncate">
                  {t.llmSettingsTitle}
                </span>
                {saved && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                    <Check className="h-3 w-3" />
                    {t.llmSettingsSaved}
                  </span>
                )}
              </div>
              <button
                onClick={() => void refresh()}
                className="text-claude-text-muted hover:text-claude-text dark:text-[#9b9590] dark:hover:text-[#e8e4dd] shrink-0"
                title={isZh ? '刷新' : 'Refresh'}
              >
                <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
              </button>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-claude-text-muted dark:text-[#9b9590]">
              {t.llmSettingsSharedHint}
            </p>
          </div>

          {/* Body */}
          <div className="px-3.5 py-3 space-y-3">
            {/* Provider select */}
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-claude-text-muted dark:text-[#9b9590]">
                {t.llmSettingsProvider}
              </Label>
              <select
                value={defaultProvider}
                onChange={(e) => void pickProvider(e.target.value)}
                className="w-full h-8 text-xs bg-claude-bg-base border border-claude-border dark:border-[#3d3832] rounded px-2 focus:outline-none focus:ring-1 focus:ring-claude-accent/30"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.available}>
                    {p.displayName}
                    {p.available ? '' : (isZh ? '（未配置 API Key）' : ' (no API key)')}
                  </option>
                ))}
              </select>
            </div>

            {/* Unavailable warning */}
            {current && !current.available && (
              <div className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2">
                <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-300 mt-0.5 shrink-0" />
                <span className="text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
                  {t.llmSettingsUnavailableWarn}
                </span>
              </div>
            )}

            {/* Model select */}
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-claude-text-muted dark:text-[#9b9590]">
                {t.llmSettingsModel}
              </Label>
              {!useCustomModel ? (
                <div className="flex gap-1.5">
                  <select
                    value={modelValue}
                    onChange={(e) => void saveModel(e.target.value)}
                    className="flex-1 h-8 text-xs bg-claude-bg-base border border-claude-border dark:border-[#3d3832] rounded px-2 focus:outline-none focus:ring-1 focus:ring-claude-accent/30 min-w-0"
                  >
                    {providerModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.id})
                      </option>
                    ))}
                    {/* Keep the effective model selectable when not in catalog list */}
                    {!providerModels.some((m) => m.id === modelValue) && modelValue && (
                      <option value={modelValue}>{modelValue}</option>
                    )}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      setUseCustomModel(true);
                      setCustomModel(modelValue);
                    }}
                    className="shrink-0 text-[10px] text-claude-accent hover:underline whitespace-nowrap self-center"
                  >
                    + {t.llmSettingsCustomModel}
                  </button>
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <Input
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    placeholder={t.llmSettingsCustomModelPlaceholder}
                    className="h-8 text-xs font-mono bg-claude-bg-base border-claude-border dark:border-[#3d3832] flex-1 min-w-0"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void saveModel(customModel);
                        setUseCustomModel(false);
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-[10px] text-claude-text-muted dark:text-[#9b9590] shrink-0"
                    onClick={() => {
                      void saveModel(customModel);
                      setUseCustomModel(false);
                    }}
                  >
                    <Check className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-[10px] text-claude-text-muted dark:text-[#9b9590] shrink-0"
                    onClick={() => setUseCustomModel(false)}
                  >
                    {isZh ? '返回' : 'Back'}
                  </Button>
                </div>
              )}
            </div>

            {/* Manage keys — opens the SAME providers modal the chat uses */}
            <Button
              variant="outline"
              size="sm"
              className="w-full h-8 text-xs gap-1.5 border-claude-border dark:border-[#3d3832]"
              onClick={() => setKeysOpen(true)}
            >
              <KeyRound className="h-3.5 w-3.5 text-claude-accent" />
              {t.llmSettingsManageKeys}
              <span className="text-[10px] text-claude-text-muted dark:text-[#9b9590] font-normal">
                {availableProviders.length > 0
                  ? `${availableProviders.length} ${isZh ? '个可用' : 'available'}`
                  : ''}
              </span>
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* The chat's provider-management modal, reused verbatim — the shared
          settings surface is literally the same component as the chat's. */}
      <ProvidersPanel open={keysOpen} onClose={() => setKeysOpen(false)} />
    </>
  );
}
