import { combineSignals } from './blast';

const SEARCH_URL = 'https://search.rcsb.org/rcsbsearch/v2/query';
const DATA_URL = 'https://data.rcsb.org/rest/v1/core/entry';
export interface PdbEntryDetail {
  pdbId: string; method: string | null; resolution: number | null; title: string | null;
  authors: string | null; journal: string | null; journalIf: number | null; doi: string | null;
  pubmedId: string | null; releaseDate: string | null; depositDate: string | null;
  organisms: string | null; ligands: string | null;
}
export async function fetchWeeklyPdbIds(startDate: string, endDate: string, max = 1000): Promise<string[]> {
  const body = { query: { type: 'terminal', service: 'text', parameters: { attribute: 'rcsb_accession_info.initial_release_date', operator: 'range', value: { from: startDate, to: endDate } } }, return_type: 'entry', request_options: { paginate: { start: 0, rows: max }, sort: [{ sort_by: 'rcsb_accession_info.initial_release_date', direction: 'desc' }] } };
  try {
    const res = await fetch(SEARCH_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.result_set || []).map((r: any) => r.identifier);
  } catch { return []; }
}
export async function fetchPdbEntryDetail(pdbId: string, signal?: AbortSignal): Promise<PdbEntryDetail | null> {
  // R196: signal 透传（可选中止，不影响无 signal 的既有调用方）。
  const combo = combineSignals(signal, 10_000);
  try {
    const res = await fetch(`${DATA_URL}/${pdbId}`, { signal: combo.signal });
    if (!res.ok) return null;
    if (signal?.aborted) return null;
    const d = await res.json();
    const exptl = d.exptl || [];
    const method = exptl[0]?.method || null;
    const rcsbInfo = d.rcsb_entry_info || {};
    const resolutionArr = rcsbInfo.resolution_combined || [];
    const resolution = resolutionArr.length > 0 ? resolutionArr[0] : null;
    const accession = d.rcsb_accession_info || {};
    const cit = d.rcsb_primary_citation || {};
    const struct = d.struct || {};
    let organisms: string | null = null;
    try { const taxonomies = (d.rcsb_entity_source_organism || []) as any[]; const names = new Set<string>(); for (const t of taxonomies) { if (t.ncbi_scientific_name) names.add(t.ncbi_scientific_name); } if (names.size > 0) organisms = [...names].slice(0, 3).join('; '); } catch { /* ignore */ }
    let ligands: string | null = null;
    try { const nonpoly = (d.rcsb_nonpolymer_instance || []) as any[]; const names = new Set<string>(); for (const np of nonpoly) { const comp = np?.rcsb_nonpolymer_instance_container_details?.comp_id; if (comp) names.add(comp); } if (names.size > 0) ligands = [...names].slice(0, 5).join('; '); } catch { /* ignore */ }
    return { pdbId, method, resolution: typeof resolution === 'number' ? resolution : null, title: struct.title || null, authors: (cit.rcsb_authors || []).slice(0, 10).join(', ') || null, journal: cit.rcsb_journal_abbrev || null, journalIf: typeof cit.rcsb_journal_impact_factor === 'number' ? cit.rcsb_journal_impact_factor : null, doi: cit.pdbx_database_id_DOI || null, pubmedId: cit.pdbx_database_id_PubMed != null ? String(cit.pdbx_database_id_PubMed) : null, releaseDate: accession.initial_release_date ? accession.initial_release_date.slice(0, 10) : null, depositDate: accession.deposit_date ? accession.deposit_date.slice(0, 10) : null, organisms, ligands };
  } catch { return null; } finally { combo.dispose(); }
}
export async function fetchPdbEntryDetails(
  pdbIds: string[],
  max?: number,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal, // R196: 批间检查 + 逐条透传 —— 大批量（500 条/100 批）期间 Stop 即刻生效
): Promise<PdbEntryDetail[]> {
  const results: PdbEntryDetail[] = [];
  const ids = max ? pdbIds.slice(0, max) : pdbIds;
  const chunkSize = 5;
  for (let i = 0; i < ids.length; i += chunkSize) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError'); // R196
    const chunk = ids.slice(i, i + chunkSize);
    const details = await Promise.all(chunk.map(id => fetchPdbEntryDetail(id, signal)));
    for (const d of details) { if (d) results.push(d); }
    // R192: 每批完成回调一次 —— 大批量（maxPdb=500 → 100 批）此前全程
    // 静默数分钟，调用方借该回调向 SSE 发细分进度。回调异常不影响拉取。
    if (onProgress) {
      try { onProgress(Math.min(ids.length, i + chunkSize), ids.length); } catch { /* ignore */ }
    }
  }
  return results;
}
export async function fetchPdbIdsForUniprot(uniprotId: string, max = 80, signal?: AbortSignal): Promise<string[]> {
  const body = { query: { type: 'group', logical_operator: 'and', nodes: [{ type: 'terminal', service: 'text', parameters: { attribute: 'rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_accession', operator: 'exact_match', value: uniprotId } }] }, return_type: 'entry', request_options: { paginate: { start: 0, rows: max }, sort: [{ sort_by: 'rcsb_accession_info.initial_release_date', direction: 'desc' }] } };
  // R196: 单次重试 —— RCSB 偶发 503/网络抖动时旧版静默返回 []，整条评估
  // 降级为「0 直接命中 + BLAST 兜底 + 评分全 1」，重试一次即可消除该失败
  // 模式；非瞬态 HTTP（4xx）与解析失败不重试。signal 中止直接上抛。
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const combo = combineSignals(signal, 15_000);
    try {
      const res = await fetch(SEARCH_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: combo.signal });
      if (res.ok) {
        const data = await res.json();
        return (data.result_set || []).map((r: any) => r.identifier);
      }
      if (res.status < 500 && res.status !== 429) return []; // 非瞬态不重试
    } catch (err: any) {
      if (signal?.aborted || (err?.name === 'AbortError' && !/timeout/i.test(String(err?.message)))) throw err;
    } finally {
      combo.dispose();
    }
    if (attempt === 0) await new Promise(r => setTimeout(r, 1200));
  }
  return [];
}


export interface UniprotMeta {
  uniprotId: string;
  entryName: string;
  proteinName: string;
  geneNames: string;
  organism: string;
  sequenceLength: number;
  sequence?: string;
}

export async function fetchUniprotMeta(uniprotId: string, signal?: AbortSignal): Promise<UniprotMeta | null> {
  const combo = combineSignals(signal, 15_000);
  try {
    const url = `https://rest.uniprot.org/uniprotkb/${uniprotId}.json`;
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: combo.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const desc = data?.proteinDescription || {};
    const recName = desc?.recommendedName?.fullName?.value
      || desc?.submissionNames?.[0]?.fullName?.value
      || '';
    const altNames = (desc?.alternativeNames || []).map((a: any) => a?.fullName?.value).filter(Boolean);
    const geneNames = (data?.genes || []).map((g: any) => g?.geneName?.value).filter(Boolean);
    const organism = data?.organism?.names?.[0]?.value || '';
    const seqLen = data?.sequence?.length || 0;
    return {
      uniprotId,
      entryName: data?.primaryAccession || uniprotId,
      proteinName: recName || altNames[0] || uniprotId,
      geneNames: geneNames.join(', '),
      organism,
      sequenceLength: seqLen,
    };
  } catch (err: any) {
    if (signal?.aborted || err?.name === 'AbortError') throw err; // R196: Stop 上抛
    console.warn(`[fetchUniprotMeta] ${uniprotId} failed: ${err?.message}`);
    return null;
  } finally {
    combo.dispose();
  }
}
