import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pdbId: string }> }
) {
  const { pdbId } = await params;
  const id = pdbId.toUpperCase();

  try {
    const url = `https://files.rcsb.org/download/${id}.cif`;
    const response = await fetch(url, {
      headers: { 'Accept': 'chemical/x-cif' },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `PDB ${id} not found (${response.status})` },
        { status: response.status }
      );
    }

    const cifContent = await response.text();

    return new NextResponse(cifContent, {
      headers: {
        'Content-Type': 'chemical/x-cif',
        'Content-Disposition': `attachment; filename="${id}.cif"`,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    console.error(`[pdb-download] Failed to fetch ${id}:`, err);
    return NextResponse.json(
      { error: `Failed to download ${id}` },
      { status: 500 }
    );
  }
}
