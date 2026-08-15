import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * POST /api/seed-demo
 *
 * Seeds the database with a curated set of demo data so new users can
 * immediately see populated dashboards across all 4 modules:
 *
 *  - Weekly: 3 weekly snapshots with ~30 PDB structures
 *  - Evaluation: 3 sample evaluations (P07766, Q9Y6K9, P00533)
 *  - Literature: 8 sample PubMed articles
 *
 * The data is synthetic but realistic — real PDB IDs, real UniProt IDs,
 * plausible resolutions / methods / journals. No external API calls.
 *
 * Idempotent: if the data already exists, it returns a "already seeded"
 * message instead of duplicating rows.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const force = body?.force === true;

    // Check if already seeded
    const existingCount = await db.pdbStructure.count();
    if (existingCount > 0 && !force) {
      return NextResponse.json({
        ok: true,
        message: 'Database already has data. Pass { force: true } to re-seed.',
        existingCount,
      });
    }

    // If force, wipe existing demo data first
    if (force) {
      await db.pdbChain.deleteMany();
      await db.pdbEntity.deleteMany();
      await db.pdbStructure.deleteMany();
      await db.weeklySnapshot.deleteMany();
      await db.weeklyReport.deleteMany();
      await db.evaluationPdbStructure.deleteMany();
      await db.evaluationBlastResult.deleteMany();
      await db.evaluationReport.deleteMany();
      await db.evaluation.deleteMany();
      await db.pubMedArticle.deleteMany();
      await db.literatureDigest.deleteMany();
    }

    // ── 1. Weekly Snapshots & PDB Structures ──────────────────────────
    const now = new Date();
    const weeks = [
      { weekId: '2026-W31', weekStart: '2026-07-28', weekEnd: '2026-08-03', offsetDays: 0 },
      { weekId: '2026-W30', weekStart: '2026-07-21', weekEnd: '2026-07-27', offsetDays: 7 },
      { weekId: '2026-W29', weekStart: '2026-07-14', weekEnd: '2026-07-20', offsetDays: 14 },
    ];

    // Curated demo structures — real PDB IDs with plausible metadata
    const demoStructures = [
      { pdbId: '7KQR', method: 'Cryo-EM', resolution: 2.8, title: 'SARS-CoV-2 Spike Glycoprotein (Open State)', journal: 'Nature', journalIf: 64.8, organisms: 'Severe acute respiratory syndrome coronavirus 2', ligands: 'NAG,BMA,MAN', authors: 'Walls A, Park Y, Tortorici M, Wallis A' },
      { pdbId: '6XR8', method: 'Cryo-EM', resolution: 3.2, title: 'SARS-CoV-2 RNA-dependent RNA polymerase complex', journal: 'Cell', journalIf: 66.8, organisms: 'Severe acute respiratory syndrome coronavirus 2', ligands: 'MG,PPV', authors: 'Hillen H, Kokic G, Farnung L' },
      { pdbId: '7V4Q', method: 'Cryo-EM', resolution: 2.6, title: 'Human GABA-A receptor in complex with diazepam', journal: 'Nature', journalIf: 64.8, organisms: 'Homo sapiens', ligands: 'DZF,CHT', authors: 'Zhu S, Noviello C, Teng J' },
      { pdbId: '7U6F', method: 'Cryo-EM', resolution: 3.0, title: 'Human voltage-gated sodium channel Nav1.7', journal: 'Science', journalIf: 56.9, organisms: 'Homo sapiens', ligands: 'Na,HOH', authors: 'Shen H, Liu D, Wu K' },
      { pdbId: '8D5X', method: 'Cryo-EM', resolution: 2.4, title: 'Bacterial ribosome 50S subunit with antibiotic', journal: 'Nature Microbiology', journalIf: 28.3, organisms: 'Escherichia coli', ligands: 'ERY', authors: 'Crowley-McKenna E, et al.' },
      { pdbId: '6LU7', method: 'X-ray', resolution: 2.1, title: 'SARS-CoV-2 main protease (Mpro) with inhibitor N3', journal: 'Nature', journalIf: 64.8, organisms: 'Severe acute respiratory syndrome coronavirus 2', ligands: 'N3', authors: 'Jin Z, Du X, Xu Y' },
      { pdbId: '1CBS', method: 'X-ray', resolution: 1.5, title: 'Cellular retinoic acid binding protein type II', journal: 'Journal of Molecular Biology', journalIf: 5.6, organisms: 'Homo sapiens', ligands: 'REA', authors: 'Thompson J, Winter N, Terwey D' },
      { pdbId: '4HHB', method: 'X-ray', resolution: 1.7, title: 'Hemoglobin deoxy form (human)', journal: 'Nature', journalIf: 64.8, organisms: 'Homo sapiens', ligands: 'HEM,SO4', authors: 'Fermi G, Perutz M, Shaanan B' },
      { pdbId: '2VII', method: 'X-ray', resolution: 1.8, title: 'Insulin receptor tyrosine kinase domain', journal: 'Cell', journalIf: 66.8, organisms: 'Homo sapiens', ligands: 'ANP,MG', authors: 'Hubbard S' },
      { pdbId: '5N3K', method: 'X-ray', resolution: 2.0, title: 'Beta-2 adrenergic receptor-Gs protein complex', journal: 'Nature', journalIf: 64.8, organisms: 'Homo sapiens', ligands: 'NEB', authors: 'Carpenter B, Nehme R, Warne T' },
      { pdbId: '3PBL', method: 'X-ray', resolution: 2.1, title: 'D3 dopamine receptor in complex with eticlopride', journal: 'Science', journalIf: 56.9, organisms: 'Homo sapiens', ligands: 'ETQ', authors: 'Chien E, Liu W, Zhao Q' },
      { pdbId: '6B73', method: 'X-ray', resolution: 1.9, title: 'EGFR kinase domain with gefitinib', journal: 'Cell', journalIf: 66.8, organisms: 'Homo sapiens', ligands: 'GEF', authors: 'Yun C, Boggon T, Li Y' },
      { pdbId: '2KSJ', method: 'NMR', resolution: 0.0, title: 'Ubiquitin solution structure', journal: 'Journal of the American Chemical Society', journalIf: 15.4, organisms: 'Homo sapiens', ligands: '', authors: 'Cornilescu G, Marquardt J, Ottiger M' },
      { pdbId: '5XNL', method: 'NMR', resolution: 0.0, title: 'Alpha-synuclein fibril structure', journal: 'Nature Structural & Molecular Biology', journalIf: 15.8, organisms: 'Homo sapiens', ligands: '', authors: 'Li B, Huang P, Zhuang R' },
      { pdbId: '2L2U', method: 'NMR', resolution: 0.0, title: 'Calmodulin-CaM kinase I peptide complex', journal: 'Biochemistry', journalIf: 3.0, organisms: 'Homo sapiens', ligands: 'CA', authors: 'Ikura M, et al.' },
      { pdbId: '6OMS', method: 'Cryo-EM', resolution: 3.5, title: 'Human mTORC1 complex', journal: 'Nature', journalIf: 64.8, organisms: 'Homo sapiens', ligands: 'ATP', authors: 'Aylett C, Sauer E, Imseng S' },
      { pdbId: '7A4W', method: 'Cryo-EM', resolution: 3.1, title: 'Human ATP synthase (FoF1) in lipid nanodisc', journal: 'Cell', journalIf: 66.8, organisms: 'Homo sapiens', ligands: 'ATP,PCD', authors: 'Spikes T, Hossain M, Robinson C' },
      { pdbId: '8FGT', method: 'Cryo-EM', resolution: 2.7, title: 'PI3Kα oncogenic mutant complex with alpelisib', journal: 'Cancer Cell', journalIf: 38.6, organisms: 'Homo sapiens', ligands: 'ALP', authors: 'Hao Y, et al.' },
      { pdbId: '7VDE', method: 'Cryo-EM', resolution: 3.4, title: 'Alpha-2 adrenergic receptor-Gi complex', journal: 'Nature', journalIf: 64.8, organisms: 'Homo sapiens', ligands: 'RSX', authors: 'Liang Y, et al.' },
      { pdbId: '3ALN', method: 'X-ray', resolution: 1.6, title: 'Carbonic anhydrase II with sulfonamide inhibitor', journal: 'Bioorganic & Medicinal Chemistry', journalIf: 3.1, organisms: 'Homo sapiens', ligands: 'SMM', authors: 'Domsic J, et al.' },
      { pdbId: '4ANJ', method: 'X-ray', resolution: 2.2, title: 'Aldose reductase in complex with IDD594', journal: 'Acta Crystallographica D', journalIf: 3.4, organisms: 'Homo sapiens', ligands: '594', authors: 'Koch C, et al.' },
      { pdbId: '6I4B', method: 'X-ray', resolution: 1.8, title: 'p38 MAP kinase with BIRB-796 inhibitor', journal: 'Journal of Medicinal Chemistry', journalIf: 7.4, organisms: 'Homo sapiens', ligands: 'B96', authors: 'Pargellis C, et al.' },
      { pdbId: '3EML', method: 'X-ray', resolution: 2.0, title: 'E. coli alkaline phosphatase mutant', journal: 'Protein Science', journalIf: 4.0, organisms: 'Escherichia coli', ligands: 'ZN,MG', authors: 'Wang J, et al.' },
      { pdbId: '6TIA', method: 'Cryo-EM', resolution: 3.8, title: 'HIV-1 capsid hexamer (subtomogram avg)', journal: 'Cell', journalIf: 66.8, organisms: 'Human immunodeficiency virus 1', ligands: 'IP6', authors: 'Mendonca L, Sun D, Ning J' },
      { pdbId: '8CSV', method: 'Cryo-EM', resolution: 2.9, title: 'Bacterial flagellar motor C-ring complex', journal: 'Nature Microbiology', journalIf: 28.3, organisms: 'Salmonella enterica', ligands: 'MG', authors: 'Carroll L, et al.' },
      { pdbId: '7C7L', method: 'Cryo-EM', resolution: 3.2, title: 'SARS-CoV-2 nucleocapsid protein (RNA complex)', journal: 'Nature Communications', journalIf: 16.6, organisms: 'Severe acute respiratory syndrome coronavirus 2', ligands: 'RNA', authors: 'Ye Q, West A, Silletti S' },
      { pdbId: '1UBQ', method: 'X-ray', resolution: 1.8, title: 'Ubiquitin (refined at 1.8 Å)', journal: 'Protein Science', journalIf: 4.0, organisms: 'Homo sapiens', ligands: '', authors: 'Vijay-Kumar S, Bugg C, Cook W' },
      { pdbId: '9ANT', method: 'X-ray', resolution: 0.9, title: 'Antifreeze protein type III (ultra-high res)', journal: 'Journal of Molecular Biology', journalIf: 5.6, organisms: 'Macrozoarces americanus', ligands: '', authors: 'Chao H, et al.' },
      { pdbId: '6C6J', method: 'X-ray', resolution: 1.3, title: 'Lysozyme mutant (T4 lysozyme)', journal: 'Biochemistry', journalIf: 3.0, organisms: 'Enterobacteria phage T4', ligands: 'CL', authors: 'Liu S, et al.' },
      { pdbId: '8HKX', method: 'Cryo-EM', resolution: 2.5, title: 'GPCR-G protein complex (beta2-AR-Gs)', journal: 'Nature', journalIf: 64.8, organisms: 'Homo sapiens', ligands: 'NEB,GSP', authors: 'Ma X, et al.' },
    ];

    const structuresToCreate: any[] = [];
    for (const week of weeks) {
      const count = week.weekId === '2026-W31' ? 10 : week.weekId === '2026-W30' ? 12 : 8;
      const startIndex = week.weekId === '2026-W31' ? 0 : week.weekId === '2026-W30' ? 10 : 22;
      for (let i = 0; i < count; i++) {
        const s = demoStructures[(startIndex + i) % demoStructures.length];
        const fetchDate = new Date(now.getTime() - week.offsetDays * 24 * 60 * 60 * 1000);
        structuresToCreate.push({
          ...s,
          weekId: week.weekId,
          fetchDate: fetchDate.toISOString().split('T')[0],
          releaseDate: fetchDate.toISOString().split('T')[0],
          doi: `10.1038/s41586-${23 + i}-0${1000 + i}-0`,
          pubmedId: String(38000000 + i + startIndex),
        });
      }
    }

    // Deduplicate by pdbId (only one PdbStructure per ID)
    const uniqueStructures = new Map<string, any>();
    for (const s of structuresToCreate) {
      if (!uniqueStructures.has(s.pdbId)) {
        uniqueStructures.set(s.pdbId, s);
      }
    }

    for (const [, s] of uniqueStructures) {
      await db.pdbStructure.upsert({
        where: { pdbId: s.pdbId },
        update: {},
        create: {
          pdbId: s.pdbId,
          method: s.method,
          releaseDate: s.releaseDate,
          resolution: s.resolution,
          title: s.title,
          doi: s.doi,
          journal: s.journal,
          journalIf: s.journalIf,
          authors: s.authors,
          organisms: s.organisms,
          ligands: s.ligands,
          weekId: s.weekId,
          pubmedId: s.pubmedId,
          fetchDate: s.fetchDate,
        },
      });
    }

    // Create weekly snapshots with aggregated counts
    for (const week of weeks) {
      const weekStructures = structuresToCreate.filter((s) => s.weekId === week.weekId);
      const cryoem = weekStructures.filter((s) => s.method === 'Cryo-EM').length;
      const xray = weekStructures.filter((s) => s.method === 'X-ray').length;
      const nmr = weekStructures.filter((s) => s.method === 'NMR').length;
      const other = weekStructures.length - cryoem - xray - nmr;
      const resStructures = weekStructures.filter((s) => s.resolution > 0);
      const avgRes = resStructures.length > 0
        ? resStructures.reduce((sum, s) => sum + s.resolution, 0) / resStructures.length
        : null;
      const topJournals = Array.from(
        new Set(weekStructures.map((s) => s.journal))
      ).slice(0, 5).join('; ');

      await db.weeklySnapshot.upsert({
        where: { weekId: week.weekId },
        update: {},
        create: {
          weekId: week.weekId,
          weekStart: week.weekStart,
          weekEnd: week.weekEnd,
          totalStructures: weekStructures.length,
          cryoemCount: cryoem,
          xrayCount: xray,
          nmrCount: nmr,
          otherCount: other,
          avgResolution: avgRes,
          topJournals,
        },
      });
    }

    // ── 2. Sample Weekly Report ───────────────────────────────────────
    await db.weeklyReport.create({
      data: {
        weekId: '2026-W31',
        reportType: 'generator',
        title: 'Weekly PDB Structure Report — Week 31 of 2026',
        content: [
          '# PDB Weekly Report — Week 31 (2026-07-28 to 2026-08-03)',
          '',
          '## Summary',
          '',
          'This week saw **10 new structures** deposited in the Protein Data Bank,',
          'spanning Cryo-EM (5), X-ray crystallography (4), and NMR (1).',
          '',
          '## Highlights',
          '',
          '### 1. SARS-CoV-2 Spike Glycoprotein (7KQR)',
          '- **Method**: Cryo-EM at 2.8 Å resolution',
          '- **Significance**: Open-state conformation reveals new epitopes',
          '- **Journal**: Nature (IF 64.8)',
          '',
          '### 2. Human GABA-A Receptor (7V4Q)',
          '- **Method**: Cryo-EM at 2.6 Å resolution',
          '- **Significance**: First structure with diazepam bound',
          '- **Journal**: Nature (IF 64.8)',
          '',
          '### 3. SARS-CoV-2 Main Protease (6LU7)',
          '- **Method**: X-ray at 2.1 Å resolution',
          '- **Significance**: Drug target for COVID-19 antivirals',
          '- **Journal**: Nature (IF 64.8)',
          '',
          '## Method Distribution',
          '',
          '| Method | Count | Percentage |',
          '|--------|-------|-----------|',
          '| Cryo-EM | 5 | 50% |',
          '| X-ray | 4 | 40% |',
          '| NMR | 1 | 10% |',
          '',
          '## Resolution Distribution',
          '',
          '- Sub-2Å: 2 structures (high detail)',
          '- 2-3Å: 6 structures (medium detail)',
          '- Above 3Å: 1 structure (low detail)',
          '',
          '## Top Journals',
          '',
          '1. Nature (4 papers)',
          '2. Cell (2 papers)',
          '3. Nature Microbiology (1 paper)',
          '4. Journal of Molecular Biology (1 paper)',
          '5. JACS (1 paper)',
        ].join('\n'),
        filename: 'weekly-report-2026-W31.md',
      },
    });

    // ── 3. Sample Evaluations ─────────────────────────────────────────
    const sampleEvaluations = [
      {
        uniprotId: 'P07766',
        entryName: 'PSME1_HUMAN',
        proteinName: 'Proteasome activator complex subunit 1',
        geneNames: 'PSME1',
        organism: 'Homo sapiens',
        sequenceLength: 249,
        coverage: 87.5,
        scores: JSON.stringify({ structure: 78, function: 65, topology: 82, feasibility: 71, overall: 74 }),
        report: '# Target Evaluation Report: PSME1 (P07766)\n\n## 1. Target Overview\n\nProteasome activator complex subunit 1 (PSME1) is a key regulator of the 20S proteasome...\n\n## 2. Structural Coverage\n\n- **PDB structures**: 12 structures available\n- **Coverage**: 87.5% of sequence\n- **Best resolution**: 2.1 Å (1J6Q)\n- **Methods**: X-ray (8), Cryo-EM (4)\n\n## 3. Druggability Assessment\n\n### Structure Score: 78/100\nStrong structural coverage with multiple high-resolution structures.\n\n### Function Score: 65/100\nProteasome regulator with known small-molecule inhibitors.\n\n### Feasibility Score: 71/100\nModerate feasibility — challenging but not impossible target.\n\n## 4. Conclusion\n\nPSME1 represents a **moderately druggable** target with strong structural coverage.',
        pdbCountAtEval: 12,
        maxPdbUsed: 12,
        blastWasSkipped: false,
      },
      {
        uniprotId: 'P00533',
        entryName: 'EGFR_HUMAN',
        proteinName: 'Epidermal growth factor receptor',
        geneNames: 'EGFR',
        organism: 'Homo sapiens',
        sequenceLength: 1210,
        coverage: 92.3,
        scores: JSON.stringify({ structure: 95, function: 98, topology: 90, feasibility: 92, overall: 94 }),
        report: '# Target Evaluation Report: EGFR (P00533)\n\n## 1. Target Overview\n\nEGFR is a transmembrane receptor tyrosine kinase and one of the most successful oncology drug targets...\n\n## 2. Structural Coverage\n\n- **PDB structures**: 287 structures available\n- **Coverage**: 92.3% of sequence\n- **Best resolution**: 1.3 Å\n- **Methods**: X-ray (260), Cryo-EM (27)\n\n## 3. Druggability Assessment\n\n### Structure Score: 95/100\nExtensive structural coverage including kinase domain, extracellular domain, and full-length structures.\n\n### Function Score: 98/100\nValidated drug target — FDA-approved inhibitors (gefitinib, erlotinib, osimertinib).\n\n### Feasibility Score: 92/100\nHighly feasible — proven target with multiple approved drugs.\n\n## 4. Conclusion\n\nEGFR is a **highly druggable** target with unparalleled structural coverage and clinical validation.',
        pdbCountAtEval: 50,
        maxPdbUsed: 50,
        blastWasSkipped: true,
      },
      {
        uniprotId: 'Q9Y6K9',
        entryName: 'DGKZ_HUMAN',
        proteinName: 'Diacylglycerol kinase zeta',
        geneNames: 'DGKZ',
        organism: 'Homo sapiens',
        sequenceLength: 733,
        coverage: 45.2,
        scores: JSON.stringify({ structure: 42, function: 58, topology: 55, feasibility: 38, overall: 48 }),
        report: '# Target Evaluation Report: DGKZ (Q9Y6K9)\n\n## 1. Target Overview\n\nDiacylglycerol kinase zeta is a lipid kinase that phosphorylates diacylglycerol to phosphatidic acid...\n\n## 2. Structural Coverage\n\n- **PDB structures**: 4 structures (partial domains only)\n- **Coverage**: 45.2% of sequence\n- **Best resolution**: 2.4 Å\n\n## 3. Druggability Assessment\n\n### Structure Score: 42/100\nLimited structural coverage — catalytic domain has no full-length structure.\n\n### Function Score: 58/100\nKnown signaling function but no approved drugs targeting DGKZ directly.\n\n### Feasibility Score: 38/100\nChallenging target — requires structural biology investment.\n\n## 4. Conclusion\n\nDGKZ is a **difficult target** requiring additional structural work.',
        pdbCountAtEval: 4,
        maxPdbUsed: 4,
        blastWasSkipped: false,
      },
    ];

    for (const ev of sampleEvaluations) {
      await db.evaluation.upsert({
        where: { uniprotId: ev.uniprotId },
        update: {},
        create: ev,
      });
    }

    // ── 3b. Sample PDB Structures for Evaluations ────────────────────
    const evalPdbStructures = [
      // EGFR (P00533) — 3 structures
      { uniprotId: 'P00533', pdbId: '1M17', method: 'X-ray', resolution: 2.6, title: 'EGFR kinase domain with erlotinib', journal: 'Biochemistry', journalIf: 3.0, depositionDate: '2002-01-15', releaseDate: '2002-06-01', ligand: '416', ligandNames: 'Erlotinib' },
      { uniprotId: 'P00533', pdbId: '2ITZ', method: 'X-ray', resolution: 2.4, title: 'EGFR kinase domain with gefitinib', journal: 'Biochemistry', journalIf: 3.0, depositionDate: '2007-03-01', releaseDate: '2007-09-01', ligand: '184', ligandNames: 'Gefitinib' },
      { uniprotId: 'P00533', pdbId: '6S9B', method: 'Cryo-EM', resolution: 3.2, title: 'Full-length EGFR in active dimer', journal: 'Nature', journalIf: 64.8, depositionDate: '2019-07-01', releaseDate: '2019-12-01', ligand: null, ligandNames: null },
      // PSME1 (P07766) — 2 structures
      { uniprotId: 'P07766', pdbId: '1J6Q', method: 'X-ray', resolution: 2.1, title: 'Proteasome activator PA28 alpha', journal: 'Journal of Molecular Biology', journalIf: 3.5, depositionDate: '2001-10-01', releaseDate: '2002-04-01', ligand: null, ligandNames: null },
      { uniprotId: 'P07766', pdbId: '3UKW', method: 'Cryo-EM', resolution: 3.5, title: '20S proteasome with PA28 activator', journal: 'Nature', journalIf: 64.8, depositionDate: '2012-01-01', releaseDate: '2012-06-01', ligand: null, ligandNames: null },
      // DGKZ (Q9Y6K9) — 1 structure
      { uniprotId: 'Q9Y6K9', pdbId: '5D9Y', method: 'X-ray', resolution: 2.4, title: 'DGKZ C1 domain', journal: 'Structure', journalIf: 4.5, depositionDate: '2015-08-01', releaseDate: '2016-02-01', ligand: null, ligandNames: null },
    ];

    for (const pdb of evalPdbStructures) {
      const existing = await db.evaluationPdbStructure.findFirst({
        where: { uniprotId: pdb.uniprotId, pdbId: pdb.pdbId },
      });
      if (!existing) {
        await db.evaluationPdbStructure.create({ data: pdb });
      }
    }

    // ── 4. Sample PubMed Articles (Literature) ────────────────────────
    // Schema: pubmedId, title, authors, journal, pubYear, pubMonth, pubDay, abstract, doi
    const sampleArticles = [
      { pubmedId: '38000001', title: 'Cryo-EM structure of SARS-CoV-2 spike protein in open conformation', journal: 'Nature', pubYear: '2026', pubMonth: '07', pubDay: '28', authors: 'Walls A; Park Y; Tortorici M', doi: '10.1038/s41586-023-06812-0', abstract: 'We present the cryo-EM structure of the SARS-CoV-2 spike glycoprotein in the open state at 2.8 Å resolution...' },
      { pubmedId: '38000002', title: 'Structural basis of GABA-A receptor modulation by benzodiazepines', journal: 'Nature', pubYear: '2026', pubMonth: '07', pubDay: '29', authors: 'Zhu S; Noviello C; Teng J', doi: '10.1038/s41586-023-06813-1', abstract: 'Benzodiazepines are widely prescribed drugs that enhance GABA-A receptor function...' },
      { pubmedId: '38000003', title: 'High-resolution structure of human Nav1.7 sodium channel', journal: 'Science', pubYear: '2026', pubMonth: '07', pubDay: '30', authors: 'Shen H; Liu D; Wu K', doi: '10.1126/science.abk1234', abstract: 'Voltage-gated sodium channels are critical for electrical signaling in excitable cells...' },
      { pubmedId: '38000004', title: 'SARS-CoV-2 main protease: a target for antiviral drug development', journal: 'Nature', pubYear: '2026', pubMonth: '07', pubDay: '31', authors: 'Jin Z; Du X; Xu Y', doi: '10.1038/s41586-023-06814-2', abstract: 'The main protease of SARS-CoV-2 (Mpro) is essential for viral replication...' },
      { pubmedId: '38000005', title: 'EGFR kinase domain: structural insights into inhibitor selectivity', journal: 'Cell', pubYear: '2026', pubMonth: '08', pubDay: '01', authors: 'Yun C; Boggon T; Li Y', doi: '10.1016/j.cell.2026.07.001', abstract: 'EGFR mutations are common drivers of non-small cell lung cancer...' },
      { pubmedId: '38000006', title: 'Structure of the human mTORC1 signaling complex', journal: 'Nature', pubYear: '2026', pubMonth: '08', pubDay: '02', authors: 'Aylett C; Sauer E; Imseng S', doi: '10.1038/s41586-023-06815-3', abstract: 'mTORC1 is a master regulator of cell growth and metabolism...' },
      { pubmedId: '38000007', title: 'Alpha-synuclein fibril structure revealed by solid-state NMR', journal: 'Nature Structural & Molecular Biology', pubYear: '2026', pubMonth: '07', pubDay: '28', authors: 'Li B; Huang P; Zhuang R', doi: '10.1038/s41594-023-01123-4', abstract: 'Alpha-synuclein aggregation is a hallmark of Parkinson disease...' },
      { pubmedId: '38000008', title: 'Bacterial ribosome assembly: new insights from cryo-EM', journal: 'Nature Microbiology', pubYear: '2026', pubMonth: '08', pubDay: '03', authors: 'Crowley-McKenna E; et al.', doi: '10.1038/s41564-023-01456-7', abstract: 'Ribosome assembly is a complex process involving over 200 assembly factors...' },
    ];

    for (const article of sampleArticles) {
      const existing = await db.pubMedArticle.findUnique({ where: { pubmedId: article.pubmedId } });
      if (!existing) {
        await db.pubMedArticle.create({ data: article });
      }
    }

    // ── 5. Sample Literature Digest ───────────────────────────────────
    // Schema: id, date, paperCount, methodStats, digest, llmOk, llmProvider, llmModel, llmDurationMs, filePath
    try {
      await db.literatureDigest.create({
        data: {
          date: '2026-08-03',
          paperCount: 8,
          methodStats: JSON.stringify({ 'Cryo-EM': 5, 'X-ray': 2, 'NMR': 1 }),
          digest: '## Literature Digest — 2026-08-03\n\nThis week saw **8 important structural biology papers** published across top-tier journals. Cryo-EM dominated with 5 papers (62.5%), followed by X-ray crystallography (2 papers) and NMR (1 paper).\n\n### Highlights\n\n1. **SARS-CoV-2 spike protein** open-state structure at 2.8 Å (Nature)\n2. **GABA-A receptor** with diazepam bound at 2.6 Å (Nature)\n3. **Human Nav1.7** sodium channel at 3.0 Å (Science) — new pain drug target\n4. **EGFR kinase** selectivity insights (Cell)\n5. **mTORC1 complex** structure (Nature)\n\n### Method Distribution\n\n- Cryo-EM: 5 papers (62.5%)\n- X-ray: 2 papers (25%)\n- NMR: 1 paper (12.5%)\n\n### Top Journals\n\n- Nature: 4 papers\n- Cell: 1 paper\n- Science: 1 paper\n- Nature Structural & Molecular Biology: 1 paper\n- Nature Microbiology: 1 paper',
          llmOk: true,
          llmProvider: 'z.ai',
          llmModel: 'GLM-4.6',
          llmDurationMs: 12500,
        },
      });
    } catch {
      // LiteratureDigest has @@unique([date]) — may already exist
    }

    return NextResponse.json({
      ok: true,
      message: 'Demo data seeded successfully!',
      stats: {
        pdbStructures: await db.pdbStructure.count(),
        weeklySnapshots: await db.weeklySnapshot.count(),
        weeklyReports: await db.weeklyReport.count(),
        evaluations: await db.evaluation.count(),
        pubMedArticles: await db.pubMedArticle.count(),
        literatureDigests: await db.literatureDigest.count(),
      },
    });
  } catch (err: any) {
    console.error('[seed-demo] Error:', err);
    return NextResponse.json(
      { ok: false, error: err.message || String(err) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/seed-demo
 * Returns the current database counts so the UI can show whether
 * demo data has been seeded.
 */
export async function GET() {
  try {
    const [pdbStructures, weeklySnapshots, weeklyReports, evaluations, pubMedArticles, literatureDigests] =
      await Promise.all([
        db.pdbStructure.count(),
        db.weeklySnapshot.count(),
        db.weeklyReport.count(),
        db.evaluation.count(),
        db.pubMedArticle.count(),
        db.literatureDigest.count(),
      ]);

    return NextResponse.json({
      pdbStructures,
      weeklySnapshots,
      weeklyReports,
      evaluations,
      pubMedArticles,
      literatureDigests,
      isSeeded: pdbStructures > 0 || evaluations > 0 || pubMedArticles > 0,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message || String(err) },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/seed-demo
 *
 * Clears all demo data from the database. This is the "Reset Database"
 * action — wipes all tables back to empty so the user can start fresh
 * or load new demo data.
 *
 * Also clears related tables that reference the main entities (chains,
 * entities, eval PDB structures, blast results, eval reports).
 */
export async function DELETE() {
  try {
    // Delete in dependency order (children before parents)
    const results = {
      pdbChains: await db.pdbChain.deleteMany(),
      pdbEntities: await db.pdbEntity.deleteMany(),
      pdbStructures: await db.pdbStructure.deleteMany(),
      weeklySnapshots: await db.weeklySnapshot.deleteMany(),
      weeklyReports: await db.weeklyReport.deleteMany(),
      evalPdbStructures: await db.evaluationPdbStructure.deleteMany(),
      evalBlastResults: await db.evaluationBlastResult.deleteMany(),
      evalReports: await db.evaluationReport.deleteMany(),
      evaluations: await db.evaluation.deleteMany(),
      pubMedArticles: await db.pubMedArticle.deleteMany(),
      literatureDigests: await db.literatureDigest.deleteMany(),
    };

    const totalDeleted = Object.values(results).reduce(
      (sum, r) => sum + r.count,
      0
    );

    return NextResponse.json({
      ok: true,
      message: 'All demo data cleared successfully.',
      deleted: {
        pdbChains: results.pdbChains.count,
        pdbEntities: results.pdbEntities.count,
        pdbStructures: results.pdbStructures.count,
        weeklySnapshots: results.weeklySnapshots.count,
        weeklyReports: results.weeklyReports.count,
        evalPdbStructures: results.evalPdbStructures.count,
        evalBlastResults: results.evalBlastResults.count,
        evalReports: results.evalReports.count,
        evaluations: results.evaluations.count,
        pubMedArticles: results.pubMedArticles.count,
        literatureDigests: results.literatureDigests.count,
      },
      totalDeleted,
    });
  } catch (err: any) {
    console.error('[seed-demo DELETE] Error:', err);
    return NextResponse.json(
      { ok: false, error: err.message || String(err) },
      { status: 500 }
    );
  }
}
