import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;

    const ligand = await db.ligand.findUnique({
      where: { code },
    });

    if (!ligand) {
      return NextResponse.json({ error: 'Ligand not found' }, { status: 404 });
    }

    return NextResponse.json({
      code: ligand.code,
      name: ligand.name,
      formula: ligand.formula,
      weight: ligand.weight,
      type: ligand.type,
      description: ligand.description,
      imageUrl: ligand.imageUrl,
    });
  } catch (error) {
    console.error('Error fetching ligand:', error);
    return NextResponse.json({ error: 'Failed to fetch ligand' }, { status: 500 });
  }
}
