// Shared types for PDB Tracker components
// These types are used across multiple component files

export interface PdbEntry {
  pdbId: string;
  title: string;
  method: string;
  resolution: number | null;
  releaseDate: string | null;
  journal: string | null;
  journalIf: number | null;
  organisms: string | null;
  ligands: string | null;
  authors?: string | null;
  pubmedId?: string | null;
  pubmedTitle?: string | null;
  pubmedAuthors?: string | null;
  pubmedAbstract?: string | null;
  bookmarked?: boolean;
  notes?: string;
  addedAt?: string;
  weekId: string | null;
  doi: string | null;
  isCryoem: boolean;
  isXray: boolean;
  ifTier: string;
  fetchDate?: string | null;
}

export interface WeeklySnapshot {
  weekId: string;
  weekStart: string;
  weekEnd: string;
  totalStructures: number;
  methods: Record<string, number>;
  date: string;
  cryoemCount?: number;
  xrayCount?: number;
  nmrCount?: number;
  otherCount?: number;
  cryoemAvgRes?: number | null;
  xrayAvgRes?: number | null;
  topJournals?: string | null;
  ifDist?: string | null;
  cryoemResDist?: string | null;
  xrayResDist?: string | null;
  createdAt?: string;
}

export type SortField = string;
export type SortDir = 'asc' | 'desc';

export interface SearchSuggestionItem {
  text: string;
  type: 'pdbId' | 'title' | 'organism' | 'journal';
}

export type Mode = 'weekly' | 'evaluation';