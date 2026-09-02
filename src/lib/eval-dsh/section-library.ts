// src/lib/eval-dsh/section-library.ts
//
// R179 (Task 2-a): DSH 模式（DeepSeek-Harness-inspired agent mode）章节库。
//
// 经典管线（/api/evaluations/run）使用固定 8 章报告模板；DSH 模式改为
// 「agent 先分析所有数据源 → 规划大纲（基础评估章节必含 + 问题深挖章节）→ 逐章撰写」。
// R184: 大纲规则变更 —— 即使写了聚焦的科学问题，报告也必须包含基本的
// 评估内容（功能/PDB 资源/结构质量/成药性等），问题相关章节只是「额外
// 重点讨论」，不再因聚焦而挤掉基础章节；总章节数上限 9 → 14。
// 本文件是章节的唯一事实来源（single source of truth）：
//   - 大纲规划器（agent.ts Phase C）读取 id/中文标题/purpose 来选章节；
//   - 逐章撰写器（agent.ts Phase E）读取 contentSpec/min-max words 来约束
//     每章内容与字数；
//   - 前端（Task 2-b）通过 SSE dshOutline 事件拿到同样的 id/title。
//
// 与经典模板的 REPORT_OUTLINE_ZH 不同，这里 fixed:'first'/'last-1'/'last'
// 标记了强制位置章节（summary 永远第一、references 永远倒数第二、
// conclusion 永远最后），中间章节按与科学问题的相关性选取。

/** 数据源提示 —— 决定逐章撰写时把哪些数据块放进该章的 user prompt。 */
export type DataHint = 'uniprot' | 'rcsb' | 'blast' | 'literature' | 'scores';

export interface SectionTemplate {
  /** 章节库内唯一 id（大纲规划器只允许输出这些 id）。 */
  id: string;
  /** 章节中文标题 —— H2 标题必须精确使用该字符串（格式稳定性约束）。 */
  titleZh: string;
  /** 英文标题（供日志 / 调试 / 前端 fallback）。 */
  titleEn: string;
  /** 一句话写作目的（给大纲规划器看，帮助它判断相关性）。 */
  purpose: string;
  /** 3-5 条内容要求（给逐章撰写器看的 bullet 清单）。 */
  contentSpec: string;
  /** 该章允许引用的数据源（过滤共享数据上下文）。 */
  dataHints: Array<DataHint>;
  /** 配图建议（提示大纲规划器 / 配图阶段该章适合什么图）。 */
  figureHint?: string;
  /** 强制位置：首章 / 倒数第二章 / 末章。未标记的章节为可选中间章节。 */
  fixed?: 'first' | 'last-1' | 'last';
  /** 正文最少字数（references 章豁免）。 */
  minWords: number;
  /** 正文最多字数（references 章豁免）。 */
  maxWords: number;
  /** R189: 该章作为「问题深挖」章节撰写时的字数要求（缺失则用 min/maxWords
   * 的 1.6x/1.8x 兜底）。加大聚焦问题的回答篇幅 —— 用户诉求：深挖章必须
   * 充分展开而非点到为止。基础评估模式（无科学问题）仍用 min/maxWords。 */
  deepWords?: { min: number; max: number };
}

/**
 * R179 (Task 2-a): 精选章节库 —— 19 个章节。
 * id 必须保持稳定（持久化在 SkillEvaluationReport.outline JSON 里，
 * 前端也依赖这些 id 渲染），新增章节只能 append，不能改名。
 */
export const SECTION_LIBRARY: SectionTemplate[] = [
  {
    id: 'summary',
    titleZh: '执行摘要',
    titleEn: 'Executive Summary',
    purpose: '用 2-3 句话直接回答用户提出的科学问题，并给出关键数字与总体结论。',
    contentSpec: [
      '- 第一句：重述问题并给出明确结论（可回答 / 部分可回答 / 数据不足）',
      '- 引用关键数字：直接 PDB 数、最高分辨率、Overall 评分、最高 IF 文献',
      '- 结尾一句话给出推荐的下一步方向',
    ].join('\n'),
    dataHints: ['uniprot', 'rcsb', 'blast', 'literature', 'scores'],
    fixed: 'first',
    minWords: 250,
    maxWords: 500,
    // R189: 有科学问题时摘要也要加长（开篇直接回答问题的空间）。
    deepWords: { min: 350, max: 700 },
  },
  {
    id: 'question_focus',
    titleZh: '问题聚焦与评估范围',
    titleEn: 'Question Focus & Evaluation Scope',
    purpose: '重述科学问题并开篇直接回答（能答到什么程度答什么），再界定评估数据范围与可回答度。',
    contentSpec: [
      // R187: 用户反馈「聚焦问题的讨论太简略、没有直接回答问题」——本章
      // 必须结论先行，直接给出答案要点，再谈口径与范围。
      '- 开篇「直接回答」：先用 2-4 句或要点清单直接回答科学问题（数据能答到什么程度就答什么，逐条给出答案；无法回答的部分明确说明缺什么数据），不得只做问题重述/范围界定/可回答度铺垫',
      '- 随后逐字重述用户的科学问题，并解释其中关键术语的评估口径',
      '- 列出本次实际查询的数据源（UniProt / RCSB / BLAST / PubMed / 评分）与各自规模',
      '- 明确说明哪些问题超出本次数据范围（如临床数据、专利、竞品管线）',
      '- 给出可回答度评级（高/中/低）及理由',
    ].join('\n'),
    dataHints: ['uniprot', 'rcsb', 'blast', 'literature', 'scores'],
    // R179 (Task 2-a): DSH 模式强制章节 —— 永远位于第 2 位（大纲修复器 force-insert）。
    minWords: 300,
    maxWords: 700,
    // R189: 加大聚焦问题的直接回答篇幅。
    deepWords: { min: 500, max: 1000 },
  },
  {
    id: 'function',
    titleZh: '靶点功能与生物学背景',
    titleEn: 'Target Function & Biological Background',
    purpose: '概述靶点的核心生物学功能、调控机制与疾病关联。',
    contentSpec: [
      '- 基于蛋白名 / 基因名 / 物种描述核心功能与所属蛋白家族',
      '- 说明已知的调控机制（翻译后修饰、剪接变体、激活/失活开关）',
      '- 关联的疾病与生理过程（引用文献标题/摘要中的证据）',
    ].join('\n'),
    dataHints: ['uniprot', 'literature'],
    minWords: 250,
    maxWords: 500,
  },
  {
    id: 'pathway',
    titleZh: '信号通路与调控网络',
    titleEn: 'Signaling Pathway & Regulatory Network',
    purpose: '描述靶点所在的信号通路、上下游调控关系与网络位置。',
    contentSpec: [
      '- 描述靶点所在的主要信号通路及其在通路中的位置（上游/下游/枢纽）',
      '- 列出已知的上游激活因子与下游效应分子',
      '- 讨论通路层面的代偿/冗余对成药性的影响',
    ].join('\n'),
    dataHints: ['uniprot', 'literature'],
    figureHint: '信号通路示意图',
    minWords: 250,
    maxWords: 500,
    deepWords: { min: 450, max: 900 },
  },
  {
    id: 'topology',
    titleZh: '序列特征与拓扑结构',
    titleEn: 'Sequence Features & Topology',
    purpose: '分析序列长度、跨膜区/信号肽等拓扑特征与二级结构倾向。',
    contentSpec: [
      '- 基于序列长度与已知结构推断整体拓扑（球状/膜蛋白/纤维状）',
      '- 说明信号肽、跨膜螺旋、二硫键、无序区等关键序列特征',
      '- 讨论拓扑对可表达性/可结晶性的影响',
    ].join('\n'),
    dataHints: ['uniprot', 'rcsb'],
    minWords: 250,
    maxWords: 500,
    deepWords: { min: 450, max: 900 },
  },
  {
    id: 'domains',
    titleZh: '结构域与关键位点',
    titleEn: 'Domains & Key Sites',
    purpose: '解析结构域划分、催化/结合位点等关键功能位点。',
    contentSpec: [
      '- 列出主要结构域及其大致边界与功能',
      '- 标注催化残基、结合口袋、翻译后修饰位点等关键位点',
      '- 结合 PDB 结构说明哪些位点已有结构证据覆盖',
    ].join('\n'),
    dataHints: ['uniprot', 'rcsb', 'literature'],
    minWords: 250,
    maxWords: 500,
    deepWords: { min: 450, max: 900 },
  },
  {
    id: 'pdb_analysis',
    titleZh: '现有 PDB 结构资源',
    titleEn: 'Existing PDB Structure Resources',
    purpose: '盘点 RCSB 直接命中的 PDB 结构资源：方法学分布、代表性结构与配体覆盖。',
    contentSpec: [
      '- 统计 X-ray / Cryo-EM / NMR 结构数量与占比（引用具体数字）',
      '- 列出 3-5 个代表性结构（PDB ID + 方法 + 分辨率 + 配体）',
      '- 指出尚未覆盖的构象状态/区域（研究空白）',
    ].join('\n'),
    dataHints: ['rcsb', 'scores'],
    minWords: 250,
    maxWords: 500,
  },
  {
    id: 'structure_quality',
    titleZh: '代表性结构质量评估',
    titleEn: 'Representative Structure Quality',
    purpose: '评估代表性结构的分辨率、方法学质量与适用场景。',
    contentSpec: [
      '- 按分辨率排序评述最佳结构（PDB ID + 分辨率 + 方法）',
      '- 讨论配体结合态 vs apo 态结构对药物设计的可用性差异',
      '- 给出「该用哪个结构做什么」的具体建议',
    ].join('\n'),
    dataHints: ['rcsb', 'scores'],
    minWords: 250,
    maxWords: 500,
  },
  {
    id: 'ligand_binding',
    titleZh: '配体结合与口袋特征',
    titleEn: 'Ligand Binding & Pocket Features',
    purpose: '分析已解析的配体、结合口袋特征与可药性线索。',
    contentSpec: [
      '- 列出 PDB 结构中出现的配体（引用数据表中 ligands 字段）',
      '- 讨论配体结合位点的保守性与口袋特征（深/浅、疏水/极性）',
      '- 评估内源性配体/辅因子对抑制剂设计的启示',
    ].join('\n'),
    dataHints: ['rcsb', 'literature'],
    minWords: 250,
    maxWords: 500,
    deepWords: { min: 450, max: 900 },
  },
  {
    id: 'interactions',
    titleZh: '分子相互作用与复合物',
    titleEn: 'Molecular Interactions & Complexes',
    purpose: '开篇用伙伴-功能对照表直接回答「与谁有复合物、各自什么功能」，再展开互作界面与靶点可行性。',
    contentSpec: [
      // R187: 结论先行 —— 伙伴清单表格是本章的第一件交付物。
      '- 开篇直接回答：第一个子节必须是一个 Markdown 表格，列出全部已解析的互作/复合物伙伴，列：互作伙伴 | 结构证据（PDB ID + 方法/分辨率，或 PMID） | 生物学功能（一句话）',
      '- 每个互作伙伴的生物学功能必须用完整句子明确表述（如「介导 X 信号」「调控 Y 过程」），不能只罗列结构条目或 PDB 编号',
      '- 表格之后逐个展开关键伙伴：互作界面特征、热点残基（引用文献证据）',
      '- 区分两类证据：已有复合物结构的（引 PDB）vs 仅文献/数据库支持的（引 PMID 并注明「暂无结构」）',
      '- 评估互作界面作为药物靶点的可行性',
    ].join('\n'),
    dataHints: ['rcsb', 'literature'],
    minWords: 400,
    maxWords: 900,
    // R189: 复合物/互作章是聚焦问题的核心展开位，篇幅进一步加大。
    deepWords: { min: 700, max: 1600 },
  },
  {
    id: 'variants',
    titleZh: '变异、突变与疾病关联',
    titleEn: 'Variants, Mutations & Disease Associations',
    purpose: '综合已知突变/变异及其功能与疾病关联证据。',
    contentSpec: [
      '- 列出文献与结构中出现的疾病相关突变（引用 PMID）',
      '- 讨论突变对结构/功能/结合的影响机制',
      '- 说明变异证据对靶点选择的启示',
    ].join('\n'),
    dataHints: ['uniprot', 'literature'],
    minWords: 250,
    maxWords: 500,
    deepWords: { min: 450, max: 900 },
  },
  {
    id: 'expression',
    titleZh: '组织表达与亚细胞定位',
    titleEn: 'Tissue Expression & Subcellular Localization',
    purpose: '总结组织表达谱与亚细胞定位对成药性与给药策略的影响。',
    contentSpec: [
      '- 描述靶点的亚细胞定位（膜表面/胞内/分泌）与可达性',
      '- 综述组织表达谱证据（引用文献）',
      '- 讨论表达模式对适应症选择与毒性的影响',
    ].join('\n'),
    dataHints: ['uniprot', 'literature'],
    minWords: 250,
    maxWords: 500,
    deepWords: { min: 450, max: 900 },
  },
  {
    id: 'homology',
    titleZh: '同源蛋白与进化保守性',
    titleEn: 'Homologs & Evolutionary Conservation',
    purpose: '基于 BLAST 同源结果分析直系/旁系同源与保守性。',
    contentSpec: [
      '- 统计 BLAST 同源命中（总数、identity 分布、≥95% 的近缘同源数）',
      '- 讨论关键残基/口袋的跨物种保守性（引用 identity 数据）',
      '- 评估旁系同源选择性抑制的风险（脱靶可能性）',
    ].join('\n'),
    dataHints: ['blast'],
    minWords: 250,
    maxWords: 500,
    deepWords: { min: 450, max: 900 },
  },
  {
    id: 'druggability',
    titleZh: '成药性评估',
    titleEn: 'Druggability Assessment',
    purpose: '综合评估靶点作为小分子/生物药靶点的成药性。',
    contentSpec: [
      '- 给出成药性总评（适合小分子 / 适合生物药 / 困难靶点）及理由',
      '- 结合口袋特征、配体证据与评分数据论证',
      '- 对标同类已上市/在研药物的先例（仅引用给定文献，不编造）',
    ].join('\n'),
    dataHints: ['rcsb', 'scores', 'literature'],
    minWords: 250,
    maxWords: 500,
    deepWords: { min: 400, max: 800 },
  },
  {
    id: 'experimental',
    titleZh: '实验策略建议',
    titleEn: 'Experimental Strategy Recommendations',
    purpose: '针对用户的科学问题给出下一步实验策略建议。',
    contentSpec: [
      '- 推荐结构生物学实验路线（表达构建 / 方法选择 / 时间预估）',
      '- 推荐验证实验（结合/活性/细胞实验）与关键读出',
      '- 指出最关键的实验风险与规避方案',
    ].join('\n'),
    dataHints: ['rcsb', 'scores', 'blast'],
    minWords: 250,
    maxWords: 500,
    deepWords: { min: 450, max: 900 },
  },
  {
    id: 'literature',
    titleZh: '关键文献证据综合',
    titleEn: 'Key Literature Evidence Synthesis',
    purpose: '按主题综合最高证据等级的文献（高 IF 优先），而非逐篇罗列。',
    contentSpec: [
      '- 按主题（机制/结构/药理/疾病）归类综合文献证据',
      '- 每条证据引用 PMID 与期刊（含 IF）',
      '- 指出文献证据之间的矛盾或空白',
    ].join('\n'),
    dataHints: ['literature'],
    minWords: 250,
    maxWords: 500,
  },
  {
    id: 'risks',
    titleZh: '风险与不确定性',
    titleEn: 'Risks & Uncertainties',
    purpose: '如实列出本次评估的数据局限、结论不确定性与主要风险。',
    contentSpec: [
      '- 列出数据层面的局限（结构覆盖空白、文献偏倚、评分启发式）',
      '- 说明哪些结论是推断而非直接证据',
      '- 给出降低不确定性的建议动作',
    ].join('\n'),
    dataHints: ['uniprot', 'rcsb', 'blast', 'literature', 'scores'],
    minWords: 250,
    maxWords: 500,
  },
  {
    id: 'references',
    titleZh: '参考文献',
    titleEn: 'References',
    purpose: '以固定列表格式给出本报告引用的文献。',
    contentSpec: [
      '- 列表格式：`- [PMID] 标题 — 期刊 (年)`，每行一条',
      '- 只引用数据上下文中真实存在的 PMID',
      '- 按重要性排序（与用户问题最相关 / IF 最高优先）',
    ].join('\n'),
    dataHints: ['literature'],
    fixed: 'last-1',
    // R179 (Task 2-a): references 是列表章，字数约束豁免（允许更短/更长）。
    minWords: 40,
    maxWords: 2000,
  },
  {
    id: 'conclusion',
    titleZh: '总结与展望',
    titleEn: 'Conclusion & Outlook',
    purpose: '收束全报告：核心结论、对用户问题的最终回答与展望。',
    contentSpec: [
      '- 2-3 句核心结论（直接回答科学问题）',
      '- 一句话概括最大优势与最大风险',
      '- 展望 6-12 个月内最有价值的一个行动',
    ].join('\n'),
    dataHints: ['uniprot', 'rcsb', 'blast', 'literature', 'scores'],
    fixed: 'last',
    minWords: 250,
    maxWords: 500,
    // R189: 有问题时结论章须收束问题的最终回答，篇幅加长。
    deepWords: { min: 400, max: 800 },
  },
];

/** 按 id 查章节模板；未知 id 返回 undefined。 */
export function getSection(id: string): SectionTemplate | undefined {
  return SECTION_LIBRARY.find((s) => s.id === id);
}

// ─── R208: 数据规模评级（动态篇幅机制）──────────────────────────────────────

/**
 * R208: 数据规模五档 —— 报告篇幅随数据源规模伸缩。
 * 用户诉求：数据源少 → 报告精简（不注水）；数据源多 → 报告加长加深、
 * 覆盖更多数据条目（避免大量数据未被提及）；总结尽量全面。
 *
 * 评级输入 = 四类数据源计数（PDB / BLAST / 文献 / 相关性分析点名的重点
 * 结构数）；产物 = 大纲章节区间（outlineRules 消费）+ 每章字数乘数 +
 * 章节生成 maxChars 分档 + 覆盖下限（agent.ts Phase E 消费）。
 */
export type DataScaleTier = 'sparse' | 'lean' | 'standard' | 'rich' | 'abundant';

/** computeDataScale 的输入 —— 由调用方从 CollectResult 导出。 */
export interface DataScaleInput {
  /** 直接命中的 PDB 结构数（pdbRows.length）。 */
  pdbCount: number;
  /** BLAST 同源命中数（skippedBlast 时传 0）。 */
  blastCount: number;
  /** PubMed 文献数。 */
  literatureCount: number;
  /** 相关性分析点名的重点结构数（无问题模式传 0）。 */
  keyPicks?: number;
}

/** 评级产物（纯数据，无副作用 —— 可直接单测）。 */
export interface DataScalePolicy {
  tier: DataScaleTier;
  /** 中文档名（SSE 事件 / provenance 展示）。 */
  tierZh: string;
  /** 评级分 0-8（可解释性：各数据源分项之和，事件与 provenance 呈现）。 */
  score: number;
  /** 每章正文字数乘数（min/max 同乘；sparse 0.65 → abundant 1.3）。 */
  wordFactor: number;
  /** 问题深挖章数量区间（仅问题模式生效；标准档 = R189 的 1-6 不变）。 */
  questionExtraMin: number;
  questionExtraMax: number;
  /** 基础章生成 maxChars（R208 前固定 6000）。 */
  maxCharsBase: number;
  /** 深挖章生成 maxChars（R208 前固定 9000）。 */
  maxCharsDeep: number;
  /** pdb_analysis 章「代表性结构」点名下限（R207 前 contentSpec 固定 3-5）。 */
  representativePdbMin: number;
  /** literature 章「引用不同 PMID」下限。 */
  literatureCiteMin: number;
  /** 大纲规划 prompt 注入的篇幅策略指令（不含评级名 —— 调用方拼装）。 */
  directive: string;
}

/**
 * R208: 数据规模评级（纯函数）。
 * 分项打分：PDB（≥60→3 / ≥25→2 / ≥8→1）、BLAST（≥40→2 / ≥15→1）、
 * 文献（≥15→2 / ≥6→1）、重点结构（≥8→1），总分 0-8 映射五档。
 * 分档阈值锚定真实 E2E 数据形态：P69905（80 PDB + 50 BLAST + 20 文献）
 * = abundant；小众靶点（<8 PDB + 无 BLAST + <6 文献）= sparse。
 */
export function computeDataScale(input: DataScaleInput): DataScalePolicy {
  const pdb = input.pdbCount >= 60 ? 3 : input.pdbCount >= 25 ? 2 : input.pdbCount >= 8 ? 1 : 0;
  const blast = input.blastCount >= 40 ? 2 : input.blastCount >= 15 ? 1 : 0;
  const lit = input.literatureCount >= 15 ? 2 : input.literatureCount >= 6 ? 1 : 0;
  const picks = (input.keyPicks ?? 0) >= 8 ? 1 : 0;
  const score = pdb + blast + lit + picks;
  const tier: DataScaleTier =
    score <= 1 ? 'sparse' : score === 2 ? 'lean' : score <= 4 ? 'standard' : score <= 6 ? 'rich' : 'abundant';
  switch (tier) {
    case 'sparse':
      return {
        tier, tierZh: '数据稀疏', score, wordFactor: 0.65,
        questionExtraMin: 1, questionExtraMax: 2,
        maxCharsBase: 3200, maxCharsDeep: 5200,
        representativePdbMin: 2, literatureCiteMin: 2,
        directive: '数据源稀少 —— 报告保持精炼：问题深挖章宁少勿多（取区间下限），各章按「本章字数要求」的下限一侧撰写，不注水、不重复罗列本就稀少的数据；宁可短而实，不可长而空',
      };
    case 'lean':
      return {
        tier, tierZh: '数据有限', score, wordFactor: 0.8,
        questionExtraMin: 1, questionExtraMax: 3,
        maxCharsBase: 4500, maxCharsDeep: 7200,
        representativePdbMin: 3, literatureCiteMin: 3,
        directive: '数据源有限 —— 篇幅适度收紧：问题深挖章取区间中低位，各章按字数要求的中下限撰写，把有限数据讲透即可，无需展开冗余讨论',
      };
    case 'rich':
      return {
        tier, tierZh: '数据丰富', score, wordFactor: 1.15,
        questionExtraMin: 2, questionExtraMax: 7,
        maxCharsBase: 7200, maxCharsDeep: 10800,
        representativePdbMin: 6, literatureCiteMin: 6,
        directive: '数据源丰富 —— 报告应更详细：问题深挖章取区间中高位，各章充分展开；点名结构与引用文献的覆盖面要跟上数据规模（结构点名 ≥6、文献引用 ≥6 量级），避免大量数据未被提及',
      };
    case 'abundant':
      return {
        tier, tierZh: '数据海量', score, wordFactor: 1.3,
        questionExtraMin: 3, questionExtraMax: 8,
        maxCharsBase: 8400, maxCharsDeep: 12600,
        representativePdbMin: 8, literatureCiteMin: 8,
        directive: '数据源海量 —— 报告应全面详尽：问题深挖章取区间上限，各章充分展开；数据覆盖要求相应提高（代表性结构点名 ≥8、文献引用 ≥8 量级），大量结构/文献未被提及是不可接受的',
      };
    default: // standard（R208 前的行为基准）
      return {
        tier, tierZh: '数据中等', score, wordFactor: 1.0,
        questionExtraMin: 1, questionExtraMax: 6,
        maxCharsBase: 6000, maxCharsDeep: 9000,
        representativePdbMin: 4, literatureCiteMin: 4,
        directive: '数据规模中等 —— 按标准篇幅撰写',
      };
  }
}

/**
 * 数据可用性信号 —— 决定哪些「基础评估章节」有数据支持（R184）。
 * 由调用方从 CollectResult 导出；repairOutline / 大纲规划 prompt 共用。
 */
export interface OutlineDataInfo {
  hasPdb: boolean;
  hasBlast: boolean;
  hasLiterature: boolean;
}

/**
 * R184: 基础评估章节（无论科学问题多聚焦都必须包含的标准评估内容）。
 *
 * 核心四席：function（生物学背景）/ pdb_analysis（结构资源盘点）/
 * structure_quality（质量评估）/ druggability（成药性评估）。
 * 条件席位：literature（有 PubMed 文献时）/ homology（有 BLAST 同源时）。
 * 数据缺省时保守处理：默认 hasPdb=true（PDB 是本应用核心），
 * hasBlast/hasLiterature 默认 false（避免生成空章节）。
 *
 * 返回顺序即报告中的标准排列顺序（叙事顺序，修复器按此插入）。
 */
export function baselineSectionIds(data?: Partial<OutlineDataInfo>): string[] {
  const hasPdb = data?.hasPdb ?? true;
  const hasBlast = data?.hasBlast ?? false;
  const hasLiterature = data?.hasLiterature ?? false;
  return [
    'function',
    ...(hasPdb ? ['pdb_analysis', 'structure_quality'] : []),
    'druggability',
    ...(hasLiterature ? ['literature'] : []),
    ...(hasBlast ? ['homology'] : []),
  ];
}

/**
 * 大纲规则（给大纲规划 LLM 的 system prompt 片段 + 本地修复器的依据）。
 * R179 (Task 2-a): question_focus 在 DSH 模式下为强制章节（位置 2）。
 * R184: 基础评估章节必含（数据驱动）+ 问题深挖章节额外叠加；总上限 14。
 * R189: ① 科学问题可为空 —— noQuestion 模式下无 question_focus、无深挖
 * 章节，大纲确定性生成（基础评估口径，与 classic 对齐）；② 有问题时深挖
 * 章节上限 4→6（加大聚焦问题的回答篇幅），总上限 14→16。
 * R208: opts.scale（数据规模评级）—— 深挖章区间与总章节数随数据源规模
 * 五档伸缩（sparse 1-2/约10 → abundant 3-8/最多18）；缺省 = 标准档
 * （R189 基准不变，向后兼容）。
 */
export interface OutlineRules {
  totalMin: number;
  totalMax: number;
  mandatoryFirst: string;
  /** 无问题模式为空串（不插入 question_focus）。 */
  mandatorySecond: string;
  mandatoryTail: string[];
  /** 基础评估章节 id（数据驱动，见 baselineSectionIds()）。 */
  baselineIds: string[];
  /** 问题深挖章节的数量区间（在基础章节之外额外叠加；无问题模式为 0/0）。 */
  questionExtraMin: number;
  questionExtraMax: number;
  /** 可选中间章节池（19 - 4 个强制位，含基础章节与问题深挖章节）。 */
  optionalIds: string[];
  formatStability: string[];
}

export function outlineRules(
  data?: Partial<OutlineDataInfo>,
  opts?: { noQuestion?: boolean; scale?: DataScalePolicy },
): OutlineRules {
  const baselineIds = baselineSectionIds(data);
  const noQuestion = !!opts?.noQuestion;
  // R208: 数据规模评级 —— 问题模式下深挖章区间 / 总章节数随数据源规模
  // 伸缩（sparse 收紧 → abundant 放宽）；scale 缺省时保持 R189 基准
  //（1-6 / 16，向后兼容）。基础评估模式大纲确定性生成，scale 不改章节
  // 结构 —— 但 Phase E 的每章字数乘数与 maxChars 分档照常生效。
  const scale = opts?.scale;
  const extraMin = scale?.questionExtraMin ?? 1;
  const extraMax = scale?.questionExtraMax ?? 6;
  // 无问题模式：大纲确定性 = 1 summary + 基础章节 + 2 tail（无深挖空间）。
  const fixedCount = noQuestion ? 3 : 4;
  const baseTotal = fixedCount + baselineIds.length;
  if (noQuestion) {
    return {
      totalMin: baseTotal,
      totalMax: baseTotal,
      mandatoryFirst: 'summary',
      mandatorySecond: '',
      mandatoryTail: ['references', 'conclusion'],
      baselineIds,
      questionExtraMin: 0,
      questionExtraMax: 0,
      optionalIds: SECTION_LIBRARY
        .filter((s) => !s.fixed)
        .map((s) => s.id),
      formatStability: [
        `总章节数 ${baseTotal}：首章 summary，倒数第 2 章 references，末章 conclusion`,
        '基础评估模式（未提供科学问题）：只含基础评估章节，不插入问题聚焦章',
        '同一章节不得重复出现；章节顺序一经确定不再改变',
        '每章 H2 标题必须精确使用章节库的中文章节名（一字不差）',
      ],
    };
  }
  // R208: 总章节数动态化 —— 4 强制位 + 基础章节（数据驱动，至多 6）+
  // 深挖章区间（scale 分档）。标准档 = 4 + max(6,4) + 6 = 16（与 R189
  // 一致）；abundant = 4 + 6 + 8 = 18（章节库 19 个 id 内可行）；
  // sparse ≈ 10-12（深挖章上限 2）。
  const dynTotalMax = 4 + Math.max(baselineIds.length, 4) + extraMax;
  return {
    totalMin: 4 + extraMin,
    totalMax: dynTotalMax,
    mandatoryFirst: 'summary',
    // DSH 模式特有：问题聚焦章强制第 2 位。
    mandatorySecond: 'question_focus',
    mandatoryTail: ['references', 'conclusion'],
    baselineIds,
    // R189: 4→6 —— 用户要求加大聚焦问题回答占报告的篇幅（标准档基准）。
    questionExtraMin: extraMin,
    questionExtraMax: extraMax,
    optionalIds: SECTION_LIBRARY
      .filter((s) => !s.fixed && s.id !== 'question_focus')
      .map((s) => s.id),
    formatStability: [
      `总章节数 ${4 + extraMin}-${dynTotalMax}：首章 summary，第 2 章 question_focus，倒数第 2 章 references，末章 conclusion`,
      '基础评估章节必须全部包含（有数据支持的那些）——科学问题再聚焦，功能背景/PDB 资源/结构质量/成药性等标准评估内容也不可省略，只是顺带联系问题',
      `在基础章节之外，按与科学问题的相关性从章节库其余 optional id 中额外选取 ${extraMin}-${extraMax} 个「问题深挖」章节，重点展开问题本身，排在基础章节之后；问题深挖章节的总字数应占报告正文的 50% 以上`,
      // R208: 篇幅策略指令 —— 大纲规划器据此决定深挖章取舍的松紧。
      ...(scale ? [`数据规模评级 ${scale.tierZh}（${scale.score}/8）：${scale.directive}`] : []),
      '同一章节不得重复出现；章节顺序一经确定不再改变',
      '每章 H2 标题必须精确使用章节库的中文章节名（一字不差）',
      '不得发明章节库之外的章节 id 或标题',
    ],
  };
}
