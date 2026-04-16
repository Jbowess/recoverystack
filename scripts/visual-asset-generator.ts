import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { generateSupportingVisual } from '@/lib/image-generator';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const LIMIT = Number(process.env.VISUAL_ASSET_GENERATOR_LIMIT ?? 12);

async function run() {
  if (!process.env.OPENAI_API_KEY) {
    console.log('[visual-asset-generator] OPENAI_API_KEY not set; skipping visual generation.');
    return;
  }

  const { data: assets, error } = await supabase
    .from('page_visual_assets')
    .select('id,page_id,page_slug,asset_kind,metadata')
    .eq('status', 'planned')
    .neq('asset_kind', 'hero')
    .order('created_at', { ascending: true })
    .limit(LIMIT);

  if (error) throw error;
  if (!assets || assets.length === 0) {
    console.log('[visual-asset-generator] no planned supporting visuals found');
    return;
  }

  const pageIds = Array.from(new Set(assets.map((asset) => asset.page_id)));
  const { data: pages } = await supabase
    .from('pages')
    .select('id,slug,template,metadata')
    .in('id', pageIds);

  const pageMap = new Map((pages ?? []).map((page: any) => [page.id, page]));
  let completed = 0;

  for (const asset of assets as Array<{ id: string; page_id: string; page_slug: string; asset_kind: string; metadata: Record<string, unknown> | null }>) {
    const page = pageMap.get(asset.page_id);
    if (!page) continue;

    const promptHint = typeof asset.metadata?.prompt_hint === 'string'
      ? asset.metadata.prompt_hint
      : `${page.slug} ${asset.asset_kind} visual`;
    const imageUrl = await generateSupportingVisual(page.template, page.slug, promptHint, asset.asset_kind);
    if (!imageUrl) continue;

    await supabase
      .from('page_visual_assets')
      .update({
        image_url: imageUrl,
        alt_text: typeof asset.metadata?.alt_text === 'string' ? asset.metadata.alt_text : `${page.slug} ${asset.asset_kind} visual`,
        width: 1792,
        height: 1024,
        status: 'ready',
        metadata: { ...(asset.metadata ?? {}), generated_by: 'visual-asset-generator' },
      })
      .eq('id', asset.id);

    completed += 1;
  }

  console.log(`[visual-asset-generator] generated ${completed} supporting visual(s)`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
