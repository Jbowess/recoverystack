import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { SMART_RING_COMMERCIAL_CLUSTER } from '@/lib/growth-engine';
import { buildClusterName, normalizeKeyword, pageTemplateToQueueTemplateId, toLegacyCompatibleQueueTemplateId } from '@/lib/seo-keywords';
import type { TemplateType } from '@/lib/types';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function supportsNormalizedKeyword() {
  const result = await supabase.from('keyword_queue').select('normalized_keyword').limit(1);
  return !result.error;
}

async function run() {
  const hasNormalizedKeyword = await supportsNormalizedKeyword();
  let roadmapTableAvailable = true;
  let roadmapWrites = 0;
  let queueWrites = 0;

  for (const item of SMART_RING_COMMERCIAL_CLUSTER) {
    const roadmapRow = {
      slug: item.slug,
      title: item.title,
      primary_keyword: item.primaryKeyword,
      template: item.template,
      intent: item.intent,
      funnel_stage: item.funnelStage,
      cluster_name: item.clusterName,
      status: 'planned',
      priority: item.priority,
      target_month: new Date().toISOString().slice(0, 7),
      notes: item.notes,
      metadata: item.metadata ?? {},
      updated_at: new Date().toISOString(),
    };

    roadmapWrites += 1;
    if (!DRY_RUN && roadmapTableAvailable) {
      const { error } = await supabase.from('growth_roadmap_items').upsert(roadmapRow, { onConflict: 'slug' });
      if (error) {
        if (error.message.includes('growth_roadmap_items')) {
          roadmapTableAvailable = false;
          console.warn('[smart-ring-roadmap-sync] growth_roadmap_items missing - continuing with keyword queue only.');
        } else {
          console.warn(`[smart-ring-roadmap-sync] roadmap ${item.slug}: ${error.message}`);
        }
      }
    }

    const queueRow = {
      cluster_name: buildClusterName(item.primaryKeyword),
      intent: item.intent,
      primary_keyword: item.primaryKeyword,
      template_id: toLegacyCompatibleQueueTemplateId(pageTemplateToQueueTemplateId(item.template as TemplateType)),
      priority: item.priority,
      source: 'trend',
      status: 'new',
      score: Math.min(0.99, item.priority / 100),
      metadata: {
        ...(item.metadata ?? {}),
        roadmap_slug: item.slug,
        roadmap_cluster: item.clusterName,
        funnel_stage: item.funnelStage,
        target_title: item.title,
        queue_source_detail: 'smart_ring_roadmap',
      },
      ...(hasNormalizedKeyword ? { normalized_keyword: normalizeKeyword(item.primaryKeyword) } : {}),
    };

    queueWrites += 1;
    if (DRY_RUN) {
      console.log(`[smart-ring-roadmap-sync] ${item.slug} -> ${queueRow.primary_keyword}`);
      continue;
    }

    const { error } = await supabase.from('keyword_queue').upsert(queueRow, {
      onConflict: 'cluster_name,primary_keyword',
    });

    if (error) {
      console.warn(`[smart-ring-roadmap-sync] queue ${item.slug}: ${error.message}`);
    }
  }

  console.log(`[smart-ring-roadmap-sync] roadmap=${roadmapWrites} queue=${queueWrites} roadmapTable=${roadmapTableAvailable} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
