import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

export interface BatchSubTarget {
  uniprotId: string;
  proteinName: string;
  geneName: string;
  organism: string;
  pdbCount: number;
  pdbStructures: Array<{
    pdbId: string;
    method: string;
    resolution: number | null;
    title: string;
    depositionDate: string;
    releaseDate: string;
    ligand: string;
    journalIf: number | null;
    ifTier: string;
  }>;
}

export interface BatchDetail {
  batchId: string;
  title: string;
  combinedReport: string;
  created: string;
  subTargets: BatchSubTarget[];
}

export async function getBatchWithSubTargets(batchId: string): Promise<BatchDetail | null> {
  const batchRows = await db.$queryRaw<any[]>`
    SELECT * FROM evaluation_batches WHERE batch_id = ${batchId}
  `;

  if (!batchRows || batchRows.length === 0) return null;

  const batch = batchRows[0];

  const evalRows = await db.$queryRaw<any[]>`
    SELECT e.*, COUNT(p.pdb_id) as pdb_count
    FROM evaluations e
    LEFT JOIN evaluation_pdb_structures p ON e.uniprot_id = p.uniprot_id
    WHERE e.batch_id = ${batchId}
    GROUP BY e.uniprot_id
    ORDER BY e.created_at DESC
  `;

  const subTargets: BatchSubTarget[] = [];

  for (const row of evalRows) {
    const pdbRows = await db.$queryRaw<any[]>`
      SELECT * FROM evaluation_pdb_structures 
      WHERE uniprot_id = ${row.uniprot_id} 
      ORDER BY pdb_id
    `;

    subTargets.push({
      uniprotId: row.uniprot_id,
      proteinName: row.protein_name || '',
      geneName: row.gene_names || '',
      organism: row.organism || '',
      pdbCount: row.pdb_count || 0,
      pdbStructures: pdbRows.map((p: any) => ({
        pdbId: p.pdb_id,
        method: p.method || '',
        resolution: p.resolution,
        title: p.title || '',
        depositionDate: p.deposition_date || '',
        releaseDate: p.release_date || '',
        ligand: p.ligand || '',
        journalIf: p.journal_if,
        ifTier: p.if_tier || 'unknown',
      })),
    });
  }

  return {
    batchId: batch.batch_id,
    title: batch.title || batch.batch_id,
    combinedReport: batch.combined_report || '',
    created: batch.created_at,
    subTargets,
  };
}

export async function createOrUpdateBatch(
  batchId: string,
  title: string,
  combinedReport: string,
  subTargetIds: string[]
): Promise<void> {
  const now = new Date().toISOString();

  await db.$executeRaw`
    INSERT OR REPLACE INTO evaluation_batches (batch_id, title, combined_report, created_at, updated_at)
    VALUES (${batchId}, ${title}, ${combinedReport}, ${now}, ${now})
  `;

  if (subTargetIds.length > 0) {
    // Use Prisma.join to safely bind array values — avoids string-concatenating
    // placeholders into $executeRaw template, which would bypass parameterization.
    const bindings = subTargetIds.map(id => Prisma.sql`${id}`);
    await db.$executeRaw`UPDATE evaluations SET batch_id = ${batchId} WHERE uniprot_id IN (${Prisma.join(bindings)})`;
  }
}

export async function deleteBatch(batchId: string): Promise<void> {
  await db.$executeRaw`UPDATE evaluations SET batch_id = NULL WHERE batch_id = ${batchId}`;
  await db.$executeRaw`DELETE FROM evaluation_batches WHERE batch_id = ${batchId}`;
}