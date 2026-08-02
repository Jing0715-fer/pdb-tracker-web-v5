/**
 * Shared journal name → IF matching helpers used by:
 * - /api/literature/stats (date-scoped topJournal / avgIf)
 * - /api/literature/report/[date] (per-paper IF lookup)
 * - /api/literature/papers (list endpoint with date / IF filters)
 *
 * Also provides:
 * - Date normalization (normalizeMonth, combineDate) — single source of
 *   truth shared with the SQL CASE expression in stats/route.ts so that
 *   filtering by normalized date works identically on both sides.
 * - canonicalizeJournal() — display-name canonicalization (e.g. "nat
 *   commun" / "nature communications" → "Nature Communications") used by
 *   the stats top journal display.
 *
 * Strategy (used by matchJournalIf):
 *   1. Exact normalized match against PdbStructure.journal (max IF per key)
 *   2. Alias lookup (handles common abbreviations like "Nat Struct Mol Biol")
 *   3. Direct lookup against JOURNAL_IF_MAP (known journals without PDB data)
 *   4. N-gram overlap with min 3 shared 4-grams and 60% length floor
 */

import { JOURNAL_IF_MAP } from '@/lib/journal-if-map';

// ─── Date normalization (must match the SQL CASE in stats/route.ts) ──────────

const MONTH_MAP: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

/**
 * Reverse map: '01'..'12' → 'Jan'..'Dec'. Returns the input as-is if it
 * doesn't match a known month number. Used by report/[date]/route.ts to
 * translate an ISO month from the URL into the canonical 3-letter form
 * stored in PubMedArticle.pubMonth.
 */
export function monthDigitToName(m: string): string {
  if (!m) return m;
  // MONTH_MAP keys are 3-letter capitalized names; build the reverse once
  // at module load time.
  if (!MONTH_DIGIT_TO_NAME) {
    MONTH_DIGIT_TO_NAME = {};
    for (const [name, digit] of Object.entries(MONTH_MAP)) {
      MONTH_DIGIT_TO_NAME[digit] = name;
    }
  }
  return MONTH_DIGIT_TO_NAME[m] ?? m;
}

let MONTH_DIGIT_TO_NAME: Record<string, string> | null = null;

/**
 * Normalize a month string to '01'..'12'. Accepts:
 * - English month name (any case): 'Jan', 'jan', 'JAN', 'June' → '01' / '06'
 * - Digit string: '1', '01', '12' → '01', '12'
 * - Empty / unrecognized: returns input as-is (the SQL CASE will then
 *   produce NULL or fallback to '01' depending on the path).
 *
 * Mirrors the SQL `WHEN pubMonth GLOB '[A-Za-z]*' THEN CASE upper(pubMonth) ...`
 * branch in stats/route.ts.
 */
export function normalizeMonth(m: string): string {
  const trimmed = m.trim();
  if (!trimmed) return '';
  const upper = trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  if (MONTH_MAP[upper]) return MONTH_MAP[upper];
  const num = parseInt(trimmed, 10);
  if (!isNaN(num) && num >= 1 && num <= 12) return String(num).padStart(2, '0');
  return trimmed;
}

/**
 * Combine year / month / day fields into a sortable YYYY-MM-DD string.
 *
 * IMPORTANT: behavior MUST match the SQL CASE expression in
 * stats/route.ts — specifically, an empty `day` becomes '01' (not
 * omitted). This keeps `combineDate()` directly comparable to the
 * `latestDate` string produced by the SQL MAX(...) call, so that a row
 * with `pubDay=''` is not silently dropped from the date filter.
 *
 * Returns '' if year is missing.
 */
export function combineDate(year?: string, month?: string, day?: string): string {
  if (!year) return '';
  const y = year.trim();
  const m = normalizeMonth(month || '') || '01';
  const d = (day?.trim() || '1').padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Return today's local date (server's TZ, typically Asia/Shanghai) as
 * YYYY-MM-DD. Used as the cap for latestDate in stats so that the
 * displayed date matches the user's local calendar.
 */
export function todayLocalDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ─── Journal name canonicalization (display only) ────────────────────────────

/**
 * Canonical display name for top journals. Keys are pre-normalized via
 * normJournal() so we can do a single O(1) lookup per paper. Anything
 * not in the map is returned title-cased as a sensible fallback.
 *
 * Scope: covers the small set of journals most likely to appear as
 * "Top Journal" (Nature / Cell / Science family + common PDB/CPRD
 * journals). New entries can be added without touching the matcher.
 */
const CANONICAL_NAMES: Record<string, string> = {
  nature: 'Nature',
  naturemethods: 'Nature Methods',
  naturebiotechnology: 'Nature Biotechnology',
  naturecellbiology: 'Nature Cell Biology',
  naturechemicalbiology: 'Nature Chemical Biology',
  naturegenetics: 'Nature Genetics',
  natureimmunology: 'Nature Immunology',
  naturemedicine: 'Nature Medicine',
  natureneuroscience: 'Nature Neuroscience',
  naturephysics: 'Nature Physics',
  naturechemistry: 'Nature Chemistry',
  naturephotonics: 'Nature Photonics',
  naturenanotechnology: 'Nature Nanotechnology',
  natureenergy: 'Nature Energy',
  naturecatalysis: 'Nature Catalysis',
  naturemachineintelligence: 'Nature Machine Intelligence',
  naturecomputationalscience: 'Nature Computational Science',
  naturehumanbehaviour: 'Nature Human Behaviour',
  naturefood: 'Nature Food',
  naturemetabolism: 'Nature Metabolism',
  naturesustainability: 'Nature Sustainability',
  naturewater: 'Nature Water',
  natureclimatechange: 'Nature Climate Change',
  naturegeoscience: 'Nature Geoscience',
  natureastronomy: 'Nature Astronomy',
  natureecologyevolution: 'Nature Ecology & Evolution',
  natureevolution: 'Nature Evolution',
  natcommun: 'Nature Communications',
  natstructmolbiol: 'Nature Structural & Molecular Biology',
  natrevmolcellbiol: 'Nature Reviews Molecular Cell Biology',
  natrevdrugdiscov: 'Nature Reviews Drug Discovery',
  natrevcancer: 'Nature Reviews Cancer',
  natrevimmunol: 'Nature Reviews Immunology',
  natrevmicrobiol: 'Nature Reviews Microbiology',
  natrevgenet: 'Nature Reviews Genetics',
  natrevclinoncol: 'Nature Reviews Clinical Oncology',
  natrevcardiol: 'Nature Reviews Cardiology',
  natrevgastroenterolhepatol: 'Nature Reviews Gastroenterology & Hepatology',
  natrevneurol: 'Nature Reviews Neurology',
  natrevurol: 'Nature Reviews Urology',
  natrevrheumatol: 'Nature Reviews Rheumatology',
  natrevendocrinol: 'Nature Reviews Endocrinology',
  natrevnephrol: 'Nature Reviews Nephrology',
  natrevmater: 'Nature Reviews Materials',
  natrevchem: 'Nature Reviews Chemistry',
  natrevphys: 'Nature Reviews Physics',
  cell: 'Cell',
  cellres: 'Cell Research',
  cellrep: 'Cell Reports',
  cellrepmed: 'Cell Reports Medicine',
  cellstemcell: 'Cell Stem Cell',
  cellhostmicrobe: 'Cell Host & Microbe',
  celldiscov: 'Cell Discovery',
  cellmetab: 'Cell Metabolism',
  cellchembiol: 'Cell Chemical Biology',
  cellsystems: 'Cell Systems',
  cellrepphyssci: 'Cell Reports Physical Sciences',
  cellrepmethods: 'Cell Reports Methods',
  cellcommsignal: 'Cell Communication and Signaling',
  cellcycle: 'Cell Cycle',
  cellmollclett: 'Cellular & Molecular Biology Letters',
  celldeathdis: 'Cell Death & Disease',
  cancercell: 'Cancer Cell',
  cancerres: 'Cancer Research',
  clinanceres: 'Clinical Cancer Research',
  blood: 'Blood',
  science: 'Science',
  sciadv: 'Science Advances',
  scitranslmed: 'Science Translational Medicine',
  scienceimmunology: 'Science Immunology',
  sciencerobotics: 'Science Robotics',
  sciencesignaling: 'Science Signaling',
  procnatlacadsci: 'PNAS',
};

/**
 * Map a raw journal name to a canonical display name. Used only for
 * the Top Journal card; per-paper data on the report / papers pages
 * keeps the original name.
 */
export function canonicalizeJournal(raw: string): string {
  if (!raw) return raw;
  const key = normJournal(raw);
  if (CANONICAL_NAMES[key]) return CANONICAL_NAMES[key];
  // Fallback: title-case each word. Preserves acronyms / mixed case
  // better than lowercasing everything (e.g. "eLife" stays "eLife",
  // "mBio" stays "mBio") because we only modify word starts.
  return raw.replace(/\b([a-z])/g, m => m.toUpperCase());
}

// ─── Journal normalization & n-gram helpers (matching) ──────────────────────

export function normJournal(s: string): string {
  return s.toLowerCase().replace(/[\s.&,\-.:;()\[\]{}]/g, '');
}

export function getNgrams(s: string, size: number = 4): Set<string> {
  const ngrams = new Set<string>();
  for (let i = 0; i <= s.length - size; i++) {
    ngrams.add(s.slice(i, i + size));
  }
  return ngrams;
}

export function ngramScore(a: Set<string>, b: Set<string>): number {
  let score = 0;
  for (const g of a) { if (b.has(g)) score++; }
  return score;
}

// Map of exact journal name aliases → normalized PdbStructure journal key
// Used as a fast-path before n-gram fuzzy matching
const JOURNAL_ALIASES: Record<string, string> = {
  // Nature family
  'nature structural & molecular biology': 'natstructmolbiol',
  'nature structural and molecular biology': 'natstructmolbiol',
  'nat. struct. mol. biol.': 'natstructmolbiol',
  'nature communications': 'natcommun',
  'nat. commun.': 'natcommun',
  'nat commun': 'natcommun',
  'nature methods': 'naturemethods',
  'nat. methods': 'naturemethods',
  'nat methods': 'naturemethods',
  'nature biotechnology': 'naturebiotechnology',
  'nat. biotechnol.': 'naturebiotechnology',
  'nature cell biology': 'naturecellbiology',
  'nat. cell biol.': 'naturecellbiology',
  'nature chemical biology': 'naturechemicalbiology',
  'nat. chem. biol.': 'naturechemicalbiology',
  'nature genetics': 'naturegenetics',
  'nat. genet.': 'naturegenetics',
  'nature immunology': 'natureimmunology',
  'nat. immunol.': 'natureimmunology',
  'nature medicine': 'naturemedicine',
  'nat. med.': 'naturemedicine',
  'nature neuroscience': 'natureneuroscience',
  'nat. neurosci.': 'natureneuroscience',
  'nature physics': 'naturephysics',
  'nat. phys.': 'naturephysics',
  'nature chemistry': 'naturechemistry',
  'nat. chem.': 'naturechemistry',
  'nature reviews molecular cell biology': 'natrevmolcellbiol',
  'nature reviews drug discovery': 'natrevdrugdiscov',
  'nature reviews cancer': 'natrevcancer',
  'nature reviews immunology': 'natrevimmunol',
  'nature reviews microbiology': 'natrevmicrobiol',
  'nature reviews genetics': 'natrevgenet',
  'nature reviews clinical oncology': 'natrevclinoncol',
  'nature reviews cardiology': 'natrevcardiol',
  'nature reviews gastroenterology & hepatology': 'natrevgastroenterolhepatol',
  'nature reviews neurology': 'natrevneurol',
  'nature reviews urology': 'natrevurol',
  'nature reviews rheumatology': 'natrevrheumatol',
  'nature reviews endocrinology': 'natrevendocrinol',
  'nature reviews nephrology': 'v',
  'nature reviews materials': 'natrevmater',
  'nature photonics': 'naturephotonics',
  'nat. photon.': 'naturephotonics',
  'nature nanotechnology': 'naturenanotechnology',
  'nat. nanotechnol.': 'naturenanotechnology',
  'nature energy': 'natureenergy',
  'nat. energy': 'natureenergy',
  'nature catalysis': 'naturecatalysis',
  'nat. Catal.': 'naturecatalysis',
  'nature machine intelligence': 'naturemachineintelligence',
  'nature computational science': 'naturecomputationalscience',
  'nature human behaviour': 'naturehumanbehaviour',
  'nature food': 'naturefood',
  'nature metabolism': 'naturemetabolism',
  'nature sustainability': 'naturesustainability',
  'nature water': 'naturewater',
  'nature climate change': 'natureclimatechange',
  'nature geoscience': 'naturegeoscience',
  'nature astronomy': 'natureastronomy',
  'nature ecology & evolution': 'natureecologyevolution',
  'nature evolution': 'natureevolution',

  // Cell family
  'cell research': 'cellres',
  'cell res.': 'cellres',
  'cell reports': 'cellrep',
  'cell reports medicine': 'cellrepmed',
  'cell stem cell': 'cellstemcell',
  'cell host & microbe': 'cellhostmicrobe',
  'cell host and microbe': 'cellhostmicrobe',
  'cell discovery': 'celldiscov',
  'cell metabolism': 'cellmetab',
  'cell chemical biology': 'cellchembiol',
  'cell systems': 'cellsystems',
  'cell reports physical sciences': 'cellrepphyssci',

  // Science family
  'science advances': 'sciadv',
  'sci. adv.': 'sciadv',
  'science translational medicine': 'scitranslmed',
  'sci. transl. med.': 'scitranslmed',
  'science immunology': 'scienceimmunology',
  'sci. Immunol.': 'scienceimmunology',
  'science robotics': 'sciencerobotics',
  'sci. Robot.': 'sciencerobotics',
  'science signaling': 'sciencesignaling',
  'sci. Signal.': 'sciencesignaling',
  'science': 'science',

  // Other common journals
  'embo journal': 'emboj',
  'embo j.': 'emboj',
  'embo reports': 'emborep',
  'proc natl acad sci usa': 'procnatlacadsci',
  'pnas': 'procnatlacadsci',
  'proceedings of the national academy of sciences': 'procnatlacadsci',
  'j mol biol': 'jmolbiol',
  'journal of molecular biology': 'jmolbiol',
  'j biol chem': 'jbiolchem',
  'journal of biological chemistry': 'jbiolchem',
  'structure (london, england : 1993)': 'structure',
  'journal of structural biology': 'jstructbiol',
  'j struct biol': 'jstructbiol',
  'biochemistry': 'biochemistry',
  'biochem j': 'biochemj',
  'biochemical journal': 'biochemj',
  'febs j': 'febsj',
  'febs journal': 'febsj',
  'br j pharmacol': 'brjpharmacol',
  'british journal of pharmacology': 'brjpharmacol',
  'eur j pharmacol': 'eurjpharmacol',
  'european journal of pharmacology': 'eurjpharmacol',
  'int j biol macromol': 'intjbiolmacromol',
  'international journal of biological macromolecules': 'intjbiolmacromol',
  'j med chem': 'jmedchem',
  'journal of medicinal chemistry': 'jmedchem',
  'acs chem biol': 'acschembiol',
  'acs chemical biology': 'acschembiol',
  'acs catalysis': 'acscatalysis',
  'angew chem int ed engl': 'angewchemsintedeng',
  'angewandte chemie international edition': 'angewchemsintedeng',
  'j am chem soc': 'jacsoc',
  'journal of the american chemical society': 'jacsoc',
  'protein sci': 'proteinsci',
  'protein science': 'proteinsci',
  'protein cell': 'proteincl',
  'mol cell': 'molcell',
  'molecular cell': 'molcell',
  'mol biol cell': 'molcell',
  'plos comput biol': 'ploscomputbiol',
  'plos computational biology': 'ploscomputbiol',
  'elife': 'elife',
  'bmc biol': 'biobiocl',
  'bmc biology': 'biobiocl',
  'bmc genomics': 'biogenomics',
  // PubMed-specific formats → PdbStructure normalized key
  'nature structural &amp; molecular biology': 'natstructmolbiol',
  'science (new york, n.y.)': 'science',
  'communications biology': 'communbiol',
  'nature reviews. microbiology': 'natrevmicrobiol',
  'nature reviews. molecular cell biology': 'natrevmolcellbiol',
  'nature reviews. drug discovery': 'natrevdrugdiscov',
  'nature reviews. cancer': 'natrevcancer',
  'nature reviews. immunology': 'natrevimmunol',
  'nature reviews. genetics': 'natrevgenet',
  'nature reviews. clinical oncology': 'natrevclinoncol',
  'nature reviews. cardiology': 'natrevcardiol',
  'nature reviews. gastroenterology & hepatology': 'natrevgastroenterolhepatol',
  'nature reviews. neurology': 'natrevneurol',
  'nature reviews. urology': 'natrevurol',
  'nature reviews. rheumatology': 'natrevrheumatol',
  'nature reviews. endocrinology': 'natrevendocrinol',
  'nature reviews. nephrology': 'natrevnephrol',
  'nature reviews. materials': 'natrevmater',
  'angewandte chemie (international ed. in english)': 'angewchemsintedeng',
  'chemical communications (cambridge, england)': 'chemcommun',
  'proceedings of the national academy of sciences of the united states of america': 'procnatlacadsci',
  'european journal of medicinal chemistry': 'eurjmedchem',
  'protein science : a publication of the protein society': 'proteinsci',
  'protein & cell': 'proteincl',
  'molecular biology of the cell': 'molcell',
  'cell death & disease': 'celldeathdis',
  'cell death and disease': 'celldeathdis',
  'cell reports methods': 'cellrepmethods',
  'cell communication and signaling': 'cellcommsignal',
  'cell cycle (georgetown, tex.)': 'cellcycle',
  'cellular & molecular biology letters': 'cellmollclett',
  'advanced science (weinheim, baden-wurttemberg, germany)': 'advsci',
  'advanced science': 'advsci',
  'adv sci (weinh)': 'advsci',
  'small science': 'smallsci',
  'iscience': 'iscience',
  'acs central science': 'acscentralsci',
  'acs medicinal chemistry letters': 'acsmedchemlett',
  'acs pharmacology & translational science': 'acspharmtranslsci',
  'acs sensors': 'acssensors',
  'acs bio med chem au': 'acsbiomedchemau',
  'acs infectious diseases': 'acsinfectdis',
  'chemical science': 'chemsci',
  'chemistry & biology': 'chembiol',
  'chemistry and biology': 'chembiol',
  'chemmedchem': 'chemmedchem',
  'chemphyschem : a european journal of chemical physics and physical chemistry': 'chemphyschem',
  'chembiochem': 'chembiochem',
  'chem commun (camb)': 'chemcommun',
  'chemistry': 'chemistry',
  'chemrxiv': 'chemrxiv',
  'biophysical journal': 'biophysj',
  'biosensors & bioelectronics': 'biosensbioelectron',
  'blood': 'blood',
  'cancer cell': 'cancercell',
  'cancer research': 'cancerres',
  'clinical cancer research': 'clinanceres',
  'cell death &amp; disease': 'celldeathdis',
  'cell host &amp; microbe': 'cellhostmicrobe',
  'nature reviews chemistry': 'natrevchem',
  'nature reviews physics': 'natrevphys',
  'scientific reports': 'scirep',
  'international journal of molecular sciences': 'intjmolsci',
  'life science alliance': 'lifescialliance',
  'nucleic acids research': 'nucleicacidsres',
  'rsc adv': 'rscadv',
  'rsc advances': 'rscadv',
  'beilstein j org chem': 'beilsteinjorgchem',
  'acta crystallographica. section d, structural biology': 'actacrystallogrdbstructbiol',
  'acta crystallographica. section d, biological crystallography': 'actacrystallogrdbstructbiol',
  'acta cryst d struct biol': 'actacrystallogrdbstructbiol',
  'acta crystallogr f struct biol commun': 'actacrystallogrfsbiocomm',
  'acta biochim biophys sin (shanghai)': 'actabiochimbiopssin',
  'acta pharm sin b': 'actapharmsinb',
  'antimicrob agents chemother': 'antimicrobagentschemother',
  'antiviral res': 'antiviralres',
  'appl microbiol biotechnol': 'applmicrobiolbiotechnol',
  'archives of biochemistry and biophysics': 'archbiochimbiophys',
  'archives of microbiology': 'archmicrobiol',
  'archives of pharmacal research': 'archpharmacalres',
  'brazilian journal of microbiology : [publication of the brazilian society for microbiology]': 'brazjmicrobiol',
  'canadian journal of physiology and pharmacology': 'canjphysiolpharmacol',
  'food science & nutrition': 'foodscinutr',
  'food science and nutrition': 'foodscinutr',
  'macromolecular rapid communications': 'macromolrapidcommun',
  'medicinal chemistry research : an international journal for rapid communications on design and mechanisms of action of biologically active agents': 'medchemres',
  'plant communications': 'plantcommun',
  'plant commun': 'plantcommun',
};

// Build a normalized alias map at module load time (one-time cost)
const NORMALIZED_ALIASES: Record<string, string> = {};
for (const [key, val] of Object.entries(JOURNAL_ALIASES)) {
  NORMALIZED_ALIASES[normJournal(key)] = val;
}

/**
 * Match a PubMed journal name to the best IF.
 * Strategy:
 * 1. Exact normalized match against journalIfMap (built from PdbStructure.journal)
 * 2. Alias lookup (handles common abbreviations like "Nat Struct Mol Biol")
 * 3. Direct IF lookup against JOURNAL_IF_MAP for known journals without PDB data
 * 4. N-gram overlap: find the PDB journal with the most shared 4-grams
 *    (min 3 shared, PDB name must be >= 60% the length of the PubMed name)
 */
export function matchJournalIf(
  pubmedJournal: string,
  journalIfMap: Record<string, number>,
  pdbJournals: { normalized: string; journalIf: number; ngrams: Set<string> }[],
): number | null {
  const n = normJournal(pubmedJournal);

  // 1. Exact normalized match
  if (journalIfMap[n]) return journalIfMap[n];

  // 2. Alias lookup (keys are pre-normalized)
  if (NORMALIZED_ALIASES[n] && journalIfMap[NORMALIZED_ALIASES[n]]) {
    return journalIfMap[NORMALIZED_ALIASES[n]];
  }

  // 3. Direct IF lookup for known journals not in PdbStructure
  if (JOURNAL_IF_MAP[n]) {
    return JOURNAL_IF_MAP[n];
  }

  // 4. N-gram overlap
  const nNgrams = getNgrams(n, 4);
  let bestIf: number | null = null;
  let bestScore = 0;
  for (const pdb of pdbJournals) {
    if (pdb.normalized.length < n.length * 0.6) continue;
    const score = ngramScore(nNgrams, pdb.ngrams);
    if (score >= 3 && score > bestScore) {
      bestScore = score;
      bestIf = pdb.journalIf;
    }
  }
  return bestIf;
}

/**
 * Build the lookup structures (journalIfMap, pdbJournals) used by matchJournalIf.
 * Callers pass raw rows of { journal, journalIf } from PdbStructure.
 */
export function buildJournalLookup(rows: { journal: string; journalIf: number | null }[]): {
  journalIfMap: Record<string, number>;
  pdbJournals: { normalized: string; journalIf: number; ngrams: Set<string> }[];
} {
  const journalIfMap: Record<string, number> = {};
  const pdbJournals: { normalized: string; journalIf: number; ngrams: Set<string> }[] = [];
  for (const row of rows) {
    if (row.journalIf == null || !(row.journalIf > 0)) continue;
    const key = normJournal(row.journal);
    if (!journalIfMap[key] || row.journalIf > journalIfMap[key]) {
      journalIfMap[key] = row.journalIf;
    }
    pdbJournals.push({ normalized: key, journalIf: row.journalIf, ngrams: getNgrams(key, 4) });
  }
  return { journalIfMap, pdbJournals };
}
