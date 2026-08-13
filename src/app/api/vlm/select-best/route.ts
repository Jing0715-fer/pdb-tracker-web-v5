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
    const defaultPrompt = `你是一位结构生物学专家。请查看以下${screenshots.length}张蛋白质3D结构截图，它们分别从不同角度（${screenshots.map(s => s.angle).join('、')}）拍摄。

分析背景：${analysisSummary || recipeContext}

请选择最能清晰展示"${recipeContext}"的那张截图。考虑以下因素：
1. 关键结构特征是否清晰可见
2. 配体/残基/互作是否没有被遮挡
3. 构图是否平衡、视觉上是否易于理解

请以JSON格式回复（不要其他内容）：
{"bestIndex": <0-based索引>, "reason": "<简短中文说明为什么选择这张>"}`;

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

    // Parse the VLM response to extract bestIndex
    let bestIndex = 0;
    let commentary = vlmResponse;

    // Try to extract JSON from the response
    const jsonMatch = vlmResponse.match(/\{[\s\S]*?"bestIndex"[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (typeof parsed.bestIndex === 'number' && parsed.bestIndex >= 0 && parsed.bestIndex < screenshots.length) {
          bestIndex = parsed.bestIndex;
        }
        if (parsed.reason) {
          commentary = parsed.reason;
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
