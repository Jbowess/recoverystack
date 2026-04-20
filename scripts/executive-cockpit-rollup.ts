import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { buildExecutiveCockpit, computeRiskScore } from '@/lib/brand-operating-system';

config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function run() {
  const today = new Date().toISOString().slice(0, 10);
  const [
    shareResult,
    influenceResult,
    attributionResult,
    moatResult,
    riskResult,
    narrativeResult,
  ] = await Promise.all([
    supabase.from('share_of_voice_snapshots').select('visibility_score,engagement_score,conversion_score,authority_score').eq('snapshot_date', today).limit(500),
    supabase.from('influence_graph_nodes').select('influence_score,relationship_score,amplification_score').limit(500),
    supabase.from('executive_attribution_rollups').select('content_influence_score,creator_influence_score,first_touch_revenue_usd,assisted_revenue_usd').eq('snapshot_date', today).limit(100),
    supabase.from('brand_moat_snapshots').select('moat_score').eq('snapshot_date', today).maybeSingle(),
    supabase.from('brand_risk_alerts').select('severity').eq('status', 'open').limit(500),
    supabase.from('narrative_control_centers').select('status').eq('status', 'active').limit(50),
  ]);

  const shareRows = shareResult.error?.message?.includes('share_of_voice_snapshots') ? [] : (shareResult.data ?? []);
  const influenceRows = influenceResult.error?.message?.includes('influence_graph_nodes') ? [] : (influenceResult.data ?? []);
  const attributionRows = attributionResult.error?.message?.includes('executive_attribution_rollups') ? [] : (attributionResult.data ?? []);
  const riskRows = riskResult.error?.message?.includes('brand_risk_alerts') ? [] : (riskResult.data ?? []);

  const shareScore = shareRows.length
    ? Math.round(shareRows.reduce((sum: number, row: any) => sum + Number(row.visibility_score ?? 0) + Number(row.engagement_score ?? 0) + Number(row.conversion_score ?? 0), 0) / (shareRows.length * 3))
    : 0;
  const influenceScore = influenceRows.length
    ? Math.round(influenceRows.reduce((sum: number, row: any) => sum + Number(row.influence_score ?? 0), 0) / influenceRows.length)
    : 0;
  const attributionScore = attributionRows.length
    ? Math.round(attributionRows.reduce((sum: number, row: any) => sum + Number(row.content_influence_score ?? 0) + Number(row.creator_influence_score ?? 0), 0) / (attributionRows.length * 2))
    : 0;
  const moatScore = Number((moatResult.data as any)?.moat_score ?? 0);
  const riskScore = computeRiskScore((riskRows as any[]).map((row) => ({ severity: row.severity })));
  const narrativeAlignmentScore = (narrativeResult.data ?? []).length > 0 ? 82 : 40;
  const brandScore = Math.round((shareScore + influenceScore + attributionScore + moatScore + narrativeAlignmentScore) / 5);

  const payload = buildExecutiveCockpit({
    brandScore,
    narrativeAlignmentScore,
    shareOfVoiceScore: shareScore,
    influenceScore,
    attributionScore,
    moatScore,
    riskScore,
    metadata: {
      open_risks: riskRows.length,
      active_narratives: (narrativeResult.data ?? []).length,
    },
  });

  if (DRY_RUN) {
    console.log(`[executive-cockpit-rollup] ${JSON.stringify(payload)}`);
    return;
  }

  const { error } = await supabase.from('executive_cockpit_snapshots').upsert(payload, { onConflict: 'snapshot_date' });
  if (error?.message?.includes('executive_cockpit_snapshots')) {
    console.log('[executive-cockpit-rollup] executive_cockpit_snapshots missing - skipping persistence.');
    return;
  }
  if (error) throw error;
  console.log(`[executive-cockpit-rollup] brand_score=${payload.brand_score} risk_score=${payload.risk_score}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
