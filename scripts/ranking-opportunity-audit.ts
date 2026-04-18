import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function run() {
  const since = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10);
  const [metrics, pages] = await Promise.all([
    supabase.from('page_metrics_daily').select('page_slug,clicks,impressions,position').gte('date', since).limit(5000),
    supabase.from('pages').select('slug,title,template,primary_keyword').eq('status', 'published').limit(1000),
  ]);

  if (metrics.error?.message?.includes('page_metrics_daily')) {
    console.log('[ranking-opportunity-audit] page_metrics_daily missing - skipping.');
    return;
  }
  if (metrics.error) throw metrics.error;
  if (pages.error) throw pages.error;

  const pageMap = new Map((pages.data ?? []).map((row: any) => [row.slug, row]));
  const agg = new Map<string, { clicks: number; impressions: number; pos: number; n: number }>();

  for (const row of (metrics.data ?? []) as Array<any>) {
    const item = agg.get(row.page_slug) ?? { clicks: 0, impressions: 0, pos: 0, n: 0 };
    item.clicks += Number(row.clicks ?? 0);
    item.impressions += Number(row.impressions ?? 0);
    item.pos += Number(row.position ?? 0);
    item.n += 1;
    agg.set(row.page_slug, item);
  }

  const stuck = [...agg.entries()]
    .map(([slug, row]) => ({
      slug,
      ctr: row.impressions ? row.clicks / row.impressions : 0,
      avgPosition: row.n ? row.pos / row.n : 99,
      impressions: row.impressions,
      page: pageMap.get(slug),
    }))
    .filter((row) => row.avgPosition >= 4 && row.avgPosition <= 15 && row.impressions >= 50)
    .sort((a, b) => a.avgPosition - b.avgPosition || b.impressions - a.impressions)
    .slice(0, 25);

  console.log(`[ranking-opportunity-audit] stuck opportunities=${stuck.length}`);
  for (const row of stuck) {
    console.log(`- ${row.slug} | pos=${row.avgPosition.toFixed(1)} ctr=${(row.ctr * 100).toFixed(2)}% imp=${row.impressions} | ${row.page?.primary_keyword ?? ''}`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
