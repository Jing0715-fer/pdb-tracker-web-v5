import { NextResponse } from 'next/server';

function analyzeLocally(data: Record<string, unknown>) {
  const pdbId = data.pdbId as string || 'Unknown';
  const method = (data.method as string || '').toUpperCase();
  const resolution = data.resolution as number | null;
  const organism = data.organism as string || '';
  const journal = data.journal as string || '';
  const journalIf = data.journalIf as number | null;
  const title = data.title as string || '';

  // Resolution quality assessment
  let resolutionQuality = 'Unknown';
  let resolutionNote = '';
  if (resolution !== null) {
    if (resolution <= 1.5) { resolutionQuality = 'Ultra-High'; resolutionNote = 'Atomic-level detail, suitable for drug design and mechanistic studies.'; }
    else if (resolution <= 2.5) { resolutionQuality = 'High'; resolutionNote = 'Good quality for most structural biology applications.'; }
    else if (resolution <= 3.5) { resolutionQuality = 'Medium'; resolutionNote = 'Suitable for overall fold determination and domain mapping.'; }
    else { resolutionQuality = 'Low'; resolutionNote = 'Limited to overall architecture. May need higher resolution data for detailed analysis.'; }
  }

  // Method assessment
  let methodNote = '';
  if (method.includes('CRYO')) { methodNote = 'Cryo-EM allows visualization of large macromolecular complexes in near-native states, without crystallization. Recent advances in detector technology and image processing have pushed resolutions below 2Å for many targets.'; }
  else if (method.includes('X-RAY')) { methodNote = 'X-ray crystallography remains the gold standard for atomic-resolution structure determination. This method requires crystallization of the target, which can be challenging for flexible or membrane proteins.'; }
  else if (method.includes('NMR')) { methodNote = 'NMR provides ensemble structures in solution, capturing conformational dynamics. Particularly valuable for intrinsically disordered regions and protein-ligand interaction studies.'; }

  // Publication impact
  let impactNote = '';
  if (journalIf && journalIf >= 20) { impactNote = `Published in ${journal} (IF: ${journalIf}), a top-tier journal. This indicates highly significant structural findings with broad impact in the field.`; }
  else if (journalIf && journalIf >= 10) { impactNote = `Published in ${journal} (IF: ${journalIf}), a well-respected journal. The structural findings are likely of considerable interest to the community.`; }
  else if (journalIf) { impactNote = `Published in ${journal} (IF: ${journalIf}). The structure contributes to the growing PDB database and may have specialized applications.`; }

  // Title-based insights
  const titleInsights: string[] = [];
  if (title.toLowerCase().includes('complex')) titleInsights.push('This is a complex structure, which may reveal protein-protein or protein-ligand interactions critical for understanding biological function.');
  if (title.toLowerCase().includes('mutant') || title.toLowerCase().includes('variant')) titleInsights.push('This structure captures a mutant/variant, useful for understanding structure-function relationships and disease mechanisms.');
  if (title.toLowerCase().includes('bound') || title.toLowerCase().includes('ligand')) titleInsights.push('This structure contains bound ligands, providing insights into binding modes and potential for structure-based drug design.');
  if (title.toLowerCase().includes('apo') || title.toLowerCase().includes('unbound')) titleInsights.push('This is an apo/unbound structure, serving as a reference for comparison with ligand-bound states.');

  const sections = [
    {
      id: 'summary',
      title: 'Structure Summary',
      icon: 'Lightbulb',
      color: 'text-amber-500',
      content: `${pdbId} determined by ${method || 'unknown method'}${resolution ? ` at ${resolution}Å resolution (${resolutionQuality})` : ''}${organism ? ` from ${organism}` : ''}.\n\n${titleInsights.length > 0 ? titleInsights.join('\n\n') : 'This structure adds to the growing repository of macromolecular structures in the Protein Data Bank.'}`,
    },
    {
      id: 'resolution',
      title: 'Resolution Assessment',
      icon: 'Target',
      color: 'text-blue-500',
      content: `Resolution: ${resolution ? `${resolution}Å (${resolutionQuality})` : 'Not available'}\n\n${resolutionNote}\n\n${resolution && resolution <= 2.0 ? 'This high-resolution structure enables detailed analysis of atomic interactions, hydrogen bonding networks, and water molecule positions.' : resolution && resolution <= 3.0 ? 'This medium-resolution structure is suitable for domain-level analysis and identification of binding sites, but may not reveal all atomic details.' : 'This lower-resolution structure is best used for overall fold analysis and comparison with related structures.'}`,
    },
    {
      id: 'method',
      title: 'Method Analysis',
      icon: 'Microscope',
      color: 'text-teal-500',
      content: `${methodNote || 'Method information not available.'}\n\n${method && method.includes('CRYO') ? 'Key considerations for Cryo-EM structures: particle quality, preferred orientation, and map sharpening parameters significantly affect the final model quality. Check EMDB for the associated map.' : method && method.includes('X-RAY') ? 'Key considerations for X-ray structures: R-free value, B-factor distribution, and Ramachandran outliers should be examined for model quality assessment.' : ''}`,
    },
    {
      id: 'impact',
      title: 'Research Impact',
      icon: 'Zap',
      color: 'text-purple-500',
      content: `${impactNote || 'Publication information not available.'}\n\n${organism ? `The structure from ${organism} ${organism.toLowerCase().includes('human') ? 'is particularly valuable for understanding human biology and disease mechanisms.' : 'provides evolutionary context for comparative structural analysis.'}` : ''}`,
    },
  ];

  return { sections };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = analyzeLocally(body);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Analysis error:', error);
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 });
  }
}
