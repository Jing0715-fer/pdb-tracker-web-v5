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
import { checkLlmRateLimit, getClientKey, rateLimitResponse } from '@/lib/llm-rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** API-05: max analysis results folded into the prompt (each carries up to
 *  2000 chars of JSON — the count was previously uncapped). */
const MAX_ANALYSIS_RESULTS = 20;
/** API-05: cap per history message (m.content was previously uncapped). */
const MAX_MESSAGE_CHARS = 50_000;
/** API-05: cap on the total assembled user prompt (~200k chars keeps us well
 *  under CLI argv limits and bounds token spend). */
const MAX_PROMPT_CHARS = 200_000;

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
  /** Round 62: Session id for cross-turn session reuse. */
  sessionId?: string;
}

const SYSTEM_PROMPT = `You are Molcraft AI, a structural biology assistant integrated into a PDB structure analysis web app.

You can help users analyze protein structures by:
- Loading structures (PDB ID, AlphaFold, EMDB, or uploaded files)
- Running analyses (Ramachandran, B-factor, SASA, interactions, etc.)
- Measuring distances/angles/dihedrals
- Changing visualizations (representations, color themes)
- Generating reports

CRITICAL: You MUST respond with a JSON object using EXACTLY this format (NO markdown fences, NO "actions" array — use "commands"):
{
  "reply": "Your explanation to the user (markdown allowed)",
  "commands": [ { "type": "load_pdb", "id": "1CBS" } ],
  "captureSnapshot": false,
  "continueAfterAnalysis": false
}

The "commands" field MUST be an array of command objects with these EXACT type strings (do NOT use "load", "selection", "analysis", "camera-focus" — use the exact types below):

- load_pdb: { "type": "load_pdb", "id": "1CBS" }
- load_alphafold: { "type": "load_alphafold", "uniprotId": "P00520" }
- focus_residue: { "type": "focus_residue", "chain": "A", "resno": 145 }
- focus_chain: { "type": "focus_chain", "chain": "A" }
- focus_ligand: { "type": "focus_ligand", "compId": "ATP" }
- reset_camera: { "type": "reset_camera" }
- set_representation: { "type": "set_representation", "preset": "polymer-and-ligand", "structures": "all" }
- set_color_theme: { "type": "set_color_theme", "theme": "chain", "structures": "all" }
- set_uniform_color: { "type": "set_uniform_color", "color": "#c96442", "structures": "all" }
- analyze_metadata: { "type": "analyze_metadata", "pdbId": "1CBS" }
- analyze_interface: { "type": "analyze_interface", "pdbId": "1CBS", "assembly": 1 }
- analyze_run: { "type": "analyze_run", "pdbId": "1CBS", "recipe": "hbonds|salt_bridges|hydrophobic_contacts|all_interactions", "params": {"chain1":"A","chain2":"B"} }
- clear_measurements: { "type": "clear_measurements" }
- clear_interactions: { "type": "clear_interactions" }
- clear_selection: { "type": "clear_selection" }

Rules:
1. Always include a "reply" field with a helpful explanation.
2. Include "commands" only if the user's request requires an action. For pure questions, omit it or use empty array [].
3. Set "continueAfterAnalysis": true ONLY if you need the analysis results to continue.
4. Keep replies concise (2-4 sentences). Use markdown for structure.
5. For complex analyses, break them into steps and use continueAfterAnalysis to loop.
6. NEVER use "actions", "selection", "analysis", "camera-focus" or any non-standard types. ALWAYS use the exact command types listed above.

Chain selection guidance:
- For interaction analysis, chain1 and chain2 can be the SAME chain for intra-chain analysis. All recipes support intra-chain mode (auto-enabled when chain1==chain2).
- If the structure has only one chain, use chain1=chain2="A".
- If the structure has multiple chains and the user wants interface analysis, use chain1="A", chain2="B".
- To analyze protein-ligand interactions, use the chain containing the protein (e.g. "A") for both chain1 and chain2 — the recipes detect ligand contacts automatically.

Available analysis recipes: ramachandran, bfactor, sasa, secondary_structure, hbonds, salt_bridges, hydrophobic_contacts, all_interactions, interface_residues, disulfide_bonds, aromatic_stacking, water_bridges, metal_coordination.

Example 1:
User: "Load 1CBS and analyze its hydrogen bonds"
Assistant: { "reply": "Loading 1CBS and running hydrogen bond analysis on chain A.", "commands": [ {"type":"load_pdb","id":"1CBS"}, {"type":"analyze_run","pdbId":"1CBS","recipe":"all_interactions","params":{"chain1":"A","chain2":"A"}} ], "continueAfterAnalysis": true }

Example 2:
User: "Load 6LU7 and analyze the ligand binding pocket"
Assistant: { "reply": "Loading 6LU7 and analyzing the ligand binding pocket.", "commands": [ {"type":"load_pdb","id":"6LU7"}, {"type":"analyze_run","pdbId":"6LU7","recipe":"hbonds","params":{"chain1":"A","chain2":"A"}}, {"type":"analyze_run","pdbId":"6LU7","recipe":"salt_bridges","params":{"chain1":"A","chain2":"A"}}, {"type":"focus_ligand","compId":"ligand"} ], "continueAfterAnalysis": true }`;

export async function POST(request: NextRequest) {
  // API-05: 10 req/min sliding-window rate limit (same pattern as the VLM
  // route, R165/VLM-006). No auth in this sandbox app — this is the only
  // guard against a caller draining the LLM quota.
  const rate = checkLlmRateLimit('llm-chat', getClientKey(request));
  if (!rate.allowed) {
    return rateLimitResponse('llm-chat', rate.retryAfterSec);
  }

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

    // Round 62: Derive stable session id for chat reuse.
    const firstUserMsg2 = messages.find((m) => m.role === 'user');
    const chatSessionId = body.sessionId
      ? `chat-${body.sessionId}`
      : firstUserMsg2
        ? `chat-${(firstUserMsg2.content || '').slice(0, 200).split('').reduce((h, c) => ((h * 31 + c.charCodeAt(0)) | 0) >>> 0, 0).toString(16)}`
        : `chat-oneshot-${Date.now()}`;

    // Resolve the LLM config with the provider override.
    const cfg: LlmConfig = {
      provider: provider || undefined,
      system: SYSTEM_PROMPT,
      sessionId: chatSessionId,
    };

    // Call the LLM via the run-center provider system. API-05: forward the
    // request signal so a client disconnect aborts the underlying CLI/SDK
    // call instead of running it to completion for a dead connection.
    const r = await generateText(SYSTEM_PROMPT, userPrompt, {
      maxChars: 8000,
      llm: cfg,
      signal: request.signal,
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
    let parsed: { reply?: string; commands?: unknown[]; actions?: unknown[]; captureSnapshot?: boolean; continueAfterAnalysis?: boolean };
    const raw = r.text.trim();
    try {
      // Strip markdown code fences if present
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { reply: raw };
    }

    // Fallback: if the LLM returned "actions" instead of "commands" (a common
    // hallucination), convert the actions array to the expected commands format.
    let commands: unknown[] = [];
    if (Array.isArray(parsed.commands)) {
      commands = parsed.commands;
    } else if (Array.isArray(parsed.actions)) {
      commands = convertActionsToCommands(parsed.actions);
    }

    return NextResponse.json({
      reply: parsed.reply || raw,
      commands,
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

/**
 * Fallback converter: if the LLM returns an "actions" array (with types like
 * "load", "selection", "analysis", "camera-focus") instead of the expected
 * "commands" array, convert each action to the standard command format.
 * This handles common LLM hallucinations where it invents its own schema.
 */
function convertActionsToCommands(actions: unknown[]): unknown[] {
  const commands: unknown[] = [];
  for (const action of actions) {
    const a = action as Record<string, unknown>;
    const type = String(a.type || '').toLowerCase();
    if (type === 'load') {
      commands.push({ type: 'load_pdb', id: String(a.pdbId || a.id || '') });
    } else if (type === 'focus' || type === 'camera-focus') {
      if (a.selector === 'ligand' || a.compId) {
        commands.push({ type: 'focus_ligand', compId: String(a.compId || 'ligand') });
      } else if (a.chain) {
        commands.push({ type: 'focus_chain', chain: String(a.chain) });
      } else if (a.resno) {
        commands.push({ type: 'focus_residue', chain: String(a.chain || 'A'), resno: Number(a.resno) });
      }
    } else if (type === 'analysis' || type === 'analyze') {
      const name = String(a.name || a.recipe || '');
      const recipeMap: Record<string, string> = {
        'hydrogen-bonds': 'hbonds', 'hbonds': 'hbonds', 'h-bonds': 'hbonds',
        'salt-bridges': 'salt_bridges', 'salt_bridges': 'salt_bridges',
        'hydrophobic': 'hydrophobic_contacts', 'hydrophobic-contacts': 'hydrophobic_contacts',
        'all-interactions': 'all_interactions', 'all_interactions': 'all_interactions',
      };
      const recipe = recipeMap[name.toLowerCase()] || name;
      const pdbId = String(a.pdbId || '');
      commands.push({ type: 'analyze_run', pdbId, recipe, params: { chain1: 'A', chain2: 'A' } });
    } else if (type === 'reset' || type === 'reset-camera') {
      commands.push({ type: 'reset_camera' });
    } else if (type === 'clear') {
      commands.push({ type: 'clear_measurements' });
    }
  }
  return commands;
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

  // Context: analysis results from previous round (ReAct feedback).
  // API-05: cap the count (last 20) — analysisResults is client-controlled
  // and each entry can carry ~2KB of JSON, so an uncapped array could
  // assemble a multi-MB prompt.
  if (context?.analysisResults && context.analysisResults.length > 0) {
    const recentResults = context.analysisResults.slice(-MAX_ANALYSIS_RESULTS);
    const note = context.analysisResults.length > recentResults.length
      ? ` (showing last ${recentResults.length} of ${context.analysisResults.length})`
      : '';
    parts.push(`[Analysis results from previous commands]${note}`);
    for (const r of recentResults) {
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
    // API-05: cap each message's content — m.content was previously uncapped.
    const content = (m.content || '').length > MAX_MESSAGE_CHARS
      ? `${(m.content || '').slice(0, MAX_MESSAGE_CHARS)} …[truncated]`
      : (m.content || '');
    parts.push(`${m.role === 'user' ? 'User' : 'Assistant'}: ${content}`);
  }

  parts.push(
    `\nRespond with JSON per the system prompt. If the user's request requires loading a structure or running an analysis, include the appropriate commands and set continueAfterAnalysis if you need the results.`
  );

  // API-05: final hard cap on the assembled prompt.
  const prompt = parts.join('\n');
  if (prompt.length > MAX_PROMPT_CHARS) {
    return `${prompt.slice(0, MAX_PROMPT_CHARS)}\n…[prompt truncated to ${MAX_PROMPT_CHARS} chars to stay within size limits]`;
  }
  return prompt;
}
