/**
 * Round 61: VLM (Vision Language Model) API — Select Best Screenshot
 *
 * POST /api/vlm/select-best
 * Body: {
 *   screenshots: Array<{ dataUri: string; angle: string; label: string }>,
 *   recipe: string,          // e.g. "binding_pocket"
 *   analysisSummary: string,  // text summary of the analysis results
 *   prompt?: string           // optional custom prompt
 * }
 *
 * Uses z-ai-web-dev-sdk's createVision() to analyze each screenshot and
 * select the one that best illustrates the analysis. Returns the index
 * of the best screenshot + a commentary explaining why.
 *
 * Backend-only — z-ai-web-dev-sdk MUST NOT be used in client-side code.
 */
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { screenshots, recipe, analysisSummary, prompt } = body as {
      screenshots: Array<{ dataUri: string; angle: string; label: string }>;
      recipe: string;
      analysisSummary?: string;
      prompt?: string;
    };

    if (!screenshots || !Array.isArray(screenshots) || screenshots.length === 0) {
      return NextResponse.json({ error: 'screenshots array is required' }, { status: 400 });
    }

    if (screenshots.length === 1) {
      // Only one screenshot — no need to call VLM, just return it
      return NextResponse.json({
        bestIndex: 0,
        commentary: 'Only one screenshot available — auto-selected.',
        recipe,
      });
    }

    // Dynamically import z-ai-web-dev-sdk (backend-only)
    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    const zai = await ZAI.create();

    // Build the VLM prompt based on the recipe type
    const recipeContext = getRecipeContext(recipe);
    // Round 73: Extract key residues from analysis summary for VLM reference
    const residueInfo = extractResidueInfo(analysisSummary || '');
    const residueText = residueInfo ? `\n\n关键残基信息（请在评语中引用这些残基名称）：\n${residueInfo}` : '';

    const defaultPrompt = `你是一位结构生物学专家。请查看以下${screenshots.length}张蛋白质3D结构截图，它们分别从不同角度（${screenshots.map(s => s.angle).join('、')}）拍摄。

分析背景：${analysisSummary || recipeContext}${residueText}

请选择最能清晰展示"${recipeContext}"的那张截图。考虑以下因素：
1. 关键结构特征是否清晰可见
2. 配体/残基/互作是否没有被遮挡
3. 构图是否平衡、视觉上是否易于理解
4. 关键残基（如催化残基、口袋残基）是否在视野中可见

请以JSON格式回复（不要其他内容）：
{"bestIndex": <0-based索引>, "reason": "<简短中文说明为什么选择这张，引用具体残基名称>", "scores": [<截图1分数>, <截图2分数>, ...], "confidence": "<high|medium|low>", "comments": ["<截图1的15-30字中文评语>", "<截图2的评语>", ...], "quality": "<acceptable|degraded|unacceptable>", "issues": ["<截图1的问题>", "<截图2的问题>"], "recaptureHints": {"angles": ["<建议角度>"], "focus": "<interface|ligand|residue|chain>", "zoom": "<in|out>"}}

每张截图的分数为1-10的整数，10分最佳。评分标准：
- 结构特征清晰可见程度 (0-4分)
- 关键信息未被遮挡 (0-3分)
- 构图平衡和视觉清晰度 (0-3分)

confidence表示你对最佳选择的确信程度：
- high: 最佳截图明显优于其他（分数差距 ≥3）
- medium: 最佳截图较好但差距不大（分数差距 1-2）
- low: 截图质量相近，难以区分（分数差距 0）

comments数组必须为每张截图提供一条15-30字的中文评语，描述该截图所展示的具体结构特征（引用残基名称/链/配体），不要泛泛而谈。

quality字段表示截图整体质量：
- "acceptable": 截图清晰展示了分析目标（侧链可见、氢键连线可见、结构未被遮挡）
- "degraded": 截图部分可用但存在问题（如侧链未显示、连线缺失、角度不佳）
- "unacceptable": 截图无法用于分析（黑屏、结构不可见、完全遮挡）

issues数组列出每张截图存在的具体问题（用中文），例如：
- "侧链未显示（ball-and-stick缺失）"
- "氢键连线（虚线）未显示"
- "关键残基被遮挡"
- "结构太远/太近"
- "黑屏或空白"

recaptureHints对象提供重新截图的建议（当quality为degraded或unacceptable时）：
- angles: 建议尝试的角度（如["side","top"]）
- focus: 建议聚焦目标（"interface"/"ligand"/"residue"/"chain"）
- zoom: 建议缩放方向（"in"/"out"）

特别注意：对于互作分析（hbonds/salt_bridges/all_interactions/ligand_interactions），必须验证：
1. 侧链是否以ball-and-stick方式显示（彩色的小球和棍子）
2. 氢键/互作连线是否以虚线显示
3. 关键残基是否有标签标注
如果这些元素缺失，quality应设为degraded或unacceptable，并在issues中说明。`;

    const userPrompt = prompt || defaultPrompt;

    // Build the VLM message with all screenshots
    const content: Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    > = [{ type: 'text', text: userPrompt }];

    for (let i = 0; i < screenshots.length; i++) {
      const s = screenshots[i];
      content.push({
        type: 'text',
        text: `\n--- 截图 ${i + 1}（角度: ${s.angle}）---`,
      });
      content.push({
        type: 'image_url',
        image_url: { url: s.dataUri },
      });
    }

    const response = await zai.chat.completions.createVision({
      messages: [
        {
          role: 'user',
          content,
        },
      ],
      thinking: { type: 'disabled' },
    });

    const vlmResponse = response.choices?.[0]?.message?.content || '';

    // Parse the VLM response to extract bestIndex + scores + confidence + comments
    let bestIndex = 0;
    let commentary = vlmResponse;
    let scores: number[] = [];
    let confidence: 'high' | 'medium' | 'low' = 'medium';
    let comments: string[] = [];
    let quality: 'acceptable' | 'degraded' | 'unacceptable' = 'acceptable';
    let issues: string[] = [];
    let recaptureHints: { angles?: string[]; focus?: string; zoom?: 'in' | 'out' } = {};

    // Try to extract JSON from the response
    const jsonMatch = vlmResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (typeof parsed.bestIndex === 'number' && parsed.bestIndex >= 0 && parsed.bestIndex < screenshots.length) {
          bestIndex = parsed.bestIndex;
        }
        if (parsed.reason) {
          commentary = parsed.reason;
        }
        // Round 64: Extract quality scores (1-10 per screenshot)
        if (Array.isArray(parsed.scores)) {
          scores = parsed.scores
            .map((s: unknown) => typeof s === 'number' ? s : parseInt(String(s), 10))
            .filter((s: number) => !isNaN(s) && s >= 1 && s <= 10)
            .slice(0, screenshots.length);
        }
        // Round 65: Extract confidence level
        if (typeof parsed.confidence === 'string') {
          const c = parsed.confidence.toLowerCase();
          if (c === 'high' || c === 'medium' || c === 'low') {
            confidence = c;
          }
        }
        // Round 95: Extract per-image comments array
        if (Array.isArray(parsed.comments)) {
          comments = parsed.comments
            .map((c: unknown) => typeof c === 'string' ? c : String(c ?? ''))
            .filter((c: string) => c.length > 0)
            .slice(0, screenshots.length);
        }
        // Round 98: Extract quality assessment
        if (typeof parsed.quality === 'string') {
          const q = parsed.quality.toLowerCase();
          if (q === 'acceptable' || q === 'degraded' || q === 'unacceptable') {
            quality = q;
          }
        }
        // Round 98: Extract per-image issues
        if (Array.isArray(parsed.issues)) {
          issues = parsed.issues
            .map((i: unknown) => typeof i === 'string' ? i : String(i ?? ''))
            .filter((i: string) => i.length > 0)
            .slice(0, screenshots.length);
        }
        // Round 98: Extract recapture hints
        if (parsed.recaptureHints && typeof parsed.recaptureHints === 'object') {
          const rh = parsed.recaptureHints as Record<string, unknown>;
          if (Array.isArray(rh.angles)) {
            recaptureHints.angles = (rh.angles as unknown[])
              .map((a) => String(a ?? ''))
              .filter((a: string) => ['front', 'side', 'top', 'back'].includes(a));
          }
          if (typeof rh.focus === 'string') {
            recaptureHints.focus = rh.focus as string;
          }
          if (typeof rh.zoom === 'string') {
            recaptureHints.zoom = rh.zoom as 'in' | 'out';
          }
        }
      } catch {
        // JSON parse failed — use the raw response as commentary
      }
    } else {
      // Try to find a number in the response that could be the index
      const numMatch = vlmResponse.match(/(\d+)/);
      if (numMatch) {
        const num = parseInt(numMatch[1], 10);
        if (num >= 1 && num <= screenshots.length) {
          bestIndex = num - 1; // 1-based to 0-based
        }
      }
    }

    return NextResponse.json({
      bestIndex,
      commentary,
      scores,
      confidence,
      comments,
      quality,
      issues,
      recaptureHints,
      recipe,
      vlmResponse,
    });
  } catch (error: any) {
    console.error('[vlm/select-best] Error:', error);
    return NextResponse.json(
      {
        error: 'VLM analysis failed: ' + (error?.message || 'unknown'),
        bestIndex: 0, // fallback to first screenshot
        commentary: 'VLM analysis failed — auto-selected first screenshot.',
      },
      { status: 500 }
    );
  }
}

/** Get a human-readable description of what the recipe analyzes. */
function getRecipeContext(recipe: string): string {
  const contexts: Record<string, string> = {
    binding_pocket: '结合口袋分析 — 配体周围的残基、口袋体积和组成',
    druggability: '可成药性评估 — 口袋的药物可及性和成药潜力',
    all_interactions: '全互作分析 — 链间氢键、盐桥和疏水接触',
    hbonds: '氢键分析 — 供体-受体间的氢键网络',
    salt_bridges: '盐桥分析 — 正负电荷残基间的离子相互作用',
    hydrophobic_contacts: '疏水接触分析 — 疏水残基间的相互作用',
    ligand_interactions: '配体互作指纹 — 配体周围的所有接触类型',
    disulfide_bonds: '二硫键分析 — CYS-CYS之间的共价连接',
    metal_coordination: '金属配位分析 — 金属离子与配位残基',
    aromatic_stacking: '芳香堆积分析 — π-π和cation-π堆积',
    water_bridges: '水桥分析 — 蛋白-水-蛋白氢键网络',
    sasa: '溶剂可及面积分析 — 残基的表面暴露程度',
    electrostatic: '静电势分析 — 残基电荷和静电能',
    apbs_electrostatic: 'APBS静电势分析 — Poisson-Boltzmann表面静电',
    virtual_screening: '虚拟筛选结果 — Top命中片段在口袋中的对接构象',
    druglike_screening: '类药性虚拟筛选 — 类药分子对接和ADMET',
    interface_residues: '界面残基分析 — 链间接触面上的残基',
    secondary_structure_simple: '二级结构分析 — α螺旋/β折叠/无规卷曲分布',
    bfactor_stats: 'B因子分析 — 原子温度因子分布',
    rmsd: 'RMSD分析 — 链间结构偏差',
    detect_pockets: '口袋检测 — 网格法检测的所有可及口袋',
    oligomer_analysis: '寡聚体分析 — 组装状态和对称性',
    surface_residues: '表面残基分析 — 表面vs埋藏残基',
    conformational_changes: '构象变化分析 — 柔性区域识别',
    protonation_states: '质子化状态分析 — 可电离残基的质子化',
    summary: '结构摘要 — 链/残基/原子计数和配体列表',
  };
  return contexts[recipe] || `结构分析结果 (${recipe})`;
}

/**
 * Round 73: Extract key residue information from the analysis summary text.
 * The analysis summary is a JSON string containing recipe results. This function
 * parses it and extracts residue names/numbers that the VLM can reference.
 *
 * Extracts:
 * - Pocket residues (from binding_pocket results)
 * - Catalytic residues (CYS/HIS dyads)
 * - Top interaction residues (from hbonds/salt_bridges)
 * - Ligand name
 *
 * Returns a formatted string or null if no residues found.
 */
function extractResidueInfo(summary: string): string | null {
  try {
    // The summary is a JSON string — try to parse it
    let data: any;
    try {
      data = JSON.parse(summary);
    } catch {
      // Not JSON — try to extract residue patterns from plain text
      const residuePattern = /([A-Z]{3})(\d+)\(([A-Z])\)/g;
      const matches = [...summary.matchAll(residuePattern)];
      if (matches.length > 0) {
        const residues = matches.slice(0, 10).map(m => `${m[1]}${m[2]}(${m[3]})`);
        return `检测到的残基: ${residues.join(', ')}`;
      }
      return null;
    }

    const lines: string[] = [];

    // Extract from binding_pocket
    if (data.bindingPocket || data.binding_pocket) {
      const bp = data.bindingPocket || data.binding_pocket;
      if (bp.ligand) lines.push(`配体: ${bp.ligand}`);
      if (bp.topResidues && Array.isArray(bp.topResidues)) {
        lines.push(`口袋残基: ${bp.topResidues.slice(0, 8).join(', ')}`);
      }
      if (bp.catalyticResidues && Array.isArray(bp.catalyticResidues) && bp.catalyticResidues.length > 0) {
        lines.push(`催化残基: ${bp.catalyticResidues.join(', ')}`);
      }
    }

    // Extract from residues array (binding_pocket format)
    if (data.residues && Array.isArray(data.residues)) {
      const topRes = data.residues.slice(0, 8).map((r: any) =>
        `${r.resname || '?'}${r.resno || '?'}(${r.chain || '?'})`
      );
      if (topRes.length > 0) lines.push(`口袋残基: ${topRes.join(', ')}`);
    }

    // Extract from hbonds
    if (data.hbonds && Array.isArray(data.hbonds)) {
      const hbondRes = data.hbonds.slice(0, 5).map((h: any) =>
        `${h.donor_resname || '?'}${h.donor_resno || '?'} → ${h.acceptor_resname || '?'}${h.acceptor_resno || '?'}`
      );
      if (hbondRes.length > 0) lines.push(`氢键残基对: ${hbondRes.join(', ')}`);
    }

    // Extract from salt_bridges
    if (data.salt_bridges && Array.isArray(data.salt_bridges)) {
      const sbRes = data.salt_bridges.slice(0, 5).map((s: any) =>
        `${s.pos_resname || '?'}${s.pos_resno || '?'}(+) ↔ ${s.neg_resname || '?'}${s.neg_resno || '?'}(−)`
      );
      if (sbRes.length > 0) lines.push(`盐桥残基对: ${sbRes.join(', ')}`);
    }

    // Extract from all_interactions
    if (data.interactions && Array.isArray(data.interactions)) {
      const aiRes = data.interactions.slice(0, 5).map((i: any) =>
        `${i.resname1 || '?'}${i.resno1 || '?'} ↔ ${i.resname2 || '?'}${i.resno2 || '?'}`
      );
      if (aiRes.length > 0) lines.push(`互作残基对: ${aiRes.join(', ')}`);
    }

    // Extract ligand name
    if (data.ligand) lines.push(`配体: ${data.ligand}`);

    return lines.length > 0 ? lines.join('\n') : null;
  } catch {
    return null;
  }
}
