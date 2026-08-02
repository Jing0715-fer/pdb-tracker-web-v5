'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react';

// ─── Custom Toast Types ──────────────────────────────────────────────────────

export type CustomToastType = 'success' | 'error' | 'info' | 'warning';

interface CustomToastProps {
  id: string;
  type: CustomToastType;
  title: string;
  description?: string;
  duration?: number;
  onClose: (id: string) => void;
}

// ─── Type Config ──────────────────────────────────────────────────────────────

const TOAST_CONFIG: Record<CustomToastType, {
  borderColor: string;
  bgColor: string;
  iconBg: string;
  icon: React.ReactNode;
}> = {
  success: {
    borderColor: 'border-l-green-500',
    bgColor: 'bg-green-50 dark:bg-green-900/10',
    iconBg: 'bg-green-100 dark:bg-green-900/30',
    icon: <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />,
  },
  error: {
    borderColor: 'border-l-red-500',
    bgColor: 'bg-red-50 dark:bg-red-900/10',
    iconBg: 'bg-red-100 dark:bg-red-900/30',
    icon: <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />,
  },
  info: {
    borderColor: 'border-l-teal-500',
    bgColor: 'bg-teal-50 dark:bg-teal-900/10',
    iconBg: 'bg-teal-100 dark:bg-teal-900/30',
    icon: <Info className="h-4 w-4 text-teal-600 dark:text-teal-400" />,
  },
  warning: {
    borderColor: 'border-l-amber-500',
    bgColor: 'bg-amber-50 dark:bg-amber-900/10',
    iconBg: 'bg-amber-100 dark:bg-amber-900/30',
    icon: <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />,
  },
};

// ─── Toast Component ──────────────────────────────────────────────────────────

function CustomToast({ id, type, title, description, duration = 4000, onClose }: CustomToastProps) {
  const [progress, setProgress] = useState(100);
  const [isPaused, setIsPaused] = useState(false);

  const config = TOAST_CONFIG[type];

  useEffect(() => {
    if (isPaused) return;

    const startTime = Date.now();
    const totalDuration = duration;

    const tick = () => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / totalDuration) * 100);
      setProgress(remaining);

      if (remaining <= 0) {
        onClose(id);
        return;
      }

      requestAnimationFrame(tick);
    };

    const raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [id, duration, isPaused, onClose]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 80, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 80, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className={`pointer-events-auto border-l-4 ${config.borderColor} ${config.bgColor} rounded-lg shadow-lg border border-claude-border/30 dark:border-[#3d3832]/30 max-w-sm overflow-hidden`}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div className="flex items-start gap-2.5 p-3">
        {/* Icon */}
        <div className={`flex-shrink-0 p-1 rounded-md ${config.iconBg}`}>
          {config.icon}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-claude-text">{title}</div>
          {description && (
            <div className="text-[11px] text-claude-text-secondary mt-0.5 line-clamp-2">{description}</div>
          )}
        </div>

        {/* Close button */}
        <button
          onClick={() => onClose(id)}
          className="flex-shrink-0 h-5 w-5 rounded flex items-center justify-center text-claude-text-muted hover:text-claude-text hover:bg-claude-border-light dark:hover:bg-[#2b2926] transition-colors"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-[2px] bg-claude-border-light dark:bg-[#2b2926]">
        <motion.div
          className="h-full"
          style={{ width: `${progress}%` }}
          transition={{ duration: 0.1 }}
        >
          <div
            className={`h-full ${
              type === 'success' ? 'bg-green-500' :
              type === 'error' ? 'bg-red-500' :
              type === 'info' ? 'bg-teal-500' :
              'bg-amber-500'
            }`}
          />
        </motion.div>
      </div>
    </motion.div>
  );
}

// ─── Toast Manager ──────────────────────────────────────────────────────────

interface ToastItem {
  id: string;
  type: CustomToastType;
  title: string;
  description?: string;
  duration?: number;
}

// Global toast state for the custom toast system
let toastListeners: Array<(toasts: ToastItem[]) => void> = [];
let toastItems: ToastItem[] = [];
let toastIdCounter = 0;

function emitToasts() {
  toastListeners.forEach(listener => listener([...toastItems]));
}

function addToast(type: CustomToastType, title: string, description?: string, duration?: number) {
  const id = `toast-${++toastIdCounter}`;
  toastItems = [...toastItems, { id, type, title, description, duration }];
  emitToasts();
}

function removeToast(id: string) {
  toastItems = toastItems.filter(t => t.id !== id);
  emitToasts();
}

// ─── Public API ──────────────────────────────────────────────────────────────

export const customToast = {
  success: (title: string, description?: string) => addToast('success', title, description),
  error: (title: string, description?: string) => addToast('error', title, description),
  info: (title: string, description?: string) => addToast('info', title, description),
  warning: (title: string, description?: string) => addToast('warning', title, description),
};

// ─── Toast Container ──────────────────────────────────────────────────────────

export function CustomToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    toastListeners.push(setToasts);
    return () => {
      toastListeners = toastListeners.filter(l => l !== setToasts);
    };
  }, []);

  return (
    <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <CustomToast
            key={toast.id}
            id={toast.id}
            type={toast.type}
            title={toast.title}
            description={toast.description}
            duration={toast.duration}
            onClose={removeToast}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
