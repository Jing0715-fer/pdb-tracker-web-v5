import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Running enhanced seed script (adding more data)...')

  // ─── Additional Ligands ──────────────────────────────────────
  const additionalLigands = [
    { code: 'GTP', name: 'Guanosine-5\'-triphosphate', formula: 'C10H16N5O14P3', weight: '523.18', type: 'COFACTOR', description: 'A nucleotide essential for signal transduction via G-proteins and microtubule polymerization.' },
    { code: 'GDP', name: 'Guanosine-5\'-diphosphate', formula: 'C10H15N5O11P2', weight: '443.23', type: 'COFACTOR', description: 'A nucleotide produced by GTP hydrolysis, the inactive form of G-proteins.' },
    { code: 'FMN', name: 'Flavin mononucleotide', formula: 'C17H21N4O9P', weight: '456.34', type: 'COFACTOR', description: 'A coenzyme derived from riboflavin, involved in one-electron transfer reactions.' },
    { code: 'THR', name: 'Threonine', formula: 'C4H9NO3', weight: '119.12', type: 'L-AMINOACID', description: 'An essential amino acid involved in protein synthesis and post-translational modifications.' },
    { code: 'PRO', name: 'Proline', formula: 'C5H9NO2', weight: '115.13', type: 'L-AMINOACID', description: 'A cyclic amino acid that introduces rigidity into protein structures.' },
    { code: 'LYS', name: 'Lysine', formula: 'C6H14N2O2', weight: '146.19', type: 'L-AMINOACID', description: 'An essential amino acid critical for protein stability via electrostatic interactions.' },
  ]
  for (const ligand of additionalLigands) {
    await prisma.ligand.upsert({
      where: { code: ligand.code },
      update: {},
      create: ligand,
    })
  }
  console.log(`Added ${additionalLigands.length} ligands`)

  // ─── 40 More PDB Structures ─────────────────────────────────
  const newPdbStructures = [
    // --- Cryo-EM (15) ---
    {
      pdbId: '8FG1', method: 'CRYO-EM', releaseDate: '2025-02-05', resolution: 3.20,
      title: 'Cryo-EM structure of human EGFR kinase domain in complex with cetuximab Fab fragment',
      doi: '10.1038/s41586-024-08345-1', journal: 'Nature', journalIf: 64.8,
      authors: 'Li X, Wang R, Chen H, Nakamura T', organisms: 'Homo sapiens',
      ligands: 'ATP,MG', weekId: '2025-W05', pubmedId: '39120001', fetchDate: '2025-02-07',
    },
    {
      pdbId: '9KL2', method: 'CRYO-EM', releaseDate: '2025-02-12', resolution: 2.95,
      title: 'Cryo-EM structure of the human TRPML1 channel in lysosomal membrane',
      doi: '10.1126/science.adr5678', journal: 'Science', journalIf: 56.9,
      authors: 'Chen Q, She J, Cao Z, Wang T', organisms: 'Homo sapiens',
      ligands: 'CA', weekId: '2025-W06', pubmedId: '39120002', fetchDate: '2025-02-14',
    },
    {
      pdbId: '7MN3', method: 'CRYO-EM', releaseDate: '2025-02-19', resolution: 3.55,
      title: 'Cryo-EM structure of the human RNA polymerase II elongation complex with DSIF and NELF',
      doi: '10.1016/j.cell.2025.01.015', journal: 'Cell', journalIf: 64.5,
      authors: 'Vos SM, Farnung L, Boehning M, Cramer P', organisms: 'Homo sapiens',
      ligands: 'NAD,MG', weekId: '2025-W07', pubmedId: '39120003', fetchDate: '2025-02-21',
    },
    {
      pdbId: '8OP4', method: 'CRYO-EM', releaseDate: '2025-02-26', resolution: 3.10,
      title: 'Structure of the human insulin receptor ectodomain in the active conformation',
      doi: '10.1038/s41586-024-08456-2', journal: 'Nature', journalIf: 64.8,
      authors: 'Uchikawa E, Chen L, Takahashi N, Matsumura H', organisms: 'Homo sapiens',
      ligands: 'ZN', weekId: '2025-W08', pubmedId: '39120004', fetchDate: '2025-02-28',
    },
    {
      pdbId: '9QR5', method: 'CRYO-EM', releaseDate: '2025-02-10', resolution: 2.75,
      title: 'Cryo-EM structure of the SARS-CoV-2 spike glycoprotein in the prefusion conformation with cross-neutralizing antibody',
      doi: '10.1126/science.ads1234', journal: 'Science', journalIf: 56.9,
      authors: 'Wrapp D, Wang N, McLellan JS', organisms: 'SARS-CoV-2',
      ligands: 'CA,MG', weekId: '2025-W06', pubmedId: '39120005', fetchDate: '2025-02-12',
    },
    {
      pdbId: '7ST6', method: 'CRYO-EM', releaseDate: '2025-01-29', resolution: 3.80,
      title: 'Cryo-EM structure of the human pre-60S ribosomal subunit',
      doi: '10.1038/s41594-024-01567-3', journal: 'Nature Structural & Molecular Biology', journalIf: 16.7,
      authors: 'Kater L, Thoms M, Bhatt DK, Beckmann R', organisms: 'Homo sapiens',
      ligands: 'ATP', weekId: '2025-W05', pubmedId: '39120006', fetchDate: '2025-01-31',
    },
    {
      pdbId: '8UVA', method: 'CRYO-EM', releaseDate: '2025-03-05', resolution: 3.35,
      title: 'Cryo-EM structure of the human mTORC2 complex with Sin1 and Protor',
      doi: '10.1038/s41586-024-08567-1', journal: 'Nature', journalIf: 64.8,
      authors: 'Stuttfeld E, Aylett CH, Bhatt DK, Maier T', organisms: 'Homo sapiens',
      ligands: 'ATP,NAD', weekId: '2025-W08', pubmedId: '39120007', fetchDate: '2025-03-07',
    },
    {
      pdbId: '7KRR', method: 'CRYO-EM', releaseDate: '2025-02-17', resolution: 3.00,
      title: 'Cryo-EM structure of the human KATP channel SUR1-Kir6.2 complex bound to glibenclamide',
      doi: '10.1016/j.cell.2025.01.023', journal: 'Cell', journalIf: 64.5,
      authors: 'Martin GM, Chen PC, Bhatt DK, Shyng SL', organisms: 'Homo sapiens',
      ligands: 'ATP,MG,ADP', weekId: '2025-W07', pubmedId: '39120008', fetchDate: '2025-02-19',
    },
    {
      pdbId: '7YZ9', method: 'CRYO-EM', releaseDate: '2025-01-30', resolution: 2.60,
      title: 'Cryo-EM structure of the human ABC transporter ABCG2 in the inward-facing conformation',
      doi: '10.1038/s41467-024-55678-1', journal: 'Nature Communications', journalIf: 17.694,
      authors: 'Kowal J, Ni D, Jackson SM, Locher KP', organisms: 'Homo sapiens',
      ligands: 'ATP', weekId: '2025-W05', pubmedId: '39120009', fetchDate: '2025-02-01',
    },
    {
      pdbId: '8AB0', method: 'CRYO-EM', releaseDate: '2025-03-03', resolution: 3.45,
      title: 'Cryo-EM structure of the human PIEZO1 mechanosensitive ion channel in lipid nanodisc',
      doi: '10.1126/science.adt8901', journal: 'Science', journalIf: 56.9,
      authors: 'Zhao Q, Zhou H, Chi S, Wang B', organisms: 'Homo sapiens',
      ligands: 'CA', weekId: '2025-W08', pubmedId: '39120010', fetchDate: '2025-03-05',
    },
    {
      pdbId: '9CD1', method: 'CRYO-EM', releaseDate: '2025-02-14', resolution: 3.25,
      title: 'Cryo-EM structure of the Plasmodium falciparum 80S ribosome bound to emetine',
      doi: '10.7554/eLife.90123', journal: 'eLife', journalIf: 7.7,
      authors: 'Wong W, Bai XC, Bhatt DK, Scheres SHW', organisms: 'Plasmodium falciparum',
      ligands: 'ATP,MG', weekId: '2025-W06', pubmedId: '39120011', fetchDate: '2025-02-16',
    },
    {
      pdbId: '7EF2', method: 'CRYO-EM', releaseDate: '2025-02-24', resolution: 2.85,
      title: 'Cryo-EM structure of the human SWI/SNF chromatin remodeling complex bound to a nucleosome',
      doi: '10.1038/s41586-024-08678-5', journal: 'Nature', journalIf: 64.8,
      authors: 'He S, Wu Z, Bhatt DK, Yuan Z', organisms: 'Homo sapiens',
      ligands: 'ATP,SAM', weekId: '2025-W07', pubmedId: '39120012', fetchDate: '2025-02-26',
    },
    {
      pdbId: '8GH3', method: 'CRYO-EM', releaseDate: '2025-01-28', resolution: 3.90,
      title: 'Cryo-EM structure of the human V-ATPase proton pump in the autoinhibited state',
      doi: '10.1038/s41594-024-01678-4', journal: 'Nature Structural & Molecular Biology', journalIf: 16.7,
      authors: 'Wang L, Wu D, Bhatt DK, Fu TM', organisms: 'Homo sapiens',
      ligands: 'ATP,CA', weekId: '2025-W05', pubmedId: '39120013', fetchDate: '2025-01-30',
    },
    {
      pdbId: '9IJ4', method: 'CRYO-EM', releaseDate: '2025-03-06', resolution: 3.15,
      title: 'Cryo-EM structure of the Drosophila melanogaster TCF4-beta-catenin transcription complex',
      doi: '10.1038/s41467-024-56789-2', journal: 'Nature Communications', journalIf: 17.694,
      authors: 'Chambers SP, Bhatt DK, Nusse R', organisms: 'Drosophila melanogaster',
      ligands: 'ZN', weekId: '2025-W08', pubmedId: '39120014', fetchDate: '2025-03-08',
    },
    {
      pdbId: '7LK5', method: 'CRYO-EM', releaseDate: '2025-02-11', resolution: 3.50,
      title: 'Cryo-EM structure of the Mus musculus TREX-2 mRNA export complex',
      doi: '10.1073/pnas.2412345678', journal: 'Proceedings of the National Academy of Sciences', journalIf: 11.1,
      authors: 'Durr RA, Bhatt DK, Strambio-De-Castillia C', organisms: 'Mus musculus',
      ligands: 'ATP', weekId: '2025-W06', pubmedId: '39120015', fetchDate: '2025-02-13',
    },

    // --- X-ray (15) ---
    {
      pdbId: '7S1U', method: 'X-RAY DIFFRACTION', releaseDate: '2025-02-03', resolution: 1.75,
      title: 'Crystal structure of the human KRAS G12C mutant bound to sotorasib and SOS1',
      doi: '10.1038/s41586-024-08789-2', journal: 'Nature', journalIf: 64.8,
      authors: 'Pantsar T, Bhatt DK, Ansari S', organisms: 'Homo sapiens',
      ligands: 'GDP,MG', weekId: '2025-W05', pubmedId: '39120016', fetchDate: '2025-02-05',
    },
    {
      pdbId: '9RS7', method: 'X-RAY DIFFRACTION', releaseDate: '2025-02-13', resolution: 2.05,
      title: 'Crystal structure of Arabidopsis thaliana phytochrome B photosensory domain',
      doi: '10.1016/j.molcel.2025.01.007', journal: 'Molecular Cell', journalIf: 16.0,
      authors: 'Burgie ES, Bhatt DK, Vierstra RD', organisms: 'Arabidopsis thaliana',
      ligands: 'NAD', weekId: '2025-W06', pubmedId: '39120017', fetchDate: '2025-02-15',
    },
    {
      pdbId: '7TU8', method: 'X-RAY DIFFRACTION', releaseDate: '2025-02-20', resolution: 1.90,
      title: 'Crystal structure of Escherichia coli tryptophan synthase alpha subunit with PLP',
      doi: '10.1021/jacs.4c15678', journal: 'Journal of the American Chemical Society', journalIf: 15.0,
      authors: 'Dunn MF, Bhatt DK, Niks D', organisms: 'Escherichia coli',
      ligands: 'PLP', weekId: '2025-W07', pubmedId: '39120018', fetchDate: '2025-02-22',
    },
    {
      pdbId: '8VW9', method: 'X-RAY DIFFRACTION', releaseDate: '2025-03-03', resolution: 2.20,
      title: 'Crystal structure of the human PD-1/PD-L1 immune checkpoint complex with therapeutic antibody',
      doi: '10.1038/s41586-024-08890-8', journal: 'Nature', journalIf: 64.8,
      authors: 'Zak KM, Bhatt DK, Holak TA', organisms: 'Homo sapiens',
      ligands: 'ZN,CA', weekId: '2025-W08', pubmedId: '39120019', fetchDate: '2025-03-05',
    },
    {
      pdbId: '9XA0', method: 'X-RAY DIFFRACTION', releaseDate: '2025-02-06', resolution: 1.55,
      title: 'Ultra-high-resolution structure of Saccharomyces cerevisiae cytochrome c oxidase',
      doi: '10.1126/science.adu1234', journal: 'Science', journalIf: 56.9,
      authors: 'Shimada S, Bhatt DK, Tsukihara T', organisms: 'Saccharomyces cerevisiae',
      ligands: 'HEM,CA,MG', weekId: '2025-W05', pubmedId: '39120020', fetchDate: '2025-02-08',
    },
    {
      pdbId: '7BC1', method: 'X-RAY DIFFRACTION', releaseDate: '2025-02-11', resolution: 2.45,
      title: 'Crystal structure of Rattus norvegicus acetylcholinesterase in complex with rivastigmine',
      doi: '10.1021/acs.jmedchem.4c03456', journal: 'Journal of Medicinal Chemistry', journalIf: 7.3,
      authors: 'Dvir H, Bhatt DK, Sussman JL', organisms: 'Rattus norvegicus',
      ligands: 'SAM', weekId: '2025-W06', pubmedId: '39120021', fetchDate: '2025-02-13',
    },
    {
      pdbId: '8DE2', method: 'X-RAY DIFFRACTION', releaseDate: '2025-02-18', resolution: 1.80,
      title: 'Crystal structure of human carbonic anhydrase II with a novel sulfonamide inhibitor',
      doi: '10.1016/j.jmb.2025.01.012', journal: 'Journal of Molecular Biology', journalIf: 5.6,
      authors: 'Supuran CT, Bhatt DK, De Simone G', organisms: 'Homo sapiens',
      ligands: 'ZN', weekId: '2025-W07', pubmedId: '39120022', fetchDate: '2025-02-20',
    },
    {
      pdbId: '9FG3', method: 'X-RAY DIFFRACTION', releaseDate: '2025-02-25', resolution: 2.30,
      title: 'Crystal structure of the human JAK2 kinase domain with fedratinib',
      doi: '10.1016/j.ccell.2025.01.005', journal: 'Cancer Cell', journalIf: 23.9,
      authors: 'Davis R, Bhatt DK, Singh A', organisms: 'Homo sapiens',
      ligands: 'ATP,MG', weekId: '2025-W08', pubmedId: '39120023', fetchDate: '2025-02-27',
    },
    {
      pdbId: '7HI4', method: 'X-RAY DIFFRACTION', releaseDate: '2025-02-04', resolution: 1.65,
      title: 'Crystal structure of the Plasmodium falciparum falcipain-2 protease with inhibitor',
      doi: '10.1021/acs.jmedchem.4c04567', journal: 'Journal of Medicinal Chemistry', journalIf: 7.3,
      authors: 'Hans R, Bhatt DK, Rosenthal PJ', organisms: 'Plasmodium falciparum',
      ligands: 'HEM', weekId: '2025-W05', pubmedId: '39120024', fetchDate: '2025-02-06',
    },
    {
      pdbId: '8JK5', method: 'X-RAY DIFFRACTION', releaseDate: '2025-02-15', resolution: 2.15,
      title: 'Crystal structure of the human BCL-2 protein in complex with venetoclax',
      doi: '10.1038/s41586-024-08901-5', journal: 'Nature', journalIf: 64.8,
      authors: 'Souers AJ, Bhatt DK, Leverson JD', organisms: 'Homo sapiens',
      ligands: 'ZN,ATP', weekId: '2025-W06', pubmedId: '39120025', fetchDate: '2025-02-17',
    },
    {
      pdbId: '9LM6', method: 'X-RAY DIFFRACTION', releaseDate: '2025-02-22', resolution: 1.98,
      title: 'Crystal structure of Drosophila melanogaster period protein PAS domain',
      doi: '10.1038/s41594-024-01789-6', journal: 'Nature Structural & Molecular Biology', journalIf: 16.7,
      authors: 'Zhang EE, Bhatt DK, Kay SA', organisms: 'Drosophila melanogaster',
      ligands: 'FAD', weekId: '2025-W07', pubmedId: '39120026', fetchDate: '2025-02-24',
    },
    {
      pdbId: '7NO7', method: 'X-RAY DIFFRACTION', releaseDate: '2025-03-01', resolution: 2.50,
      title: 'Crystal structure of Mus musculus STAT3 DNA-binding domain bound to GAS element',
      doi: '10.1093/nar/gkae2345', journal: 'Nucleic Acids Research', journalIf: 16.7,
      authors: 'Neculai D, Bhatt DK, Neculai AM', organisms: 'Mus musculus',
      ligands: 'ZN,MG', weekId: '2025-W08', pubmedId: '39120027', fetchDate: '2025-03-03',
    },
    {
      pdbId: '8PQ8', method: 'X-RAY DIFFRACTION', releaseDate: '2025-02-07', resolution: 1.72,
      title: 'High-resolution structure of human thymidylate synthase with 5-fluorouracil',
      doi: '10.1073/pnas.2413456789', journal: 'Proceedings of the National Academy of Sciences', journalIf: 11.1,
      authors: 'Phan J, Bhatt DK, Minor W', organisms: 'Homo sapiens',
      ligands: 'FAD', weekId: '2025-W05', pubmedId: '39120028', fetchDate: '2025-02-09',
    },
    {
      pdbId: '9RS9', method: 'X-RAY DIFFRACTION', releaseDate: '2025-02-16', resolution: 2.80,
      title: 'Crystal structure of Escherichia coli LpxC deacetylase with CHIR-090 inhibitor',
      doi: '10.1021/acs.jmedchem.4c05678', journal: 'Journal of Medicinal Chemistry', journalIf: 7.3,
      authors: 'Kalp M, Bhatt DK, Anderson L', organisms: 'Escherichia coli',
      ligands: 'ZN', weekId: '2025-W06', pubmedId: '39120029', fetchDate: '2025-02-18',
    },
    {
      pdbId: '7TV0', method: 'X-RAY DIFFRACTION', releaseDate: '2025-02-23', resolution: 1.88,
      title: 'Crystal structure of human lysosomal acid alpha-glucosidase with miglustat',
      doi: '10.1016/j.chembiol.2025.01.004', journal: 'Cell Chemical Biology', journalIf: 7.5,
      authors: 'Roig-Zamboni V, Bhatt DK, Harris S', organisms: 'Homo sapiens',
      ligands: 'ATP,CA', weekId: '2025-W07', pubmedId: '39120030', fetchDate: '2025-02-25',
    },

    // --- NMR (10) ---
    {
      pdbId: '8UW1', method: 'NMR', releaseDate: '2025-02-05', resolution: null,
      title: 'Solution NMR structure of the intrinsically disordered N-terminal domain of human alpha-synuclein',
      doi: '10.1038/s41467-024-57890-1', journal: 'Nature Communications', journalIf: 17.694,
      authors: 'Fauvet B, Bhatt DK, Bhatt MK', organisms: 'Homo sapiens',
      ligands: '', weekId: '2025-W05', pubmedId: '39120031', fetchDate: '2025-02-07',
    },
    {
      pdbId: '9XZ2', method: 'NMR', releaseDate: '2025-02-13', resolution: null,
      title: 'NMR structure of the zinc finger domain of human SP1 transcription factor',
      doi: '10.1021/jacs.4c16789', journal: 'Journal of the American Chemical Society', journalIf: 15.0,
      authors: 'Nakagawa S, Bhatt DK, Roeder R', organisms: 'Homo sapiens',
      ligands: 'ZN', weekId: '2025-W06', pubmedId: '39120032', fetchDate: '2025-02-15',
    },
    {
      pdbId: '7AC3', method: 'NMR', releaseDate: '2025-02-18', resolution: null,
      title: 'Solution structure of the SH3 domain of human c-Src kinase in complex with proline-rich peptide',
      doi: '10.1016/j.str.2025.01.003', journal: 'Structure', journalIf: 4.4,
      authors: 'Feng S, Bhatt DK, Schreiber SL', organisms: 'Homo sapiens',
      ligands: 'PRO', weekId: '2025-W07', pubmedId: '39120033', fetchDate: '2025-02-20',
    },
    {
      pdbId: '8BD4', method: 'NMR', releaseDate: '2025-03-04', resolution: null,
      title: 'NMR structure of the Rattus norvegicus neuropeptide Y Y1 receptor N-terminal domain',
      doi: '10.1038/s41594-024-01890-7', journal: 'Nature Structural & Molecular Biology', journalIf: 16.7,
      authors: 'Xu B, Bhatt DK, Bhatt RK', organisms: 'Rattus norvegicus',
      ligands: '', weekId: '2025-W08', pubmedId: '39120034', fetchDate: '2025-03-06',
    },
    {
      pdbId: '9CE5', method: 'NMR', releaseDate: '2025-02-08', resolution: null,
      title: 'Solution NMR structure of the PDZ domain of human PSD-95 bound to CRIPT peptide',
      doi: '10.7554/eLife.91234', journal: 'eLife', journalIf: 7.7,
      authors: 'Tochio H, Bhatt DK, Zhang M', organisms: 'Homo sapiens',
      ligands: '', weekId: '2025-W05', pubmedId: '39120035', fetchDate: '2025-02-10',
    },
    {
      pdbId: '7DF6', method: 'NMR', releaseDate: '2025-02-14', resolution: null,
      title: 'NMR structure of the Saccharomyces cerevisiae Hsp104 N-terminal domain',
      doi: '10.1093/nar/gkae3456', journal: 'Nucleic Acids Research', journalIf: 16.7,
      authors: 'Yokom AL, Bhatt DK, Southworth DR', organisms: 'Saccharomyces cerevisiae',
      ligands: 'ATP', weekId: '2025-W06', pubmedId: '39120036', fetchDate: '2025-02-16',
    },
    {
      pdbId: '8GH7', method: 'NMR', releaseDate: '2025-02-21', resolution: null,
      title: 'Solution structure of the human ubiquitin-like domain of Parkin',
      doi: '10.1021/bio0456789', journal: 'Biochemistry', journalIf: 3.0,
      authors: 'Safadi SS, Bhatt DK, Shaw GS', organisms: 'Homo sapiens',
      ligands: 'ZN', weekId: '2025-W07', pubmedId: '39120037', fetchDate: '2025-02-23',
    },
    {
      pdbId: '9IJ8', method: 'NMR', releaseDate: '2025-03-02', resolution: null,
      title: 'NMR structure of the Drosophila melanogaster period protein C-terminal domain',
      doi: '10.1038/s41467-024-58901-3', journal: 'Nature Communications', journalIf: 17.694,
      authors: 'Liu AC, Bhatt DK, Bhatt DK2', organisms: 'Drosophila melanogaster',
      ligands: '', weekId: '2025-W08', pubmedId: '39120038', fetchDate: '2025-03-04',
    },
    {
      pdbId: '7KL9', method: 'NMR', releaseDate: '2025-02-09', resolution: null,
      title: 'Solution NMR structure of the WW domain of human Pin1 bound to phosphoserine peptide',
      doi: '10.1016/j.jmb.2025.01.009', journal: 'Journal of Molecular Biology', journalIf: 5.6,
      authors: 'Verdecia MA, Bhatt DK, Noel JP', organisms: 'Homo sapiens',
      ligands: 'ATP', weekId: '2025-W05', pubmedId: '39120039', fetchDate: '2025-02-11',
    },
    {
      pdbId: '8HBK', method: 'NMR', releaseDate: '2025-02-17', resolution: null,
      title: 'NMR structure of the Escherichia coli cold shock protein CspA',
      doi: '10.1002/pro.5678', journal: 'Protein Science', journalIf: 4.5,
      authors: 'Phadtare S, Bhatt DK, Inouye M', organisms: 'Escherichia coli',
      ligands: '', weekId: '2025-W06', pubmedId: '39120040', fetchDate: '2025-02-19',
    },
  ]

  for (const structure of newPdbStructures) {
    await prisma.pdbStructure.upsert({
      where: { pdbId: structure.pdbId },
      update: {},
      create: structure,
    })
  }
  console.log(`Added ${newPdbStructures.length} PDB structures`)

  // ─── 4 More Weekly Snapshots (W05-W08) ──────────────────────
  const newSnapshots = [
    {
      weekId: '2025-W05', weekStart: '2025-01-27', weekEnd: '2025-02-02',
      totalStructures: 298, cryoemCount: 112, xrayCount: 154, nmrCount: 26, otherCount: 6,
      avgResolution: 2.31,
      topJournals: '["Nature","Science","Cell","Nat Struct Mol Biol","PNAS"]',
      ifDist: '{"tier1_if>30":16,"tier2_10-30":54,"tier3_5-10":89,"tier4_<5":139}',
    },
    {
      weekId: '2025-W06', weekStart: '2025-02-03', weekEnd: '2025-02-09',
      totalStructures: 335, cryoemCount: 128, xrayCount: 165, nmrCount: 32, otherCount: 10,
      avgResolution: 2.25,
      topJournals: '["Cell","Nature","Science","JACS","Nat Commun"]',
      ifDist: '{"tier1_if>30":20,"tier2_10-30":62,"tier3_5-10":105,"tier4_<5":148}',
    },
    {
      weekId: '2025-W07', weekStart: '2025-02-10', weekEnd: '2025-02-16',
      totalStructures: 310, cryoemCount: 115, xrayCount: 158, nmrCount: 29, otherCount: 8,
      avgResolution: 2.38,
      topJournals: '["Science","Nature","Nat Struct Mol Biol","Mol Cell","eLife"]',
      ifDist: '{"tier1_if>30":17,"tier2_10-30":58,"tier3_5-10":96,"tier4_<5":139}',
    },
    {
      weekId: '2025-W08', weekStart: '2025-02-17', weekEnd: '2025-02-23',
      totalStructures: 278, cryoemCount: 103, xrayCount: 142, nmrCount: 24, otherCount: 9,
      avgResolution: 2.42,
      topJournals: '["Nature","Cell","Science","Nucleic Acids Res","J Med Chem"]',
      ifDist: '{"tier1_if>30":13,"tier2_10-30":50,"tier3_5-10":87,"tier4_<5":128}',
    },
  ]
  for (const snapshot of newSnapshots) {
    await prisma.weeklySnapshot.upsert({
      where: { weekId: snapshot.weekId },
      update: {},
      create: snapshot,
    })
  }
  console.log(`Added ${newSnapshots.length} weekly snapshots`)

  // ─── 30 More PubMed Articles ─────────────────────────────────
  const newPubMedArticles = [
    // 2025 articles
    { pubmedId: '39120001', title: 'Structural basis for EGFR activation by cetuximab and its implications for antibody-based cancer therapy', authors: 'Li X, Wang R, Chen H, Nakamura T', journal: 'Nature', pubYear: '2025', abstract: 'Epidermal growth factor receptor (EGFR) is a key therapeutic target in cancer. We present the cryo-EM structure of the EGFR kinase domain in complex with cetuximab, revealing how antibody binding allosterically modulates dimerization and kinase activity. These findings provide a structural framework for designing next-generation anti-EGFR therapeutics.', doi: '10.1038/s41586-024-08345-1' },
    { pubmedId: '39120002', title: 'Cryo-EM structure of TRPML1 reveals lipid regulation of lysosomal ion channels', authors: 'Chen Q, She J, Cao Z, Wang T', journal: 'Science', pubYear: '2025', abstract: 'TRPML1 is a lysosomal cation channel essential for membrane trafficking and autophagy. We report the cryo-EM structure of human TRPML1 at 2.95 Å resolution, revealing how lysosomal lipids modulate channel gating through direct interactions with the transmembrane domain.', doi: '10.1126/science.adr5678' },
    { pubmedId: '39120003', title: 'Paused RNA polymerase II structure reveals elongation regulation by DSIF and NELF', authors: 'Vos SM, Farnung L, Boehning M, Cramer P', journal: 'Cell', pubYear: '2025', abstract: 'Transcriptional pausing by RNA polymerase II is a key regulatory step in gene expression. We present the cryo-EM structure of the Pol II elongation complex bound to DSIF and NELF, revealing how these factors stabilize the paused state and prevent nucleotide addition.', doi: '10.1016/j.cell.2025.01.015' },
    { pubmedId: '39120004', title: 'Active conformation of the insulin receptor reveals the mechanism of insulin signaling', authors: 'Uchikawa E, Chen L, Takahashi N, Matsumura H', journal: 'Nature', pubYear: '2025', abstract: 'The insulin receptor is a transmembrane tyrosine kinase essential for glucose homeostasis. We present the cryo-EM structure of the full-length insulin receptor in its active conformation, revealing how insulin binding triggers conformational changes that bring the intracellular kinase domains into proximity for trans-autophosphorylation.', doi: '10.1038/s41586-024-08456-2' },
    { pubmedId: '39120005', title: 'Cross-neutralizing antibody recognition of the SARS-CoV-2 spike protein reveals conserved epitopes', authors: 'Wrapp D, Wang N, McLellan JS', journal: 'Science', pubYear: '2025', abstract: 'Broadly neutralizing antibodies against SARS-CoV-2 target conserved regions of the spike glycoprotein. We report the cryo-EM structure of the SARS-CoV-2 spike bound to a cross-neutralizing antibody, identifying a conserved epitope that is resistant to viral escape mutations.', doi: '10.1126/science.ads1234' },
    { pubmedId: '39120006', title: 'Architecture of the human pre-60S ribosomal subunit reveals ribosome biogenesis factors', authors: 'Kater L, Thoms M, Bhatt DK, Beckmann R', journal: 'Nature Structural & Molecular Biology', pubYear: '2025', abstract: 'Ribosome biogenesis requires sequential assembly and remodeling steps. We present the cryo-EM structure of the human pre-60S subunit at 3.80 Å, capturing multiple assembly factors that guide the maturation of the large ribosomal subunit.', doi: '10.1038/s41594-024-01567-3' },
    { pubmedId: '39120007', title: 'Structure of human mTORC2 reveals the mechanism of Akt phosphorylation and SIN1 recruitment', authors: 'Stuttfeld E, Aylett CH, Bhatt DK, Maier T', journal: 'Nature', pubYear: '2025', abstract: 'mTORC2 is a key signaling complex that phosphorylates AGC kinases including Akt. We present the cryo-EM structure of human mTORC2 with Sin1 and Protor at 3.35 Å resolution, revealing how Sin1 positions Akt for phosphorylation at Ser473.', doi: '10.1038/s41586-024-08567-1' },
    { pubmedId: '39120008', title: 'KATP channel structure reveals the molecular basis for sulfonylurea drug action', authors: 'Martin GM, Chen PC, Bhatt DK, Shyng SL', journal: 'Cell', pubYear: '2025', abstract: 'ATP-sensitive potassium channels couple cellular metabolism to membrane excitability. We present the cryo-EM structure of the SUR1-Kir6.2 KATP channel bound to the antidiabetic drug glibenclamide, revealing how sulfonylureas lock the channel in a closed conformation.', doi: '10.1016/j.cell.2025.01.023' },
    { pubmedId: '39120009', title: 'Inward-facing structure of ABCG2 reveals the substrate translocation pathway', authors: 'Kowal J, Ni D, Jackson SM, Locher KP', journal: 'Nature Communications', pubYear: '2025', abstract: 'ABCG2 is a multidrug transporter involved in cancer chemoresistance. We present the cryo-EM structure of human ABCG2 in the inward-facing conformation at 2.60 Å, revealing the substrate-binding cavity and the conformational changes that drive drug efflux.', doi: '10.1038/s41467-024-55678-1' },
    { pubmedId: '39120010', title: 'PIEZO1 structure in lipid nanodisc reveals membrane tension sensing mechanism', authors: 'Zhao Q, Zhou H, Chi S, Wang B', journal: 'Science', pubYear: '2025', abstract: 'PIEZO1 is a mechanosensitive ion channel activated by membrane tension. We present the cryo-EM structure of human PIEZO1 in a lipid nanodisc at 3.45 Å, revealing how the blade domains interact with the lipid bilayer to sense mechanical force.', doi: '10.1126/science.adt8901' },
    { pubmedId: '39120011', title: 'Structural basis for antimalarial drug action on the Plasmodium ribosome', authors: 'Wong W, Bai XC, Bhatt DK, Scheres SHW', journal: 'eLife', pubYear: '2025', abstract: 'Emetine is an antimalarial drug that targets the Plasmodium ribosome. We present the cryo-EM structure of the Plasmodium falciparum 80S ribosome bound to emetine at 3.25 Å, revealing how the drug selectively inhibits protein synthesis in the parasite.', doi: '10.7554/eLife.90123' },
    { pubmedId: '39120012', title: 'SWI/SNF-nucleosome complex structure reveals chromatin remodeling mechanism', authors: 'He S, Wu Z, Bhatt DK, Yuan Z', journal: 'Nature', pubYear: '2025', abstract: 'The SWI/SNF complex remodels chromatin to regulate gene expression. We present the cryo-EM structure of the human SWI/SNF complex bound to a nucleosome at 2.85 Å, revealing how the ATPase motor engages nucleosomal DNA to drive DNA translocation.', doi: '10.1038/s41586-024-08678-5' },
    { pubmedId: '39120013', title: 'Autoinhibited V-ATPase structure reveals lysosomal acidification control', authors: 'Wang L, Wu D, Bhatt DK, Fu TM', journal: 'Nature Structural & Molecular Biology', pubYear: '2025', abstract: 'V-ATPase acidifies lysosomes through rotary proton pumping. We present the cryo-EM structure of human V-ATPase in the autoinhibited state at 3.90 Å, revealing how the V1 and Vo domains dissociate to regulate proton transport.', doi: '10.1038/s41594-024-01678-4' },
    { pubmedId: '39120014', title: 'TCF4-beta-catenin transcription complex structure reveals Wnt signaling readout', authors: 'Chambers SP, Bhatt DK, Nusse R', journal: 'Nature Communications', pubYear: '2025', abstract: 'Wnt signaling activates target genes through the TCF4-beta-catenin transcription complex. We present the cryo-EM structure of this complex from Drosophila at 3.15 Å, revealing how beta-catenin bridges TCF4 and coactivators on DNA.', doi: '10.1038/s41467-024-56789-2' },
    { pubmedId: '39120015', title: 'TREX-2 mRNA export complex structure reveals nuclear pore interaction mechanism', authors: 'Durr RA, Bhatt DK, Strambio-De-Castillia C', journal: 'Proceedings of the National Academy of Sciences', pubYear: '2025', abstract: 'The TREX-2 complex mediates mRNA export through nuclear pores. We present the cryo-EM structure of the mouse TREX-2 complex at 3.50 Å, revealing how it connects the transcription machinery to the nuclear pore.', doi: '10.1073/pnas.2412345678' },
    { pubmedId: '39120016', title: 'Structural basis for KRAS G12C inhibition by sotorasib in complex with SOS1', authors: 'Pantsar T, Bhatt DK, Ansari S', journal: 'Nature', pubYear: '2025', abstract: 'KRAS G12C is a major oncogenic driver that has been successfully targeted with covalent inhibitors. We present the crystal structure of KRAS G12C bound to sotorasib and SOS1 at 1.75 Å, revealing how the inhibitor traps KRAS in the inactive state while modulating SOS1-mediated nucleotide exchange.', doi: '10.1038/s41586-024-08789-2' },
    { pubmedId: '39120017', title: 'Phytochrome B photosensory domain structure reveals plant light sensing mechanism', authors: 'Burgie ES, Bhatt DK, Vierstra RD', journal: 'Molecular Cell', pubYear: '2025', abstract: 'Phytochrome B is a red/far-red light photoreceptor that controls plant development. We present the crystal structure of Arabidopsis phytochrome B photosensory domain at 2.05 Å, revealing how the biliverdin chromophore undergoes photoisomerization to switch between active and inactive states.', doi: '10.1016/j.molcel.2025.01.007' },
    { pubmedId: '39120018', title: 'Tryptophan synthase structure reveals substrate channeling between alpha and beta subunits', authors: 'Dunn MF, Bhatt DK, Niks D', journal: 'Journal of the American Chemical Society', pubYear: '2025', abstract: 'Tryptophan synthase channels indole between its alpha and beta subunits through a hydrophobic tunnel. We present the crystal structure of E. coli tryptophan synthase with PLP at 1.90 Å, capturing the allosteric communication between active sites.', doi: '10.1021/jacs.4c15678' },
    { pubmedId: '39120019', title: 'PD-1/PD-L1 complex with therapeutic antibody reveals checkpoint inhibition mechanism', authors: 'Zak KM, Bhatt DK, Holak TA', journal: 'Nature', pubYear: '2025', abstract: 'PD-1/PD-L1 is a critical immune checkpoint target for cancer immunotherapy. We present the crystal structure of the PD-1/PD-L1 complex bound to a therapeutic antibody at 2.20 Å, revealing how the antibody blocks the interaction and restores T cell activity.', doi: '10.1038/s41586-024-08890-8' },
    { pubmedId: '39120020', title: 'Ultra-high-resolution cytochrome c oxidase reveals proton pumping pathway', authors: 'Shimada S, Bhatt DK, Tsukihara T', journal: 'Science', pubYear: '2025', abstract: 'Cytochrome c oxidase is the terminal enzyme of the respiratory chain. We present the ultra-high-resolution crystal structure of yeast cytochrome c oxidase at 1.55 Å, revealing detailed water networks that define the proton pumping pathway.', doi: '10.1126/science.adu1234' },
    // 2024 articles
    { pubmedId: '39120021', title: 'Acetylcholinesterase-rivastigmine complex structure informs Alzheimer drug design', authors: 'Dvir H, Bhatt DK, Sussman JL', journal: 'Journal of Medicinal Chemistry', pubYear: '2024', abstract: 'Acetylcholinesterase inhibitors are first-line treatments for Alzheimer disease. We present the crystal structure of rat acetylcholinesterase in complex with rivastigmine at 2.45 Å, revealing the molecular basis for carbamate-based inhibition.', doi: '10.1021/acs.jmedchem.4c03456' },
    { pubmedId: '39120022', title: 'Novel sulfonamide inhibitors of carbonic anhydrase II: structural insights for isoform selectivity', authors: 'Supuran CT, Bhatt DK, De Simone G', journal: 'Journal of Molecular Biology', pubYear: '2024', abstract: 'Carbonic anhydrase II is a drug target for glaucoma and altitude sickness. We present crystal structures of CAII with novel sulfonamide inhibitors at 1.80 Å, revealing structural determinants for isoform-selective drug design.', doi: '10.1016/j.jmb.2025.01.012' },
    { pubmedId: '39120023', title: 'JAK2 kinase domain with fedratinib reveals structural basis for myelofibrosis therapy', authors: 'Davis R, Bhatt DK, Singh A', journal: 'Cancer Cell', pubYear: '2024', abstract: 'JAK2 is a therapeutic target in myeloproliferative neoplasms. We present the crystal structure of the JAK2 kinase domain with fedratinib at 2.30 Å, revealing how the inhibitor achieves selectivity over JAK1 and JAK3.', doi: '10.1016/j.ccell.2025.01.005' },
    { pubmedId: '39120024', title: 'Falcipain-2 inhibitor complexes provide a platform for antimalarial drug development', authors: 'Hans R, Bhatt DK, Rosenthal PJ', journal: 'Journal of Medicinal Chemistry', pubYear: '2024', abstract: 'Falcipain-2 is a cysteine protease essential for hemoglobin degradation by malaria parasites. We present crystal structures of falcipain-2 with vinyl sulfone inhibitors at 1.65 Å, guiding structure-based antimalarial drug design.', doi: '10.1021/acs.jmedchem.4c04567' },
    { pubmedId: '39120025', title: 'BCL-2-venetoclax complex structure reveals the mechanism of apoptosis induction in leukemia', authors: 'Souers AJ, Bhatt DK, Leverson JD', journal: 'Nature', pubYear: '2024', abstract: 'Venetoclax is a BCL-2 inhibitor approved for chronic lymphocytic leukemia. We present the crystal structure of BCL-2 bound to venetoclax at 2.15 Å, revealing how the drug displaces pro-survival BH3-only proteins to induce apoptosis.', doi: '10.1038/s41586-024-08901-5' },
    // 2023 articles
    { pubmedId: '39120026', title: 'Period protein PAS domain structure reveals circadian clock photoresponse mechanism', authors: 'Zhang EE, Bhatt DK, Kay SA', journal: 'Nature Structural & Molecular Biology', pubYear: '2023', abstract: 'Circadian rhythms are regulated by PERIOD proteins that respond to light. We present the crystal structure of the Drosophila Period PAS domain at 1.98 Å, revealing how the PAS fold mediates light-dependent protein-protein interactions.', doi: '10.1038/s41594-024-01789-6' },
    { pubmedId: '39120027', title: 'STAT3 DNA-binding domain structure reveals transcription factor selectivity on GAS elements', authors: 'Neculai D, Bhatt DK, Neculai AM', journal: 'Nucleic Acids Research', pubYear: '2023', abstract: 'STAT3 is a transcription factor activated by cytokine signaling. We present the crystal structure of the mouse STAT3 DNA-binding domain bound to a GAS element at 2.50 Å, revealing how STAT3 distinguishes between different target gene promoters.', doi: '10.1093/nar/gkae2345' },
    { pubmedId: '39120028', title: 'Thymidylate synthase with 5-fluorouracil reveals fluoropyrimidine drug mechanism', authors: 'Phan J, Bhatt DK, Minor W', journal: 'Proceedings of the National Academy of Sciences', pubYear: '2023', abstract: '5-Fluorouracil is a cornerstone chemotherapeutic that targets thymidylate synthase. We present the high-resolution crystal structure of human thymidylate synthase with 5-FU at 1.72 Å, revealing the covalent mechanism of enzyme inhibition.', doi: '10.1073/pnas.2413456789' },
    { pubmedId: '39120029', title: 'LpxC deacetylase structure with CHIR-090 provides insights for Gram-negative antibiotic design', authors: 'Kalp M, Bhatt DK, Anderson L', journal: 'Journal of Medicinal Chemistry', pubYear: '2023', abstract: 'LpxC is a validated target for antibiotics against Gram-negative bacteria. We present the crystal structure of E. coli LpxC with CHIR-090 at 2.80 Å, revealing how the hydroxamate group coordinates the catalytic zinc for potent inhibition.', doi: '10.1021/acs.jmedchem.4c05678' },
    { pubmedId: '39120030', title: 'Acid alpha-glucosidase with miglustat structure informs Pompe disease therapy', authors: 'Roig-Zamboni V, Bhatt DK, Harris S', journal: 'Cell Chemical Biology', pubYear: '2023', abstract: 'Pompe disease results from deficiency of lysosomal acid alpha-glucosidase. We present the crystal structure of human GAA with the chaperone miglustat at 1.88 Å, revealing how pharmacological chaperones stabilize the enzyme for enzyme replacement therapy.', doi: '10.1016/j.chembiol.2025.01.004' },
  ]

  for (const article of newPubMedArticles) {
    await prisma.pubMedArticle.upsert({
      where: { pubmedId: article.pubmedId },
      update: {},
      create: article,
    })
  }
  console.log(`Added ${newPubMedArticles.length} PubMed articles`)

  // ─── 3 More Evaluations ─────────────────────────────────────

  // Evaluation 1: EGFR (P00533)
  await prisma.evaluation.upsert({
    where: { uniprotId: 'P00533' },
    update: {},
    create: {
      uniprotId: 'P00533',
      entryName: 'EGFR_HUMAN',
      proteinName: 'Epidermal growth factor receptor',
      geneNames: 'EGFR ERBB ERBB1 HER1',
      organism: 'Homo sapiens',
      sequenceLength: 1210,
      coverage: 0.42,
      scores: '{"structural_coverage":0.42,"ligand_binding":0.88,"disease_relevance":0.96,"publication_impact":0.93}',
      report: 'EGFR is a receptor tyrosine kinase and one of the most important drug targets in oncology with 42% structural coverage. The extracellular domain and kinase domain are well-characterized, with multiple structures of antibody and small-molecule inhibitor complexes. Key gap: the transmembrane and juxtamembrane regions lack structural data. The drug development pipeline is extensive with FDA-approved tyrosine kinase inhibitors and monoclonal antibodies.',
      batchId: null,
      pdbStructures: {
        create: [
          { pdbId: '8FG1', method: 'CRYO-EM', resolution: 3.20, title: 'EGFR kinase domain with cetuximab Fab', depositionDate: '2024-11-01', releaseDate: '2025-02-05', ligand: 'ATP', ligandNames: 'Adenosine-5\'-triphosphate', journal: 'Nature', journalIf: 64.8, doi: '10.1038/s41586-024-08345-1', pubmedId: '39120001', organism: 'Homo sapiens', authors: 'Li X, Wang R, Chen H', isCryoem: true, isXray: false, isNmr: false, ifTier: 'tier1', chainId: 'A', unpStart: 695, unpEnd: 1022 },
          { pdbId: '2ITX', method: 'X-RAY DIFFRACTION', resolution: 2.80, title: 'EGFR kinase domain with gefitinib', depositionDate: '2006-07-15', releaseDate: '2007-01-30', ligand: 'ATP', ligandNames: 'Adenosine-5\'-triphosphate', journal: 'Cancer Cell', journalIf: 23.9, doi: '10.1016/j.ccr.2006.06.016', pubmedId: '16904630', organism: 'Homo sapiens', authors: 'Yun CH, Boggon TJ, Li Y, Eck MJ', isCryoem: false, isXray: true, isNmr: false, ifTier: 'tier1', chainId: 'A', unpStart: 696, unpEnd: 1022 },
          { pdbId: '5WB1', method: 'CRYO-EM', resolution: 3.50, title: 'Full-length EGFR in the active dimeric state', depositionDate: '2017-04-20', releaseDate: '2017-09-13', ligand: 'ATP,MG', ligandNames: 'ATP,Magnesium ion', journal: 'Nature', journalIf: 64.8, doi: '10.1038/nature23898', pubmedId: '28869973', organism: 'Homo sapiens', authors: 'Zhang X, Bhatt DK, Wang J', isCryoem: true, isXray: false, isNmr: false, ifTier: 'tier1', chainId: 'A', unpStart: 1, unpEnd: 1210 },
        ]
      },
      blastResults: {
        create: [
          { pdbId: '8FG1', uniprotRef: 'P00533', description: 'EGFR kinase domain with cetuximab', identity: 100.0, evalue: '0.0', queryCoverage: 27.1, targetCoverage: 99.8, method: 'CRYO-EM', resolution: 3.20, releaseDate: '2025-02-05', source: 'RCSB PDB', taxonomyId: '9606', journal: 'Nature', journalIf: 64.8, ifTier: 'tier1', ligand: 'ATP', title: 'EGFR kinase domain with cetuximab', pubmedId: '39120001', pubmedTitle: 'Structural basis for EGFR activation by cetuximab', pubmedAuthors: 'Li X, Wang R, Chen H', pubmedAbstract: 'We present the cryo-EM structure of EGFR with cetuximab, revealing how antibody binding modulates kinase activity for cancer therapy.' },
          { pdbId: '2ITX', uniprotRef: 'P00533', description: 'EGFR kinase domain with gefitinib', identity: 99.5, evalue: '1e-280', queryCoverage: 27.0, targetCoverage: 99.2, method: 'X-RAY DIFFRACTION', resolution: 2.80, releaseDate: '2007-01-30', source: 'RCSB PDB', taxonomyId: '9606', journal: 'Cancer Cell', journalIf: 23.9, ifTier: 'tier1', ligand: 'ATP', title: 'EGFR kinase domain with gefitinib', pubmedId: '16904630', pubmedTitle: 'Structures of lung cancer-derived EGFR mutants and inhibitor complexes', pubmedAuthors: 'Yun CH, Boggon TJ, Li Y', pubmedAbstract: 'We report crystal structures of EGFR mutants found in lung cancer patients, revealing how oncogenic mutations activate the kinase and how inhibitors target them.' },
          { pdbId: '5WB1', uniprotRef: 'P00533', description: 'Full-length EGFR active dimer', identity: 99.8, evalue: '0.0', queryCoverage: 100.0, targetCoverage: 99.5, method: 'CRYO-EM', resolution: 3.50, releaseDate: '2017-09-13', source: 'RCSB PDB', taxonomyId: '9606', journal: 'Nature', journalIf: 64.8, ifTier: 'tier1', ligand: 'ATP,MG', title: 'Full-length EGFR in active dimeric state', pubmedId: '28869973', pubmedTitle: 'Cryo-EM structure of the full-length EGFR in the active dimeric state', pubmedAuthors: 'Zhang X, Bhatt DK, Wang J', pubmedAbstract: 'We present the cryo-EM structure of full-length EGFR in the active dimeric state, providing a comprehensive view of receptor activation.' },
        ]
      },
      reports: {
        create: [
          { title: 'Structural Coverage Analysis: EGFR', content: 'EGFR (1210 aa) has 42% structural coverage across 15 PDB entries. The extracellular domain (aa 1-620) and kinase domain (aa 696-1022) are well-characterized. Key gaps: the transmembrane helix (aa 621-645) and juxtamembrane region (aa 646-695). Priority: cryo-EM structures of full-length EGFR in lipid environments to capture signaling conformations.' },
        ]
      }
    }
  })
  console.log('Added evaluation: EGFR (P00533)')

  // Evaluation 2: SARS-CoV-2 Spike (P0DTC2)
  await prisma.evaluation.upsert({
    where: { uniprotId: 'P0DTC2' },
    update: {},
    create: {
      uniprotId: 'P0DTC2',
      entryName: 'SPIKE_SARS2',
      proteinName: 'Spike glycoprotein',
      geneNames: 'S spike',
      organism: 'SARS-CoV-2',
      sequenceLength: 1273,
      coverage: 0.65,
      scores: '{"structural_coverage":0.65,"ligand_binding":0.78,"disease_relevance":0.99,"publication_impact":0.97}',
      report: 'The SARS-CoV-2 spike glycoprotein is the primary target for vaccine and therapeutic antibody development with 65% structural coverage. The receptor-binding domain (RBD) and S1/S2 subunits are extensively characterized with hundreds of structures. Key gap: the S2 subunit post-fusion conformation and the full-length spike in different membrane environments.',
      batchId: null,
      pdbStructures: {
        create: [
          { pdbId: '9QR5', method: 'CRYO-EM', resolution: 2.75, title: 'SARS-CoV-2 spike with cross-neutralizing antibody', depositionDate: '2024-12-01', releaseDate: '2025-02-10', ligand: 'CA,MG', ligandNames: 'Calcium ion,Magnesium ion', journal: 'Science', journalIf: 56.9, doi: '10.1126/science.ads1234', pubmedId: '39120005', organism: 'SARS-CoV-2', authors: 'Wrapp D, Wang N, McLellan JS', isCryoem: true, isXray: false, isNmr: false, ifTier: 'tier1', chainId: 'A', unpStart: 1, unpEnd: 1273 },
          { pdbId: '7DF3', method: 'CRYO-EM', resolution: 3.50, title: 'SARS-CoV-2 spike in the open conformation with ACE2', depositionDate: '2020-02-15', releaseDate: '2020-03-18', ligand: '', ligandNames: '', journal: 'Science', journalIf: 56.9, doi: '10.1126/science.abb2507', pubmedId: '32165487', organism: 'SARS-CoV-2', authors: 'Walls AC, Park YJ, Tortorici MA, Veesler D', isCryoem: true, isXray: false, isNmr: false, ifTier: 'tier1', chainId: 'A', unpStart: 14, unpEnd: 1213 },
          { pdbId: '6M0J', method: 'CRYO-EM', resolution: 2.80, title: 'SARS-CoV-2 spike RBD bound to ACE2', depositionDate: '2020-02-20', releaseDate: '2020-03-25', ligand: '', ligandNames: '', journal: 'Nature', journalIf: 64.8, doi: '10.1038/s41586-020-2180-5', pubmedId: '32165470', organism: 'SARS-CoV-2', authors: 'Lan J, Ge J, Wang X, Wang H', isCryoem: true, isXray: false, isNmr: false, ifTier: 'tier1', chainId: 'E', unpStart: 333, unpEnd: 526 },
        ]
      },
      blastResults: {
        create: [
          { pdbId: '9QR5', uniprotRef: 'P0DTC2', description: 'SARS-CoV-2 spike with cross-neutralizing antibody', identity: 100.0, evalue: '0.0', queryCoverage: 65.2, targetCoverage: 99.8, method: 'CRYO-EM', resolution: 2.75, releaseDate: '2025-02-10', source: 'RCSB PDB', taxonomyId: '2697049', journal: 'Science', journalIf: 56.9, ifTier: 'tier1', ligand: 'CA,MG', title: 'SARS-CoV-2 spike with cross-neutralizing antibody', pubmedId: '39120005', pubmedTitle: 'Cross-neutralizing antibody recognition of SARS-CoV-2 spike', pubmedAuthors: 'Wrapp D, Wang N, McLellan JS', pubmedAbstract: 'We report the cryo-EM structure of SARS-CoV-2 spike with a cross-neutralizing antibody, identifying conserved epitopes for pan-coronavirus vaccine design.' },
          { pdbId: '7DF3', uniprotRef: 'P0DTC2', description: 'SARS-CoV-2 spike open conformation with ACE2', identity: 99.9, evalue: '0.0', queryCoverage: 94.0, targetCoverage: 99.7, method: 'CRYO-EM', resolution: 3.50, releaseDate: '2020-03-18', source: 'RCSB PDB', taxonomyId: '2697049', journal: 'Science', journalIf: 56.9, ifTier: 'tier1', ligand: '', title: 'SARS-CoV-2 spike open conformation', pubmedId: '32165487', pubmedTitle: 'Structure, function, and antigenicity of the SARS-CoV-2 spike glycoprotein', pubmedAuthors: 'Walls AC, Park YJ, Tortorici MA', pubmedAbstract: 'We determined the cryo-EM structure of the SARS-CoV-2 spike in the open conformation, revealing the mechanism of ACE2 receptor recognition.' },
          { pdbId: '6M0J', uniprotRef: 'P0DTC2', description: 'SARS-CoV-2 RBD bound to ACE2', identity: 100.0, evalue: '1e-200', queryCoverage: 15.2, targetCoverage: 99.9, method: 'CRYO-EM', resolution: 2.80, releaseDate: '2020-03-25', source: 'RCSB PDB', taxonomyId: '2697049', journal: 'Nature', journalIf: 64.8, ifTier: 'tier1', ligand: '', title: 'SARS-CoV-2 RBD with ACE2', pubmedId: '32165470', pubmedTitle: 'Structure of the SARS-CoV-2 spike receptor-binding domain bound to the ACE2 receptor', pubmedAuthors: 'Lan J, Ge J, Wang X', pubmedAbstract: 'We present the structure of the SARS-CoV-2 RBD bound to human ACE2, revealing key residues for receptor binding and potential drug targets.' },
        ]
      },
      reports: {
        create: [
          { title: 'Structural Coverage Analysis: SARS-CoV-2 Spike', content: 'SARS-CoV-2 Spike (1273 aa) has 65% structural coverage across 200+ PDB entries. The RBD (aa 333-526) is the most characterized region with numerous antibody and ACE2 complexes. Key gaps: the S2 post-fusion conformation and full-length spike in native membrane. Priority: structures of emerging variant spikes and broadly neutralizing antibody complexes.' },
        ]
      }
    }
  })
  console.log('Added evaluation: SARS-CoV-2 Spike (P0DTC2)')

  // Evaluation 3: Human Insulin Receptor (P06213)
  await prisma.evaluation.upsert({
    where: { uniprotId: 'P06213' },
    update: {},
    create: {
      uniprotId: 'P06213',
      entryName: 'INSR_HUMAN',
      proteinName: 'Insulin receptor',
      geneNames: 'INSR CD220',
      organism: 'Homo sapiens',
      sequenceLength: 1382,
      coverage: 0.35,
      scores: '{"structural_coverage":0.35,"ligand_binding":0.82,"disease_relevance":0.91,"publication_impact":0.86}',
      report: 'The insulin receptor is a transmembrane tyrosine kinase critical for glucose homeostasis with 35% structural coverage. The extracellular alpha subunit and kinase domain have been structurally characterized. Recent cryo-EM structures have revealed the full-length receptor in active and inactive states. Key gap: the transmembrane helix and juxtamembrane region, and conformational dynamics during insulin binding.',
      batchId: null,
      pdbStructures: {
        create: [
          { pdbId: '8OP4', method: 'CRYO-EM', resolution: 3.10, title: 'Insulin receptor ectodomain in the active conformation', depositionDate: '2024-11-15', releaseDate: '2025-02-26', ligand: 'ZN', ligandNames: 'Zinc ion', journal: 'Nature', journalIf: 64.8, doi: '10.1038/s41586-024-08456-2', pubmedId: '39120004', organism: 'Homo sapiens', authors: 'Uchikawa E, Chen L, Takahashi N', isCryoem: true, isXray: false, isNmr: false, ifTier: 'tier1', chainId: 'A', unpStart: 1, unpEnd: 907 },
          { pdbId: '4ZXB', method: 'X-RAY DIFFRACTION', resolution: 3.80, title: 'Insulin receptor ectodomain L1-CR-L2 fragment', depositionDate: '2015-02-10', releaseDate: '2015-06-17', ligand: '', ligandNames: '', journal: 'Nature', journalIf: 64.8, doi: '10.1038/nature14440', pubmedId: '25993924', organism: 'Homo sapiens', authors: 'Croll TI, Smith BJ, Bhatt DK, Lawrence MC', isCryoem: false, isXray: true, isNmr: false, ifTier: 'tier1', chainId: 'A', unpStart: 1, unpEnd: 468 },
          { pdbId: '3W14', method: 'X-RAY DIFFRACTION', resolution: 1.90, title: 'Insulin receptor kinase domain in the active conformation', depositionDate: '2012-08-15', releaseDate: '2013-04-24', ligand: 'ATP,MG', ligandNames: 'ATP,Magnesium ion', journal: 'Nature Structural & Molecular Biology', journalIf: 16.7, doi: '10.1038/nsmb.2534', pubmedId: '23474715', organism: 'Homo sapiens', authors: 'Cabrelli M, Bhatt DK, Hubbard SR', isCryoem: false, isXray: true, isNmr: false, ifTier: 'tier2', chainId: 'A', unpStart: 978, unpEnd: 1283 },
        ]
      },
      blastResults: {
        create: [
          { pdbId: '8OP4', uniprotRef: 'P06213', description: 'Insulin receptor ectodomain active conformation', identity: 99.8, evalue: '0.0', queryCoverage: 65.6, targetCoverage: 99.5, method: 'CRYO-EM', resolution: 3.10, releaseDate: '2025-02-26', source: 'RCSB PDB', taxonomyId: '9606', journal: 'Nature', journalIf: 64.8, ifTier: 'tier1', ligand: 'ZN', title: 'Insulin receptor ectodomain active', pubmedId: '39120004', pubmedTitle: 'Active conformation of the insulin receptor', pubmedAuthors: 'Uchikawa E, Chen L, Takahashi N', pubmedAbstract: 'We present the cryo-EM structure of the insulin receptor in its active conformation, revealing the mechanism of transmembrane signaling and kinase activation.' },
          { pdbId: '4ZXB', uniprotRef: 'P06213', description: 'Insulin receptor L1-CR-L2 fragment', identity: 99.5, evalue: '1e-260', queryCoverage: 33.9, targetCoverage: 98.8, method: 'X-RAY DIFFRACTION', resolution: 3.80, releaseDate: '2015-06-17', source: 'RCSB PDB', taxonomyId: '9606', journal: 'Nature', journalIf: 64.8, ifTier: 'tier1', ligand: '', title: 'Insulin receptor L1-CR-L2', pubmedId: '25993924', pubmedTitle: 'Structure of the insulin receptor ectodomain reveals a folded-over conformation', pubmedAuthors: 'Croll TI, Smith BJ, Lawrence MC', pubmedAbstract: 'We report the crystal structure of the insulin receptor ectodomain, revealing a folded-over conformation that constrains models for receptor activation.' },
          { pdbId: '3W14', uniprotRef: 'P06213', description: 'Insulin receptor kinase domain active', identity: 99.2, evalue: '2e-180', queryCoverage: 22.1, targetCoverage: 97.5, method: 'X-RAY DIFFRACTION', resolution: 1.90, releaseDate: '2013-04-24', source: 'RCSB PDB', taxonomyId: '9606', journal: 'Nature Structural & Molecular Biology', journalIf: 16.7, ifTier: 'tier2', ligand: 'ATP,MG', title: 'Insulin receptor kinase active', pubmedId: '23474715', pubmedTitle: 'Active insulin receptor kinase domain structure', pubmedAuthors: 'Cabrelli M, Hubbard SR', pubmedAbstract: 'We present the crystal structure of the active insulin receptor kinase domain, revealing the activation loop conformation and substrate binding site.' },
        ]
      },
      reports: {
        create: [
          { title: 'Structural Coverage Analysis: Insulin Receptor', content: 'Insulin Receptor (1382 aa) has 35% structural coverage across 12 PDB entries. The extracellular alpha subunit (aa 1-735) and kinase domain (aa 978-1283) are well-characterized. Key gaps: the transmembrane region (aa 908-936), juxtamembrane region (aa 937-977), and C-terminal tail (aa 1284-1382). Priority: cryo-EM structures capturing the full activation pathway from insulin binding to kinase activation.' },
        ]
      }
    }
  })
  console.log('Added evaluation: Insulin Receptor (P06213)')

  // Link new evaluations to existing batches or create new ones
  const batch3 = await prisma.evaluationBatch.create({
    data: {
      title: 'Receptor Tyrosine Kinases - Signaling and Drug Target Analysis',
      combinedReport: '# RTK Signaling Report\n\n## Summary\nThis batch evaluates structural coverage and druggability of receptor tyrosine kinases including EGFR, Insulin Receptor, and SARS-CoV-2 Spike (host receptor interactions).\n\n## Key Findings\n- EGFR: 42% coverage, high druggability (0.88 ligand binding score), extensive FDA-approved drug pipeline\n- Insulin Receptor: 35% coverage, critical gaps in transmembrane region\n- SARS-CoV-2 Spike: 65% coverage, highest disease relevance score (0.99)\n\n## Recommendations\n1. Prioritize full-length EGFR structures in native membrane environments\n2. Investigate insulin receptor conformational dynamics during activation\n3. Continue characterizing SARS-CoV-2 variant spike structures for vaccine updates',
    }
  })

  // Update the new evaluations with batch IDs
  await prisma.evaluation.update({ where: { uniprotId: 'P00533' }, data: { batchId: batch3.batchId } })
  await prisma.evaluation.update({ where: { uniprotId: 'P0DTC2' }, data: { batchId: batch3.batchId } })
  await prisma.evaluation.update({ where: { uniprotId: 'P06213' }, data: { batchId: batch3.batchId } })

  console.log('Created evaluation batch: Receptor Tyrosine Kinases')

  // ─── 2 More Weekly Reports (W05, W06) ──────────────────────
  const newWeeklyReports = [
    {
      weekId: '2025-W05', reportType: 'weekly_summary',
      title: 'PDB Weekly Report - Week 05, 2025',
      content: `# PDB Weekly Report - Week 05 (Jan 27 - Feb 2, 2025)

## Overview
This week saw 298 new structures deposited in the PDB, with Cryo-EM structures approaching 38% of all new deposits — a new record.

## Method Distribution
- **X-ray Diffraction**: 154 structures (51.7%)
- **Cryo-EM**: 112 structures (37.6%)
- **NMR**: 26 structures (8.7%)
- **Other**: 6 structures (2.0%)

## Notable Structures
- **8FG1**: EGFR kinase domain with cetuximab Fab (Nature, IF: 64.8) — Important for understanding antibody-based cancer therapy
- **7S1U**: KRAS G12C mutant with sotorasib and SOS1 (Nature, IF: 64.8) — Key oncology target
- **9XA0**: Yeast cytochrome c oxidase at 1.55 Å (Science, IF: 56.9) — Ultra-high-resolution membrane protein

## Journal Impact Factor Analysis
Average IF: 19.2. Sixteen structures published in tier-1 journals (IF > 30). The proportion of high-IF publications continues to increase.

## Cryo-EM Trends
Cryo-EM structures reached 37.6% of new deposits this week, up from 36.0% in W01. The average resolution of Cryo-EM structures improved to 3.1 Å, driven by advances in detector technology and image processing.

## Resolution Statistics
Average resolution: 2.31 Å. The highest-resolution structure this week was 9XA0 at 1.55 Å, an X-ray structure of cytochrome c oxidase.`,
      filename: 'weekly_report_2025_W05.md',
    },
    {
      weekId: '2025-W06', reportType: 'weekly_summary',
      title: 'PDB Weekly Report - Week 06, 2025',
      content: `# PDB Weekly Report - Week 06 (Feb 3-9, 2025)

## Overview
This week saw 335 new structures deposited — the highest weekly count in 2025 so far, driven by a surge in Cryo-EM and X-ray deposits.

## Method Distribution
- **X-ray Diffraction**: 165 structures (49.3%)
- **Cryo-EM**: 128 structures (38.2%)
- **NMR**: 32 structures (9.6%)
- **Other**: 10 structures (3.0%)

## Notable Structures
- **9KL2**: TRPML1 lysosomal channel (Science, IF: 56.9) — Key for understanding lysosomal storage disorders
- **9QR5**: SARS-CoV-2 spike with cross-neutralizing antibody (Science, IF: 56.9) — Important for pan-coronavirus vaccine design
- **8JK5**: BCL-2 with venetoclax (Nature, IF: 64.8) — Cancer therapy target
- **9CD1**: Plasmodium falciparum 80S ribosome with emetine (eLife, IF: 7.7) — Antimalarial drug mechanism

## Organism Diversity
This week featured structures from 8 different organisms, with Homo sapiens dominating at 68% of deposits. Notable non-human entries include structures from Plasmodium falciparum, Drosophila melanogaster, and Escherichia coli.

## Impact Factor Distribution
Twenty structures in tier-1 journals (IF > 30), the highest weekly count in 2025. This reflects an increasing trend of depositing high-impact structural biology papers.

## Emerging Trends
1. **AI-assisted structure prediction**: AlphaFold3 predictions are increasingly complementing experimental structures
2. **Membrane protein boom**: 45% of Cryo-EM deposits this week were membrane proteins
3. **Drug-target focus**: 22% of structures included bound ligands or inhibitors`,
      filename: 'weekly_report_2025_W06.md',
    },
  ]

  for (const report of newWeeklyReports) {
    await prisma.weeklyReport.create({ data: report })
  }
  console.log(`Added ${newWeeklyReports.length} weekly reports`)

  // ─── Summary ────────────────────────────────────────────────
  const totalPdb = await prisma.pdbStructure.count()
  const totalSnapshots = await prisma.weeklySnapshot.count()
  const totalArticles = await prisma.pubMedArticle.count()
  const totalEvaluations = await prisma.evaluation.count()
  const totalBatches = await prisma.evaluationBatch.count()
  const totalReports = await prisma.weeklyReport.count()
  const totalLigands = await prisma.ligand.count()

  console.log('\n=== Enhanced Seed Complete ===')
  console.log(`PDB Structures: ${totalPdb}`)
  console.log(`Weekly Snapshots: ${totalSnapshots}`)
  console.log(`PubMed Articles: ${totalArticles}`)
  console.log(`Evaluations: ${totalEvaluations}`)
  console.log(`Evaluation Batches: ${totalBatches}`)
  console.log(`Weekly Reports: ${totalReports}`)
  console.log(`Ligands: ${totalLigands}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
