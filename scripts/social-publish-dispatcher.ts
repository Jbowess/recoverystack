import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const LIMIT = Number(process.env.SOCIAL_PUBLISH_DISPATCH_LIMIT ?? 25);

const WEBHOOKS: Record<string, string | undefined> = {
  x: process.env.X_PUBLISH_WEBHOOK_URL,
  linkedin: process.env.LINKEDIN_PUBLISH_WEBHOOK_URL,
  instagram: process.env.INSTAGRAM_PUBLISH_WEBHOOK_URL,
  facebook: process.env.FACEBOOK_PUBLISH_WEBHOOK_URL,
  reddit: process.env.REDDIT_PUBLISH_WEBHOOK_URL,
  newsletter: process.env.NEWSLETTER_PUBLISH_WEBHOOK_URL,
  short_video: process.env.SHORT_VIDEO_PUBLISH_WEBHOOK_URL,
};

async function run() {
  const { data, error } = await supabase
    .from('channel_publication_queue')
    .select('id,page_slug,channel,body,asset_title,link_url,platform_payload,publish_status')
    .in('publish_status', ['approved', 'scheduled'])
    .order('publish_priority', { ascending: false })
    .limit(LIMIT);

  if (error?.message?.includes('channel_publication_queue')) {
    console.log('[social-publish-dispatcher] channel_publication_queue missing - skipping until migration is applied.');
    return;
  }
  if (error) throw error;
  const rows = data ?? [];
  let dispatched = 0;

  for (const row of rows as Array<any>) {
    const webhook = WEBHOOKS[row.channel];
    if (!webhook) continue;

    dispatched += 1;
    if (DRY_RUN) {
      console.log(`[social-publish-dispatcher] ${row.page_slug} -> ${row.channel}`);
      continue;
    }

    try {
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: row.id,
          page_slug: row.page_slug,
          channel: row.channel,
          title: row.asset_title,
          body: row.body,
          link_url: row.link_url,
          payload: row.platform_payload ?? {},
        }),
      });

      if (!res.ok) {
        await supabase.from('channel_publication_queue').update({
          publish_status: 'failed',
          last_error: `Webhook ${res.status}`,
          updated_at: new Date().toISOString(),
        }).eq('id', row.id);
        continue;
      }

      const payload = await res.json().catch(() => ({}));
      await supabase.from('channel_publication_queue').update({
        publish_status: 'posted',
        published_at: new Date().toISOString(),
        external_post_id: typeof payload.post_id === 'string' ? payload.post_id : null,
        updated_at: new Date().toISOString(),
      }).eq('id', row.id);
    } catch (error) {
      await supabase.from('channel_publication_queue').update({
        publish_status: 'failed',
        last_error: error instanceof Error ? error.message : String(error),
        updated_at: new Date().toISOString(),
      }).eq('id', row.id);
    }
  }

  console.log(`[social-publish-dispatcher] rows=${rows.length} dispatched=${dispatched} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
