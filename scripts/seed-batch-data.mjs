/**
 * Seed fake batch evaluation data for testing the UI.
 * Run: node scripts/seed-batch-data.mjs
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── Fake data ─────────────────────────────────────────────────────────────

const BATCH_1_TARGETS = [
  {
    uniprotId: 'P04626',
    entryName: 'ERBB2_HUMAN',
    proteinName: 'Receptor tyrosine-protein kinase erbB-2',
    geneNames: 'ERBB2 HER2 NEU',
    organism: 'Homo sapiens',
    sequenceLength: 1255,
    coverage: 78.5,
    scores: JSON.stringify({ structure: { score: 7.5, max: 10, rating: 'good' }, function: { score: 8.0, max: 10, rating: 'good' }, topology: { score: 7.0, max: 10, rating: 'good' }, feasibility: { score: 6.5, max: 10, rating: 'moderate' }, overall: { score: 7.3, max: 10, rating: 'good' } }),
    report: `# ERBB2 (HER2) 可成药性评估报告

## 1. 概述

ERBB2 (HER2) 是 EGFR 家族成员之一，在乳腺癌、胃癌等多种恶性肿瘤中过表达，是重要的治疗靶点。目前已有多款 FDA 批准的 HER2 靶向药物。

## 2. 结构分析

| PDB ID | 方法 | 分辨率 (Å) | 配体 | 发表年份 |
|--------|------|-----------|------|---------|
| 1N8Z | X-ray | 2.5 | 无 | 2003 |
| 3PP0 | X-ray | 2.4 | 无 | 2011 |
| 6J71 | Cryo-EM | 3.2 | 无 | 2019 |
| 5O8G | X-ray | 2.1 | 无 | 2017 |

## 3. 功能与通路

HER2 参与以下信号通路：
- **PI3K/AKT 通路**：促进细胞存活
- **MAPK/ERK 通路**：促进细胞增殖
- **JAK/STAT 通路**：调控基因表达

## 4. 可成药性评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 结构覆盖度 | 7.5/10 | 胞外域覆盖良好 |
| 已知配体 | 8.0/10 | 多款上市药物 |
| 功能明确性 | 8.0/10 | 通路清晰 |
| 成药可行性 | 6.5/10 | 已验证靶点 |

## 5. 结论

HER2 是成熟的成药靶点，已有多种药物上市。结构数据丰富，功能通路清晰，适合作为靶点优化和联合用药研究。`,
    pdbStructures: [
      { pdbId: '1N8Z', method: 'X-ray', resolution: 2.5, title: 'HER2 kinase domain complex', releaseDate: '2003-02-24', ifTier: 'T1', journalIf: 12.8, organism: 'Homo sapiens' },
      { pdbId: '3PP0', method: 'X-ray', resolution: 2.4, title: 'HER2 trastuzumab complex', releaseDate: '2011-01-12', ifTier: 'T1', journalIf: 15.2, organism: 'Homo sapiens' },
      { pdbId: '6J71', method: 'Cryo-EM', resolution: 3.2, title: 'HER2-HER3 heterodimer complex', releaseDate: '2019-03-15', ifTier: 'T1', journalIf: 18.5, organism: 'Homo sapiens' },
      { pdbId: '5O8G', method: 'X-ray', resolution: 2.1, title: 'HER2 pertuzumab complex', releaseDate: '2017-08-10', ifTier: 'T1', journalIf: 14.3, organism: 'Homo sapiens' },
    ],
    blastResults: [
      { pdbId: '1N8Z', identity: 100, evalue: '0', queryCoverage: 95.2, method: 'X-ray', resolution: 2.5, title: 'HER2 kinase domain', ifTier: 'T1', journalIf: 12.8, source: 'pdbaa' },
      { pdbId: '3PP0', identity: 99.8, evalue: '0', queryCoverage: 92.1, method: 'X-ray', resolution: 2.4, title: 'HER2 trastuzumab', ifTier: 'T1', journalIf: 15.2, source: 'pdbaa' },
    ],
  },
  {
    uniprotId: 'P04629',
    entryName: 'ERBB3_HUMAN',
    proteinName: 'Receptor tyrosine-protein kinase erbB-3',
    geneNames: 'ERBB3 HER3',
    organism: 'Homo sapiens',
    sequenceLength: 1342,
    coverage: 72.3,
    scores: JSON.stringify({ structure: { score: 6.5, max: 10, rating: 'moderate' }, function: { score: 7.5, max: 10, rating: 'good' }, topology: { score: 6.0, max: 10, rating: 'moderate' }, feasibility: { score: 5.5, max: 10, rating: 'moderate' }, overall: { score: 6.4, max: 10, rating: 'moderate' } }),
    report: `# ERBB3 (HER3) 可成药性评估报告

## 1. 概述

ERBB3 (HER3) 是 EGFR 家族成员，激酶活性较弱，但可通过与 HER2 形成异二聚体激活下游信号通路。HER3 在多种癌症中过表达，与耐药性相关。

## 2. 结构分析

| PDB ID | 方法 | 分辨率 (Å) | 配体 | 发表年份 |
|--------|------|-----------|------|---------|
| 1M6B | X-ray | 2.8 | 无 | 2002 |
| 3KEX | X-ray | 3.0 | 无 | 2010 |
| 6J71 | Cryo-EM | 3.2 | 无 | 2019 |

## 3. 结论

HER3 结构覆盖度中等，作为 HER2 的共受体发挥作用。成药性中等，适合作为联合靶点研究。`,
    pdbStructures: [
      { pdbId: '1M6B', method: 'X-ray', resolution: 2.8, title: 'HER3 ectodomain', releaseDate: '2002-05-15', ifTier: 'T2', journalIf: 9.8, organism: 'Homo sapiens' },
      { pdbId: '3KEX', method: 'X-ray', resolution: 3.0, title: 'HER3 kinase domain', releaseDate: '2010-09-22', ifTier: 'T2', journalIf: 11.2, organism: 'Homo sapiens' },
      { pdbId: '6J71', method: 'Cryo-EM', resolution: 3.2, title: 'HER2-HER3 heterodimer complex', releaseDate: '2019-03-15', ifTier: 'T1', journalIf: 18.5, organism: 'Homo sapiens' },
    ],
    blastResults: [
      { pdbId: '1M6B', identity: 100, evalue: '0', queryCoverage: 88.5, method: 'X-ray', resolution: 2.8, title: 'HER3 ectodomain', ifTier: 'T2', journalIf: 9.8, source: 'pdbaa' },
    ],
  },
];

const BATCH_2_TARGETS = [
  {
    uniprotId: 'P0CG48',
    entryName: 'UBC_HUMAN',
    proteinName: 'Polyubiquitin-C',
    geneNames: 'UBC',
    organism: 'Homo sapiens',
    sequenceLength: 685,
    coverage: 85.2,
    scores: JSON.stringify({ structure: { score: 8.0, max: 10, rating: 'good' }, function: { score: 8.5, max: 10, rating: 'good' }, topology: { score: 7.5, max: 10, rating: 'good' }, feasibility: { score: 7.0, max: 10, rating: 'good' }, overall: { score: 7.8, max: 10, rating: 'good' } }),
    report: `# UBC (Polyubiquitin-C) 可成药性评估报告

## 1. 概述

泛素 (Ubiquitin) 是蛋白质降解通路的核心分子，参与调控细胞周期、DNA 修复、信号转导等多种生物学过程。UBC 基因编码多聚泛素前体。

## 2. 结构分析

| PDB ID | 方法 | 分辨率 (Å) | 说明 |
|--------|------|-----------|------|
| 1UBQ | NMR | - | 经典泛素结构 |
| 2D3G | X-ray | 1.8 | K48 链接二泛素 |
| 3ALB | X-ray | 2.2 | K63 链接二泛素 |

## 3. 结论

泛素是高度保守且结构明确的蛋白，适合作为降解靶向嵌合体 (PROTAC) 的组件。结构数据极其丰富。`,
    pdbStructures: [
      { pdbId: '1UBQ', method: 'NMR', resolution: null, title: 'Ubiquitin (NMR)', releaseDate: '1987-01-15', ifTier: 'T1', journalIf: 25.4, organism: 'Homo sapiens' },
      { pdbId: '2D3G', method: 'X-ray', resolution: 1.8, title: 'K48-linked diubiquitin', releaseDate: '2006-03-20', ifTier: 'T1', journalIf: 16.2, organism: 'Homo sapiens' },
    ],
    blastResults: [
      { pdbId: '1UBQ', identity: 100, evalue: '0', queryCoverage: 98.0, method: 'NMR', resolution: null, title: 'Ubiquitin', ifTier: 'T1', journalIf: 25.4, source: 'pdbaa' },
    ],
  },
  {
    uniprotId: 'P62987',
    entryName: 'RL40_HUMAN',
    proteinName: 'Ubiquitin-60S ribosomal protein L40',
    geneNames: 'UBA52 RPL40',
    organism: 'Homo sapiens',
    sequenceLength: 128,
    coverage: 92.0,
    scores: JSON.stringify({ structure: { score: 7.0, max: 10, rating: 'good' }, function: { score: 7.5, max: 10, rating: 'good' }, topology: { score: 7.0, max: 10, rating: 'good' }, feasibility: { score: 6.0, max: 10, rating: 'moderate' }, overall: { score: 6.9, max: 10, rating: 'moderate' } }),
    report: `# RPL40 (Ubiquitin-60S ribosomal protein L40) 可成药性评估

## 1. 概述

RPL40 是核糖体 60S 亚基的组成部分，同时包含一个泛素结构域。它既是核糖体蛋白又是泛素的来源。

## 2. 结构分析

| PDB ID | 方法 | 分辨率 (Å) | 说明 |
|--------|------|-----------|------|
| 1UBQ | NMR | - | 泛素结构域 |
| 4V6X | X-ray | 3.0 | 80S 核糖体复合物 |

## 3. 结论

RPL40 兼具核糖体和泛素功能，结构覆盖良好，但作为药物靶点的特异性有限。`,
    pdbStructures: [
      { pdbId: '1UBQ', method: 'NMR', resolution: null, title: 'Ubiquitin domain (shared)', releaseDate: '1987-01-15', ifTier: 'T1', journalIf: 25.4, organism: 'Homo sapiens' },
      { pdbId: '4V6X', method: 'X-ray', resolution: 3.0, title: '80S ribosome complex', releaseDate: '2011-07-22', ifTier: 'T1', journalIf: 22.1, organism: 'Homo sapiens' },
    ],
    blastResults: [
      { pdbId: '1UBQ', identity: 100, evalue: '0', queryCoverage: 76.0, method: 'NMR', resolution: null, title: 'Ubiquitin domain', ifTier: 'T1', journalIf: 25.4, source: 'pdbaa' },
    ],
  },
];

// ─── Combined reports ──────────────────────────────────────────────────────

const BATCH_1_COMBINED_REPORT = `# 批量评估报告：HER2/HER3 信号轴互作分析

## 1. 概述

本批次分析了 HER2 (ERBB2) 和 HER3 (ERBB3) 两个 EGFR 家族成员，它们形成强效的异二聚体信号复合体。

## 2. 共有 PDB 结构分析

以下 PDB 结构在两个靶点中均被检测到：

| PDB ID | 方法 | 分辨率 (Å) | 说明 |
|--------|------|-----------|------|
| 6J71 | Cryo-EM | 3.2 | HER2-HER3 异二聚体复合物 |

这表明 **6J71** 是直接解析 HER2/HER3 异二聚体的关键结构，为理解这两个靶点的相互作用提供了结构基础。

## 3. 跨靶点相关性分析

| 维度 | HER2 | HER3 | 相关性 |
|------|------|------|--------|
| 结构覆盖度 | 78.5% | 72.3% | 高 |
| 信号通路 | PI3K/AKT | PI3K/AKT | 完全一致 |
| 成药评分 | 7.3/10 | 6.4/10 | 中等 |
| 已上市药物 | 多款 | 无 | 差异大 |

## 4. 联合成药策略建议

1. **双靶点抗体**：同时靶向 HER2 和 HER3 的双特异性抗体
2. **PROTAC 策略**：利用泛素-蛋白酶体系统降解 HER2/HER3 异二聚体
3. **联合用药**：HER2 抑制剂 + HER3 抑制剂的联合方案

## 5. 结论

HER2/HER3 异二聚体是乳腺癌治疗的核心靶点组合。共有结构 6J71 为理解二者的相互作用提供了关键信息。建议开发同时靶向两者的双功能分子。`;

const BATCH_2_COMBINED_REPORT = `# 批量评估报告：泛素系统互作分析

## 1. 概述

本批次分析了 UBC (Polyubiquitin-C) 和 RPL40 (Ubiquitin-60S ribosomal protein L40)，两者都包含泛素结构域。

## 2. 共有 PDB 结构分析

| PDB ID | 方法 | 说明 |
|--------|------|------|
| 1UBQ | NMR | 经典泛素折叠结构 |

**1UBQ** 是泛素结构域的经典代表，被两个靶点共享，说明泛素折叠高度保守。

## 3. 跨靶点相关性

| 维度 | UBC | RPL40 | 相关性 |
|------|-----|-------|--------|
| 泛素结构域 | 有 | 有 | 完全一致 |
| 功能 | 蛋白降解 | 核糖体+降解 | 部分一致 |
| 成药评分 | 7.8/10 | 6.9/10 | 中等 |

## 4. PROTAC 应用前景

泛素是 PROTAC 分子的核心组件，两个靶点的高保守泛素结构为 PROTAC 设计提供了结构基础。

## 5. 结论

泛素系统高度保守，共有结构 1UBQ 是理解泛素折叠和 PROTAC 设计的关键。建议进一步研究泛素链链接类型对降解效率的影响。`;

// ─── Main seed function ────────────────────────────────────────────────────

async function seedBatch(batchId, title, targets, combinedReport, commonPdbIds) {
  console.log(`Seeding batch: ${title} (${batchId})`);

  // Create batch record
  await prisma.evaluationBatch.upsert({
    where: { batchId },
    create: {
      batchId,
      title,
      combinedReport,
      commonPdbIds: JSON.stringify(commonPdbIds),
      crossReportOk: true,
      crossReportProvider: 'z.ai-sdk',
      crossReportModel: 'glm-4.6',
      crossReportChars: combinedReport.length,
      targetCount: targets.length,
    },
    update: {
      title,
      combinedReport,
      commonPdbIds: JSON.stringify(commonPdbIds),
      crossReportOk: true,
      crossReportChars: combinedReport.length,
      targetCount: targets.length,
    },
  });

  // Create evaluations + PDB structures + BLAST results
  for (const t of targets) {
    const { pdbStructures, blastResults, ...evalData } = t;

    await prisma.evaluation.upsert({
      where: { uniprotId: evalData.uniprotId },
      create: {
        ...evalData,
        batchId,
        maxPdbUsed: 50,
        blastWasSkipped: false,
        pdbCountAtEval: pdbStructures.length,
      },
      update: {
        ...evalData,
        batchId,
        maxPdbUsed: 50,
        blastWasSkipped: false,
        pdbCountAtEval: pdbStructures.length,
      },
    });

    // Delete old PDB structures and BLAST results
    await prisma.evaluationPdbStructure.deleteMany({ where: { uniprotId: evalData.uniprotId } });
    await prisma.evaluationBlastResult.deleteMany({ where: { uniprotId: evalData.uniprotId } });

    // Insert PDB structures
    for (const s of pdbStructures) {
      await prisma.evaluationPdbStructure.create({
        data: {
          uniprotId: evalData.uniprotId,
          pdbId: s.pdbId,
          method: s.method,
          resolution: s.resolution,
          title: s.title,
          releaseDate: s.releaseDate,
          ifTier: s.ifTier,
          journalIf: s.journalIf,
          organism: s.organism,
          isCryoem: (s.method || '').toLowerCase().includes('em'),
          isXray: (s.method || '').toLowerCase().includes('x-ray'),
          isNmr: (s.method || '').toLowerCase().includes('nmr'),
        },
      });
    }

    // Insert BLAST results
    for (const b of blastResults) {
      await prisma.evaluationBlastResult.create({
        data: {
          uniprotId: evalData.uniprotId,
          pdbId: b.pdbId,
          identity: b.identity,
          evalue: b.evalue,
          queryCoverage: b.queryCoverage,
          method: b.method,
          resolution: b.resolution,
          title: b.title,
          ifTier: b.ifTier,
          journalIf: b.journalIf,
          source: b.source,
        },
      });
    }

    console.log(`  ✓ ${evalData.uniprotId} (${evalData.proteinName}) — ${pdbStructures.length} PDB, ${blastResults.length} BLAST`);
  }
}

async function main() {
  console.log('Seeding fake batch evaluation data...\n');

  // Batch 1: HER2/HER3 signaling axis
  await seedBatch(
    'batch-her2-her3-2025',
    'HER2/HER3 Signaling Axis',
    BATCH_1_TARGETS,
    BATCH_1_COMBINED_REPORT,
    ['6J71'],
  );

  console.log('');

  // Batch 2: Ubiquitin system
  await seedBatch(
    'batch-ubiquitin-2025',
    'Ubiquitin System (UBC + RPL40)',
    BATCH_2_TARGETS,
    BATCH_2_COMBINED_REPORT,
    ['1UBQ'],
  );

  console.log('\n✅ Seed complete!');
  console.log('Created 2 batches with 4 evaluations total.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
