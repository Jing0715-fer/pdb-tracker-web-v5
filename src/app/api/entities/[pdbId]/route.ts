import { NextRequest, NextResponse } from "next/server";

interface PdbeMolecule {
  entity_id: number;
  molecule_type: string;
  molecule_name?: string[];
  synonym?: string;
  description?: string;
  source?: Array<{
    organism_scientific_name?: string;
    tax_id?: number;
  }>;
  gene_name?: string[] | string;
  in_chains?: string[];
  chain_to_asymId?: Record<string, string>;
  length?: number;
  sequence_length?: number;
  chem_comp_ids?: string[];
}

interface PdbeChainDetail {
  chain: string;
  asym_id: string;
  length: number | null;
}

interface RcsbEntity {
  rcsb_id: string;
  rcsb_entity_source_organism?: Array<{
    ncbi_scientific_name?: string;
    ncbi_gene_names?: Array<{ name: string }>;
  }>;
  rcsb_entity_host_organism?: Array<{
    ncbi_scientific_name?: string;
  }>;
  entity_poly?: {
    pdbx_strand_id?: string;
    rcsb_entity_polymer_type?: string;
    pdbx_seq_one_letter_code_can?: string;
  };
  rcsb_polymer_entity?: {
    pdbx_description?: string;
    rcsb_entity_source_organism?: Array<{
      ncbi_scientific_name?: string;
      ncbi_gene_names?: Array<{ name: string }>;
    }>;
  };
  rcsb_nonpolymer_entity?: {
    pdbx_description?: string;
    chem_comp_ids?: string[];
  };
}

// Fetch entities from PDBe API
async function fetchFromPdbe(upperPdbId: string, lowerPdbId: string) {
  const response = await fetch(
    `https://www.ebi.ac.uk/pdbe/api/pdb/entry/molecules/${lowerPdbId}`,
    { next: { revalidate: 3600 } }
  );

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  const molecules: PdbeMolecule[] = data[lowerPdbId] || [];

  return molecules.map((mol) => {
    const chains: PdbeChainDetail[] = (mol.in_chains || []).map(
      (chainId: string) => {
        const asymId = mol.chain_to_asymId?.[chainId] || chainId;
        return {
          chain: chainId,
          asym_id: asymId,
          length:
            mol.molecule_type?.includes("polypeptide") ||
            mol.molecule_type?.includes("nucleotide")
              ? mol.length || mol.sequence_length || 0
              : null,
        };
      }
    );

    return {
      entity_id: mol.entity_id,
      molecule_type: mol.molecule_type,
      description:
        mol.molecule_name?.[0] || mol.synonym || mol.description || null,
      organism:
        mol.source?.[0]?.organism_scientific_name || null,
      gene_name: Array.isArray(mol.gene_name)
        ? mol.gene_name.join(", ")
        : mol.gene_name || null,
      chem_comp_ids: mol.chem_comp_ids || [],
      chains,
    };
  });
}

// Fallback: Fetch entities from RCSB API
async function fetchFromRcsb(upperPdbId: string) {
  try {
    // Use RCSB GraphQL API to get entity info
    const graphqlResponse = await fetch("https://data.rcsb.org/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `
          query($id: String!) {
            entry(entry_id: $id) {
              polymer_entities {
                rcsb_id
                entity_poly {
                  pdbx_strand_id
                  rcsb_entity_polymer_type
                  pdbx_seq_one_letter_code_can
                }
                rcsb_polymer_entity {
                  pdbx_description
                  rcsb_entity_source_organism {
                    ncbi_scientific_name
                    ncbi_gene_names { name }
                  }
                }
              }
              nonpolymer_entities {
                rcsb_id
                rcsb_nonpolymer_entity {
                  pdbx_description
                  chem_comp_ids
                }
              }
            }
          }
        `,
        variables: { id: upperPdbId },
      }),
      next: { revalidate: 3600 },
    });

    if (!graphqlResponse.ok) return null;

    const result = await graphqlResponse.json();
    const entry = result?.data?.entry;
    if (!entry) return null;

    const entities: any[] = [];

    // Process polymer entities
    if (entry.polymer_entities) {
      for (let i = 0; i < entry.polymer_entities.length; i++) {
        const pe = entry.polymer_entities[i];
        const strandIds = pe?.entity_poly?.pdbx_strand_id?.split(",") || [];
        const polymerType = pe?.entity_poly?.rcsb_entity_polymer_type || "";
        const seqLength = pe?.entity_poly?.pdbx_seq_one_letter_code_can?.length || 0;
        const description = pe?.rcsb_polymer_entity?.pdbx_description || "";
        const organism = pe?.rcsb_polymer_entity?.rcsb_entity_source_organism?.[0]?.ncbi_scientific_name || null;
        const geneNames = pe?.rcsb_polymer_entity?.rcsb_entity_source_organism?.[0]?.ncbi_gene_names || [];

        let moleculeType = "polypeptide(L)";
        if (polymerType.includes("RNA") || polymerType.includes("ribonucleotide")) {
          moleculeType = "polyribonucleotide";
        } else if (polymerType.includes("DNA") || polymerType.includes("deoxyribonucleotide")) {
          moleculeType = "polydeoxyribonucleotide";
        } else if (polymerType.includes("hybrid")) {
          moleculeType = "polydeoxyribonucleotide/polyribonucleotide hybrid";
        }

        entities.push({
          entity_id: i + 1,
          molecule_type: moleculeType,
          description,
          organism,
          gene_name: geneNames.map((g: any) => g.name).join(", ") || null,
          chem_comp_ids: [],
          chains: strandIds.map((chainId: string) => ({
            chain: chainId.trim(),
            asym_id: chainId.trim(),
            length: seqLength || null,
          })),
        });
      }
    }

    // Process non-polymer entities (ligands, ions, water)
    if (entry.nonpolymer_entities) {
      const polyCount = entry.polymer_entities?.length || 0;
      for (let i = 0; i < entry.nonpolymer_entities.length; i++) {
        const npe = entry.nonpolymer_entities[i];
        const description = npe?.rcsb_nonpolymer_entity?.pdbx_description || "";
        const chemCompIds = npe?.rcsb_nonpolymer_entity?.chem_comp_ids || [];

        // Skip water
        if (description.toLowerCase() === "water" || chemCompIds.includes("HOH")) continue;

        entities.push({
          entity_id: polyCount + i + 1,
          molecule_type: "bound",
          description,
          organism: null,
          gene_name: null,
          chem_comp_ids: chemCompIds,
          chains: [],
        });
      }
    }

    return entities;
  } catch (err) {
    console.error("[API /entities] RCSB fallback error:", err);
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pdbId: string }> }
) {
  try {
    const { pdbId } = await params;
    const upperPdbId = pdbId.toUpperCase();

    if (!/^[A-Za-z0-9]{4}$/.test(upperPdbId)) {
      return NextResponse.json(
        { error: "Invalid PDB ID format. Must be 4 alphanumeric characters." },
        { status: 400 }
      );
    }

    const lowerPdbId = upperPdbId.toLowerCase();

    // Try PDBe API first
    let entities = await fetchFromPdbe(upperPdbId, lowerPdbId);

    // If PDBe API fails, fall back to RCSB API
    if (!entities) {
      console.log(`[API /entities] PDBe API failed for ${upperPdbId}, trying RCSB fallback`);
      entities = await fetchFromRcsb(upperPdbId);
    }

    // If both APIs fail, return error
    if (!entities) {
      return NextResponse.json(
        { error: `No entity data found for PDB ID: ${upperPdbId}` },
        { status: 404 }
      );
    }

    const chainCount = entities.reduce(
      (sum, entity) => sum + entity.chains.length,
      0
    );
    const polymerEntities = entities.filter((e: any) =>
      [
        "polypeptide(L)",
        "polypeptide(D)",
        "polyribonucleotide",
        "polydeoxyribonucleotide",
        "polydeoxyribonucleotide/polyribonucleotide hybrid",
      ].includes(e.molecule_type)
    ).length;

    return NextResponse.json({
      pdb_id: upperPdbId,
      entities,
      polymer_entities: polymerEntities,
      chain_count: chainCount,
    });
  } catch (error) {
    console.error("[API /entities] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch entity data" },
      { status: 500 }
    );
  }
}
