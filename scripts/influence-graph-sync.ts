import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { computeInfluenceScore, toInfluenceEdgeRow, toInfluenceNodeRow } from '@/lib/brand-operating-system';

config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function run() {
  const [creatorsResult, partnersResult, communitiesResult] = await Promise.all([
    supabase.from('creator_relationships').select('slug,name,primary_platform,audience_segment,relevance_score,relationship_stage,partnership_fit').limit(300),
    supabase.from('partner_contacts').select('slug,name,target_type,domain,primary_channel,audience_fit,priority,status').limit(300),
    supabase.from('community_topic_mentions').select('topic_slug,source_platform,title,mention_count,sentiment').limit(300),
  ]);

  const creators = creatorsResult.error?.message?.includes('creator_relationships') ? [] : (creatorsResult.data ?? []);
  const partners = partnersResult.error?.message?.includes('partner_contacts') ? [] : (partnersResult.data ?? []);
  const communities = communitiesResult.error?.message?.includes('community_topic_mentions') ? [] : (communitiesResult.data ?? []);

  const nodes = [
    ...creators.map((row: any) => {
      const relationship = ['active', 'responded'].includes(String(row.relationship_stage)) ? 82 : ['contacted', 'qualified'].includes(String(row.relationship_stage)) ? 60 : 38;
      const amplification = Number(row.relevance_score ?? 60);
      const influence = computeInfluenceScore({ relevance: Number(row.relevance_score ?? 60), relationship, amplification });
      return toInfluenceNodeRow({
        nodeKey: `creator:${row.slug}`,
        nodeType: 'creator',
        label: row.name,
        platform: row.primary_platform,
        audienceSegment: row.audience_segment,
        influenceScore: influence,
        relationshipScore: relationship,
        amplificationScore: amplification,
        metadata: { partnership_fit: row.partnership_fit ?? null },
      });
    }),
    ...partners.map((row: any) => {
      const relationship = String(row.status) === 'active' ? 72 : 40;
      const influence = computeInfluenceScore({ relevance: Number(row.priority ?? 60), relationship, amplification: Number(row.priority ?? 60) });
      return toInfluenceNodeRow({
        nodeKey: `partner:${row.slug}`,
        nodeType: row.target_type === 'press' ? 'publication' : row.target_type === 'community' ? 'community' : 'partner',
        label: row.name,
        domain: row.domain,
        platform: row.primary_channel,
        audienceSegment: null,
        influenceScore: influence,
        relationshipScore: relationship,
        amplificationScore: Number(row.priority ?? 60),
        metadata: { audience_fit: row.audience_fit ?? null },
      });
    }),
    ...communities.map((row: any) =>
      toInfluenceNodeRow({
        nodeKey: `community:${row.source_platform}:${row.topic_slug}`,
        nodeType: 'community',
        label: `${row.source_platform} ${row.topic_slug}`,
        platform: row.source_platform,
        audienceSegment: row.topic_slug,
        influenceScore: Math.min(95, 30 + Number(row.mention_count ?? 0) * 8),
        relationshipScore: 35,
        amplificationScore: Math.min(95, 35 + Number(row.mention_count ?? 0) * 6),
        metadata: { sentiment: row.sentiment ?? null, title: row.title ?? null },
      }),
    ),
  ];

  const edges = [
    ...creators.map((row: any) =>
      toInfluenceEdgeRow({
        sourceNodeKey: `creator:${row.slug}`,
        targetNodeKey: `channel:${row.primary_platform ?? 'unknown'}`,
        edgeType: 'distribution_fit',
        strengthScore: Number(row.relevance_score ?? 60),
        metadata: { audience_segment: row.audience_segment ?? null },
      }),
    ),
    ...partners.map((row: any) =>
      toInfluenceEdgeRow({
        sourceNodeKey: `partner:${row.slug}`,
        targetNodeKey: row.target_type === 'community' ? 'channel:reddit' : 'channel:email',
        edgeType: 'relationship',
        strengthScore: Number(row.priority ?? 60),
        metadata: { target_type: row.target_type },
      }),
    ),
  ];

  if (DRY_RUN) {
    console.log(`[influence-graph-sync] nodes=${nodes.length} edges=${edges.length} dryRun=true`);
    return;
  }

  const nodeWrite = await supabase.from('influence_graph_nodes').upsert(nodes, { onConflict: 'node_key' });
  if (nodeWrite.error?.message?.includes('influence_graph_nodes')) {
    console.log('[influence-graph-sync] influence_graph_nodes missing - skipping persistence.');
    return;
  }
  if (nodeWrite.error) throw nodeWrite.error;

  const edgeWrite = await supabase.from('influence_graph_edges').upsert(edges, {
    onConflict: 'source_node_key,target_node_key,edge_type',
  } as never);
  if (edgeWrite.error?.message?.includes('influence_graph_edges')) {
    console.log('[influence-graph-sync] influence_graph_edges missing - skipping edge persistence.');
    return;
  }
  if (edgeWrite.error) throw edgeWrite.error;

  console.log(`[influence-graph-sync] nodes=${nodes.length} edges=${edges.length} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
