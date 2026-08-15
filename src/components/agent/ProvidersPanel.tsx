/**
 * ProvidersPanel — a modal dialog for managing LLM provider configurations
 * (API keys + baseURLs + connection testing).
 *
 * Styled to match the app's Claude theme (bg-claude-*, text-claude-*, etc.)
 * and the DbSetupWizard's visual language (rounded cards, colored badges,
 * motion transitions).
 *
 * Lists all providers from the catalog with their availability status.
 * Each provider card is expandable: shows models, API key input, baseURL
 * override, test connection button, save button, delete button, docs link.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Key, Globe, Loader2, Check, AlertCircle, ExternalLink, RefreshCw,
  Trash2, Zap, ChevronDown, ShieldCheck,
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

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl w-[92vw] !max-w-2xl p-0 overflow-hidden gap-0">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-claude-border/50">
          <DialogTitle className="flex items-center gap-2 text-base leading-none">
            <Key className="h-4 w-4 text-claude-accent" />
            LLM 供应商配置
          </DialogTitle>
          <DialogDescription className="text-xs text-claude-text-muted mt-2 leading-relaxed">
            配置多个 LLM 供应商的 API Key，支持 DeepSeek、OpenAI、Anthropic、Qwen 等 OpenAI 兼容协议。配置后在会话设置中选择模型。
          </DialogDescription>
        </DialogHeader>

        {/* Toolbar */}
        <div className="px-6 py-2.5 border-b border-claude-border/50 flex items-center justify-between bg-claude-bg-elevated/30">
          <div className="flex items-center gap-2 text-[10px] text-claude-text-muted">
            {providers.filter((p) => p.available).length} / {providers.length} 个供应商可用
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void refresh()}
            disabled={loading}
            className="h-6 text-[10px] text-claude-text-muted hover:text-claude-text"
          >
            <RefreshCw className={cn('h-3 w-3 mr-1', loading && 'animate-spin')} />
            刷新
          </Button>
        </div>

        {/* Provider list */}
        <div className="px-6 py-4 max-h-[60vh] overflow-y-auto space-y-2.5">
          {loading && providers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-claude-text-muted" />
              <p className="text-xs text-claude-text-muted">加载中…</p>
            </div>
          ) : (
            <AnimatePresence mode="popLayout">
              {providers.map((p) => (
                <ProviderCard key={p.id} provider={p} onChanged={() => void refresh()} />
              ))}
            </AnimatePresence>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-claude-border/50 bg-claude-bg-elevated/30">
          <div className="flex items-start gap-2 text-[10px] text-claude-text-muted leading-relaxed">
            <ShieldCheck className="h-3 w-3 shrink-0 mt-0.5 text-claude-text-muted" />
            <span>
              API Key 存储在本地文件 (<code className="font-mono">.hermes/agent-providers.json</code>)，
              不会上传到服务器日志。支持所有 OpenAI 兼容协议的供应商。
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'rounded-lg border transition-all overflow-hidden',
        provider.available
          ? 'border-claude-accent/30 bg-claude-accent-light/30'
          : 'border-claude-border bg-claude-surface',
        expanded && 'shadow-sm',
      )}
    >
      {/* Header row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-claude-bg-elevated/30 transition-colors"
      >
        <span className="text-xl shrink-0">{provider.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-claude-text truncate">{provider.displayName}</span>
            {provider.available ? (
              <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-normal border-emerald-500/40 text-emerald-600 bg-emerald-500/10 shrink-0">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 mr-1" />
                可用
              </Badge>
            ) : (
              <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-normal border-claude-border text-claude-text-muted bg-claude-bg-elevated shrink-0">
                未配置
              </Badge>
            )}
            {provider.hasApiKey && (
              <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-normal border-sky-500/40 text-sky-600 bg-sky-500/10 shrink-0">
                <Key className="h-2 w-2 mr-0.5" />
                Key
              </Badge>
            )}
            {provider.hasBaseURLOverride && (
              <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-normal border-amber-500/40 text-amber-600 bg-amber-500/10 shrink-0">
                <Globe className="h-2 w-2 mr-0.5" />
                URL
              </Badge>
            )}
          </div>
          <div className="text-[10px] text-claude-text-muted truncate mt-0.5">
            {provider.models.length} 个模型 · 默认: <code className="font-mono">{provider.defaultModel}</code>
          </div>
        </div>
        <ChevronDown className={cn('h-4 w-4 text-claude-text-muted shrink-0 transition-transform', expanded && 'rotate-180')} />
      </button>

      {/* Expanded config */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 border-t border-claude-border/50 space-y-3">
              {/* Models list */}
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-claude-text-muted mb-1.5 block">
                  可用模型
                </Label>
                <div className="flex flex-wrap gap-1">
                  {provider.models.map((m) => (
                    <Badge key={m.id} variant="outline" className="text-[9px] h-5 px-1.5 font-mono text-claude-text-secondary border-claude-border bg-claude-bg-elevated">
                      {m.id}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* API key input */}
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-claude-text-muted mb-1.5 flex items-center gap-1">
                  <Key className="h-2.5 w-2.5" />
                  API Key
                  {provider.hasApiKey && <span className="text-emerald-600 normal-case tracking-normal">（已设置 · 输入新值替换）</span>}
                </Label>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={`输入 ${provider.displayName} API Key…`}
                  className="h-8 text-xs bg-claude-bg-base border-claude-border font-mono"
                />
              </div>

              {/* Base URL override */}
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-claude-text-muted mb-1.5 flex items-center gap-1">
                  <Globe className="h-2.5 w-2.5" />
                  Base URL
                  {provider.hasBaseURLOverride && <span className="text-amber-600 normal-case tracking-normal">（已覆盖）</span>}
                </Label>
                <Input
                  type="text"
                  value={baseURL}
                  onChange={(e) => setBaseURL(e.target.value)}
                  placeholder={provider.baseURL}
                  className="h-8 text-xs bg-claude-bg-base border-claude-border font-mono"
                />
                <p className="text-[10px] text-claude-text-muted mt-1">
                  默认: <code className="font-mono">{provider.baseURL}</code>
                </p>
              </div>

              {/* Test result */}
              {testResult && (
                <div className={cn(
                  'rounded-md px-3 py-2 text-[11px] flex items-center gap-1.5 border',
                  testResult.ok
                    ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
                    : 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300',
                )}>
                  {testResult.ok ? <Check className="h-3 w-3 shrink-0" /> : <AlertCircle className="h-3 w-3 shrink-0" />}
                  <span className="break-words">{testResult.ok ? '连接成功！供应商可用。' : testResult.error}</span>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-between gap-2 pt-1">
                <a
                  href={provider.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-claude-text-muted hover:text-claude-accent flex items-center gap-0.5 transition-colors"
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
                      className="h-7 text-[10px] text-red-600 hover:text-red-700 hover:bg-red-500/10"
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
                    className="h-7 text-[10px] border-claude-border"
                  >
                    {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                    测试
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={saving || (!apiKey && !baseURL)}
                    className="h-7 text-[10px] bg-claude-accent hover:bg-claude-accent-hover text-white"
                  >
                    {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    保存
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
