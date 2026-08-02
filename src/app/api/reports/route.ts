import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type') || 'all';

    const where: any = {};
    if (type && type !== 'all') {
      where.reportType = type;
    }

    const reports = await db.weeklyReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        weekId: true,
        reportType: true,
        title: true,
        content: true,
        filename: true,
        createdAt: true,
      },
    });

    const result = reports.map(r => ({
      id: r.id,
      weekId: r.weekId,
      reportType: r.reportType,
      title: r.title,
      content: r.content,
      filename: r.filename,
      createdAt: r.createdAt,
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching reports:', error);
    return NextResponse.json([], { status: 500 });
  }
}
