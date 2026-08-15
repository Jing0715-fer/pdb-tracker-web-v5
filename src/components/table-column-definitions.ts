/**
 * table-column-definitions.ts
 *
 * Centralised column metadata, shared helpers, and constants for both the
 * Weekly PDB table (WeeklyPdbTable) and the Evaluation table (EvalPdbTable).
 *
 * All cell renderers remain in their respective component files because they
 * depend heavily on component-level state & callbacks.  Only the static /
 * pure-function pieces that are duplicated or shared live here.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ColumnDefinition {
  /** Internal field key (matches data property) */
  field: string;
  /** Human-readable header label */
  label: string;
  /** Tailwind width class (may include responsive hiding, e.g. "w-[90px] hidden md:table-cell") */
  widthClass: string;
  /** Tooltip description shown on hover */
  description: string;
  /** Whether clicking the header sorts the column */
  sortable: boolean;
}

// ─── Default Column Widths (px) ────────────────────────────────────────────
// Used for pinned-column offset calculations in WeeklyPdbTable.

export const DEFAULT_COL_WIDTHS: Record<string, number> = {
  pdbId: 90,
  method: 90,
  resolution: 80,
  journalIf: 55,
  organisms: 130,
  title: 200,
  releaseDate: 95,
  _ligands: 130,
  journal: 120,
};

// ─── Weekly PDB Table Columns ──────────────────────────────────────────────

export const WEEKLY_TABLE_COLUMNS: ColumnDefinition[] = [
  { field: 'pdbId',       label: 'PDB ID',    widthClass: 'w-[90px]',                               description: 'Unique Protein Data Bank identifier',                          sortable: true  },
  { field: 'method',      label: 'Method',    widthClass: 'w-[90px]',                               description: 'Experimental method used to determine the structure',           sortable: true  },
  { field: 'resolution',  label: 'Resolution', widthClass: 'w-[80px]',                              description: 'Structure resolution in Ångströms (lower is better)',          sortable: true  },
  { field: 'journalIf',   label: 'IF',        widthClass: 'w-[55px]',                               description: 'Journal Impact Factor',                                        sortable: true  },
  { field: 'organisms',   label: 'Organism',  widthClass: 'w-[130px] hidden md:table-cell',          description: 'Source organism for the structure',                              sortable: true  },
  { field: 'title',       label: 'Title',     widthClass: '',                                        description: 'Structure title and description',                               sortable: true  },
  { field: 'releaseDate', label: 'Date',      widthClass: 'w-[95px] hidden sm:table-cell',           description: 'Release date in the PDB archive',                               sortable: true  },
  { field: '_ligands',    label: 'Ligands',   widthClass: 'w-[130px] hidden sm:table-cell',          description: 'Bound ligands and chemical components',                          sortable: false },
  { field: 'journal',     label: 'Journal',   widthClass: 'w-[120px] hidden lg:table-cell',          description: 'Publishing journal',                                            sortable: true  },
];

// ─── Evaluation Table Columns ───────────────────────────────────────────────

export const EVAL_TABLE_COLUMNS: ColumnDefinition[] = [
  { field: 'pdbId',       label: 'PDB ID',              widthClass: 'w-[90px]',  description: 'PDB identifier',                          sortable: true  },
  { field: '_type',       label: 'Type',                 widthClass: 'w-[70px]',  description: 'Structure or Homolog',                     sortable: false },
  { field: '_source',     label: 'Source',               widthClass: 'w-[80px]',  description: 'Source UniProt / sub-target',              sortable: false },
  { field: 'method',      label: 'Method',               widthClass: 'w-[90px]',  description: 'Experimental method',                       sortable: true  },
  { field: 'resolution',  label: 'Resolution',           widthClass: 'w-[80px]',  description: 'Structure resolution in Å',                 sortable: true  },
  { field: 'journalIf',   label: 'IF',                   widthClass: 'w-[55px]',  description: 'Journal Impact Factor',                     sortable: true  },
  { field: 'title',       label: 'Title / Description',  widthClass: '',          description: 'Structure title or BLAST description',     sortable: true  },
  { field: 'releaseDate', label: 'Date',                  widthClass: 'w-[95px]',  description: 'Release date in the PDB archive',          sortable: true  },
  { field: '_ligands',    label: 'Ligands',              widthClass: 'w-[120px]', description: 'Bound ligands and chemical components',    sortable: false },
];

// ─── CSV Export Headers ─────────────────────────────────────────────────────

export const CSV_EXPORT_HEADERS = [
  'PDB ID', 'Method', 'Resolution', 'IF', 'Organism', 'Title', 'Date', 'Ligands',
] as const;

// ─── Shared Pure Helpers ────────────────────────────────────────────────────

/**
 * Map a resolution value to a quality dot colour and label.
 * Duplicated in WeeklyPdbTable and EvalPdbTable — now centralised.
 */
export function getResolutionQuality(resolution: number): { dot: string; label: string } {
  if (resolution <= 1.5) return { dot: 'bg-green-500 dark:bg-green-400',  label: 'High' };
  if (resolution <= 2.5) return { dot: 'bg-yellow-500 dark:bg-yellow-400', label: 'Med' };
  if (resolution <= 3.5) return { dot: 'bg-orange-500 dark:bg-orange-400', label: 'Low' };
  return                       { dot: 'bg-red-500 dark:bg-red-400',       label: 'Poor' };
}

/**
 * Get the Tailwind badge class for an experimental method type.
 * Used by both WeeklyPdbTable and EvalPdbTable for the method column cell.
 */
export function getMethodBadgeClass(method: string | null | undefined): string {
  const upper = (method ?? '').toUpperCase();
  if (upper.includes('CRYO') || upper.includes('ELECTRON MICROSCOPY')) return 'method-badge-cryoem';
  if (upper.includes('X-RAY') || upper.includes('XRAY'))                  return 'method-badge-xray';
  if (upper.includes('NMR'))                                              return 'method-badge-nmr';
  return 'method-badge-other';
}

/**
 * Get a human-readable description for an experimental method type.
 * Used in method column tooltips in both tables.
 */
export function getMethodDescription(method: string | null | undefined): string {
  const upper = (method ?? '').toUpperCase();
  if (upper.includes('CRYO') || upper.includes('ELECTRON MICROSCOPY'))
    return 'Cryo-Electron Microscopy — 3D structure determination using frozen hydrated samples. Typical resolution: 2–5Å';
  if (upper.includes('X-RAY') || upper.includes('XRAY'))
    return 'X-ray Crystallography — 3D structure from X-ray diffraction patterns. Typical resolution: 0.5–3Å';
  if (upper.includes('NMR'))
    return 'Nuclear Magnetic Resonance — 3D structure in solution. Typical resolution: N/A (ensemble)';
  return 'Other experimental method for 3D structure determination';
}

/**
 * Look up a column label by field name.  Works with both column sets.
 */
export function getHeaderLabel(field: string, columns: ColumnDefinition[] = WEEKLY_TABLE_COLUMNS): string {
  return columns.find(c => c.field === field)?.label ?? field;
}

/**
 * Get the shared-count badge colour class based on how many sub-targets share a structure.
 * Used in EvalPdbTable for complex/batch evaluation badges.
 */
export function getSharedBadgeColor(sharedCount: number): string {
  if (sharedCount >= 4) return 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800/40';
  if (sharedCount === 3) return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800/40';
  return 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 border-teal-200 dark:border-teal-800/40';
}
