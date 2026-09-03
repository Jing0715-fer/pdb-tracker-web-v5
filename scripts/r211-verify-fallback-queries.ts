// scripts/r211-verify-fallback-queries.ts
//
// R211 功能验证：fallbackFigureQueries / sanitizeProteinNameForFigureQuery
// 纯函数断言（bun 直跑，无测试框架 —— 与 R208/R209/R210 验证脚本同模式）。
//
//   bun run scripts/r211-verify-fallback-queries.ts

import {
  fallbackFigureQueries,
  sanitizeProteinNameForFigureQuery,
} from '@/lib/eval-dsh/figures';

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string, extra?: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// ── T1: 蛋白名清洗 ──────────────────────────────────────────────────────────
console.log('T1 sanitizeProteinNameForFigureQuery');
ok(sanitizeProteinNameForFigureQuery('Hemoglobin subunit alpha') === 'Hemoglobin subunit alpha', '普通名原样保留');
ok(sanitizeProteinNameForFigureQuery('Hemoglobin subunit alpha (HBA_HUMAN)') === 'Hemoglobin subunit alpha', '括注 entry name 剥离');
ok(sanitizeProteinNameForFigureQuery('Epidermal growth factor receptor (Homo sapiens)') === 'Epidermal growth factor receptor', '括注物种剥离');
ok(sanitizeProteinNameForFigureQuery('Unknown (UniProt fetch failed)') === null, 'UniProt 失败占位名 → null');
ok(sanitizeProteinNameForFigureQuery('Input Sequence (283aa)') === null, '序列未识别占位名 → null');
ok(sanitizeProteinNameForFigureQuery('') === null, '空串 → null');
ok(sanitizeProteinNameForFigureQuery('   ') === null, '纯空白 → null');
const long = 'X'.repeat(200);
ok((sanitizeProteinNameForFigureQuery(long) || '').length === 80, '超长截断 80');
ok(sanitizeProteinNameForFigureQuery('  A  B   C ') === 'A B C', '空白压缩');
ok(sanitizeProteinNameForFigureQuery('Unidentified protein') === null, 'unidentified 前缀 → null');
ok(sanitizeProteinNameForFigureQuery('N/A') === null, 'n/a → null');

// ── T2: 基础评估大纲（无问题模式典型形态）──────────────────────────────────
console.log('T2 基础评估大纲回退');
const basicOutline = ['summary', 'function', 'pdb_analysis', 'structure_quality', 'druggability', 'literature', 'references', 'conclusion'];
const basicQueries = fallbackFigureQueries(basicOutline, 'Hemoglobin subunit alpha');
ok(basicQueries.length === 2, `基础大纲 → 2 条（function/druggability），实际 ${basicQueries.length}`, JSON.stringify(basicQueries));
ok(basicQueries[0]?.sectionId === 'function', '首条按大纲顺序映射 function');
ok(basicQueries[0]?.query === 'Hemoglobin subunit alpha protein function mechanism diagram', 'function 模板填充');
ok(basicQueries[1]?.sectionId === 'druggability', '次条映射 druggability');
ok(basicQueries[1]?.query === 'Hemoglobin subunit alpha drug target binding pocket schematic', 'druggability 模板填充');

// ── T3: 问题模式大纲（含深挖章）+ 上限 4 ──────────────────────────────────
console.log('T3 深挖大纲回退与上限');
const richOutline = ['summary', 'question_focus', 'function', 'pathway', 'topology', 'domains', 'ligand_binding', 'interactions', 'druggability', 'references', 'conclusion'];
const richQueries = fallbackFigureQueries(richOutline, 'EGFR');
ok(richQueries.length === 4, `可映射章节 7 个但截断为 4，实际 ${richQueries.length}`);
ok(richQueries.map(q => q.sectionId).join(',') === 'function,pathway,topology,domains', '按大纲顺序取前 4');
ok(richQueries[1]?.query === 'EGFR signaling pathway diagram', 'pathway 模板填充');
ok(richQueries.every(q => q.query.startsWith('EGFR')), '全部 query 含蛋白名');

// ── T4: 不可映射章节跳过 / 边界 ────────────────────────────────────────────
console.log('T4 边界形态');
ok(fallbackFigureQueries(['summary', 'pdb_analysis', 'references'], 'EGFR').length === 0, '全部为不可映射章节 → 空（RCSB 结构图已覆盖）');
ok(fallbackFigureQueries([], 'EGFR').length === 0, '空大纲 → 空');
ok(fallbackFigureQueries(basicOutline, 'Unknown (UniProt fetch failed)').length === 0, '占位蛋白名 → 空（宁缺毋滥）');
ok(fallbackFigureQueries(richOutline, '').length === 0, '空蛋白名 → 空');

// ── T5: searchWebFigures 消费兼容（结构同 relevance 产出）─────────────────
console.log('T5 产物结构兼容');
const shape = fallbackFigureQueries(basicOutline, 'Hemoglobin subunit alpha');
ok(shape.every(q => typeof q.sectionId === 'string' && typeof q.query === 'string' && q.query.length <= 120), '{sectionId, query} 结构与相关性分析产物同形（query ≤120 截断上限内）');
const dupCheck = new Set(shape.map(q => q.query));
ok(dupCheck.size === shape.length, 'query 无重复');

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
