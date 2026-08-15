// Update demo evaluations to have non-zero Overall scores so the
// sidebar item score badges and colored accent bars are visible.
//
// Usage: bun run scripts/update-eval-scores.mjs

import { db } from '../src/lib/db.ts';

async function main() {
  const updates = [
    { uniprotId: 'Q9Y6K9', overall: 4.2 },  // DGKZ — challenging target (orange)
    { uniprotId: 'P00533', overall: 9.1 },  // EGFR — highly druggable (teal)
    { uniprotId: 'P07766', overall: 7.5 },  // PSME1 — moderately druggable (green)
    { uniprotId: 'P04637', overall: 8.5 },  // p53 — already has 8.5
  ];

  for (const u of updates) {
    // Read existing scores JSON, merge Overall, write back
    const ev = await db.evaluation.findUnique({ where: { uniprotId: u.uniprotId }, select: { scores: true } });
    if (!ev) {
      console.log(`  skip ${u.uniprotId} (not found)`);
      continue;
    }
    let scoresObj = {};
    try { scoresObj = ev.scores ? JSON.parse(ev.scores) : {}; } catch { scoresObj = {}; }
    scoresObj.Overall = { score: u.overall, max: 10, rating: u.overall >= 8 ? 'good' : u.overall >= 6 ? 'moderate' : 'poor' };
    if (!scoresObj.Structure) scoresObj.Structure = { score: Math.round(u.overall), max: 10 };
    if (!scoresObj.Function) scoresObj.Function = { score: Math.round(u.overall), max: 10 };
    if (!scoresObj.Topology) scoresObj.Topology = { score: Math.max(1, Math.round(u.overall - 1)), max: 10 };
    if (!scoresObj.Feasibility) scoresObj.Feasibility = { score: Math.max(1, Math.round(u.overall - 2)), max: 10 };

    await db.evaluation.update({
      where: { uniprotId: u.uniprotId },
      data: { scores: JSON.stringify(scoresObj) },
    });
    console.log(`  updated ${u.uniprotId} → Overall ${u.overall}`);
  }
  console.log('Done.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await (db.$disconnect?.()); });
