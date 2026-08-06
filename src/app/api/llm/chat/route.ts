/**
 * POST /api/llm/chat
 *
 * Chat endpoint for the Structure Analysis agent. Receives the conversation
 * history + context (loaded structures), calls the LLM via the run-center
 * provider system (src/lib/llm.ts), and returns a structured response.
 *
 * The LLM is prompted to return JSON with:
 *   { reply: string, commands?: LlmCommand[], captureSnapshot?: boolean,
 *     continueAfterAnalysis?: boolean }
 *
 * The client executes the commands (via executeCommand on the Molstar viewer),
 * feeds the results back in the next round, and loops until the agent stops
 * requesting continuation (ReAct pattern, up to MAX_ROUNDS rounds).
 *
 * Provider selection: the client sends `provider` in the body. Empty/unset =
 * auto (use the run center's chosen provider). The provider id is shared with
 * the run center via the same localStorage key (pdb-tracker:llm-provider:v2).
 */
import { NextRequest, NextResponse } from 'next/server';
import { generateText, resolveLlmConfig, type LlmConfig } from '@/lib/llm';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatContext {
  loadedStructures?: Array<{ id: string; label: string }>;
  analysisResults?: Array<{ type: string; ok: boolean; detail?: string; data?: unknown }>;
}

interface ChatRequestBody {
  messages: ChatMessage[];
  context?: ChatContext;
  provider?: string;
}

const SYSTEM_PROMPT = `You are Molcraft AI, a structural biology assistant integrated into a PDB structure analysis web app.

You can help users analyze protein structures by:
- Loading structures (PDB ID, AlphaFold, EMDB, or uploaded files)
- Running analyses (Ramachandran, B-factor, SASA, interactions, etc.)
- Measuring distances/angles/dihedrals
- Changing visualizations (representations, color themes)
- Generating reports

When the user asks for an analysis or action, respond with a JSON object (NO markdown fences, just raw JSON):
{
  "reply": "Your explanation to the user (markdown allowed)",
  "commands": [ { "type": "load_pdb", "id": "1CBS" } ],
  "captureSnapshot": false,
  "continueAfterAnalysis": false
}

Available command types (use these exact type strings):
- load_pdb: { type: "load_pdb", id: "1CBS" }
- load_alphafold: { type: "load_alphafold", uniprotId: "P00520" }
- focus_residue: { type: "focus_residue", chain: "A", resno: 145 }
- focus_chain: { type: "focus_chain", chain: "A" }
- focus_ligand: { type: "focus_ligand", compId: "ATP" }
- reset_camera: { type: "reset_camera" }
- set_representation: { type: "set_representation", preset: "polymer-and-ligand", structures: "all" }
- set_color_theme: { type: "set_color_theme", theme: "chain", structures: "all" }
- set_uniform_color: { type: "set_uniform_color", color: "#c96442", structures: "all" }
- measure_distance: { type: "measure_distance", a: {chain,resno,atom}, b: {chain,resno,atom} }
- analyze_metadata: { type: "analyze_metadata", pdbId: "1CBS" }
- analyze_interface: { type: "analyze_interface", pdbId: "1CBS", assembly: 1 }
- analyze_run: { type: "analyze_run", pdbId: "1CBS", recipe: "hbonds|salt_bridges|hydrophobic_contacts|all_interactions", params: {chain1:"A",chain2:"B"} }
- clear_measurements: { type: "clear_measurements" }
- clear_interactions: { type: "clear_interactions" }
- clear_selection: { type: "clear_selection" }

Rules:
1. Always include a "reply" field with a helpful explanation.
2. Include "commands" only if the user's request requires an action. For pure questions, omit it.
3. Set "continueAfterAnalysis": true ONLY if you need the analysis results to continue (the client will run the commands and send results back). For one-shot answers, set false or omit.
4. Keep replies concise (2-4 sentences). Use markdown for structure (lists, bold).
5. For complex analyses, break them into steps and use continueAfterAnalysis to loop.

If the user's request doesn't require commands, just return { "reply": "..." }.

Available analysis recipes: ramachandran, bfactor, sasa, secondary_structure, hbonds, salt_bridges, hydrophobic_contacts, all_interactions, interface_residues, disulfide_bonds, aromatic_stacking, water_bridges, metal_coordination.

Example:
User: "Load 1CBS and analyze its hydrogen bonds"
Assistant: { "reply": "Loading 1CBS and running hydrogen bond analysis on chain A.", "commands": [ {"type":"load_pdb","id":"1CBS"}, {"type":"analyze_run","pdbId":"1CBS","recipe":"hbonds","params":{"chain1":"A","chain2":"A","distanceCutoff":3.5}} ], "continueAfterAnalysis": true }`;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ChatRequestBody;
    const { messages, context, provider } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'messages array is required and must be non-empty' },
        { status: 400 }
      );
    }

    // Build the user prompt: the latest user message + context summary.
    // The full conversation history is passed as the `messages` array to
    // generateText via a concatenated transcript (generateText takes a single
    // userPrompt string, so we serialize the history).
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    const userPrompt = buildUserPrompt(messages, context);

    // Resolve the LLM config with the provider override.
    const cfg: LlmConfig = {
      provider: provider || undefined,
      system: SYSTEM_PROMPT,
    };

    // Call the LLM via the run-center provider system.
    const r = await generateText(SYSTEM_PROMPT, userPrompt, {
      maxChars: 8000,
      llm: cfg,
    });

    if (!r.ok) {
      return NextResponse.json(
        {
          error: 'LLM call failed',
          details: r.error || 'Unknown error',
          provider: r.provider,
        },
        { status: 502 }
      );
    }

    // Try to parse the response as JSON (the LLM should return JSON per the
    // system prompt). If parsing fails, wrap the raw text as a plain reply.
    let parsed: { reply?: string; commands?: unknown[]; captureSnapshot?: boolean; continueAfterAnalysis?: boolean };
    const raw = r.text.trim();
    try {
      // Strip markdown code fences if present
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { reply: raw };
    }

    return NextResponse.json({
      reply: parsed.reply || raw,
      commands: Array.isArray(parsed.commands) ? parsed.commands : [],
      captureSnapshot: !!parsed.captureSnapshot,
      continueAfterAnalysis: !!parsed.continueAfterAnalysis,
      provider: r.provider,
      model: r.model,
    });
  } catch (error: any) {
    console.error('[/api/llm/chat] error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message || String(error) },
      { status: 500 }
    );
  }
}

/** Build a single user-prompt string from the conversation history + context. */
function buildUserPrompt(messages: ChatMessage[], context?: ChatContext): string {
  const parts: string[] = [];

  // Context: loaded structures
  if (context?.loadedStructures && context.loadedStructures.length > 0) {
    parts.push(
      `[Context] Currently loaded structures: ${context.loadedStructures
        .map((s) => `${s.id} (${s.label})`)
        .join(', ')}`
    );
  } else {
    parts.push('[Context] No structures currently loaded.');
  }

  // Context: analysis results from previous round (ReAct feedback)
  if (context?.analysisResults && context.analysisResults.length > 0) {
    parts.push(`[Analysis results from previous commands]`);
    for (const r of context.analysisResults) {
      const dataStr = r.data ? JSON.stringify(r.data).slice(0, 2000) : '';
      parts.push(
        `  ${r.type}: ${r.ok ? 'OK' : 'FAILED'}${r.detail ? ` — ${r.detail}` : ''}${
          dataStr ? `\n  data: ${dataStr}` : ''
        }`
      );
    }
  }

  // Conversation history (last 10 messages to stay within token limits)
  const recent = messages.slice(-10);
  parts.push(`[Conversation history]`);
  for (const m of recent) {
    parts.push(`${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`);
  }

  parts.push(
    `\nRespond with JSON per the system prompt. If the user's request requires loading a structure or running an analysis, include the appropriate commands and set continueAfterAnalysis if you need the results.`
  );

  return parts.join('\n');
}
