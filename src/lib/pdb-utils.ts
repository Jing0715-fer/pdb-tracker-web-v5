import { PdbEntry, QualityScoreResult, TagCategory, TagInfo } from './pdb-types';

// Decode JSON Unicode escape sequences (e.g. \u00c5 → Å) AND HTML entities (e.g. &#x3b2; → β)
export function decodeJsonEscapes(str: string | null | undefined): string {
  if (!str) return str ?? '';
  return str
    .replace(/\\u00c5/gi, 'Å')
    .replace(/\\u00e9/gi, 'é')
    .replace(/\\u00f1/gi, 'ñ')
    .replace(/\\u00fc/gi, 'ü')
    .replace(/\\u00e4/gi, 'ä')
    .replace(/\\u00f6/gi, 'ö')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    // HTML hex entities: &#x3b2; → β, &#x2011; → ‑
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    // HTML decimal entities: &#946; → β
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    // Named entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'");
}

// Safe number formatting
export function safeNum(val: any, fallback = '—'): string {
  if (val === null || val === undefined || val === '') return fallback;
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  return isNaN(n) ? fallback : n.toFixed(2);
}

// Format date
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr + 'T00:00:00Z');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  } catch {
    return dateStr;
  }
}

// Parse ligands
export function parseLigands(ligandStr: string | null | undefined): string[] {
  if (!ligandStr) return [];
  return ligandStr
    .split(/[|;,]/)
    .map(l => l.trim())
    .filter(l => l.length > 0);
}

// Compute quality score
export function computeQualityScore(entry: Partial<PdbEntry>): QualityScoreResult {
  let resolutionScore = 0;
  let methodScore = 0;
  let impactScore = 0;

  // Resolution (max 35)
  if (entry.resolution != null) {
    if (entry.resolution <= 1.5) resolutionScore = 35;
    else if (entry.resolution <= 2.0) resolutionScore = 30;
    else if (entry.resolution <= 2.5) resolutionScore = 25;
    else if (entry.resolution <= 3.0) resolutionScore = 20;
    else if (entry.resolution <= 3.5) resolutionScore = 15;
    else resolutionScore = 10;
  }

  // Method (max 25)
  if (entry.method) {
    const m = entry.method.toUpperCase();
    if (m.includes('CRYO-EM') || m.includes('ELECTRON MICROSCOPY')) methodScore = 25;
    else if (m.includes('X-RAY')) methodScore = 22;
    else if (m.includes('NMR')) methodScore = 18;
    else methodScore = 10;
  }

  // Impact factor (max 30)
  if (entry.journalIf != null) {
    if (entry.journalIf >= 40) impactScore = 30;
    else if (entry.journalIf >= 20) impactScore = 25;
    else if (entry.journalIf >= 10) impactScore = 20;
    else if (entry.journalIf >= 5) impactScore = 15;
    else if (entry.journalIf >= 2) impactScore = 10;
    else impactScore = 5;
  }

  const raw = resolutionScore + methodScore + impactScore;
  const score = Math.round((raw / 90) * 100);

  const total = score;
  const label = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Fair' : 'Poor';
  const color = score >= 80 ? '#22c55e' : score >= 60 ? '#3b82f6' : score >= 40 ? '#f59e0b' : '#ef4444';

  return { score, resolution: resolutionScore, resolutionScore, methodScore, ifScore: impactScore, label, total, color, method: methodScore, impact: impactScore };
}

// Get quality border class
export function getQualityBorderClass(entry: Partial<PdbEntry>): string {
  const { score } = computeQualityScore(entry);
  if (score >= 80) return 'border-l-4 border-l-emerald-500';
  if (score >= 60) return 'border-l-4 border-l-amber-500';
  if (score >= 40) return 'border-l-4 border-l-orange-500';
  return '';
}

// Generate tags
export function generateTags(entry: Partial<PdbEntry>, _diffMode?: boolean): TagInfo[] {
  const tags: TagInfo[] = [];
  const method = entry.method?.toUpperCase() || '';
  if (method.includes('CRYO-EM') || method.includes('ELECTRON MICROSCOPY')) {
    tags.push({ category: 'method', label: 'Cryo-EM', value: 'cryoem' });
  } else if (method.includes('X-RAY')) {
    tags.push({ category: 'method', label: 'X-ray', value: 'xray' });
  } else if (method.includes('NMR')) {
    tags.push({ category: 'method', label: 'NMR', value: 'nmr' });
  }

  if (entry.resolution != null) {
    if (entry.resolution <= 1.5) tags.push({ category: 'resolution', label: '≤1.5Å', value: 'high-res' });
    else if (entry.resolution <= 2.5) tags.push({ category: 'resolution', label: '≤2.5Å', value: 'med-res' });
    else tags.push({ category: 'resolution', label: '>2.5Å', value: 'low-res' });
  }

  if (entry.journalIf != null) {
    if (entry.journalIf >= 20) tags.push({ category: 'if', label: 'Top IF', value: 'top-if' });
    else if (entry.journalIf >= 10) tags.push({ category: 'if', label: 'High IF', value: 'high-if' });
    else if (entry.journalIf >= 5) tags.push({ category: 'if', label: 'Mid IF', value: 'mid-if' });
  }

  const quality = computeQualityScore(entry);
  if (quality.score >= 70) tags.push({ category: 'quality', label: 'High Quality', value: 'high-quality' });

  return tags;
}

// Method colors
export function getMethodColor(method: string | null): { bg: string; text: string; border: string } {
  if (!method) return { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-600 dark:text-gray-400', border: 'border-gray-300 dark:border-gray-600' };
  const m = method.toUpperCase();
  if (m.includes('CRYO-EM') || m.includes('ELECTRON MICROSCOPY')) {
    return { bg: 'bg-teal-50 dark:bg-teal-900/30', text: 'text-teal-700 dark:text-teal-300', border: 'border-teal-200 dark:border-teal-700' };
  }
  if (m.includes('X-RAY')) {
    return { bg: 'bg-purple-50 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-300', border: 'border-purple-200 dark:border-purple-700' };
  }
  if (m.includes('NMR')) {
    return { bg: 'bg-amber-50 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-200 dark:border-amber-700' };
  }
  return { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-600 dark:text-gray-400', border: 'border-gray-300 dark:border-gray-600' };
}

export function getMethodLabel(method: string | null): string {
  if (!method) return 'Unknown';
  const m = method.toUpperCase();
  if (m.includes('CRYO-EM') || m.includes('ELECTRON MICROSCOPY')) return 'Cryo-EM';
  if (m.includes('X-RAY')) return 'X-ray';
  if (m.includes('NMR')) return 'NMR';
  return method;
}

export function getResolutionColor(resolution: number | null): string {
  if (resolution == null) return 'text-muted-foreground';
  if (resolution <= 1.5) return 'text-emerald-600 dark:text-emerald-400';
  if (resolution <= 2.5) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-500 dark:text-red-400';
}

export function getIfTierStyle(tier: string): { bg: string; text: string } {
  switch (tier) {
    case 'top': return { bg: 'bg-red-50 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300' };
    case 'high': return { bg: 'bg-orange-50 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-300' };
    case 'mid': return { bg: 'bg-emerald-50 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-300' };
    case 'low': return { bg: 'bg-gray-50 dark:bg-gray-900/30', text: 'text-gray-700 dark:text-gray-300' };
    default: return { bg: 'bg-gray-50 dark:bg-gray-800', text: 'text-gray-500 dark:text-gray-400' };
  }
}

export function getScoreColor(score: number): string {
  if (score >= 8) return '#2d8f8f';
  if (score >= 5) return '#c9872e';
  return '#e55a4f';
}

// Pagination constants
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
export const DEFAULT_PAGE_SIZE = 25;

export function loadStoredPageSize(key: string): number {
  if (typeof window === 'undefined') return DEFAULT_PAGE_SIZE;
  try {
    const stored = localStorage.getItem(`pdb-page-size-${key}`);
    return stored ? parseInt(stored, 10) : DEFAULT_PAGE_SIZE;
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
}

// Format relative time
export function formatRelativeTime(date: string | Date): string {
  try {
    const d = date instanceof Date ? date : new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
  } catch {
    return String(date);
  }
}

// Tag category styles
export const TAG_CATEGORY_STYLES: Record<TagCategory, { bg: string; text: string; border: string }> = {
  method: { bg: 'bg-teal-50 dark:bg-teal-900/30', text: 'text-teal-700 dark:text-teal-300', border: 'border-teal-200 dark:border-teal-700' },
  resolution: { bg: 'bg-blue-50 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-200 dark:border-blue-700' },
  if: { bg: 'bg-amber-50 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-200 dark:border-amber-700' },
  quality: { bg: 'bg-emerald-50 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-200 dark:border-emerald-700' },
  date: { bg: 'bg-indigo-50 dark:bg-indigo-900/30', text: 'text-indigo-700 dark:text-indigo-300', border: 'border-indigo-200 dark:border-indigo-700' },
  organism: { bg: 'bg-pink-50 dark:bg-pink-900/30', text: 'text-pink-700 dark:text-pink-300', border: 'border-pink-200 dark:border-pink-700' },
  ligand: { bg: 'bg-orange-50 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-300', border: 'border-orange-200 dark:border-orange-700' },
  special: { bg: 'bg-purple-50 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-300', border: 'border-purple-200 dark:border-purple-700' },
};

// Column definitions
export const WEEKLY_TABLE_COLUMNS = [
  { field: 'pdbId', label: 'PDB ID', widthClass: 'w-[90px]', sortable: true },
  { field: 'method', label: 'Method', widthClass: 'w-[90px]', sortable: true },
  { field: 'resolution', label: 'Resolution', widthClass: 'w-[80px]', sortable: true },
  { field: 'journalIf', label: 'IF', widthClass: 'w-[55px]', sortable: true },
  { field: 'organisms', label: 'Organism', widthClass: 'w-[130px]', sortable: true },
  { field: 'title', label: 'Title', widthClass: 'min-w-[200px]', sortable: true },
  { field: 'releaseDate', label: 'Date', widthClass: 'w-[95px]', sortable: true },
  { field: 'ligands', label: 'Ligands', widthClass: 'w-[130px]', sortable: false },
  { field: 'journal', label: 'Journal', widthClass: 'w-[120px]', sortable: true },
];

export const EVAL_TABLE_COLUMNS = [
  { field: 'pdbId', label: 'PDB ID', widthClass: 'w-[90px]', sortable: true },
  { field: '_type', label: 'Type', widthClass: 'w-[70px]', sortable: true },
  { field: '_source', label: 'Source', widthClass: 'w-[80px]', sortable: false },
  { field: 'method', label: 'Method', widthClass: 'w-[90px]', sortable: true },
  { field: 'resolution', label: 'Resolution', widthClass: 'w-[80px]', sortable: true },
  { field: 'journalIf', label: 'IF', widthClass: 'w-[55px]', sortable: true },
  { field: 'title', label: 'Title / Description', widthClass: 'min-w-[200px]', sortable: true },
  { field: 'releaseDate', label: 'Date', widthClass: 'w-[95px]', sortable: true },
  { field: '_ligands', label: 'Ligands', widthClass: 'w-[130px]', sortable: false },
];

// ─── Import helpers (stub implementations for import-data-dialog.tsx) ────────

export function autoMapColumns(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const lower = headers.map(h => h.toLowerCase());
  const fieldMap: Record<string, string[]> = {
    pdbId: ['pdb_id', 'pdbid', 'pdb'],
    title: ['title', 'name', 'description'],
    method: ['method', 'technique', 'exp_method'],
    resolution: ['resolution', 'res', 'resolu'],
  };
  for (const [field, aliases] of Object.entries(fieldMap)) {
    const idx = lower.findIndex(l => aliases.some(a => l.includes(a)));
    if (idx >= 0) mapping[field] = headers[idx];
  }
  return mapping;
}

export function parseCsvLine(line: string, delimiter = ','): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

export function csvToEntries(text: string, mapping: Record<string, string>): PdbEntry[] {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const colMap = autoMapColumns(headers);
  const entries: PdbEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const entry: Partial<PdbEntry> = {};
    for (const [field, col] of Object.entries(colMap)) {
      const idx = headers.indexOf(col);
      if (idx >= 0 && values[idx]) {
        (entry as any)[field] = values[idx];
      }
    }
    entries.push(entry as PdbEntry);
  }
  return entries;
}

export function jsonToEntries(json: string): PdbEntry[] {
  try {
    const data = JSON.parse(json);
    const arr = Array.isArray(data) ? data : data.entries || [];
    return arr.map((item: any) => ({
      pdbId: item.pdbId || item.pdb_id || '',
      title: item.title || '',
      method: item.method || '',
      resolution: item.resolution ?? null,
      ifTier: '',
      ligands: item.ligands || '',
      date: item.date || item.depositionDate || '',
      authors: '',
      releaseDate: item.releaseDate || '',
      classification: item.classification || '',
      organisms: item.organisms || null,
      journal: item.journal || '',
      journalIf: item.journalIf ?? null,
      pubmedId: item.pubmedId || null,
      pubmedTitle: item.pubmedTitle || null,
      pubmedAbstract: item.pubmedAbstract || null,
      doi: item.doi || null,
      isCryoem: (item.method || '').toLowerCase().includes('electron'),
      isXray: (item.method || '').toLowerCase().includes('x-ray'),
      weekId: null,
    } as unknown as PdbEntry));
  } catch {
    return [];
  }
}

// ─── Advanced search helpers ────────────────────────────────────────────────
// NOTE: was originally "for use-pdb-filters.tsx" which was deleted as dead
// code (Task cleanup-dead-hooks-batch). These helpers themselves have no
// current consumers in src/ — left in place as a follow-up cleanup candidate.

export function hasAdvancedSyntax(query: string): boolean {
  // Check for field:value, quotes, or special operators
  return /[\[\]:<>!]/.test(query) || query.includes('"');
}

export interface SearchToken {
  type: 'field' | 'term' | 'quoted';
  value: string;
  field?: string;
}

interface ParsedSearch {
  fieldFilters: Record<string, string>;
  textQuery: string;
  tokens: SearchToken[];
}

export function parseAdvancedSearch(query: string): ParsedSearch {
  const fieldFilters: Record<string, string> = {};
  const textTokens: string[] = [];
  const tokens: SearchToken[] = [];
  const regex = /(\w+):("[^"]+"|\S+)|"([^"]+)"|(\S+)/g;
  let match;
  while ((match = regex.exec(query)) !== null) {
    if (match[1] && match[2]) {
      tokens.push({ type: 'field', field: match[1], value: match[2].replace(/"/g, '') });
      fieldFilters[match[1]] = match[2].replace(/"/g, '');
    } else if (match[3]) {
      tokens.push({ type: 'quoted', value: match[3] });
      textTokens.push(match[3]);
    } else if (match[4]) {
      tokens.push({ type: 'term', value: match[4] });
      textTokens.push(match[4]);
    }
  }
  return { fieldFilters, textQuery: textTokens.join(' '), tokens };
}

export function advancedEntryMatch(entry: any, tokens: SearchToken[], _notes?: string): boolean {
  for (const token of tokens) {
    if (token.type === 'field' && token.field && token.value) {
      const val = (entry as any)[token.field];
      if (val == null || !String(val).toLowerCase().includes(token.value.toLowerCase())) return false;
    } else if (token.type === 'term') {
      const s = entry.pdbId?.toLowerCase() + entry.title?.toLowerCase() + entry.method?.toLowerCase();
      if (!s?.includes(token.value.toLowerCase())) return false;
    }
  }
  return true;
}

export function matchesFieldFilters(entry: any, filters: Record<string, string>): boolean {
  for (const [field, value] of Object.entries(filters)) {
    const entryVal = (entry as any)[field];
    if (entryVal == null) return false;
    if (!String(entryVal).toLowerCase().includes(value.toLowerCase())) return false;
  }
  return true;
}

export function sortEvalEntries(entries: any[], field: string, dir: string): any[] {
  return [...entries].sort((a, b) => {
    const aVal = (a as any)[field];
    const bVal = (b as any)[field];
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    const cmp = typeof aVal === 'number' ? aVal - bVal : String(aVal).localeCompare(String(bVal));
    return dir === 'desc' ? -cmp : cmp;
  });
}

/*** Escape HTML special characters to prevent XSS when injecting into innerHTML */
export function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
