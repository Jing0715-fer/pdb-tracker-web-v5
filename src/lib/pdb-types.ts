// Weekly/PDB Domain Types
export interface PdbEntry {
  pdbId: string;
  method: string | null;
  releaseDate: string | null;
  resolution: number | null;
  title: string | null;
  doi: string | null;
  journal: string | null;
  journalIf: number | null;
  authors: string | null;
  organisms: string | null;
  ligands: string | null;
  weekId: string | null;
  pubmedId: string | null;
  fetchDate: string | null;
  isCryoem: boolean;
  isXray: boolean;
  ifTier: string;
  pubmedTitle?: string | null;
  pubmedAuthors?: string | null;
  pubmedAbstract?: string | null;
}

export interface WeeklySnapshot {
  weekId: string;
  weekStart: string;
  weekEnd: string;
  totalStructures: number;
  methods: Record<string, number>;
  date: string;
  cryoemCount: number;
  xrayCount: number;
  nmrCount: number;
  otherCount: number;
  avgResolution: number | null;
  topJournals: string | null;
  ifDist: string | null;
  createdAt: string;
  cryoemAvgRes?: number | null;
  xrayAvgRes?: number | null;
  cryoemResDist?: string | null;
  xrayResDist?: string | null;
}

export interface WeeklyReport {
  id: number;
  weekId: string | null;
  reportType: string | null;
  title: string | null;
  content: string | null;
  filename: string | null;
  createdAt: string;
}

// Evaluation Domain Types
export interface Evaluation {
  uniprotId: string;
  entryName: string | null;
  proteinName: string | null;
  geneNames: string | null;
  organism: string | null;
  sequenceLength: number | null;
  coverage: number | null;
  scores: string | null;
  report: string | null;
  /** JSON string of the ProvenanceRecord (Claude Science-inspired trace).
   *  Null on legacy rows created before the provenance upgrade. */
  provenance: string | null;
  batchId: string | null;
  createdAt: string;
  updatedAt: string;
  pdbStructures: EvalPdbStructure[];
  blastResults: EvalBlastResult[];
  _count?: { pdbStructures: number; blastResults: number };
}

export interface EvalPdbStructure {
  id: number;
  uniprotId: string;
  pdbId: string;
  method: string | null;
  resolution: number | null;
  title: string | null;
  depositionDate: string | null;
  releaseDate: string | null;
  ligand: string | null;
  ligandNames: string | null;
  journal: string | null;
  journalIf: number | null;
  doi: string | null;
  pubmedId: string | null;
  organism: string | null;
  authors: string | null;
  isCryoem: boolean;
  isXray: boolean;
  isNmr: boolean;
  ifTier: string | null;
  chainId: string | null;
  unpStart: number | null;
  unpEnd: number | null;
}

export interface EvalBlastResult {
  id: number;
  uniprotId: string;
  pdbId: string;
  uniprotRef: string | null;
  description: string | null;
  identity: number | null;
  evalue: string | null;
  queryCoverage: number | null;
  targetCoverage: number | null;
  method: string | null;
  resolution: number | null;
  releaseDate: string | null;
  source: string | null;
  taxonomyId: string | null;
  journal: string | null;
  journalIf: number | null;
  ifTier: string | null;
  ligand: string | null;
  title: string | null;
  pubmedId: string | null;
  pubmedTitle: string | null;
  pubmedAuthors: string | null;
  pubmedAbstract: string | null;
  doi: string | null;
}

export interface EvalBatch {
  // from DB row: id, batchId, title, combinedReport, createdAt
  id?: number;
  batchId: string;
  title: string | null;
  combinedReport: string | null;
  commonPdbIds?: string | null; // JSON string array, e.g. '["1ABC","2XYZ"]'
  crossReportOk?: boolean | null;
  crossReportChars?: number | null;
  targetCount?: number | null;
  subTargetCount?: number;
  createdAt: string;
}

export interface EvalBatchSubTarget {
  uniprotId: string;
  proteinName: string;
  geneName: string;
  organism: string;
  pdbCount: number;
  blastCount: number;
  bestScore: number;
}

export interface EvaluationReport {
  id: number;
  uniprotId: string;
  title: string | null;
  content: string | null;
  createdAt: string;
}

// Eval Row types (for table rendering)
export interface EvalStructureRow extends EvalPdbStructure {
  _type: 'structure';
}

export interface EvalBlastRow extends EvalBlastResult {
  _type: 'blast';
  ifTier: string;
  journalIf: number | null;
  title: string | null;
  releaseDate: string | null;
  pubmedId: string | null;
  pubmedTitle: string | null;
  pubmedAuthors: string | null;
  pubmedAbstract: string | null;
}

export type EvalRow = (EvalStructureRow | EvalBlastRow) & {
  _source?: string;
};

// Literature Domain Types
export interface LitPaper {
  pmid: string;
  title: string;
  authors: string;
  journal: string;
  IF: number | null;
  pubdate: string;
  abstract: string;
  abstractCn: string;
  doi: string;
  pdbs: LitPaperPdb[];
  keywords?: string[];
  tags?: string[];
  source?: string | null;
  /** Evaluation targets that reference this paper (via EvaluationPdbStructure.pubmedId). */
  sourceTargets?: Array<{ uniprotId: string; proteinName: string; pdbId: string }>;
  /** Number of distinct targets referencing this paper. */
  sourceTargetCount?: number;
}

export interface LitPaperPdb {
  pdbId: string;
  method: string | null;
  isBlast?: boolean;
  identity?: number | null;
  resolution?: number | null;
}

export interface LitReport {
  id: number;
  date: string;
  paperCount: number;
  createdAt: string;
  title?: string;
  summary?: string;
}

export interface LitStats {
  totalPapers: number;
  totalReports: number;
  papersWithIf: number;
  latestDate: string | null;
  avgIf: number | null;
  topJournal: string | null;
  methodDistribution: { method: string; count: number }[];
  ifDistribution: { tier: string; count: number }[];
}

// Shared Types
export type SortDir = 'asc' | 'desc';
export type Mode = 'weekly' | 'evaluation' | 'literature' | 'analysis';

export interface LigandInfo {
  code: string;
  name: string | null;
  formula: string | null;
  weight: string | null;
  type: string | null;
  description: string | null;
  imageUrl: string | null;
}

export interface TagInfo {
  category: TagCategory;
  label: string;
  value: string;
}

export type TagCategory = 'method' | 'resolution' | 'if' | 'quality' | 'date' | 'organism' | 'ligand' | 'special';

export interface QualityScoreResult {
  score: number;
  resolution: number;
  resolutionScore: number;
  methodScore: number;
  ifScore: number;
  label: string;
  total: number;
  color: string;
  method: number;
  impact: number;
}
