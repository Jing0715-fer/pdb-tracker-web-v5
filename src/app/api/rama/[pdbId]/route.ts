import { NextResponse } from 'next/server';
import https from 'https';

interface RamaPoint {
  phi: number;
  psi: number;
  region: 'favored' | 'allowed' | 'disallowed';
  chain: string;
  resName: string;
  resSeq: number;
}

interface ChainScore {
  chain: string;
  favored: number;
  allowed: number;
  outliers: number;
  total: number;
}

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Accept: 'application/json' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${data.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ pdbId: string }> }
) {
  const { pdbId } = await params;
  const upperId = pdbId.toUpperCase();

  if (!/^[A-Za-z0-9]{4}$/.test(upperId)) {
    return NextResponse.json({ pdb_id: upperId, error: 'Invalid PDB ID format' }, { status: 400 });
  }

  try {
    const data = await fetchJson(
      `https://www.ebi.ac.uk/pdbe/api/v2/validation/rama_sidechain_listing/entry/${upperId}`
    );

    const entry = data[upperId.toLowerCase()];
    if (!entry) {
      return NextResponse.json({ pdb_id: upperId, error: 'PDB entry not found' }, { status: 404 });
    }

    const points: RamaPoint[] = [];
    let totalFavored = 0;
    let totalAllowed = 0;
    let totalOutlier = 0;

    // Per-chain stats (keyed by chain_id)
    const chainStats: Record<string, { favored: number; allowed: number; disallowed: number }> = {};

    for (const molecule of entry.molecules || []) {
      for (const chain of molecule.chains || []) {
        // Use chain_id (e.g. "A", "B") as the real chain identifier
        const chainId: string = chain.chain_id || chain.struct_asym_id || '';
        if (!chainId) continue;

        if (!chainStats[chainId]) {
          chainStats[chainId] = { favored: 0, allowed: 0, disallowed: 0 };
        }

        for (const model of chain.models || []) {
          for (const res of model.residues || []) {
            const phi = res.phi;
            const psi = res.psi;
            const rama = res.rama;

            if (phi == null || psi == null) continue;

            let region: 'favored' | 'allowed' | 'disallowed';
            if (rama === 'Favored') {
              region = 'favored';
              totalFavored++;
              chainStats[chainId].favored++;
            } else if (rama === 'Allowed') {
              region = 'allowed';
              totalAllowed++;
              chainStats[chainId].allowed++;
            } else {
              region = 'disallowed';
              totalOutlier++;
              chainStats[chainId].disallowed++;
            }

            points.push({
              phi: Number(phi),
              psi: Number(psi),
              region,
              chain: chainId,
              resName: res.residue_name || '',
              resSeq: res.author_residue_number || res.residue_number || 0,
            });
          }
        }
      }
    }

    if (points.length === 0) {
      return NextResponse.json({
        pdb_id: upperId, error: 'No torsion data found',
        residue_count: 0, favored: 0, allowed: 0, outliers: 0, points: [], chain_scores: [],
      });
    }

    const total = points.length;

    // Build per-chain scores sorted by chain_id
    const chainScores: ChainScore[] = Object.entries(chainStats)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([chain, stats]) => {
        const chainTotal = stats.favored + stats.allowed + stats.disallowed;
        return {
          chain,
          favored: chainTotal > 0 ? Math.round((stats.favored / chainTotal) * 1000) / 10 : 0,
          allowed: chainTotal > 0 ? Math.round((stats.allowed / chainTotal) * 1000) / 10 : 0,
          outliers: chainTotal > 0 ? Math.round((stats.disallowed / chainTotal) * 1000) / 10 : 0,
          total: chainTotal,
        };
      });

    return NextResponse.json({
      pdb_id: upperId,
      residue_count: total,
      favored: Math.round((totalFavored / total) * 1000) / 10,
      allowed: Math.round((totalAllowed / total) * 1000) / 10,
      outliers: Math.round((totalOutlier / total) * 1000) / 10,
      points,
      chain_scores: chainScores,
    });
  } catch (err) {
    console.error('[Rama API] Error:', err);
    return NextResponse.json({ pdb_id: upperId, error: 'Failed to fetch rama data' }, { status: 500 });
  }
}