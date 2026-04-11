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

const TEMPLATE_ORDER: TemplateType[] = [
  'pillars',
  'guides',
  'alternatives',
  'protocols',
  'metrics',
  'costs',
  'compatibility',
  'trends',
];

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

const pagesPerTemplate = getNumericArg('per-template', 2);
const maxRetries = getNumericArg('retries', 3);
const rateLimitMs = getNumericArg('rate-limit-ms', 400);

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
      console.warn(`[retry ${attempt}/${maxRetries}] ${label} failed: ${error instanceof Error ? error.message : String(error)}. waiting ${waitMs}ms`);
      if (attempt >= maxRetries) break;
      await sleep(waitMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${label} failed after retries`);
}

type TrendRow = {
  id: string;
  term: string;
  score: number | null;
  competition: string | null;
  status: string | null;
};

type DraftSeed = {
  trendId: string;
  term: string;
  template: TemplateType;
  slug: string;
  title: string;
  h1: string;
  metaDescription: string;
  primaryKeyword: string;
  pillarSlug?: string;
};

function templateCopy(template: TemplateType, term: string) {
  const byTemplate: Record<TemplateType, { title: string; h1: string; meta: string }> = {
    pillars: {
      title: `${term}: RecoveryStack expert hub`,
      h1: `${term}: RecoveryStack expert hub`,
      meta: `Evidence-first hub for ${term} with practical implementation guidance and comparison pathways.`,
    },
    guides: {
      title: `How to apply ${term}: practical guide for recovery and performance`,
      h1: `How to apply ${term}: practical guide`,
      meta: `Step-by-step guide to apply ${term}, avoid common mistakes, and improve outcomes.`,
    },
    alternatives: {
      title: `${term} alternatives: evidence-backed options and tradeoffs`,
      h1: `${term} alternatives and tradeoffs`,
      meta: `Compare leading alternatives to ${term} with pros, cons, and athlete fit.`,
    },
    protocols: {
      title: `${term} protocol: implementation plan for training cycles`,
      h1: `${term} implementation protocol`,
      meta: `A practical ${term} protocol covering setup, cadence, and adjustment checkpoints.`,
    },
    metrics: {
      title: `${term} metrics that matter: what to track and why`,
      h1: `${term} metrics that matter`,
      meta: `Decode ${term} metrics, benchmark ranges, and actions to take from each signal.`,
    },
    costs: {
      title: `${term} costs explained: ownership, hidden fees, and ROI`,
      h1: `${term} cost breakdown`,
      meta: `Understand total cost of ${term}, ongoing fees, and where value compounds over time.`,
    },
    compatibility: {
      title: `${term} compatibility guide: devices, apps, and workflow fit`,
      h1: `${term} compatibility guide`,
      meta: `Check ${term} compatibility across devices, integrations, and athlete workflows.`,
    },
    trends: {
      title: `What is ${term}? evidence, use-cases, and limitations`,
      h1: `What is ${term}?`,
      meta: `A balanced breakdown of ${term}, including use-cases, risks, and practical next steps.`,
    },
  };

  return byTemplate[template];
}

function buildSeeds(topTrends: TrendRow[]) {
  const seeds: DraftSeed[] = [];

  for (const template of TEMPLATE_ORDER) {
    const selected = topTrends.slice(0, pagesPerTemplate);

    for (const trend of selected) {
      const termSlug = slugify(trend.term);
      const slug = template === 'pillars' ? `${termSlug}-hub` : `${template}-${termSlug}`;
      const copy = templateCopy(template, trend.term);
      const pillarSlug = `${termSlug}-hub`;

      seeds.push({
        trendId: trend.id,
        term: trend.term,
        template,
        slug,
        title: copy.title,
        h1: copy.h1,
        metaDescription: copy.meta,
        primaryKeyword: trend.term,
        pillarSlug: template === 'pillars' ? undefined : pillarSlug,
      });
    }
  }

  return seeds;
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

async function run() {
  console.log(
    `[batch-generate] start dryRun=${isDryRun} publish=${shouldPublish} perTemplate=${pagesPerTemplate} retries=${maxRetries} rateLimitMs=${rateLimitMs}`,
  );

  const { data: queued, error: queuedError } = await withRetries('load queued trends', () =>
    supabase
      .from('trends')
      .select('id,term,score,competition,status')
      .eq('status', 'queued')
      .order('score', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: true })
      .limit(Math.max(pagesPerTemplate * 3, pagesPerTemplate)),
  );

  if (queuedError) throw queuedError;

  const topTrends = (queued ?? []) as TrendRow[];
  if (!topTrends.length) {
    console.log('[batch-generate] no queued trends found. nothing to do.');
    return;
  }

  const selected = topTrends.slice(0, pagesPerTemplate);
  const seeds = buildSeeds(selected);

  console.log(`[batch-generate] selected trends=${selected.length}; planned drafts=${seeds.length}`);

  if (isDryRun) {
    for (const seed of seeds) {
      console.log(
        `[dry-run] draft ${seed.template} slug=${seed.slug} keyword="${seed.primaryKeyword}"${seed.pillarSlug ? ` pillar=${seed.pillarSlug}` : ''}`,
      );
    }
  } else {
    const pillarSeeds = seeds.filter((seed) => seed.template === 'pillars');
    const clusterSeeds = seeds.filter((seed) => seed.template !== 'pillars');

    const pillarIdBySlug = new Map<string, string>();

    for (const seed of pillarSeeds) {
      const { data, error } = await withRetries(`upsert pillar page ${seed.slug}`, () =>
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
          .select('id,slug')
          .single(),
      );

      if (error || !data) {
        throw new Error(`Failed to upsert pillar '${seed.slug}': ${error?.message ?? 'no row returned'}`);
      }

      pillarIdBySlug.set(seed.slug, data.id as string);
      await sleep(rateLimitMs);
    }

    for (const seed of clusterSeeds) {
      const pillarId = seed.pillarSlug ? pillarIdBySlug.get(seed.pillarSlug) : null;

      if (!pillarId) {
        throw new Error(`Missing pillar id for cluster page '${seed.slug}' (pillarSlug=${seed.pillarSlug ?? 'n/a'})`);
      }

      const { error } = await withRetries(`upsert cluster page ${seed.slug}`, () =>
        supabase.from('pages').upsert(
          {
            slug: seed.slug,
            template: seed.template,
            title: seed.title,
            meta_description: seed.metaDescription,
            h1: seed.h1,
            intro: `Draft pending generation for ${seed.term}.`,
            primary_keyword: seed.primaryKeyword,
            pillar_id: pillarId,
            status: 'draft',
          },
          { onConflict: 'slug' },
        ),
      );

      if (error) {
        throw new Error(`Failed to upsert cluster page '${seed.slug}': ${error.message}`);
      }

      await sleep(rateLimitMs);
    }

    const usedTrendIds = Array.from(new Set(selected.map((trend) => trend.id)));
    const { error: trendStatusError } = await withRetries('mark trends in_generation', () =>
      supabase.from('trends').update({ status: 'in_generation' }).in('id', usedTrendIds),
    );

    if (trendStatusError) {
      throw new Error(`Failed to update trend statuses: ${trendStatusError.message}`);
    }
  }

  if (isDryRun) {
    console.log('[batch-generate] dry-run: skipping content generation, quality gate, linker verify, and publish.');
    return;
  }

  runScript('scripts/content-generator.ts');
  runScript('scripts/quality-gate.ts');
  runScript('scripts/linker.ts', ['--verify']);

  if (shouldPublish) {
    runScript('scripts/deploy.ts');
  } else {
    console.log('[batch-generate] publish skipped (pass --publish or set BATCH_PUBLISH=1).');
  }

  console.log('[batch-generate] complete');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
