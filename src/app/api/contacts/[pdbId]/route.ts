import { NextResponse } from 'next/server';

interface ResidueContact {
  chain1: string; residue1: string; chain2: string; residue2: string; distance: number; type: string;
}

function parseInteraction(interaction: Record<string, unknown>): ResidueContact[] {
  const results: ResidueContact[] = [];
  if (!interaction || typeof interaction !== 'object') return results;
  const dist = interaction?.distance ?? interaction?.dist ?? 0;
  const intType = interaction?.interaction_type ?? interaction?.type ?? 'contact';

  function extractResidue(r: Record<string, unknown>): { chain: string; residue: string } {
    const chain = r?.chain_id ?? r?.chain ?? r?.chainId ?? '';
    const resNum = r?.residue_number ?? r?.resid ?? r?.residue_number_1 ?? r?.resNum ?? '';
    const resName = r?.residue_name ?? r?.resname ?? r?.resName ?? r?.compound ?? '';
    return { chain: String(chain), residue: `${resNum}${resName}` };
  }

  if (interaction.int_partner1 && interaction.int_partner2) {
    const p1 = extractResidue(interaction.int_partner1 as Record<string, unknown>);
    const p2 = extractResidue(interaction.int_partner2 as Record<string, unknown>);
    results.push({ chain1: p1.chain, residue1: p1.residue, chain2: p2.chain, residue2: p2.residue, distance: Number(dist) || 0, type: String(intType) });
    return results;
  }
  if (interaction.target_residue && interaction.source_residue) {
    const src = extractResidue(interaction.source_residue as Record<string, unknown>);
    const tgt = extractResidue(interaction.target_residue as Record<string, unknown>);
    results.push({ chain1: src.chain, residue1: src.residue, chain2: tgt.chain, residue2: tgt.residue, distance: Number(dist) || 0, type: String(intType) });
    return results;
  }
  const residues1 = (interaction?.residue1 ?? interaction?.group1 ?? []) as Record<string, unknown>[];
  const residues2 = (interaction?.residue2 ?? interaction?.group2 ?? []) as Record<string, unknown>[];
  if (Array.isArray(residues1) && Array.isArray(residues2) && residues1.length > 0 && residues2.length > 0) {
    for (const r1 of residues1) {
      for (const r2 of residues2) {
        const e1 = extractResidue(r1 as Record<string, unknown>);
        const e2 = extractResidue(r2 as Record<string, unknown>);
        results.push({ chain1: e1.chain, residue1: e1.residue, chain2: e2.chain, residue2: e2.residue, distance: Number(dist) || 0, type: String(intType) });
      }
    }
    return results;
  }
  const chain1 = interaction?.chain_id_1 ?? interaction?.chain1 ?? '';
  const chain2 = interaction?.chain_id_2 ?? interaction?.chain2 ?? '';
  if (chain1 && chain2) {
    const resNum1 = interaction?.residue_number_1 ?? interaction?.resid_1 ?? '';
    const resName1 = interaction?.residue_name_1 ?? interaction?.resname_1 ?? '';
    const resNum2 = interaction?.residue_number_2 ?? interaction?.resid_2 ?? '';
    const resName2 = interaction?.residue_name_2 ?? interaction?.resname_2 ?? '';
    results.push({ chain1: String(chain1), residue1: `${resNum1}${resName1}`, chain2: String(chain2), residue2: `${resNum2}${resName2}`, distance: Number(dist) || 0, type: String(intType) });
    return results;
  }
  return results;
}

function parseInteractingResidues(entryData: unknown): ResidueContact[] {
  const contacts: ResidueContact[] = [];
  if (!entryData) return contacts;
  if (Array.isArray(entryData)) {
    for (const interaction of entryData) { try { contacts.push(...parseInteraction(interaction as Record<string, unknown>)); } catch (e) { console.warn("[Contacts] Failed to parse interaction:", e); } }
    return contacts;
  }
  if (typeof entryData === 'object') {
    for (const value of Object.values(entryData as Record<string, unknown>)) {
      if (Array.isArray(value)) { for (const interaction of value) { try { contacts.push(...parseInteraction(interaction as Record<string, unknown>)); } catch (e) { console.warn("[Contacts] Failed to parse interaction:", e); } } }
      else if (typeof value === 'object' && value !== null) {
        for (const innerVal of Object.values(value as Record<string, unknown>)) {
          if (Array.isArray(innerVal)) { for (const interaction of innerVal) { try { contacts.push(...parseInteraction(interaction as Record<string, unknown>)); } catch (e) { console.warn("[Contacts] Failed to parse interaction:", e); } } }
        }
      }
    }
  }
  return contacts;
}

function parseLigandMonomers(entryData: unknown): ResidueContact[] {
  const contacts: ResidueContact[] = [];
  if (!entryData || !Array.isArray(entryData)) return contacts;
  for (const ligand of entryData) {
    try {
      const ligChain = String(ligand?.chain_id ?? ligand?.chain ?? '');
      const ligResNum = String(ligand?.residue_number ?? ligand?.resid ?? '');
      const chemCompId = String(ligand?.chem_comp_id ?? '');
      const chemCompName = String(ligand?.chem_comp_name ?? ligand?.residue_name ?? '');
      const structAsymId = String(ligand?.struct_asym_id ?? '');
      const ligandContacts = ligand?.ligand_contacts ?? ligand?.contacts ?? [];
      if (Array.isArray(ligandContacts) && ligandContacts.length > 0) {
        for (const contact of ligandContacts) {
          const protChain = String(contact?.chain_id ?? contact?.chain ?? '');
          const protResNum = String(contact?.residue_number ?? contact?.resid ?? '');
          const protResName = String(contact?.residue_name ?? contact?.resname ?? '');
          const dist = contact?.distance ?? contact?.dist ?? 0;
          const intType = contact?.interaction_type ?? contact?.type ?? 'ligand_contact';
          if (protChain || ligChain) { contacts.push({ chain1: ligChain, residue1: `${ligResNum}${chemCompId || chemCompName}`, chain2: protChain, residue2: `${protResNum}${protResName}`, distance: Number(dist) || 0, type: String(intType) }); }
        }
      } else if (ligChain || structAsymId) {
        contacts.push({ chain1: structAsymId || `L-${chemCompId}`, residue1: `${ligResNum}${chemCompId}`, chain2: ligChain, residue2: `nearby residues`, distance: 0, type: 'ligand_proximity' });
      }
    } catch (e) { console.warn("[Contacts] parse error:", e); }
  }
  return contacts;
}

function parseResidueInteractionsGraph(entryData: unknown): ResidueContact[] {
  const contacts: ResidueContact[] = [];
  if (!entryData || typeof entryData !== 'object') return contacts;
  const data = entryData as Record<string, unknown>;
  const edges = (data?.edges ?? data?.links ?? []) as Record<string, unknown>[];
  if (!Array.isArray(edges)) return contacts;
  const nodes = (data?.nodes ?? data?.vertices ?? []) as Record<string, unknown>[];
  const nodeMap = new Map<string, { chain: string; residue: string }>();
  if (Array.isArray(nodes)) { for (const node of nodes) { const id = String(node?.id ?? node?.node_id ?? node?.residue_number ?? ''); const chain = String(node?.chain_id ?? node?.chain ?? ''); const resNum = node?.residue_number ?? node?.resid ?? ''; const resName = node?.residue_name ?? node?.resname ?? ''; nodeMap.set(id, { chain, residue: `${resNum}${resName}` }); } }
  for (const edge of edges) {
    try {
      const srcId = String(edge?.source ?? edge?.from ?? edge?.node_id_1 ?? '');
      const tgtId = String(edge?.target ?? edge?.to ?? edge?.node_id_2 ?? '');
      const dist = edge?.distance ?? edge?.dist ?? 0;
      const intType = edge?.interaction_type ?? edge?.type ?? edge?.label ?? 'contact';
      if (nodeMap.size > 0 && srcId && tgtId) {
        const src = nodeMap.get(srcId); const tgt = nodeMap.get(tgtId);
        if (src && tgt) { contacts.push({ chain1: src.chain, residue1: src.residue, chain2: tgt.chain, residue2: tgt.residue, distance: Number(dist) || 0, type: String(intType) }); }
      } else {
        const chain1 = edge?.chain_id_1 ?? edge?.chain1 ?? '';
        const chain2 = edge?.chain_id_2 ?? edge?.chain2 ?? '';
        const resNum1 = edge?.residue_number_1 ?? edge?.resid_1 ?? '';
        const resName1 = edge?.residue_name_1 ?? edge?.resname_1 ?? '';
        const resNum2 = edge?.residue_number_2 ?? edge?.resid_2 ?? '';
        const resName2 = edge?.residue_name_2 ?? edge?.resname_2 ?? '';
        if (chain1 || chain2) { contacts.push({ chain1: String(chain1), residue1: `${resNum1}${resName1}`, chain2: String(chain2), residue2: `${resNum2}${resName2}`, distance: Number(dist) || 0, type: String(intType) }); }
      }
    } catch (e) { console.warn("[Contacts] parse error:", e); }
  }
  return contacts;
}

export async function GET(_request: Request, { params }: { params: Promise<{ pdbId: string }> }) {
  const { pdbId } = await params;
  const upperId = pdbId.toUpperCase();
  if (!/^[A-Za-z0-9]{4}$/.test(upperId)) { return NextResponse.json({ pdbId: upperId, error: 'Invalid PDB ID format' }, { status: 400 }); }
  try {
    let contacts: ResidueContact[] = [];
    let primaryStatus: number | null = null;

    // Primary: interacting_residues API
    try {
      const res = await fetch(`https://www.ebi.ac.uk/pdbe/api/pdb/entry/interacting_residues/${upperId}`, { headers: { 'Accept': 'application/json' }, next: { revalidate: 3600 } });
      primaryStatus = res.status;
      if (res.ok) {
        const data = await res.json();
        const entryData = data[upperId.toLowerCase()] ?? data[upperId] ?? null;
        if (entryData) contacts = parseInteractingResidues(entryData);
        if (contacts.length === 0) { console.warn(`[Contacts] No contacts from primary for ${upperId}`); }
      }
    } catch (err) { console.warn(`[Contacts] Primary fetch failed for ${upperId}:`, err); }

    // Fallback 1: ligand_monomers
    if (contacts.length === 0) {
      try {
        const ligRes = await fetch(`https://www.ebi.ac.uk/pdbe/api/pdb/entry/ligand_monomers/${upperId}`, { headers: { 'Accept': 'application/json' }, next: { revalidate: 3600 } });
        if (ligRes.ok) {
          const ligData = await ligRes.json();
          const ligEntry = ligData[upperId.toLowerCase()] ?? ligData[upperId] ?? null;
          if (ligEntry) { const ligContacts = parseLigandMonomers(ligEntry); if (ligContacts.length > 0) contacts = ligContacts; }
        }
      } catch (err) { console.warn(`[Contacts] Fallback ligand_monomers failed for ${upperId}:`, err); }
    }

    // Fallback 2: residue-interactions graph
    if (contacts.length === 0) {
      try {
        const graphRes = await fetch(`https://www.ebi.ac.uk/pdbe/graph-api/molecules/${upperId}/residue-interactions`, { headers: { 'Accept': 'application/json' }, next: { revalidate: 3600 } });
        if (graphRes.ok) {
          const graphData = await graphRes.json();
          const graphEntry = graphData[upperId.toLowerCase()] ?? graphData[upperId] ?? graphData;
          if (graphEntry) { const graphContacts = parseResidueInteractionsGraph(graphEntry); if (graphContacts.length > 0) contacts = graphContacts; }
        }
      } catch (err) { console.warn(`[Contacts] Fallback residue-interactions graph failed for ${upperId}:`, err); }
    }

    return NextResponse.json({ pdbId: upperId, contacts });
  } catch (err) {
    console.error('[Contacts API] Error:', err);
    return NextResponse.json({ pdbId: upperId, error: 'Failed to fetch residue contact data' }, { status: 500 });
  }
}
