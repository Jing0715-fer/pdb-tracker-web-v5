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
    const body = (await request.json()) as AgentRequestBody;
    const { messages, toolResults, provider } = body;

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

    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    const zai = await ZAI.create();

    const MAX_RETRIES = 2;
    const BASE_DELAY = 5_000;
    let lastError: string | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const resp = await zai.chat.completions.create({
          model: 'glm-4.6',
          messages: [
            { role: 'system', content: AGENT_SYSTEM_PROMPT },
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
          provider: provider || 'zai',
          model: 'glm-4.6',
          round: Math.floor(llmMessages.length / 2),
          finishReason: choice.finish_reason,
        });
      } catch (err: any) {
        lastError = err?.message || String(err);
        const is429 = lastError.includes('429') || lastError.includes('Too many');
        const isTimeout = lastError.includes('timeout') || lastError.includes('deadline');
        if ((is429 || isTimeout) && attempt < MAX_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, BASE_DELAY * Math.pow(2, attempt)));
          continue;
        }
        return NextResponse.json(
          {
            error: lastError,
            retryable: is429 || isTimeout,
          },
          { status: is429 ? 429 : 500 },
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
