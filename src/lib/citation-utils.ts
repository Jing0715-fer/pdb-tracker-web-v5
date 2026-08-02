import type { LitPaper } from '@/lib/pdb-types';

/**
 * Generate a citation key for BibTeX from author and year.
 * e.g. "Shimada2025" from first author surname + year
 */
function citationKey(paper: LitPaper): string {
  const year = extractYear(paper.pubdate);
  const firstAuthor = paper.authors?.split(',')[0]?.trim() || 'Unknown';
  // Take last word of first author as surname
  const surname = firstAuthor.split(' ').pop() || firstAuthor;
  // Remove non-alphanumeric
  const cleanSurname = surname.replace(/[^a-zA-Z0-9]/g, '');
  return `${cleanSurname}${year}`;
}

/**
 * Extract year from pubdate string (e.g. "2025-01-15" → "2025")
 */
function extractYear(pubdate: string): string {
  if (!pubdate) return '';
  const match = pubdate.match(/\d{4}/);
  return match ? match[0] : '';
}

/**
 * Parse authors string into array of "Last, First" format.
 * Handles: "Shimada S, Bhat A, Smith JR" → ["Shimada, S.", "Bhat, A.", "Smith, J. R."]
 */
function parseAuthors(authors: string): string[] {
  if (!authors) return [];
  return authors.split(/,\s*(?=[A-Z])/).map(a => {
    const trimmed = a.trim();
    if (!trimmed) return '';
    // If already "Last, First" format, keep as is
    if (trimmed.includes(',')) return trimmed;
    // Otherwise, split on last space to get "Last, First"
    const lastSpace = trimmed.lastIndexOf(' ');
    if (lastSpace > 0) {
      return `${trimmed.substring(0, lastSpace)}, ${trimmed.substring(lastSpace + 1)}`;
    }
    return trimmed;
  }).filter(Boolean);
}

/**
 * Generate BibTeX citation string.
 *
 * @example
 * ```bibtex
 * @article{Shimada2025,
 *   author = {Shimada, S. and Bhat, A.},
 *   title = {Ultra-high-resolution cytochrome c oxidase reveals proton pumping pathway},
 *   journal = {Science},
 *   year = {2025},
 *   volume = {},
 *   pages = {},
 *   doi = {10.1126/science.xxxx},
 *   pmid = {39120001}
 * }
 * ```
 */
export function generateBibTeX(paper: LitPaper): string {
  const key = citationKey(paper);
  const year = extractYear(paper.pubdate);
  const authorList = parseAuthors(paper.authors);
  const bibtexAuthors = authorList.join(' and ');

  const lines: string[] = [
    `@article{${key},`,
    `  author = {${bibtexAuthors}},`,
    `  title = {${paper.title || ''}},`,
    `  journal = {${paper.journal || ''}},`,
    `  year = {${year}},`,
    `  volume = {},`,
    `  pages = {},`,
  ];

  if (paper.doi) {
    lines.push(`  doi = {${paper.doi}},`);
  }
  if (paper.pmid) {
    lines.push(`  pmid = {${paper.pmid}},`);
  }

  lines.push('}');
  return lines.join('\n');
}

/**
 * Generate RIS citation string.
 *
 * @example
 * ```
 * TY  - JOUR
 * AU  - Shimada, S.
 * AU  - Bhat, A.
 * TI  - Ultra-high-resolution cytochrome c oxidase reveals proton pumping pathway
 * JO  - Science
 * PY  - 2025
 * DO  - 10.1126/science.xxxx
 * M3  - PMID: 39120001
 * ER  - 
 * ```
 */
export function generateRIS(paper: LitPaper): string {
  const year = extractYear(paper.pubdate);
  const authorList = parseAuthors(paper.authors);

  const lines: string[] = ['TY  - JOUR'];

  for (const author of authorList) {
    lines.push(`AU  - ${author}`);
  }

  lines.push(`TI  - ${paper.title || ''}`);
  lines.push(`JO  - ${paper.journal || ''}`);

  if (year) {
    lines.push(`PY  - ${year}`);
  }

  if (paper.doi) {
    lines.push(`DO  - ${paper.doi}`);
  }

  if (paper.pmid) {
    lines.push(`M3  - PMID: ${paper.pmid}`);
  }

  lines.push('ER  - ');

  return lines.join('\n');
}

/**
 * Generate APA 7th edition citation string.
 *
 * Format: Author, A. A., & Author, B. B. (Year). Title of article. Title of Journal, volume(issue), pages. https://doi.org/xxxxx
 */
export function generateAPA(paper: LitPaper): string {
  const year = extractYear(paper.pubdate);
  const authorList = parseAuthors(paper.authors);

  let authorStr = '';
  if (authorList.length === 0) {
    authorStr = 'Unknown';
  } else if (authorList.length === 1) {
    authorStr = authorList[0];
  } else if (authorList.length === 2) {
    authorStr = `${authorList[0]} & ${authorList[1]}`;
  } else if (authorList.length <= 20) {
    authorStr = authorList.slice(0, -1).join(', ') + ', & ' + authorList[authorList.length - 1];
  } else {
    // More than 20 authors: first 19 ... last
    authorStr = authorList.slice(0, 19).join(', ') + ', ... ' + authorList[authorList.length - 1];
  }

  const title = paper.title || '';
  const journal = paper.journal || '';
  const doi = paper.doi ? ` https://doi.org/${paper.doi}` : '';
  const pmid = paper.pmid ? ` PMID: ${paper.pmid}` : '';

  return `${authorStr} (${year}). ${title}. ${journal}.${doi}${pmid}`;
}

/**
 * Generate MLA 9th edition citation string.
 *
 * Format: Author, A. A., and B. B. Author. "Title." Journal, vol. Volume, no. Issue, Year, pp. Pages. DOI.
 */
export function generateMLA(paper: LitPaper): string {
  const year = extractYear(paper.pubdate);
  const authorList = parseAuthors(paper.authors);

  let authorStr = '';
  if (authorList.length === 0) {
    authorStr = 'Unknown';
  } else if (authorList.length === 1) {
    authorStr = authorList[0];
  } else if (authorList.length === 2) {
    authorStr = `${authorList[0]}, and ${authorList[1]}`;
  } else {
    authorStr = authorList[0] + ', et al';
  }

  const title = paper.title || '';
  const journal = paper.journal || '';
  const doi = paper.doi ? ` https://doi.org/${paper.doi}` : '';

  return `${authorStr}. "${title}." ${journal}, ${year}.${doi}`;
}

/**
 * Generate Vancouver/ICMJE citation string.
 *
 * Format: Author AA, Author BB. Title of article. Title of Journal. Year;volume(issue):pages.
 */
export function generateVancouver(paper: LitPaper): string {
  const year = extractYear(paper.pubdate);
  const authorList = parseAuthors(paper.authors);

  // Vancouver: initials without periods, surname first
  const vancouverAuthors = authorList.map(a => {
    if (a.includes(',')) {
      const parts = a.split(',');
      const surname = parts[0].trim();
      const initials = (parts[1] || '').trim()
        .split(/\s+/)
        .map(n => n.charAt(0).toUpperCase())
        .join('');
      return `${surname} ${initials}`;
    }
    return a;
  });

  let authorStr = '';
  if (vancouverAuthors.length === 0) {
    authorStr = 'Unknown';
  } else if (vancouverAuthors.length <= 6) {
    authorStr = vancouverAuthors.join(', ');
  } else {
    authorStr = vancouverAuthors.slice(0, 6).join(', ') + ', et al';
  }

  const title = paper.title || '';
  const journal = paper.journal || '';
  const doi = paper.doi ? ` doi: ${paper.doi}` : '';
  const pmid = paper.pmid ? ` PMID: ${paper.pmid}` : '';

  return `${authorStr}. ${title}. ${journal}. ${year}.${doi}${pmid}`;
}

/**
 * Download a file using the browser's download API.
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Generate combined BibTeX for multiple papers.
 */
export function generateBatchBibTeX(papers: LitPaper[]): string {
  return papers.map(p => generateBibTeX(p)).join('\n\n');
}

/**
 * Generate combined RIS for multiple papers.
 */
export function generateBatchRIS(papers: LitPaper[]): string {
  return papers.map(p => generateRIS(p)).join('\n\n');
}

/**
 * Generate CSV content for papers.
 */
export function generateCSV(papers: LitPaper[]): string {
  const headers = ['PMID', 'Title', 'Authors', 'Journal', 'IF', 'Date', 'DOI', 'PDB Structures', 'Keywords'];
  const rows = papers.map(p => [
    p.pmid,
    `"${(p.title || '').replace(/"/g, '""')}"`,
    `"${(p.authors || '').replace(/"/g, '""')}"`,
    `"${(p.journal || '').replace(/"/g, '""')}"`,
    p.IF != null ? p.IF.toString() : '',
    p.pubdate || '',
    p.doi || '',
    p.pdbs.map(pd => pd.pdbId).join('; '),
    (p.keywords || []).join('; '),
  ].join(','));

  return [headers.join(','), ...rows].join('\n');
}
