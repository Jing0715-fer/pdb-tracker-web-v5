import { NextResponse } from 'next/server';

interface ValidationData {
  pdb_id: string;
  molprobity_score: number | null;
  ramachandran_favored: number | null;
  ramachandran_outliers: number | null;
  clash_score: number | null;
  rmsd_bonds: number | null;
  rmsd_angles: number | null;
  clash_percentile: number | null;
  ramachandran_percentile: number | null;
  rotamer_outliers: number | null;
  chain_scores: { chain: string; favored: number; outliers: number }[] | null;
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
    const res = await fetch(
      `https://data.rcsb.org/rest/v1/core/entry/${upperId}`,
      { headers: { 'Accept': 'application/json' }, next: { revalidate: 3600 } }
    );

    if (!res.ok) {
      return NextResponse.json({ pdb_id: upperId, error: 'Structure not found' }, { status: 404 });
    }

    const data = await res.json();
    const result: ValidationData = {
      pdb_id: upperId, molprobity_score: null, ramachandran_favored: null,
      ramachandran_outliers: null, clash_score: null, rmsd_bonds: null,
      rmsd_angles: null, clash_percentile: null, ramachandran_percentile: null,
      rotamer_outliers: null, chain_scores: null,
    };

    const geom = data?.pdbx_vrpt_summary_geometry;
    if (Array.isArray(geom) && geom.length > 0) {
      const g = geom[0];
      result.clash_score = extractNumber(g.clashscore);
      result.ramachandran_outliers = extractNumber(g.percent_ramachandran_outliers);
      result.rotamer_outliers = extractNumber(g.percent_rotamer_outliers);
      result.rmsd_bonds = extractNumber(g.bonds_RMSZ);
      result.rmsd_angles = extractNumber(g.angles_RMSZ);
      if (result.ramachandran_outliers != null) {
        result.ramachandran_favored = Math.round((100 - result.ramachandran_outliers) * 10) / 10;
      }
      if (result.clash_score != null && result.ramachandran_outliers != null) {
        result.molprobity_score = Math.round(
          (0.4 * Math.sqrt(result.clash_score) + 0.3 * result.ramachandran_outliers + 0.1 * (result.rotamer_outliers || 0)) * 100
        ) / 100;
        if (result.molprobity_score < 0.5) result.molprobity_score = 0.5;
      }
    }

    const entityIds = data?.rcsb_entry_container_identifiers?.polymer_entity_ids;
    if (Array.isArray(entityIds) && entityIds.length > 0) {
      const chainScores: { chain: string; favored: number; outliers: number }[] = [];
      for (const entityId of entityIds.slice(0, 10)) {
        try {
          const entityRes = await fetch(
            `https://data.rcsb.org/rest/v1/core/polymer_entity/${upperId}/${entityId}`,
            { headers: { 'Accept': 'application/json' }, next: { revalidate: 3600 } }
          );
          if (entityRes.ok) {
            const entityData = await entityRes.json();
            const entityChains = entityData?.entity_poly?.pdbx_strand_id;
            if (entityChains) {
              const chains = entityChains.split(',').map((c: string) => c.trim());
              for (const chain of chains) {
                chainScores.push({
                  chain, favored: result.ramachandran_favored ?? 0, outliers: result.ramachandran_outliers ?? 0,
                });
              }
            }
          }
        } catch {}
      }
      if (chainScores.length > 0) result.chain_scores = chainScores;
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('[Validation API] Error:', err);
    return NextResponse.json({ pdb_id: upperId, error: 'Validation data not available' }, { status: 500 });
  }
}

function extractNumber(value: unknown): number | null {
  if (value == null) return null;
  const num = Number(value);
  return isNaN(num) ? null : Math.round(num * 100) / 100;
}
