import type { PdbEntry, LitPaper, Evaluation } from '@/lib/pdb-types';

// ─── CSV Helpers ────────────────────────────────────────────────────────────────

/**
 * Escapes a value for safe inclusion in a CSV cell.
 * - Wraps in double quotes if the value contains commas, quotes, or newlines
 * - Doubles any internal double quotes
 */
function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Converts a value to a CSV-safe string representation.
 * Handles null/undefined as empty string.
 */
function toCsvString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return escapeCsvField(value.join('; '));
  return escapeCsvField(String(value));
}

// ─── Public Export Functions ────────────────────────────────────────────────────

/**
 * Converts an array of objects to CSV format and triggers a browser download.
 * First row is headers, subsequent rows are data.
 */
export function exportToCSV(data: Record<string, unknown>[], filename: string): void {
  if (!data.length) return;

  const headers = Object.keys(data[0]);
  const headerRow = headers.map(escapeCsvField).join(',');

  const dataRows = data.map((row) =>
    headers.map((key) => toCsvString(row[key])).join(',')
  );

  const csv = [headerRow, ...dataRows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`);
}

/**
 * Converts an array of objects to pretty-printed JSON and triggers a browser download.
 */
export function exportToJSON(data: Record<string, unknown>[], filename: string): void {
  if (!data.length) return;

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
  triggerDownload(blob, filename.endsWith('.json') ? filename : `${filename}.json`);
}

// ─── Format Functions ───────────────────────────────────────────────────────────

/**
 * Formats a PdbEntry for CSV/JSON export by flattening nested fields
 * and formatting dates to readable strings.
 */
export function formatPdbEntryForExport(entry: PdbEntry): Record<string, unknown> {
  return {
    pdbId: entry.pdbId,
    method: entry.method ?? '',
    releaseDate: formatDateString(entry.releaseDate),
    resolution: entry.resolution ?? '',
    title: entry.title ?? '',
    doi: entry.doi ?? '',
    journal: entry.journal ?? '',
    journalIf: entry.journalIf ?? '',
    ifTier: entry.ifTier ?? '',
    authors: entry.authors ?? '',
    organisms: entry.organisms ?? '',
    ligands: entry.ligands ?? '',
    weekId: entry.weekId ?? '',
    pubmedId: entry.pubmedId ?? '',
    fetchDate: formatDateString(entry.fetchDate),
    isCryoem: entry.isCryoem,
    isXray: entry.isXray,
    pubmedTitle: entry.pubmedTitle ?? '',
    pubmedAuthors: entry.pubmedAuthors ?? '',
    pubmedAbstract: entry.pubmedAbstract ?? '',
  };
}

/**
 * Formats a LitPaper for CSV/JSON export by flattening nested fields
 * (e.g., associated PDB IDs as a semicolon-separated string).
 */
export function formatLitPaperForExport(paper: LitPaper): Record<string, unknown> {
  return {
    pmid: paper.pmid,
    title: paper.title ?? '',
    authors: paper.authors ?? '',
    journal: paper.journal ?? '',
    impactFactor: paper.IF ?? '',
    pubdate: paper.pubdate ?? '',
    doi: paper.doi ?? '',
    abstract: paper.abstract ?? '',
    abstractCn: paper.abstractCn ?? '',
    pdbIds: paper.pdbs?.map((p) => p.pdbId).join('; ') ?? '',
    pdbMethods: paper.pdbs?.map((p) => p.method ?? '').join('; ') ?? '',
    pdbResolutions: paper.pdbs?.map((p) => p.resolution?.toFixed(2) ?? '').join('; ') ?? '',
    keywords: paper.keywords?.join('; ') ?? '',
    tags: paper.tags?.join('; ') ?? '',
  };
}

/**
 * Formats an Evaluation for CSV/JSON export by flattening nested fields
 * (PDB structures and BLAST results summarized as counts and key identifiers).
 */
export function formatEvalForExport(evaluation: Evaluation): Record<string, unknown> {
  return {
    uniprotId: evaluation.uniprotId,
    entryName: evaluation.entryName ?? '',
    proteinName: evaluation.proteinName ?? '',
    geneNames: evaluation.geneNames ?? '',
    organism: evaluation.organism ?? '',
    sequenceLength: evaluation.sequenceLength ?? '',
    coverage: evaluation.coverage ?? '',
    scores: evaluation.scores ?? '',
    report: evaluation.report ?? '',
    batchId: evaluation.batchId ?? '',
    createdAt: formatDateString(evaluation.createdAt),
    updatedAt: formatDateString(evaluation.updatedAt),
    pdbStructureCount: evaluation.pdbStructures?.length ?? 0,
    pdbIds: evaluation.pdbStructures?.map((s) => s.pdbId).join('; ') ?? '',
    blastResultCount: evaluation.blastResults?.length ?? 0,
    blastPdbIds: evaluation.blastResults?.map((b) => b.pdbId).join('; ') ?? '',
  };
}

// ─── Internal Helpers ───────────────────────────────────────────────────────────

/**
 * Formats an ISO date string to a human-readable format (YYYY-MM-DD).
 * Returns empty string for null/undefined/invalid dates.
 */
function formatDateString(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch {
    return dateStr;
  }
}

/**
 * Creates a temporary anchor element to trigger a file download via the Blob API.
 */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // Cleanup
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
