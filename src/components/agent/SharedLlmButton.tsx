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
 * R181 — agent 检测 restored as a usable option:
 *   - a "Local CLI Agents" section lists locally DETECTED agent CLIs
 *     (hermes / claude code / codex / gemini / openclaw / codebuddy / aider);
 *     picking one stores a Run-Center-scoped override (.hermes/run-provider.json)
 *     and the four Run Center routes run their LLM calls through the local
 *     CLI subprocess (same executor the pre-R180 UI used). It does NOT
 *     affect the Agent chat.
 *
 * R181 — memory: the mount fetch now hits the ultra-light
 * /api/agent/run-llm-status endpoint (leaf modules only) so that merely
 * opening Run Center no longer compiles the heavy providers/agent-manager
 * graph; the full /api/agent/providers route compiles when the popover is
 * actually opened.
 *
 * Changing the shared default here also changes what the chat uses for NEW
 * sessions — that's the "sharing" contract.
 */

'use client';

import { useCallback, useEffect, useState, type ElementType } from 'react';
import { Cpu, ChevronDown, KeyRound, RefreshCw, Check, AlertTriangle, Terminal, ScanSearch, RotateCcw, Feather, Sparkles, Sparkle, Bird, Panda, Wrench, Bot, Brain } from 'lucide-react';

// R182: CLI-agent icon keys (llm.ts / cli-agent-scan.ts emit these) → Lucide icons.
const CLI_ICON_BY_KEY: Record<string, ElementType> = {
  feather: Feather,
  sparkles: Sparkles,
  terminal: Terminal,
  bird: Bird,
  gemini: Sparkle,
  panda: Panda,
  wrench: Wrench,
  bot: Bot,
  brain: Brain,
};
const CliAgentIcon = ({ iconKey, className }: { iconKey: string; className?: string }) => {
  const Icon = CLI_ICON_BY_KEY[iconKey] || Terminal;
  return <Icon className={className} aria-hidden />;
};
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

/** R181: one detected CLI agent row (binary-presence scan, server-side). */
interface CliAgentInfo {
  provider: string; // 'cli:hermes'
  id: string;       // 'hermes'
  label: string;    // 'Hermes CLI'
  icon: string;     // Lucide icon key, e.g. 'feather' (R182)
  available: boolean;
  bin: string | null;
  reason: string;
}

interface RunProviderOverride {
  provider: string; // 'cli:hermes'
  model?: string;
  setAt?: string;
}

/** R181: the ultra-light mount payload from /api/agent/run-llm-status. */
interface RunLlmStatus {
  effective: { provider: string; model: string; displayName: string; source: 'run-override' | 'shared' };
  shared: { provider: string; model: string; displayName: string };
  runDefault: RunProviderOverride | null;
}

interface Props {
  className?: string;
}

export function SharedLlmButton({ className }: Props) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  // R181: light label state (mount fetch) + full settings state (popover fetch).
  const [label, setLabel] = useState<RunLlmStatus['effective'] | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [defaultProvider, setDefaultProvider] = useState<string>('zai');
  const [cliAgents, setCliAgents] = useState<CliAgentInfo[]>([]);
  const [runDefault, setRunDefault] = useState<RunProviderOverride | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [saved, setSaved] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  // Custom model entry (per-provider, resets when the popover reopens).
  const [customModel, setCustomModel] = useState('');
  const [useCustomModel, setUseCustomModel] = useState(false);

  const isZh = locale === 'zh';
  const flashSaved = useCallback(() => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  }, []);

  /** R181: ultra-light mount fetch — only what the pill label needs. */
  const refreshLabel = useCallback(async () => {
    try {
      const res = await fetch('/api/agent/run-llm-status');
      if (!res.ok) return;
      const data = (await res.json()) as RunLlmStatus;
      setLabel(data.effective);
    } catch {
      /* ignore */
    }
  }, []);

  /** Full settings fetch (popover open) — catalog + CLI-agent scan + override. */
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/agent/providers');
      if (!res.ok) return;
      const data = (await res.json()) as {
        providers?: ProviderInfo[];
        defaultProvider?: string;
        cliAgents?: CliAgentInfo[];
        runDefault?: RunProviderOverride | null;
      };
      setProviders(data.providers ?? []);
      setDefaultProvider(data.defaultProvider ?? 'zai');
      setCliAgents(data.cliAgents ?? []);
      setRunDefault(data.runDefault ?? null);
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

  // R181: light fetch on mount so the pill label is correct before the
  // popover is ever opened — without compiling the heavy providers route.
  useEffect(() => {
    void refreshLabel();
  }, [refreshLabel]);

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
  const activeOverrideId = runDefault?.provider ?? null;

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
      flashSaved();
      void refresh();
      void refreshLabel();
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
      flashSaved();
      void refresh();
      void refreshLabel();
    } catch {
      /* ignore */
    }
  };

  /** R181: set a detected CLI agent as the Run Center provider override. */
  const pickCliAgent = async (agent: CliAgentInfo) => {
    if (!agent.available) return;
    try {
      await fetch('/api/agent/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setRunDefault: true, providerId: agent.provider }),
      });
      flashSaved();
      void refresh();
      void refreshLabel();
    } catch {
      /* ignore */
    }
  };

  /** R181: clear the override — Run Center follows the shared default again. */
  const clearCliAgent = async () => {
    try {
      await fetch('/api/agent/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearRunDefault: true }),
      });
      flashSaved();
      void refresh();
      void refreshLabel();
    } catch {
      /* ignore */
    }
  };

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
            {label?.source === 'run-override' ? (
              <Terminal className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <Cpu className="h-3.5 w-3.5 text-claude-text-muted dark:text-[#9b9590] shrink-0" />
            )}
            <span className="font-medium text-claude-text dark:text-[#e8e4dd]">LLM</span>
            <span className={cn(
              'font-mono max-w-[220px] truncate',
              label?.source === 'run-override' ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground',
            )}>
              {label
                ? `${label.displayName}${label.model ? ` · ${label.model}` : ''}`
                : '…'}
            </span>
            <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-96 p-0 gap-0 overflow-hidden max-h-[80vh] overflow-y-auto">
          {/* Header */}
          <div className="px-3.5 py-2.5 border-b border-claude-border/50 bg-claude-bg-elevated sticky top-0 z-10">
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
            {/* R181: active CLI-agent override banner — the effective provider
                differs from the shared default; make that unmissable. */}
            {activeOverrideId && (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2 space-y-1.5">
                <div className="flex items-start gap-1.5">
                  <Terminal className="h-3 w-3 text-emerald-600 dark:text-emerald-300 mt-0.5 shrink-0" />
                  <span className="text-[10px] leading-relaxed text-emerald-700 dark:text-emerald-300">
                    {t.llmSettingsCliAgentActive}: <span className="font-mono">{activeOverrideId}</span>
                    {runDefault?.model ? ` · ${runDefault.model}` : ''}
                  </span>
                </div>
                <button
                  onClick={() => void clearCliAgent()}
                  className="inline-flex items-center gap-1 text-[10px] text-claude-accent hover:underline"
                >
                  <RotateCcw className="h-3 w-3" />
                  {t.llmSettingsCliFollowShared}
                </button>
              </div>
            )}

            {/* Provider select (shared default — used by chat + Run Center
                unless a CLI-agent override is active) */}
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

            {/* ── R181: Local CLI Agents (agent detection) ─────────────────── */}
            <div className="space-y-1.5 rounded-md border border-claude-border/60 dark:border-[#3d3832]/60 px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <ScanSearch className="h-3 w-3 text-claude-accent shrink-0" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-claude-text dark:text-[#e8e4dd] truncate">
                    {t.llmSettingsCliAgents}
                  </span>
                </div>
                <button
                  onClick={() => {
                    setScanning(true);
                    fetch('/api/agent/providers')
                      .then((r) => (r.ok ? r.json() : null))
                      .then((data) => {
                        if (data) {
                          setCliAgents(data.cliAgents ?? []);
                          setRunDefault(data.runDefault ?? null);
                        }
                      })
                      .catch(() => {})
                      .finally(() => setScanning(false));
                  }}
                  className="inline-flex items-center gap-0.5 text-[10px] text-claude-accent hover:underline shrink-0"
                  title={t.llmSettingsCliRescan}
                >
                  <RefreshCw className={cn('h-3 w-3', scanning && 'animate-spin')} />
                  {t.llmSettingsCliRescan}
                </button>
              </div>
              <p className="text-[10px] leading-relaxed text-claude-text-muted dark:text-[#9b9590]">
                {t.llmSettingsCliAgentsHint}
              </p>
              <div className="grid grid-cols-1 gap-1">
                {cliAgents.map((agent) => {
                  const isActive = activeOverrideId === agent.provider;
                  return (
                    <button
                      key={agent.provider}
                      type="button"
                      disabled={!agent.available}
                      onClick={() => void pickCliAgent(agent)}
                      title={
                        agent.available
                          ? `${agent.bin}${agent.available ? ` · ${t.llmSettingsCliAgentSet}` : ''}`
                          : agent.reason
                      }
                      className={cn(
                        'flex items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] border transition-colors',
                        isActive
                          ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : agent.available
                            ? 'border-transparent hover:border-claude-accent/40 hover:bg-claude-bg-elevated/50 text-claude-text dark:text-[#e8e4dd] cursor-pointer'
                            : 'border-transparent opacity-50 cursor-not-allowed text-claude-text-muted dark:text-[#9b9590]',
                      )}
                    >
                      <CliAgentIcon iconKey={agent.icon} className="h-3.5 w-3.5 shrink-0 text-claude-accent" />
                      <span className="flex-1 min-w-0 truncate">{agent.label}</span>
                      {isActive ? (
                        <span className="shrink-0 inline-flex items-center gap-0.5 text-[9px] font-medium">
                          <Check className="h-2.5 w-2.5" />
                          {t.llmSettingsCliAgentActive}
                        </span>
                      ) : agent.available ? (
                        <span className="shrink-0 text-[9px] text-emerald-600 dark:text-emerald-400">
                          {t.llmSettingsCliAgentSet}
                        </span>
                      ) : (
                        <span className="shrink-0 text-[9px]">{t.llmSettingsCliAgentUnavailable}</span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="text-[9px] leading-relaxed text-claude-text-muted/80 dark:text-[#9b9590]/80">
                {t.llmSettingsCliOverrideNote}
              </p>
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
