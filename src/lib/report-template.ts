/**
 * Full 7-chapter Markdown report template for module ② (target evaluation),
 * ported faithfully from the original pdb-tracker-web-v3 skill
 * (src/lib/target-evaluation.ts lines 854-971). The previous mock used a
 * short 3-paragraph prompt which produced very short reports; this restores
 * the complete template with all 7 chapters.
 */

export interface EvalDataForReport {
  uniprot: string;
  entryName: string;
  proteinName: string;
  geneNames: string;
  organism: string;
  sequenceLength: number;
  coverage: number;
  directPdbCount: number;
  blastHitCount: number;
  scores: {
    xray: { score: number; rating?: string };
    cryoem: { score: number; rating?: string };
    nmr: { score: number; rating?: string };
    overall: { score: number; rating?: string };
  };
  pdbTable: string; // pre-formatted markdown table rows
  blastTable: string;
  /** Total number of PDB entries that `pdbTable` was derived from (may exceed visible rows in the table). */
  pdbCount?: number;
  /** Optional literature context: formatted PubMed article titles + journals + abstracts. */
  literatureInfo?: string;
  /** Number of literature papers included in `literatureInfo`. */
  literatureCount?: number;
  /** Round 34: Structural analysis results for the top PDB (from /api/analyze/run recipes).
   *  Includes binding pocket, interactions, and hydrogen bond data.
   *  When present, a "结构活性位点分析" chapter is generated. */
  structureAnalyses?: StructureAnalysisData;
}

/** Round 34: Structural analysis results from the Analysis module's recipes. */
export interface StructureAnalysisData {
  /** PDB ID that was analyzed. */
  pdbId: string;
  /** Binding pocket analysis (residues within radius of the primary ligand). */
  bindingPocket?: {
    ligand: string;
    radius: number;
    residueCount: number;
    volume: number | string;
    composition: Record<string, number>;
    topResidues: string[];
    catalyticResidues?: string[];
  };
  /** Round 50: Multi-ligand binding pocket results (when structure has multiple ligands). */
  multiLigandPockets?: Array<{
    ligand: string;
    residueCount: number;
    volume: number | string;
  }>;
  /** Round 50: Analysis results from multiple PDBs for comparison. */
  pdbComparisons?: Array<{
    pdbId: string;
    bindingPocket?: { ligand: string; residueCount: number; volume: number | string };
    druggability?: { score: number; category: string };
    hbonds?: { total: number };
  }>;
  /** All inter-chain interactions (H-bonds, salt bridges, hydrophobic contacts). */
  allInteractions?: {
    chain1: string;
    chain2: string;
    total: number;
    hbonds: number;
    saltBridges: number;
    hydrophobic: number;
    topContacts: Array<{ pair: string; distance: number; type: string }>;
    hotspots: Array<{ residue: string; contacts: number }>;
  };
  /** Hydrogen bonds within a single chain (intra-chain). */
  hbonds?: {
    total: number;
    topPairs: Array<{ pair: string; distance: number }>;
  };
  /** Druggability score from the druggability recipe. */
  druggability?: {
    score: number;
    category: string;
    rationale: string;
  };
  /** Round 36: Virtual screening results — ranked fragment hits. */
  virtualScreening?: {
    pocketScore: number;
    fragmentsScreened: number;
    topHits: Array<{
      name: string;
      smiles: string;
      mw: number;
      logp: number;
      affinityKcalMol: number;
      ki_uM: number;
      score: number;
      rationale: string;
    }>;
    bestKi_uM: number;
  };
}

export function buildReportSystemPrompt(): string {
  return `You are a structural biology expert generating a feasibility report for a protein target. Output in Chinese, follow the markdown template strictly, no emoji in headings/tables. Generate ALL 7 chapters with substantive content — do not skip any section. The report should be comprehensive (1500-3000 chars).`;
}

/**
 * Canonical 8-section outline used as a SYSTEM-level anchor so every
 * chapter-mode LLM call (8 parallel calls) sees the same structure and
 * keeps headings / sub-section numbering / tone consistent across chapters.
 * Fix 3 of the report-formatting work.
 */
export const REPORT_OUTLINE_ZH = `## 报告固定大纲（8 章节，按此顺序输出，每章 250-500 字）

| 顺序 | 章节 | 子节 | 标题 | 写作要点 |
|------|------|------|------|---------|
| 1 | 执行摘要 | — | 功能概述 / 关键发现 / 推荐方向 | 2-3 段，无子节；总览全报告 |
| 2 | 蛋白功能与生物学背景 | §1.1 §1.2 §1.3 | 基本功能 / 调控机制 / 疾病关联 | 基于蛋白名+物种+基因名推断；无据可说"暂无可靠数据" |
| 3 | 序列与拓扑结构 | §2.1 §2.2 | 拓扑模型 / 结构域解析 | 基于序列长度+已知 PDB 配体推断 |
| 4 | 现有 PDB 结构分析 | §3.1 §3.2 §3.3 | 方法学分布 / 代表性 PDB / 研究空白 | 引用具体 PDB ID + 分辨率 + IF |
| 5 | 结构解析可行性评估 | §4.1 §4.2 | 评估维度对比 / 综合结论 | 引用 X-ray/Cryo-EM/NMR 评分 |
| 6 | 实验方案 | §5.1 §5.2 §5.3 | 构建设计 / 表达纯化 / 时间规划 | 引用 SIFTS 覆盖率 + 已有 PDB 基础 |
| 7 | 重要参考文献 | — | — | 3-5 条，每条含 PMID/PDB/期刊 IF |
| 8 | 总结 | — | — | 4 段：核心结论 / 优劣势 / 与现有药物关系 / 后续建议 |

### 强制格式约束（适用于所有章节）
- **标题层级**:本章节标题用 H2(\`##\`),子节用 H3(\`###\`)并保持 §N.M 编号
- **章节起始**:每章第一行就是该章的 H2 标题(不要前置空行)
- **无 emoji**:标题、表格、列表中均不使用 emoji
- **引用真实数字**:必须引用"数据上下文"中的具体 PDB ID / 分辨率 / IF / Identity% / E-value
- **不编造**:未在数据上下文中出现的 PDB ID / PMID / 数字一律不写
- **不重复**:每章只写自己范围内的内容；不重复其他章节会写到的内容
- **段落长度**:3-5 句一段,避免一段超过 6 行
- **缺失数据**:无信息时写"暂无可靠数据"或"基于现有数据无法判断",不要假装有信息
- **章节语言**:全文中文(除 PDB ID / UniProt Ref / 期刊名 / 基因名等专有名词保留英文)`;

/**
 * System prompt for chapter-mode (8 parallel LLM calls, one per chapter).
 * Includes the canonical outline so each call sees the same structure.
 * Fix 3 of the report-formatting work.
 */
export function buildChapterSystemPrompt(): string {
  return `你是结构生物学领域的资深研究员，正在为一个蛋白靶点撰写可成药性评估报告的某一章节。
- 中文输出，Markdown 格式
- 严格遵循下方"报告固定大纲"的章节编号、标题、子节结构
- 与其他 7 个并行生成的章节保持风格、用词、格式一致
- 引用数据上下文中给出的真实数字（PDB ID / 分辨率 / IF / Identity% / E-value）
- 缺失数据写"暂无可靠数据"，不编造

${REPORT_OUTLINE_ZH}`;
}

/**
 * Format constraint block appended to every chapter prompt.
 * Fix 1 of the report-formatting work — ensures each of the 8 parallel LLM
 * calls emits the same headings, sub-section numbering, and tone.
 */
export const CHAPTER_FORMAT_CONSTRAINTS = `
---

## 格式约束（必读，所有章节统一遵守）

1. **章节起始**:输出第一行直接是该章的 H2 标题(例如 \`## 1. 蛋白功能与生物学背景\`),前面不要空行
2. **子节编号**:严格使用 §N.M 编号（§1.1 / §1.2 / §1.3 等,与大纲一致）；同一编号在全文只出现一次
3. **标题层级**:H2 用于章标题,H3 用于子节;不要用 H1 / H4
4. **无 emoji**:标题、表格、列表中均不使用 emoji
5. **真实数据**:只引用数据上下文中的 PDB ID / 分辨率 / IF / Identity% / E-value / 期刊名;不编造
6. **不重复**:本章节只写自己范围内的内容,不重复其他章节会写的内容(比如"执行摘要"是单独的第 1 章节,不要在本章再写总结)
7. **段落长度**:每段 3-5 句;不要长段堆叠
8. **缺失数据**:用"暂无可靠数据"或"基于现有数据无法判断"代替,不要猜测
9. **数字与单位**:分辨率写"X.XX Å",IF 写"IF XX.X",Identity 写"XX.X%"
10. **章节字数**:250-500 字(摘要章可 200-400 字,文献章可 300-600 字含列表)
`;

export function buildReportUserPrompt(d: EvalDataForReport): string {
  const today = new Date().toISOString().slice(0, 10);
  return `Generate a Chinese protein structure feasibility report for:

UniProt: ${d.uniprot}
Entry: ${d.entryName}
Protein: ${d.proteinName}
Gene: ${d.geneNames}
Organism: ${d.organism}
Sequence length: ${d.sequenceLength} aa
Coverage: ${d.coverage}%
Direct PDB count: ${d.directPdbCount}
BLAST hit count: ${d.blastHitCount}

Scores (1-10):
- X-ray: ${d.scores.xray.score} (${d.scores.xray.rating || ''})
- Cryo-EM: ${d.scores.cryoem.score} (${d.scores.cryoem.rating || ''})
- NMR: ${d.scores.nmr.score} (${d.scores.nmr.rating || ''})
- Overall: ${d.scores.overall.score} (${d.scores.overall.rating || ''})

Top direct PDB structures:
| PDB | Method | Resolution (Å) | Journal (IF) | Title |
|-----|--------|----------------|--------------|-------|
${d.pdbTable}

Top BLAST homologs:
| PDB | Subject | Identity | E-value | Description |
|-----|---------|----------|---------|-------------|
${d.blastTable}

Output strictly in this markdown structure (Chinese), filling EVERY section with real content:

---
title: 蛋白结构解析可行性评估报告
created: ${today}
updated: ${today}
type: evaluation
tags: []
sources: []
---

# 蛋白结构解析可行性评估报告

**蛋白名称:** ${d.proteinName}
**UniProt ID:** ${d.uniprot} (${d.entryName})
**基因名称:** ${d.geneNames}
**物种:** ${d.organism}
**序列长度:** ${d.sequenceLength} 氨基酸
**报告生成日期:** ${today}

---

## 执行摘要

(2-4 段：蛋白功能 + 关键发现 + 推荐方向)

| 评估项目 | 结果 |
|---------|------|
| 蛋白类型 | (基于序列特征推断) |
| 序列长度 | ${d.sequenceLength} aa |
| 已有结构覆盖 | ${d.directPdbCount} 个直接 PDB，${d.blastHitCount} 个 BLAST 同源 |
| 推荐结构解析方法 | (基于评分给出) |

## 1. 蛋白功能与生物学背景

### 1.1 基本功能
### 1.2 调控机制
### 1.3 疾病关联
(基于蛋白名称和物种推断;无信息则说"暂无可靠数据")

## 2. 序列与拓扑结构

### 2.1 拓扑模型
(简短的拓扑描述;如膜蛋白/球状/酶)
### 2.2 结构域解析
(基于 UniProt 注释;无信息时简略)

## 3. 现有 PDB 结构分析

### 3.1 结构生物学里程碑
(挑 3-5 个重要 PDB 列出)
### 3.2 代表性 PDB 结构
(基于上面 PDB 表生成)
### 3.3 研究空白与发表机会
(3 个具体方向)

## 4. 结构解析可行性评估

### 4.1 方法比较
| 评估维度 | Cryo-EM | X-ray 结晶 | NMR |
|---------|---------|-----------|-----|
| 分子量适配性 | | | |
| 构象异质性处理 | | | |
| 已有成功先例 | | | |
| 总体评分 | ${d.scores.cryoem.score}/10 | ${d.scores.xray.score}/10 | ${d.scores.nmr.score}/10 |

### 4.2 综合结论
(2-3 段:推荐方法 + 理由 + 备选方案)

## 5. 实验方案（可选）

### 5.1 构建设计
### 5.2 表达与样品制备流程
### 5.3 时间规划
| 阶段 | 预计时间 | 预期结果 |
|------|---------|---------|
| 表达纯化 | 2-3 月 | 高纯度样品 |
| 结构解析 | 3-6 月 | 原子模型 |
| **总计** | **6-12 个月** | |

## 6. 重要参考文献
(基于 PDB 表中的 DOI/PMID 列出)

## 7. 总结
(3-4 段总结)

---
*本报告由 pdb-tracker-web-v3 运行中心自动生成 | 数据来源：UniProt, RCSB PDB, NCBI BLAST*
*报告生成时间: ${new Date().toISOString()}*`;
}

/** Build mock PDB table rows for the report prompt. */
export function buildMockPdbTable(count: number): string {
  const methods = ['X-RAY DIFFRACTION', 'ELECTRON MICROSCOPY', 'SOLUTION NMR'];
  const journals = ['Nature', 'Science', 'Cell', 'Nature Struct. Mol. Biol.', 'PNAS', 'eLife'];
  const titles = [
    'Crystal structure of EGFR kinase domain',
    'Cryo-EM structure of full-length EGFR',
    'Active-state GPCR complex',
    'Ligand-bound receptor ectodomain',
    'Mutant kinase with inhibitor',
    'Asymmetric dimer structure',
  ];
  const rows: string[] = [];
  for (let i = 0; i < Math.min(count, 8); i++) {
    const pdbId = `${String.fromCharCode(88, 71)}${(7 + i).toString().padStart(2, '0')}`;
    const m = methods[i % methods.length];
    const res = m === 'SOLUTION NMR' ? '-' : (1.5 + Math.random() * 2.5).toFixed(1);
    const j = journals[i % journals.length];
    const ifVal = (10 + Math.random() * 30).toFixed(1);
    const t = titles[i % titles.length];
    rows.push(`| ${pdbId} | ${m} | ${res} | ${j} (${ifVal}) | ${t} |`);
  }
  return rows.join('\n');
}

/** Build mock BLAST table rows. */
export function buildMockBlastTable(count: number): string {
  const descs = ['EGFR_HUMAN', 'Receptor tyrosine kinase', 'ErbB family member', 'Kinase domain homolog'];
  const rows: string[] = [];
  for (let i = 0; i < Math.min(count, 8); i++) {
    const pdbId = `${String.fromCharCode(88, 71)}${(10 + i).toString().padStart(2, '0')}`;
    const ident = (60 + Math.random() * 35).toFixed(1);
    const evalue = `e-${Math.floor(Math.random() * 100 + 10)}`;
    const d = descs[i % descs.length];
    rows.push(`| ${pdbId} | sp|P0${i} | ${ident}% | ${evalue} | ${d} |`);
  }
  return rows.join('\n');
}


/**
 * Lighter report used when the model needs to be invoked chapter-by-chapter
 * with real-time SSE streaming. Each chapter carries just what it needs from
 * the full EvalDataForReport plus an explicit `chapterKey`.
 */
export type ReportChapterKey =
  | 'summary'
  | 'function'
  | 'topology'
  | 'pdb_analysis'
  | 'structure_analysis'
  | 'feasibility'
  | 'experimental'
  | 'references'
  | 'conclusion';

export function buildChapterPrompt(
  d: EvalDataForReport & { chapterKey: ReportChapterKey; chapterIndex: number; chapterTotal: number },
): string {
  const today = new Date().toISOString().slice(0, 10);
  const ctxHeader = `# 数据上下文（可复用）
| 字段 | 值 |
|------|------|
| UniProt ID | ${d.uniprot} |
| Entry | ${d.entryName} |
| 蛋白名 | ${d.proteinName} |
| 基因 | ${d.geneNames} |
| 物种 | ${d.organism} |
| 序列长度 | ${d.sequenceLength} aa |
| SIFTS 覆盖率 | ${d.coverage}% |
| 直接 PDB 数 | ${d.directPdbCount} |
| BLAST 同源数 | ${d.blastHitCount} |
| X-ray 评分 | ${d.scores.xray.score}/10 (${d.scores.xray.rating || ''}) |
| Cryo-EM 评分 | ${d.scores.cryoem.score}/10 (${d.scores.cryoem.rating || ''}) |
| NMR 评分 | ${d.scores.nmr.score}/10 (${d.scores.nmr.rating || ''}) |
| Overall 评分 | ${d.scores.overall.score}/10 (${d.scores.overall.rating || ''}) |

---

## 完整 PDB 数据表（共 ${d.pdbCount ?? d.directPdbCount} 条，按分辨率/IF 排序）

| # | PDB | 方法 | 分辨率(Å) | Identity (BLAST/direct) | 期刊 (IF) | 配体 | 作者 | 标题 |
|---|------|------|-----------|--------------------------|------|------|------|------|
${d.pdbTable}

---

## 完整 BLAST 同源数据表（共 ${d.blastHitCount} 条）

| # | PDB | UniProt Ref | Description | Identity% | E-value | Query Cov. |
|---|------|-----------|-------------|-----------|---------|------------|
${d.blastTable}

---

## 相关文献（PubMed，共 ${d.literatureCount ?? 0} 篇，按期刊 IF 降序；摘要截取 200 字）

${d.literatureInfo || '（无 PubMed 文献数据）'}

---

# 任务：生成第 ${d.chapterIndex}/${d.chapterTotal} 章 **"${chapterTitleZh(d.chapterKey)}"**

要求：
1. **仅返回该章节的 Markdown 内容**，不要输出其他章节（前后章节会由其他调用生成）
2. 中文输出，使用 markdown 格式
3. 引用上面表格里的具体 PDB ID / 期刊 IF / E-value 等真实数字
4. 长度 250-500 字（足够充实但不冗长）
5. 章节标题单独占一行，前后空行
6. 在相关章节中可参考"相关文献"区块中的论文标题/期刊/摘要内容，引用 PMID 作为参考文献时格式为 "PMID 12345"
7. **必须输出该章节对应的 H2 标题**（例如第 2 章输出 \`## 1. 蛋白功能与生物学背景\`），不要省略标题
8. **严格使用 §N.M 编号**（§1.1 / §1.2 / §1.3 等），与上方大纲一致
9. **格式约束见下方"## 格式约束"区块，必须逐条遵守**

${CHAPTER_FORMAT_CONSTRAINTS}
`;

  switch (d.chapterKey) {
    case 'summary':
      return ctxHeader + `
## 执行摘要

（2-3 段：蛋白功能概述 + 关键发现 + 推荐方向。**无子节**，不分 §N.M；直接以"## 执行摘要"开头，2-3 段正文，结尾给一句话方向建议。）`;
    case 'function':
      return ctxHeader + `
## 1. 蛋白功能与生物学背景

### §1.1 基本功能
（基于蛋白名称、物种、基因名推断其核心生物学功能；缺失时写"暂无可靠数据"）

### §1.2 调控机制
（结合表观遗传 / 翻译后修饰 / 互作蛋白等简要说明；缺失时写"暂无可靠数据"）

### §1.3 疾病关联
（基于蛋白名称和基因名推断相关疾病；无据可写"暂无可靠数据"）

**章节输出结构**:以 \`## 1. 蛋白功能与生物学背景\` 开头,紧接 3 个 H3 子节(§1.1 / §1.2 / §1.3),不要省略任何子节。`;
    case 'topology':
      return ctxHeader + `
## 2. 序列与拓扑结构

### §2.1 拓扑模型
（基于长度 ${d.sequenceLength} aa + ${d.organism} 物种推断：膜蛋白/球状/酶/受体/通道 等;说明信号肽、跨膜螺旋、二硫键等关键特征）

### §2.2 结构域解析
（基于 PDB 数据中出现的配体、已解析 domain 推断各结构域的大致位置;缺失时写"暂无可靠数据"）

**章节输出结构**:以 \`## 2. 序列与拓扑结构\` 开头,2 个 H3 子节(§2.1 / §2.2)。`;
    case 'pdb_analysis':
      return ctxHeader + `
## 3. 现有 PDB 结构分析

### §3.1 方法学分布
（Cryo-EM / X-ray / NMR 各占比;高 IF 文章期刊分布;基于数据上下文 PDB 表中的方法字段统计）

### §3.2 代表性 PDB 结构
**挑 3-5 个重要 PDB**（优先高分辨率 + 高 IF），每个 1-2 行说明其科学意义。必须引用表格中的具体 PDB ID 和分辨率数字。

### §3.3 研究空白与发表机会
（基于 SIFTS 覆盖率 ${d.coverage}% + BLAST 同源 ${d.blastHitCount} 条 + IF 最高期刊等推断 3 个具体可深入方向）

**章节输出结构**:以 \`## 3. 现有 PDB 结构分析\` 开头,3 个 H3 子节(§3.1 / §3.2 / §3.3)。`;
    case 'structure_analysis': {
      // Round 34: New chapter that uses structural analysis results from the
      // Analysis module (binding_pocket, all_interactions, hbonds, druggability).
      // Only included when d.structureAnalyses is present.
      const sa = d.structureAnalyses;
      let analysisContext = '';
      if (sa) {
        analysisContext = `
## 结构分析数据（由 Analysis 模块自动生成，基于 PDB ${sa.pdbId}）

`;
        if (sa.bindingPocket) {
          const bp = sa.bindingPocket;
          analysisContext += `### 结合口袋分析（配体 ${bp.ligand}, 半径 ${bp.radius} Å）
- 口袋残基数: ${bp.residueCount}
- 估计体积: ${bp.volume} Å³
- 残基组成: ${Object.entries(bp.composition).map(([k, v]) => `${k} ${v}`).join(', ')}
- 关键口袋残基: ${bp.topResidues.join(', ')}
${bp.catalyticResidues && bp.catalyticResidues.length > 0 ? `- 催化残基: ${bp.catalyticResidues.join(', ')}` : ''}

`;
        }
        if (sa.allInteractions) {
          const ai = sa.allInteractions;
          analysisContext += `### 链间互作分析（链 ${ai.chain1} ↔ 链 ${ai.chain2}）
- 总互作数: ${ai.total}（氢键 ${ai.hbonds}, 盐桥 ${ai.saltBridges}, 疏水接触 ${ai.hydrophobic}）
- 主要互作对:
${ai.topContacts.map(c => `  - ${c.pair} (${c.distance} Å, ${c.type})`).join('\n')}
${ai.hotspots.length > 0 ? `- 界面热点残基（≥2 次接触）:\n${ai.hotspots.map(h => `  - ${h.residue} (${h.contacts} 次接触)`).join('\n')}` : ''}

`;
        }
        if (sa.hbonds) {
          analysisContext += `### 链内氢键分析
- 总氢键数: ${sa.hbonds.total}
- 主要氢键对:
${sa.hbonds.topPairs.map(p => `  - ${p.pair} (${p.distance} Å)`).join('\n')}

`;
        }
        if (sa.druggability) {
          analysisContext += `### 可成药性评估
- 评分: ${sa.druggability.score}/10
- 分类: ${sa.druggability.category}
- 依据: ${sa.druggability.rationale}

`;
        }
        if (sa.virtualScreening) {
          const vs = sa.virtualScreening;
          analysisContext += `### 虚拟筛选结果（${vs.fragmentsScreened} 个片段筛选）
- 口袋评分: ${vs.pocketScore}
- 最佳 Ki: ${vs.bestKi_uM} μM
- Top 5 命中片段:
${vs.topHits.map((h, i) => `  ${i + 1}. ${h.name} (MW ${h.mw}, logP ${h.logp}) — Ki ${h.ki_uM} μM, 亲和力 ${h.affinityKcalMol} kcal/mol — ${h.rationale}`).join('\n')}

`;
        }
        if (sa.multiLigandPockets && sa.multiLigandPockets.length > 0) {
          analysisContext += `### 多配体结合口袋分析（Round 50）
${sa.multiLigandPockets.map(p => `- 配体 ${p.ligand}: ${p.residueCount} 残基, 体积 ${p.volume} Å³`).join('\n')}

`;
        }
        if (sa.pdbComparisons && sa.pdbComparisons.length > 1) {
          analysisContext += `### PDB 比较分析（Round 50 — ${sa.pdbComparisons.length} 个结构对比）
| PDB | 配体 | 口袋残基数 | 体积 (Å³) | 可成药性 | 氢键数 |
|-----|------|-----------|----------|---------|--------|
${sa.pdbComparisons.map(c => `| ${c.pdbId} | ${c.bindingPocket?.ligand || '-'} | ${c.bindingPocket?.residueCount || '-'} | ${c.bindingPocket?.volume || '-'} | ${c.druggability ? `${c.druggability.score}/10` : '-'} | ${c.hbonds?.total || '-'} |`).join('\n')}

`;
        }
      }
      return ctxHeader + analysisContext + `
## 4. 结构活性位点分析

### §4.1 结合口袋与关键残基
（基于上方"结构分析数据"中的结合口袋分析结果，讨论口袋大小、残基组成、催化残基的生物学意义。引用具体残基名称和编号。如果无结合口袋数据，写"暂无可靠数据"。）

### §4.2 蛋白-蛋白/配体互作界面
（基于链间互作分析结果，讨论界面互作类型分布（氢键/盐桥/疏水）、关键热点残基、以及界面稳定性。引用具体残基对和距离数字。如果无互作数据，写"暂无可靠数据"。）

### §4.3 可成药性评估
（基于可成药性评分和口袋分析，综合评估该靶点的成药潜力。讨论口袋可及性、关键残基的保守性、以及潜在的药物设计策略。如果无可成药性数据，基于口袋大小和组成进行推断。）

**章节输出结构**:以 \`## 4. 结构活性位点分析\` 开头,3 个 H3 子节(§4.1 / §4.2 / §4.3);必须引用结构分析数据中的具体残基和数字。`;
    }
    case 'feasibility':
      return ctxHeader + `
## 5. 结构解析可行性评估

### §5.1 评估维度对比

| 维度 | Cryo-EM | X-ray | NMR |
|------|---------|-------|-----|
| 该蛋白适宜性 (基于分子量 ${d.sequenceLength} aa) | | | |
| 已有 PDB 数据基础 | | | |
| 整体评分 | ${d.scores.cryoem.score}/10 | ${d.scores.xray.score}/10 | ${d.scores.nmr.score}/10 |

### §5.2 综合结论
（2-3 段：推荐方法 + 理由 + 备选方案）

**章节输出结构**:以 \`## 5. 结构解析可行性评估\` 开头,2 个 H3 子节(§5.1 / §5.2);§5.1 必须包含上表。`;
    case 'experimental':
      return ctxHeader + `
## 6. 实验方案

### §6.1 构建设计
（基于 ${d.coverage}% SIFTS 覆盖率 + ${d.directPdbCount} 直接 PDB 数据基础建议构建设计策略;说明全长/截短体/标签选择）

### §6.2 表达与样品制备流程
（简要:表达系统选择 / 纯化策略 / 样品质量评估 / 缓冲液条件）

### §6.3 时间规划

| 阶段 | 预计时间 | 预期结果 |
|------|---------|---------|
| 表达纯化 | 2-3 月 | 高纯度样品 |
| 结构解析 | 3-6 月 | 原子模型 |
| **总计** | **6-12 个月** | |

**章节输出结构**:以 \`## 6. 实验方案\` 开头,3 个 H3 子节(§6.1 / §6.2 / §6.3);§6.3 必须包含上表。`;
    case 'references':
      return ctxHeader + `
## 7. 重要参考文献

**无子节**。基于 PDB 数据表中的高 IF 期刊条目列出 3-5 个,每条必须包含:作者(et al.)、期刊名称、IF 值、PDB ID、分辨率。

**章节输出结构**:以 \`## 7. 重要参考文献\` 开头,直接列出 3-5 条参考文献(列表项格式: - Author et al., *Journal Name* (IF: XX.X), PDB XXXX, Y.Y Å.)。`;
    case 'conclusion':
      return ctxHeader + `
## 8. 总结

**无子节**。4 段总结:
1. 核心结论
2. 此蛋白作为靶点的优劣势
3. 与现有药物的关系
4. 后续建议与展望

**章节输出结构**:以 \`## 8. 总结\` 开头,直接写 4 段正文,不要列表化。`;
  }
}

function chapterTitleZh(k: ReportChapterKey): string {
  return ({
    summary:           '执行摘要',
    function:          '蛋白功能与生物学背景',
    topology:          '序列与拓扑结构',
    pdb_analysis:      '现有 PDB 结构分析',
    structure_analysis:'结构活性位点分析',
    feasibility:       '结构解析可行性评估',
    experimental:      '实验方案',
    references:        '重要参考文献',
    conclusion:        '总结',
  } as Record<ReportChapterKey, string>)[k];
}

// ─── Chapter Validation ─────────────────────────────────────────────────────

export interface ChapterValidationResult {
  ok: boolean;
  /** Why validation failed — surfaced to the caller so it can log / retry. */
  reason?: string;
}

/**
 * Validate that an LLM-generated chapter actually contains the expected H2
 * heading and has a reasonable body length. Without this check, a chapter
 * that "succeeded" (HTTP 200 from the LLM) but returned an empty / truncated
 * / wrong-section body would be silently concatenated into the final report,
 * producing the "missing section" symptom the user reported (e.g. §3.3
 * present but §3.1 / §3.2 absent because the LLM returned an error stub or
 * a one-liner).
 *
 * Rules:
 *   1. Minimum length: 150 chars (any real chapter is ≥250 per the prompt;
 *      a stub or an LLM refusal is usually <100).
 *   2. Must contain the chapter's Chinese title somewhere in the text. The
 *      LLM is instructed to emit `## N. <title>` — we check the title
 *      substring loosely so heading-level variations (## vs #, with/without
 *      number) all pass.
 *   3. Must NOT be an error placeholder (the route sets `_(${title}: LLM 调用
 *      失败...)_` when generateText fails — that string has the title in it
 *      but is obviously not real content, so we reject any content that
 *      starts with `_(`).
 */
export function validateChapterContent(
  chapterKey: ReportChapterKey,
  content: string,
): ChapterValidationResult {
  if (!content || typeof content !== 'string') {
    return { ok: false, reason: '内容为空' };
  }
  const trimmed = content.trim();
  // Reject error placeholders the route itself writes on generateText failure.
  if (trimmed.startsWith('_(') && trimmed.includes('LLM 调用失败')) {
    return { ok: false, reason: '内容是失败占位符' };
  }
  if (trimmed.length < 150) {
    return { ok: false, reason: `内容过短（${trimmed.length} chars，需 ≥150）` };
  }
  const expectedTitle = chapterTitleZh(chapterKey);
  if (!trimmed.includes(expectedTitle)) {
    return { ok: false, reason: `缺少期望标题「${expectedTitle}」` };
  }
  return { ok: true };
}

/**
 * Round 56: Normalize an evaluation report chapter's LLM output so every
 * chapter has a consistent heading structure, regardless of which LLM
 * provider generated it.
 *
 * Fixes 4 common inconsistency bugs that caused "每次生成的格式不一致":
 *
 * 1. **Chapter heading level**: Some LLMs emit `# 1. 蛋白功能与生物学背景`
 *    (H1) while others emit `## 1. ...` (H2). The report template specifies
 *    H2 for chapters. We normalize: any heading containing the chapter title
 *    becomes H2.
 *
 * 2. **Sub-section heading level**: Sub-sections like `§1.1 基本功能` should
 *    always be H3. Some LLMs emit them as H2 or H4. We normalize any heading
 *    matching the `§N.M` or `N.M` pattern to H3.
 *
 * 3. **§ prefix consistency**: Some LLMs write `### §1.1 基本功能`, others
 *    write `### 1.1 基本功能`. We normalize to always include the § prefix
 *    (matching the prompt template).
 *
 * 4. **Duplicate chapter heading**: If the LLM emits the chapter heading
 *    twice, we keep only the first.
 *
 * Applied per-chapter before concatenation in the eval route.
 */
export function normalizeEvalChapterContent(
  content: string,
  chapterKey: ReportChapterKey,
): string {
  if (!content) return content;
  let s = content.replace(/\r\n?/g, '\n');
  const expectedTitle = chapterTitleZh(chapterKey);
  const titleEsc = expectedTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 8);

  // 1) Normalize ALL headings that contain the chapter title to H2.
  //    This handles both "# 1. 蛋白功能与生物学背景" (H1) and
  //    "### 1. 蛋白功能与生物学背景" (H3) → "## 1. 蛋白功能与生物学背景" (H2).
  //    Also handles "执行摘要" (no number) and "## 8. 总结" (with number).
  const titleHeadingRe = new RegExp(
    `^(#{1,4})\\s+((?:\\d+\\.\\s*)?${titleEsc}[^\\n]*)$`,
    'gm'
  );
  let firstTitleHeadingKept = false;
  s = s.replace(titleHeadingRe, (match, _hashes, rest) => {
    if (firstTitleHeadingKept) {
      // Duplicate — drop it (and its trailing newline will be cleaned up by
      // the blank-line collapse in step 5).
      return '';
    }
    firstTitleHeadingKept = true;
    return `## ${rest.trim()}`;
  });

  // 2) Normalize sub-section headings (§N.M or N.M) to H3 with § prefix.
  //    Match: ^#{1,4}\s+§?\d+\.\d+[\.\s]
  //    Replace with: ### §N.M. <rest>
  //    Example: "## 1.1 基本功能" → "### §1.1. 基本功能"
  //             "#### §2.1 拓扑模型" → "### §2.1. 拓扑模型"
  s = s.replace(
    /^#{1,4}\s+(§?)(\d+\.\d+)(\.\s+|\.\s+|\s+)(.+)$/gm,
    (_match, _secPrefix, num, _sep, rest) => {
      return `### §${num}. ${rest.trim()}`;
    }
  );

  // 3) Strip any remaining H1 headings in the chapter body (H1 is reserved
  //    for the report title, which is added separately by the route).
  //    Only strip H1s that look like chapter headings or report titles.
  s = s.replace(/^#\s+[^\n]+\n?/gm, '');

  // 4) Collapse 3+ blank lines to 2 (cleanup after duplicate removal).
  s = s.replace(/\n{3,}/g, '\n\n');

  return s.trim();
}



/**
 * Render up to `maxRows` entries from a PdbEntryDetail[] to markdown table rows.
 * Sorted by (resolution asc, journalIf desc) so the highest-impact + best-resolution
 * come first. If the dataset has more than maxRows entries we still pass total count
 * via the header so the LLM can mention it.
 */
export function buildDetailedPdbTable(
  rows: Array<{
    pdbId: string; method?: string | null; resolution?: number | null;
    journal?: string | null; journalIf?: number | null; ligands?: string | null;
    title?: string | null; blastIdentity?: number | null;  // Fix 2: BLAST-derived rows carry identity% here
    authors?: string | null;  // Round 49: Include author info
  }>,
  maxRows = 80,
): string {
  const sorted = [...rows].sort((a, b) => {
    // BLAST-derived rows sort to the bottom of each resolution tier (they're homologs, not direct structures)
    const aBlast = a.blastIdentity != null ? 1 : 0;
    const bBlast = b.blastIdentity != null ? 1 : 0;
    if (aBlast !== bBlast) return aBlast - bBlast;
    const aRes = a.resolution ?? 999;
    const bRes = b.resolution ?? 999;
    if (aRes !== bRes) return aRes - bRes;
    const aIf = a.journalIf ?? -1;
    const bIf = b.journalIf ?? -1;
    return bIf - aIf;
  });
  const slice = sorted.slice(0, maxRows);
  return slice.map((e, i) => {
    const method = (e.method || '-').replace(/\|+/g, ' ').slice(0, 24);
    const res = e.resolution != null ? e.resolution.toFixed(2) : '-';
    const j = (e.journal || '-').replace(/\|+/g, ' ');
    const ifStr = e.journalIf != null ? e.journalIf.toFixed(1) : '-';
    const lig = (e.ligands || '-').replace(/\|+/g, ' ').slice(0, 20);
    const title = (e.title || '-').replace(/\|+/g, ' ').replace(/\n+/g, ' ').slice(0, 60);
    const authors = (e.authors || '-').replace(/\|+/g, ' ').replace(/\n+/g, ' ').slice(0, 40);
    // Fix 2: show Identity% with "BLAST" tag for BLAST-derived rows so the LLM
    // and the human reader can immediately distinguish "direct PDB" from "BLAST homolog".
    const ident = e.blastIdentity != null ? `BLAST ${e.blastIdentity.toFixed(1)}%` : 'direct';
    return `| ${i + 1} | ${e.pdbId} | ${method} | ${res} | ${ident} | ${j} (IF: ${ifStr}) | ${lig} | ${authors} | ${title} |`;
  }).join('\n');
}

/** Render BLAST homolog rows. */
export function buildDetailedBlastTable(
  rows: Array<{
    pdbId: string; uniprotRef?: string | null; description?: string | null;
    identity?: number | null; evalue?: string | null; queryCoverage?: number | null;
  }>,
  maxRows = 80,
): string {
  const sorted = [...rows].sort((a, b) => (b.identity ?? 0) - (a.identity ?? 0));
  const slice = sorted.slice(0, maxRows);
  return slice.map((h, i) => {
    const desc = (h.description || '-').replace(/\|+/g, ' ').slice(0, 40);
    const cov = h.queryCoverage != null ? h.queryCoverage.toFixed(0) : '-';
    return `| ${i + 1} | ${h.pdbId} | ${h.uniprotRef || '-'} | ${desc} | ${h.identity?.toFixed(1) ?? '-'} | ${h.evalue || '-'} | ${cov} |`;
  }).join('\n');
}
