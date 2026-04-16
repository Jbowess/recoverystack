import { createClient } from '@supabase/supabase-js';

const DEFAULT_LOCK_TTL_MS = 4 * 60 * 60 * 1000;

export type CronLockData = {
  startedAt: number;
  createdBy: string;
};

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

export function getCronLockTtlMs() {
  const raw = process.env.NIGHTLY_CRON_LOCK_TTL_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LOCK_TTL_MS;
}

export async function acquireCronLock(
  lockName: string,
  ttlMs: number,
  createdBy: string,
): Promise<{ acquired: true } | { acquired: false; reason: 'running'; lock: CronLockData | null }> {
  const supabase = getSupabase();
  const now = Date.now();

  const { data: existing } = await supabase
    .from('cron_locks')
    .select('lock_data')
    .eq('lock_name', lockName)
    .single();

  if (existing?.lock_data) {
    const lockData = existing.lock_data as CronLockData;
    const isStale = Number.isFinite(lockData.startedAt) && now - lockData.startedAt > ttlMs;

    if (!isStale) {
      return { acquired: false, reason: 'running', lock: lockData };
    }

    await supabase.from('cron_locks').delete().eq('lock_name', lockName);
  }

  const payload: CronLockData = { startedAt: now, createdBy };
  const { error } = await supabase.from('cron_locks').insert({ lock_name: lockName, lock_data: payload });

  if (error) {
    return { acquired: false, reason: 'running', lock: null };
  }

  return { acquired: true };
}

export async function releaseCronLock(lockName: string) {
  const supabase = getSupabase();
  await supabase.from('cron_locks').delete().eq('lock_name', lockName);
}
