import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<any> },
) {
  const resolved = await params as { indexNowKey?: string };
  const key = process.env.INDEXNOW_KEY?.trim();

  if (!key || resolved.indexNowKey !== key) {
    return new NextResponse('Not found', { status: 404 });
  }

  return new NextResponse(key, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400',
    },
  });
}
