import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ─── Simple CSV Parser (server-side) ───────────────────────────────────────────

function parseCsv(text: string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  if (!text || !text.trim()) return rows;

  const cells: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          currentCell += '"';
          i += 2;
          continue;
        } else {
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
      currentRow.push(currentCell);
      currentCell = '';
      cells.push(currentRow);
      currentRow = [];
      i += (i + 1 < text.length && text[i + 1] === '\n') ? 2 : 1;
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

  if (currentCell !== '' || currentRow.length > 0) {
    currentRow.push(currentCell);
    cells.push(currentRow);
  }

  if (cells.length < 2) return rows;

  const headers = cells[0].map(h => h.trim());
  for (let r = 1; r < cells.length; r++) {
    const row = cells[r];
    if (row.length === 1 && row[0].trim() === '') continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = c < row.length ? row[c].trim() : '';
    }
    rows.push(obj);
  }

  return rows;
}

// ─── Import PDB Structures ─────────────────────────────────────────────────────

async function importPdbStructures(
  records: Record<string, string>[]
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const record of records) {
    const pdbId = record.pdbId?.trim();
    if (!pdbId) {
      errors.push(`Missing pdbId in row: ${JSON.stringify(record).slice(0, 100)}`);
      skipped++;
      continue;
    }

    try {
      // Parse numeric fields
      const resolution = record.resolution ? parseFloat(record.resolution) : null;
      const journalIf = record.journalIf ? parseFloat(record.journalIf) : null;

      await db.pdbStructure.upsert({
        where: { pdbId },
        update: {
          method: record.method || undefined,
          resolution: isNaN(resolution ?? NaN) ? undefined : resolution,
          title: record.title || undefined,
          organisms: record.organism || undefined,
          journal: record.journal || undefined,
          journalIf: isNaN(journalIf ?? NaN) ? undefined : journalIf,
          weekId: record.weekId || undefined,
          releaseDate: record.releaseDate || undefined,
          doi: record.doi || undefined,
          pubmedId: record.pubmedId || undefined,
          ligands: record.ligands || undefined,
        },
        create: {
          pdbId,
          method: record.method || null,
          resolution: isNaN(resolution ?? NaN) ? null : resolution,
          title: record.title || null,
          organisms: record.organism || null,
          journal: record.journal || null,
          journalIf: isNaN(journalIf ?? NaN) ? null : journalIf,
          weekId: record.weekId || null,
          releaseDate: record.releaseDate || null,
          doi: record.doi || null,
          pubmedId: record.pubmedId || null,
          ligands: record.ligands || null,
        },
      });
      imported++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`PDB ${pdbId}: ${msg}`);
      skipped++;
    }
  }

  return { imported, skipped, errors };
}

// ─── Import PubMed Articles ────────────────────────────────────────────────────

async function importPubMedArticles(
  records: Record<string, string>[]
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const record of records) {
    const pubmedId = record.pubmedId?.trim();
    if (!pubmedId) {
      errors.push(`Missing pubmedId in row: ${JSON.stringify(record).slice(0, 100)}`);
      skipped++;
      continue;
    }

    try {
      await db.pubMedArticle.upsert({
        where: { pubmedId },
        update: {
          title: record.title || undefined,
          authors: record.authors || undefined,
          abstract: record.abstract || undefined,
          journal: record.journal || undefined,
          pubYear: record.pubYear || undefined,
          doi: record.doi || undefined,
        },
        create: {
          pubmedId,
          title: record.title || null,
          authors: record.authors || null,
          abstract: record.abstract || null,
          journal: record.journal || null,
          pubYear: record.pubYear || null,
          doi: record.doi || null,
        },
      });
      imported++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`PubMed ${pubmedId}: ${msg}`);
      skipped++;
    }
  }

  return { imported, skipped, errors };
}

// ─── POST Handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const importType = formData.get('type') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!importType || !['pdb', 'pubmed'].includes(importType)) {
      return NextResponse.json({ error: 'Invalid import type. Must be "pdb" or "pubmed"' }, { status: 400 });
    }

    const text = await file.text();
    if (!text.trim()) {
      return NextResponse.json({ error: 'File is empty' }, { status: 400 });
    }

    // Parse based on file extension
    const filename = file.name.toLowerCase();
    let records: Record<string, string>[];

    if (filename.endsWith('.json')) {
      try {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) {
          return NextResponse.json({ error: 'JSON file must contain an array of objects' }, { status: 400 });
        }
        // Convert JSON objects to string-valued records
        records = parsed.map((obj: Record<string, unknown>) => {
          const row: Record<string, string> = {};
          for (const [key, value] of Object.entries(obj)) {
            row[key] = value == null ? '' : String(value);
          }
          return row;
        });
      } catch {
        return NextResponse.json({ error: 'Invalid JSON format' }, { status: 400 });
      }
    } else if (filename.endsWith('.csv')) {
      records = parseCsv(text);
    } else {
      return NextResponse.json({ error: 'Unsupported file format. Use .csv or .json' }, { status: 400 });
    }

    if (records.length === 0) {
      return NextResponse.json({ error: 'No data rows found in file' }, { status: 400 });
    }

    // Validate required fields
    if (importType === 'pdb') {
      const missingPdbId = records.filter(r => !r.pdbId?.trim());
      if (missingPdbId.length > 0) {
        return NextResponse.json(
          { error: `${missingPdbId.length} row(s) missing required field "pdbId"` },
          { status: 400 }
        );
      }
      const result = await importPdbStructures(records);
      return NextResponse.json(result);
    } else {
      const missingPmid = records.filter(r => !r.pubmedId?.trim());
      if (missingPmid.length > 0) {
        return NextResponse.json(
          { error: `${missingPmid.length} row(s) missing required field "pubmedId"` },
          { status: 400 }
        );
      }
      const result = await importPubMedArticles(records);
      return NextResponse.json(result);
    }
  } catch (err) {
    console.error('Import error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
