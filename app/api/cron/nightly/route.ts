import { createClient } from '@supabase/supabase-js';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_LOCK_TTL_MS = 4 * 60 * 60 * 1000;

type LockData = {
  startedAt: number;
  createdBy: string;
};

function getLockTtlMs(): number {
  const raw = process.env.NIGHTLY_CRON_LOCK_TTL_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LOCK_TTL_MS;
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

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

// ── Supabase-based distributed lock (works on serverless) ──

const LOCK_NAME = 'nightly-cron';

async function acquireLock(ttlMs: number): Promise<{ acquired: true } | { acquired: false; reason: 'running'; lock: LockData | null }> {
  const supabase = getSupabase();
  const now = Date.now();

  // Try to read existing lock
  const { data: existing } = await supabase
    .from('cron_locks')
    .select('lock_data')
    .eq('lock_name', LOCK_NAME)
    .single();

  if (existing?.lock_data) {
    const lockData = existing.lock_data as LockData;
    const isStale = Number.isFinite(lockData.startedAt) && now - lockData.startedAt > ttlMs;

    if (!isStale) {
      return { acquired: false, reason: 'running', lock: lockData };
    }
    // Stale lock — delete and re-acquire
    await supabase.from('cron_locks').delete().eq('lock_name', LOCK_NAME);
  }

  // Try to insert lock (unique constraint prevents race conditions)
  const payload: LockData = { startedAt: now, createdBy: 'api/cron/nightly' };
  const { error } = await supabase
    .from('cron_locks')
    .insert({ lock_name: LOCK_NAME, lock_data: payload });

  if (error) {
    // Another process grabbed it
    return { acquired: false, reason: 'running', lock: null };
  }

  return { acquired: true };
}

async function releaseLock() {
  const supabase = getSupabase();
  await supabase.from('cron_locks').delete().eq('lock_name', LOCK_NAME);
}

async function handleNightlyTrigger(req: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET?.trim();

  if (!expectedSecret) {
    return NextResponse.json({ ok: false, error: 'cron_secret_not_configured' }, { status: 500 });
  }

  const providedSecret = extractProvidedSecret(req);
  if (!providedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const ttlMs = getLockTtlMs();
  const lockResult = await acquireLock(ttlMs);

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
      env: process.env,
    });

    child.unref();

    return NextResponse.json({ ok: true, accepted: true, started: true }, { status: 202 });
  } catch {
    await releaseLock();
    return NextResponse.json({ ok: false, error: 'pipeline_start_failed' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handleNightlyTrigger(req);
}

export async function POST(req: NextRequest) {
  return handleNightlyTrigger(req);
}
