/**
 * Structured JSON logger for the PDB Structure Tracker.
 *
 * Every log call emits a single line of JSON to stdout so it can be ingested by
 * any log aggregator (Loki, Datadog, CloudWatch, etc.) without parsing.
 *
 * Usage:
 *   import { createLogger } from '@/lib/logger';
 *   const log = createLogger('evaluations-api');
 *   log.info('fetched evaluations', { count: 42 });
 *   log.error('query failed', err);
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  module?: string;
  data?: any;
  error?: { name: string; message: string; stack?: string };
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Resolve the minimum log level from the environment. Defaults to `info` in
 * production and `debug` everywhere else so devs see everything locally.
 */
function resolveMinLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL || '').toLowerCase().trim();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
    return raw;
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

const MIN_LEVEL: LogLevel = resolveMinLevel();

/** Normalize an arbitrary error-like value into the LogEntry.error shape. */
function serializeError(err: unknown): LogEntry['error'] {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  if (typeof err === 'string') {
    return { name: 'Error', message: err };
  }
  if (err && typeof err === 'object') {
    const e = err as { name?: string; message?: string; stack?: string };
    return {
      name: e.name || 'Error',
      message: e.message || String(err),
      stack: e.stack,
    };
  }
  return { name: 'Error', message: String(err) };
}

/** Build the structured LogEntry object. */
function buildEntry(
  level: LogLevel,
  module: string,
  message: string,
  data?: any,
  error?: unknown,
): LogEntry {
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    module,
  };
  if (data !== undefined) {
    entry.data = data;
  }
  if (error !== undefined) {
    entry.error = serializeError(error);
  }
  return entry;
}

/** Emit a LogEntry as a single JSON line on stdout. */
function emit(entry: LogEntry): void {
  if (LEVEL_PRIORITY[entry.level] < LEVEL_PRIORITY[MIN_LEVEL]) {
    return;
  }
  // console.log so the line lands on stdout (not stderr) — log aggregators
  // typically tail stdout. Errors are also sent to stdout to keep the JSON
  // stream coherent; the `level: "error"` field lets consumers route them.
  console.log(JSON.stringify(entry));
}

export interface Logger {
  debug: (message: string, data?: any) => void;
  info: (message: string, data?: any) => void;
  warn: (message: string, data?: any) => void;
  error: (message: string, error?: unknown, data?: any) => void;
  /** The module name this logger was created with. */
  module: string;
}

/**
 * Create a child logger scoped to a module name. All entries emitted by the
 * returned object carry `module` so logs can be filtered per-feature.
 */
export function createLogger(module: string): Logger {
  return {
    module,
    debug: (message, data) => emit(buildEntry('debug', module, message, data)),
    info: (message, data) => emit(buildEntry('info', module, message, data)),
    warn: (message, data) => emit(buildEntry('warn', module, message, data)),
    error: (message, error, data) =>
      emit(buildEntry('error', module, message, data, error)),
  };
}

/** Default top-level logger for code that has no clear module scope. */
const defaultLogger = createLogger('app');

export default defaultLogger;
