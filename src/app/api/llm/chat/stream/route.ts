/**
 * POST /api/llm/chat/stream
 *
 * Streaming version of /api/llm/chat. Returns Server-Sent Events (SSE) so the
 * chat client can display the reply incrementally (typewriter effect).
 *
 * Since src/lib/llm.ts uses CLI providers with --no-stream (no native streaming),
 * we simulate streaming by:
 *   1. Calling generateText to get the full response
 *   2. Parsing the JSON { reply, commands, ... }
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
3. Set "continueAfterAnalysis": true ONLY if you need the analysis results to continue.
4. Keep replies concise (2-4 sentences). Use markdown for structure (lists, bold).

Chain selection guidance:
- For interaction analysis, chain1 and chain2 can be the SAME chain for intra-chain analysis.
- Individual recipes now support intra-chain mode (auto-enabled when chain1==chain2).
- If the structure has only one chain, use chain1=chain2="A".
- If the structure has multiple chains and the user wants interface analysis, use chain1="A", chain2="B".

Available analysis recipes: ramachandran, bfactor, sasa, secondary_structure, hbonds, salt_bridges, hydrophobic_contacts, all_interactions, interface_residues, disulfide_bonds, aromatic_stacking, water_bridges, metal_coordination.

Example:
User: "Load 1CBS and analyze its hydrogen bonds"
Assistant: { "reply": "Loading 1CBS and running hydrogen bond analysis on chain A.", "commands": [ {"type":"load_pdb","id":"1CBS"}, {"type":"analyze_run","pdbId":"1CBS","recipe":"all_interactions","params":{"chain1":"A","chain2":"A"}} ], "continueAfterAnalysis": true }`;

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
            send({ type: 'error', error: r.error || 'LLM call failed', provider: r.provider });
            controller.close();
            return;
          }

          // Parse the JSON response
          let parsed: { reply?: string; commands?: unknown[]; captureSnapshot?: boolean; continueAfterAnalysis?: boolean };
          const raw = r.text.trim();
          try {
            const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
            parsed = JSON.parse(cleaned);
          } catch {
            parsed = { reply: raw };
          }

          const replyText = parsed.reply || raw;
          const commands = Array.isArray(parsed.commands) ? parsed.commands : [];

          // Stream the reply text in word-level chunks for a typewriter effect.
          // Split by spaces but keep them, and also split on newlines for markdown.
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
    `\nRespond with JSON per the system prompt. If the user's request requires loading a structure or running an analysis, include the appropriate commands and set continueAfterAnalysis if you need the results.`
  );
  return parts.join('\n');
}
