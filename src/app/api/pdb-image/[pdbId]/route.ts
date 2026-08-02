import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pdbId: string }> }
) {
  const { pdbId } = await params;
  const id = pdbId.toUpperCase();

  if (!/^[A-Za-z0-9]{4}$/.test(id)) {
    return NextResponse.json(
      { error: 'Invalid PDB ID format' },
      { status: 400 }
    );
  }

  const lower = id.toLowerCase();

  // Try multiple image sources in order of preference (highest resolution first)
  const imageSources = [
    // PDBe (EBI) - 800x800 for crisp display in right sidebar thumbnail
    {
      url: `https://www.ebi.ac.uk/pdbe/static/entry/${lower}_deposited_chain_front_image-800x800.png`,
      label: 'PDBe 800x800',
    },
    // RCSB CDN - higher resolution variants
    {
      url: `https://cdn.rcsb.org/images/rCSB/${lower.substring(1, 3)}/${lower}/${lower}.thumb_800.png`,
      label: 'RCSB CDN 800',
    },
    {
      url: `https://cdn.rcsb.org/images/rCSB/${lower.substring(1, 3)}/${lower}/${lower}.thumb_350.png`,
      label: 'RCSB CDN 350',
    },
    // PDBe fallback for entries missing 800px variant
    {
      url: `https://www.ebi.ac.uk/pdbe/static/entry/${lower}_deposited_chain_front_image-200x200.png`,
      label: 'PDBe 200x200',
    },
  ];

  for (const source of imageSources) {
    try {
      const response = await fetch(source.url, {
        signal: AbortSignal.timeout(10000),
        headers: {
          'Accept': 'image/png,image/jpeg,image/webp',
        },
      });

      if (response.ok) {
        const imageBuffer = await response.arrayBuffer();
        const contentType = response.headers.get('content-type') || 'image/png';

        return new NextResponse(imageBuffer, {
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=86400, s-maxage=86400',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
    } catch {
      continue;
    }
  }

  return NextResponse.json(
    { error: `No preview image available for ${id}` },
    { status: 404 }
  );
}
