import { NextRequest, NextResponse } from 'next/server';
import { llmComplete } from '@/lib/llm';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pdbId, title, method, resolution, journal, journalIf, organisms, ligands } = body;

    if (!pdbId || !title) {
      return NextResponse.json(
        { error: 'Missing required fields: pdbId and title' },
        { status: 400 },
      );
    }

    const methodStr = method || 'Unknown';
    const resStr = resolution != null ? `${resolution}Å` : 'N/A';
    const journalStr = journal || 'Unknown';
    const ifStr = journalIf != null ? `IF: ${journalIf}` : '';
    const orgStr = organisms || 'Unknown';
    const ligStr = ligands || 'None';

    const prompt = `Provide a brief 2-3 sentence scientific summary of this protein structure entry: ${pdbId} - ${title}. Method: ${methodStr}, Resolution: ${resStr}, Published in ${journalStr} ${ifStr}. Organisms: ${orgStr}. Ligands: ${ligStr}. Focus on the scientific significance and methodology.`;

    const r = await llmComplete(prompt, {
      provider: 'cli:hermes',
      system: 'You are a structural biology expert producing concise scientific summaries.',
    });

    if (!r.ok) {
      return NextResponse.json(
        { error: 'Failed to generate AI summary', details: r.error || 'Unknown error' },
        { status: 500 },
      );
    }

    return NextResponse.json({ summary: r.text, provider: r.provider, model: r.model });
  } catch (error: any) {
    console.error('AI Summary generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate AI summary', details: error?.message || 'Unknown error' },
      { status: 500 },
    );
  }
}
