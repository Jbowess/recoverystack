/**
 * Full-stack smoke test — validates that all critical system components are
 * healthy before a batch run or as part of a daily cron check.
 *
 * Usage:
 *   npx tsx scripts/smoke-test.ts
 *   npx tsx scripts/smoke-test.ts --strict   (exit 1 on any degraded check)
 *
 * Checks:
 *  1. Environment variables present
 *  2. Supabase DB connection
 *  3. Required pipeline tables exist
 *  4. component_library is seeded (>= 1 active row)
 *  5. keyword_queue has actionable items
 *  6. Health endpoint returns ok
 *  7. Sitemap endpoint responds with at least 1 URL
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const SITE_URL = process.env.SITE_URL ?? 'http://localhost:3000';
const strict = process.argv.includes('--strict');

type CheckResult = {
  name: string;
  status: 'ok' | 'degraded' | 'fail';
  detail?: string;
};

const results: CheckResult[] = [];

function pass(name: string, detail?: string) {
  results.push({ name, status: 'ok', detail });
}

function degraded(name: string, detail: string) {
  results.push({ name, status: 'degraded', detail });
}

function fail(name: string, detail: string) {
  results.push({ name, status: 'fail', detail });
}

async function checkEnv() {
  const required = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    fail('env-vars', `missing: ${missing.join(', ')}`);
    return null;
  }
  pass('env-vars');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function checkDbConnection(supabase: // eslint-disable-next-line @typescript-eslint/no-explicit-any
any) {
  try {
    const { error } = await supabase.from('pages').select('id', { count: 'exact', head: true });
    if (error) throw error;
    pass('db-connection');
    return true;
  } catch (err) {
    fail('db-connection', err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function checkRequiredTables(supabase: // eslint-disable-next-line @typescript-eslint/no-explicit-any
any) {
  const tables = [
    'pages',
    'pipeline_runs',
    'pipeline_steps',
    'component_library',
    'keyword_queue',
    'trends',
    'generated_page_fingerprints',
  ];

  const missing: string[] = [];

  for (const table of tables) {
    try {
      const { error } = await supabase.from(table).select('id', { count: 'exact', head: true }).limit(0);
      // 42P01 = relation does not exist
      if (error?.code === '42P01' || /does not exist/i.test(error?.message ?? '')) {
        missing.push(table);
      }
    } catch {
      missing.push(table);
    }
  }

  if (missing.length) {
    fail('required-tables', `missing tables: ${missing.join(', ')}`);
  } else {
    pass('required-tables', `all ${tables.length} tables present`);
  }
}

async function checkComponentLibrary(supabase: // eslint-disable-next-line @typescript-eslint/no-explicit-any
any) {
  try {
    const { count, error } = await supabase
      .from('component_library')
      .select('id', { count: 'exact', head: true })
      .eq('active', true);

    if (error) throw error;

    if ((count ?? 0) === 0) {
      fail('component-library', 'no active components found — run reseed via admin');
    } else {
      pass('component-library', `${count} active components`);
    }
  } catch (err) {
    degraded('component-library', err instanceof Error ? err.message : String(err));
  }
}

async function checkKeywordQueue(supabase: // eslint-disable-next-line @typescript-eslint/no-explicit-any
any) {
  try {
    const { count, error } = await supabase
      .from('keyword_queue')
      .select('id', { count: 'exact', head: true })
      .in('status', ['new', 'queued']);

    if (error) throw error;

    if ((count ?? 0) === 0) {
      degraded('keyword-queue', 'no actionable items in keyword_queue (status=new/queued)');
    } else {
      pass('keyword-queue', `${count} actionable items`);
    }
  } catch (err) {
    degraded('keyword-queue', err instanceof Error ? err.message : String(err));
  }
}

async function checkHealthEndpoint() {
  const url = `${SITE_URL}/api/health`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      degraded('health-endpoint', `HTTP ${res.status} from ${url}`);
      return;
    }
    const json = await res.json().catch(() => null);
    const status = json?.status ?? 'unknown';
    if (status === 'ok') {
      pass('health-endpoint', `status=${status}`);
    } else {
      degraded('health-endpoint', `status=${status} — ${JSON.stringify(json).slice(0, 200)}`);
    }
  } catch (err) {
    degraded('health-endpoint', `fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function checkSitemapEndpoint() {
  const url = `${SITE_URL}/sitemap.xml`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) {
      degraded('sitemap-endpoint', `HTTP ${res.status} from ${url}`);
      return;
    }
    const text = await res.text();
    const urlCount = (text.match(/<loc>/g) ?? []).length;
    if (urlCount === 0) {
      degraded('sitemap-endpoint', 'sitemap returned 0 <loc> entries');
    } else {
      pass('sitemap-endpoint', `${urlCount} URLs found`);
    }
  } catch (err) {
    degraded('sitemap-endpoint', `fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function run() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('SMOKE TEST  —  ' + new Date().toISOString());
  console.log(`SITE_URL: ${SITE_URL}`);
  console.log(`${'='.repeat(60)}\n`);

  const supabase = await checkEnv();
  if (!supabase) {
    printResults();
    process.exit(1);
  }

  const dbOk = await checkDbConnection(supabase);

  if (dbOk) {
    await Promise.all([
      checkRequiredTables(supabase),
      checkComponentLibrary(supabase),
      checkKeywordQueue(supabase),
    ]);
  }

  await Promise.all([
    checkHealthEndpoint(),
    checkSitemapEndpoint(),
  ]);

  printResults();

  const failCount = results.filter((r) => r.status === 'fail').length;
  const degradedCount = results.filter((r) => r.status === 'degraded').length;

  if (failCount > 0) {
    console.error(`\nSMOKE TEST FAILED — ${failCount} failure(s), ${degradedCount} degraded`);
    process.exit(1);
  }

  if (strict && degradedCount > 0) {
    console.error(`\nSMOKE TEST DEGRADED — ${degradedCount} degraded check(s) (--strict mode)`);
    process.exit(1);
  }

  if (degradedCount > 0) {
    console.warn(`\nSMOKE TEST PASSED WITH WARNINGS — ${degradedCount} degraded check(s)`);
  } else {
    console.log(`\nSMOKE TEST PASSED — all ${results.length} checks ok`);
  }
}

function printResults() {
  const icons: Record<CheckResult['status'], string> = { ok: '✓', degraded: '~', fail: '✗' };
  for (const r of results) {
    const icon = icons[r.status];
    const detail = r.detail ? `  (${r.detail})` : '';
    console.log(`  ${icon} ${r.name}${detail}`);
  }
}

run().catch((err) => {
  console.error('Smoke test runner error:', err);
  process.exit(1);
});
