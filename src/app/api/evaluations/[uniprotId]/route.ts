import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { safeJsonParse } from '@/lib/utils';
import { decodeJsonEscapes } from '@/lib/pdb-utils';

function toCamelCase(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return Number(obj);
  if (Array.isArray(obj)) return obj.map(toCamelCase);
  if (typeof obj !== 'object') return obj;
  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camelKey] = toCamelCase(value);
  }
  return result;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uniprotId: string }> }
) {
  try {
    const { uniprotId } = await params;

    const evalRows = await db.$queryRaw`
      SELECT * FROM Evaluation WHERE uniprotId = ${uniprotId}
    `;

    if (!evalRows || (evalRows as any[]).length === 0) {
      return NextResponse.json({ error: 'Evaluation not found' }, { status: 404 });
    }

    const evaluation = toCamelCase((evalRows as any[])[0]);
    // Decode JSON Unicode escapes in evaluation text fields
    if (evaluation.proteinName) evaluation.proteinName = decodeJsonEscapes(evaluation.proteinName);
    if (evaluation.report) evaluation.report = decodeJsonEscapes(evaluation.report);

    // Fetch PDB structures with pubmed metadata
    const pdbStructures = await db.$queryRaw`
      SELECT p.*, a.title AS pubmedTitle, a.authors AS pubmedAuthors, a.abstract AS pubmedAbstract
      FROM EvaluationPdbStructure p
      LEFT JOIN PubMedArticle a ON p.pubmedId = a.pubmedId
      WHERE p.uniprotId = ${uniprotId}
      ORDER BY p.releaseDate DESC
    `;
    evaluation.pdbStructures = (pdbStructures as any[]).map((p: any) => {
      const row = toCamelCase(p);
      // Decode JSON Unicode escapes in text fields
      if (row.title) row.title = decodeJsonEscapes(row.title);
      if (row.ligand) row.ligand = decodeJsonEscapes(row.ligand);
      if (row.journal) row.journal = decodeJsonEscapes(row.journal);
      if (row.pubmedTitle) row.pubmedTitle = decodeJsonEscapes(row.pubmedTitle);
      if (row.pubmedAbstract) row.pubmedAbstract = decodeJsonEscapes(row.pubmedAbstract);
      if (row.pubmedAuthors) row.pubmedAuthors = decodeJsonEscapes(row.pubmedAuthors);
      if (row.authors) row.authors = decodeJsonEscapes(row.authors);
      return row;
    });

    // Fetch BLAST results with pubmed metadata
    const blastResults = await db.$queryRaw`
      SELECT b.*, a.title AS pubmedTitle, a.authors AS pubmedAuthors, a.abstract AS pubmedAbstractJoined,
             b.pubmedAbstract AS pubmedAbstract
      FROM EvaluationBlastResult b
      LEFT JOIN PubMedArticle a ON b.pubmedId = a.pubmedId
      WHERE b.uniprotId = ${uniprotId}
      ORDER BY b.identity DESC
    `;
    evaluation.blastResults = (blastResults as any[]).map((b: any) => {
      const row = toCamelCase(b);
      row.pubmedAbstract = b.pubmedAbstract || row.pubmedAbstract || null;
      row.pubmedTitle = b.pubmedTitle || row.pubmedTitle || null;
      row.pubmedAuthors = b.pubmedAuthors || row.pubmedAuthors || null;
      delete row.pubmedAbstractJoined;
      // Decode JSON Unicode escapes in text fields
      if (row.description) row.description = decodeJsonEscapes(row.description);
      if (row.title) row.title = decodeJsonEscapes(row.title);
      if (row.journal) row.journal = decodeJsonEscapes(row.journal);
      if (row.pubmedTitle) row.pubmedTitle = decodeJsonEscapes(row.pubmedTitle);
      if (row.pubmedAbstract) row.pubmedAbstract = decodeJsonEscapes(row.pubmedAbstract);
      if (row.pubmedAuthors) row.pubmedAuthors = decodeJsonEscapes(row.pubmedAuthors);
      return row;
    });

    // Count
    evaluation._count = {
      pdbStructures: (pdbStructures as any[]).length,
      blastResults: (blastResults as any[]).length,
    };

    return NextResponse.json(safeJsonParse(evaluation));
  } catch (error) {
    console.error('Error fetching evaluation:', error);
    return NextResponse.json({ error: 'Failed to fetch evaluation' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ uniprotId: string }> }
) {
  try {
    const { uniprotId } = await params;

    if (!uniprotId) {
      return NextResponse.json({ error: 'uniprotId is required' }, { status: 400 });
    }

    // Verify the evaluation exists first
    const existing = await db.$queryRaw<any[]>`
      SELECT uniprotId FROM Evaluation WHERE uniprotId = ${uniprotId}
    `;
    if (!existing || existing.length === 0) {
      return NextResponse.json({ error: 'Evaluation not found' }, { status: 404 });
    }

    // Delete child rows first to satisfy foreign-key constraints, then the
    // parent evaluation row. Also remove any persisted skill-eval reports.
    await db.$executeRaw`DELETE FROM EvaluationPdbStructure WHERE uniprotId = ${uniprotId}`;
    await db.$executeRaw`DELETE FROM EvaluationBlastResult WHERE uniprotId = ${uniprotId}`;
    await db.$executeRaw`DELETE FROM EvaluationReport WHERE uniprotId = ${uniprotId}`;
    await db.$executeRaw`DELETE FROM SkillEvaluationReport WHERE uniprotId = ${uniprotId}`;
    await db.$executeRaw`DELETE FROM Evaluation WHERE uniprotId = ${uniprotId}`;

    return NextResponse.json({
      success: true,
      uniprotId,
      message: `Evaluation ${uniprotId} and all related records deleted`,
    });
  } catch (error) {
    console.error('Error deleting evaluation:', error);
    return NextResponse.json(
      { error: 'Failed to delete evaluation', detail: error instanceof Error ? error.message : 'unknown' },
      { status: 500 }
    );
  }
}
