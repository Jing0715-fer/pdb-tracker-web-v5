/**
 * Import Utilities — Template generation, CSV parsing, and file download helpers
 */

// ─── CSV Parser ────────────────────────────────────────────────────────────────

/**
 * Simple CSV parser that handles:
 * - Comma-separated values
 * - Double-quoted fields (with commas inside)
 * - Newline within quoted fields
 * - Escaped double-quotes (doubled: "")
 */
export function parseCsvFile(text: string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  if (!text || !text.trim()) return rows;

  // Parse into a 2D array of cell values
  const cells: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // Check for escaped quote ""
        if (i + 1 < text.length && text[i + 1] === '"') {
          currentCell += '"';
          i += 2;
          continue;
        } else {
          // End of quoted field
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentCell += ch;
        i++;
        continue;
      }
    }

    // Not in quotes
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    } else if (ch === ',') {
      currentRow.push(currentCell);
      currentCell = '';
      i++;
      continue;
    } else if (ch === '\r') {
      // Handle \r\n or lone \r
      currentRow.push(currentCell);
      currentCell = '';
      cells.push(currentRow);
      currentRow = [];
      if (i + 1 < text.length && text[i + 1] === '\n') {
        i += 2;
      } else {
        i++;
      }
      continue;
    } else if (ch === '\n') {
      currentRow.push(currentCell);
      currentCell = '';
      cells.push(currentRow);
      currentRow = [];
      i++;
      continue;
    } else {
      currentCell += ch;
      i++;
      continue;
    }
  }

  // Push remaining cell/row
  if (currentCell !== '' || currentRow.length > 0) {
    currentRow.push(currentCell);
    cells.push(currentRow);
  }

  if (cells.length < 2) return rows; // Need at least header + 1 row

  // First row is the header
  const headers = cells[0].map(h => h.trim());
  for (let r = 1; r < cells.length; r++) {
    const row = cells[r];
    // Skip empty rows
    if (row.length === 1 && row[0].trim() === '') continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = c < row.length ? row[c].trim() : '';
    }
    rows.push(obj);
  }

  return rows;
}

// ─── File Download Helper ──────────────────────────────────────────────────────

export function downloadFile(content: string, filename: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Template Generators ───────────────────────────────────────────────────────

export function generatePdbCsvTemplate(): string {
  const headers = [
    'pdbId', 'method', 'resolution', 'title', 'organism',
    'journal', 'journalIf', 'weekId', 'releaseDate', 'doi',
    'pubmedId', 'ligands',
  ];
  const rows = [
    [
      '7ABC', 'X-RAY DIFFRACTION', '2.10',
      'Crystal structure of BRCA1 RING domain',
      'Homo sapiens', 'Nature', '64.8',
      '2025-W09', '2025-02-28', '10.1038/s41586-025-00001-x',
      '39130001', 'ATP;MG',
    ],
    [
      '8XYZ', 'CRYO-EM', '3.50',
      'Cryo-EM structure of mTORC1 complex',
      'Mus musculus', 'Science', '56.9',
      '2025-W09', '2025-02-28', '10.1126/science.abc1234',
      '39130002', 'GTP;MN',
    ],
  ];
  const allRows = [headers, ...rows];
  return allRows.map(row =>
    row.map(cell => {
      // Quote cells that contain commas or quotes
      if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
        return `"${cell.replace(/"/g, '""')}"`;
      }
      return cell;
    }).join(',')
  ).join('\n');
}

export function generatePdbJsonTemplate(): string {
  const data = [
    {
      pdbId: '7ABC',
      method: 'X-RAY DIFFRACTION',
      resolution: 2.1,
      title: 'Crystal structure of BRCA1 RING domain',
      organism: 'Homo sapiens',
      journal: 'Nature',
      journalIf: 64.8,
      weekId: '2025-W09',
      releaseDate: '2025-02-28',
      doi: '10.1038/s41586-025-00001-x',
      pubmedId: '39130001',
      ligands: 'ATP;MG',
    },
    {
      pdbId: '8XYZ',
      method: 'CRYO-EM',
      resolution: 3.5,
      title: 'Cryo-EM structure of mTORC1 complex',
      organism: 'Mus musculus',
      journal: 'Science',
      journalIf: 56.9,
      weekId: '2025-W09',
      releaseDate: '2025-02-28',
      doi: '10.1126/science.abc1234',
      pubmedId: '39130002',
      ligands: 'GTP;MN',
    },
  ];
  return JSON.stringify(data, null, 2);
}

export function generatePubMedCsvTemplate(): string {
  const headers = [
    'pubmedId', 'title', 'authors', 'abstract',
    'journal', 'journalIf', 'pubYear', 'doi',
  ];
  const rows = [
    [
      '39130003',
      'Structural basis for BRCA1-mediated DNA repair',
      'Smith J, Doe A, Lee B',
      'We present the crystal structure of the BRCA1 RING domain in complex with BARD1, revealing key interactions for DNA damage repair.',
      'Nature', '64.8', '2025', '10.1038/s41586-025-00003-x',
    ],
    [
      '39130004',
      'Cryo-EM analysis of the mTOR signaling complex',
      'Zhang Y, Wang L, Chen M',
      'Using single-particle cryo-EM, we determined the structure of mTORC1 at 3.5 angstrom resolution, providing insights into rapamycin inhibition.',
      'Science', '56.9', '2025', '10.1126/science.def5678',
    ],
  ];
  const allRows = [headers, ...rows];
  return allRows.map(row =>
    row.map(cell => {
      if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
        return `"${cell.replace(/"/g, '""')}"`;
      }
      return cell;
    }).join(',')
  ).join('\n');
}

export function generatePubMedJsonTemplate(): string {
  const data = [
    {
      pubmedId: '39130003',
      title: 'Structural basis for BRCA1-mediated DNA repair',
      authors: 'Smith J, Doe A, Lee B',
      abstract: 'We present the crystal structure of the BRCA1 RING domain in complex with BARD1, revealing key interactions for DNA damage repair.',
      journal: 'Nature',
      journalIf: 64.8,
      pubYear: '2025',
      doi: '10.1038/s41586-025-00003-x',
    },
    {
      pubmedId: '39130004',
      title: 'Cryo-EM analysis of the mTOR signaling complex',
      authors: 'Zhang Y, Wang L, Chen M',
      abstract: 'Using single-particle cryo-EM, we determined the structure of mTORC1 at 3.5 angstrom resolution, providing insights into rapamycin inhibition.',
      journal: 'Science',
      journalIf: 56.9,
      pubYear: '2025',
      doi: '10.1126/science.def5678',
    },
  ];
  return JSON.stringify(data, null, 2);
}
