import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

const EVALS_DIR = '/Users/lijing/Documents/my_note/LLM-Wiki/wiki/evaluations';

// Map batchId -> file mapping
const BATCH_FILE_MAP: Record<string, string> = {
  'batch-SDG2-CDKC-1-CYCT1-WD-SDG721': 'SDG2-CDKC复合体_结构可行性评估.md',
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const { batchId } = await params;
    
    const filename = BATCH_FILE_MAP[batchId];
    if (!filename) {
      return NextResponse.json({ error: 'Batch report file not found' }, { status: 404 });
    }
    
    const filePath = path.join(EVALS_DIR, filename);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Report file not found on disk' }, { status: 404 });
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    
    return NextResponse.json({
      batchId,
      filename,
      content,
    });
  } catch (error) {
    console.error('Error reading batch report:', error);
    return NextResponse.json({ error: 'Failed to read batch report' }, { status: 500 });
  }
}