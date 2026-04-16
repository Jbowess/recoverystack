import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { submitUrlToGoogle } from '@/lib/indexing-api';
import { postToTwitter, postToLinkedIn } from '@/lib/social-distribution';

config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const isDryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function insertDeployEvent(payload: { status: 'ok' | 'error'; detail: string }) {
  try {
    const { error } = await supabase.from('deploy_events').insert(payload);
    if (error) {
      console.warn(`[telemetry] deploy_events insert failed: ${error.message}`);
    }
  } catch (error) {
    console.warn('[telemetry] deploy_events insert failed', error);
  }
}

async function revalidateSlug(slug: string, template: string) {
  const site = process.env.SITE_URL ?? 'http://localhost:3000';
  const secret = process.env.REVALIDATE_SECRET ?? 'dry-run-secret';

  const url = `${site}/api/revalidate`;

  if (isDryRun) {
    console.log(`[dry-run] Would revalidate: ${url} (slug=${slug}, template=${template})`);
    return;
  }

  if (!process.env.REVALIDATE_SECRET) throw new Error('Missing REVALIDATE_SECRET');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ slug, template }),
  });
  if (!res.ok) throw new Error(`Revalidate failed ${res.status}: ${await res.text()}`);
}

const DEPLOY_BATCH_SIZE = Number(process.env.DEPLOY_BATCH_SIZE ?? 5);
const DEPLOY_BATCH_DELAY_MS = Number(process.env.DEPLOY_BATCH_DELAY_MS ?? 30_000); // 30s between batches
const DEPLOY_PAGE_DELAY_MS = Number(process.env.DEPLOY_PAGE_DELAY_MS ?? 2_000);    // 2s between pages

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  const { data: changed } = await supabase
    .from('pages')
    .select('id,slug,template,title,status,updated_at,published_at,needs_revalidation')
    .eq('status', 'published')
    .eq('needs_revalidation', true)
    .order('published_at', { ascending: true, nullsFirst: false })
    .order('updated_at', { ascending: true })
    .limit(50);

  const pages = changed ?? [];
  if (pages.length === 0) {
    console.log('No pages to deploy.');
    return;
  }

  // Deploy in staggered batches to avoid link velocity spikes
  let deployed = 0;
  for (let i = 0; i < pages.length; i += DEPLOY_BATCH_SIZE) {
    const batch = pages.slice(i, i + DEPLOY_BATCH_SIZE);

    for (const page of batch) {
      try {
        await revalidateSlug(page.slug, page.template);
        if (!isDryRun) {
          const { error: deployUpdateError } = await supabase
            .from('pages')
            .update({ needs_revalidation: false, last_deployed_at: new Date().toISOString() })
            .eq('id', page.id);

          if (deployUpdateError) {
            throw deployUpdateError;
          }
        }
        deployed++;
        console.log(`[${deployed}/${pages.length}] Revalidated ${page.template}/${page.slug}`);
      } catch (err) {
        console.error(`Failed to revalidate ${page.slug}:`, err);
      }
      // Small delay between individual pages
      if (!isDryRun && DEPLOY_PAGE_DELAY_MS > 0) {
        await sleep(DEPLOY_PAGE_DELAY_MS);
      }
    }

    // Longer delay between batches (skip after last batch)
    if (!isDryRun && i + DEPLOY_BATCH_SIZE < pages.length && DEPLOY_BATCH_DELAY_MS > 0) {
      console.log(`Waiting ${DEPLOY_BATCH_DELAY_MS / 1000}s before next batch...`);
      await sleep(DEPLOY_BATCH_DELAY_MS);
    }
  }

  if (!isDryRun && deployed > 0) {
    const site = process.env.SITE_URL ?? 'https://www.recoverystack.io';
    const rows = pages.slice(0, deployed).map((p) => ({
      page_id: p.id,
      slug: p.slug,
      template: p.template,
      title: p.title ?? null,
      url: `${site}/${p.template}/${p.slug}`,
      published_at: p.published_at ?? p.updated_at,
      source: 'pipeline',
    }));

    const { error: feedError } = await supabase
      .from('published_links_feed')
      .upsert(rows, { onConflict: 'slug' });

    if (feedError) {
      console.warn(`[telemetry] published_links_feed upsert failed: ${feedError.message}`);
    }

    // Submit each published URL to Google Indexing API for immediate crawling
    // For first-time publishes (published_at within last 2 hours), also post to social
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    for (const row of rows) {
      await submitUrlToGoogle(row.url);

      const isNew = row.published_at && row.published_at >= twoHoursAgo;
      if (isNew) {
        const page = pages.find((p) => p.slug === row.slug);
        await postToTwitter(row.title ?? '', row.url, page?.template ?? 'guides');
        await postToLinkedIn(row.title ?? '', row.url, '');
      }
    }
  }

  const detail = `revalidated=${deployed}${isDryRun ? ' (dry-run)' : ''}`;

  if (!isDryRun) {
    await insertDeployEvent({ status: 'ok', detail });
  }

  console.log(`${isDryRun ? '[dry-run] ' : ''}Deployed ${deployed} pages in staggered batches`);
}

run().catch(async (e) => {
  if (!isDryRun) {
    await insertDeployEvent({ status: 'error', detail: String(e) });
  }
  console.error(e);
  process.exit(1);
});
