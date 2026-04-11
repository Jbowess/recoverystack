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

  const url = `${site}/api/revalidate?slug=${encodeURIComponent(slug)}&template=${encodeURIComponent(template)}&secret=${encodeURIComponent(secret)}`;

  if (isDryRun) {
    console.log(`[dry-run] Would revalidate: ${url}`);
    return;
  }

  if (!process.env.REVALIDATE_SECRET) throw new Error('Missing REVALIDATE_SECRET');

  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`Revalidate failed ${res.status}: ${await res.text()}`);
}

async function run() {
  const { data: changed } = await supabase
    .from('pages')
    .select('slug,template,status,updated_at')
    .eq('status', 'published')
    .order('updated_at', { ascending: false })
    .limit(20);

  for (const page of changed ?? []) {
    await revalidateSlug(page.slug, page.template);
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
