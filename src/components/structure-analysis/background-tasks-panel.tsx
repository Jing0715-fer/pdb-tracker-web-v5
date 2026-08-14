'use client';

/**
 * BackgroundTasksPanel — Popover that shows running/completed background tasks.
 *
 * Listens to `background-task-update` window events (dispatched by
 * backgroundTaskManager) and displays:
 *   - Task title + module badge
 *   - Progress bar (for running tasks)
 *   - Status icon (pending/running/completed/failed/cancelled)
 *   - Cancel button (for running tasks)
 *   - Cleanup button (to clear finished tasks)
 *
 * A trigger button in the chat header shows a badge with the count of
 * active tasks.
 */

import { useEffect, useState, useCallback } from 'react';
import { backgroundTaskManager, type BackgroundTask, type TaskModule } from '@/lib/molcraft/background-tasks';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Trash2,
  ListChecks,
  AlertCircle,
} from 'lucide-react';

const MODULE_LABELS: Record<TaskModule, string> = {
  literature: '文献',
  eval: '评估',
  weekly: '周报',
  analysis: '分析',
  custom: '自定义',
};

const MODULE_COLORS: Record<TaskModule, string> = {
  literature: 'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300',
  eval: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300',
  weekly: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
  analysis: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  custom: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

function StatusIcon({ status }: { status: BackgroundTask['status'] }) {
  switch (status) {
    case 'pending':
      return <Clock className="h-3.5 w-3.5 text-slate-400" />;
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />;
    case 'completed':
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case 'failed':
      return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    case 'cancelled':
      return <AlertCircle className="h-3.5 w-3.5 text-amber-500" />;
    default:
      return null;
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

export function BackgroundTasksPanel() {
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  const [open, setOpen] = useState(false);

  const sync = useCallback(() => {
    setTasks(backgroundTaskManager.list());
  }, []);

  useEffect(() => {
    // Sync on mount and whenever the popover opens/closes
    sync();
    const handleUpdate = () => sync();
    if (typeof window !== 'undefined') {
      window.addEventListener('background-task-update', handleUpdate);
    }
    const interval = setInterval(sync, 1000);
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('background-task-update', handleUpdate);
      }
      clearInterval(interval);
    };
  }, [sync, open]);

  const activeCount = tasks.filter((t) => t.status === 'running' || t.status === 'pending').length;
  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const failedCount = tasks.filter((t) => t.status === 'failed').length;

  const handleCancel = (id: string) => {
    backgroundTaskManager.cancel(id);
    sync();
  };

  const handleCleanup = () => {
    backgroundTaskManager.cleanup();
    sync();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative h-8 gap-1.5 text-xs"
          aria-label="后台任务"
        >
          <ListChecks className="h-4 w-4" />
          <span className="hidden sm:inline">后台任务</span>
          {activeCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-bold text-white">
              {activeCount}
            </span>
          )}
          {activeCount === 0 && tasks.length > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-slate-400 px-1 text-[10px] font-bold text-white">
              {tasks.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 sm:w-96 p-0" align="end">
        <div className="flex items-center justify-between px-3 py-2.5 border-b">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-slate-500" />
            <span className="text-sm font-semibold">后台任务</span>
            <div className="flex items-center gap-1 ml-1">
              {activeCount > 0 && (
                <Badge variant="secondary" className="text-[10px] h-5 bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                  {activeCount} 进行中
                </Badge>
              )}
              {completedCount > 0 && (
                <Badge variant="secondary" className="text-[10px] h-5 bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                  {completedCount} 完成
                </Badge>
              )}
              {failedCount > 0 && (
                <Badge variant="secondary" className="text-[10px] h-5 bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300">
                  {failedCount} 失败
                </Badge>
              )}
            </div>
          </div>
          {tasks.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs px-2"
              onClick={handleCleanup}
              title="清除已完成任务"
            >
              <Trash2 className="h-3 w-3 mr-1" />
              清理
            </Button>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto">
          {tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
              <div className="p-3 rounded-full bg-slate-100 dark:bg-slate-800 mb-2">
                <ListChecks className="h-6 w-6 text-slate-400" />
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400">暂无后台任务</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                Agent 分析任务会在此显示
              </p>
            </div>
          ) : (
            <div className="flex flex-col divide-y">
              {tasks.map((task) => (
                <TaskRow key={task.id} task={task} onCancel={handleCancel} />
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TaskRow({ task, onCancel }: { task: BackgroundTask; onCancel: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const duration = task.completedAt
    ? task.completedAt - (task.startedAt || task.createdAt)
    : task.startedAt
      ? Date.now() - task.startedAt
      : 0;

  return (
    <div className="px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex-shrink-0">
          <StatusIcon status={task.status} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
            <Badge className={`text-[9px] h-4 px-1 ${MODULE_COLORS[task.module]}`} variant="secondary">
              {MODULE_LABELS[task.module]}
            </Badge>
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
              {task.title}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-slate-400 dark:text-slate-500">
            <span>{formatTime(task.createdAt)}</span>
            {duration > 0 && <span>· {formatDuration(duration)}</span>}
            {task.status === 'running' && (
              <span className="text-blue-500">· {task.progress}%</span>
            )}
          </div>
          {task.status === 'running' && (
            <Progress value={task.progress} className="h-1 mt-1.5" />
          )}
          {task.error && (
            <p className="text-[11px] text-red-500 mt-1 break-words">{task.error}</p>
          )}
          {task.events.length > 0 && (
            <button
              className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 mt-1 flex items-center gap-1"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? '收起' : `查看日志 (${task.events.length})`}
            </button>
          )}
          {expanded && task.events.length > 0 && (
            <div className="mt-1.5 max-h-32 overflow-y-auto bg-slate-50 dark:bg-slate-900 rounded p-2 text-[10px] font-mono space-y-0.5">
              {task.events.slice(-20).map((evt, i) => (
                <div key={i} className="flex gap-1.5">
                  <span className="text-slate-400 flex-shrink-0">{formatTime(evt.timestamp)}</span>
                  <span className={`flex-shrink-0 ${
                    evt.type === 'completed' ? 'text-emerald-500' :
                    evt.type === 'failed' ? 'text-red-500' :
                    evt.type === 'started' ? 'text-blue-500' :
                    'text-slate-500'
                  }`}>[{evt.type}]</span>
                  <span className="text-slate-600 dark:text-slate-400 break-words">{evt.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {(task.status === 'running' || task.status === 'pending') && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs px-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 flex-shrink-0"
            onClick={() => onCancel(task.id)}
          >
            取消
          </Button>
        )}
      </div>
    </div>
  );
}
