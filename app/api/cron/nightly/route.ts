import { constants as fsConstants } from 'node:fs';
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

const LOCK_DIR = path.join(process.cwd(), '.locks');
const LOCK_PATH = path.join(LOCK_DIR, 'nightly-cron.lock');
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

async function acquireLock(ttlMs: number): Promise<{ acquired: true } | { acquired: false; reason: 'running'; lock: LockData | null }> {
  await mkdir(LOCK_DIR, { recursive: true });

  try {
    const file = await open(LOCK_PATH, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY);
    const payload: LockData = {
      startedAt: Date.now(),
      createdBy: 'api/cron/nightly',
    };
    await file.writeFile(JSON.stringify(payload));
    await file.close();
    return { acquired: true };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code !== 'EEXIST') {
      throw error;
    }

    let existing: LockData | null = null;
    try {
      const raw = await readFile(LOCK_PATH, 'utf8');
      existing = JSON.parse(raw) as LockData;
    } catch {
      // If lock is unreadable, treat as currently running to fail safe.
      return { acquired: false, reason: 'running', lock: null };
    }

    const startedAt = Number(existing.startedAt);
    const isStale = Number.isFinite(startedAt) && Date.now() - startedAt > ttlMs;

    if (!isStale) {
      return { acquired: false, reason: 'running', lock: existing };
    }

    await rm(LOCK_PATH, { force: true });

    const retryFile = await open(LOCK_PATH, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY);
    const payload: LockData = {
      startedAt: Date.now(),
      createdBy: 'api/cron/nightly',
    };
    await retryFile.writeFile(JSON.stringify(payload));
    await retryFile.close();
    return { acquired: true };
  }
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
    await rm(LOCK_PATH, { force: true });
    return NextResponse.json({ ok: false, error: 'pipeline_start_failed' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handleNightlyTrigger(req);
}

export async function POST(req: NextRequest) {
  return handleNightlyTrigger(req);
}
