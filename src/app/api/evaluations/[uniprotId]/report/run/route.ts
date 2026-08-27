/**
 * POST /api/evaluations/[uniprotId]/report/run
 *
 * Manual trigger for the LLM-generated protein feasibility report.
 * Mirrors the skill's `/api/evaluation/report/generate/{uniprot_id}` endpoint.
 *
 * Requires that the evaluation data already exists in the DB (run
 * /api/evaluations/run first). Body:
 *
 *   - saveToFile: optional boolean (also writes to the evaluation-reports dir)
 *   - llm: optional { provider, apiKey, baseUrl, model, system }
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateEvaluationReport } from '@/lib/target-evaluation';
import { LlmConfig } from '@/lib/llm';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ uniprotId: string }> },
) {
  const { uniprotId } = await params;
  // API-03: strict UniProt format check at route entry (same regex as
  // runTargetEvaluation) — the param feeds a report filename, so path
  // traversal via crafted [uniprotId] segments must be rejected here.
  if (!/^[A-Z][A-Z0-9]{5}$/.test(uniprotId.trim().toUpperCase())) {
    return NextResponse.json(
      { error: 'Invalid UniProt ID format (expected 6-char alphanum like P00533)' },
      { status: 400 },
    );
  }
  let body: any = {};
  try { body = await request.json(); } catch {/* empty ok */}
  const result = await generateEvaluationReport({
    uniprot: uniprotId,
    saveToFile: body.saveToFile === true,
    llm: body.llm as LlmConfig | undefined,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
