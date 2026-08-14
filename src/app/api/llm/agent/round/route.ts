/**
 * POST /api/llm/agent/round
 *
 * Agent loop LLM round — a single step of the tool-calling agent loop.
 *
 * Unlike /api/llm/chat/stream (which uses JSON-parsing of a {reply, commands}
 * payload), this route uses native function-calling via the z.ai SDK's `tools`
 * parameter. The LLM responds with either:
 *   - A text message (final answer) -> { done: true, content }
 *   - One or more tool_calls -> { done: false, content, toolCalls }
 *
 * The CLIENT orchestrates the loop:
 *   1. POST /api/llm/agent/round with the user message + history
 *   2. If response has toolCalls -> execute them client-side (Molstar) ->
 *      POST /api/llm/agent/round again with toolResults attached
 *   3. Repeat until { done: true }
 *
 * This keeps the server stateless (no SSE session) and lets tools run where
 * the Molstar viewer lives (browser).
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Tool definitions passed to the LLM. These match the domain-tools.ts
 * registrations. We define them inline here (server-side) so the route
 * doesn't need to import the client-side tool registry.
 */
const AGENT_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'pdb_load',
      description: 'Load a PDB structure by ID (e.g. 4HHB, 6LU7, 1CBS). Downloads from RCSB.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '4-character PDB ID (e.g. 4HHB)' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'pdb_analyze',
      description: 'Run a structure analysis recipe. Returns detailed interaction/pocket data.',
      parameters: {
        type: 'object',
        properties: {
          recipe: {
            type: 'string',
            description: 'Analysis recipe name',
            enum: [
              'hbonds', 'salt_bridges', 'hydrophobic_contacts', 'all_interactions',
              'binding_pocket', 'druggability', 'ligand_interactions',
              'disulfide_bonds', 'metal_coordination', 'aromatic_stacking', 'water_bridges',
              'sasa', 'ramachandran', 'bfactor_stats', 'secondary_structure_simple',
              'interface_residues', 'detect_pockets', 'oligomer_analysis',
              'surface_residues', 'rmsd', 'conformational_changes', 'protonation_states', 'summary',
            ],
          },
          chain1: { type: 'string', description: 'Chain 1 ID (e.g. A)' },
          chain2: { type: 'string', description: 'Chain 2 ID (e.g. B, or same as chain1 for intra-chain)' },
          ligandCompId: { type: 'string', description: 'Ligand compId for pocket analysis (e.g. N3, HEM)' },
          radius: { type: 'number', description: 'Pocket radius in Angstroms (default 5.0)' },
        },
        required: ['recipe', 'chain1', 'chain2'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'set_representation',
      description: 'Set the 3D representation preset.',
      parameters: {
        type: 'object',
        properties: {
          preset: {
            type: 'string',
            enum: ['cartoon', 'surface', 'ball-and-stick', 'putty'],
            description: 'Representation preset',
          },
        },
        required: ['preset'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'set_color_theme',
      description: 'Set the color theme for the structure.',
      parameters: {
        type: 'object',
        properties: {
          theme: {
            type: 'string',
            enum: ['chain-id', 'element-symbol', 'residue-name', 'sequence-id', 'hydrophobicity', 'uniform', 'occupancy'],
            description: 'Color theme name',
          },
        },
        required: ['theme'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'focus_ligand',
      description: 'Focus the camera on a specific ligand.',
      parameters: {
        type: 'object',
        properties: {
          compId: { type: 'string', description: 'Ligand component ID (e.g. ATP, N3)' },
        },
        required: ['compId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'focus_residue',
      description: 'Focus the camera on a specific residue.',
      parameters: {
        type: 'object',
        properties: {
          chain: { type: 'string', description: 'Chain ID' },
          resno: { type: 'number', description: 'Residue number' },
        },
        required: ['chain', 'resno'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'capture_multi_angle',
      description: 'Capture screenshots of the current view from multiple angles. Returns image data URIs.',
      parameters: {
        type: 'object',
        properties: {
          angles: {
            type: 'array',
            items: { type: 'string', enum: ['front', 'side', 'top', 'back'] },
            description: 'Angles to capture (default: front, side, top)',
          },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'measure_distance',
      description: 'Measure the distance between two atoms.',
      parameters: {
        type: 'object',
        properties: {
          a_chain: { type: 'string' },
          a_resno: { type: 'number' },
          a_atom: { type: 'string', description: 'Atom name (e.g. CA, CB). Default CA.' },
          b_chain: { type: 'string' },
          b_resno: { type: 'number' },
          b_atom: { type: 'string', description: 'Atom name. Default CA.' },
        },
        required: ['a_chain', 'a_resno', 'b_chain', 'b_resno'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'clear_chat',
      description: 'Clear all chat messages. Requires user approval.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

const AGENT_SYSTEM_PROMPT = `You are Molcraft AI, a structural biology assistant with tool-calling capabilities.

You help users analyze protein structures by calling tools:
- pdb_load: Load a PDB structure by ID
- pdb_analyze: Run an analysis recipe (hbonds, salt_bridges, binding_pocket, all_interactions, etc.)
- set_representation: Change the 3D view (cartoon, surface, ball-and-stick, putty)
- set_color_theme: Change colors (chain-id, element-symbol, hydrophobicity, etc.)
- focus_ligand / focus_residue: Move camera to focus on a ligand or residue
- capture_multi_angle: Take screenshots from multiple angles
- measure_distance: Measure distance between two atoms
- clear_chat: Clear the conversation (requires approval)

# How to work

1. When the user asks to load or analyze a structure, call the appropriate tools.
2. After tools return results, read them carefully and explain the findings to the user in Chinese.
3. For multi-step requests (e.g. "load X then analyze Y then focus Z"), call all independent tools in parallel, then wait for results.
4. Keep your text explanations concise (2-4 sentences) unless writing a full analysis report.
5. When analysis results contain residue lists, mention the key residues by name and number.

# Analysis guidance

- For interaction analysis, chain1 and chain2 can be the same chain (intra-chain analysis).
- For binding pocket analysis, pass ligandCompId and radius (default 5.0).
- Available recipes: hbonds, salt_bridges, hydrophobic_contacts, all_interactions, binding_pocket, druggability, ligand_interactions, disulfide_bonds, metal_coordination, aromatic_stacking, water_bridges, sasa, ramachandran, bfactor_stats, secondary_structure_simple, interface_residues, detect_pockets, oligomer_analysis, surface_residues, rmsd, conformational_changes, protonation_states, summary.

# Language

Always respond in Chinese unless the user writes in English. Tool names and parameters stay in English.

# Important

- Do NOT ask the user to confirm every action - just call the tools. The UI handles approval for destructive operations (like clear_chat).
- After calling pdb_load, wait for the result before calling pdb_analyze (the structure must be loaded first).
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
        { status: 400 }
      );
    }

    // Build the message array for the LLM.
    // If toolResults are provided, append them as "tool" role messages.
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
              : { ok: false, error: tr.error || 'Tool execution failed' }
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
            { status: 502 }
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
          { status: is429 ? 429 : 500 }
        );
      }
    }

    return NextResponse.json(
      { error: lastError || 'Agent round failed after retries' },
      { status: 502 }
    );
  } catch (error: any) {
    console.error('[api/llm/agent/round] Error:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/** Safely parse tool call arguments (the LLM sends them as a JSON string). */
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
