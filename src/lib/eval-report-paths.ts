/**
 * Shared resolution for the evaluation-reports directory (API-03 / API-13).
 *
 * The report writer (`generateEvaluationReport` in target-evaluation.ts)
 * and the batch-report reader previously hardcoded
 * `/Users/lijing/Documents/my_note/LLM-Wiki/wiki/evaluations` — a path that
 * only exists on the original author's machine; everywhere else every write
 * silently failed and every read 404'd with "file not found on disk".
 *
 * Resolution order:
 *   1. `EVAL_REPORTS_DIR` env var (absolute-path override for power users
 *      who still want the reports in their personal wiki/notes tree)
 *   2. `<writableRoot()>/db/evaluation-reports` — project-local in dev,
 *      userData in the packaged Electron app (same anchor as the SQLite
 *      files, see src/lib/paths.ts)
 *
 * The directory is created on demand, mirroring dbDir()/hermesDir().
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { writableRoot } from './paths';

export function evalReportsDir(): string {
  const override = process.env.EVAL_REPORTS_DIR;
  const dir = override && override.trim().length > 0
    ? resolve(override.trim())
    : resolve(writableRoot(), 'db', 'evaluation-reports');
  try { mkdirSync(dir, { recursive: true }); } catch { /* best-effort — callers report write errors */ }
  return dir;
}

/**
 * API-03: sanitize a filename component for the report files. The uniprot id
 * is format-validated upstream and the protein name comes from the UniProt
 * API, but both are still scrubbed (defense in depth) so no path separators
 * or whitespace can reach path.join().
 */
export function sanitizeReportFilenamePart(part: string): string {
  return (part || '').replace(/[\\/:*?"<>|\s]/g, '_');
}
