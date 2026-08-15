/**
 * ProvidersPanel — a full-screen modal for managing LLM provider
 * configurations (API keys + baseURLs + connection testing).
 *
 * Lists all providers from the catalog with their availability status.
 * Each provider has: API key input (password), baseURL override input,
 * test connection button, save button.
 *
 * Fetches from GET /api/agent/providers, saves via POST /api/agent/providers,
 * tests via POST /api/agent/providers/test.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { X, Key, Globe, Loader2, Check, AlertCircle, ExternalLink, RefreshCw, Trash2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ProviderModel {
  id: string;
  name: string;
  contextWindow?: number;
}

interface ProviderInfo {
  id: string;
  displayName: string;
  baseURL: string;
  apiKeyEnv: string;
  defaultModel: string;
  models: ProviderModel[];
  supportsToolCalling: boolean;
  icon: string;
  docsUrl: string;
  available: boolean;
  hasApiKey: boolean;
  hasBaseURLOverride: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ProvidersPanel({ open, onClose }: Props) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/agent/providers');
      if (!res.ok) return;
      const data = (await res.json()) as { providers: ProviderInfo[] };
      setProviders(data.providers ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] rounded-xl border border-claude-border bg-claude-bg-surface shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-claude-border bg-claude-bg-elevated/50 shrink-0">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-claude-accent" />
            <span className="text-sm font-semibold text-claude-text">LLM 供应商配置</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void refresh()}
              disabled={loading}
              className="h-7 text-xs"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              刷新
            </Button>
            <button onClick={onClose} className="text-claude-text-muted hover:text-claude-text">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Provider list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
          {loading && providers.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-claude-text-muted text-sm gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              加载中…
            </div>
          ) : (
            providers.map((p) => <ProviderCard key={p.id} provider={p} onChanged={() => void refresh()} />)
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-claude-border bg-claude-bg-elevated/30 text-[10px] text-claude-text-muted shrink-0">
          API 密钥存储在本地文件 (.hermes/agent-providers.json)，不会上传到服务器日志。
          支持 OpenAI 兼容协议的供应商均可配置。
        </div>
      </div>
    </div>
  );
}

function ProviderCard({ provider, onChanged }: { provider: ProviderInfo; onChanged: () => void }) {
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [expanded, setExpanded] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch('/api/agent/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: provider.id,
          apiKey: apiKey || undefined,
          baseURL: baseURL || undefined,
        }),
      });
      setApiKey('');
      setBaseURL('');
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // If there's a new API key entered, save it first before testing.
      if (apiKey || baseURL) {
        await fetch('/api/agent/providers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            providerId: provider.id,
            apiKey: apiKey || undefined,
            baseURL: baseURL || undefined,
          }),
        });
        setApiKey('');
        setBaseURL('');
        onChanged();
      }
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

  const handleDelete = async () => {
    await fetch(`/api/agent/providers?providerId=${provider.id}`, { method: 'DELETE' });
    onChanged();
  };

  return (
    <div className={cn(
      'rounded-lg border transition-colors',
      provider.available
        ? 'border-claude-accent/30 bg-claude-bg-elevated/30'
        : 'border-claude-border bg-claude-bg-base',
    )}>
      {/* Header row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
      >
        <span className="text-lg shrink-0">{provider.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-claude-text truncate">{provider.displayName}</span>
            {provider.available ? (
              <Badge variant="outline" className="h-4 px-1 text-[9px] border-emerald-500/40 text-emerald-600 bg-emerald-500/10">
                <span className="inline-block h-1 w-1 rounded-full bg-emerald-500 mr-1" />
                可用
              </Badge>
            ) : (
              <Badge variant="outline" className="h-4 px-1 text-[9px] border-claude-border text-claude-text-muted">
                未配置
              </Badge>
            )}
            {provider.hasApiKey && (
              <Badge variant="outline" className="h-4 px-1 text-[9px] border-sky-500/40 text-sky-600 bg-sky-500/10">
                <Key className="h-2 w-2 mr-0.5" />
                Key
              </Badge>
            )}
          </div>
          <div className="text-[10px] text-claude-text-muted truncate mt-0.5">
            {provider.models.length} 个模型 · 默认: {provider.defaultModel}
          </div>
        </div>
        <span className={cn('text-claude-text-muted transition-transform shrink-0', expanded && 'rotate-90')}>
          ›
        </span>
      </button>

      {/* Expanded config */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-claude-border/50 space-y-2.5 animate-in fade-in slide-in-from-top-1 duration-200">
          {/* Models list */}
          <div className="flex flex-wrap gap-1">
            {provider.models.map((m) => (
              <Badge key={m.id} variant="outline" className="text-[9px] h-4 px-1.5 font-mono text-claude-text-muted">
                {m.id}
              </Badge>
            ))}
          </div>

          {/* API key input */}
          <div className="space-y-1">
            <Label className="text-[10px] text-claude-text-muted flex items-center gap-1">
              <Key className="h-2.5 w-2.5" />
              API Key {provider.hasApiKey && <span className="text-emerald-600">(已设置)</span>}
            </Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={provider.hasApiKey ? '••••••••（输入新值替换）' : `输入 ${provider.displayName} API Key…`}
              className="h-7 text-xs bg-claude-bg-base border-claude-border font-mono"
            />
          </div>

          {/* Base URL override */}
          <div className="space-y-1">
            <Label className="text-[10px] text-claude-text-muted flex items-center gap-1">
              <Globe className="h-2.5 w-2.5" />
              Base URL {provider.hasBaseURLOverride && <span className="text-amber-600">(已覆盖)</span>}
            </Label>
            <Input
              type="text"
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
              placeholder={provider.baseURL}
              className="h-7 text-xs bg-claude-bg-base border-claude-border font-mono"
            />
          </div>

          {/* Test result */}
          {testResult && (
            <div className={cn(
              'rounded-md px-2 py-1.5 text-[10px] flex items-center gap-1.5',
              testResult.ok
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'bg-red-500/10 text-red-700 dark:text-red-300',
            )}>
              {testResult.ok ? <Check className="h-3 w-3 shrink-0" /> : <AlertCircle className="h-3 w-3 shrink-0" />}
              <span className="break-words">{testResult.ok ? '连接成功' : testResult.error}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <a
              href={provider.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-claude-text-muted hover:text-claude-accent flex items-center gap-0.5"
            >
              <ExternalLink className="h-2.5 w-2.5" />
              获取 API Key
            </a>
            <div className="flex items-center gap-1.5">
              {provider.hasApiKey && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleDelete}
                  className="h-6 text-[10px] text-red-600 hover:text-red-700 hover:bg-red-500/10"
                >
                  <Trash2 className="h-3 w-3 mr-0.5" />
                  删除
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={handleTest}
                disabled={testing || (!provider.hasApiKey && !apiKey)}
                className="h-6 text-[10px]"
              >
                {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                测试
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving || (!apiKey && !baseURL)}
                className="h-6 text-[10px] bg-claude-accent hover:bg-claude-accent/90 text-white"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                保存
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

