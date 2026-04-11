import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { validateRuntimeEnv } from '@/lib/runtime-env';

export const dynamic = 'force-dynamic';

type LatestPipelineRun = {
  id: string;
  pipeline_name: string;
  status: 'running' | 'succeeded' | 'failed';
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error_message: string | null;
};

export async function GET() {
  const env = validateRuntimeEnv();

  let dbConnected = false;
  let dbError: string | null = null;
  let latestPipelineRun: LatestPipelineRun | null = null;

  if (env.ok) {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const dbProbe = await supabaseAdmin.from('pipeline_runs').select('id', { head: true, count: 'exact' }).limit(1);

    if (dbProbe.error) {
      dbError = dbProbe.error.message;
    } else {
      dbConnected = true;
      const latestRunResult = await supabaseAdmin
        .from('pipeline_runs')
        .select('id,pipeline_name,status,started_at,finished_at,duration_ms,error_message')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestRunResult.error) {
        dbError = latestRunResult.error.message;
      } else {
        latestPipelineRun = (latestRunResult.data as LatestPipelineRun | null) ?? null;
      }
    }
  } else {
    dbError = 'Runtime env validation failed; database probe skipped.';
  }

  const ok = env.ok && dbConnected && !dbError;

  return NextResponse.json(
    {
      ok,
      timestamp: new Date().toISOString(),
      env: {
        ok: env.ok,
        missing: env.missing,
      },
      db: {
        connected: dbConnected,
        error: dbError,
      },
      pipeline: {
        latestRun: latestPipelineRun,
      },
    },
    { status: ok ? 200 : 503 },
  );
}
