import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

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

async function run() {
  const { data: changed } = await supabase
    .from('pages')
    .select('id,slug,template,title,status,updated_at,published_at')
    .eq('status', 'published')
    .order('updated_at', { ascending: false })
    .limit(20);

  for (const page of changed ?? []) {
    await revalidateSlug(page.slug, page.template);
  }

  if (!isDryRun && (changed?.length ?? 0) > 0) {
    const site = process.env.SITE_URL ?? 'https://www.recoverystack.io';
    const rows = (changed ?? []).map((p) => ({
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
  }

  const detail = `revalidated=${(changed ?? []).length}${isDryRun ? ' (dry-run)' : ''}`;

  if (!isDryRun) {
    await insertDeployEvent({ status: 'ok', detail });
  }

  console.log(`${isDryRun ? '[dry-run] ' : ''}Revalidated ${(changed ?? []).length} pages`);
}

run().catch(async (e) => {
  if (!isDryRun) {
    await insertDeployEvent({ status: 'error', detail: String(e) });
  }
  console.error(e);
  process.exit(1);
});
