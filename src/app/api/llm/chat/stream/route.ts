/**
 * POST /api/llm/chat/stream
 *
 * Streaming version of /api/llm/chat. Returns Server-Sent Events (SSE) so the
 * chat client can display the reply incrementally (typewriter effect).
 *
 * Since src/lib/llm.ts uses CLI providers with --no-stream (no native streaming),
 * we simulate streaming by:
 *   1. Calling generateText to get the full response
 *   2. Parsing the JSON { reply, commands, ... } (using a robust parser ported
 *      from Molcraft that handles code fences, unescaped quotes, trailing
 *      commas, missing braces, and hallucinated field names like "summary"
 *      instead of "reply" or "actions"/"selectStructure" instead of "commands")
 *   3. Streaming the `reply` text in word-level chunks via SSE
 *   4. Sending the final { commands, continueAfterAnalysis, provider } as a
 *      separate "done" event
 *
 * SSE event format:
 *   data: {"type":"chunk","text":"word "}\n\n
 *   data: {"type":"chunk","text":"more "}\n\n
 *   ...
 *   data: {"type":"done","commands":[...],"continueAfterAnalysis":false,"provider":"zai"}\n\n
 *   data: {"type":"error","error":"..."}\n\n  (on error)
 */

import { NextRequest } from 'next/server';
import { generateText, type LlmConfig } from '@/lib/llm';

export const runtime = 'nodejs';
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are Molcraft AI, a structural biology assistant integrated into a PDB structure analysis web app.

You can help users analyze protein structures by:
- Loading structures (PDB ID, AlphaFold, EMDB, or uploaded files)
- Running analyses (Ramachandran, B-factor, SASA, interactions, etc.)
- Measuring distances/angles/dihedrals
- Changing visualizations (representations, color themes)
- Generating reports

# CRITICAL OUTPUT FORMAT (MUST FOLLOW EXACTLY)

You MUST respond with a SINGLE JSON object — NO markdown fences, NO prose before/after. The JSON MUST have EXACTLY these field names:

{
  "reply": "Your explanation to the user (markdown allowed). REQUIRED — do not omit, do not rename to 'summary'/'text'/'message'/'finalReport'.",
  "commands": [ ...command objects... ],
  "captureSnapshot": false,
  "continueAfterAnalysis": false
}

## FORBIDDEN — these field names are WRONG (the parser will reject them):
- ✗ "summary" → use "reply"
- ✗ "text" → use "reply"
- ✗ "message" → use "reply"
- ✗ "finalReport" → use "reply" (put the full report text in reply)
- ✗ "actions" → use "commands"
- ✗ "steps" → use "commands"
- ✗ "tasks" → use "commands"

## FORBIDDEN — these command type strings are WRONG:
- ✗ "selectStructure" → use "load_pdb" (with "id" field, not "pdbId")
- ✗ "load" → use "load_pdb"
- ✗ "showMessage" / "message" → DO NOT include; put the text in "reply" instead
- ✗ "camera-focus" / "focus" → use "focus_residue" / "focus_chain" / "focus_ligand"
- ✗ "analysis" / "analyze" → use "analyze_run" (with "recipe" field)
- ✗ "reset" / "reset-camera" → use "reset_camera"

## ALLOWED command types (use EXACTLY these strings):
- load_pdb: { "type": "load_pdb", "id": "1CBS" }   ← note: field is "id", NOT "pdbId"
- load_alphafold: { "type": "load_alphafold", "uniprotId": "P00520" }
- focus_residue: { "type": "focus_residue", "chain": "A", "resno": 145 }
- focus_chain: { "type": "focus_chain", "chain": "A" }
- focus_ligand: { "type": "focus_ligand", "compId": "ATP" }
- reset_camera: { "type": "reset_camera" }
- set_representation: { "type": "set_representation", "preset": "polymer-and-ligand", "structures": "all" }
- set_color_theme: { "type": "set_color_theme", "theme": "chain-id", "structures": "all" }
  Valid themes: "chain-id", "element-symbol", "residue-name", "sequence-id", "hydrophobicity", "uniform", "polymer-index", "occupancy", "model-index", "structure-index", "entity-id"
  (aliases like "chain", "element", "residue" are auto-accepted but prefer canonical names)
- set_uniform_color: { "type": "set_uniform_color", "color": "#c96442", "structures": "all" }
- measure_distance: { "type": "measure_distance", "a": {"chain":"A","resno":145,"atom":"CA"}, "b": {"chain":"A","resno":150,"atom":"CA"} }
- analyze_metadata: { "type": "analyze_metadata", "id": "1CBS" }   ← note: field is "id", NOT "pdbId"
- analyze_interface: { "type": "analyze_interface", "id": "1CBS", "assembly": 1 }
- analyze_run: { "type": "analyze_run", "pdbId": "1CBS", "recipe": "hbonds|salt_bridges|hydrophobic_contacts|all_interactions", "params": {"chain1":"A","chain2":"A"} }
- clear_measurements: { "type": "clear_measurements" }
- clear_interactions: { "type": "clear_interactions" }
- clear_selection: { "type": "clear_selection" }

Note: Analysis recipes have sensible built-in defaults (H-bonds 3.5 Å, salt bridges 4.0 Å, hydrophobic 4.5 Å). You do NOT need to specify cutoff params — just call analyze_run with the recipe name and chain params. For binding_pocket, use radius 5.0 (the default 8 is too broad).

Rules:
1. ALWAYS include a "reply" field (string) with a helpful explanation. NEVER omit it.
2. Include "commands" only if the user's request requires an action. For pure questions, use [].
3. Set "continueAfterAnalysis": true ONLY if you need the analysis results to continue.
4. Keep replies concise (2-4 sentences) unless writing a full report. Use markdown for structure.
5. DO NOT include "showMessage" or "selectStructure" commands — they are not supported.

Chain selection guidance:
- For interaction analysis, chain1 and chain2 can be the SAME chain for intra-chain analysis.
- Individual recipes now support intra-chain mode (auto-enabled when chain1==chain2).
- If the structure has only one chain, use chain1=chain2="A".
- If the structure has multiple chains and the user wants interface analysis, use chain1="A", chain2="B".

Available analysis recipes (for analyze_run): ramachandran, sasa, bfactor_stats, hbonds, salt_bridges, hydrophobic_contacts, all_interactions, interface_residues, disulfide_bonds, aromatic_stacking, water_bridges, metal_coordination, entity_analysis, binding_pocket, druggability, virtual_screening, ligand_interactions, detect_pockets, contact_map, oligomer_analysis, surface_residues, structure_validation, secondary_structure_simple, sequence_features, distances, rmsd, align_and_superpose, protonation_states, conformational_changes, druglike_screening.
Note: bfactor and secondary_structure are NOT valid recipe names. Use bfactor_stats for B-factor analysis, entity_analysis for entity info, and secondary_structure_simple for secondary structure assignment.

# EXAMPLES

User: "Load 1CBS and analyze its hydrogen bonds"
Correct response (EXACTLY this shape):
{ "reply": "Loading 1CBS and running hydrogen bond analysis on chain A.", "commands": [ {"type":"load_pdb","id":"1CBS"}, {"type":"analyze_run","pdbId":"1CBS","recipe":"hbonds","params":{"chain1":"A","chain2":"A"}} ], "continueAfterAnalysis": true }

User: "Load 6LU7 and analyze the ligand binding pocket — run hydrogen bonds and salt bridges between chain A and the ligand, then focus the camera on the ligand."
Correct response:
{ "reply": "Loading 6LU7 (SARS-CoV-2 Mpro) and analyzing the ligand binding pocket. I'll run hydrogen bond and salt bridge analysis between chain A and the bound ligand, then focus the camera on the ligand.", "commands": [ {"type":"load_pdb","id":"6LU7"}, {"type":"analyze_run","pdbId":"6LU7","recipe":"hbonds","params":{"chain1":"A","chain2":"A"}}, {"type":"analyze_run","pdbId":"6LU7","recipe":"salt_bridges","params":{"chain1":"A","chain2":"A"}}, {"type":"analyze_run","pdbId":"6LU7","recipe":"binding_pocket","params":{"ligandCompId":"N3","radius":8}}, {"type":"focus_ligand","compId":"N3"} ], "continueAfterAnalysis": true }

# ANTI-EXAMPLES (DO NOT DO THESE)

WRONG — using "selectStructure" and "showMessage":
{ "summary": "...", "commands": [ {"type":"selectStructure","pdbId":"6LU7"}, {"type":"showMessage","text":"..."} ] }
RIGHT — use "load_pdb" and put the message in "reply":
{ "reply": "...", "commands": [ {"type":"load_pdb","id":"6LU7"} ] }

WRONG — using "actions" instead of "commands":
{ "reply": "...", "actions": [ {"type":"load","pdbId":"6LU7"} ] }
RIGHT:
{ "reply": "...", "commands": [ {"type":"load_pdb","id":"6LU7"} ] }`;

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

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  try {
    const body = (await request.json()) as ChatRequestBody;
    const { messages, context, provider } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        `data: ${JSON.stringify({ type: 'error', error: 'messages array is required' })}\n\n`,
        { status: 400, headers: { 'Content-Type': 'text/event-stream' } }
      );
    }

    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          send({ type: 'thinking' });

          const userPrompt = buildUserPrompt(messages, context);
          const cfg: LlmConfig = {
            provider: provider || undefined,
            system: SYSTEM_PROMPT,
          };

          const r = await generateText(SYSTEM_PROMPT, userPrompt, {
            maxChars: 8000,
            llm: cfg,
          });

          if (!r.ok) {
            // Improve error messaging for common failure modes
            let errorMsg = r.error || 'LLM call failed';
            const is429 = errorMsg.includes('429') || errorMsg.includes('Too many');
            const isTimeout = errorMsg.includes('timeout') || errorMsg.includes('deadline exceeded');
            if (is429) {
              errorMsg = 'The AI service is currently rate-limited (too many requests). Please wait 30–60 seconds and try again. If the problem persists, try a different provider (e.g. cli:hermes if available).';
            } else if (isTimeout) {
              errorMsg = 'The AI service timed out. This may happen with very long prompts or high server load. Try shortening your request or retrying in a moment.';
            }
            send({ type: 'error', error: errorMsg, provider: r.provider, retryable: is429 || isTimeout });
            controller.close();
            return;
          }

          // Parse the JSON response using the robust parser (ported from
          // Molcraft). This handles code fences, unescaped quotes, trailing
          // commas, missing braces, and hallucinated field names.
          const raw = r.text.trim();
          const parsed = parseLlmPayload(raw);

          // Determine the reply text: prefer parsed.reply, fall back to other
          // common field names the LLM might hallucinate, then to raw text.
          const replyText =
            parsed.reply ||
            (parsed as any).summary ||
            (parsed as any).text ||
            (parsed as any).message ||
            (typeof (parsed as any).finalReport === 'string'
              ? (parsed as any).finalReport
              : '') ||
            raw;

          // Determine the commands array: prefer parsed.commands, fall back to
          // "actions"/"steps"/"tasks" with conversion.
          let commands: unknown[] = [];
          if (Array.isArray(parsed.commands)) {
            commands = parsed.commands;
          } else if (Array.isArray((parsed as any).actions)) {
            commands = convertActionsToCommands((parsed as any).actions);
          } else if (Array.isArray((parsed as any).steps)) {
            commands = convertActionsToCommands((parsed as any).steps);
          } else if (Array.isArray((parsed as any).tasks)) {
            commands = convertActionsToCommands((parsed as any).tasks);
          }

          // Sanitize commands: filter out unsupported types (e.g. "showMessage",
          // "selectStructure" that slipped through) and normalize field names.
          commands = sanitizeCommands(commands);

          // Stream the reply text in word-level chunks for a typewriter effect.
          const tokens = replyText.match(/\S+\s*|\s+/g) || [replyText];
          const CHUNK_SIZE = 3; // words per chunk
          for (let i = 0; i < tokens.length; i += CHUNK_SIZE) {
            const chunk = tokens.slice(i, i + CHUNK_SIZE).join('');
            send({ type: 'chunk', text: chunk });
            // Small delay for visual effect (30ms per chunk)
            await new Promise((r) => setTimeout(r, 30));
          }

          // Send the final done event with commands + metadata
          send({
            type: 'done',
            commands,
            captureSnapshot: !!parsed.captureSnapshot,
            continueAfterAnalysis: !!parsed.continueAfterAnalysis,
            provider: r.provider,
            model: r.model,
          });
        } catch (err: any) {
          send({ type: 'error', error: err?.message || String(err) });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error: any) {
    return new Response(
      `data: ${JSON.stringify({ type: 'error', error: error?.message || 'Internal server error' })}\n\n`,
      { status: 500, headers: { 'Content-Type': 'text/event-stream' } }
    );
  }
}

function buildUserPrompt(messages: ChatMessage[], context?: ChatContext): string {
  const parts: string[] = [];
  if (context?.loadedStructures && context.loadedStructures.length > 0) {
    parts.push(
      `[Context] Currently loaded structures: ${context.loadedStructures
        .map((s) => `${s.id} (${s.label})`)
        .join(', ')}`
    );
  } else {
    parts.push('[Context] No structures currently loaded.');
  }
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
  const recent = messages.slice(-10);
  parts.push(`[Conversation history]`);
  for (const m of recent) {
    parts.push(`${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`);
  }
  parts.push(
    `\nRespond with a SINGLE JSON object per the system prompt. The object MUST have a "reply" field (string) and a "commands" field (array). Do NOT use "summary", "actions", "selectStructure", or "showMessage" — these are not supported. Use "reply" for any text you want to show the user, and "load_pdb" (with "id" field) to load a structure.`
  );
  return parts.join('\n');
}

// ============================================================================
// Robust LLM payload parser (ported from Molcraft's parseLlmPayload).
// Handles: code fences, unescaped quotes, trailing commas, missing braces,
// and extracts reply/commands even when the LLM hallucinates field names.
// ============================================================================

interface ParsedPayload {
  reply?: string;
  commands?: unknown[];
  captureSnapshot?: boolean;
  continueAfterAnalysis?: boolean;
  // Allow extra fields the LLM might hallucinate (summary, actions, etc.)
  [key: string]: unknown;
}

function parseLlmPayload(raw: string): ParsedPayload {
  const trimmed = raw.trim();

  // The model may wrap JSON in ```json ... ``` fences or prepend prose.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonCandidate = fenceMatch
    ? fenceMatch[1].trim()
    : extractFirstJsonObject(trimmed);

  if (!jsonCandidate) {
    // No JSON found — treat the whole thing as a plain chat reply.
    return { reply: trimmed };
  }

  // Try parsing the JSON directly first.
  try {
    const parsed = JSON.parse(jsonCandidate);
    if (typeof parsed === 'object' && parsed !== null) {
      return normalizePayload(parsed);
    }
  } catch {
    // JSON.parse failed — likely due to unescaped quotes inside string values.
  }

  // Fallback 1: Regex extraction of the reply field.
  const replyMatch = jsonCandidate.match(
    /"reply"\s*:\s*"([\s\S]*?)"\s*,\s*"commands"/
  );
  if (replyMatch) {
    let reply = replyMatch[1]
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
    const commandsMatch = jsonCandidate.match(
      /"commands"\s*:\s*(\[[\s\S]*?\])\s*[,\}]/
    );
    let commands: unknown[] = [];
    if (commandsMatch) {
      try {
        commands = JSON.parse(commandsMatch[1]);
      } catch {
        // commands array also has issues — leave empty
      }
    }
    const continueMatch = jsonCandidate.match(
      /"continueAfterAnalysis"\s*:\s*(true|false)/
    );
    return {
      reply,
      commands,
      captureSnapshot: false,
      continueAfterAnalysis: continueMatch ? continueMatch[1] === 'true' : false,
    };
  }

  // Fallback 2: Try to repair common LLM JSON mistakes.
  try {
    let repaired = jsonCandidate;
    repaired = repaired.replace(
      /"(\w+)\s*:\s*(true|false|null|\d+(?:\.\d+)?)"/g,
      '"$1": $2'
    );
    repaired = repaired.replace(/,\s*([}\]])/g, '$1');
    const openBraces = (repaired.match(/{/g) || []).length;
    const closeBraces = (repaired.match(/}/g) || []).length;
    if (openBraces > closeBraces) {
      repaired += '}'.repeat(openBraces - closeBraces);
    }
    const openBrackets = (repaired.match(/\[/g) || []).length;
    const closeBrackets = (repaired.match(/\]/g) || []).length;
    if (openBrackets > closeBrackets) {
      repaired += ']'.repeat(openBrackets - closeBrackets);
    }
    const parsed = JSON.parse(repaired);
    if (typeof parsed === 'object' && parsed !== null) {
      return normalizePayload(parsed);
    }
  } catch {
    // Repair also failed
  }

  // Last resort: return the raw text as the reply.
  console.warn('[parseLlmPayload] All JSON parse attempts failed, returning raw text');
  return { reply: trimmed };
}

/** Normalize a parsed object: extract reply from common field names. */
function normalizePayload(parsed: Record<string, unknown>): ParsedPayload {
  const reply =
    typeof parsed.reply === 'string'
      ? parsed.reply
      : typeof parsed.summary === 'string'
      ? parsed.summary
      : typeof parsed.text === 'string'
      ? parsed.text
      : typeof parsed.message === 'string'
      ? parsed.message
      : '';

  return {
    reply,
    commands: Array.isArray(parsed.commands) ? parsed.commands : [],
    captureSnapshot: Boolean(parsed.captureSnapshot),
    continueAfterAnalysis: Boolean(parsed.continueAfterAnalysis),
    // Preserve extra fields for the caller to inspect (summary, actions, etc.)
    ...parsed,
  };
}

/** Find the first balanced {...} object in a string. */
function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
    } else {
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return s.slice(start, i + 1);
      }
    }
  }
  return null;
}

// ============================================================================
// Command sanitization + action→command conversion.
// Handles hallucinated type names (selectStructure, showMessage, etc.) and
// normalizes field names (pdbId → id for load_pdb, etc.).
// ============================================================================

/** The set of command type strings that executeCommand actually supports. */
const SUPPORTED_COMMAND_TYPES = new Set([
  'load_pdb', 'load_alphafold', 'load_emdb', 'load_structure_url', 'load_structure_data',
  'set_representation', 'set_color_theme', 'set_uniform_color',
  'focus_residue', 'focus_ligand', 'focus_chain', 'focus_selection', 'reset_camera',
  'measure_distance', 'measure_angle', 'measure_dihedral', 'label_residue',
  'show_interactions', 'clear_measurements', 'clear_interactions',
  'toggle_spin', 'toggle_rock', 'stop_animation',
  'export_snapshot', 'capture_snapshot',
  'select', 'clear_selection', 'toggle_component_visibility',
  'load_volume_url', 'align_structures', 'set_background', 'set_granularity',
  'analyze_metadata', 'analyze_interface', 'analyze_cli_list', 'analyze_run',
  'show_electrostatic_surface', 'show_druggable_pocket', 'run_virtual_screening', 'detect_pockets',
]);

/**
 * Sanitize a commands array:
 *  - Drop unsupported types (e.g. "showMessage", "selectStructure" that
 *    slipped through) — these are not real commands, just LLM hallucinations.
 *  - Normalize field names (e.g. pdbId → id for load_pdb).
 *  - Convert known hallucinated types to their correct equivalents.
 */
function sanitizeCommands(commands: unknown[]): unknown[] {
  const result: unknown[] = [];

  // Recipe name map — handles all common hallucinated names
  const RECIPE_MAP: Record<string, string> = {
    'hydrogen-bonds': 'hbonds', 'hbonds': 'hbonds', 'hydrogen_bonds': 'hbonds',
    'run_hbonds': 'hbonds', 'h-bonds': 'hbonds', 'h_bonds': 'hbonds',
    'salt-bridges': 'salt_bridges', 'salt_bridges': 'salt_bridges',
    'run_salt_bridges': 'salt_bridges', 'saltbridges': 'salt_bridges',
    'hydrophobic': 'hydrophobic_contacts', 'hydrophobic_contacts': 'hydrophobic_contacts',
    'run_hydrophobic': 'hydrophobic_contacts',
    'all-interactions': 'all_interactions', 'all_interactions': 'all_interactions',
    'ramachandran': 'ramachandran',
    'sasa': 'sasa', 'freesasa': 'sasa',
    'secondary-structure': 'secondary_structure_simple', 'secondary_structure': 'secondary_structure_simple',
    'bfactor': 'bfactor_stats', 'b-factor': 'bfactor_stats', 'bfactor_stats': 'bfactor_stats', 'b_factor': 'bfactor_stats',
    'interface-residues': 'interface_residues', 'interface_residues': 'interface_residues',
    'disulfide-bonds': 'disulfide_bonds', 'disulfide_bonds': 'disulfide_bonds',
    'aromatic-stacking': 'aromatic_stacking', 'aromatic_stacking': 'aromatic_stacking',
    'water-bridges': 'water_bridges', 'water_bridges': 'water_bridges',
    'metal-coordination': 'metal_coordination', 'metal_coordination': 'metal_coordination',
    'binding-pocket': 'binding_pocket', 'binding_pocket': 'binding_pocket',
    'druggability': 'druggability', 'entity-analysis': 'entity_analysis',
    'entity_analysis': 'entity_analysis',
    'virtual-screening': 'virtual_screening', 'virtual_screening': 'virtual_screening',
    'ligand-interactions': 'ligand_interactions', 'ligand_interactions': 'ligand_interactions',
    'detect-pockets': 'detect_pockets', 'detect_pockets': 'detect_pockets', 'pocket-detection': 'detect_pockets',
    'contact-map': 'contact_map', 'contact_map': 'contact_map',
    'oligomer-analysis': 'oligomer_analysis', 'oligomer_analysis': 'oligomer_analysis',
    'surface-residues': 'surface_residues', 'surface_residues': 'surface_residues',
    'structure-validation': 'structure_validation', 'structure_validation': 'structure_validation',
    'secondary-structure-simple': 'secondary_structure_simple', 'secondary_structure_simple': 'secondary_structure_simple',
    'sequence-features': 'sequence_features', 'sequence_features': 'sequence_features',
    'distances': 'distances', 'distance': 'distances',
    'rmsd': 'rmsd', 'per-residue-rmsd': 'rmsd',
    'align-and-superpose': 'align_and_superpose', 'align_and_superpose': 'align_and_superpose', 'alignment': 'align_and_superpose',
    // Round 52: metadata is NOT a recipe — it's a separate command type (analyze_metadata).
    // If the LLM sends {"type":"analyze_run","recipe":"metadata"}, convert it to analyze_metadata.
    'metadata': 'entity_analysis',  // Fallback: run entity_analysis instead of failing
    // Round 53: New recipes
    'protonation-states': 'protonation_states', 'protonation_states': 'protonation_states',
    'conformational-changes': 'conformational_changes', 'conformational_changes': 'conformational_changes',
    'druglike-screening': 'druglike_screening', 'druglike_screening': 'druglike_screening',
  };

  for (const cmd of commands) {
    if (!cmd || typeof cmd !== 'object') continue;
    const c = cmd as Record<string, unknown>;

    // ★ CRITICAL: Hermes uses "action" instead of "type" as the field name.
    // Also handle "name", "command" as alternative field names.
    const rawType = String(c.type || c.action || c.name || c.command || '').toLowerCase();

    let normalized: Record<string, unknown> | null = null;

    // ── Structure loading ──
    if (rawType === 'selectstructure' || rawType === 'select_structure' || rawType === 'load_structure' ||
        rawType === 'load' || rawType === 'load_pdb' || rawType === 'loadpdb') {
      normalized = { type: 'load_pdb', id: String(c.pdbId || c.id || c.pdb_id || c.pdb || '') };
    }
    // ── Message/display commands (skip) ──
    else if (rawType === 'showmessage' || rawType === 'show_message' || rawType === 'message' ||
             rawType === 'log' || rawType === 'notify' || rawType === 'show') {
      continue;
    }
    // ── Camera/focus commands ──
    else if (rawType === 'focus' || rawType === 'camera-focus' || rawType === 'camera_focus' ||
             rawType === 'focus_camera' || rawType === 'focus-camera' || rawType === 'camera') {
      if (c.target === 'ligand' || c.selector === 'ligand' || c.compId || c.ligand) {
        normalized = { type: 'focus_ligand', compId: String(c.compId || c.ligandId || c.ligand || 'ligand') };
      } else if (c.resno != null) {
        normalized = { type: 'focus_residue', chain: String(c.chain || 'A'), resno: Number(c.resno) };
      } else if (c.chain) {
        normalized = { type: 'focus_chain', chain: String(c.chain) };
      } else {
        normalized = { type: 'reset_camera' };
      }
    }
    // ── Analysis commands — handles "run_hbonds", "run_salt_bridges", etc. ──
    else if (rawType === 'analysis' || rawType === 'analyze' || rawType === 'analyze_run' ||
             rawType.startsWith('run_') || rawType.startsWith('analyze_')) {
      // Extract recipe name from various sources
      let recipeName = '';
      if (c.recipe) {
        recipeName = String(c.recipe);
      } else if (c.name) {
        recipeName = String(c.name);
      } else if (rawType.startsWith('run_')) {
        // "run_hbonds" → "hbonds", "run_salt_bridges" → "salt_bridges"
        recipeName = rawType.slice(4);
      } else if (rawType.startsWith('analyze_') && rawType !== 'analyze_run') {
        // "analyze_metadata" is a separate command type, not a recipe
        recipeName = rawType.slice(8);
      } else if (c.analysis) {
        recipeName = String(c.analysis);
      }

      const recipe = RECIPE_MAP[recipeName.toLowerCase()] || recipeName;
      const pdbId = String(c.pdbId || c.id || c.pdb_id || '');
      // Build params from various field names hermes might use
      const params: Record<string, unknown> = {};
      if (c.params && typeof c.params === 'object') {
        Object.assign(params, c.params);
      }
      // Hermes uses "selection1"/"selection2" — try to extract chain info
      if (c.selection1 && typeof c.selection1 === 'string') {
        const m1 = c.selection1.match(/chain\s+([A-Za-z])/i);
        if (m1) params.chain1 = m1[1];
      }
      if (c.selection2 && typeof c.selection2 === 'string') {
        const m2 = c.selection2.match(/chain\s+([A-Za-z])/i);
        if (m2) params.chain2 = m2[1];
      }
      // Default chain params if not found
      if (!params.chain1) params.chain1 = 'A';
      if (!params.chain2) params.chain2 = 'A';
      // Handle ligand-related params
      if (c.ligandCompId) params.ligandCompId = String(c.ligandCompId);
      if (c.radius) params.radius = Number(c.radius);
      if (c.distance) params.radius = Number(c.distance); // hermes uses "distance"

      normalized = { type: 'analyze_run', pdbId, recipe, params };
    }
    // ── Reset camera ──
    else if (rawType === 'reset' || rawType === 'reset-camera' || rawType === 'reset_camera') {
      normalized = { type: 'reset_camera' };
    }
    // ── Representation/color ──
    else if (rawType === 'set-representation' || rawType === 'set_representation' ||
             rawType === 'representation' || rawType === 'set_representation') {
      // Normalize preset names — LLMs often use short forms like "cartoon"
      // but Molstar expects "polymer-cartoon", "polymer-and-ligand", etc.
      const PRESET_MAP: Record<string, string> = {
        'cartoon': 'polymer-cartoon',
        'ball-and-stick': 'atomic-detail',
        'ball_stick': 'atomic-detail',
        'ballandstick': 'atomic-detail',
        'stick': 'atomic-detail',
        'surface': 'molecular-surface',
        'spacefill': 'spacefill',
        'space-filling': 'spacefill',
        'wireframe': 'polymer-cartoon',
        'line': 'polymer-cartoon',
      };
      const rawPreset = String(c.preset || c.representation || 'polymer-and-ligand').toLowerCase();
      const preset = PRESET_MAP[rawPreset] || rawPreset;
      normalized = { type: 'set_representation', preset, structures: c.structures || 'all' };
    } else if (rawType === 'set-color' || rawType === 'set_color_theme' || rawType === 'color' || rawType === 'color_theme') {
      normalized = { type: 'set_color_theme', theme: String(c.theme || c.color || 'chain'), structures: c.structures || 'all' };
    }
    // ── Already supported types ──
    else if (SUPPORTED_COMMAND_TYPES.has(rawType)) {
      normalized = { ...c };
      // Ensure "type" field is set (in case hermes used "action")
      if (!normalized.type && normalized.action) {
        normalized.type = normalized.action;
        delete normalized.action;
      }
      // load_pdb: accept pdbId as alias for id
      if (rawType === 'load_pdb' && !normalized.id && normalized.pdbId) {
        normalized.id = normalized.pdbId;
        delete normalized.pdbId;
      }
      // analyze_metadata / analyze_interface: accept pdbId as alias for id
      if ((rawType === 'analyze_metadata' || rawType === 'analyze_interface') && !normalized.id && normalized.pdbId) {
        normalized.id = normalized.pdbId;
        delete normalized.pdbId;
      }
    }
    // ── Unknown type — log and skip ──
    else {
      console.warn(`[sanitizeCommands] Dropping unsupported command type: ${rawType} (fields: ${Object.keys(c).join(', ')})`);
      continue;
    }

    if (normalized) {
      result.push(normalized);
    }
  }
  return result;
}

/**
 * Fallback converter: if the LLM returns an "actions" array instead of "commands",
 * convert each action to the standard command format.
 * (Delegates to sanitizeCommands for the heavy lifting.)
 */
function convertActionsToCommands(actions: unknown[]): unknown[] {
  return sanitizeCommands(actions);
}
