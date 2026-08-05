import { NextResponse } from 'next/server';
import { getBatchWithSubTargets } from '@/lib/db/batch';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const { batchId } = await params;
    const batch = await getBatchWithSubTargets(batchId);
    
    if (!batch) {
      return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
    }
    
    return NextResponse.json(batch);
  } catch (error) {
    console.error('[api/batches/[batchId]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}