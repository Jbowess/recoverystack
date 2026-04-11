import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'node:child_process';
import { slugify } from '@/lib/slugify';
import type { TemplateType } from '@/lib/types';

config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const argv = process.argv.slice(2);
const isDryRun = argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const shouldPublish = argv.includes('--publish') || process.env.BATCH_PUBLISH === '1';

function getNumericArg(name: string, fallback: number) {
  const key = `--${name}=`;
  const cliValue = argv.find((arg) => arg.startsWith(key))?.slice(key.length);
  const envKey = `BATCH_${name.toUpperCase().replace(/-/g, '_')}`;
  const envValue = process.env[envKey];
  const raw = cliValue ?? envValue;
  const parsed = raw == null ? fallback : Number(raw);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid numeric value for ${name}: ${raw}`);
  }

  return Math.floor(parsed);
}

const pagesPerRun = getNumericArg('pages', 8);
const maxRetries = getNumericArg('retries', 3);
const rateLimitMs = getNumericArg('rate-limit-ms', 400);
const evergreenRatio = Math.max(0, Math.min(1, Number(process.env.BATCH_EVERGREEN_RATIO ?? 0.7)));

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetries<T>(label: string, action: () => PromiseLike<T>): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxRetries) {
    attempt += 1;
    try {
      return await action();
    } catch (error) {
      lastError = error;
      const waitMs = Math.min(rateLimitMs * 2 ** attempt, 8000);
      console.warn(
        `[retry ${attempt}/${maxRetries}] ${label} failed: ${error instanceof Error ? error.message : String(error)}. waiting ${waitMs}ms`,
      );
      if (attempt >= maxRetries) break;
      await sleep(waitMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${label} failed after retries`);
}

type QueueRow = {
  id: string;
  cluster_name: string;
  intent: string | null;
  primary_keyword: string;
  template_id: 'comparison' | 'guide' | 'protocol';
  priority: number | null;
  source: 'evergreen' | 'trend';
  status: 'new' | 'queued' | 'generated' | 'published' | 'skipped';
  score: number | null;
  metadata: Record<string, unknown> | null;
};

type DraftSeed = {
  queueId: string;
  clusterName: string;
  source: 'evergreen' | 'trend';
  term: string;
  template: TemplateType;
  slug: string;
  title: string;
  h1: string;
  metaDescription: string;
  primaryKeyword: string;
};

function mapTemplate(templateId: QueueRow['template_id']): TemplateType {
  if (templateId === 'protocol') return 'protocols';
  // comparison + guide both use guide-style generation.
  return 'guides';
}

function templateCopy(templateId: QueueRow['template_id'], term: string) {
  if (templateId === 'comparison') {
    return {
      title: `${term}: comparison, tradeoffs, and best fit`,
      h1: `${term}: comparison and tradeoffs`,
      meta: `Compare ${term} options with practical tradeoffs, budget fit, and recovery outcomes.`,
    };
  }

  if (templateId === 'protocol') {
    return {
      title: `${term} protocol: implementation plan for training cycles`,
      h1: `${term} implementation protocol`,
      meta: `A practical ${term} protocol covering setup, cadence, and adjustment checkpoints.`,
    };
  }

  return {
    title: `How to apply ${term}: practical guide for recovery and performance`,
    h1: `How to apply ${term}: practical guide`,
    meta: `Step-by-step guide to apply ${term}, avoid common mistakes, and improve outcomes.`,
  };
}

function canonicalKeywordSlug(keyword: string): string {
  const normalized = slugify(keyword)
    .replace(/\b(guide|guides|best|vs|versus|review|reviews|comparison|compare|how-to|how|202\d)\b/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');

  return normalized || slugify(keyword);
}

function buildSeed(row: QueueRow): DraftSeed {
  const termSlug = slugify(row.primary_keyword);
  const template = mapTemplate(row.template_id);
  const slugPrefix = row.template_id === 'protocol' ? 'protocols' : row.template_id === 'comparison' ? 'compare' : 'guides';
  const slug = `${slugPrefix}-${termSlug}`;
  const copy = templateCopy(row.template_id, row.primary_keyword);

  return {
    queueId: row.id,
    clusterName: row.cluster_name,
    source: row.source,
    term: row.primary_keyword,
    template,
    slug,
    title: copy.title,
    h1: copy.h1,
    metaDescription: copy.meta,
    primaryKeyword: row.primary_keyword,
  };
}

function runScript(script: string, args: string[] = []) {
  const cmd = ['tsx', script, ...args];
  console.log(`Running: npx ${cmd.join(' ')}`);

  const result = spawnSync('npx', cmd, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    throw new Error(`Step failed: npx ${cmd.join(' ')} (exit=${result.status ?? 'unknown'})`);
  }
}

async function loadQueueCandidates(source: 'evergreen' | 'trend', limit: number): Promise<QueueRow[]> {
  const { data, error } = await withRetries(`load ${source} queue`, () =>
    supabase
      .from('keyword_queue')
      .select('id,cluster_name,intent,primary_keyword,template_id,priority,source,status,score,metadata')
      .in('status', ['new', 'queued'])
      .eq('source', source)
      .order('priority', { ascending: false, nullsFirst: false })
      .order('score', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: true })
      .limit(limit),
  );

  if (error) throw error;
  return (data ?? []) as QueueRow[];
}

async function loadExistingPageKeywordSlugs(limit = 500): Promise<Set<string>> {
  const { data, error } = await withRetries('load existing page keywords', () =>
    supabase.from('pages').select('primary_keyword').not('primary_keyword', 'is', null).limit(limit),
  );

  if (error) throw error;

  const out = new Set<string>();
  for (const row of data ?? []) {
    const keyword = (row.primary_keyword as string | null) ?? '';
    if (!keyword) continue;
    out.add(canonicalKeywordSlug(keyword));
  }
  return out;
}

async function markQueueStatus(ids: string[], status: QueueRow['status'], metadataPatch?: Record<string, unknown>) {
  if (!ids.length) return;

  if (!metadataPatch) {
    const payload: Record<string, unknown> = { status };
    if (status === 'generated') payload.last_generated_at = new Date().toISOString();
    const { error } = await supabase.from('keyword_queue').update(payload).in('id', ids);
    if (error) throw error;
    return;
  }

  // Per-row metadata updates when patch is dynamic.
  for (const id of ids) {
    const { data, error: fetchError } = await supabase.from('keyword_queue').select('metadata').eq('id', id).single();
    if (fetchError) throw fetchError;

    const metadata = { ...((data?.metadata as Record<string, unknown> | null) ?? {}), ...metadataPatch };
    const payload: Record<string, unknown> = { status, metadata };
    if (status === 'generated') payload.last_generated_at = new Date().toISOString();

    const { error } = await supabase.from('keyword_queue').update(payload).eq('id', id);
    if (error) throw error;
  }
}

async function run() {
  const trendRatio = 1 - evergreenRatio;
  console.log(
    `[batch-generate] start dryRun=${isDryRun} publish=${shouldPublish} pages=${pagesPerRun} evergreenRatio=${evergreenRatio.toFixed(2)} trendRatio=${trendRatio.toFixed(2)} retries=${maxRetries} rateLimitMs=${rateLimitMs}`,
  );

  const evergreenTarget = Math.max(1, Math.round(pagesPerRun * evergreenRatio));
  const trendTarget = Math.max(1, pagesPerRun - evergreenTarget);

  const [evergreenRows, trendRows, existingKeywordSlugs] = await Promise.all([
    loadQueueCandidates('evergreen', Math.max(evergreenTarget * 3, evergreenTarget)),
    loadQueueCandidates('trend', Math.max(trendTarget * 3, trendTarget)),
    loadExistingPageKeywordSlugs(),
  ]);

  const selectedRows: QueueRow[] = [];
  const skippedRows: QueueRow[] = [];
  const seenCanonical = new Set(existingKeywordSlugs);

  const pickRows = (rows: QueueRow[], target: number) => {
    for (const row of rows) {
      if (selectedRows.length >= pagesPerRun) break;
      const canonical = canonicalKeywordSlug(row.primary_keyword);
      if (!canonical || seenCanonical.has(canonical)) {
        skippedRows.push(row);
        continue;
      }

      seenCanonical.add(canonical);
      selectedRows.push(row);
      if (selectedRows.filter((r) => r.source === row.source).length >= target) continue;
    }
  };

  pickRows(evergreenRows, evergreenTarget);
  pickRows(trendRows, trendTarget);

  if (selectedRows.length < pagesPerRun) {
    const topUps = [...evergreenRows, ...trendRows];
    for (const row of topUps) {
      if (selectedRows.length >= pagesPerRun) break;
      if (selectedRows.some((x) => x.id === row.id)) continue;
      const canonical = canonicalKeywordSlug(row.primary_keyword);
      if (!canonical || seenCanonical.has(canonical)) continue;
      seenCanonical.add(canonical);
      selectedRows.push(row);
    }
  }

  if (!selectedRows.length) {
    console.log('[batch-generate] no eligible keyword_queue rows found. nothing to do.');
    return;
  }

  const seeds = selectedRows.map(buildSeed);
  console.log(
    `[batch-generate] selected queued keywords=${selectedRows.length} (evergreen=${selectedRows.filter((r) => r.source === 'evergreen').length}, trend=${selectedRows.filter((r) => r.source === 'trend').length}); skippedDuplicates=${skippedRows.length}`,
  );

  if (isDryRun) {
    for (const seed of seeds) {
      console.log(
        `[dry-run] draft ${seed.template} slug=${seed.slug} keyword="${seed.primaryKeyword}" cluster=${seed.clusterName} source=${seed.source}`,
      );
    }

    if (skippedRows.length) {
      for (const row of skippedRows.slice(0, 20)) {
        console.log(`[dry-run] skipped duplicate keyword="${row.primary_keyword}" cluster=${row.cluster_name}`);
      }
    }

    console.log('[batch-generate] dry-run: skipping DB updates, content generation, quality gate, linker verify, and publish.');
    return;
  }

  await markQueueStatus(selectedRows.map((r) => r.id), 'queued');

  for (const seed of seeds) {
    const { data, error } = await withRetries(`upsert page ${seed.slug}`, () =>
      supabase
        .from('pages')
        .upsert(
          {
            slug: seed.slug,
            template: seed.template,
            title: seed.title,
            meta_description: seed.metaDescription,
            h1: seed.h1,
            intro: `Draft pending generation for ${seed.term}.`,
            primary_keyword: seed.primaryKeyword,
            status: 'draft',
          },
          { onConflict: 'slug' },
        )
        .select('id,slug,status')
        .single(),
    );

    if (error || !data) {
      throw new Error(`Failed to upsert page '${seed.slug}': ${error?.message ?? 'no row returned'}`);
    }

    const existingMeta = selectedRows.find((r) => r.id === seed.queueId)?.metadata ?? {};
    const metadata = {
      ...(existingMeta ?? {}),
      generated_slug: seed.slug,
      generated_page_id: data.id,
      generated_template: seed.template,
      generated_at: new Date().toISOString(),
    };

    const { error: queueUpdateError } = await supabase
      .from('keyword_queue')
      .update({ status: 'generated', metadata, last_generated_at: new Date().toISOString() })
      .eq('id', seed.queueId);

    if (queueUpdateError) {
      throw new Error(`Failed to update keyword_queue generated status for '${seed.primaryKeyword}': ${queueUpdateError.message}`);
    }

    await sleep(rateLimitMs);
  }

  if (skippedRows.length) {
    const nowIso = new Date().toISOString();
    for (const row of skippedRows) {
      const metadata = {
        ...((row.metadata ?? {}) as Record<string, unknown>),
        skipped_reason: 'near_duplicate_keyword_slug',
        skipped_at: nowIso,
      };

      const { error } = await supabase.from('keyword_queue').update({ status: 'skipped', metadata }).eq('id', row.id);
      if (error) throw error;
    }
  }

  runScript('scripts/content-generator.ts');
  runScript('scripts/quality-gate.ts');
  runScript('scripts/linker.ts', ['--verify']);

  if (shouldPublish) {
    runScript('scripts/deploy.ts');

    const generatedIds = selectedRows.map((r) => r.id);
    const { error: publishMarkError } = await supabase
      .from('keyword_queue')
      .update({ status: 'published' })
      .in('id', generatedIds)
      .eq('status', 'generated');

    if (publishMarkError) {
      throw new Error(`Failed to mark generated queue rows as published: ${publishMarkError.message}`);
    }
  } else {
    console.log('[batch-generate] publish skipped (pass --publish or set BATCH_PUBLISH=1).');
  }

  console.log('[batch-generate] SEO generation ready');
  console.log('[batch-generate] complete');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
