import { spawn } from 'node:child_process';
import { NextRequest, NextResponse } from 'next/server';
import { acquireCronLock, getCronLockTtlMs, releaseCronLock } from '@/lib/cron-locks';

function extractProvidedSecret(req: NextRequest): string {
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim();
  }

  return (
    req.headers.get('x-cron-secret')?.trim() ??
    req.nextUrl.searchParams.get('secret')?.trim() ??
    ''
  );
}

const LOCK_NAME = 'nightly-cron';

async function handleNightlyTrigger(req: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET?.trim();

  if (!expectedSecret) {
    return NextResponse.json({ ok: false, error: 'cron_secret_not_configured' }, { status: 500 });
  }

  const providedSecret = extractProvidedSecret(req);
  if (!providedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const ttlMs = getCronLockTtlMs();
  const lockResult = await acquireCronLock(LOCK_NAME, ttlMs, 'api/cron/nightly');

  if (!lockResult.acquired) {
    return NextResponse.json(
      {
        ok: true,
        accepted: false,
        skipped: true,
        reason: 'already_running',
        lock: lockResult.lock,
      },
      { status: 202 },
    );
  }

  try {
    const child = spawn('npm', ['run', 'nightly:run'], {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        CRON_LOCK_NAME: LOCK_NAME,
      },
    });

    child.unref();

    return NextResponse.json({ ok: true, accepted: true, started: true }, { status: 202 });
  } catch {
    await releaseCronLock(LOCK_NAME);
    return NextResponse.json({ ok: false, error: 'pipeline_start_failed' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handleNightlyTrigger(req);
}

export async function POST(req: NextRequest) {
  return handleNightlyTrigger(req);
}
