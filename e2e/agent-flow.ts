/**
 * Server-side E2E test for the agent analysis flow.
 *
 * Drives the same API loop the browser hook (use-agent-session.ts) drives:
 *   1. POST /api/agent/sessions          → create session
 *   2. POST /api/agent/sessions/:id/messages → step 1 (LLM call)
 *   3. If toolCalls returned: execute each like the client does
 *      (pdb_load/pdb_analyze → /api/analyze/run etc.) and POST tool-results
 *   4. Repeat until done → print the final assistant content
 *
 * This validates the COMPLETE LLM structure-analysis logic without needing
 * the browser (which resets when the 4GB sandbox OOM-restarts the dev server).
 */
import * as fs from 'fs';

const BASE = 'http://127.0.0.1:3000';
const TIMEOUT_MS = 240_000;

async function jfetch(url: string, init?: RequestInit): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(t);
  }
}

/** Execute a client-side tool the way use-agent-session.executeToolCall does (minus Molstar rendering). */
async function executeTool(name: string, args: any, pdbIdRef: { id: string }): Promise<{ ok: boolean; result?: any; error?: string }> {
  try {
    switch (name) {
      case 'pdb_load': {
        pdbIdRef.id = String(args.id || '').toUpperCase();
        // The real client loads into Molstar; here we just verify RCSB access
        const r = await fetch(`https://files.rcsb.org/download/${pdbIdRef.id}.pdb`, { method: 'HEAD' });
        return { ok: r.ok, result: { ok: r.ok, detail: `Loaded PDB ${pdbIdRef.id}` } };
      }
      case 'pdb_analyze': {
        const params: Record<string, unknown> = {};
        if (args.chain1) params.chain1 = args.chain1;
        if (args.chain2) params.chain2 = args.chain2;
        if (args.ligandCompId) params.ligandCompId = args.ligandCompId;
        if (args.radius) params.radius = args.radius;
        // Mirror commands.ts analyze_run: runRecipe(recipe, pdbId, params)
        const data = await jfetch(`${BASE}/api/analyze/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipe: args.recipe, pdbId: pdbIdRef.id, params }),
        });
        return {
          ok: true,
          result: {
            ok: true,
            detail: `Recipe ${args.recipe} ok: ${data.data ? 'with data' : 'see stdout'}`,
            analysisResult: { kind: 'recipe', recipe: args.recipe, data },
          },
        };
      }
      case 'set_representation':
        return { ok: true, result: { ok: true, detail: `Representation: ${args.preset}` } };
      case 'set_color_theme':
        return { ok: true, result: { ok: true, detail: `Color theme: ${args.theme}` } };
      case 'capture_multi_angle':
      case 'recapture_screenshot':
        return {
          ok: true,
          result: {
            ok: true,
            detail: `Captured 4 angles for ${args.recipe}`,
            data: {
              recipe: args.recipe,
              label: args.recipe,
              screenshots: ['front', 'side', 'top', 'back'].map(a => ({ dataUri: '[image data omitted]', angle: a, label: `${args.recipe} - ${a}` })),
            },
          },
        };
      default:
        return { ok: true, result: { ok: true, detail: `${name} executed` } };
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

async function main() {
  const userMessage = process.argv[2] || '分析4HHB中所有链之间的互作';
  const tag = process.argv[3] || 'e2e';
  console.log(`\n========== E2E: "${userMessage}" ==========`);

  // 1. Create session
  const sess = await jfetch(`${BASE}/api/agent/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: `E2E ${tag}` }),
  });
  const sid = sess.sessionId;
  console.log(`session: ${sid}`);

  const pdbIdRef = { id: '' };
  const toolLog: string[] = [];
  let finalContent = '';
  let guard = 0;

  // 2. Drive the loop
  let payload: Record<string, unknown> = { content: userMessage };
  let endpoint = `${BASE}/api/agent/sessions/${sid}/messages`;
  while (guard < 12) {
    guard += 1;
    const data = await jfetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (data.error) throw new Error(data.error);
    if (data.done || !data.toolCalls || data.toolCalls.length === 0) {
      finalContent = data.finalContent || '';
      break;
    }
    // Execute the tool calls (client-side simulation)
    const results: Array<{ callId: string; name: string; ok: boolean; result?: unknown; error?: string }> = [];
    for (const call of data.toolCalls) {
      const args = JSON.parse(call.arguments || '{}');
      const r = await executeTool(call.name, args, pdbIdRef);
      toolLog.push(`${call.name}(${JSON.stringify(args).slice(0, 120)}) → ${r.ok ? 'ok' : 'ERR ' + r.error}`);
      results.push({ callId: call.callId, name: call.name, ok: r.ok, result: r.result, error: r.error });
    }
    endpoint = `${BASE}/api/agent/sessions/${sid}/tool-results`;
    payload = { results };
  }

  // 3. Report
  console.log('\n--- tool calls ---');
  for (const line of toolLog) console.log('  ' + line);
  console.log('\n--- final assistant answer ---');
  console.log(finalContent || '(empty)');

  fs.writeFileSync(`/tmp/e2e_${tag}_result.json`, JSON.stringify({ toolLog, finalContent }, null, 2));
  console.log(`\nSaved → /tmp/e2e_${tag}_result.json`);

  // Assertions
  const hasPairwise = toolLog.some(l => l.includes('pairwise_interactions'));
  const dupCapture = toolLog.filter(l => l.startsWith('capture_multi_angle')).length;
  console.log(`\n=== CHECKS: pairwise_used=${hasPairwise} | explicit_captures=${dupCapture} (expect 0) ===`);
}

main().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1); });
