import { NextRequest, NextResponse } from 'next/server';
import { llmComplete } from '@/lib/llm';
import { checkLlmRateLimit, getClientKey, rateLimitResponse } from '@/lib/llm-rate-limit';

export async function POST(request: NextRequest) {
  // API-05: 10 req/min sliding-window rate limit (same pattern as the VLM
  // route, R165/VLM-006). No auth in this sandbox app — this is the only
  // guard against a caller draining the LLM quota.
  const rate = checkLlmRateLimit('ai-weekly-summary', getClientKey(request));
  if (!rate.allowed) {
    return rateLimitResponse('ai-weekly-summary', rate.retryAfterSec);
  }

  try {
    const body = await request.json();
    const { weekId, entries } = body;

    if (!weekId || !entries || !Array.isArray(entries)) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (entries.length === 0) {
      return NextResponse.json({
        summary: `No structures were released during week ${weekId}. There is insufficient data to generate a weekly summary.`,
        weekId,
      });
    }

    const totalStructures = entries.length;
    const methods = {
      cryoem: entries.filter((e: any) => e.isCryoem).length,
      xray: entries.filter((e: any) => e.isXray).length,
      nmr: entries.filter((e: any) => !e.isCryoem && !e.isXray && e.method?.toLowerCase().includes('nmr')).length,
    };
    const resolutions = entries.filter((e: any) => e.resolution != null).map((e: any) => e.resolution);
    const avgRes = resolutions.length > 0
      ? (resolutions.reduce((a: number, b: number) => a + b, 0) / resolutions.length).toFixed(2)
      : 'N/A';
    const topJournals = entries
      .filter((e: any) => e.journal && e.journalIf)
      .sort((a: any, b: any) => (b.journalIf || 0) - (a.journalIf || 0))
      .slice(0, 5)
      .map((e: any) => `${e.journal} (IF: ${e.journalIf})`);
    const organisms = [...new Set(entries.map((e: any) => e.organisms).filter(Boolean))].slice(0, 5);

    const titles = entries
      .slice(0, 10)
      .map((e: any) => `- ${e.pdbId}: ${e.title}`)
      .join('\n');

    const prompt = `You are a structural biology expert. Provide a comprehensive weekly summary report for week ${weekId} of PDB structure releases.

Data overview:
- Total structures: ${totalStructures}
- Methods: Cryo-EM: ${methods.cryoem}, X-ray: ${methods.xray}, NMR: ${methods.nmr}
- Average resolution: ${avgRes}Å
- Top journals: ${topJournals.join(', ')}
- Organisms: ${organisms.join(', ')}

Structure titles (top 10):
${titles}

Please provide:
1. **Weekly Overview** (2-3 sentences): Key trends and highlights
2. **Method Trends** (1-2 sentences): Notable patterns in experimental methods
3. **Research Highlights** (2-3 sentences): Most significant structures and why they matter
4. **Notable Publications** (1-2 sentences): High-impact publications and their significance

Format as clean markdown with the section headers above.`;

    const r = await llmComplete(prompt, {
      provider: 'cli:hermes',
      system: 'You are a structural biology expert producing weekly summaries of PDB structure releases.',
    });

    if (!r.ok) {
      return NextResponse.json(
        { error: 'Failed to generate weekly summary', details: r.error || 'Unknown error' },
        { status: 500 },
      );
    }

    return NextResponse.json({ summary: r.text, weekId, provider: r.provider, model: r.model });
  } catch (error: any) {
    console.error('AI Weekly Summary generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate weekly summary', details: error?.message || 'Unknown error' },
      { status: 500 },
    );
  }
}
