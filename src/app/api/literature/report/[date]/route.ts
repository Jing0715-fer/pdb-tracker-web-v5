import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { safeJsonParse } from '@/lib/utils';
import { decodeJsonEscapes } from '@/lib/pdb-utils';
import {
  combineDate,
  monthDigitToName,
  buildJournalLookup,
  matchJournalIf,
} from '@/lib/journal-matching';


export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  try {
    const { date } = await params;

    const parts = date.split('-');
    const year = parts[0];
    const month = parts[1];
    const day = parts[2];

    let where = 'WHERE a.pubYear = ?';
    const qp: any[] = [year];
    if (month) {
      // month is '01'..'12' from the URL; reverse-map to 'Jan'..'Dec' so we
      // match DB rows where pubMonth is stored as either a name or a digit.
      // monthDigitToName() is the single source of truth for the reverse map.
      const monthAlpha = monthDigitToName(month);
      if (monthAlpha !== month) {
        where += ' AND (a.pubMonth = ? OR a.pubMonth = ?)';
        qp.push(month, monthAlpha);
      } else {
        where += ' AND a.pubMonth = ?';
        qp.push(month);
      }
    }
    if (day) { where += ' AND a.pubDay = ?'; qp.push(day); }

    const articles = await db.$queryRawUnsafe<any[]>(
      `SELECT a.* FROM PubMedArticle a ${where} ORDER BY a.createdAt DESC`,
      ...qp
    );

    const pubmedIds = articles.map((a: any) => a.pubmedId).filter(Boolean);
    const pdbMap: Record<string, any[]> = {};
    const paperIfMap: Record<string, number | null> = {};

    if (pubmedIds.length > 0) {
      const placeholders = pubmedIds.map(() => '?').join(',');
      const pdbRows = await db.$queryRawUnsafe<any[]>(
        `SELECT pubmedId, pdbId, method, resolution, journalIf FROM PdbStructure WHERE pubmedId IN (${placeholders})`,
        ...pubmedIds
      );
      for (const row of pdbRows) {
        const pmid = row.pubmedId as string;
        if (!pdbMap[pmid]) pdbMap[pmid] = [];
        pdbMap[pmid].push({
          pdbId: row.pdbId,
          method: row.method || null,
          resolution: row.resolution ?? null,
        });
        if (paperIfMap[pmid] === undefined && row.journalIf != null) {
          paperIfMap[pmid] = row.journalIf;
        }
      }
    }

    // For papers without PDB match, try journal name → IF lookup via the
    // shared matcher (buildJournalLookup + matchJournalIf).
    const needsJournalMatch = articles.some(
      (a: any) => paperIfMap[a.pubmedId] === undefined && a.journal
    );
    if (needsJournalMatch) {
      const ifRows = await db.$queryRawUnsafe<any[]>(
        `SELECT DISTINCT journal, journalIf FROM PdbStructure WHERE journalIf IS NOT NULL AND journalIf > 0`
      );
      const { journalIfMap, pdbJournals } = buildJournalLookup(
        ifRows as { journal: string; journalIf: number | null }[]
      );
      for (const a of articles) {
        if (paperIfMap[a.pubmedId] === undefined && a.journal) {
          paperIfMap[a.pubmedId] = matchJournalIf(a.journal, journalIfMap, pdbJournals);
        }
      }
    }

    const papers = articles.map((a: any) => ({
      pmid: a.pubmedId,
      title: decodeJsonEscapes(a.title) || '',
      authors: decodeJsonEscapes(a.authors) || '',
      journal: a.journal || '',
      IF: paperIfMap[a.pubmedId] ?? null,
      pubdate: combineDate(a.pubYear, a.pubMonth, a.pubDay),
      abstract: decodeJsonEscapes(a.abstract) || '',
      abstractCn: '',
      doi: a.doi || '',
      pdbs: pdbMap[a.pubmedId] || [],
    }));

    return NextResponse.json(safeJsonParse({
      date,
      paperCount: papers.length,
      papers,
      title: `Literature Report - ${date}`,
    }));
  } catch (error) {
    console.error('Error fetching literature report by date:', error);
    return NextResponse.json({ error: 'Failed to fetch literature report' }, { status: 500 });
  }
}
