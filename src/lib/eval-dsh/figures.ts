// src/lib/eval-dsh/figures.ts
//
// R179 (Task 2-a): DSH 模式配图管线 —— RCSB 结构图 + web 原理图/通路图
// + VLM 严格校验。原则：宁缺毋滥（figures are ALWAYS optional）。
//
// R184: 移除人为配额上限 ——
//   - RCSB：不再「全局最多 3 张」，改为多样性分桶（复合物/配体结合/apo/NMR
//     各取代表性结构，桶间去重），配图数量由代表性自然决定（典型 6-10 张）；
//     HEAD 预检改为并行（10 张以内并发开销可忽略）。
//   - web：不再「最多 2 个 query / 全报告最多 2 张通过」，改为相关性分析给
//     出的每个有配图价值的章节各搜一条（仅保留同一 query 内的近重复保护）；
//     总通过数不再设上限。
//   - VLM 校验仍逐张串行（峰值内存 = 单张图，与总量无关），质量门槛不变。
//
//   collectRcsbFigures()  RCSB CDN 结构图（assembly-1.jpeg，HEAD 预检）
//   searchWebFigures()    z-ai CLI image-search + VLM 判官（verdict/reason/caption）
//
// 每个 figure 都通过 emit({ ...ev, dshFigure }) 广播给前端；校验失败 /
// CLI 不可用 / 超时统统降级为零图继续，绝不 throw。

import type { SseEvent } from '@/lib/sse';
import type { PdbEntryDetail } from '@/lib/rcsb';
import { combineSignals } from '@/lib/blast'; // R197: Stop 信号与超时合并（与 blast/rcsb 同口径）

export interface ReportFigure {
  kind: 'rcsb' | 'web';
  url: string;
  caption: string;
  pdbId?: string;
  source?: string;
  sectionId: string;
  status: 'searching' | 'verified' | 'rejected' | 'failed';
  vlmReason?: string;
}

/** z-ai image-search CLI 的单次调用超时（宁缺毋滥：超时即放弃该 query）。 */
const IMAGE_SEARCH_TIMEOUT_MS = 150_000;
/** R193: 首次调用的独立短超时 —— CLI 冷启动挂死时 60s 即放弃，而非白等
 * 150s（R192 实测首查空转 55s；首查即失败说明 CLI 本身不可用，后续
 * query 逐条等满超时纯属浪费）。 */
const FIRST_QUERY_TIMEOUT_MS = 60_000;
/** 每个 query 最多送 VLM 校验的结果数（串行逐张，峰值内存 = 单张图）。 */
const RESULTS_PER_QUERY_CAP = 4; // R184: 3→4 — 移除总上限后每个 query 的通过机会更充裕
/**
 * R184: 同一 query 最多采用的图数（近重复保护 —— 同一搜索的候选图常常
 * 高度相似，取最佳 ≤2 张即可；全报告总通过数不再设上限）。
 */
const VERIFIED_PER_QUERY_CAP = 2;
/** R184: query 总数安全边界 —— 不再固定 2 条，但相关性分析的输出是 LLM
 * 产物，防刷量仍留一个宽松护栏（典型输出 2-6 条）。 */
const MAX_WEB_QUERIES = 8;
/** 图片下载上限（>3MB 直接拒绝 — 原理图/通路图几乎都 <1MB；大图多为照片，且
 *  base64+请求体会使峰值内存放大 ~4-5 倍，4GB 沙箱下 6MB 上限曾把 dev server 推到 OOM）。 */
const IMAGE_MAX_BYTES = 3 * 1024 * 1024;
const IMAGE_DOWNLOAD_TIMEOUT_MS = 20_000;
/** VLM 单次调用超时 + 重试次数。 */
const VLM_TIMEOUT_MS = 55_000;
const VLM_RETRIES = 1;

/** VLM 严格判官 prompt（中文，只收 JSON）。 */
const VLM_PROMPT = `你是一位严格的科研配图审稿人。请判断这张图片是否是一张真实的科学示意图（原理图/信号通路图/机制示意图/结构示意），并且与查询主题明确相关。

判定标准：
- 必须是科学示意图/通路图/机制图，而非实验照片、随机截图、广告图、人脸/风景图
- 图中内容与查询主题明确相关（而不是泛泛的生物图）
- 图片清晰可辨识

请只输出 JSON（不要输出任何其他内容）：
{"verdict":"relevant"|"irrelevant","reason":"一句话中文理由","caption":"给这张图的中文短标题（10-20字）"}`;

/**
 * R187: 蛋白-蛋白复合物标题判定 —— 修复「小分子复合物挤占复合物桶/错挂
 * interactions 章」。
 *
 * 旧版 COMPLEX_TITLE_RE 只匹配 complex/dimer/antibody 等词，但激酶域
 * 与小分子抑制剂的 PDB 标题几乎都写成 "kinase domain in complex with
 * <化学名>"（P00533 现场问题：8A27/8A2D/8A2A/6TFV 四张配体结构全部
 * 被当作「复合物」错挂到「分子相互作用与复合物」章，LLM 拒嵌后沦为
 * 附录专属图）。新判定分三档：
 *   1. 强信号（antibody/fab/scfv/nanobody/dimer/peptide 等）→ 蛋白复合物；
 *   2. 弱信号（in complex with X）→ 看 X 是否化学名特征（数字/括号密集
 *      或 inhibitor/compound/covalent 等提示词）→ 是则归配体态；
 *   3. 无信号 → 非复合物。
 */
const STRONG_COMPLEX_TITLE_RE = /\bantibody\b|\bfab\b|\bscfv\b|nanobody|\bdimer\b|\bheterodimer\b|\bhomodimer\b|\bpeptide\b|protein[- ]protein/i;
const WEAK_COMPLEX_TITLE_RE = /\bcomplex\b|\bcomplexed\b|in complex/i;
/** 弱信号标题中出现这些小分子提示词 → 按配体态处理（非蛋白复合物）。 */
const SMALL_MOLECULE_HINT_RE = /inhibitor|inhibitors|compound|fragment|agonist|antagonist|covalent|analog|analogue|derivative|warhead|scaffold/i;
/**
 * 药物代号/药名词形（R187b）：紧邻 "in complex with" 之前的词若命中 →
 * 标题实为「小分子 + 蛋白」复合物（药物写在前的新命名习惯，如
 * "BDTX-1535 in complex with WT EGFR" / "AZD3759 in complex with
 * wild-type EGFR" / "Alflutinib in complex with WT EGFR"）。蛋白名几乎
 * 不用「纯大写字母+数字」代号，也不以 -tinib/-parib 结尾。
 */
const DRUG_CODE_TOKEN_RE = /^[A-Z]{2,}-?\d{2,}[a-z]{0,2}$/;  // BDTX-1535 / AZD3759 / TAK-788 / YK-029a
const DRUG_SUFFIX_TOKEN_RE = /^(?:\w+)?tinib$|^(?:\w+)?parib$|^(?:\w+)?ciclib$/i; // Alflutinib / Limertinib / Poziotinib

/** 化学名特征：数字 ≥2 或含括号（如 2-(6,7-dihydro-5H-pyrrolo[1,2-c]imidazol-1-yl)）。 */
function looksLikeChemicalName(s: string): boolean {
  const digits = (s.match(/\d/g) || []).length;
  const brackets = (s.match(/[([]/g) || []).length;
  return digits >= 2 || brackets >= 1;
}

/** R187: 标题是否描述蛋白-蛋白/蛋白-肽复合物（分桶与章节挂靠共用）。 */
export function isProteinComplexTitle(title: string | null | undefined): boolean {
  const t = String(title || '');
  if (!t) return false;
  if (STRONG_COMPLEX_TITLE_RE.test(t)) return true;
  if (!WEAK_COMPLEX_TITLE_RE.test(t)) return false;
  if (SMALL_MOLECULE_HINT_RE.test(t)) return false;
  // 「in complex with X」双向判定（R187b）：
  //   右侧 X 为化学名特征 → 小分子复合物；
  //   左侧紧邻词为药物代号/药名词尾（BDTX-1535 / Alflutinib 类）→ 小分子复合物。
  const m = t.match(/in complex with ([^,;]{2,90})/i);
  if (m) {
    if (looksLikeChemicalName(m[1])) return false;
    const before = t.slice(0, m.index || 0).trimEnd().replace(/[^\w-]+$/, '');
    const lastTok = (before.match(/[A-Za-z0-9-]+$/) || [''])[0];
    if (DRUG_CODE_TOKEN_RE.test(lastTok) || DRUG_SUFFIX_TOKEN_RE.test(lastTok)) return false;
    return true;
  }
  // 兜底：标题尾部 60 字符带化学名特征 → 保守按配体态处理。
  return !looksLikeChemicalName(t.slice(-60));
}

/**
 * R187: 生成 markdown 图片语法，alt 文本消毒。
 *
 * RCSB 标题常含化学名方括号/圆括号（pyrrolo[1,2-c]imidazol、
 * 2-[4-(difluoromethyl)-…），直接进 ![alt](url) 的 alt 会破坏图片
 * 语法（alt 不允许裸 ]），导致整张图不渲染（用户现场 8A27/8A2D/8A2A
 * 三张图在正文/附录均不显示的根因）。生成侧统一消毒：去掉 []()
 * 四类字符并压缩空白。
 */
export function figureImageMarkdown(fig: Pick<ReportFigure, 'caption' | 'url'>): string {
  const alt = String(fig.caption || '')
    .replace(/[\[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return `![${alt}](${fig.url})`;
}

// ─── R191: 图片 URL 突变修复 ────────────────────────────────────────────────

/** R191: 带上限的 Levenshtein 距离（超出 max 即早退返回 max+1，剪枝省 CPU）。 */
function editDistanceAtMost(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a === b) return 0;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1; // 整行已超限，剪枝
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

export interface FigureUrlRepair {
  content: string;
  /** 被修复的 URL 数（字符突变 → 就近纠正回清单内的正确 URL）。 */
  fixed: number;
  /** 被移除的图片数（找不到清单内近邻 = 纯幻觉 URL，整图剔除）。 */
  removed: number;
}

/**
 * R191: 修复 LLM 复制图片 URL 时的字符突变。
 *
 * 真实 E2E（P00533 带问题模式）实测：模型在「原样复制」指令下仍会把
 * 哈希抄错 1 个字符（867ea61**4**c6a7 → 867ea61**R**c6a7、
 * 19c451a91**f**94 → 19c451a91**e**94）——突变 URL 大概率 404（用户
 * 现场「部分图片不显示」的又一根因），且骗过 content.includes(url)
 * 的补挂检查导致同图重复嵌入（成药性章 4 图 = 突变版 + 补挂版并存）。
 *
 * 策略：正文里每个图片 URL，① 在已验证清单内 → 保留；② 与清单内某 URL
 * 编辑距离 ≤2（同 host 且长度接近）→ 纠正为清单 URL；③ 无近邻 → 整图
 * 剔除（幻觉）。z-cdn 十六进制哈希两两距离 ≤2 的碰撞概率可忽略；若 RCSB
 * PDB ID 突变后恰好命中清单内另一条（如 9z9e→9z9f 都已验证），① 已判
 * 有效保留（仍是真图，语义偏差可接受），修复分支只处理清单外 URL。
 */
export function repairFigureUrls(content: string, allowedUrls: string[]): FigureUrlRepair {
  if (!content || allowedUrls.length === 0) return { content, fixed: 0, removed: 0 };
  const allowed = [...new Set(allowedUrls)];
  const byHost = new Map<string, string[]>();
  for (const u of allowed) {
    const host = u.replace(/^https?:\/\//, '').split('/')[0];
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host)!.push(u);
  }
  let fixed = 0;
  let removed = 0;
  // 图片 token 独立成行（生成侧约定），删除时顺带吞掉行尾换行避免空洞。
  const out = content.replace(/!\[([^\]\n]*)\]\((https?:\/\/[^)\s]+)\)(\n?)/g, (full, _alt: string, url: string, nl: string) => {
    if (allowed.includes(url)) return full;
    const host = url.replace(/^https?:\/\//, '').split('/')[0];
    const candidates = byHost.get(host) ?? [];
    let best: string | null = null;
    let bestDist = 3; // 阈值 2
    for (const cand of candidates) {
      const d = editDistanceAtMost(url, cand, 2);
      if (d <= 2 && d < bestDist) { best = cand; bestDist = d; }
    }
    if (best) { fixed++; return `![${_alt}](${best})${nl}`; }
    removed++;
    return '';
  });
  // 剔除整图后可能留下连续空行，压回单空行（只处理图片区域，全文无害）。
  const cleaned = removed > 0 ? out.replace(/\n{3,}/g, '\n\n') : out;
  return { content: cleaned, fixed, removed };
}

/** R184: RCSB 结构图多样性分桶配额 —— 无全局张数上限，总量由各桶代表数之和
 * （典型 6-10 张）自然决定；桶间按 pdbId 去重且互斥。 */
const RCSB_COMPLEX_BUCKET_MAX = 4; // 蛋白-蛋白/蛋白-肽复合物（互作类问题的核心证据，最优先）
const RCSB_LIGAND_BUCKET_MAX = 3;  // 有配体的 X-ray/Cryo-EM（非蛋白复合物）
const RCSB_APO_BUCKET_MAX = 2;     // apo X-ray/Cryo-EM
const RCSB_NMR_BUCKET_MAX = 1;     // NMR 代表（此前被完全排除）

/**
 * R179 (Task 2-a): 为单个 RCSB 结构图挑最匹配的大纲章节。
 * 优先级：配体结构 → ligand_binding（若大纲含）；复合物标题 → interactions
 * （若大纲含）；否则 structure_quality（若含）；最终兜底 pdb_analysis
 * （即使大纲未选它也兜底 —— 配图仍会出现在附录 gallery）。
 */
function pickRcsbSection(entry: PdbEntryDetail, sectionIds: string[]): string {
  const has = (id: string) => sectionIds.includes(id);
  // R187: 蛋白复合物优先挂 interactions（即使带配体）；小分子「复合物」
  // 不再错挂 interactions，走配体/质量评估章节。
  if (isProteinComplexTitle(entry.title) && has('interactions')) return 'interactions';
  if (entry.ligands && has('ligand_binding')) return 'ligand_binding';
  if (has('structure_quality')) return 'structure_quality';
  return 'pdb_analysis';
}

/** 按分辨率升序排序（无分辨率排最后）。 */
function byResolution<T extends { resolution?: number | null }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.resolution ?? 999) - (b.resolution ?? 999));
}

/**
 * R184 / R187: 多样性分桶选择代表性 RCSB 结构（无全局张数上限）。
 *
 * 桶（互斥、按 pdbId 去重，按此优先级取分辨率最好的）：
 *   1. 蛋白-蛋白/蛋白-肽复合物（isProteinComplexTitle 判定）≤4 张 ——
 *      互作类科学问题的核心证据；小分子 "in complex" 不再计入此桶；
 *   2. 有配体的 X-ray/Cryo-EM（非蛋白复合物）≤3 张；
 *   3. apo X-ray/Cryo-EM ≤2 张；
 *   4. NMR ≤1 张（旧版被方法过滤器完全排除）。
 */
function pickRepresentativeRcsbEntries(pdbRows: PdbEntryDetail[]): PdbEntryDetail[] {
  const seen = new Set<string>();
  const out: PdbEntryDetail[] = [];
  const push = (list: PdbEntryDetail[]) => {
    for (const e of list) {
      if (!e.pdbId || seen.has(e.pdbId)) continue;
      seen.add(e.pdbId);
      out.push(e);
    }
  };
  const isXc = (e: PdbEntryDetail) =>
    (e.method || '').includes('X-RAY') || (e.method || '').includes('ELECTRON');
  const xc = pdbRows.filter(isXc);
  // R187: 复合物桶只收「蛋白-蛋白/蛋白-肽」复合物（强+弱信号判定），
  // 小分子 "in complex with <化学名>" 归配体桶——不再挤占复合物配额。
  const isComplex = (e: PdbEntryDetail) => isProteinComplexTitle(e.title);
  // 1. 蛋白复合物最优先（互作问题的直接证据）。
  push(byResolution(xc.filter(isComplex)).slice(0, RCSB_COMPLEX_BUCKET_MAX));
  // 2. 配体结合态（非蛋白复合物——含小分子 "in complex" 标题）。
  push(byResolution(xc.filter(e => !isComplex(e) && e.ligands)).slice(0, RCSB_LIGAND_BUCKET_MAX));
  // 3. apo 态（非复合物）。
  push(byResolution(xc.filter(e => !isComplex(e) && !e.ligands)).slice(0, RCSB_APO_BUCKET_MAX));
  // 4. NMR 代表（方法过滤器不再排除 NMR）。
  push(byResolution(pdbRows.filter(e => (e.method || '').toUpperCase().includes('NMR'))).slice(0, RCSB_NMR_BUCKET_MAX));
  return out;
}

/**
 * R179 (Task 2-a) / R184 / R187: RCSB 结构图收集。
 * 多样性分桶选代表结构（蛋白复合物/配体/apo/NMR，无全局上限），
 * URL 用已验证可用的 CDN assembly-1.jpeg，HEAD 10s 预检（R184 起并行）。
 *
 * @param pdbRows       已收集的 PDB 结构行
 * @param emit          SSE progress 函数（每个 figure 一条，带 dshFigure 字段）
 * @param sectionIds    已选大纲章节 id（每张图按内容挑最匹配的挂靠章节）
 */
export async function collectRcsbFigures(
  pdbRows: PdbEntryDetail[],
  emit: (e: SseEvent) => void,
  sectionIds: string[] = [],
  signal?: AbortSignal, // R197: Stop 在 HEAD 预检期间即刻生效（配图可选，中止即返回已收集图）
): Promise<ReportFigure[]> {
  const out: ReportFigure[] = [];
  if (!pdbRows || pdbRows.length === 0) return out;

  const candidates = pickRepresentativeRcsbEntries(pdbRows);
  if (candidates.length === 0) return out;

  // R184: HEAD 预检并行化（旧版逐张串行，≤10 张 × 10s 超时最坏可阻塞
  // 数分钟；并行后总耗时 ≈ 最慢一张）。结果按原顺序消费，SSE 叙事稳定。
  // R197: 每张 HEAD 与 Stop 信号合并（combineSignals）。
  const checked = await Promise.all(candidates.map(async (e) => {
    const url = `https://cdn.rcsb.org/images/structures/${e.pdbId!.toLowerCase()}_assembly-1.jpeg`;
    let ok = false;
    const combo = combineSignals(signal, 10_000);
    try {
      const res = await fetch(url, { method: 'HEAD', signal: combo.signal });
      ok = res.ok;
    } catch {
      ok = false;
    } finally {
      combo.dispose();
    }
    return { entry: e, url, ok };
  }));

  for (const { entry: e, url, ok } of checked) {
    if (signal?.aborted) return out; // R197: 配图可选 —— 中止即返回已收集图
    const resStr = e.resolution != null ? e.resolution.toFixed(1) : '?';
    const caption = `PDB ${e.pdbId} — ${(e.title || '').slice(0, 80)}（${e.method || '未知方法'} ${resStr}Å）`;
    const fig: ReportFigure = {
      kind: 'rcsb',
      url,
      caption,
      pdbId: e.pdbId,
      source: 'RCSB PDB',
      // R179 (Task 2-a): 每张图按内容挑最匹配的大纲章节（配体/复合物/质量）。
      sectionId: pickRcsbSection(e, sectionIds),
      status: ok ? 'verified' : 'failed',
      ...(ok ? {} : { vlmReason: 'RCSB CDN 预检失败' }),
    };
    emit({
      stage: 'figure-rcsb',
      level: ok ? 'success' : 'warn',
      message: ok
        ? `✓ 结构图可用：${e.pdbId}（${resStr}Å）`
        : `⚠ 结构图不可用：${e.pdbId}（CDN 预检失败，跳过）`,
      dshFigure: fig,
    });
    if (ok) out.push(fig);
  }
  return out;
}

/** 从 CLI stdout 提取第一个平衡的 JSON 对象（CLI 可能打印 banner 行）。 */
function extractFirstJsonObject(text: string): any | null {
  if (!text) return null;
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        try { return JSON.parse(slice); } catch { return null; }
      }
    }
  }
  return null;
}

interface ImageSearchResult {
  original_url?: string;
  url?: string;
  caption?: string;
  source?: string;
}

/**
 * R193: 会话级 image-search 结果缓存（进程生命周期）。同一 query 重复
 * 评估（常见：反复测试同一靶点）直接命中，省去 CLI 冷启动 ~55s；命中
 * 后仍逐张 VLM 校验（图片可达性可能变化，缓存只省搜索不省校验）。
 * 上限 200 条防内存无限增长（超出即清空重建，简单且足够）。 */
const imageSearchCache = new Map<string, ImageSearchResult[]>();

/** 以 execFile 方式调 z-ai image-search（无 shell 注入面）。R193: 超时可
 * 调（首查短超时）+ 返回 ok 区分「调用失败（CLI 挂/超时）」与「正常返回
 * 但零结果」（后者不代表 CLI 不可用，不应短路后续 query）。
 * R197: signal 可选 —— Stop 时 kill 子进程立即返回（不等满超时）。 */
async function runImageSearchCli(query: string, timeoutMs: number, signal?: AbortSignal): Promise<{ ok: boolean; results: ImageSearchResult[] }> {
  const { execFile } = await import('node:child_process');
  const args = ['-q', query, '--count', '5', '--gl', 'us'];
  return new Promise<{ ok: boolean; results: ImageSearchResult[] }>((resolve) => {
    let settled = false;
    let onAbort: (() => void) | undefined;
    const settle = (v: { ok: boolean; results: ImageSearchResult[] }) => {
      if (settled) return;
      settled = true;
      if (onAbort && signal) signal.removeEventListener('abort', onAbort);
      resolve(v);
    };
    const child = execFile(
      'z-ai',
      ['image-search', ...args],
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          settle({ ok: false, results: [] });
          return;
        }
        const parsed = extractFirstJsonObject(String(stdout || ''));
        if (!parsed || parsed.success === false || !Array.isArray(parsed.results)) {
          // 正常返回但无结果 —— ok=true（query 可能真没结果，CLI 本身可用）。
          settle({ ok: true, results: [] });
          return;
        }
        settle({ ok: true, results: parsed.results as ImageSearchResult[] });
      },
    );
    // execFile 的 timeout 会发 SIGTERM；再兜底 kill 防僵尸。
    child.on('error', () => settle({ ok: false, results: [] }));
    // R197: Stop —— kill 子进程（SIGTERM，与 execFile 超时同口径）。
    onAbort = () => {
      try { child.kill('SIGTERM'); } catch { /* 已退出 */ }
      settle({ ok: false, results: [] });
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/** 下载图片并校验（≤3MB、image/*，content-length 预检），返回 base64 dataUri；任何失败返回 null。
 * R197: signal 可选 —— 与每张 20s 下载超时合并（Stop 即刻生效）。 */
async function downloadImageAsDataUri(url: string, signal?: AbortSignal): Promise<string | null> {
  const combo = combineSignals(signal, IMAGE_DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: combo.signal });
    if (!res.ok) return null;
    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    if (!ctype.startsWith('image/')) return null;
    // R179: 下载前先看 content-length，超限直接拒绝（避免白拉 3MB 再丢弃）。
    const declaredLen = Number(res.headers.get('content-length') || '0');
    if (declaredLen > IMAGE_MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > IMAGE_MAX_BYTES) return null;
    return `data:${ctype.split(';')[0]};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  } finally {
    combo.dispose();
  }
}

/** VLM 严格校验：relevant + reason 非空才通过；55s 超时 + 1 次重试。
 * R197: race 的超时定时器在快速返回后清理（旧版每次校验遗留一个 55s
 * 悬挂 timer，重试叠加）；另接受可选 signal（中止即退出重试循环）。 */
async function verifyFigureWithVlm(
  dataUri: string,
  query: string,
  signal?: AbortSignal,
): Promise<{ verdict: 'relevant' | 'irrelevant'; reason: string; caption?: string } | null> {
  const ZAI = (await import('z-ai-web-dev-sdk')).default;
  const zai = await ZAI.create();
  const visionBody = {
    messages: [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: `${VLM_PROMPT}\n\n查询主题：${query}` },
          { type: 'image_url' as const, image_url: { url: dataUri } },
        ],
      },
    ],
    thinking: { type: 'disabled' as const },
  };
  for (let attempt = 0; attempt <= VLM_RETRIES; attempt++) {
    if (signal?.aborted) return null; // R197: Stop —— 不再重试
    // 与 /api/vlm/select-best 相同的调用形态；SDK 可能不支持 signal 参数，
    // 用 Promise.race 施加硬超时（挂死调用不再阻塞管线）。
    // R197: 定时器句柄保留 —— race 结束（无论输赢）即 clearTimeout，
    // 快速成功的校验不再遗留 55s 悬挂 timer；并用 signal 竞速让 Stop
    // 在 VLM 等待期内即刻生效（aborted 拒绝不会被下方 catch 吞掉重试）。
    let vlmTimer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const signalRace = signal ? new Promise<never>((_, rej) => {
      onAbort = () => rej(new DOMException('aborted', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
    }) : null;
    try {
      const resp: any = await Promise.race([
        (zai.chat.completions.createVision as unknown as (body: unknown) => Promise<any>)(visionBody),
        new Promise<never>((_, rej) => {
          vlmTimer = setTimeout(() => rej(new Error('VLM timeout')), VLM_TIMEOUT_MS);
        }),
        ...(signalRace ? [signalRace] : []),
      ]);
      const text: string = resp?.choices?.[0]?.message?.content || '';
      const parsed = extractFirstJsonObject(text);
      if (parsed && (parsed.verdict === 'relevant' || parsed.verdict === 'irrelevant')) {
        return {
          verdict: parsed.verdict,
          reason: String(parsed.reason || ''),
          caption: typeof parsed.caption === 'string' ? parsed.caption : undefined,
        };
      }
      // JSON 无效 —— 视为本次尝试失败，进入重试。
    } catch {
      // 超时/网络错误 —— 重试一次。
      // R197: 用户 Stop（signalRace 拒绝）直接退出，不再浪费重试。
      if (signal?.aborted) return null;
    } finally {
      if (vlmTimer) clearTimeout(vlmTimer);
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    }
  }
  return null;
}

/**
 * R179 (Task 2-a) / R184: web 原理图/通路图搜索 + VLM 校验。
 * 每个有配图价值的章节各搜一条 query（按 query 文本去重 + 防刷量护栏 8 条）；
 * 每 query 最多 4 张送审、最多采用 2 张（近重复保护）；全报告总通过数
 * 不再设上限。VLM 校验逐张串行（峰值内存 = 单张图，与总量无关）。
 * CLI / SDK / VLM 任一环节失败 → emit warn + 返回空数组（绝不 throw）。
 * R197: signal 可选 —— 配图是可选产物，中止不抛错而是返回已收集的图；
 * 跨 query 同 URL 去重（相邻语义 query 常返回重叠 top 结果，旧版会把
 * 同一张图嵌入两个章节并双计 verifiedFigures）。
 */
export async function searchWebFigures(
  queries: Array<{ sectionId: string; query: string }>,
  emit: (e: SseEvent) => void,
  signal?: AbortSignal,
): Promise<ReportFigure[]> {
  const out: ReportFigure[] = [];
  // R197: run 级已采用 URL 集合 —— 跨 query 去重（含省一次 VLM 配额）。
  const adoptedUrls = new Set<string>();
  // R184: 移除「最多 2 条 query」配额 —— 仅按 query 文本去重 + 安全护栏。
  const seenQuery = new Set<string>();
  const capped = queries
    .filter(q => q && q.query && q.sectionId)
    .filter(q => {
      const key = String(q.query).trim().toLowerCase();
      if (seenQuery.has(key)) return false;
      seenQuery.add(key);
      return true;
    })
    .slice(0, MAX_WEB_QUERIES);
  if (capped.length === 0) return out;

  // R193: 首查短路标记（函数级 —— 本次评估内 CLI 首查即挂则后续 query
  // 全部跳过；下次评估重新尝试，CLI 可能已恢复）+ 首查标志（短超时）。
  let cliBrokenThisRun = false;
  let cliCalled = false;

  for (const { sectionId, query } of capped) {
    if (signal?.aborted) { // R197: 配图可选 —— 中止即返回已收集图
      emit({ stage: 'figure-web', level: 'info', message: `已中止，返回已收集的 ${out.length} 张 web 配图` });
      return out;
    }
    if (cliBrokenThisRun) {
      emit({ stage: 'figure-web', level: 'info', message: `image-search 本次运行不可用，跳过 query：「${query}」` });
      continue;
    }
    let results: ImageSearchResult[];
    const cacheKey = String(query).trim().toLowerCase();
    const cached = imageSearchCache.get(cacheKey);
    if (cached) {
      // R193: 会话级缓存命中 —— 免重复搜索（含 CLI 冷启动 ~55s），仍逐张 VLM。
      results = cached;
      emit({ stage: 'figure-web', level: 'info', message: `命中会话缓存（${results.length} 条候选，免重复搜索）：「${query}」` });
    } else {
      emit({ stage: 'figure-web', level: 'info', message: `搜索 web 示意图：「${query}」…` });
      const isFirstCliCall = !cliCalled;
      const run = await runImageSearchCli(query, isFirstCliCall ? FIRST_QUERY_TIMEOUT_MS : IMAGE_SEARCH_TIMEOUT_MS, signal);
      cliCalled = true;
      if (!run.ok) {
        if (isFirstCliCall) {
          // 首查即失败：CLI 挂死/不可用 —— 本次评估内短路后续所有 query
          //（后续 query 大概率同样挂死，逐条等满 150s 纯属浪费）。
          cliBrokenThisRun = true;
          emit({ stage: 'figure-web', level: 'warn', message: `⚠ image-search 首次调用即失败（CLI 挂起或不可用），本次评估跳过 web 配图搜索（宁缺毋滥）` });
          continue;
        }
        emit({ stage: 'figure-web', level: 'warn', message: `⚠ image-search 调用失败（跳过该 query，继续）` });
        continue;
      }
      results = run.results;
      // R193: 写入会话缓存（含零结果 —— 零结果同样是有效答案，防重复搜索）。
      if (imageSearchCache.size > 200) imageSearchCache.clear();
      imageSearchCache.set(cacheKey, results);
    }
    if (results.length === 0) {
      emit({ stage: 'figure-web', level: 'warn', message: `⚠ image-search 无结果（跳过该 query，继续）` });
      continue;
    }
    emit({ stage: 'figure-web', level: 'info', message: `image-search 返回 ${results.length} 条候选，逐张 VLM 校验（宁缺毋滥）…` });

    // R184: 近重复保护改为按 query 计（同一搜索的候选图常常高度相似，
    // 采用最佳 ≤VERIFIED_PER_QUERY_CAP 张即可）；总量不再设上限。
    let verifiedThisQuery = 0;
    for (const r of results.slice(0, RESULTS_PER_QUERY_CAP)) {
      if (verifiedThisQuery >= VERIFIED_PER_QUERY_CAP) break;
      if (signal?.aborted) return out; // R197: 图片循环内中止
      const url = r.original_url || r.url || '';
      if (!/^https?:\/\//i.test(url)) continue;
      // R197: 跨 query 同 URL 跳过（已在前一 query 被采用 —— 同图不重复嵌章）。
      if (adoptedUrls.has(url)) continue;
      const fig: ReportFigure = {
        kind: 'web',
        url,
        caption: (r.caption || query).slice(0, 60),
        source: r.source || 'web image search',
        sectionId,
        status: 'searching',
      };
      emit({ stage: 'figure-web', level: 'info', message: `VLM 校验中：${url.slice(0, 70)}…`, dshFigure: fig });

      // 下载 → VLM 判官。
      let verdict: { verdict: 'relevant' | 'irrelevant'; reason: string; caption?: string } | null = null;
      let downloadFailed = false;
      try {
        const dataUri = await downloadImageAsDataUri(url, signal);
        if (!dataUri) {
          downloadFailed = true;
        } else {
          verdict = await verifyFigureWithVlm(dataUri, query, signal);
        }
      } catch {
        downloadFailed = true;
      }

      if (downloadFailed) {
        fig.status = 'rejected';
        fig.vlmReason = 'VLM 校验失败（图片下载失败）';
      } else if (verdict && verdict.verdict === 'relevant' && verdict.reason) {
        fig.status = 'verified';
        fig.vlmReason = verdict.reason;
        if (verdict.caption) fig.caption = verdict.caption.slice(0, 60);
      } else if (verdict) {
        fig.status = 'rejected';
        fig.vlmReason = verdict.reason || 'VLM 判定不相关';
      } else {
        fig.status = 'rejected';
        fig.vlmReason = 'VLM 校验失败';
      }

      emit({
        stage: 'figure-web',
        level: fig.status === 'verified' ? 'success' : 'warn',
        message: fig.status === 'verified'
          ? `✓ 通过 VLM 校验：${fig.caption}`
          : `✗ 拒绝（${fig.vlmReason}）`,
        dshFigure: fig,
      });
      if (fig.status === 'verified') { out.push(fig); verifiedThisQuery++; adoptedUrls.add(url); }
    }
  }

  if (out.length === 0) {
    emit({ stage: 'figure-web', level: 'warn', message: `未采用任何 web 示意图（宁缺毋滥，报告继续）` });
  } else {
    emit({ stage: 'figure-web', level: 'success', message: `✓ 采用 ${out.length} 张 web 示意图` });
  }
  return out;
}
