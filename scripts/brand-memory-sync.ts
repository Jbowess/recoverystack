import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { toBrandMemoryRow } from '@/lib/brand-operating-system';

config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function run() {
  const [pagesResult, assetsResult, creatorsResult] = await Promise.all([
    supabase.from('pages').select('slug,title,body_json,metadata,updated_at').eq('status', 'published').limit(200),
    supabase.from('distribution_assets').select('page_slug,channel,hook,payload,updated_at').limit(400),
    supabase.from('creator_relationships').select('slug,name,partnership_fit,audience_segment,relevance_score,updated_at').limit(150),
  ]);

  if (pagesResult.error) throw pagesResult.error;
  const pages = pagesResult.data ?? [];
  const assets = assetsResult.error?.message?.includes('distribution_assets') ? [] : (assetsResult.data ?? []);
  const creators = creatorsResult.error?.message?.includes('creator_relationships') ? [] : (creatorsResult.data ?? []);

  const rows = [
    ...pages.flatMap((page: any) => {
      const verdict = Array.isArray(page.body_json?.verdict) ? page.body_json.verdict : [];
      const claim = Array.isArray(page.body_json?.key_takeaways) && page.body_json.key_takeaways[0]
        ? page.body_json.key_takeaways[0]
        : page.title;
      const objection = verdict.find((line: string) => /^avoid if:/i.test(line)) ?? page.metadata?.strongest_objection ?? null;
      return [
        toBrandMemoryRow({
          sourceType: 'page',
          sourceKey: page.slug,
          title: page.title,
          body: claim,
          memoryType: 'claim',
          tags: ['page', 'published'],
          priority: 76,
          freshnessScore: 80,
        }),
        objection ? toBrandMemoryRow({
          sourceType: 'page',
          sourceKey: page.slug,
          title: `${page.title} objection`,
          body: String(objection),
          memoryType: 'objection',
          tags: ['page', 'buyer_objection'],
          priority: 72,
          freshnessScore: 75,
        }) : null,
      ].filter(Boolean);
    }),
    ...assets.slice(0, 250).map((asset: any) =>
      toBrandMemoryRow({
        sourceType: 'distribution_asset',
        sourceKey: `${asset.page_slug}:${asset.channel}`,
        title: asset.hook ?? asset.page_slug,
        body: String(asset.hook ?? asset.payload?.strongest_claim ?? asset.page_slug),
        memoryType: 'hook',
        tags: [asset.channel, String(asset.payload?.hook_pattern ?? 'hook')],
        priority: Number(asset.payload?.reach_score ?? 64),
        confidenceScore: Number(asset.payload?.originality_score ?? 60),
        freshnessScore: 72,
        metadata: asset.payload ?? {},
      }),
    ),
    ...creators.map((creator: any) =>
      toBrandMemoryRow({
        sourceType: 'creator_relationship',
        sourceKey: creator.slug,
        title: creator.name,
        body: String(creator.partnership_fit ?? creator.name),
        memoryType: 'relationship',
        tags: ['creator', String(creator.audience_segment ?? 'general')],
        priority: Number(creator.relevance_score ?? 70),
        confidenceScore: 80,
        freshnessScore: 70,
      }),
    ),
  ].filter(Boolean) as any[];

  if (DRY_RUN) {
    console.log(`[brand-memory-sync] rows=${rows.length} dryRun=true`);
    return;
  }

  const { error } = await supabase.from('brand_memory_entries').upsert(rows, { onConflict: 'memory_key' });
  if (error?.message?.includes('brand_memory_entries')) {
    console.log('[brand-memory-sync] brand_memory_entries missing - skipping persistence.');
    return;
  }
  if (error) throw error;
  console.log(`[brand-memory-sync] rows=${rows.length} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
