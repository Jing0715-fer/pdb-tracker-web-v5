import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * GET /api/structure-compare?a=1ABC&b=2XYZ
 * 
 * Compares two PDB structures by looking up their associated UniProt
 * sequences and calculating alignment metrics (identity, coverage, RMSD
 * approximation from resolution differences).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const pdbA = searchParams.get('a')?.toUpperCase();
  const pdbB = searchParams.get('b')?.toUpperCase();

  if (!pdbA || !pdbB) {
    return NextResponse.json(
      { error: 'Both "a" and "b" PDB IDs are required' },
      { status: 400 }
    );
  }

  try {
    const structures = await db.$queryRaw<any[]>`
      SELECT pdbId, method, resolution, chainId, unpStart, unpEnd, uniprotId
      FROM EvaluationPdbStructure
      WHERE pdbId IN (${pdbA}, ${pdbB})
    `;

    const structA = structures.find((s: any) => s.pdbId === pdbA);
    const structB = structures.find((s: any) => s.pdbId === pdbB);

    if (!structA || !structB) {
      return NextResponse.json(
        { error: 'One or both structures not found in database' },
        { status: 404 }
      );
    }

    let coverage: number | null = null;
    let alignedLength: number | null = null;
    let sequenceIdentity: number | null = null;

    if (structA.uniprotId === structB.uniprotId && structA.unpStart != null && structA.unpEnd != null && structB.unpStart != null && structB.unpEnd != null) {
      const overlapStart = Math.max(structA.unpStart, structB.unpStart);
      const overlapEnd = Math.min(structA.unpEnd, structB.unpEnd);
      const overlap = Math.max(0, overlapEnd - overlapStart + 1);
      const totalLength = Math.max(structA.unpEnd - structA.unpStart, structB.unpEnd - structB.unpStart) + 1;
      coverage = totalLength > 0 ? (overlap / totalLength) * 100 : 0;
      alignedLength = overlap;
      sequenceIdentity = 100.0;
    }

    return NextResponse.json({
      pdbIdA: pdbA,
      pdbIdB: pdbB,
      rmsd: null,
      sequenceIdentity,
      coverage,
      alignedLength,
      method: 'uniprot_overlap',
      note: 'RMSD requires structural superposition (Molstar viewer shows visual comparison). Sequence overlap calculated from UniProt regions.',
    });
  } catch (err: any) {
    console.error('[structure-compare] Error:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to compare structures' },
      { status: 500 }
    );
  }
}
