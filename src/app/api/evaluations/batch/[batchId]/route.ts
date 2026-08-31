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
    // R197 bug 修复：先解除成员 Evaluation 的 batchId 归属 —— 旧版只删 batch
    // 行，成员行保留 batchId 指向已删除的 batch，导致其既不进 batch 列表也
    // 不进主列表（列表谓词排除非空 batchId），评估从 UI「凭空消失」且无法
    // 通过列表重删。解除归属后回到主列表，可独立查看/删除。
    await db.$executeRaw`UPDATE Evaluation SET batchId = NULL, updatedAt = CURRENT_TIMESTAMP WHERE batchId = ${batchId}`;
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
