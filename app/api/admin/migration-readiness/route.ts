import { NextResponse } from 'next/server';
import { getMigrationReadinessReport } from '@/lib/migration-readiness';

export async function GET() {
  const report = await getMigrationReadinessReport();
  const status = report.ready ? 200 : 503;
  return NextResponse.json(report, { status });
}
