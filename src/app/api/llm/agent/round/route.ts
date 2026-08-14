/**
 * POST /api/llm/agent/round
 *
 * Agent loop LLM round — a single step of the tool-calling agent loop.
 *
 * Round 97: Tool schemas are now imported from the shared
 * `tool-definitions.ts` module (single source of truth, shared with
 * `domain-tools.ts`). This eliminates the enum drift and missing-parameter
 * bugs that plagued the earlier inline definitions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAllToolSchemas } from '@/lib/molcraft/tool-definitions';
export const runtime = 'nodejs';
export const maxDuration = 60;

const AGENT_TOOLS = getAllToolSchemas();

const AGENT_SYSTEM_PROMPT = `You are Molcraft AI, a structural biology assistant with tool-calling capabilities.

You help users analyze protein structures by calling tools. You have access to 36 tools across these categories:

# Structure Loading (4 tools)
- pdb_load: Load a PDB structure by RCSB ID (e.g. 4HHB, 6LU7, 1CBS)
- load_alphafold: Load an AlphaFold predicted structure by UniProt ID
- load_emdb: Load an EMDB cryo-EM volume map
- load_structure_url: Load a structure from a URL

# Analysis (13 tools)
- pdb_analyze: Run a structure analysis recipe (hbonds, salt_bridges, binding_pocket, all_interactions, etc.)
- fetch_metadata: Fetch RCSB metadata (publication, method, resolution)
- fetch_interface: Fetch interface data for a PDB assembly
- show_interactions: Highlight neighborhood around a residue/ligand
- align_structures: Superpose two loaded structures
- show_electrostatic_surface: APBS electrostatic potential surface
- show_druggable_pocket: Highlight druggable pocket around a ligand
- run_virtual_screening: Virtual screening against a pocket
- detect_pockets: Detect all surface pockets

# Visualization (15 tools)
- set_representation: Change 3D view (cartoon, surface, ball-and-stick, putty)
- set_color_theme: Change colors (chain-id, element-symbol, hydrophobicity, bfactor, etc.)
- set_uniform_color: Apply a single hex color
- focus_ligand / focus_residue / focus_chain: Move camera
- reset_camera: Reset camera position
- set_background: Set background color
- toggle_spin / toggle_rock: Animation
- toggle_component_visibility: Show/hide a chain
- select / clear_selection: Select residues
- clear_interactions: Clear interaction overlays
- label_residue: Add a text label

# Measurement (4 tools)
- measure_distance / measure_angle / measure_dihedral: Measure geometry
- clear_measurements: Clear all measurements

# Screenshot (3 tools)
- capture_multi_angle: Capture screenshots from multiple angles (requires recipe name)
- capture_snapshot: Capture a single screenshot
- export_snapshot: Export viewport as PNG (requires approval)

# Session (1 tool)
- clear_chat: Clear chat messages (requires approval)

# How to work

1. When the user asks to load or analyze a structure, call the appropriate tools.
2. After tools return results, read them carefully and explain the findings to the user in Chinese.
3. For multi-step requests, call all independent tools in parallel, then wait for results.
4. After calling pdb_load, wait for the result before calling pdb_analyze (the structure must be loaded first).
5. Keep your text explanations concise (2-4 sentences) unless writing a full analysis report.
6. When analysis results contain residue lists, mention the key residues by name and number.

# Analysis guidance

- For interaction analysis, chain1 and chain2 can be the same chain (intra-chain analysis).
- For binding pocket analysis, pass ligandCompId and radius (default 5.0).
- For hbonds on a single-chain structure with a ligand, pass ligandCompId to filter to the ligand vicinity.
- Available recipes: hbonds, salt_bridges, hydrophobic_contacts, all_interactions, binding_pocket, druggability, ligand_interactions, disulfide_bonds, metal_coordination, aromatic_stacking, water_bridges, sasa, ramachandran, bfactor_stats, secondary_structure_simple, interface_residues, detect_pockets, oligomer_analysis, surface_residues, rmsd, conformational_changes, protonation_states, summary, electrostatic, virtual_screening, druglike_screening.
- Recipe aliases (automatically normalized): interface/interactions→all_interactions, hbond/hydrogen_bonds→hbonds, salt_bridge→salt_bridges, hydrophobic→hydrophobic_contacts, pocket→binding_pocket, drug/druggable→druggability, ligand→ligand_interactions, disulfide→disulfide_bonds, metal→metal_coordination, aromatic/stacking→aromatic_stacking, water→water_bridges, surface_area→sasa, rama→ramachandran, bfactor/b_factor→bfactor_stats, secondary_structure→secondary_structure_simple, pockets→detect_pockets, oligomer→oligomer_analysis, surface→surface_residues, protonation→protonation_states, conformation→conformational_changes.
- For chain-chain interface analysis, use recipe="all_interactions" (NOT "interface" — it will be normalized but prefer the canonical name).

# Color themes
Valid themes: chain-id, element-symbol, residue-name, sequence-id, hydrophobicity, uniform, occupancy, uncertainty, bfactor, entity-id, model-index, structure-index, polymer-index.

# Language

Always respond in Chinese unless the user writes in English. Tool names and parameters stay in English.

# Screenshot + VLM workflow (IMPORTANT)

After a successful pdb_analyze for any visualizable recipe (hbonds, salt_bridges, hydrophobic_contacts, all_interactions, binding_pocket, ligand_interactions, sasa, etc.), ALWAYS call capture_multi_angle next:
1. Pass the same recipe name
2. Pass the interactions array from the analyze result (the system auto-injects it if you don't)
3. Pass labels for residue annotation (auto-injected from analyze result)
4. Use angles ["front", "side", "top"] (default)

The capture_multi_angle tool will:
- Show side chains as ball-and-stick (from interactions data)
- Draw hydrogen bond lines as dashed lines (from interactions data)
- Add residue labels (one-letter code + number, e.g. C145)
- Run VLM analysis on the screenshots to verify quality

If the VLM reports quality issues (degraded/unacceptable), you will see feedback in the tool result. In that case, call recapture_screenshot with:
- The same recipe name
- Different angles (try the VLM-suggested angles, or use ["back", "side"])
- Any focus/zoom hints from the VLM

# Screenshot quality in final answer

When writing your final answer, if VLM reported screenshot quality issues (degraded/unacceptable) and the recapture limit was reached, you MUST:
1. Acknowledge the screenshot quality issue to the user
2. Explain what was expected (e.g. "侧链应以ball-and-stick方式显示，氢键应以虚线显示")
3. Suggest the user manually rotate the view and request a new screenshot

Example: "注意：截图质量评估为'一般'，部分侧链可能未完全显示。如需更清晰的截图，请手动调整视角后重新请求。"

# Important

- Do NOT ask the user to confirm every action - just call the tools. The UI handles approval for destructive operations (clear_chat, export_snapshot).
- When you have enough information to answer, respond with text ONLY (no tool calls) - this ends the loop.`;

interface AgentMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
}

interface ToolResult {
  callId: string;
  name: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface AgentRequestBody {
  messages: AgentMessage[];
  toolResults?: ToolResult[];
  provider?: string;
  sessionId?: string;
}

export async function POST(request: NextRequest) {
  try {
    let body: AgentRequestBody;
    try {
      body = (await request.json()) as AgentRequestBody;
    } catch (parseErr: any) {
      return NextResponse.json(
        { error: `Invalid JSON body: ${parseErr?.message || 'parse failed'}` },
        { status: 400 },
      );
    }
    const { messages, toolResults, provider, sessionId } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'messages array is required' },
        { status: 400 },
      );
    }

    const llmMessages: AgentMessage[] = [...messages];
    if (toolResults && toolResults.length > 0) {
      for (const tr of toolResults) {
        llmMessages.push({
          role: 'tool',
          tool_call_id: tr.callId,
          name: tr.name,
          content: JSON.stringify(
            tr.ok
              ? { ok: true, result: tr.result }
              : { ok: false, error: tr.error || 'Tool execution failed' },
          ).slice(0, 4000),
        });
      }
    }

    // Round 102: Use z.ai SDK for tool calling (the only provider that
    // natively supports OpenAI-style function calling). When the user
    // selected a CLI provider (hermes/codex/codebuddy), we still use z.ai
    // SDK internally and surface a clear `note` so the UI can explain why.
    // Future: implement prompt-based tool calling for CLI providers too.
    const requestedProvider = provider || 'auto';
    const isCliProvider = requestedProvider.startsWith('cli:');
    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    let zai: any;
    try {
      zai = await ZAI.create();
    } catch (configErr: any) {
      // Common cause: .z-ai-config missing or has placeholder apiKey.
      // Give a clear actionable error.
      const msg = String(configErr?.message || configErr || '');
      const isConfigError = msg.includes('Configuration file') || msg.includes('.z-ai-config');
      const isAuthError = msg.includes('401') || msg.includes('令牌') || msg.includes('verify');
      let userMsg = msg;
      if (isConfigError) {
        userMsg = `z.ai SDK 找不到 .z-ai-config 配置文件。\n\n解决方法:\n1. 在项目根目录创建 .z-ai-config 文件(JSON 格式): {\n   "baseUrl": "https://open.bigmodel.cn/api/paas/v4",\n   "apiKey": "<你的 zhipuai API key>"\n}\n2. 或者在用户主目录 ~/.z-ai-config 写同样内容\n3. 在 https://open.bigmodel.cn/usercenter/apikeys 申请 API key\n\n原始错误: ${msg}`;
      } else if (isAuthError) {
        userMsg = `z.ai SDK 鉴权失败 (401 令牌已过期或验证不正确)。\n\n解决方法:\n1. 在 .z-ai-config 中替换 apiKey 为有效的 zhipuai API key\n2. 在 https://open.bigmodel.cn/usercenter/apikeys 重新生成\n\n原始错误: ${msg}`;
      }
      return NextResponse.json(
        { error: userMsg, retryable: false, configError: isConfigError, authError: isAuthError },
        { status: isAuthError ? 401 : isConfigError ? 503 : 500 },
      );
    }
    // If the user explicitly selected a CLI provider, prepend a note to the
    // system prompt so the LLM knows why a different backend is being used.
    const providerNote = isCliProvider
      ? `\n\n> Note: The user selected ${requestedProvider} for chat, but this\n> agent-mode request uses the z.ai SDK (the only provider with native\n> OpenAI-style tool/function calling). Tool execution still runs locally\n> in the browser via Molstar.\n`
      : '';
    const systemPromptWithNote = AGENT_SYSTEM_PROMPT + providerNote;

    const MAX_RETRIES = 2;
    const BASE_DELAY = 5_000;
    let lastError: string | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const resp = await zai.chat.completions.create({
          model: 'glm-4.6',
          messages: [
            { role: 'system', content: systemPromptWithNote },
            ...llmMessages,
          ] as any,
          tools: AGENT_TOOLS as any,
          tool_choice: 'auto',
          thinking: { type: 'disabled' as const },
        });

        const choice = resp.choices?.[0];
        if (!choice) {
          return NextResponse.json(
            { error: 'No response from LLM' },
            { status: 502 },
          );
        }

        const msg = choice.message;
        const content = msg.content || '';
        const toolCalls = msg.tool_calls?.map((tc: any) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: safeParseArgs(tc.function.arguments),
        })) || [];

        const done = toolCalls.length === 0;

        return NextResponse.json({
          done,
          content,
          toolCalls: done ? undefined : toolCalls,
          provider: 'zai',
          requestedProvider,
          model: 'glm-4.6',
          round: Math.floor(llmMessages.length / 2),
          finishReason: choice.finish_reason,
        });
      } catch (err: any) {
        lastError = err?.message || String(err);
        const is429 = lastError.includes('429') || lastError.includes('Too many');
        const isTimeout = lastError.includes('timeout') || lastError.includes('deadline');
        const isAuthErr = lastError.includes('401') || lastError.includes('令牌');
        if ((is429 || isTimeout) && attempt < MAX_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, BASE_DELAY * Math.pow(2, attempt)));
          continue;
        }
        return NextResponse.json(
          {
            error: isAuthErr ? `z.ai SDK 鉴权失败 (401)。请在 .z-ai-config 中设置有效的 zhipuai API key。\n\n原始错误: ${lastError}` : lastError,
            retryable: is429 || isTimeout,
            authError: isAuthErr,
          },
          { status: isAuthErr ? 401 : is429 ? 429 : 500 },
        );
      }
    }

    return NextResponse.json(
      { error: lastError || 'Agent round failed after retries' },
      { status: 502 },
    );
  } catch (error: any) {
    console.error('[api/llm/agent/round] Error:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 },
    );
  }
}

function safeParseArgs(argsStr: string): Record<string, unknown> {
  try {
    return JSON.parse(argsStr);
  } catch {
    const result: Record<string, unknown> = {};
    const matches = argsStr.matchAll(/"(\w+)"\s*:\s*("(?:[^"\\]|\\.)*"|\d+\.?\d*|true|false|null)/g);
    for (const m of matches) {
      const key = m[1];
      let val: unknown = m[2];
      if (typeof val === 'string') {
        if (val.startsWith('"')) {
          try { val = JSON.parse(val); } catch { /* keep raw */ }
        } else if (/^-?\d/.test(val)) val = Number(val);
        else if (val === 'true') val = true;
        else if (val === 'false') val = false;
      }
      result[key] = val;
    }
    return result;
  }
}


/**
 * Round 102: Parse `` blocks out of an LLM response and return the
 * remaining text + a list of {name, arguments} pairs. Used by the
 * prompt-based tool calling path that works with any provider.
 */