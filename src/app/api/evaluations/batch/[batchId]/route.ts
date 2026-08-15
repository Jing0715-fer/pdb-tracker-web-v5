import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const { batchId } = await params;
  if (!batchId) {
    return NextResponse.json({ error: 'batchId is required' }, { status: 400 });
  }

  try {
    // Delete the batch record. Sub-target evaluations are deleted separately
    // by the caller via /api/evaluations/[uniprotId] DELETE. Here we just
    // clean up the EvaluationBatch row (cascade will handle related rows
    // like EvaluationReport if FK is set to cascade).
    const deleted = await db.evaluationBatch.deleteMany({
      where: { batchId },
    });

    if (deleted.count === 0) {
      return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, deleted: deleted.count });
  } catch (err) {
    console.error('Failed to delete batch:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete batch' },
      { status: 500 },
    );
  }
}
