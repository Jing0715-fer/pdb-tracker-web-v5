import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  // Clean up existing data
  await prisma.evaluationReport.deleteMany()
  await prisma.evaluationBlastResult.deleteMany()
  await prisma.evaluationPdbStructure.deleteMany()
  await prisma.evaluation.deleteMany()
  await prisma.evaluationBatch.deleteMany()
  await prisma.weeklyReport.deleteMany()
  await prisma.weeklySnapshot.deleteMany()
  await prisma.pdbChain.deleteMany()
  await prisma.pdbEntity.deleteMany()
  await prisma.pdbStructure.deleteMany()
  await prisma.pubMedArticle.deleteMany()
  await prisma.ligand.deleteMany()

  // ─── Ligands ───────────────────────────────────────────────
  const ligands = [
    { code: 'ATP', name: 'Adenosine-5\'-triphosphate', formula: 'C10H16N5O13P3', weight: '507.18', type: 'COFACTOR', description: 'A nucleotide that serves as the primary energy currency of cells, driving metabolic processes and signal transduction.' },
    { code: 'HEM', name: 'Protoporphyrin IX containing Fe', formula: 'C34H32FeN4O4', weight: '616.49', type: 'COFACTOR', description: 'Heme group, an iron-containing porphyrin that serves as the prosthetic group for hemoproteins including hemoglobin and cytochromes.' },
    { code: 'NAD', name: 'Nicotinamide-adenine-dinucleotide', formula: 'C21H27N7O14P2', weight: '663.43', type: 'COFACTOR', description: 'An essential coenzyme found in all living cells, critical for redox reactions in metabolic pathways.' },
    { code: 'MG', name: 'Magnesium ion', formula: 'Mg', weight: '24.31', type: 'ION', description: 'Divalent cation essential for enzymatic activity, stabilizing ATP and nucleic acid structures.' },
    { code: 'ZN', name: 'Zinc ion', formula: 'Zn', weight: '65.38', type: 'ION', description: 'Divalent cation crucial for catalytic activity of many enzymes and structural stability of zinc finger domains.' },
    { code: 'ADP', name: 'Adenosine-5\'-diphosphate', formula: 'C10H15N5O10P2', weight: '427.20', type: 'COFACTOR', description: 'A nucleotide produced by ATP hydrolysis, involved in energy transfer and platelet activation.' },
    { code: 'FAD', name: 'Flavin-adenine dinucleotide', formula: 'C27H33N9O15P2', weight: '785.56', type: 'COFACTOR', description: 'A redox cofactor involved in various metabolic pathways including the citric acid cycle and fatty acid oxidation.' },
    { code: 'PLP', name: 'Pyridoxal-5\'-phosphate', formula: 'C8H10NO6P', weight: '247.14', type: 'COFACTOR', description: 'Active form of vitamin B6 serving as a coenzyme for aminotransferases, decarboxylases, and other enzymes.' },
    { code: 'CA', name: 'Calcium ion', formula: 'Ca', weight: '40.08', type: 'ION', description: 'Divalent cation essential for signal transduction, muscle contraction, and structural roles in proteins.' },
    { code: 'SAM', name: 'S-adenosylmethionine', formula: 'C15H22N6O5S', weight: '398.44', type: 'COFACTOR', description: 'A methyl donor involved in methylation reactions, polyamine synthesis, and radical generation.' },
  ]
  for (const ligand of ligands) {
    await prisma.ligand.create({ data: ligand })
  }
  console.log(`Created ${ligands.length} ligands`)

  // ─── PDB Structures ────────────────────────────────────────
  const pdbStructures = [
    {
      pdbId: '1JNX', method: 'X-RAY DIFFRACTION', releaseDate: '2025-01-08', resolution: 1.85,
      title: 'Crystal structure of human BRCA1 BRCT domain in complex with BACH1 phosphopeptide',
      doi: '10.1038/s41586-024-08231-7', journal: 'Nature', journalIf: 64.8,
      authors: 'Zhang Y, Wang L, Chen M, Liu H, Park S', organisms: 'Homo sapiens',
      ligands: 'ATP,MG', weekId: '2025-W01', pubmedId: '38912345', fetchDate: '2025-01-10',
      chains: {
        create: [
          { asymId: 'A', uniprotAccession: 'P38398', geneName: 'BRCA1', organismName: 'Homo sapiens', sequence: 'MNSQSTKSNQRRKNLQPSQKMISQNSTKLENDNKQNALQSRQPSQRNISL' },
          { asymId: 'B', uniprotAccession: 'Q9H9S0', geneName: 'BACH1', organismName: 'Homo sapiens', sequence: 'ESLFEPVQKKMDRGSLGDSQRQRRKRPLNDLGLVSE' },
        ]
      },
      entities: {
        create: [
          { entityId: 1, moleculeType: 'polypeptide(L)', description: 'BRCA1-associated ring domain protein 1' },
          { entityId: 2, moleculeType: 'polypeptide(L)', description: 'BRCT-repeat protein BACH1' },
        ]
      }
    },
    {
      pdbId: '8XYZ', method: 'CRYO-EM', releaseDate: '2025-01-15', resolution: 3.12,
      title: 'Cryo-EM structure of the human mTORC1 complex bound to Rag GTPases',
      doi: '10.1126/science.adq4567', journal: 'Science', journalIf: 56.9,
      authors: 'Kim J, Tanaka R, Suzuki K, Park M, Chen W', organisms: 'Homo sapiens',
      ligands: 'NAD,ATP', weekId: '2025-W02', pubmedId: '38923456', fetchDate: '2025-01-18',
      chains: {
        create: [
          { asymId: 'A', uniprotAccession: 'P42345', geneName: 'MTOR', organismName: 'Homo sapiens', sequence: 'MTSLQHYYNAVAPLLSRVGGTQSLAWKLRVLQSRNQESRLRSLTQLNV' },
          { asymId: 'B', uniprotAccession: 'Q7L5X8', geneName: 'RPTOR', organismName: 'Homo sapiens', sequence: 'MEDPVGSQLQKTSSPRLQRPVPKVPGSTVSSRSARSSLSGAT' },
        ]
      },
      entities: {
        create: [
          { entityId: 1, moleculeType: 'polypeptide(L)', description: 'Serine/threonine-protein kinase mTOR' },
          { entityId: 2, moleculeType: 'polypeptide(L)', description: 'Regulatory-associated protein of mTOR' },
        ]
      }
    },
    {
      pdbId: '6Y2E', method: 'X-RAY DIFFRACTION', releaseDate: '2025-01-22', resolution: 2.10,
      title: 'Structure of SARS-CoV-2 main protease with inhibitor PF-07321332',
      doi: '10.1016/j.cell.2024.11.032', journal: 'Cell', journalIf: 64.5,
      authors: 'Owen DR, Allerton CMN, Anderson AS, Aschenbrenner L', organisms: 'SARS-CoV-2',
      ligands: 'ZN,MG', weekId: '2025-W03', pubmedId: '38934567', fetchDate: '2025-01-25',
      chains: {
        create: [
          { asymId: 'A', uniprotAccession: 'P0DTC2', geneName: 'nsp5', organismName: 'SARS-CoV-2', sequence: 'SGFKKLVPGNFSGVGTGFNSSVAVWMGSSQQTGNHASQSGTP' },
        ]
      },
      entities: {
        create: [
          { entityId: 1, moleculeType: 'polypeptide(L)', description: '3C-like proteinase nsp5' },
        ]
      }
    },
    {
      pdbId: '9GHI', method: 'CRYO-EM', releaseDate: '2025-02-01', resolution: 2.85,
      title: 'Human mitochondrial ribosome large subunit at 2.85 Angstrom resolution',
      doi: '10.1038/s41594-024-01412-5', journal: 'Nature Structural & Molecular Biology', journalIf: 16.7,
      authors: 'Brown A, Amunts A, Ramakrishnan V', organisms: 'Homo sapiens',
      ligands: 'HEM', weekId: '2025-W04', pubmedId: '38945678', fetchDate: '2025-02-03',
      chains: {
        create: [
          { asymId: 'A', uniprotAccession: 'P52815', geneName: 'MRPL3', organismName: 'Homo sapiens', sequence: 'MQAFSNQPSRKTLQKRLQAMRNQSLEQRLAAIKQKLEAQRQAK' },
          { asymId: 'B', uniprotAccession: 'Q9BYD6', geneName: 'MRPL13', organismName: 'Homo sapiens', sequence: 'MAKRRLQAKVSNPRKSQKARSLSRTPRKLQKELEQKQR' },
        ]
      },
      entities: {
        create: [
          { entityId: 1, moleculeType: 'polypeptide(L)', description: '39S ribosomal protein L3, mitochondrial' },
          { entityId: 2, moleculeType: 'polypeptide(L)', description: '39S ribosomal protein L13, mitochondrial' },
        ]
      }
    },
    {
      pdbId: '8JKL', method: 'NMR', releaseDate: '2025-01-10', resolution: null,
      title: 'Solution structure of the Z-alpha domain of human ADAR1 bound to Z-DNA',
      doi: '10.1073/pnas.2410987121', journal: 'Proceedings of the National Academy of Sciences', journalIf: 11.1,
      authors: 'Schade M, Bhatt DM, Bhattacharyya D, Ha SC', organisms: 'Homo sapiens',
      ligands: '', weekId: '2025-W01', pubmedId: '38956789', fetchDate: '2025-01-12',
      chains: {
        create: [
          { asymId: 'A', uniprotAccession: 'P55265', geneName: 'ADAR', organismName: 'Homo sapiens', sequence: 'NQKVGLKDLKNDLTNQKKVLELSPSDLLKQLQKAEKQAK' },
        ]
      },
      entities: {
        create: [
          { entityId: 1, moleculeType: 'polypeptide(L)', description: 'Double-stranded RNA-specific adenosine deaminase' },
        ]
      }
    },
    {
      pdbId: '7MNO', method: 'X-RAY DIFFRACTION', releaseDate: '2025-02-05', resolution: 1.45,
      title: 'High-resolution structure of Thermus thermophilus RNA polymerase open complex',
      doi: '10.7554/eLife.87654', journal: 'eLife', journalIf: 7.7,
      authors: 'Murakami KS, Masuda S, Darst SA', organisms: 'Thermus thermophilus',
      ligands: 'ADP,MG', weekId: '2025-W04', pubmedId: '38967890', fetchDate: '2025-02-07',
      chains: {
        create: [
          { asymId: 'A', uniprotAccession: 'Q5SKW1', geneName: 'rpoA', organismName: 'Thermus thermophilus', sequence: 'MKETLAVQKVTRPMDEVLENLLKALRDELAKAGLTPEVAIRV' },
          { asymId: 'B', uniprotAccession: 'Q8RQE7', geneName: 'rpoB', organismName: 'Thermus thermophilus', sequence: 'MRSELQKLANQQIAQLRDLQGNLQQYQALDKKQSKLPQTLRQ' },
        ]
      },
      entities: {
        create: [
          { entityId: 1, moleculeType: 'polypeptide(L)', description: 'DNA-directed RNA polymerase subunit alpha' },
          { entityId: 2, moleculeType: 'polypeptide(L)', description: 'DNA-directed RNA polymerase subunit beta' },
        ]
      }
    },
    {
      pdbId: '9PQR', method: 'CRYO-EM', releaseDate: '2025-01-20', resolution: 3.45,
      title: 'Cryo-EM structure of human GABA-A receptor in lipid nanodisc',
      doi: '10.1038/s41586-024-07921-4', journal: 'Nature', journalIf: 64.8,
      authors: 'Laverty D, Desai R, Uchanski T, Bhatt DK', organisms: 'Homo sapiens',
      ligands: 'ATP,CA', weekId: '2025-W02', pubmedId: '38978901', fetchDate: '2025-01-22',
      chains: {
        create: [
          { asymId: 'A', uniprotAccession: 'P14867', geneName: 'GABRA1', organismName: 'Homo sapiens', sequence: 'MDSQLRNKLQKQYSLSSPSRSLVQPSRSPSKSWNQSLNKPNI' },
          { asymId: 'B', uniprotAccession: 'P47870', geneName: 'GABRB2', organismName: 'Homo sapiens', sequence: 'MRSLLGIALLSCFQSLVSGNSEDPRNVQKRYRLSPARKCSEVKQ' },
        ]
      },
      entities: {
        create: [
          { entityId: 1, moleculeType: 'polypeptide(L)', description: 'Gamma-aminobutyric acid receptor subunit alpha-1' },
          { entityId: 2, moleculeType: 'polypeptide(L)', description: 'Gamma-aminobutyric acid receptor subunit beta-2' },
        ]
      }
    },
    {
      pdbId: '8STU', method: 'X-RAY DIFFRACTION', releaseDate: '2025-01-28', resolution: 2.35,
      title: 'Crystal structure of Escherichia coli DNA gyrase A C-terminal domain',
      doi: '10.1093/nar/gkae1234', journal: 'Nucleic Acids Research', journalIf: 16.7,
      authors: 'Vos SM, Tretter EM, Schmidt BH, Berger JM', organisms: 'Escherichia coli',
      ligands: 'ATP', weekId: '2025-W03', pubmedId: '38989012', fetchDate: '2025-01-30',
      chains: {
        create: [
          { asymId: 'A', uniprotAccession: 'P0AES6', geneName: 'gyrA', organismName: 'Escherichia coli', sequence: 'MSELQKLANQQIAQLRDLQGNLQQYQALDKKQSKLPQTLRQ' },
        ]
      },
      entities: {
        create: [
          { entityId: 1, moleculeType: 'polypeptide(L)', description: 'DNA gyrase subunit A' },
        ]
      }
    },
    {
      pdbId: '7VWX', method: 'CRYO-EM', releaseDate: '2025-02-12', resolution: 2.60,
      title: 'Structure of the human spliceosome post-catalytic P complex',
      doi: '10.1126/science.ado4567', journal: 'Science', journalIf: 56.9,
      authors: 'Zhang X, Zhan X, Yan C, Shi Y', organisms: 'Homo sapiens',
      ligands: 'NAD,ZN', weekId: '2025-W04', pubmedId: '38990123', fetchDate: '2025-02-14',
      chains: {
        create: [
          { asymId: 'A', uniprotAccession: 'O75533', geneName: 'SF3B1', organismName: 'Homo sapiens', sequence: 'MKLKQISRMLQQQQQKQQAQAKPQAQQAQAQAQAQAAQGPQVPQQ' },
          { asymId: 'B', uniprotAccession: 'Q15427', geneName: 'SF3B2', organismName: 'Homo sapiens', sequence: 'MGAQKIQVMQNQPQQPQQPQSQPPGVPQQSSVKRRMLAQK' },
        ]
      },
      entities: {
        create: [
          { entityId: 1, moleculeType: 'polypeptide(L)', description: 'Splicing factor 3B subunit 1' },
          { entityId: 2, moleculeType: 'polypeptide(L)', description: 'Splicing factor 3B subunit 2' },
        ]
      }
    },
    {
      pdbId: '9Y01', method: 'NMR', releaseDate: '2025-01-05', resolution: null,
      title: 'Solution NMR structure of the PH domain of human AKT1 kinase',
      doi: '10.1021/jacs.4c12345', journal: 'Journal of the American Chemical Society', journalIf: 15.0,
      authors: 'Parikh HI, Ghosh RP', organisms: 'Homo sapiens',
      ligands: '', weekId: '2025-W01', pubmedId: '39001234', fetchDate: '2025-01-07',
      chains: {
        create: [
          { asymId: 'A', uniprotAccession: 'P31749', geneName: 'AKT1', organismName: 'Homo sapiens', sequence: 'MSDVAIVKEGWLHKRGEYIKTWRPRYFLLKSDGSFIGYKEKPQ' },
        ]
      },
      entities: {
        create: [
          { entityId: 1, moleculeType: 'polypeptide(L)', description: 'RAC-alpha serine/threonine-protein kinase' },
        ]
      }
    },
    {
      pdbId: '8A23', method: 'X-RAY DIFFRACTION', releaseDate: '2025-01-18', resolution: 1.92,
      title: 'Crystal structure of the human CDK2-cyclin A complex with inhibitor roscovitine',
      doi: '10.1016/j.molcel.2024.11.008', journal: 'Molecular Cell', journalIf: 16.0,
      authors: 'Davies TG, Bentley J, Arris CE', organisms: 'Homo sapiens',
      ligands: 'ATP,MG', weekId: '2025-W02', pubmedId: '39012345', fetchDate: '2025-01-20',
      chains: {
        create: [
          { asymId: 'A', uniprotAccession: 'P24941', geneName: 'CDK2', organismName: 'Homo sapiens', sequence: 'MENFQKVEKIGEGTYGVVYKARNKLTGEVVALKKIRLDTETEGVP' },
          { asymId: 'B', uniprotAccession: 'P20248', geneName: 'CCNA2', organismName: 'Homo sapiens', sequence: 'MLQSTVPQKRVDLSRSLQSELRSLPSNPRRLQSLLRQATLQDKIM' },
        ]
      },
      entities: {
        create: [
          { entityId: 1, moleculeType: 'polypeptide(L)', description: 'Cyclin-dependent kinase 2' },
          { entityId: 2, moleculeType: 'polypeptide(L)', description: 'Cyclin-A2' },
        ]
      }
    },
    {
      pdbId: '7B45', method: 'CRYO-EM', releaseDate: '2025-02-08', resolution: 3.70,
      title: 'Cryo-EM structure of the human autophagy initiation complex ATG1-ATG13',
      doi: '10.1038/s41594-024-01389-2', journal: 'Nature Structural & Molecular Biology', journalIf: 16.7,
      authors: 'Fujioka Y, Suzuki SW, Yamamoto H', organisms: 'Homo sapiens',
      ligands: 'SAM', weekId: '2025-W04', pubmedId: '39023456', fetchDate: '2025-02-10',
      chains: {
        create: [
          { asymId: 'A', uniprotAccession: 'Q9H0Y0', geneName: 'ULK1', organismName: 'Homo sapiens', sequence: 'MTSSQPCQPSLRSKCSSLQSPVLEQVLKQQLRSLVNQKLEQCRHS' },
          { asymId: 'B', uniprotAccession: 'O75143', geneName: 'ATG13', organismName: 'Homo sapiens', sequence: 'MPNLRKSQYDKQIEDLIDTILQKQILKQKAEMLLKQKDDMEIKI' },
        ]
      },
      entities: {
        create: [
          { entityId: 1, moleculeType: 'polypeptide(L)', description: 'Serine/threonine-protein kinase ULK1' },
          { entityId: 2, moleculeType: 'polypeptide(L)', description: 'Autophagy-related protein 13' },
        ]
      }
    },
    {
      pdbId: '9C67', method: 'X-RAY DIFFRACTION', releaseDate: '2025-01-25', resolution: 2.55,
      title: 'Crystal structure of Plasmodium falciparum dihydroorotate dehydrogenase',
      doi: '10.1021/acs.jmedchem.4c02345', journal: 'Journal of Medicinal Chemistry', journalIf: 7.3,
      authors: 'Coteron JM, Catterick D, Castro J', organisms: 'Plasmodium falciparum',
      ligands: 'FAD', weekId: '2025-W03', pubmedId: '39034567', fetchDate: '2025-01-27',
      chains: {
        create: [
          { asymId: 'A', uniprotAccession: 'Q9IIU6', geneName: 'DHODH', organismName: 'Plasmodium falciparum', sequence: 'MKLFSRIYSLRKKKLHNCNVVNKSIYYCFKLQGYTSDQDIYYLSY' },
        ]
      },
      entities: {
        create: [
          { entityId: 1, moleculeType: 'polypeptide(L)', description: 'Dihydroorotate dehydrogenase (quinone)' },
        ]
      }
    },
    {
      pdbId: '8D89', method: 'NMR', releaseDate: '2025-02-02', resolution: null,
      title: 'NMR structure of the DNA-binding domain of p53 tumor suppressor bound to response element',
      doi: '10.1038/s41467-024-54321-8', journal: 'Nature Communications', journalIf: 17.694,
      authors: 'Weinreb PH, Li Y, Jin L', organisms: 'Homo sapiens',
      ligands: 'ZN', weekId: '2025-W03', pubmedId: '39045678', fetchDate: '2025-02-04',
      chains: {
        create: [
          { asymId: 'A', uniprotAccession: 'P04637', geneName: 'TP53', organismName: 'Homo sapiens', sequence: 'MEEPQSDPSVEPPLSQETFSDLWKLLPENNVLSPLPSQAMDDL' },
        ]
      },
      entities: {
        create: [
          { entityId: 1, moleculeType: 'polypeptide(L)', description: 'Cellular tumor antigen p53' },
        ]
      }
    },
    {
      pdbId: '7E90', method: 'X-RAY DIFFRACTION', releaseDate: '2025-01-12', resolution: 1.65,
      title: 'Crystal structure of the catalytic domain of human MMP-13 with inhibitor',
      doi: '10.1016/j.jmb.2024.167890', journal: 'Journal of Molecular Biology', journalIf: 5.6,
      authors: 'Roth J, Bhatt DK, Wilson K', organisms: 'Homo sapiens',
      ligands: 'CA,ZN', weekId: '2025-W01', pubmedId: '39056789', fetchDate: '2025-01-14',
      chains: {
        create: [
          { asymId: 'A', uniprotAccession: 'P45452', geneName: 'MMP13', organismName: 'Homo sapiens', sequence: 'MPSLLLQAAVLGALAAPSAQNLKVAVPRFLVKGHFQRVTDDKIV' },
        ]
      },
      entities: {
        create: [
          { entityId: 1, moleculeType: 'polypeptide(L)', description: 'Collagenase 3' },
        ]
      }
    },
  ]

  for (const structure of pdbStructures) {
    await prisma.pdbStructure.create({ data: structure })
  }
  console.log(`Created ${pdbStructures.length} PDB structures`)

  // ─── Weekly Snapshots ──────────────────────────────────────
  const weeklySnapshots = [
    {
      weekId: '2025-W01', weekStart: '2025-01-06', weekEnd: '2025-01-12',
      totalStructures: 247, cryoemCount: 89, xrayCount: 132, nmrCount: 22, otherCount: 4,
      avgResolution: 2.34,
      topJournals: '["Nature","Science","Cell","Nat Struct Mol Biol","Nucleic Acids Res"]',
      ifDist: '{"tier1_if>30":12,"tier2_10-30":45,"tier3_5-10":78,"tier4_<5":112}',
    },
    {
      weekId: '2025-W02', weekStart: '2025-01-13', weekEnd: '2025-01-19',
      totalStructures: 312, cryoemCount: 118, xrayCount: 156, nmrCount: 31, otherCount: 7,
      avgResolution: 2.28,
      topJournals: '["Science","Nature","Cell","PNAS","Nat Commun"]',
      ifDist: '{"tier1_if>30":18,"tier2_10-30":56,"tier3_5-10":98,"tier4_<5":140}',
    },
    {
      weekId: '2025-W03', weekStart: '2025-01-20', weekEnd: '2025-01-26',
      totalStructures: 289, cryoemCount: 105, xrayCount: 148, nmrCount: 28, otherCount: 8,
      avgResolution: 2.41,
      topJournals: '["Cell","Nature","Science","J Mol Biol","J Med Chem"]',
      ifDist: '{"tier1_if>30":15,"tier2_10-30":52,"tier3_5-10":85,"tier4_<5":137}',
    },
    {
      weekId: '2025-W04', weekStart: '2025-01-27', weekEnd: '2025-02-02',
      totalStructures: 265, cryoemCount: 97, xrayCount: 137, nmrCount: 25, otherCount: 6,
      avgResolution: 2.37,
      topJournals: '["Nature","Nat Struct Mol Biol","Science","eLife","Nucleic Acids Res"]',
      ifDist: '{"tier1_if>30":14,"tier2_10-30":48,"tier3_5-10":82,"tier4_<5":121}',
    },
  ]
  for (const snapshot of weeklySnapshots) {
    await prisma.weeklySnapshot.create({ data: snapshot })
  }
  console.log(`Created ${weeklySnapshots.length} weekly snapshots`)

  // ─── Weekly Reports ────────────────────────────────────────
  const weeklyReports = [
    {
      weekId: '2025-W01', reportType: 'weekly_summary',
      title: 'PDB Weekly Report - Week 01, 2025',
      content: `# PDB Weekly Report - Week 01 (Jan 6-12, 2025)

## Overview
This week saw 247 new structures deposited in the PDB, with Cryo-EM continuing its strong growth trend.

## Method Distribution
- **X-ray Diffraction**: 132 structures (53.4%)
- **Cryo-EM**: 89 structures (36.0%)
- **NMR**: 22 structures (8.9%)
- **Other**: 4 structures (1.6%)

## Notable Structures
- **7ABC**: Human BRCA1 BRCT domain with BACH1 phosphopeptide (Nature, IF: 64.8)
- **8JKL**: Z-alpha domain of ADAR1 bound to Z-DNA (PNAS, IF: 11.1)

## Journal Impact Factor Analysis
The average impact factor of journals publishing PDB-related papers this week was 18.4, with 12 structures published in tier-1 journals (IF > 30).

## Resolution Statistics
Average resolution: 2.34 Å. The highest-resolution structure this week was 7E90 at 1.65 Å.`,
      filename: 'weekly_report_2025_W01.md',
    },
    {
      weekId: '2025-W02', reportType: 'weekly_summary',
      title: 'PDB Weekly Report - Week 02, 2025',
      content: `# PDB Weekly Report - Week 02 (Jan 13-19, 2025)

## Overview
This week saw 312 new structures deposited, the highest weekly count in 2025 so far.

## Method Distribution
- **X-ray Diffraction**: 156 structures (50.0%)
- **Cryo-EM**: 118 structures (37.8%)
- **NMR**: 31 structures (9.9%)
- **Other**: 7 structures (2.2%)

## Notable Structures
- **8XYZ**: Human mTORC1 complex with Rag GTPases (Science, IF: 56.9)
- **9PQR**: Human GABA-A receptor in lipid nanodisc (Nature, IF: 64.8)

## Trends
Cryo-EM continues to gain ground, now approaching 38% of all new deposits. The number of structures from non-human organisms increased by 15% compared to the previous week.`,
      filename: 'weekly_report_2025_W02.md',
    },
  ]
  for (const report of weeklyReports) {
    await prisma.weeklyReport.create({ data: report })
  }
  console.log(`Created ${weeklyReports.length} weekly reports`)

  // ─── Evaluations ───────────────────────────────────────────
  const evaluations = [
    {
      uniprotId: 'P38398', entryName: 'BRCA1_HUMAN', proteinName: 'Breast cancer type 1 susceptibility protein',
      geneNames: 'BRCA1 FANCS RNF53', organism: 'Homo sapiens', sequenceLength: 1863, coverage: 0.34,
      scores: '{"structural_coverage":0.34,"ligand_binding":0.72,"disease_relevance":0.95,"publication_impact":0.88}',
      report: 'BRCA1 is a tumor suppressor protein with limited structural coverage (34%). The BRCT domain is well-characterized with multiple PDB structures. Key gap: the central region (aa 500-1000) lacks structural data. Disease relevance is high due to numerous cancer-associated mutations.',
      batchId: null,
      pdbStructures: {
        create: [
          { pdbId: '1JNX', method: 'X-RAY DIFFRACTION', resolution: 1.85, title: 'BRCA1 BRCT domain with BACH1 phosphopeptide', depositionDate: '2024-09-15', releaseDate: '2025-01-08', ligand: 'ATP', ligandNames: 'Adenosine-5\'-triphosphate', journal: 'Nature', journalIf: 64.8, doi: '10.1038/s41586-024-08231-7', pubmedId: '38912345', organism: 'Homo sapiens', authors: 'Zhang Y, Wang L, Chen M', isCryoem: false, isXray: true, isNmr: false, ifTier: 'tier1', chainId: 'A', unpStart: 1646, unpEnd: 1859 },
          { pdbId: '1JNX', method: 'X-RAY DIFFRACTION', resolution: 1.65, title: 'BRCA1 BRCT domain', depositionDate: '2001-03-15', releaseDate: '2001-09-12', ligand: '', ligandNames: '', journal: 'Nature Structural Biology', journalIf: 16.7, doi: '10.1038/nsb0901-769', pubmedId: '11524679', organism: 'Homo sapiens', authors: 'Williams RS, Green R, Glover JN', isCryoem: false, isXray: true, isNmr: false, ifTier: 'tier2', chainId: 'A', unpStart: 1646, unpEnd: 1859 },
        ]
      },
      blastResults: {
        create: [
          { pdbId: '1JNX', uniprotRef: 'P38398', description: 'Breast cancer type 1 susceptibility protein', identity: 100.0, evalue: '0.0', queryCoverage: 11.5, targetCoverage: 100.0, method: 'X-RAY DIFFRACTION', resolution: 1.85, releaseDate: '2025-01-08', source: 'RCSB PDB', taxonomyId: '9606', journal: 'Nature', journalIf: 64.8, ifTier: 'tier1', ligand: 'ATP', title: 'BRCA1 BRCT domain with BACH1 phosphopeptide', pubmedId: '38912345', pubmedTitle: 'Structural basis for BRCA1-BACH1 interaction', pubmedAuthors: 'Zhang Y, Wang L, Chen M, Liu H', pubmedAbstract: 'The BRCT domain of BRCA1 recognizes phosphorylated motifs in DNA repair proteins. We present the crystal structure of BRCA1 BRCT in complex with BACH1 phosphopeptide, revealing key interactions.' },
          { pdbId: '1JNX', uniprotRef: 'P38398', description: 'BRCA1 BRCT domain', identity: 99.7, evalue: '1e-180', queryCoverage: 11.5, targetCoverage: 99.5, method: 'X-RAY DIFFRACTION', resolution: 1.65, releaseDate: '2001-09-12', source: 'RCSB PDB', taxonomyId: '9606', journal: 'Nature Structural Biology', journalIf: 16.7, ifTier: 'tier2', ligand: '', title: 'BRCA1 BRCT domain', pubmedId: '11524679', pubmedTitle: 'Crystal structure of the BRCT repeat region from the breast cancer-associated protein BRCA1', pubmedAuthors: 'Williams RS, Green R, Glover JN', pubmedAbstract: 'We report the crystal structure of the BRCT domain of BRCA1, providing insights into its role in DNA damage response and tumor suppression.' },
          { pdbId: '5JZX', uniprotRef: 'P38398', description: 'BRCA1 RING domain with BARD1', identity: 99.1, evalue: '2e-95', queryCoverage: 6.7, targetCoverage: 98.2, method: 'X-RAY DIFFRACTION', resolution: 2.00, releaseDate: '2016-07-20', source: 'RCSB PDB', taxonomyId: '9606', journal: 'Nature', journalIf: 64.8, ifTier: 'tier1', ligand: 'ZN', title: 'BRCA1-BARD1 RING domain heterodimer', pubmedId: '27324108', pubmedTitle: 'BRCA1-BARD1 RING domain structure and ubiquitin ligase activity', pubmedAuthors: 'Brzovic PS, Keeffe JR, Nishikawa H, Ohta T', pubmedAbstract: 'The BRCA1 RING domain forms a heterodimer with BARD1, exhibiting ubiquitin E3 ligase activity critical for DNA repair.' },
        ]
      },
      reports: {
        create: [
          { title: 'Structural Coverage Analysis: BRCA1', content: 'BRCA1 (1863 aa) has 34% structural coverage across 8 PDB entries. The BRCT and RING domains are well-characterized, while the central coiled-coil and disordered regions remain structurally uncharacterized. Priority: obtaining cryo-EM structures of full-length BRCA1 complexes.' },
        ]
      }
    },
    {
      uniprotId: 'P42345', entryName: 'MTOR_HUMAN', proteinName: 'Serine/threonine-protein kinase mTOR',
      geneNames: 'MTOR FRAP FRAP1 FRAP2', organism: 'Homo sapiens', sequenceLength: 2549, coverage: 0.28,
      scores: '{"structural_coverage":0.28,"ligand_binding":0.85,"disease_relevance":0.92,"publication_impact":0.91}',
      report: 'mTOR is a large kinase with moderate structural coverage (28%). The kinase domain and FAT domain are well-studied. Recent cryo-EM breakthroughs have revealed the full mTORC1 complex architecture.',
      batchId: null,
      pdbStructures: {
        create: [
          { pdbId: '8XYZ', method: 'CRYO-EM', resolution: 3.12, title: 'mTORC1 complex with Rag GTPases', depositionDate: '2024-10-01', releaseDate: '2025-01-15', ligand: 'NAD', ligandNames: 'Nicotinamide-adenine-dinucleotide', journal: 'Science', journalIf: 56.9, doi: '10.1126/science.adq4567', pubmedId: '38923456', organism: 'Homo sapiens', authors: 'Kim J, Tanaka R, Suzuki K', isCryoem: true, isXray: false, isNmr: false, ifTier: 'tier1', chainId: 'A', unpStart: 1, unpEnd: 2549 },
        ]
      },
      blastResults: {
        create: [
          { pdbId: '8XYZ', uniprotRef: 'P42345', description: 'mTORC1 complex with Rag GTPases', identity: 99.8, evalue: '0.0', queryCoverage: 28.1, targetCoverage: 99.5, method: 'CRYO-EM', resolution: 3.12, releaseDate: '2025-01-15', source: 'RCSB PDB', taxonomyId: '9606', journal: 'Science', journalIf: 56.9, ifTier: 'tier1', ligand: 'NAD', title: 'mTORC1 complex with Rag GTPases', pubmedId: '38923456', pubmedTitle: 'Structural basis for Rag GTPase activation of mTORC1', pubmedAuthors: 'Kim J, Tanaka R, Suzuki K, Park M', pubmedAbstract: 'We present the cryo-EM structure of mTORC1 bound to Rag GTPases, revealing the mechanism by which amino acid signaling activates mTORC1.' },
          { pdbId: '5FLM', uniprotRef: 'P42345', description: 'mTOR kinase domain with rapamycin-FKBP12', identity: 99.5, evalue: '1e-250', queryCoverage: 15.3, targetCoverage: 97.8, method: 'X-RAY DIFFRACTION', resolution: 2.80, releaseDate: '2016-05-18', source: 'RCSB PDB', taxonomyId: '9606', journal: 'Nature', journalIf: 64.8, ifTier: 'tier1', ligand: 'ATP', title: 'mTOR kinase domain with rapamycin-FKBP12', pubmedId: '26886789', pubmedTitle: 'Architecture of human mTOR complex I and its allosteric inhibition by rapamycin', pubmedAuthors: 'Yang H, Jiang X, Li B, Bhatt DK', pubmedAbstract: 'The crystal structure of the mTOR kinase domain reveals the structural basis for allosteric inhibition by rapamycin-FKBP12.' },
        ]
      },
      reports: {
        create: [
          { title: 'Structural Coverage Analysis: mTOR', content: 'mTOR (2549 aa) has 28% structural coverage. The kinase domain and FAT domain have high-resolution structures. Recent cryo-EM structures have captured the full mTORC1/2 complexes. Gap: dynamic conformational states during activation.' },
        ]
      }
    },
    {
      uniprotId: 'P04637', entryName: 'P53_HUMAN', proteinName: 'Cellular tumor antigen p53',
      geneNames: 'TP53 LFS1 TRP53', organism: 'Homo sapiens', sequenceLength: 393, coverage: 0.72,
      scores: '{"structural_coverage":0.72,"ligand_binding":0.45,"disease_relevance":0.99,"publication_impact":0.95}',
      report: 'p53 is one of the most studied tumor suppressors with 72% structural coverage. The DNA-binding domain is extensively characterized. The N-terminal transactivation domain and C-terminal regulatory region remain challenging targets.',
      batchId: null,
      pdbStructures: {
        create: [
          { pdbId: '8D89', method: 'NMR', resolution: null, title: 'DNA-binding domain of p53 bound to response element', depositionDate: '2024-08-20', releaseDate: '2025-02-02', ligand: 'ZN', ligandNames: 'Zinc ion', journal: 'Nature Communications', journalIf: 17.694, doi: '10.1038/s41467-024-54321-8', pubmedId: '39045678', organism: 'Homo sapiens', authors: 'Weinreb PH, Li Y, Jin L', isCryoem: false, isXray: false, isNmr: true, ifTier: 'tier2', chainId: 'A', unpStart: 94, unpEnd: 312 },
          { pdbId: '1TSR', method: 'X-RAY DIFFRACTION', resolution: 1.70, title: 'p53 DNA-binding domain core', depositionDate: '1994-05-15', releaseDate: '1994-11-01', ligand: 'ZN', ligandNames: 'Zinc ion', journal: 'Nature Structural Biology', journalIf: 16.7, doi: '10.1038/nsb1094-821', pubmedId: '7736594', organism: 'Homo sapiens', authors: 'Cho Y, Gorina S, Jeffrey PD, Pavletich NP', isCryoem: false, isXray: true, isNmr: false, ifTier: 'tier2', chainId: 'A', unpStart: 94, unpEnd: 312 },
        ]
      },
      blastResults: {
        create: [
          { pdbId: '8D89', uniprotRef: 'P04637', description: 'p53 DNA-binding domain', identity: 100.0, evalue: '2e-120', queryCoverage: 55.5, targetCoverage: 98.5, method: 'NMR', resolution: null, releaseDate: '2025-02-02', source: 'RCSB PDB', taxonomyId: '9606', journal: 'Nature Communications', journalIf: 17.694, ifTier: 'tier2', ligand: 'ZN', title: 'p53 DNA-binding domain', pubmedId: '39045678', pubmedTitle: 'NMR structure of p53 DNA-binding domain with response element', pubmedAuthors: 'Weinreb PH, Li Y, Jin L', pubmedAbstract: 'We present the solution NMR structure of the p53 DNA-binding domain in complex with its response element, providing dynamic insights into transcription factor recognition.' },
        ]
      },
      reports: {
        create: []
      }
    },
    {
      uniprotId: 'P31749', entryName: 'AKT1_HUMAN', proteinName: 'RAC-alpha serine/threonine-protein kinase',
      geneNames: 'AKT1 CWS6 PKB PKB1 RAC', organism: 'Homo sapiens', sequenceLength: 480, coverage: 0.58,
      scores: '{"structural_coverage":0.58,"ligand_binding":0.82,"disease_relevance":0.88,"publication_impact":0.79}',
      report: 'AKT1/PKB is a central kinase in the PI3K/AKT/mTOR signaling pathway with 58% structural coverage. The PH domain and kinase domain have been extensively studied with multiple inhibitor-bound structures.',
      batchId: null,
      pdbStructures: {
        create: [
          { pdbId: '9Y01', method: 'NMR', resolution: null, title: 'PH domain of AKT1 kinase', depositionDate: '2024-07-10', releaseDate: '2025-01-05', ligand: '', ligandNames: '', journal: 'JACS', journalIf: 15.0, doi: '10.1021/jacs.4c12345', pubmedId: '39001234', organism: 'Homo sapiens', authors: 'Parikh HI, Ghosh RP', isCryoem: false, isXray: false, isNmr: true, ifTier: 'tier2', chainId: 'A', unpStart: 1, unpEnd: 108 },
          { pdbId: '3CQW', method: 'X-RAY DIFFRACTION', resolution: 2.00, title: 'AKT1 kinase domain with inhibitor', depositionDate: '2007-10-20', releaseDate: '2008-04-22', ligand: 'ATP', ligandNames: 'Adenosine-5\'-triphosphate', journal: 'Cancer Cell', journalIf: 23.9, doi: '10.1016/j.ccr.2008.03.003', pubmedId: '18394555', organism: 'Homo sapiens', authors: 'Lippa B, Pan M, Bhatt DK', isCryoem: false, isXray: true, isNmr: false, ifTier: 'tier1', chainId: 'A', unpStart: 144, unpEnd: 408 },
        ]
      },
      blastResults: {
        create: [
          { pdbId: '9Y01', uniprotRef: 'P31749', description: 'AKT1 PH domain', identity: 100.0, evalue: '3e-85', queryCoverage: 22.5, targetCoverage: 99.0, method: 'NMR', resolution: null, releaseDate: '2025-01-05', source: 'RCSB PDB', taxonomyId: '9606', journal: 'JACS', journalIf: 15.0, ifTier: 'tier2', ligand: '', title: 'AKT1 PH domain', pubmedId: '39001234', pubmedTitle: 'Solution NMR structure of the AKT1 PH domain', pubmedAuthors: 'Parikh HI, Ghosh RP', pubmedAbstract: 'We present the solution NMR structure of the PH domain of AKT1, revealing conformational dynamics relevant to membrane binding.' },
        ]
      },
      reports: {
        create: []
      }
    },
    {
      uniprotId: 'Q9IIU6', entryName: 'DHODH_PLAF7', proteinName: 'Dihydroorotate dehydrogenase (quinone)',
      geneNames: 'DHODH', organism: 'Plasmodium falciparum', sequenceLength: 567, coverage: 0.45,
      scores: '{"structural_coverage":0.45,"ligand_binding":0.91,"disease_relevance":0.78,"publication_impact":0.65}',
      report: 'PfDHODH is a validated antimalarial drug target with 45% structural coverage. Multiple inhibitor-bound structures are available, making it an attractive target for structure-based drug design.',
      batchId: null,
      pdbStructures: {
        create: [
          { pdbId: '9C67', method: 'X-RAY DIFFRACTION', resolution: 2.55, title: 'PfDHODH with inhibitor', depositionDate: '2024-10-05', releaseDate: '2025-01-25', ligand: 'FAD', ligandNames: 'Flavin-adenine dinucleotide', journal: 'J Med Chem', journalIf: 7.3, doi: '10.1021/acs.jmedchem.4c02345', pubmedId: '39034567', organism: 'Plasmodium falciparum', authors: 'Coteron JM, Catterick D, Castro J', isCryoem: false, isXray: true, isNmr: false, ifTier: 'tier3', chainId: 'A', unpStart: 1, unpEnd: 567 },
        ]
      },
      blastResults: {
        create: [
          { pdbId: '9C67', uniprotRef: 'Q9IIU6', description: 'PfDHODH', identity: 99.5, evalue: '1e-160', queryCoverage: 44.8, targetCoverage: 98.7, method: 'X-RAY DIFFRACTION', resolution: 2.55, releaseDate: '2025-01-25', source: 'RCSB PDB', taxonomyId: '5833', journal: 'J Med Chem', journalIf: 7.3, ifTier: 'tier3', ligand: 'FAD', title: 'PfDHODH with inhibitor', pubmedId: '39034567', pubmedTitle: 'Structure-based design of PfDHODH inhibitors', pubmedAuthors: 'Coteron JM, Catterick D, Castro J', pubmedAbstract: 'We report the crystal structure of PfDHODH with a novel inhibitor series, providing a basis for antimalarial drug development.' },
          { pdbId: '3I65', uniprotRef: 'Q9IIU6', description: 'PfDHODH with DSM-1', identity: 98.9, evalue: '5e-155', queryCoverage: 44.2, targetCoverage: 97.1, method: 'X-RAY DIFFRACTION', resolution: 1.79, releaseDate: '2010-02-16', source: 'RCSB PDB', taxonomyId: '5833', journal: 'J Med Chem', journalIf: 7.3, ifTier: 'tier3', ligand: 'FAD', title: 'PfDHODH with DSM-1 inhibitor', pubmedId: '20055399', pubmedTitle: 'Discovery of potent Plasmodium falciparum DHODH inhibitors', pubmedAuthors: 'Baldwin J, Michnoff CH, Bhatt DK', pubmedAbstract: 'We describe the discovery and optimization of DSM-1, a potent inhibitor of PfDHODH with antimalarial activity.' },
        ]
      },
      reports: {
        create: []
      }
    },
  ]

  for (const evaluation of evaluations) {
    await prisma.evaluation.create({ data: evaluation })
  }
  console.log(`Created ${evaluations.length} evaluations`)

  // ─── Evaluation Batches ────────────────────────────────────
  const batch1 = await prisma.evaluationBatch.create({
    data: {
      title: 'Tumor Suppressor Proteins - Structural Coverage Assessment',
      combinedReport: '# Structural Coverage Report: Tumor Suppressor Proteins\n\n## Summary\nThis batch evaluates the structural coverage of key tumor suppressor proteins including BRCA1, p53, and PTEN.\n\n## Key Findings\n- BRCA1: 34% coverage, critical gaps in central region\n- p53: 72% coverage, well-characterized DNA-binding domain\n- Average coverage across batch: 53%\n\n## Recommendations\n1. Prioritize cryo-EM studies of full-length BRCA1\n2. Focus on disordered regions of p53\n3. Investigate PTEN phosphatase dynamics',
    }
  })

  const batch2 = await prisma.evaluationBatch.create({
    data: {
      title: 'Kinase Drug Targets - Coverage and Druggability Analysis',
      combinedReport: '# Druggability Report: Kinase Targets\n\n## Summary\nThis batch evaluates structural coverage and druggability of therapeutic kinase targets including AKT1, mTOR, and CDK2.\n\n## Key Findings\n- AKT1: 58% coverage, high druggability score (0.82)\n- mTOR: 28% coverage, highest ligand binding score (0.85)\n- CDK2: 65% coverage, well-studied inhibitor binding site\n\n## Recommendations\n1. AKT1 allosteric inhibitors represent a promising therapeutic strategy\n2. mTORC1 conformational dynamics need further characterization\n3. CDK2 selective inhibitor design should leverage structural differences in the ATP-binding pocket',
    }
  })

  // Update evaluations with batch IDs
  await prisma.evaluation.update({ where: { uniprotId: 'P38398' }, data: { batchId: batch1.batchId } })
  await prisma.evaluation.update({ where: { uniprotId: 'P04637' }, data: { batchId: batch1.batchId } })
  await prisma.evaluation.update({ where: { uniprotId: 'P31749' }, data: { batchId: batch2.batchId } })
  await prisma.evaluation.update({ where: { uniprotId: 'P42345' }, data: { batchId: batch2.batchId } })

  console.log(`Created 2 evaluation batches`)

  // ─── PubMed Articles ───────────────────────────────────────
  const pubMedArticles = [
    { pubmedId: '38912345', title: 'Structural basis for BRCA1-BACH1 interaction and implications for DNA damage response', authors: 'Zhang Y, Wang L, Chen M, Liu H, Park S', journal: 'Nature', pubYear: '2025', abstract: 'The BRCT domain of BRCA1 plays a critical role in DNA damage response by recognizing phosphorylated protein partners. We present the crystal structure of the BRCA1 BRCT domain in complex with a BACH1 phosphopeptide at 1.85 Å resolution. The structure reveals a conserved phosphopeptide-binding pocket and identifies key residues for therapeutic targeting. Mutational analysis confirms the structural observations and provides insights into cancer-associated variants.', doi: '10.1038/s41586-024-08231-7' },
    { pubmedId: '38923456', title: 'Structural basis for Rag GTPase activation of mTORC1 on the lysosomal surface', authors: 'Kim J, Tanaka R, Suzuki K, Park M, Chen W', journal: 'Science', pubYear: '2025', abstract: 'mTORC1 integrates diverse signals to control cell growth and metabolism. We report the cryo-EM structure of human mTORC1 bound to Rag GTPases at 3.12 Å resolution, revealing how amino acid availability is communicated to mTORC1. The structure shows that Rag GTPases induce conformational changes in the mTORC1 catalytic core, facilitating activation on the lysosomal surface.', doi: '10.1126/science.adq4567' },
    { pubmedId: '38934567', title: 'Structural characterization of SARS-CoV-2 main protease with the clinical inhibitor nirmatrelvir', authors: 'Owen DR, Allerton CMN, Anderson AS, Aschenbrenner L', journal: 'Cell', pubYear: '2025', abstract: 'The SARS-CoV-2 main protease (Mpro) is essential for viral replication and has been a primary target for antiviral drug development. We present the crystal structure of Mpro bound to PF-07321332 (nirmatrelvir) at 2.10 Å resolution, revealing key interactions that underlie its potent inhibitory activity. Structure-activity relationship analysis provides a framework for next-generation protease inhibitors.', doi: '10.1016/j.cell.2024.11.032' },
    { pubmedId: '38945678', title: 'High-resolution cryo-EM structure of the human mitochondrial ribosome reveals translational regulation mechanisms', authors: 'Brown A, Amunts A, Ramakrishnan V', journal: 'Nature Structural & Molecular Biology', pubYear: '2025', abstract: 'Mitochondrial ribosomes are specialized translation machines that synthesize core components of the oxidative phosphorylation system. We present the cryo-EM structure of the human mitochondrial large ribosomal subunit at 2.85 Å resolution, revealing unique features including mitochondria-specific proteins and rRNA modifications that regulate translation.', doi: '10.1038/s41594-024-01412-5' },
    { pubmedId: '38956789', title: 'Solution NMR structure of the Z-alpha domain of human ADAR1 in complex with Z-DNA', authors: 'Schade M, Bhatt DM, Bhattacharyya D, Ha SC', journal: 'Proceedings of the National Academy of Sciences', pubYear: '2025', abstract: 'The Z-alpha domain of ADAR1 recognizes left-handed Z-DNA conformation. We determined the solution NMR structure of the Z-alpha domain bound to Z-DNA, providing dynamic insights into the conformational switch from B-DNA to Z-DNA and its implications for RNA editing regulation.', doi: '10.1073/pnas.2410987121' },
    { pubmedId: '38967890', title: 'High-resolution structure of Thermus thermophilus RNA polymerase open complex reveals transcription initiation mechanism', authors: 'Murakami KS, Masuda S, Darst SA', journal: 'eLife', pubYear: '2025', abstract: 'Transcription initiation requires RNA polymerase to form an open complex on promoter DNA. We present the 1.45 Å resolution crystal structure of Thermus thermophilus RNA polymerase in the open complex state, revealing how the enzyme melts DNA and positions the template strand in the active site.', doi: '10.7554/eLife.87654' },
    { pubmedId: '38978901', title: 'Cryo-EM structure of the human GABA-A receptor in a lipid nanodisc reveals lipid modulation of channel function', authors: 'Laverty D, Desai R, Uchanski T, Bhatt DK', journal: 'Nature', pubYear: '2025', abstract: 'GABA-A receptors are ligand-gated ion channels that mediate inhibitory neurotransmission. We report the cryo-EM structure of the human α1β2γ2 GABA-A receptor reconstituted in a lipid nanodisc at 3.45 Å resolution. The structure reveals how membrane lipids modulate channel conformation and pharmacology, providing insights for drug design.', doi: '10.1038/s41586-024-07921-4' },
    { pubmedId: '38989012', title: 'Crystal structure of Escherichia coli DNA gyrase A C-terminal domain provides insights into DNA wrapping', authors: 'Vos SM, Tretter EM, Schmidt BH, Berger JM', journal: 'Nucleic Acids Research', pubYear: '2025', abstract: 'DNA gyrase introduces negative supercoils into DNA through a unique wrapping mechanism. We present the crystal structure of the E. coli GyrA C-terminal domain at 2.35 Å resolution, revealing the structural basis for DNA wrapping and its role in the supercoiling cycle.', doi: '10.1093/nar/gkae1234' },
    { pubmedId: '38990123', title: 'Structure of the human spliceosome post-catalytic P complex reveals exon ligation mechanism', authors: 'Zhang X, Zhan X, Yan C, Shi Y', journal: 'Science', pubYear: '2025', abstract: 'The spliceosome catalyzes pre-mRNA splicing through two transesterification reactions. We present the cryo-EM structure of the human spliceosome post-catalytic P complex at 2.60 Å resolution, capturing the state immediately after exon ligation. The structure reveals how the 3\' splice site is positioned for catalysis and how the ligated exon is released.', doi: '10.1126/science.ado4567' },
    { pubmedId: '39001234', title: 'Solution NMR structure of the PH domain of human AKT1 kinase reveals membrane binding dynamics', authors: 'Parikh HI, Ghosh RP', journal: 'Journal of the American Chemical Society', pubYear: '2025', abstract: 'The pleckstrin homology (PH) domain of AKT1 mediates membrane localization through phosphoinositide binding. We determined the solution NMR structure of the AKT1 PH domain, revealing conformational dynamics that regulate membrane association and kinase activation.', doi: '10.1021/jacs.4c12345' },
    { pubmedId: '39012345', title: 'Crystal structure of the human CDK2-cyclin A complex with the inhibitor roscovitine reveals selectivity determinants', authors: 'Davies TG, Bentley J, Arris CE', journal: 'Molecular Cell', pubYear: '2025', abstract: 'CDK2-cyclin A is a key regulator of cell cycle progression and a target for anticancer therapy. We present the crystal structure of CDK2-cyclin A bound to roscovitine at 1.92 Å resolution, revealing the molecular basis for inhibitor selectivity and providing a framework for the design of CDK2-specific therapeutics.', doi: '10.1016/j.molcel.2024.11.008' },
    { pubmedId: '39023456', title: 'Cryo-EM structure of the human autophagy initiation complex reveals ULK1 activation mechanism', authors: 'Fujioka Y, Suzuki SW, Yamamoto H', journal: 'Nature Structural & Molecular Biology', pubYear: '2025', abstract: 'The ULK1-ATG13 complex initiates autophagy in response to nutrient deprivation. We report the cryo-EM structure of the human ULK1-ATG13 complex at 3.70 Å resolution, revealing how ATG13 stabilizes ULK1 and promotes its kinase activity through conformational rearrangements.', doi: '10.1038/s41594-024-01389-2' },
    { pubmedId: '39034567', title: 'Structure-based design of Plasmodium falciparum dihydroorotate dehydrogenase inhibitors with improved antimalarial activity', authors: 'Coteron JM, Catterick D, Castro J', journal: 'Journal of Medicinal Chemistry', pubYear: '2025', abstract: 'Plasmodium falciparum dihydroorotate dehydrogenase (PfDHODH) is a validated antimalarial drug target. We report the crystal structure of PfDHODH with a novel series of inhibitors at 2.55 Å resolution and describe structure-activity relationships that guide the optimization of antimalarial potency and selectivity.', doi: '10.1021/acs.jmedchem.4c02345' },
    { pubmedId: '39045678', title: 'NMR structure of the p53 DNA-binding domain in complex with its response element reveals transcription factor dynamics', authors: 'Weinreb PH, Li Y, Jin L', journal: 'Nature Communications', pubYear: '2025', abstract: 'p53 is a tumor suppressor that regulates transcription of genes involved in cell cycle arrest and apoptosis. We present the solution NMR structure of the p53 DNA-binding domain bound to its response element, providing dynamic insights into transcription factor recognition and the effects of cancer-associated mutations.', doi: '10.1038/s41467-024-54321-8' },
    { pubmedId: '39056789', title: 'Crystal structure of the catalytic domain of human MMP-13 with a selective inhibitor provides insights into collagenase inhibition', authors: 'Roth J, Bhatt DK, Wilson K', journal: 'Journal of Molecular Biology', pubYear: '2025', abstract: 'Matrix metalloproteinase-13 (MMP-13) is a collagenase implicated in osteoarthritis and cancer metastasis. We present the crystal structure of MMP-13 with a selective inhibitor at 1.65 Å resolution, revealing unique interactions in the S1\' specificity pocket that enable isoform selectivity.', doi: '10.1016/j.jmb.2024.167890' },
    { pubmedId: '39067890', title: 'Structural basis for GPCR-G protein coupling selectivity in the adrenergic receptor family', authors: 'Rasmussen SGF, DeVree BT, Zou Y, Bhatt DK', journal: 'Nature', pubYear: '2024', abstract: 'G protein-coupled receptors (GPCRs) selectively couple to specific G protein subtypes, but the structural determinants of this selectivity remain incompletely understood. We present cryo-EM structures of β1-adrenergic and β2-adrenergic receptors in complex with Gs and Gi proteins, revealing how subtle differences in the receptor intracellular surface dictate coupling selectivity.', doi: '10.1038/s41586-024-07456-3' },
    { pubmedId: '39078901', title: 'Cryo-EM structure of the human ATP synthase in the rotated state reveals rotary catalysis mechanism', authors: 'Murphy BJ, Klusch N, Bhatt DK, Kuhlbrandt W', journal: 'Science', pubYear: '2024', abstract: 'F-type ATP synthase produces ATP through rotary catalysis driven by the proton-motive force. We report the cryo-EM structure of human ATP synthase in a rotated state at 3.2 Å resolution, capturing the central stalk in a novel conformation that provides mechanistic insights into torque generation and ATP synthesis.', doi: '10.1126/science.adp6789' },
    { pubmedId: '39089012', title: 'Alphafold3 predictions of protein-ligand complexes achieve experimental accuracy for drug design', authors: 'Abramson J, Adler J, Dunger J, Evans R', journal: 'Nature', pubYear: '2024', abstract: 'We present AlphaFold3, which extends protein structure prediction to protein-ligand complexes with near-experimental accuracy. Benchmarking against the PDB shows that AlphaFold3 correctly predicts ligand binding poses for 78% of test cases, representing a significant advance for structure-based drug design.', doi: '10.1038/s41586-024-07487-9' },
    { pubmedId: '39090123', title: 'Structure of the human DNA-PK holoenzyme reveals assembly and activation mechanisms for DNA repair', authors: 'Sibanda BL, Chirgadze DY, Bhatt DK, Blundell TL', journal: 'Cell', pubYear: '2024', abstract: 'DNA-dependent protein kinase (DNA-PK) is essential for non-homologous end joining in DNA double-strand break repair. We present the cryo-EM structure of the DNA-PK holoenzyme at 3.5 Å resolution, revealing how Ku70/80 recruits and activates the DNA-PKcs catalytic subunit upon DNA binding.', doi: '10.1016/j.cell.2024.09.012' },
    { pubmedId: '39101234', title: 'Structural basis for the recognition of nucleosomes by chromatin remodeling complexes', authors: 'Ayala R, Willhoft O, Bhatt DK, Scheres SHW', journal: 'Nature Structural & Molecular Biology', pubYear: '2024', abstract: 'Chromatin remodeling complexes reposition nucleosomes to regulate DNA accessibility. We report the cryo-EM structure of the human ISWI remodeler in complex with a nucleosome, revealing how the remodeler engages both the nucleosomal DNA and the H4 tail to catalyze nucleosome sliding.', doi: '10.1038/s41594-024-01345-7' },
  ]
  for (const article of pubMedArticles) {
    await prisma.pubMedArticle.create({ data: article })
  }
  console.log(`Created ${pubMedArticles.length} PubMed articles`)

  console.log('\n✅ Seeding complete!')
  console.log(`  - ${pdbStructures.length} PDB structures with chains and entities`)
  console.log(`  - ${weeklySnapshots.length} weekly snapshots`)
  console.log(`  - ${weeklyReports.length} weekly reports`)
  console.log(`  - ${evaluations.length} evaluations with PDB structures and BLAST results`)
  console.log(`  - 2 evaluation batches`)
  console.log(`  - ${pubMedArticles.length} PubMed articles`)
  console.log(`  - ${ligands.length} ligands`)
}

main()
  .catch((e) => {
    console.error('Seed error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
