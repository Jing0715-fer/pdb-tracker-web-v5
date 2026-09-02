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
//                        R205: CLI 不可用→Commons 兜底；判官 z-ai→provider 双路径
//                        R206: PDB_FIGURES_FORCE_COMMONS=1 强制 Commons 图源（判官不变）
//
// 每个 figure 都通过 emit({ ...ev, dshFigure }) 广播给前端；校验失败 /
// CLI 不可用 / 超时统统降级为零图继续，绝不 throw。

import type { SseEvent } from '@/lib/sse';
import type { PdbEntryDetail } from '@/lib/rcsb';
import { combineSignals } from '@/lib/blast'; // R197: Stop 信号与超时合并（与 blast/rcsb 同口径）
import { proxyFigureUrl } from '@/lib/figure-view'; // R207: 嵌入 markdown 的图 URL 统一走服务端代理（用户网络直连 wikimedia CDN 不稳）
// R205: 判官 provider 路径（OpenAI 兼容视觉调用，如 MiniMax-M3）—— 与 llm.ts
// 同源的 leaf 级导入（agent/providers 无反向依赖，无循环）；stripReasoning
// 剥推理模型（DeepSeek-R1 等）content 内联  minded 块（MiniMax 走 thinking
// disabled 已天然干净，这里为其他 provider 兜底）。
import { getProviderProfile, resolveApiKey, resolveBaseURL } from '@/lib/agent/providers';
import { stripReasoning } from '@/lib/llm';

export interface ReportFigure {
  kind: 'rcsb' | 'web';
  url: string;
  caption: string;
  pdbId?: string;
  source?: string;
  sectionId: string;
  status: 'searching' | 'verified' | 'rejected' | 'failed';
  vlmReason?: string;
  /** R207: 全报告统一图号（figure legend「图 N：…」；仅 verified 图在组装
   * 期由 applyFigureLegends 分配；供正文图例与前端画廊「图 N」徽章共用）。 */
  legendNo?: number;
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
  // R207: 渲染出口统一改写 —— wikimedia/rcsb CDN → /api/figure-proxy。
  // LLM 按模板原样复制的图行、补挂图、附录图全部自动变代理 URL；
  // ReportFigure.url 本体保持原始外链（下载/VLM/去重/溯源语义不变）。
  return `![${alt}](${proxyFigureUrl(fig.url)})`;
}

/** R207: figure legend（学术图例）—— 全报告统一「图 N」编号 + 图行下方
 * 斜体图例行。用户反馈报告配图缺 legend：旧版只有裸 ![alt](url)（caption
 * 藏在 alt 文本里，渲染不占行），补挂图才有「- caption（来源）」列表行。
 * 注入发生在组装期（Phase F，所有章节定型后）—— 章节生成期无法预知全局
 * 序号。同图跨章重复出现只编号一次；返回值同时把 legendNo 写回 figure
 * （前端画廊「图 N」徽章与正文一致）。
 * 配套：附录溢出图的续编在 agent.ts 组装处（gallery 依赖嵌入判定结果）。 */
export function applyFigureLegends<T extends { content: string }>(
  chapters: T[],
  figures: ReportFigure[],
): { chapters: T[]; legendCount: number } {
  const verified = figures.filter(f => f.status === 'verified');
  if (verified.length === 0 || chapters.length === 0) return { chapters, legendCount: 0 };
  let n = 0;
  const seen = new Set<string>(); // 已编号的原始 url
  const chaptersOut = chapters.map(ch => {
    if (!ch.content) return ch;
    let content = ch.content;
    for (const f of verified) {
      if (seen.has(f.url)) continue;
      const proxy = proxyFigureUrl(f.url);
      const esc = proxy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // 图行：整行仅 ![alt](proxyUrl)（允许首尾空白）—— 模板要求 LLM
      // 原样复制单独一行；补挂图同格式。行内混排不匹配（宁漏勿错）。
      const re = new RegExp(`^(\\s*!\\[[^\\]\\n]*\\]\\(${esc}\\)\\s*)$`, 'm');
      const m = content.match(re);
      if (m) {
        n += 1;
        seen.add(f.url);
        f.legendNo = n;
        const src = f.source || (f.kind === 'rcsb' ? 'RCSB PDB' : 'web image search');
        content = content.replace(m[0], `${m[0]}\n*图 ${n}：${f.caption}（${src}）*`);
      }
    }
    return { ...ch, content };
  });
  return { chapters: chaptersOut, legendCount: n };
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

// ─── R205: 判官双路径 + Wikimedia Commons 免密钥图源 ─────────────────────

/**
 * R205: z-ai 工具链（CLI 与 SDK 同源）可用性 —— 会话级记忆。云沙箱两者齐备
 * （判官走 z-ai 内置 VLM，免费）；本地部署 ENOENT 即刻返回 false（判官直落
 * 已配置 provider 路径，不浪费超时等待）。PDB_FIGURES_NO_ZAI=1 可强制跳过
 * （测试口/用户强制 provider 判官的逃生门）。
 */
let zaiToolchainMemo: boolean | undefined;
async function zaiToolchainAvailable(): Promise<boolean> {
  if (process.env.PDB_FIGURES_NO_ZAI === '1') return false;
  if (zaiToolchainMemo !== undefined) return zaiToolchainMemo;
  const { execFile } = await import('node:child_process');
  zaiToolchainMemo = await new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (v: boolean) => { if (!settled) { settled = true; resolve(v); } };
    try {
      execFile('z-ai', ['--help'], { timeout: 10_000 }, (err) => done(!err))
        .on('error', () => done(false));
    } catch { done(false); }
  });
  return zaiToolchainMemo;
}

/** R205: VLM 判官输出解析（z-ai 与 provider 两路径共用）—— 只认 JSON 里的
 * verdict/reason/caption；文本其余部分（前后缀噪声/think 块）无关。 */
function parseVlmVerdict(text: string): { verdict: 'relevant' | 'irrelevant'; reason: string; caption?: string } | null {
  const parsed = extractFirstJsonObject(String(text || ''));
  if (parsed && (parsed.verdict === 'relevant' || parsed.verdict === 'irrelevant')) {
    return {
      verdict: parsed.verdict,
      reason: String(parsed.reason || ''),
      caption: typeof parsed.caption === 'string' ? parsed.caption : undefined,
    };
  }
  return null;
}

/**
 * R205: Wikimedia Commons 免密钥图源（MediaWiki API，generator=search +
 * namespace 6 File:）。科学示意图在 Commons 以 SVG drawing 为主，
 * `filetype:drawing` 前缀精准命中；零结果时退化为无前缀查询（判官兜底
 * 过滤非示意图）。thumburl 为 CDN 栅格化 PNG（SVG 也转 PNG，默认 800px），
 * 同时满足 VLM 输入（仅栅格）与 3MB 下载上限；LicenseShortName 进 source
 * 供署名展示。查询语言：相关性分析的 figureQueries 本就强制英文，
 * Commons 英文标注覆盖率最佳，无需翻译环节。
 */
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const COMMONS_TIMEOUT_MS = 20_000;
const COMMONS_THUMB_WIDTH = 800;
const COMMONS_MIME_RE = /^image\/(?:svg\+xml|png|jpeg|webp)$/;
/* R206b: 剔除 image/gif —— 实测 run dsh-P69905-mtjf46vh-0 中两张 Commons GIF
 * （Hemoglobin-animation.gif 895KB / t-r state GIF）下载后送审 VLM 全部
 * 「VLM 校验失败」（判官无法解析 GIF），白耗下载与判官调用；且动画帧
 * 嵌入静态报告本就无意义。PNG/JPEG/WEBP/SVG→thumb PNG 实测均可判。 */
/** Wikimedia 礼仪要求带联系方式的 UA（无 URL/email 的 UA 进严限流桶，
 * 实测 403 Too Many Reqs；thumb CDN 同规则）。用仓库地址作联系方式。 */
const COMMONS_UA = 'PDB-Tracker/1.0 (+https://github.com/Jing0715-fer/pdb-tracker-web-v5)';

interface CommonsPage {
  title?: string;
  index?: number;
  imageinfo?: Array<{
    mime?: string;
    width?: number;
    thumburl?: string;
    extmetadata?: Record<string, { value?: string }>;
  }>;
}

async function searchCommonsApi(searchQuery: string, signal?: AbortSignal): Promise<ImageSearchResult[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrsearch: searchQuery,
    gsrnamespace: '6',
    gsrlimit: '6',
    prop: 'imageinfo',
    iiprop: 'url|mime|size|extmetadata',
    iiurlwidth: String(COMMONS_THUMB_WIDTH),
  });
  const combo = combineSignals(signal, COMMONS_TIMEOUT_MS);
  try {
    const resp = await fetch(`${COMMONS_API}?${params.toString()}`, {
      headers: { 'User-Agent': COMMONS_UA },
      signal: combo.signal,
    });
    if (!resp.ok) return [];
    const data = await resp.json() as { query?: { pages?: Record<string, CommonsPage> } };
    const pages = Object.values(data.query?.pages ?? {});
    // relevance 顺序（MediaWiki 返回无序对象，index = 搜索排名）。
    pages.sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
    const out: ImageSearchResult[] = [];
    for (const p of pages) {
      const info = p.imageinfo?.[0];
      if (!info?.thumburl || !info.mime || !COMMONS_MIME_RE.test(info.mime)) continue;
      if ((info.width ?? 0) < 200) continue; // 过小：图标/装饰件，非配图
      const title = String(p.title || '')
        .replace(/^File:/i, '')
        .replace(/\.[a-z0-9]{2,5}$/i, '')
        .replace(/_/g, ' ')
        .trim();
      if (!title) continue;
      const license = info.extmetadata?.LicenseShortName?.value?.trim();
      out.push({
        // thumburl = 直接图片地址（下载/VLM/嵌入三用）；original_url 同源
        //（本函数的下载链路取 original_url || url，不可填描述页 HTML）。
        original_url: info.thumburl,
        url: info.thumburl,
        caption: title.slice(0, 120),
        source: license ? `Wikimedia Commons · ${license.slice(0, 40)}` : 'Wikimedia Commons',
      });
    }
    return out;
  } catch {
    return []; // 超时/网络/解析失败 → 宁缺毋滥，调用方走零结果分支
  } finally {
    combo.dispose();
  }
}

/** R206: Commons query 关键词归一化 —— MediaWiki 全文检索（CirrusSearch）为
 * 严格 AND 词项匹配，无语义/近义能力；z-ai/Google 风格的长描述式 query
 * （如「hemoglobin oxygen binding mechanism and conformational changes」）
 * 会命中 PDF/年报正文（mime 白名单过滤后全军覆没，实测 run dsh-P69905-
 * mtiicipl-0 四 query 全零）。抽取内容词（去停用词、保留连字符术语如
 * x-ray/cryo-EM）供逐级降格搜索。 */
const COMMONS_STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'or', 'in', 'on', 'for', 'to', 'by', 'with',
  'vs', 'versus', 'from', 'between', 'during', 'its', 'their', 'this', 'that',
  'is', 'are', 'as', 'at', 'into', 'under', 'over', 'both', 'his', 'her',
]);
function commonsKeywords(query: string): string[] {
  return String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter(w => w.length >= 2 && !COMMONS_STOPWORDS.has(w));
}

/**
 * R205 → R206: Commons 搜索（导出仅供测试）。
 * R205: drawing 优先，零结果退化无前缀。
 * R206: 原策略对长描述式 query 无召回（见 commonsKeywords 注释）—— 改为
 * 关键词归一化 + 逐级降格搜索梯，命中即停：
 *  ① 前 4 内容词 + filetype:drawing（SVG 示意图，最精准）
 *  ② 前 4 内容词 + filetype:bitmap（PNG/JPG：渲染图/机制对比图/扫描图 —
 *     实测 Commons 科学配图大量为 bitmap，如「Hemoglobin R and T state
 *     Comparison.jpg」，此级是召回主力）
 *  ③④ 前 3 / 前 2 内容词 + filetype:bitmap（AND 约束逐级放宽）
 *  ⑤ 尾 2 内容词 + filetype:bitmap（主题词常在句尾，如「comparison of
 *     X-ray vs Cryo-EM resolution for hemoglobin structures」）
 * 非图结果（PDF/视频）由 mime 白名单挡掉；垃圾图由 VLM 判官终筛。
 * 每级一次 API 调用（~0.7s），最坏 5 级 ~3.5s。
 */
export async function searchCommonsFigures(query: string, signal?: AbortSignal): Promise<ImageSearchResult[]> {
  const kw = commonsKeywords(query);
  const tries: string[] = [];
  if (kw.length > 0) {
    tries.push(`${kw.slice(0, 4).join(' ')} filetype:drawing`);
    tries.push(`${kw.slice(0, 4).join(' ')} filetype:bitmap`);
    tries.push(`${kw.slice(0, 3).join(' ')} filetype:bitmap`);
    tries.push(`${kw.slice(0, 2).join(' ')} filetype:bitmap`);
    if (kw.length > 2) tries.push(`${kw.slice(-2).join(' ')} filetype:bitmap`);
  }
  const seen = new Set<string>();
  for (const t of tries) {
    if (seen.has(t)) continue; // kw.length≤2 时首尾词对重合
    seen.add(t);
    const results = await searchCommonsApi(t, signal);
    if (signal?.aborted) return results;
    if (results.length > 0) return results;
  }
  return [];
}

// ─── R209: MiniMax 服务端 web_search 图源（本地主路径）───────────────────────

/**
 * R209: 网页/图片抓取 UA（浏览器兼容前缀 + 联系方式）。纯标识 UA 常被站点
 * CDN 反爬 403，纯浏览器 UA 违反抓取礼仪 —— 折中为 compatible 标识 + 仓库
 * 地址（Wikimedia「UA 必须含联系方式」规则同样满足：R205 实测带 URL 即
 * 200，前缀不限）。
 */
const FIGURE_PAGE_UA = 'Mozilla/5.0 (compatible; PDB-TrackerFigureBot/1.0; +https://github.com/Jing0715-fer/pdb-tracker-web-v5)';
/** R209: MiniMax Responses API（web_search 服务端工具）单次调用超时 —— 官方
 * 文档明示「搜索行为在服务端完成，单次请求耗时可能比不启用工具时更长」。 */
const MINIMAX_WEBSEARCH_TIMEOUT_MS = 120_000;
/** R209: 每 query 最多采纳 web_search 发现的页数（并行抓取，每页 15s）。 */
const MINIMAX_MAX_PAGES = 4;
/** R209: 单页 HTML 抓取上限（>2.5MB 的页面多为巨型站点，正则提取性价比低）。 */
const PAGE_HTML_MAX_BYTES = 2_500_000;
const PAGE_FETCH_TIMEOUT_MS = 15_000;

/** 从文本提取第一个平衡的 JSON 数组（与 extractFirstJsonObject 同源算法；
 * R209: MiniMax web_search 的输出契约是页面列表 JSON 数组）。 */
export function extractFirstJsonArray(text: string): any[] | null {
  if (!text) return null;
  const start = text.indexOf('[');
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
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        try {
          const parsed = JSON.parse(slice);
          return Array.isArray(parsed) ? parsed : null;
        } catch { return null; }
      }
    }
  }
  return null;
}

/**
 * R209: MiniMax web_search 图源配置解析 —— 仅当已配置 provider 为 MiniMax
 *（provider id 或 baseURL 含 minimax）时激活。web_search 是 MiniMax 服务端
 * 托管工具（Responses API 专属，声明式 tools: [{"type":"web_search"}]，模型
 * 在服务端自动执行搜索并在单次请求内继续生成），其他 OpenAI 兼容 provider
 * 无此能力，不尝试。'zai'/'auto'/'cli:*' 照旧排除。逃生门
 * PDB_FIGURES_NO_MINIMAX_WEB=1（强制回退 Commons）。
 */
export function minimaxWebSearchConfig(
  llmCfg?: { provider?: string; model?: string },
): { providerId: string; displayName: string; baseURL: string; apiKey: string; model: string } | null {
  if (process.env.PDB_FIGURES_NO_MINIMAX_WEB === '1') return null;
  const p = (llmCfg?.provider || '').trim();
  if (!p || p === 'zai' || p === 'auto' || p.startsWith('cli:')) return null;
  const profile = getProviderProfile(p);
  const baseURL = (resolveBaseURL(p) ?? profile?.baseURL ?? '').replace(/\/+$/, '');
  if (!baseURL) return null;
  if (!/minimax/i.test(p) && !/minimax/i.test(baseURL)) return null;
  const apiKey = resolveApiKey(p);
  if (!apiKey) return null;
  return {
    providerId: p,
    displayName: profile?.displayName ?? p,
    baseURL,
    apiKey,
    model: (llmCfg?.model || '').trim() || profile?.defaultModel || 'MiniMax-M3',
  };
}

/** R209: Responses API 端点 —— baseURL 以 /v1 结尾时直接拼 /responses，
 * 否则补 /v1/responses（MiniMax 官方路径 /v1/responses，见
 * platform.minimaxi.com/docs Server Tools 章节）。导出仅供测试。 */
export function minimaxResponsesEndpoint(baseURL: string): string {
  const base = String(baseURL || '').replace(/\/+$/, ''); // 尾斜杠防御（调用方已剥）
  return /\/v1$/i.test(base) ? `${base}/responses` : `${base}/v1/responses`;
}

export interface MinimaxWebSearchOutcome {
  ok: boolean;
  /** 最终回复文本（顶层 output_text 或 message 内容块聚合）。 */
  text: string;
  /** 模型实际发起的搜索词（output[].type === 'web_search_call' 的 action.query）。 */
  searchedQueries: string[];
  /** 4xx = 定性失败（会话级短路依据）；5xx/超时 = 瞬态。 */
  status?: number;
  error?: string;
}

/**
 * R209: MiniMax Responses API + web_search 服务端工具调用（导出仅供测试）。
 * 请求形态按官方文档：POST {endpoint} { model, input, tools:[{type:"web_search"}] }，
 * Authorization Bearer。响应解析：顶层 output_text（官方聚合字段）缺失时
 * 从 output[].message.content[].output_text 聚合；web_search_call 项提取
 * 实际搜索词（事件/日志用）。
 */
export async function callProviderWebSearchRaw(
  endpoint: string,
  apiKey: string,
  model: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<MinimaxWebSearchOutcome> {
  const combo = combineSignals(signal, MINIMAX_WEBSEARCH_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: prompt,
        tools: [{ type: 'web_search' }],
      }),
      signal: combo.signal,
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => resp.statusText);
      return { ok: false, text: '', searchedQueries: [], status: resp.status, error: errText.slice(0, 200) };
    }
    const json = await resp.json() as {
      output_text?: string;
      output?: Array<{
        type?: string;
        action?: { query?: string };
        content?: Array<{ type?: string; text?: string }>;
      }>;
    };
    const searchedQueries: string[] = [];
    for (const item of json.output ?? []) {
      if (item?.type === 'web_search_call') {
        const q = String(item.action?.query || '').trim();
        if (q) searchedQueries.push(q);
      }
    }
    let text = typeof json.output_text === 'string' ? json.output_text : '';
    if (!text) {
      const parts: string[] = [];
      for (const item of json.output ?? []) {
        if (item?.type !== 'message') continue;
        for (const c of item.content ?? []) {
          if (c?.type === 'output_text' && c.text) parts.push(c.text);
        }
      }
      text = parts.join('\n');
    }
    return { ok: true, text, searchedQueries };
  } catch (e: any) {
    return { ok: false, text: '', searchedQueries: [], error: String(e?.message || e || 'fetch failed').slice(0, 200) };
  } finally {
    combo.dispose();
  }
}

/** R209: web_search 页面发现 prompt（严格 JSON 数组契约）。 */
function webSearchPagePrompt(query: string): string {
  return `你是一个科研配图检索助手。请使用 web_search 工具进行联网搜索，找出最可能包含与下列主题相关的高质量科学示意图（原理图 / 机制图 / 信号通路图 / 结构图）的网页。

主题：${query}

要求：
- 优先权威来源：维基百科（Wikipedia）、大学 / 研究所教育页面、综述文章、权威科普网站
- 优先页面内容与主题强相关、以解释性配图为主的页面
- 最多 ${MINIMAX_MAX_PAGES} 个网页，只返回你通过搜索实际找到的 URL

只输出 JSON 数组（不要任何其他文字）：
[{"pageUrl":"https://…","reason":"一句话说明该页面为何可能包含相关配图"}]
若无合适结果，输出 []`;
}

/** R209: 解析 web_search 回复为页面清单（容忍 markdown 围栏/前后缀噪声）。 */
export function parseWebSearchPages(text: string): Array<{ pageUrl: string; reason: string }> {
  const arr = extractFirstJsonArray(stripReasoning(String(text || '')));
  if (!Array.isArray(arr)) return [];
  const out: Array<{ pageUrl: string; reason: string }> = [];
  const seen = new Set<string>();
  for (const item of arr.slice(0, MINIMAX_MAX_PAGES)) {
    if (!item || typeof item !== 'object') continue;
    const url = String((item as Record<string, unknown>).pageUrl || (item as Record<string, unknown>).url || '').trim();
    if (!/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ pageUrl: url, reason: String((item as Record<string, unknown>).reason || '').slice(0, 100) });
  }
  return out;
}

// ─── R209: 页面 <img> 提取（纯函数 + 抓取封装）──────────────────────────────

const IMG_TAG_RE = /<img\b[^>]*>/gi;
const IMG_EXT_RE = /\.(png|jpe?g|webp)(?:[?#]|$)/i;
/** 垃圾图 URL/alt 模式（logo/icon/头像/轮播/广告/埋点等 —— 与 Commons 链路
 * 的 width≥200 门槛互补）。 */
const IMG_JUNK_RE = /(logo|icon|avatar|sprite|badge|favicon|bullet|spacer|blank|placeholder|tracking|pixel|analytics|gravatar|carousel|arrow[-_ ]?(next|prev)|loading|ads?[._/-]|doubleclick|facebook|twitter|weibo|qrcode)/i;

/** 从 <img ...> 标签取属性值（双引号/单引号/裸值三形）。 */
function imgAttr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').trim();
}

/** srcset 最高倍率项（维基百科 img src 常为 250px 缩略，srcset 才有高分辨率
 * 版本 —— 只取 src 会把判官喂成小图）。w 描述符按 /96 近似换算。 */
function bestSrcsetEntry(tag: string): { url: string; scale: number } | null {
  const ss = imgAttr(tag, 'srcset');
  if (!ss) return null;
  let best: { url: string; scale: number } | null = null;
  for (const part of ss.split(',')) {
    const seg = part.trim().split(/\s+/);
    const url = seg[0];
    if (!url) continue;
    const d = seg[1] || '1x';
    const scale = d.endsWith('x')
      ? parseFloat(d)
      : (() => { const w = parseFloat(d); return Number.isFinite(w) && w > 0 ? w / 96 : 1; })();
    if (!Number.isFinite(scale) || scale <= 0) continue;
    if (!best || scale > best.scale) best = { url, scale };
  }
  return best;
}

/**
 * R209: 从页面 HTML 提取配图候选（纯函数，导出仅供测试）。
 * 过滤口径沿用本管线既有决策：GIF/SVG 剔除（判官无法解析，R206b 实测）、
 * 声明宽/高 < 200 视为图标、垃圾模式剔除；https-only（渲染代理只收 https）；
 * 无扩展名 URL 仅 wikimedia thumb 路径保留（thumburl 无扩展名常态，下载侧
 * content-type 兜底）。排序 = alt/title 与 query 关键词重合（×3）+ 文件名
 * 重合（×2）+ wikimedia 域（+2，策展质量）+ 声明宽 ≥600（+1）；srcset 存在
 * 时取最高倍率 URL。同 host 上限 3 张保多样性。
 */
export function extractImagesFromPageHtml(html: string, pageUrl: string, query: string): ImageSearchResult[] {
  if (!html || !pageUrl) return [];
  const kw = new Set(commonsKeywords(query));
  const candidates: Array<{ r: ImageSearchResult; score: number }> = [];
  const seen = new Set<string>();
  const hostCount = new Map<string, number>();
  let pageBase: URL;
  try { pageBase = new URL(pageUrl); } catch { return []; }

  for (const m of html.matchAll(IMG_TAG_RE)) {
    const tag = m[0];
    let src = imgAttr(tag, 'data-src') || imgAttr(tag, 'data-original') || imgAttr(tag, 'src') || '';
    const srcsetBest = bestSrcsetEntry(tag);
    let scale = 1;
    if (srcsetBest) {
      src = srcsetBest.url;
      scale = srcsetBest.scale;
    }
    if (!src || /^(data|blob|javascript):/i.test(src)) continue;
    let u: URL;
    try { u = new URL(src, pageBase); } catch { continue; }
    if (u.protocol !== 'https:') continue; // 渲染代理 https-only；http 直连不可靠
    const url = u.toString();
    const isWikimedia = /(^|\.)wikimedia\.org$/i.test(u.hostname);
    if (!IMG_EXT_RE.test(u.pathname) && !(isWikimedia && /\/thumb\//.test(u.pathname))) continue;
    if (IMG_JUNK_RE.test(u.pathname) || IMG_JUNK_RE.test(u.search)) continue;
    if (seen.has(url)) continue;
    // 声明尺寸（src 的显示尺寸；srcset 存在时按倍率折算近似真实尺寸）。
    const w = parseInt(imgAttr(tag, 'width') || '0', 10) || 0;
    const h = parseInt(imgAttr(tag, 'height') || '0', 10) || 0;
    const effW = Math.round(w * scale);
    if ((w > 0 && effW < 200) || (h > 0 && Math.round(h * scale) < 120)) continue;
    const alt = (imgAttr(tag, 'alt') || imgAttr(tag, 'title') || '').slice(0, 160);
    if (alt && IMG_JUNK_RE.test(alt)) continue;

    // 打分：alt/title 重合 ×3 + 文件名重合 ×2 + wikimedia +2 + 宽度 +1。
    let score = 0;
    const altKw = new Set(commonsKeywords(alt));
    let overlap = 0;
    for (const k of altKw) if (kw.has(k)) overlap++;
    score += overlap * 3;
    const base = decodeURIComponent(u.pathname.split('/').pop() || '');
    const fileKw = new Set(commonsKeywords(base.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[-_]/g, ' ')));
    for (const k of fileKw) if (kw.has(k)) score += 2;
    if (isWikimedia) score += 2;
    if (effW >= 600) score += 1;
    if (overlap === 0 && !isWikimedia) score -= 2; // 无线索非权威 → 沉底

    const host = u.hostname;
    if ((hostCount.get(host) ?? 0) >= 3) continue;
    hostCount.set(host, (hostCount.get(host) ?? 0) + 1);
    seen.add(url);
    const caption = (alt || base.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[-_]/g, ' ').trim() || 'web image').slice(0, 120);
    candidates.push({
      r: {
        original_url: url,
        url,
        caption,
        source: host,
      },
      score,
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 6).map(c => c.r);
}

/** R209: 抓取单个发现页并提取配图候选（15s / 2.5MB / text/html 三门槛）。 */
async function fetchPageAndExtractImages(pageUrl: string, query: string, signal?: AbortSignal): Promise<ImageSearchResult[]> {
  const combo = combineSignals(signal, PAGE_FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(pageUrl, {
      headers: { 'User-Agent': FIGURE_PAGE_UA, Accept: 'text/html,application/xhtml+xml' },
      signal: combo.signal,
      redirect: 'follow',
    });
    if (!resp.ok) return [];
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('html')) return [];
    const declared = Number(resp.headers.get('content-length') || '0');
    if (declared > PAGE_HTML_MAX_BYTES) return [];
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length === 0 || buf.length > PAGE_HTML_MAX_BYTES) return [];
    return extractImagesFromPageHtml(buf.toString('utf-8'), pageUrl, query);
  } catch {
    return []; // 单页失败不拖垮整条 query（宁缺毋滥）
  } finally {
    combo.dispose();
  }
}

/**
 * R209: MiniMax web_search 定性失败（会话级短路 —— 4xx 定性；瞬态 2 次也
 * 定性，避免 4 条 query 各白等 120s）。失败后本会话所有运行直落 Commons。
 */
let minimaxWebSearchDead: string | null = null;
let minimaxWebSearchTransientFails = 0;
export function minimaxWebSearchFailureReason(): string | null {
  return minimaxWebSearchDead;
}

/**
 * R209: MiniMax web_search 图源编排（导出仅供测试）——
 *   ① Responses API + web_search 服务端工具 → 页面清单（≤4 页）
 *   ② 并行抓取页面 → extractImagesFromPageHtml 提取 <img> 候选
 *   ③ 合并去重（URL 级 + 同 host ≤3）→ 排序取前 6
 * 候选进入调用方的既有下载 → VLM 判官链（z-ai 优先 → provider 视觉兜底），
 * 与 Commons/z-ai 候选同一质量闸门。
 */
export async function searchMinimaxWebFigures(
  query: string,
  cfg: { providerId: string; displayName: string; baseURL: string; apiKey: string; model: string },
  opts?: { signal?: AbortSignal; onSearched?: (queries: string[]) => void },
): Promise<ImageSearchResult[]> {
  if (minimaxWebSearchDead) return [];
  const endpoint = minimaxResponsesEndpoint(cfg.baseURL);
  const run = await callProviderWebSearchRaw(endpoint, cfg.apiKey, cfg.model, webSearchPagePrompt(query), opts?.signal);
  if (!run.ok) {
    if (run.status !== undefined && run.status >= 400 && run.status < 500) {
      minimaxWebSearchDead = `${cfg.displayName} web_search ${run.status}: ${run.error || 'client error'}`;
    } else if (++minimaxWebSearchTransientFails >= 2) {
      minimaxWebSearchDead = `${cfg.displayName} web_search 瞬态失败 ×2（${run.error || 'timeout/network'}）`;
    }
    return [];
  }
  if (run.searchedQueries.length > 0 && opts?.onSearched) opts.onSearched(run.searchedQueries);
  const pages = parseWebSearchPages(run.text);
  if (pages.length === 0) return [];
  const perPage = await Promise.all(pages.map(p => fetchPageAndExtractImages(p.pageUrl, query, opts?.signal)));
  const merged: ImageSearchResult[] = [];
  const seen = new Set<string>();
  for (const list of perPage) {
    for (const r of list) {
      const url = r.original_url || r.url || '';
      if (!url || seen.has(url)) continue;
      seen.add(url);
      merged.push(r);
    }
  }
  return merged.slice(0, RESULTS_PER_QUERY_CAP + 2);
}

/** R205: provider 视觉判官调用超时（OpenAI 兼容 /chat/completions +
 *  image_url 内容块；图像已限 3MB，90s 对慢端点留了余量）。 */
const PROVIDER_VISION_TIMEOUT_MS = 90_000;
const PROVIDER_VISION_RETRIES = 1;
/**
 * R205: provider 视觉调用「硬失败」的会话级记忆（4xx：鉴权错/参数错/模型
 * 无视觉能力）。首败即定性 —— 后续逐张直接跳过（每张两次 90s 重试纯属
 * 浪费）；5xx/超时为瞬态，不记忆、允许重试。网络/超时型失败不设记忆，
 * 下张图仍会尝试（沙箱内 provider 仅作 z-ai 失败的回退，瞬态恢复有效）。
 */
let providerVisionUnavailable: string | null = null;

/** R205: provider 判官「已定性不可用」的原因（一次性提示用，避免逐张重复）。 */
export function providerVisionFailureReason(): string | null {
  return providerVisionUnavailable;
}

/**
 * R205: 通过已配置 provider（OpenAI 兼容，如 MiniMax-M3）执行 VLM 判官。
 * 线格式与 llm.ts 的 callAgentProviderCompat 同源（authHeader/authPrefix/
 * extraHeaders 来自 provider profile），仅消息体换为多模态内容块：
 * text（判官 prompt）+ image_url（base64 dataUri，MiniMax 图片上限 10MB、
 * 请求体 64MB，本管线图源已限 3MB 远低于两者）。MiniMax-M3 额外显式关
 * thinking（判官无需推理链；其余 provider 不发未知字段，靠 stripReasoning
 * 剥可能内联的 think 块）。
 */
async function callProviderVision(
  providerId: string,
  model: string,
  dataUri: string,
  query: string,
  signal?: AbortSignal,
): Promise<{ verdict: 'relevant' | 'irrelevant'; reason: string; caption?: string } | null> {
  if (providerVisionUnavailable) return null;
  const profile = getProviderProfile(providerId);
  if (!profile) { providerVisionUnavailable = `unknown provider "${providerId}"`; return null; }
  const apiKey = resolveApiKey(providerId);
  if (!apiKey) {
    providerVisionUnavailable = `no API key for "${providerId}" (set it in shared LLM settings or ${profile.apiKeyEnv})`;
    return null;
  }
  const baseURL = (resolveBaseURL(providerId) ?? profile.baseURL ?? '').replace(/\/+$/, '');
  if (!baseURL) { providerVisionUnavailable = `no baseURL for "${providerId}"`; return null; }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    [profile.authHeader ?? 'Authorization']: `${profile.authPrefix ?? 'Bearer '}${apiKey}`,
    ...(profile.extraHeaders ?? {}),
  };
  const body: Record<string, unknown> = {
    model: model || profile.defaultModel,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: `${VLM_PROMPT}\n\n查询主题：${query}` },
        { type: 'image_url', image_url: { url: dataUri } },
      ],
    }],
    stream: false,
    ...(providerId === 'minimax' ? { thinking: { type: 'disabled' } } : {}),
  };

  for (let attempt = 0; attempt <= PROVIDER_VISION_RETRIES; attempt++) {
    if (signal?.aborted) return null;
    if (providerVisionUnavailable) return null;
    const combo = combineSignals(signal, PROVIDER_VISION_TIMEOUT_MS);
    try {
      const resp = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: combo.signal,
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => resp.statusText);
        const brief = `${profile.displayName} API ${resp.status}: ${errText.slice(0, 200)}`;
        // 4xx：鉴权/参数/模型无视觉 —— 定性为持续失败，会话级短路。
        if (resp.status >= 400 && resp.status < 500) providerVisionUnavailable = brief;
        continue; // 5xx/瞬态 → 重试一次
      }
      const json = await resp.json() as { choices?: Array<{ message?: { content?: string | null } }> };
      const content = json.choices?.[0]?.message?.content || '';
      const verdict = parseVlmVerdict(stripReasoning(content));
      if (verdict) return verdict;
      // JSON 无效 → 与 z-ai 路径同口径：重试一次
    } catch {
      if (signal?.aborted) return null;
      if (providerVisionUnavailable) return null; // 已定性 → 不再重试
      // 超时/网络错误 → 重试一次
    } finally {
      combo.dispose();
    }
  }
  return null;
}

/** 以 execFile 方式调 z-ai image-search（无 shell 注入面）。R193: 超时可
 * 调（首查短超时）+ 返回 ok 区分「调用失败（CLI 挂/超时）」与「正常返回
 * 但零结果」（后者不代表 CLI 不可用，不应短路后续 query）。
 * R197: signal 可选 —— Stop 时 kill 子进程立即返回（不等满超时）。
 * R204: 失败时携带 enoent（ENOENT = 本机未安装 z-ai CLI，典型于本地部署
 * 环境；区别于 CLI 存在但挂起/超时），供上层给出针对性提示。 */
async function runImageSearchCli(query: string, timeoutMs: number, signal?: AbortSignal): Promise<{ ok: boolean; results: ImageSearchResult[]; enoent?: boolean }> {
  const { execFile } = await import('node:child_process');
  const args = ['-q', query, '--count', '5', '--gl', 'us'];
  return new Promise<{ ok: boolean; results: ImageSearchResult[]; enoent?: boolean }>((resolve) => {
    let settled = false;
    let onAbort: (() => void) | undefined;
    const settle = (v: { ok: boolean; results: ImageSearchResult[]; enoent?: boolean }) => {
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
          settle({ ok: false, results: [], enoent: (err as NodeJS.ErrnoException).code === 'ENOENT' });
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
    // execFile 的 timeout 会发 SIGTERM；再兜底 kill 防僵尸。spawn ENOENT
    // 也会先走这里（与 callback 同源错误，settle 幂等）。
    child.on('error', (e) => settle({ ok: false, results: [], enoent: (e as NodeJS.ErrnoException)?.code === 'ENOENT' }));
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
 * R197: signal 可选 —— 与每张 20s 下载超时合并（Stop 即刻生效）。
 * R209: UA 统一为 FIGURE_PAGE_UA（浏览器兼容 + 联系方式）—— web 图源
 * 现来自任意公网站点，非浏览器 UA 常被 CDN 反爬 403；Wikimedia 域仍满足
 * 「UA 必须含联系方式」规则（R205 实测带 URL 即 200，前缀不限）。 */
async function downloadImageAsDataUri(url: string, signal?: AbortSignal): Promise<string | null> {
  const combo = combineSignals(signal, IMAGE_DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: combo.signal,
      headers: { 'User-Agent': FIGURE_PAGE_UA },
    });
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

/** z-ai 内置 VLM 判官（云沙箱主路径）：relevant + reason 非空才通过；
 * 55s 超时 + 1 次重试。R197: race 的超时定时器在快速返回后清理（旧版每次
 * 校验遗留一个 55s 悬挂 timer，重试叠加）；接受可选 signal（中止即退出
 * 重试循环）。R205: 从 verifyFigureWithVlm 拆出（后者升级为判官双路径调度）。 */
async function verifyWithZaiVlm(
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
      const verdict = parseVlmVerdict(text);
      if (verdict) return verdict;
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
 * R205: VLM 判官双路径调度 —— z-ai 内置优先（云沙箱免费；本地 CLI 缺失
 * 探测 ENOENT 即刻跳过、不浪费超时等待），已配置 provider 的 OpenAI 兼容
 * 视觉调用作兜底（本地主路径：MiniMax-M3 等视觉模型；沙箱内 z-ai 瞬态
 * 失败时也走此兜底）。任一成功即返回；均不可用返回 null（调用方按「宁缺
 * 毋滥」拒图）。provider 为 'zai'/'cli:*' 时无视觉路径，跳过。
 */
async function verifyFigureWithVlm(
  dataUri: string,
  query: string,
  signal?: AbortSignal,
  /** R205: 流水线 LLM 配置（run-service resolveRunLlmConfig 的产物）——
   *  provider/model 与正文报告同源（用户配置什么就判什么）。 */
  llmCfg?: { provider?: string; model?: string },
): Promise<{ verdict: 'relevant' | 'irrelevant'; reason: string; caption?: string } | null> {
  if (await zaiToolchainAvailable()) {
    const v = await verifyWithZaiVlm(dataUri, query, signal);
    if (v) return v;
  }
  const providerId = (llmCfg?.provider || '').trim();
  if (providerId && providerId !== 'zai' && providerId !== 'auto' && !providerId.startsWith('cli:')) {
    return callProviderVision(providerId, (llmCfg?.model || '').trim(), dataUri, query, signal);
  }
  return null;
}

/**
 * R179 (Task 2-a) / R184 / R205: web 原理图/通路图搜索 + VLM 判官双路径。
 * 图源双轨：z-ai image-search CLI（云沙箱主路径）→ 不可用/零结果时
 * Wikimedia Commons 免密钥兜底（本地主路径）；每 query 的候选图逐张
 * 下载后交判官（z-ai 内置 VLM 优先 → 已配置 provider 的 OpenAI 兼容视觉
 * 调用，见 verifyFigureWithVlm）。每个有配图价值的章节各搜一条 query
 * （按 query 文本去重 + 防刷量护栏 8 条）；每 query 最多 4 张送审、最多
 * 采用 2 张（近重复保护）；全报告总通过数不设上限。VLM 校验逐张串行
 * （峰值内存 = 单张图，与总量无关）。任一环节失败 → emit warn + 继续
 * （绝不 throw）。
 * R197: signal 可选 —— 配图是可选产物，中止不抛错而是返回已收集的图；
 * 跨 query 同 URL 去重（相邻语义 query 常返回重叠 top 结果，旧版会把
 * 同一张图嵌入两个章节并双计 verifiedFigures）。
 * R205: llmCfg —— 判官 provider 路径的配置来源（与正文报告同源）。
 */
export async function searchWebFigures(
  queries: Array<{ sectionId: string; query: string }>,
  emit: (e: SseEvent) => void,
  signal?: AbortSignal,
  llmCfg?: { provider?: string; model?: string },
): Promise<ReportFigure[]> {
  const out: ReportFigure[] = [];
  // R197: run 级已采用 URL 集合 —— 跨 query 去重（含省一次 VLM 配额）。
  const adoptedUrls = new Set<string>();
  // R206b: run 级硬失败 URL 集合（下载失败或判官无法处理）—— 确定性失败
  // 换 query 重试同一 URL 只会重复浪费下载与判官配额（实测 run#2 同一张
  // GIF 在两条 query 下各失败一次）。判官「不相关」裁决不进此集合：
  // 相关性判定与 query 语境相关，换 query 后同一图结论可能翻转。
  const hardFailedUrls = new Set<string>();
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

  // R205: 判官路径决策（会话级 z-ai 探测 + provider 可用性）—— 先说清楚
  // 本次运行的判官阵容，再干活。provider 排除 'zai'（SDK 内置已由 z-ai
  // 分支覆盖）与 'cli:*'（CLI 代理无视觉面）。
  const zaiOk = await zaiToolchainAvailable();
  const judgeProviderId = (() => {
    const p = (llmCfg?.provider || '').trim();
    return p && p !== 'zai' && p !== 'auto' && !p.startsWith('cli:') ? p : '';
  })();
  // R209: MiniMax web_search 图源配置（仅 MiniMax provider；见
  // minimaxWebSearchConfig）。FORCE_COMMONS 测试门下跳过（纯 Commons 演示）。
  const forceCommonsOnly = process.env.PDB_FIGURES_FORCE_COMMONS === '1';
  const mmCfg = forceCommonsOnly ? null : minimaxWebSearchConfig(llmCfg);
  // R209: web_search 定性失败的一次性提示标志（跨 query 只提一次）。
  let mmDeadAnnounced = false;
  if (!zaiOk && !judgeProviderId) {
    emit({ stage: 'figure-web', level: 'warn', message: '⚠ web 配图需要 VLM 判官（z-ai 内置或已配置 provider 的视觉模型）：本机无 z-ai CLI 且未配置可用 provider —— 跳过 web 配图搜索（RCSB 结构图与报告正文不受影响）' });
    return out;
  }
  if (judgeProviderId) {
    const profile = getProviderProfile(judgeProviderId);
    const judgeName = profile?.displayName ?? judgeProviderId;
    const judgeModel = (llmCfg?.model || '').trim() || profile?.defaultModel || '';
    emit({
      stage: 'figure-web',
      level: 'info',
      message: zaiOk
        ? `VLM 判官：z-ai 内置（优先，云沙箱免费）→ ${judgeName}${judgeModel ? '/' + judgeModel : ''}（回退）`
        : `VLM 判官：${judgeName}${judgeModel ? '/' + judgeModel : ''}（已配置 provider，OpenAI 兼容视觉调用；z-ai CLI 本机不可用）`,
    });
  } else {
    emit({ stage: 'figure-web', level: 'info', message: 'VLM 判官：z-ai 内置（云沙箱）' });
  }
  // R209: 图源链 upfront 公告（仅 MiniMax 路径激活时 —— 沙箱内 zai 图源
  // 行为不变，不加噪声）。z-ai 优先（免费）→ MiniMax web_search（联网检索
  // 网页 + 服务端提取配图）→ Wikimedia Commons（免密钥兜底）。
  if (mmCfg) {
    const mmDead = minimaxWebSearchFailureReason();
    emit({
      stage: 'figure-web',
      level: 'info',
      message: zaiOk
        ? `web 图源链：z-ai image-search（优先）→ ${mmCfg.displayName} web_search（联网检索网页，模型 ${mmCfg.model}）→ Wikimedia Commons（兜底）`
        : `web 图源链：${mmCfg.displayName} web_search（联网检索网页，模型 ${mmCfg.model}；z-ai CLI 本机不可用）→ Wikimedia Commons（兜底）`,
    });
    if (mmDead) {
      mmDeadAnnounced = true;
      emit({ stage: 'figure-web', level: 'warn', message: `⚠ ${mmCfg.displayName} web_search 本次会话不可用：${mmDead.slice(0, 160)}—— web 图源回退 Wikimedia Commons` });
    }
  }

  // R193: 首查短路标记（函数级 —— 本次评估内 CLI 首查即挂则后续 query
  // 不再空等超时；R205 起改为直走 Commons，而非整体放弃）+ 首查标志。
  let cliBrokenThisRun = false;
  let cliCalled = false;
  // R205: provider 判官定性失败的一次性提示标志（逐张重复弹同一原因噪声大）。
  let providerDeadAnnounced = false;

  // R206: PDB_FIGURES_FORCE_COMMONS=1 —— 强制 Wikimedia Commons 图源（跳过
  // z-ai CLI 搜索与 R209 MiniMax web_search；VLM 判官路径不变，沙箱内仍
  // z-ai 内置优先）。用途：本地部署图源效果对比/演示。复用现成短路机制：
  // 预置 cliBrokenThisRun → 所有 query 直走 Commons 分支（与 CLI 首查 ENOENT
  // 后的行为完全一致）。R209 起本标志同时使 mmCfg 置空（见图源链公告上方）。
  if (forceCommonsOnly) {
    cliBrokenThisRun = true;
    emit({ stage: 'figure-web', level: 'info', message: 'PDB_FIGURES_FORCE_COMMONS=1 —— 本次运行强制 Wikimedia Commons 图源（跳过 z-ai image-search 与 MiniMax web_search，VLM 判官不变）' });
  }

  for (const { sectionId, query } of capped) {
    if (signal?.aborted) { // R197: 配图可选 —— 中止即返回已收集图
      emit({ stage: 'figure-web', level: 'info', message: `已中止，返回已收集的 ${out.length} 张 web 配图` });
      return out;
    }
    let results: ImageSearchResult[] = [];
    let viaCommons = false;
    // R209: MiniMax web_search 图源命中标记（「返回 N 条候选」消息三分流）。
    let viaMinimax = false;
    const cacheKey = String(query).trim().toLowerCase();

    // ── 图源 1：z-ai image-search CLI（本次运行未定性不可用时尝试）。
    if (!cliBrokenThisRun) {
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
        if (run.ok) {
          results = run.results;
          // R193: 写入会话缓存（含零结果 —— 零结果同样是有效答案，防重复搜索）。
          if (imageSearchCache.size > 200) imageSearchCache.clear();
          imageSearchCache.set(cacheKey, results);
        } else {
          if (isFirstCliCall) {
            // 首查即失败：CLI 挂死/未安装 —— 本次评估内不再尝试（R205：
            // 后续 query 直走 Commons，而非整体放弃）。ENOENT（本地部署
            // 常态，环境能力差异）与挂起/超时（本环境偶发故障）分开提示。
            cliBrokenThisRun = true;
            emit(run.enoent
              ? { stage: 'figure-web', level: 'info', message: 'z-ai CLI 本机未安装（本地部署常态）—— web 图源改用 Wikimedia Commons（免密钥）' }
              : { stage: 'figure-web', level: 'warn', message: '⚠ image-search CLI 调用失败 —— web 图源改用 Wikimedia Commons 兜底' });
          } else {
            emit({ stage: 'figure-web', level: 'warn', message: '⚠ image-search 调用失败（该 query 改用 Wikimedia Commons）' });
          }
        }
      }
    } else {
      // CLI 本次运行已定性不可用 → 直落 R209 MiniMax web_search / Commons（下方分支）
    }

    // ── 图源 2（R209: 本地主路径）：z-ai 零结果/不可用时 → MiniMax web_search
    // 服务端联网检索 —— 用户诉求：Commons 召回质量不佳（严格 AND 词项匹配的
    // 检索模型与科学主题描述不匹配），MiniMax web_search 为语义化联网搜索，
    // 由模型自主多次搜索并返回最可能包含高质量配图的网页，服务端抓取页面后
    // 提取 <img> 候选（提取/过滤/排序见 extractImagesFromPageHtml）。
    // 仅已配置 MiniMax provider 时激活；零候选/不可用 → 落 Commons 兜底。
    if (results.length === 0 && mmCfg && !minimaxWebSearchFailureReason()) {
      const mmKey = `minimax:${cacheKey}`;
      const mmCached = imageSearchCache.get(mmKey);
      if (mmCached) {
        results = mmCached;
        if (results.length > 0) viaMinimax = true;
        emit({ stage: 'figure-web', level: 'info', message: `命中 MiniMax web_search 会话缓存（${results.length} 条候选）：「${query}」` });
      } else {
        emit({ stage: 'figure-web', level: 'info', message: `${mmCfg.displayName} web_search 联网检索网页（服务端工具，模型自主搜索）：「${query}」…` });
        const mmr = await searchMinimaxWebFigures(query, mmCfg, {
          signal,
          onSearched: (qs) => {
            if (qs.length > 0) emit({ stage: 'figure-web', level: 'info', message: `模型搜索词：${qs.slice(0, 4).join(' / ')}` });
          },
        });
        if (imageSearchCache.size > 200) imageSearchCache.clear();
        imageSearchCache.set(mmKey, mmr); // 含零结果 —— 零结果同样是有效答案
        results = mmr;
        if (results.length > 0) viaMinimax = true;
        if (results.length === 0 && minimaxWebSearchFailureReason() && !mmDeadAnnounced) {
          mmDeadAnnounced = true;
          emit({ stage: 'figure-web', level: 'warn', message: `⚠ ${mmCfg.displayName} web_search 不可用：${(minimaxWebSearchFailureReason() || '').slice(0, 160)}—— 该 query 改用 Wikimedia Commons` });
        }
      }
    }

    // ── 图源 3（兜底）：z-ai/MiniMax 零结果或不可用时 → Wikimedia Commons
    // （免密钥）。沙箱内 z-ai 正常但某 query 零结果时也会走到这里（Commons
    // 补充覆盖，~1s 开销；各图源互不重叠时各出各的图，上游有结果则不叠加）。
    if (results.length === 0) {
      viaCommons = true;
      const commonsKey = `commons:${cacheKey}`;
      const commonsCached = imageSearchCache.get(commonsKey);
      if (commonsCached) {
        results = commonsCached;
        emit({ stage: 'figure-web', level: 'info', message: `命中 Commons 会话缓存（${results.length} 条候选）：「${query}」` });
      } else {
        emit({ stage: 'figure-web', level: 'info', message: `Wikimedia Commons 搜索（免密钥图源）：「${query}」…` });
        const cr = await searchCommonsFigures(query, signal);
        if (imageSearchCache.size > 200) imageSearchCache.clear();
        imageSearchCache.set(commonsKey, cr);
        results = cr;
      }
    }

    if (results.length === 0) {
      emit({ stage: 'figure-web', level: 'warn', message: `⚠ web 图源无结果（跳过该 query，继续）` });
      continue;
    }
    emit({ stage: 'figure-web', level: 'info', message: `${viaMinimax ? 'MiniMax web_search' : viaCommons ? 'Wikimedia Commons' : 'image-search'} 返回 ${results.length} 条候选，逐张 VLM 校验（宁缺毋滥）…` });

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
      // R206b: 硬失败 URL 跳过（下载/判官确定性失败，重试纯浪费配额）。
      if (hardFailedUrls.has(url)) continue;
      const fig: ReportFigure = {
        kind: 'web',
        url,
        caption: (r.caption || query).slice(0, 60),
        source: r.source || 'web image search',
        sectionId,
        status: 'searching',
      };
      emit({ stage: 'figure-web', level: 'info', message: `VLM 校验中：${url.slice(0, 70)}…`, dshFigure: fig });

      // 下载 → VLM 判官（R205: 双路径调度，见 verifyFigureWithVlm）。
      let verdict: { verdict: 'relevant' | 'irrelevant'; reason: string; caption?: string } | null = null;
      let downloadFailed = false;
      try {
        const dataUri = await downloadImageAsDataUri(url, signal);
        if (!dataUri) {
          downloadFailed = true;
        } else {
          verdict = await verifyFigureWithVlm(dataUri, query, signal, llmCfg);
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
        // R205: 判官不可用且已定性（如 provider 4xx/无 key）→ 首次给出原因，
        // 后续拒图理由带上定性标记（本地无判官场景用户能看懂为何全军覆没）。
        const pvReason = providerVisionFailureReason();
        if (pvReason && !providerDeadAnnounced) {
          providerDeadAnnounced = true;
          emit({ stage: 'figure-web', level: 'warn', message: `⚠ provider 视觉判官本次会话不可用：${pvReason.slice(0, 160)}（后续 web 候选图将直接拒绝）` });
        }
        fig.vlmReason = pvReason ? 'VLM 校验失败（判官不可用）' : 'VLM 校验失败';
      }
      // R206b: 硬失败（下载失败或判官未给出裁决）进 run 级集合，后续 query 不再重试。
      if (downloadFailed || !verdict) hardFailedUrls.add(url);

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
