/**
 * R210: 数据驱动的可成药性评分（Druggability Score，0-100 四维 + 总分）。
 *
 * 背景：Evaluation.scores 历来只存方法学评分（X-ray/Cryo-EM/NMR/Overall，
 * 0-10 制），而 EvaluationScoreCard 期望 {structure, function, topology,
 * feasibility, overall}（0-100 制）—— 键不匹配导致卡片恒显示 0/100/F。
 *
 * 本模块用「收集期真实数据」确定性计算四维评分（零 LLM 依赖、可解释、
 * 失败永不阻塞收集管线）。公式各分项上限注释在右侧，总分按
 * 30/30/20/20 加权。服务端（collect.ts 写库）与回填脚本共用；
 * 纯函数无外部依赖。
 */

export interface DruggabilityInput {
  /** 结构覆盖率 0-100。 */
  coverage: number;
  /** 直接 PDB 结构条数。 */
  pdbCount: number;
  /** BLAST 同源命中条数（0 = 未跑或跳过）。 */
  blastCount: number;
  /** 收集到的文献篇数。 */
  literatureCount: number;
  /** 最佳（最小）分辨率 Å；无结构时 null。 */
  bestResolution: number | null;
  /** 含结合配体的结构条数（配体 = 结合态/口袋证据）。 */
  ligandRichCount: number;
  /** 有结构的方法学种数（X-ray/Cryo-EM/NMR 中 ≥1 条的计数，1-3）。 */
  methodDiversity: number;
  /** 方法学综合评分（collect Overall，0-10）。 */
  overallMethodScore: number;
}

export interface DruggabilityBreakdown {
  structure: number;
  function: number;
  topology: number;
  feasibility: number;
  overall: number;
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

/** 分辨率分项（0-30）：≤1.5Å 顶尖 → ≤2.0 优秀 → ≤2.5 良好 → ≤3.5 可用 → ≤5 勉强。 */
function resolutionPoints(best: number | null): number {
  if (best == null || !isFinite(best) || best <= 0) return 0;
  if (best <= 1.5) return 30;
  if (best <= 2.0) return 26;
  if (best <= 2.5) return 22;
  if (best <= 3.5) return 14;
  if (best <= 5.0) return 7;
  return 0;
}

/** 数量分项通用曲线：sqrt 饱和增长（count → maxPts 满分所需数量随 maxPts 放大）。 */
function countPoints(count: number, maxPts: number, fullAt: number): number {
  if (count <= 0) return 0;
  return Math.min(maxPts, Math.round(Math.sqrt(count / fullAt) * maxPts));
}

/**
 * 计算四维可成药性评分（全部 0-100）。
 *
 * - structure（结构资产）：覆盖率 40 + 结构量 30 + 最佳分辨率 30
 * - topology（架构/口袋认知）：覆盖率 40 + 配体结合态占比 30 + 方法学多样性 30
 * - function（功能/靶点验证）：文献量 40 + 配体结合态占比 35 + 同源结构 25
 * - feasibility（结构解析可行性）：方法学综合 50 + 分辨率 30 + 覆盖率 20
 * - overall：structure 30% + function 30% + topology 20% + feasibility 20%
 */
export function computeDruggabilityScores(input: DruggabilityInput): DruggabilityBreakdown {
  const coverage = clamp(input.coverage ?? 0, 0, 100);
  const ligandRatio = input.pdbCount > 0 ? clamp(input.ligandRichCount / input.pdbCount, 0, 1) : 0;
  const methodDiversity = Math.max(1, Math.min(3, Math.round(input.methodDiversity || 1)));
  const overallMethod = clamp(input.overallMethodScore ?? 0, 0, 10);

  const structure = clamp(
    Math.round(coverage * 0.4) +            // 0-40
    countPoints(input.pdbCount, 30, 20) +   // 0-30（20 条结构满分）
    resolutionPoints(input.bestResolution), // 0-30
  );

  const topology = clamp(
    Math.round(coverage * 0.4) +                 // 0-40
    Math.round(ligandRatio * 30) +               // 0-30（全部结构有配体满分）
    methodDiversity * 10,                        // 0-30（单方法 10 → 三方法 30）
  );

  const fn = clamp(
    countPoints(input.literatureCount, 40, 20) + // 0-40（20 篇文献满分）
    Math.round(ligandRatio * 35) +               // 0-35（结合态 = 验证证据）
    countPoints(input.blastCount, 25, 50),       // 0-25（50 条同源满分）
  );

  const feasibility = clamp(
    Math.round(overallMethod * 5) +              // 0-50（方法学综合 10 → 50）
    resolutionPoints(input.bestResolution) +     // 0-30
    Math.round(coverage * 0.2),                  // 0-20
  );

  const overall = clamp(
    Math.round(structure * 0.3 + fn * 0.3 + topology * 0.2 + feasibility * 0.2),
  );

  return { structure, function: fn, topology, feasibility, overall };
}

/**
 * 从 Evaluation.scores JSON 解析四维评分（EvaluationScoreCard 用）。
 * 两形态：① v2 嵌套 `druggability` 子对象（DSH collect 落库新格式）
 * ② legacy 顶层五键（seed-demo 硬编码形态）。均缺失 → null（调用方显示 0）。
 */
export function parseDruggabilityFromScores(
  scoresJson: string | null | undefined,
): DruggabilityBreakdown | null {
  if (!scoresJson) return null;
  try {
    const parsed = JSON.parse(scoresJson);
    if (!parsed || typeof parsed !== 'object') return null;
    const d = (parsed as Record<string, unknown>).druggability;
    if (d && typeof d === 'object') {
      const o = d as Record<string, unknown>;
      const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? clamp(Math.round(v)) : null);
      const structure = num(o.structure);
      const fn = num(o.function);
      const topology = num(o.topology);
      const feasibility = num(o.feasibility);
      const overall = num(o.overall);
      if (structure == null && fn == null && topology == null && feasibility == null && overall == null) return null;
      return {
        structure: structure ?? 0,
        function: fn ?? 0,
        topology: topology ?? 0,
        feasibility: feasibility ?? 0,
        overall: overall ?? 0,
      };
    }
    // legacy 顶层形态（seed-demo）：{structure, function, topology, feasibility, overall} 数字
    const top = parsed as Record<string, unknown>;
    const keys = ['structure', 'function', 'topology', 'feasibility', 'overall'] as const;
    const found = keys.filter(k => typeof top[k] === 'number');
    if (found.length >= 3) {
      return {
        structure: clamp(Math.round(Number(top.structure) || 0)),
        function: clamp(Math.round(Number(top.function) || 0)),
        topology: clamp(Math.round(Number(top.topology) || 0)),
        feasibility: clamp(Math.round(Number(top.feasibility) || 0)),
        overall: clamp(Math.round(Number(top.overall) || 0)),
      };
    }
    return null;
  } catch {
    return null;
  }
}
