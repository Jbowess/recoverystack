import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { buildAndPersistRepurposingPacket, type RepurposingPacket } from '@/lib/repurposing-intelligence';
import type { DistributionPageInput } from '@/lib/distribution-engine';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const LIMIT = Number(process.env.REPURPOSING_PACKET_LIMIT ?? 40);
const targetSlugArg = process.argv.find((arg) => arg.startsWith('--slug='));
const targetSlug = targetSlugArg ? targetSlugArg.split('=').slice(1).join('=').trim() : '';

async function loadPages() {
  let query = supabase
    .from('pages')
    .select('id,slug,template,title,meta_description,intro,primary_keyword,body_json,metadata,published_at')
    .in('status', ['published', 'approved'])
    .order('published_at', { ascending: false })
    .limit(LIMIT);

  if (targetSlug) query = query.eq('slug', targetSlug);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as DistributionPageInput[];
}

function printDryRun(page: DistributionPageInput, packet: RepurposingPacket) {
  console.log(`[repurposing-packet-generator] ${page.slug} atoms=${packet.atoms.length} hooks=${packet.hooks.length} assets=${packet.assets.length} promoted=${packet.assets.filter((asset) => asset.promoted).length}`);
}

async function run() {
  const pages = await loadPages();
  let generated = 0;

  for (const page of pages) {
    if (DRY_RUN) {
      const { buildRepurposingPacket, loadRecentAssetPeers } = await import('@/lib/repurposing-intelligence');
      const peers = await loadRecentAssetPeers(supabase);
      const packet = buildRepurposingPacket(page, peers);
      printDryRun(page, packet);
      generated += 1;
      continue;
    }

    const packet = await buildAndPersistRepurposingPacket(supabase as any, page);
    console.log(
      `[repurposing-packet-generator] ${page.slug} atoms=${packet.atoms.length} hooks=${packet.hooks.length} promoted=${packet.assets.filter((asset) => asset.promoted).length}`,
    );
    generated += 1;
  }

  console.log(`[repurposing-packet-generator] pages=${generated} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
