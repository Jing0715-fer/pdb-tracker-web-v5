import { NextResponse } from 'next/server';

interface BindingSite {
  ligandCode: string;
  chains: string[];
  residues: string[];
  type: string;
}

interface EnzymeClassification {
  ecNumber: string;
  name: string;
  entityId: number;
}

interface DiseaseMutation {
  chain: string;
  position: number;
  wildType: string;
  mutation: string;
  disease: string;
}

interface SecondaryStructure {
  helices: number;
  strands: number;
  helixPercentage: number;
  strandPercentage: number;
}

interface AnnotationResponse {
  pdbId: string;
  bindingSites: BindingSite[];
  enzymeClassification: EnzymeClassification[];
  diseaseMutations: DiseaseMutation[];
  secondaryStructure: Record<string, SecondaryStructure>;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ pdbId: string }> }
) {
  const { pdbId } = await params;
  const upperId = pdbId.toUpperCase();

  // Validate PDB ID format
  if (!/^[A-Za-z0-9]{4}$/.test(upperId)) {
    return NextResponse.json(
      { error: 'Invalid PDB ID format. Must be 4 alphanumeric characters.' },
      { status: 400 }
    );
  }

  const lowerId = upperId.toLowerCase();

  const result: AnnotationResponse = {
    pdbId: upperId,
    bindingSites: [],
    enzymeClassification: [],
    diseaseMutations: [],
    secondaryStructure: {},
  };

  try {
    // Fetch all annotation data in parallel
    const [bindingSitesRes, mutationsRes, secondaryStructureRes] = await Promise.all([
      fetch(`https://www.ebi.ac.uk/pdbe/api/pdb/entry/binding_sites/${lowerId}`, {
        next: { revalidate: 3600 },
      }).catch(() => null),
      fetch(`https://www.ebi.ac.uk/pdbe/api/pdb/entry/mutated_residues/${lowerId}`, {
        next: { revalidate: 3600 },
      }).catch(() => null),
      fetch(`https://www.ebi.ac.uk/pdbe/api/pdb/entry/secondary_structure/${lowerId}`, {
        next: { revalidate: 3600 },
      }).catch(() => null),
    ]);

    // ─── Parse binding sites ─────────────────────────────────────────────
    if (bindingSitesRes?.ok) {
      try {
        const data = await bindingSitesRes.json();
        const pdbData = data[lowerId];
        if (pdbData) {
          // PDBe returns binding_sites as an array
          const entries = Array.isArray(pdbData) ? pdbData : [pdbData];
          for (const entry of entries) {
            const sites = entry.binding_sites || entry;
            if (Array.isArray(sites)) {
              for (const site of sites) {
                const ligandCode = site.comp_id || site.ligand_code || '';
                const chains: string[] = [];
                const residues: string[] = [];

                // Extract residue and chain info
                const residueList = site.residues || site.bound_to_residues || [];
                if (Array.isArray(residueList)) {
                  for (const res of residueList) {
                    const resCode = res.residue_number || res.resnum || res.author_residue_number || '';
                    const chainId = res.chain_id || res.chain || '';
                    const insCode = res.insertion_code || '';
                    if (chainId && !chains.includes(chainId)) {
                      chains.push(chainId);
                    }
                    if (resCode) {
                      residues.push(`${resCode}${insCode}`);
                    }
                  }
                }

                if (ligandCode) {
                  // Classify site type
                  let siteType = 'binding';
                  const desc = (site.name || '').toLowerCase();
                  if (desc.includes('cofactor') || desc.includes('nad') || desc.includes('fad')) {
                    siteType = 'cofactor';
                  } else if (desc.includes('inhibitor') || desc.includes('inhibit')) {
                    siteType = 'inhibitor';
                  } else if (desc.includes('substrate') || desc.includes('product')) {
                    siteType = 'substrate';
                  }

                  result.bindingSites.push({
                    ligandCode: ligandCode.toUpperCase(),
                    chains,
                    residues,
                    type: site.type || siteType,
                  });
                }
              }
            }
          }
        }
      } catch {
        // Binding sites parse failed, continue
      }
    }

    // ─── Parse disease mutations ────────────────────────────────────────
    if (mutationsRes?.ok) {
      try {
        const data = await mutationsRes.json();
        const pdbData = data[lowerId];
        if (pdbData) {
          const entries = Array.isArray(pdbData) ? pdbData : [pdbData];
          for (const entry of entries) {
            const mutations = entry.mutated_residues || entry;
            if (Array.isArray(mutations)) {
              for (const mut of mutations) {
                const chain = mut.chain_id || mut.chain || '';
                const position = parseInt(mut.residue_number || mut.resnum || mut.author_residue_number || '0', 10);
                const wildType = mut.wild_type || mut.wt || mut.parent_residue || '';
                const mutation = mut.mutation || mut.mutant_residue || mut.mutated_to || '';
                const disease = mut.disease || mut.disease_name || mut.clinical_significance || '';

                if (chain && position > 0) {
                  result.diseaseMutations.push({
                    chain,
                    position,
                    wildType,
                    mutation,
                    disease,
                  });
                }
              }
            }
          }
        }
      } catch {
        // Mutations parse failed, continue
      }
    }

    // ─── Parse secondary structure ──────────────────────────────────────
    if (secondaryStructureRes?.ok) {
      try {
        const data = await secondaryStructureRes.json();
        const pdbData = data[lowerId];
        if (pdbData) {
          // PDBe format: { "1mbn": { "molecules": [ { "entity_id": 1, "chains": [ { "chain_id": "A", "secondary_structure": { "helices": [...], "strands": [...] } } ] } ] } }
          const molecules = pdbData.molecules || [];
          for (const molecule of molecules) {
            const chains = molecule.chains || [];
            for (const chainData of chains) {
              const chainId = chainData.chain_id || '';
              const ss = chainData.secondary_structure || {};
              const helices = ss.helices || [];
              const strands = ss.strands || ss.sheets || [];

              if (chainId) {
                const helixCount = Array.isArray(helices) ? helices.length : 0;
                const strandCount = Array.isArray(strands) ? strands.length : 0;

                // Calculate percentages from lengths
                let helixResidues = 0;
                let strandResidues = 0;

                if (Array.isArray(helices)) {
                  for (const h of helices) {
                    const startRes = h.start?.residue_number || h.start?.author_residue_number || 0;
                    const endRes = h.end?.residue_number || h.end?.author_residue_number || 0;
                    if (startRes && endRes && endRes > startRes) {
                      helixResidues += (endRes - startRes + 1);
                    } else {
                      helixResidues += 10; // approximate
                    }
                  }
                }

                if (Array.isArray(strands)) {
                  for (const s of strands) {
                    const startRes = s.start?.residue_number || s.start?.author_residue_number || 0;
                    const endRes = s.end?.residue_number || s.end?.author_residue_number || 0;
                    if (startRes && endRes && endRes > startRes) {
                      strandResidues += (endRes - startRes + 1);
                    } else {
                      strandResidues += 5; // approximate
                    }
                  }
                }

                const totalResidues = helixResidues + strandResidues;
                const helixPercentage = totalResidues > 0
                  ? Math.round((helixResidues / totalResidues) * 1000) / 10
                  : 0;
                const strandPercentage = totalResidues > 0
                  ? Math.round((strandResidues / totalResidues) * 1000) / 10
                  : 0;

                result.secondaryStructure[chainId] = {
                  helices: helixCount,
                  strands: strandCount,
                  helixPercentage,
                  strandPercentage,
                };
              }
            }
          }
        }
      } catch {
        // Secondary structure parse failed, continue
      }
    }

    // ─── Fetch enzyme classification from RCSB Data API ─────────────────
    try {
      const entryRes = await fetch(
        `https://data.rcsb.org/rest/v1/core/entry/${upperId}`,
        {
          headers: { 'Accept': 'application/json' },
          next: { revalidate: 3600 },
        }
      );

      if (entryRes.ok) {
        const entryData = await entryRes.json();
        const entityIds = entryData?.rcsb_entry_container_identifiers?.polymer_entity_ids || [];

        // Also infer binding sites from molecule data if none found from PDBe
        const moleculesData = entryData?.rcsb_entry_info;
        if (result.bindingSites.length === 0) {
          // Try to get binding sites from nonpolymer entities
          const nonpolyEntityIds = entryData?.rcsb_entry_container_identifiers?.nonpolymer_entity_ids || [];
          for (const _id of nonpolyEntityIds.slice(0, 10)) {
            try {
              const npRes = await fetch(
                `https://data.rcsb.org/rest/v1/core/nonpolymer_entity/${upperId}/${_id}`,
                {
                  headers: { 'Accept': 'application/json' },
                  next: { revalidate: 3600 },
                }
              );
              if (npRes.ok) {
                const npData = await npRes.json();
                const chemComp = npData?.pdbx_entity_nonpoly;
                if (Array.isArray(chemComp)) {
                  for (const comp of chemComp) {
                    const ligCode = comp?.comp_id || comp?.name || '';
                    if (ligCode && !result.bindingSites.find(b => b.ligandCode === ligCode.toUpperCase())) {
                      let siteType = 'binding';
                      const compName = (comp?.name || '').toLowerCase();
                      if (compName.includes('cofactor') || compName.includes('nad') || compName.includes('fad')) {
                        siteType = 'cofactor';
                      } else if (compName.includes('inhibitor') || compName.includes('inhibit')) {
                        siteType = 'inhibitor';
                      }

                      result.bindingSites.push({
                        ligandCode: ligCode.toUpperCase(),
                        chains: [],
                        residues: [],
                        type: siteType,
                      });
                    }
                  }
                }
              }
            } catch {
              // Skip nonpolymer entity
            }
          }
        }

        // Fetch enzyme data for each polymer entity (limit to 10)
        const entityFetches = entityIds.slice(0, 10).map((_entityId: string, idx: number) => {
          const entityIndex = idx + 1;
          return fetch(
            `https://data.rcsb.org/rest/v1/core/polymer_entity/${upperId}/${entityIndex}`,
            {
              headers: { 'Accept': 'application/json' },
              next: { revalidate: 3600 },
            }
          ).then(res => res.ok ? res.json() : null).catch(() => null);
        });

        const entityResults = await Promise.all(entityFetches);

        for (let i = 0; i < entityResults.length; i++) {
          const entityData = entityResults[i];
          if (!entityData) continue;

          const rcsbPolymerEntity = entityData.rcsb_polymer_entity;
          const ecNumbers: string[] = [];

          // Path 1: rcsb_polymer_entity.ec_lineage
          if (rcsbPolymerEntity?.ec_lineage) {
            for (const ec of rcsbPolymerEntity.ec_lineage) {
              if (ec.id) {
                ecNumbers.push(ec.id);
              }
            }
          }

          // Path 2: entity_poly.pdbx_db_code with EC
          if (ecNumbers.length === 0 && entityData.entity_poly?.pdbx_db_code) {
            const dbCode = entityData.entity_poly.pdbx_db_code;
            if (dbCode.startsWith('EC ') || dbCode.match(/^\d+\.\d+/)) {
              ecNumbers.push(dbCode.replace(/^EC\s*/i, ''));
            }
          }

          // Path 3: rcsb_polymer_entity_container_identifiers
          const containerIds = entityData.rcsb_polymer_entity_container_identifiers;
          if (ecNumbers.length === 0 && containerIds?.ec_ids) {
            ecNumbers.push(...containerIds.ec_ids);
          }

          // Deduplicate and add to results
          const seen = new Set<string>();
          for (const ec of ecNumbers) {
            const ecStr = String(ec).trim();
            if (ecStr && !seen.has(ecStr)) {
              seen.add(ecStr);
              result.enzymeClassification.push({
                ecNumber: ecStr,
                name: rcsbPolymerEntity?.pdbx_description || '',
                entityId: i + 1,
              });
            }
          }
        }
      }
    } catch {
      // Enzyme classification fetch failed, continue
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('[Annotations API] Error:', err);
    return NextResponse.json(
      { pdbId: upperId, error: 'Failed to fetch annotation data' },
      { status: 500 }
    );
  }
}
