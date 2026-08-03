import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const evals = await db.evaluation.findMany({ select: { uniprotId: true, batchId: true, proteinName: true } });
console.log('Total evaluations:', evals.length);
console.log(JSON.stringify(evals, null, 2));
await db.$disconnect();
