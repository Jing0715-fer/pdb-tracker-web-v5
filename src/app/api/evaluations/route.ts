import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { decodeJsonEscapes } from '@/lib/pdb-utils';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const q = searchParams.get('q') || '';

    // Get batches with sub-target counts and cross-target report metadata
    const batches = await db.$queryRaw<any[]>`
      SELECT
        b.batchId,
        b.title,
        b.combinedReport,
        b.commonPdbIds,
        b.crossReportOk,
        b.crossReportChars,
        b.targetCount,
        b.createdAt,
        CAST(COUNT(e.uniprotId) AS TEXT) as subTargetCount
      FROM EvaluationBatch b
      LEFT JOIN Evaluation e ON e.batchId = b.batchId
      GROUP BY b.batchId
      ORDER BY b.createdAt DESC
    `;

    const formattedBatches = batches.map(b => ({
      isBatch: true,
      batchId: b.batchId,
      title: decodeJsonEscapes(b.title) || b.batchId || 'Batch',
      subTargetCount: parseInt(b.subTargetCount, 10) || 0,
      combinedReport: b.combinedReport || '',
      commonPdbIds: b.commonPdbIds || null,
      crossReportOk: b.crossReportOk === 1 || b.crossReportOk === true,
      crossReportChars: b.crossReportChars != null ? Number(b.crossReportChars) : null,
      targetCount: b.targetCount != null ? Number(b.targetCount) : null,
      createdAt: b.createdAt || '',
    }));

    // Get sub-targets for each batch
    const batchIds = batches.map(b => b.batchId as string);
    const batchSubTargets: Record<string, any[]> = {};
    for (const bid of batchIds) {
      const subs = await db.$queryRaw<any[]>`
        SELECT e.uniprotId, e.proteinName, e.geneNames, e.organism, e.scores,
               CAST(COUNT(DISTINCT p.pdbId) AS TEXT) as pdbCount
        FROM Evaluation e
        LEFT JOIN EvaluationPdbStructure p ON e.uniprotId = p.uniprotId
        WHERE e.batchId = ${bid}
        GROUP BY e.uniprotId
        ORDER BY e.createdAt DESC
      `;
      const allUniprotIds = subs.map((s: any) => s.uniprotId as string);
      const blastCounts: Record<string, number> = {};
      if (allUniprotIds.length > 0) {
        const blastCountRows = await db.$queryRaw<any[]>`
          SELECT uniprotId, CAST(COUNT(*) AS TEXT) as cnt FROM EvaluationBlastResult
          WHERE uniprotId IN (${Prisma.join(allUniprotIds)})
          GROUP BY uniprotId
        `;
        for (const row of blastCountRows) {
          blastCounts[row.uniprotId as string] = parseInt(row.cnt, 10) || 0;
        }
      }
      batchSubTargets[bid] = subs.map((s: any) => {
        let scoresObj: any = {};
        try { scoresObj = s.scores ? JSON.parse(s.scores) : {}; } catch { /* ignore */ }
        return {
          uniprotId: s.uniprotId,
          proteinName: s.proteinName || '',
          geneName: s.geneNames || '',
          organism: s.organism || '',
          pdbCount: parseInt(s.pdbCount, 10) || 0,
          blastCount: blastCounts[s.uniprotId] || 0,
          bestScore: scoresObj?.Overall?.score || 0,
        };
      });
    }

    // Get individual evaluations (no batch or empty batch)
    const evalRows = q
      ? await db.$queryRaw<any[]>`
          SELECT e.* FROM Evaluation e
          WHERE e.batchId IS NULL
          AND (e.uniprotId LIKE ${'%' + q.toUpperCase() + '%'} OR e.proteinName LIKE ${'%' + q + '%'} OR e.geneNames LIKE ${'%' + q + '%'})
          ORDER BY e.updatedAt DESC
          LIMIT 100
        `
      : await db.$queryRaw<any[]>`
          SELECT e.* FROM Evaluation e
          WHERE (e.batchId IS NULL OR e.batchId = '')
          ORDER BY e.updatedAt DESC
          LIMIT 100
        `;

    // Batch fetch PDB structures and BLAST results
    const uniprotIds = evalRows.map((e: any) => e.uniprotId);
    const [pdbRows, blastRows] = await Promise.all([
      uniprotIds.length > 0
        ? db.$queryRaw<any[]>`SELECT * FROM EvaluationPdbStructure WHERE uniprotId IN (${Prisma.join(uniprotIds)}) ORDER BY uniprotId, pdbId`
        : Promise.resolve([]),
      uniprotIds.length > 0
        ? db.$queryRaw<any[]>`SELECT * FROM EvaluationBlastResult WHERE uniprotId IN (${Prisma.join(uniprotIds)}) ORDER BY uniprotId, id`
        : Promise.resolve([]),
    ]);

    const pdbByUniprot = new Map<string, any[]>();
    for (const row of pdbRows) {
      const list = pdbByUniprot.get(row.uniprotId as string) ?? [];
      list.push(row);
      pdbByUniprot.set(row.uniprotId as string, list);
    }

    const blastByUniprot = new Map<string, any[]>();
    for (const row of blastRows) {
      const list = blastByUniprot.get(row.uniprotId as string) ?? [];
      list.push(row);
      blastByUniprot.set(row.uniprotId as string, list);
    }

    const individualEvals = evalRows.map((e: any) => {
      const ePdbRows = pdbByUniprot.get(e.uniprotId) ?? [];
      const eBlastRows = blastByUniprot.get(e.uniprotId) ?? [];
      return {
        uniprotId: e.uniprotId,
        entryName: e.entryName,
        proteinName: decodeJsonEscapes(e.proteinName) || '',
        geneNames: e.geneNames || '',
        organism: e.organism || '',
        sequenceLength: e.sequenceLength,
        coverage: e.coverage,
        scores: e.scores,
        report: e.report,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
        pdbStructures: ePdbRows.map((p: any) => ({
          id: p.id,
          uniprotId: p.uniprotId,
          pdbId: p.pdbId,
          method: p.method,
          resolution: p.resolution,
          title: decodeJsonEscapes(p.title),
          depositionDate: p.depositionDate,
          releaseDate: p.releaseDate,
          ligand: p.ligand,
          ligandNames: p.ligandNames,
          journal: p.journal,
          journalIf: p.journalIf,
          doi: p.doi,
          pubmedId: p.pubmedId,
          organism: p.organism,
          authors: p.authors,
          isCryoem: p.isCryoem,
          isXray: p.isXray,
          isNmr: p.isNmr,
          ifTier: p.ifTier,
        })),
        blastResults: eBlastRows.map((b: any) => ({
          id: b.id,
          uniprotId: b.uniprotId,
          pdbId: b.pdbId,
          uniprotRef: b.uniprotRef,
          description: decodeJsonEscapes(b.description),
          identity: b.identity,
          evalue: b.evalue,
          queryCoverage: b.queryCoverage,
          targetCoverage: b.targetCoverage,
          method: b.method,
          resolution: b.resolution,
          releaseDate: b.releaseDate,
          source: b.source,
          taxonomyId: b.taxonomyId,
          journal: b.journal,
          journalIf: b.journalIf,
          ifTier: b.ifTier,
          ligand: b.ligand,
          title: decodeJsonEscapes(b.title),
          pubmedId: b.pubmedId || null,
          pubmedTitle: decodeJsonEscapes(b.pubmedTitle) || null,
          pubmedAuthors: decodeJsonEscapes(b.pubmedAuthors) || null,
          pubmedAbstract: decodeJsonEscapes(b.pubmedAbstract) || null,
        })),
      };
    });

    // Also get ALL evaluations (including batch members) with full details for comparison/dashboard
    const allEvalRows = await db.$queryRaw<any[]>`
      SELECT e.uniprotId, e.entryName, e.proteinName, e.geneNames, e.organism,
             e.sequenceLength, e.coverage, e.scores, e.report, e.batchId,
             e.createdAt, e.updatedAt
      FROM Evaluation e
      ORDER BY e.updatedAt DESC
      LIMIT 100
    `;
    const allUniprotIds = allEvalRows.map((e: any) => e.uniprotId);
    const [allPdbRows, allBlastRows] = await Promise.all([
      allUniprotIds.length > 0
        ? db.$queryRaw<any[]>`SELECT * FROM EvaluationPdbStructure WHERE uniprotId IN (${Prisma.join(allUniprotIds)}) ORDER BY uniprotId, pdbId`
        : Promise.resolve([]),
      allUniprotIds.length > 0
        ? db.$queryRaw<any[]>`SELECT * FROM EvaluationBlastResult WHERE uniprotId IN (${Prisma.join(allUniprotIds)}) ORDER BY uniprotId, id`
        : Promise.resolve([]),
    ]);
    const allPdbByUniprot = new Map<string, any[]>();
    for (const row of allPdbRows) {
      const list = allPdbByUniprot.get(row.uniprotId as string) ?? [];
      list.push(row);
      allPdbByUniprot.set(row.uniprotId as string, list);
    }
    const allBlastByUniprot = new Map<string, any[]>();
    for (const row of allBlastRows) {
      const list = allBlastByUniprot.get(row.uniprotId as string) ?? [];
      list.push(row);
      allBlastByUniprot.set(row.uniprotId as string, list);
    }
    const allEvaluations = allEvalRows.map((e: any) => {
      const ePdbRows = allPdbByUniprot.get(e.uniprotId) ?? [];
      const eBlastRows = allBlastByUniprot.get(e.uniprotId) ?? [];
      return {
        uniprotId: e.uniprotId,
        entryName: e.entryName,
        proteinName: decodeJsonEscapes(e.proteinName) || '',
        geneNames: e.geneNames || '',
        organism: e.organism || '',
        sequenceLength: e.sequenceLength,
        coverage: e.coverage,
        scores: e.scores,
        report: e.report,
        batchId: e.batchId,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
        pdbStructures: ePdbRows.map((p: any) => ({
          id: p.id,
          uniprotId: p.uniprotId,
          pdbId: p.pdbId,
          method: p.method,
          resolution: p.resolution,
          title: decodeJsonEscapes(p.title),
          depositionDate: p.depositionDate,
          releaseDate: p.releaseDate,
          ligand: p.ligand,
          ligandNames: p.ligandNames,
          journal: p.journal,
          journalIf: p.journalIf,
          doi: p.doi,
          pubmedId: p.pubmedId,
          organism: p.organism,
          authors: p.authors,
          isCryoem: p.isCryoem,
          isXray: p.isXray,
          isNmr: p.isNmr,
          ifTier: p.ifTier,
        })),
        blastResults: eBlastRows.map((b: any) => ({
          id: b.id,
          uniprotId: b.uniprotId,
          pdbId: b.pdbId,
          uniprotRef: b.uniprotRef,
          description: decodeJsonEscapes(b.description),
          identity: b.identity,
          evalue: b.evalue,
          queryCoverage: b.queryCoverage,
          targetCoverage: b.targetCoverage,
          method: b.method,
          resolution: b.resolution,
          releaseDate: b.releaseDate,
          source: b.source,
          taxonomyId: b.taxonomyId,
          journal: b.journal,
          journalIf: b.journalIf,
          ifTier: b.ifTier,
          ligand: b.ligand,
          title: decodeJsonEscapes(b.title),
          pubmedId: b.pubmedId || null,
          pubmedTitle: decodeJsonEscapes(b.pubmedTitle) || null,
          pubmedAuthors: decodeJsonEscapes(b.pubmedAuthors) || null,
          pubmedAbstract: decodeJsonEscapes(b.pubmedAbstract) || null,
        })),
      };
    });

    // Use safeJsonParse to handle any remaining BigInt values
    const { safeJsonParse } = await import('@/lib/utils');
    return NextResponse.json(safeJsonParse({
      batches: formattedBatches,
      batchSubTargets,
      individualEvals,
      allEvaluations,
    }));
  } catch (error) {
    console.error('[api/evaluations] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch evaluations', batches: null, batchSubTargets: null, individualEvals: null },
      { status: 500 }
    );
  }
}
