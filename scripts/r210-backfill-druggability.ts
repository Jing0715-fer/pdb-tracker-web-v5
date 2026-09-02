// R210: 存量评估回填可成药性四维评分（druggability 子对象）。
//
// 背景：真实评估（classic + DSH）落库 scores 只含方法学键
// （X-ray/Cryo-EM/NMR/Overall，0-10），EvaluationScoreCard 期望
// {structure, function, topology, feasibility, overall}（0-100）→ 恒 0/F。
// 新运行由 collect.ts 直接写入；本脚本对存量行按同一公式回填：
//   - 覆盖率 / 结构数 / 方法 / 分辨率 / 配体：EvaluationPdbStructure 关系行
//   - 同源数：EvaluationBlastResult 计数
//   - 文献数：provenance.phases.collect.literatureCount（缺失按 0）
//   - 方法学综合：沿用库内 Overall 键（缺失时按公式重算）
// legacy 顶层五键形态（seed-demo 演示数据）已可显示，跳过不覆盖。
//
// 用法：bun run scripts/r210-backfill-druggability.mjs [--apply]
// （默认 dry-run 只打印将写入的值。）

import { db } from '../src/lib/db.ts';
import { computeDruggabilityScores } from '../src/lib/druggability.ts';

const apply = process.argv.includes('--apply');

async function main() {
  const rows = await db.$queryRawUnsafe(
    `SELECT uniprotId, proteinName, coverage, scores, provenance FROM Evaluation ORDER BY updatedAt DESC`,
  );
  let updated = 0;
  let skipped = 0;
  for (const r of rows) {
    const uid = String(r.uniprotId);
    let parsed = {};
    try { parsed = r.scores ? JSON.parse(r.scores) : {}; } catch { /* 重建 */ }
    if (parsed.druggability) {
      console.log(`  skip ${uid}（已有 druggability）`);
      skipped++;
      continue;
    }
    // legacy seed-demo 顶层五键形态 → 卡片已可显示，不覆盖。
    const legacyKeys = ['structure', 'function', 'topology', 'feasibility', 'overall']
      .filter(k => typeof parsed[k] === 'number');
    if (legacyKeys.length >= 3) {
      console.log(`  skip ${uid}（legacy 五键形态，卡片可显示）`);
      skipped++;
      continue;
    }

    const structs = (await db.$queryRaw`SELECT method, resolution, ligandNames FROM EvaluationPdbStructure WHERE uniprotId = ${uid}`);
    const blastRows = (await db.$queryRaw`SELECT count(*) AS n FROM EvaluationBlastResult WHERE uniprotId = ${uid}`);
    let literatureCount = 0;
    try {
      const prov = r.provenance ? JSON.parse(r.provenance) : null;
      literatureCount = prov?.phases?.collect?.literatureCount ?? 0;
    } catch { /* 缺 provenance 按 0 */ }

    const resolutions = structs.map(s => s.resolution).filter((x): x is number => x != null && x > 0);
    const ligandRich = structs.filter(s => (s.ligandNames || '').trim().length > 0).length;
    const methodDiversity = Math.max(1, Math.min(3,
      1
      + (structs.some(s => (s.method || '').includes('X-RAY')) ? 1 : 0)
      + (structs.some(s => (s.method || '').includes('ELECTRON')) ? 1 : 0)
      + (structs.some(s => (s.method || '').includes('NMR')) ? 1 : 0),
    ));
    // 方法学综合：优先库内 Overall 键；缺失按 collect 公式重算。
    const overallKey = parsed["Overall"];
    const methodCount = (m: string) => structs.filter(s => (s.method || '').includes(m)).length;
    const calcScore = (count: number) => Math.min(10, Math.max(1, Math.round(Math.sqrt(Math.max(0, count)) * 2)));
    const overallMethodScore = overallKey && typeof overallKey.score === 'number'
      ? overallKey.score
      : Math.min(10, Math.max(1, Math.round((calcScore(methodCount('X-RAY')) + calcScore(methodCount('ELECTRON')) + calcScore(methodCount('NMR'))) / 3)));

    const breakdown = computeDruggabilityScores({
      coverage: Number(r.coverage ?? 0),
      pdbCount: structs.length,
      blastCount: Number(blastRows[0]?.n ?? 0),
      literatureCount,
      bestResolution: resolutions.length > 0 ? Math.min(...resolutions) : null,
      ligandRichCount: ligandRich,
      methodDiversity,
      overallMethodScore,
    });
    console.log(
      `${uid} ${String(r.proteinName || '').slice(0, 30)} → 总分 ${breakdown.overall}/100（结构 ${breakdown.structure} · 功能 ${breakdown.function} · 拓扑 ${breakdown.topology} · 可行性 ${breakdown.feasibility}）`
      + `［cov=${Number(r.coverage ?? 0)} pdb=${structs.length} blast=${Number(blastRows[0]?.n ?? 0)} lit=${literatureCount} bestRes=${resolutions.length > 0 ? Math.min(...resolutions) : '—'} ligandRich=${ligandRich}/${structs.length} methods=${methodDiversity} overallMethod=${overallMethodScore}］`,
    );
    if (apply) {
      const merged = { ...parsed, druggability: breakdown };
      await db.$executeRaw`UPDATE Evaluation SET scores = ${JSON.stringify(merged)} WHERE uniprotId = ${uid}`;
      updated++;
    }
  }
  console.log(apply ? `Done：回填 ${updated} 行，跳过 ${skipped} 行。` : `Dry-run 完成（加 --apply 落库）。跳过 ${skipped} 行。`);
  await db.$disconnect();
}

main();
