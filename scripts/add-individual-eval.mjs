// Adds an additional individual Evaluation (no batch) so we can preview
// the new "Individual Evaluations" sidebar item styling.
//
// Usage: bun run scripts/add-individual-eval.mjs

import { db } from '../src/lib/db.ts';

async function main() {
  const UNIPROT = 'P04637'; // p53 tumor suppressor
  const exists = await db.evaluation.findUnique({ where: { uniprotId: UNIPROT } });
  if (exists) {
    // Ensure it's NOT in a batch so it shows in Individual Evaluations
    await db.evaluation.update({
      where: { uniprotId: UNIPROT },
      data: { batchId: null, proteinName: 'Cellular tumor antigen p53', geneNames: 'TP53', organism: 'Homo sapiens', coverage: 92.3, scores: JSON.stringify({ Overall: { score: 8.5, max: 10, rating: 'good' }, Structure: { score: 9, max: 10 }, Function: { score: 9, max: 10 }, Topology: { score: 8, max: 10 }, Feasibility: { score: 8, max: 10 } }) },
    });
    console.log(`Updated existing ${UNIPROT} (cleared batchId)`);
  } else {
    await db.evaluation.create({
      data: {
        uniprotId: UNIPROT,
        proteinName: 'Cellular tumor antigen p53',
        geneNames: 'TP53',
        organism: 'Homo sapiens',
        sequenceLength: 393,
        coverage: 92.3,
        scores: JSON.stringify({ Overall: { score: 8.5, max: 10, rating: 'good' }, Structure: { score: 9, max: 10 }, Function: { score: 9, max: 10 }, Topology: { score: 8, max: 10 }, Feasibility: { score: 8, max: 10 } }),
        report: '# p53 Target Evaluation\n\n## Overview\np53 is a tumor suppressor protein...',
        batchId: null,
      },
    });
    console.log(`Created ${UNIPROT}`);
  }

  // Add 2 PDB structures for p53 so the badge shows
  const pdbRows = [
    { uniprotId: UNIPROT, pdbId: '1TUP', method: 'X-ray', resolution: 1.7, title: 'p53 DNA-binding domain complexed with DNA', journal: 'Science', journalIf: 56.9, depositionDate: '1994-07-01', releaseDate: '1995-01-01', ligand: null, ligandNames: null },
    { uniprotId: UNIPROT, pdbId: '2OCJ', method: 'X-ray', resolution: 1.8, title: 'p53 tetramerization domain', journal: 'Nature', journalIf: 64.8, depositionDate: '2006-10-01', releaseDate: '2007-04-01', ligand: null, ligandNames: null },
  ];
  for (const pdb of pdbRows) {
    const existing = await db.evaluationPdbStructure.findFirst({ where: { uniprotId: pdb.uniprotId, pdbId: pdb.pdbId } });
    if (!existing) {
      await db.evaluationPdbStructure.create({ data: pdb });
      console.log(`  + PDB ${pdb.pdbId}`);
    }
  }

  console.log('Done.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await (db.$disconnect?.()); });
