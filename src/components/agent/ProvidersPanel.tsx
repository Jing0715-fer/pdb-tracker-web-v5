/**
 * ProvidersPanel — a simplified modal for managing LLM provider API keys.
 *
 * UI: a single dropdown to select a provider → Base URL auto-fills →
 * API Key input → Save / Test buttons.
 *
 * Also shows a compact list of already-configured providers below.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Key, Globe, Loader2, Check, AlertCircle, ExternalLink, RefreshCw,
  Trash2, Zap, ShieldCheck, Plus, Box, ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
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
  open: boolean;
  onClose: () => void;
}

export function ProvidersPanel({ open, onClose }: Props) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [defaultProvider, setDefaultProvider] = useState<string>('zai');
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/agent/providers');
      if (!res.ok) return;
      const data = (await res.json()) as { providers: ProviderInfo[]; defaultProvider?: string };
      setProviders(data.providers ?? []);
      setDefaultProvider(data.defaultProvider ?? 'zai');
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const configuredProviders = providers.filter((p) => p.hasApiKey || p.id === 'zai');
  const unconfiguredProviders = providers.filter((p) => !p.hasApiKey && p.id !== 'zai');

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg w-[92vw] !max-w-lg p-0 overflow-hidden gap-0">
        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-claude-border/50">
          <DialogTitle className="flex items-center gap-2 text-sm leading-none">
            <Key className="h-4 w-4 text-claude-accent" />
            供应商配置
          </DialogTitle>
          <DialogDescription className="text-xs text-claude-text-muted mt-2 leading-relaxed">
            选择供应商并输入 API Key，Base URL 将自动填充。
          </DialogDescription>
        </DialogHeader>

        {/* Content */}
        <div className="px-5 py-4 max-h-[65vh] overflow-y-auto space-y-4">
          {loading && providers.length === 0 ? (
            <div className="flex items-center justify-center py-8 gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-claude-text-muted" />
              <span className="text-xs text-claude-text-muted">加载中…</span>
            </div>
          ) : (
            <>
              {/* Add new provider */}
              <AddProviderForm providers={unconfiguredProviders} onSaved={() => void refresh()} />

              {/* Configured providers list */}
              {configuredProviders.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-claude-text-muted mb-2 flex items-center justify-between">
                    <span>已配置 ({configuredProviders.length})</span>
                    <span className="text-[9px] text-claude-text-muted/60">点击选中默认供应商</span>
                  </div>
                  <div className="space-y-1.5">
                    {configuredProviders.map((p) => (
                      <ConfiguredProviderRow
                        key={p.id}
                        provider={p}
                        isDefault={defaultProvider === p.id}
                        onSetDefault={async (id) => {
                          await fetch('/api/agent/providers', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ providerId: id, setDefault: true }),
                          });
                          setDefaultProvider(id);
                        }}
                        onChanged={() => void refresh()}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-claude-border/50 bg-claude-bg-elevated/30 flex items-center gap-2">
          <ShieldCheck className="h-3 w-3 text-claude-text-muted shrink-0" />
          <span className="text-[10px] text-claude-text-muted">
            API Key 存储在本地，不上传服务器日志
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void refresh()}
            disabled={loading}
            className="ml-auto h-6 text-[10px] text-claude-text-muted"
          >
            <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Form for adding a new provider — dropdown + auto-filled baseURL + API key input. */
function AddProviderForm({ providers, onSaved }: { providers: ProviderInfo[]; onSaved: () => void }) {
  const [selectedId, setSelectedId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [customModel, setCustomModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);

  // Auto-fill baseURL + default model when provider changes.
  useEffect(() => {
    const selected = providers.find((p) => p.id === selectedId);
    if (selected) {
      setBaseURL(selected.baseURL);
      setSelectedModel(selected.defaultModel);
      setUseCustomModel(false);
      setCustomModel('');
    }
  }, [selectedId, providers]);

  const selected = providers.find((p) => p.id === selectedId);
  const effectiveModel = useCustomModel ? customModel.trim() : selectedModel;

  const handleSave = async () => {
    if (!selectedId || !apiKey.trim()) return;
    setSaving(true);
    try {
      await fetch('/api/agent/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: selectedId, apiKey: apiKey.trim(), baseURL: baseURL.trim() || undefined, defaultModel: effectiveModel || undefined }),
      });
      setSelectedId('');
      setApiKey('');
      setBaseURL('');
      setSelectedModel('');
      setCustomModel('');
      setUseCustomModel(false);
      setTestResult(null);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!selectedId || !apiKey.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      await fetch('/api/agent/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: selectedId, apiKey: apiKey.trim(), baseURL: baseURL.trim() || undefined, defaultModel: effectiveModel || undefined }),
      });
      const res = await fetch('/api/agent/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: selectedId }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      setTestResult(data);
      if (data.ok) {
        setSelectedId('');
        setApiKey('');
        setBaseURL('');
        setSelectedModel('');
        setCustomModel('');
        setUseCustomModel(false);
        onSaved();
      }
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  if (providers.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-claude-border bg-claude-bg-elevated/30 px-4 py-6 text-center">
        <Check className="h-4 w-4 text-emerald-500 mx-auto mb-1.5" />
        <p className="text-xs text-claude-text-muted">所有供应商已配置。</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-claude-border bg-claude-surface p-4 space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-claude-text">
        <Plus className="h-3.5 w-3.5 text-claude-accent" />
        添加供应商
      </div>

      {/* Provider dropdown */}
      <div>
        <Label className="text-[10px] uppercase tracking-wider text-claude-text-muted mb-1.5 block">供应商</Label>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="w-full h-8 text-xs bg-claude-bg-base border border-claude-border rounded px-2 focus:outline-none focus:ring-1 focus:ring-claude-accent/30"
        >
          <option value="">选择供应商…</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>{p.displayName}</option>
          ))}
        </select>
      </div>

      {/* Base URL (auto-filled) */}
      {selected && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-3">
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-claude-text-muted mb-1.5 flex items-center gap-1">
              <Globe className="h-2.5 w-2.5" />
              Base URL
            </Label>
            <Input
              type="text"
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
              className="h-8 text-xs bg-claude-bg-base border-claude-border font-mono"
            />
          </div>

          {/* Model selector */}
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-claude-text-muted mb-1.5 flex items-center gap-1">
              <Box className="h-2.5 w-2.5" />
              默认模型
            </Label>
            {!useCustomModel ? (
              <>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full h-8 text-xs bg-claude-bg-base border border-claude-border rounded px-2 focus:outline-none focus:ring-1 focus:ring-claude-accent/30"
                >
                  {selected.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.id})
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => { setUseCustomModel(true); setCustomModel(selectedModel); }}
                  className="mt-1 text-[10px] text-claude-accent hover:underline"
                >
                  + 自定义模型…
                </button>
              </>
            ) : (
              <div className="flex gap-1.5">
                <Input
                  type="text"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  placeholder="输入自定义模型 ID…"
                  className="h-8 text-xs bg-claude-bg-base border-claude-border font-mono flex-1"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setUseCustomModel(false); }}
                  className="h-8 text-[10px] text-claude-text-muted shrink-0"
                >
                  列表
                </Button>
              </div>
            )}
          </div>

          {/* API Key */}
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-claude-text-muted mb-1.5 flex items-center gap-1">
              <Key className="h-2.5 w-2.5" />
              API Key
            </Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={`输入 ${selected.displayName} API Key…`}
              className="h-8 text-xs bg-claude-bg-base border-claude-border font-mono"
            />
          </div>

          {/* Test result */}
          {testResult && (
            <div className={cn(
              'rounded-md px-2.5 py-1.5 text-[11px] flex items-center gap-1.5 border',
              testResult.ok
                ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
                : 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300',
            )}>
              {testResult.ok ? <Check className="h-3 w-3 shrink-0" /> : <AlertCircle className="h-3 w-3 shrink-0" />}
              <span className="break-words">{testResult.ok ? '连接成功！' : testResult.error}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <a
              href={selected.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-claude-text-muted hover:text-claude-accent flex items-center gap-0.5 transition-colors"
            >
              <ExternalLink className="h-2.5 w-2.5" />
              获取 Key
            </a>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={handleTest}
                disabled={testing || !apiKey.trim()}
                className="h-7 text-[10px] border-claude-border"
              >
                {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                测试并保存
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving || !apiKey.trim()}
                className="h-7 text-[10px] bg-claude-accent hover:bg-claude-accent-hover text-white"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                保存
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

/** A single configured provider row with default indicator, expand to edit, test, delete. */
function ConfiguredProviderRow({ provider, isDefault, onSetDefault, onChanged }: {
  provider: ProviderInfo;
  isDefault: boolean;
  onSetDefault: (id: string) => Promise<void>;
  onChanged: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [editApiKey, setEditApiKey] = useState('');
  const [editBaseURL, setEditBaseURL] = useState('');
  const [editModel, setEditModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await fetch(`/api/agent/providers?providerId=${provider.id}`, { method: 'DELETE' });
      onChanged();
    } finally {
      setDeleting(false);
    }
  };

  const handleExpand = () => {
    if (!expanded) {
      // Pre-fill edit fields with current values
      setEditBaseURL(provider.baseURL);
      setEditModel(provider.effectiveModel || provider.defaultModel);
      setEditApiKey('');
    }
    setExpanded(!expanded);
  };

  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSaving(true);
    try {
      await fetch('/api/agent/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: provider.id,
          apiKey: editApiKey.trim() || undefined,
          baseURL: editBaseURL.trim() || undefined,
          defaultModel: editModel.trim() || undefined,
        }),
      });
      setEditApiKey('');
      setExpanded(false);
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (e: React.MouseEvent) => {
    e.stopPropagation();
    // Save first if there are unsaved edits
    if (editApiKey.trim() || editBaseURL !== provider.baseURL || editModel !== (provider.effectiveModel || provider.defaultModel)) {
      setSaving(true);
      await fetch('/api/agent/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: provider.id,
          apiKey: editApiKey.trim() || undefined,
          baseURL: editBaseURL.trim() || undefined,
          defaultModel: editModel.trim() || undefined,
        }),
      });
      setSaving(false);
      setEditApiKey('');
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/agent/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: provider.id }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      setTestResult(data);
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className={cn(
      'rounded-md border transition-colors overflow-hidden',
      isDefault
        ? 'border-claude-accent bg-claude-accent-light/20 ring-1 ring-claude-accent/30'
        : provider.available
          ? 'border-emerald-500/30 bg-emerald-500/5'
          : 'border-claude-border bg-claude-surface',
    )}>
      {/* Header row — click to set default, has expand chevron */}
      <div
        className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-claude-bg-elevated/30 transition-colors"
        onClick={() => void onSetDefault(provider.id)}
      >
        {/* Radio indicator */}
        <div className={cn(
          'h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors',
          isDefault ? 'border-claude-accent' : 'border-claude-border',
        )}>
          {isDefault && <div className="h-2 w-2 rounded-full bg-claude-accent" />}
        </div>
        {/* Label badge */}
        <div className={cn(
          'w-8 h-8 rounded shrink-0 flex items-center justify-center text-[10px] font-bold',
          provider.available
            ? 'bg-emerald-500/15 text-emerald-600'
            : 'bg-claude-bg-elevated text-claude-text-muted',
        )}>
          {provider.label}
        </div>
        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-claude-text truncate">{provider.displayName}</span>
            {isDefault && (
              <Badge variant="outline" className="h-4 px-1 text-[9px] border-claude-accent/40 text-claude-accent bg-claude-accent/10 shrink-0">
                默认
              </Badge>
            )}
            {provider.available && !isDefault && (
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
            )}
          </div>
          <div className="text-[10px] text-claude-text-muted truncate">
            <span className="font-mono">{provider.effectiveModel || provider.defaultModel}</span>
          </div>
        </div>
        {/* Actions */}
        {provider.id !== 'zai' && (
          <button
            onClick={(e) => { e.stopPropagation(); void handleExpand(); }}
            className="shrink-0 text-claude-text-muted hover:text-claude-accent transition-colors p-1"
            title={expanded ? "收起" : "编辑"}
          >
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
          </button>
        )}
        {provider.id !== 'zai' && (
          <button
            onClick={(e) => { e.stopPropagation(); void handleDelete(); }}
            disabled={deleting}
            className="shrink-0 text-claude-text-muted hover:text-red-500 transition-colors p-1"
            title="删除"
          >
            {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          </button>
        )}
      </div>

      {/* Expanded edit panel */}
      {expanded && provider.id !== 'zai' && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="overflow-hidden"
        >
          <div className="px-3 pb-3 pt-1 border-t border-claude-border/50 space-y-2.5">
            {/* API Key */}
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-claude-text-muted mb-1 flex items-center gap-1">
                <Key className="h-2.5 w-2.5" />
                API Key {provider.hasApiKey && <span className="text-emerald-600 normal-case tracking-normal">（已设置，输入新值替换）</span>}
              </Label>
              <Input
                type="password"
                value={editApiKey}
                onChange={(e) => setEditApiKey(e.target.value)}
                placeholder={provider.hasApiKey ? '••••••••（输入新值替换）' : '输入 API Key…'}
                className="h-8 text-xs bg-claude-bg-base border-claude-border font-mono"
              />
            </div>
            {/* Base URL */}
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-claude-text-muted mb-1 flex items-center gap-1">
                <Globe className="h-2.5 w-2.5" />
                Base URL
              </Label>
              <Input
                type="text"
                value={editBaseURL}
                onChange={(e) => setEditBaseURL(e.target.value)}
                className="h-8 text-xs bg-claude-bg-base border-claude-border font-mono"
              />
            </div>
            {/* Model */}
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-claude-text-muted mb-1 flex items-center gap-1">
                <Box className="h-2.5 w-2.5" />
                默认模型
              </Label>
              <select
                value={editModel}
                onChange={(e) => setEditModel(e.target.value)}
                className="w-full h-8 text-xs bg-claude-bg-base border border-claude-border rounded px-2 focus:outline-none focus:ring-1 focus:ring-claude-accent/30"
              >
                {provider.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.id})
                  </option>
                ))}
                {/* Include current if not in list */}
                {!provider.models.some((m) => m.id === editModel) && editModel && (
                  <option value={editModel}>{editModel}</option>
                )}
              </select>
            </div>
            {/* Test result */}
            {testResult && (
              <div className={cn(
                'rounded-md px-2.5 py-1.5 text-[11px] flex items-center gap-1.5 border',
                testResult.ok
                  ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
                  : 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300',
              )}>
                {testResult.ok ? <Check className="h-3 w-3 shrink-0" /> : <AlertCircle className="h-3 w-3 shrink-0" />}
                <span className="break-words">{testResult.ok ? '连接成功！' : testResult.error}</span>
              </div>
            )}
            {/* Action buttons */}
            <div className="flex items-center justify-end gap-1.5 pt-1">
              <Button
                size="sm"
                variant="outline"
                onClick={handleTest}
                disabled={testing}
                className="h-7 text-[10px] border-claude-border"
              >
                {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                测试
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving || (!editApiKey.trim() && editBaseURL === provider.baseURL && editModel === (provider.effectiveModel || provider.defaultModel))}
                className="h-7 text-[10px] bg-claude-accent hover:bg-claude-accent-hover text-white"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                保存
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
