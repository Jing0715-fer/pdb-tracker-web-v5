/**
 * SessionSettingsPopover — a small popover for per-session agent settings.
 *
 * Lets the user override the model, temperature, max steps per turn, and an
 * optional system prompt override. Settings are persisted as a session/settings
 * event via POST /api/agent/sessions/[id]/settings.
 */

'use client';

import { useEffect, useState } from 'react';
import { Settings, X, Loader2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface SessionSettings {
  model?: string;
  temperature?: number;
  maxStepsPerTurn?: number;
  systemPromptOverride?: string;
}

interface Props {
  sessionId: string | null;
  open: boolean;
  onClose: () => void;
}

const DEFAULT_SETTINGS: Required<Omit<SessionSettings, 'systemPromptOverride'>> = {
  model: 'glm-4.6',
  temperature: 0.7,
  maxStepsPerTurn: 10,
};

export function SessionSettingsPopover({ sessionId, open, onClose }: Props) {
  const [settings, setSettings] = useState<SessionSettings>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load settings when the popover opens.
  useEffect(() => {
    if (!open || !sessionId) return;
    setLoading(true);
    fetch(`/api/agent/sessions/${sessionId}/settings`)
      .then((r) => r.json())
      .then((data: { settings?: SessionSettings }) => {
        setSettings(data.settings ?? {});
      })
      .catch(() => {
        /* best-effort */
      })
      .finally(() => setLoading(false));
  }, [open, sessionId]);

  if (!open) return null;

  const model = settings.model ?? DEFAULT_SETTINGS.model;
  const temperature = settings.temperature ?? DEFAULT_SETTINGS.temperature;
  const maxSteps = settings.maxStepsPerTurn ?? DEFAULT_SETTINGS.maxStepsPerTurn;
  const systemPromptOverride = settings.systemPromptOverride ?? '';

  const handleSave = async () => {
    if (!sessionId) return;
    setSaving(true);
    setSaved(false);
    try {
      await fetch(`/api/agent/sessions/${sessionId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: Number(temperature),
          maxStepsPerTurn: Number(maxSteps),
          systemPromptOverride: systemPromptOverride.trim() || undefined,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      /* best-effort */
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-[1px]" onClick={onClose}>
      <div
        className="w-80 rounded-lg border border-claude-border bg-claude-bg-surface shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-claude-border bg-claude-bg-elevated/50">
          <div className="flex items-center gap-1.5">
            <Settings className="h-3.5 w-3.5 text-claude-accent" />
            <span className="text-xs font-semibold text-claude-text">会话设置</span>
          </div>
          <button onClick={onClose} className="text-claude-text-muted hover:text-claude-text">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-claude-text-muted text-xs gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" />
            加载中…
          </div>
        ) : (
          <div className="p-3 space-y-3">
            {/* Model */}
            <div className="space-y-1">
              <Label className="text-xs text-claude-text">模型</Label>
              <Input
                value={model}
                onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))}
                className="h-7 text-xs bg-claude-bg-base border-claude-border"
                placeholder="glm-4.6"
              />
            </div>

            {/* Temperature */}
            <div className="space-y-1">
              <Label className="text-xs text-claude-text">温度 (Temperature)</Label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={temperature}
                  onChange={(e) => setSettings((s) => ({ ...s, temperature: Number(e.target.value) }))}
                  className="flex-1 h-1 accent-claude-accent"
                />
                <span className="text-xs font-mono text-claude-text-muted w-8 text-right tabular-nums">
                  {temperature.toFixed(1)}
                </span>
              </div>
            </div>

            {/* Max steps */}
            <div className="space-y-1">
              <Label className="text-xs text-claude-text">最大步数 / 轮</Label>
              <Input
                type="number"
                min={1}
                max={50}
                value={maxSteps}
                onChange={(e) => setSettings((s) => ({ ...s, maxStepsPerTurn: Number(e.target.value) }))}
                className="h-7 text-xs bg-claude-bg-base border-claude-border"
              />
            </div>

            {/* System prompt override */}
            <div className="space-y-1">
              <Label className="text-xs text-claude-text">系统提示词覆盖 (可选)</Label>
              <Textarea
                value={systemPromptOverride}
                onChange={(e) => setSettings((s) => ({ ...s, systemPromptOverride: e.target.value }))}
                className="min-h-[60px] max-h-32 text-xs bg-claude-bg-base border-claude-border resize-none"
                placeholder="留空使用默认系统提示词…"
                rows={3}
              />
            </div>

            {/* Save button */}
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving || !sessionId}
                className="h-7 text-xs bg-claude-accent hover:bg-claude-accent/90 text-white"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                ) : saved ? (
                  <Check className="h-3.5 w-3.5 mr-1 text-emerald-400" />
                ) : null}
                {saving ? '保存中…' : saved ? '已保存' : '保存'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
