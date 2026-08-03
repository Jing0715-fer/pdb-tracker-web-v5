// Quick script to seed an EvaluationBatch row that groups the existing
// demo evaluations (Q9Y6K9, P00533, P07766). This lets us preview the
// batch-detail sidebar (with sub-target items) in the Evaluation view.
//
// Usage:
//   bun run scripts/seed-eval-batch.mjs
//
// Idempotent: if a batch with the same demo title already exists, it
// re-uses it (re-assigns the same evaluations).

import { db } from '../src/lib/db.ts';

async function main() {
  const BATCH_TITLE = 'Demo Kinase & Receptor Batch';

  // Find or create the batch row.
  let batch = await db.evaluationBatch.findFirst({
    where: { title: BATCH_TITLE },
  });

  if (!batch) {
    batch = await db.evaluationBatch.create({
      data: {
        title: BATCH_TITLE,
        crossReportOk: true,
        crossReportProvider: 'demo',
        crossReportModel: 'demo-model',
        crossReportDurationMs: 1234,
        crossReportChars: 0,
        targetCount: 3,
        commonPdbIds: JSON.stringify(['1CBS', '6B73']),
      },
    });
    console.log(`Created batch ${batch.batchId}`);
  } else {
    console.log(`Reusing batch ${batch.batchId}`);
  }

  // Assign the 3 demo evaluations to this batch.
  const targetIds = ['Q9Y6K9', 'P00533', 'P07766'];
  for (const uid of targetIds) {
    const updated = await db.evaluation.updateMany({
      where: { uniprotId: uid },
      data: { batchId: batch.batchId },
    });
    console.log(`  ${uid}: ${updated.count} row(s) assigned`);
  }

  console.log('Done. Open the Evaluation view and click the batch.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await (db.$disconnect?.());
  });
