import Link from 'next/link';
import { getMigrationReadinessReport } from '@/lib/migration-readiness';
import { supabaseAdmin } from '@/lib/supabase-admin';

function parseMessage(params: Record<string, string | string[] | undefined>) {
  const ok = typeof params.ok === 'string' ? params.ok : '';
  const error = typeof params.error === 'string' ? params.error : '';
  const detail = typeof params.detail === 'string' ? params.detail : '';

  const okMessages: Record<string, string> = {
    trend_approved: 'Trend approved and review draft created.',
    draft_published: 'Page published successfully.',
    pipeline_started: 'Daily pipeline started in the background.',
    refresh_approved: 'Refresh item approved for regeneration.',
    refresh_rejectd: 'Refresh item rejected.',
    refresh_deferd: 'Refresh item deferred.',
    page_regenerated: 'Page regenerated and revalidated.',
    component_library_reseeded: 'Component library reseed completed safely (idempotent upsert).',
    keyword_queue_seeded: 'Top trends were queued into keyword_queue.',
  };

  const errorMessages: Record<string, string> = {
    invalid_action: 'Invalid action.',
    not_draft: 'Only review-ready pages can be published.',
    trend_not_found: 'Trend not found.',
    refresh_item_not_found: 'Refresh queue item not found.',
    page_not_found: 'Page not found.',
    publish_validation_failed: 'Publish blocked by validation guards.',
    pipeline_start_failed: 'Could not start daily pipeline.',
    page_regenerate_failed: 'Could not regenerate selected page.',
    component_library_reseed_failed: 'Could not reseed component library.',
    keyword_queue_seed_failed: 'Could not queue top trends.',
  };

  return {
    ok: okMessages[ok] ?? '',
    error: errorMessages[error] ?? '',
    details: detail
      ? detail
          .split(';')
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
  };
}

function formatDateTime(value?: string | null) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-AU', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function getStatusColor(status?: string | null) {
  if (!status) return '#6b7280';
  const normalized = status.toLowerCase();
  if (normalized === 'ok' || normalized === 'succeeded') return '#166534';
  if (normalized === 'error' || normalized === 'failed') return '#b91c1c';
  if (normalized === 'running') return '#92400e';
  return '#374151';
}

function countBy(rows: any[], key: string) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const value = String(row?.[key] ?? 'unknown').trim() || 'unknown';
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function numericSummary(rows: any[]) {
  if (!rows.length) return { rowCount: 0, numericFields: {} as Record<string, { min: number; max: number; avg: number }> };

  const buckets = new Map<string, number[]>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row ?? {})) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        const list = buckets.get(key) ?? [];
        list.push(value);
        buckets.set(key, list);
      }
    }
  }

  const numericFields: Record<string, { min: number; max: number; avg: number }> = {};
  for (const [key, list] of buckets.entries()) {
    if (!list.length) continue;
    const min = Math.min(...list);
    const max = Math.max(...list);
    const avg = list.reduce((sum, n) => sum + n, 0) / list.length;
    numericFields[key] = { min, max, avg: Number(avg.toFixed(3)) };
  }

  return {
    rowCount: rows.length,
    numericFields,
  };
}

function topWeightedByCluster(rows: any[]) {
  const grouped = new Map<string, Array<{ name: string; weight: number }>>();

  for (const row of rows) {
    const cluster = String(row?.cluster ?? 'unknown').trim() || 'unknown';
    const name = String(row?.name ?? '').trim();
    const weight = Number(row?.weight ?? 0);
    if (!name || !Number.isFinite(weight)) continue;

    const current = grouped.get(cluster) ?? [];
    current.push({ name, weight });
    grouped.set(cluster, current);
  }

  return Object.fromEntries(
    [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cluster, items]) => [cluster, items.sort((a, b) => b.weight - a.weight).slice(0, 3)]),
  );
}

async function safeSelect(table: string, columns: string, limit = 1000) {
  const response = await supabaseAdmin.from(table).select(columns).limit(limit);
  if (response.error) {
    return { data: [], error: response.error.message };
  }
  return { data: response.data ?? [], error: null as string | null };
}

async function getDashboardData() {
  const [
    { data: newTrends },
    { data: reviewQueue },
    { data: published },
    { data: counts },
    { data: deploys },
    { data: pipelineRuns },
    { data: successfulPipelineRuns },
    { data: refreshQueue },
    { count: trendCount },
    { count: reviewCount },
    { count: publishedCount },
    { count: refreshQueueCount },
    migrationReadiness,
    componentLibraryRows,
    originalityPageRows,
    performanceFingerprintRows,
    keywordQueueRows,
    clusterMetricsRows,
    distributionAssetRows,
    outreachQueueRows,
    emailDigestRows,
    distributionMetricRows,
    partnerContactRows,
    publicationQueueRows,
    socialMetricRows,
    trustProfileRows,
    roadmapRows,
    productTruthRows,
    audienceSegmentRows,
    brandVoiceRows,
    automationPolicyRows,
    leadMagnetRows,
    creatorRelationshipRows,
    serpSnapshotRows,
    brandMemoryRows,
    narrativeRows,
    shareOfVoiceRows,
    influenceNodeRows,
    campaignRows,
    executiveAttributionRows,
    moatRows,
    riskRows,
    cockpitRows,
    newsroomFeedRows,
    newsroomEventRows,
    newsroomEntityRows,
    newsroomStorylineRows,
    llmScoreRows,
    llmObservationRows,
    llmEntityRows,
    llmQueryRows,
    llmReferralRows,
    conversionEventRows,
    crawlerLogRows,
    promptCorpusRows,
    shareSnapshotRows,
    commercialAuditRows,
    researchDatasetRows,
    toolUsageRows,
  ] = await Promise.all([
    supabaseAdmin.from('trends').select('*').eq('status', 'new').order('created_at', { ascending: false }).limit(100),
    supabaseAdmin.from('pages').select('id,slug,title,template,status,updated_at,originality_score,originality_status').in('status', ['draft', 'approved']).order('updated_at', { ascending: false }).limit(100),
    supabaseAdmin.from('pages').select('id,slug,title,template,published_at,originality_score,originality_status,llm_readiness_score,llm_readiness_status,commercial_readiness_score,commercial_readiness_status').eq('status', 'published').order('published_at', { ascending: false }).limit(100),
    supabaseAdmin.from('pages').select('template').neq('template', ''),
    supabaseAdmin.from('deploy_events').select('created_at,status,detail').order('created_at', { ascending: false }).limit(1),
    supabaseAdmin.from('pipeline_runs').select('id,pipeline_name,status,started_at,finished_at,duration_ms,error_message').order('started_at', { ascending: false }).limit(1),
    supabaseAdmin
      .from('pipeline_runs')
      .select('finished_at,status,pipeline_name')
      .eq('status', 'succeeded')
      .not('finished_at', 'is', null)
      .order('finished_at', { ascending: false })
      .limit(1),
    supabaseAdmin
      .from('content_refresh_queue')
      .select('id,page_id,slug,reason,status,queued_at,processed_at,stale_days,low_traffic')
      .eq('status', 'queued')
      .order('queued_at', { ascending: false })
      .limit(100),
    supabaseAdmin.from('trends').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    supabaseAdmin.from('pages').select('id', { count: 'exact', head: true }).in('status', ['draft', 'approved']),
    supabaseAdmin.from('pages').select('id', { count: 'exact', head: true }).eq('status', 'published'),
    supabaseAdmin.from('content_refresh_queue').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
    getMigrationReadinessReport(),
    safeSelect('component_library', 'cluster,name,weight,active'),
    safeSelect('pages', 'originality_status,originality_score,status', 400),
    safeSelect('performance_fingerprints', 'template,top_performer_count,avg_word_count,avg_faq_count,best_ctr_word_range,computed_at'),
    safeSelect('keyword_queue', 'status,source'),
    safeSelect('cluster_metrics', '*', 300),
    safeSelect('distribution_assets', 'channel,status,asset_type'),
    safeSelect('outreach_queue', 'channel,status,target_type'),
    safeSelect('email_digest_issues', 'status'),
    safeSelect('distribution_asset_metrics', 'impressions,clicks,engagements,conversions'),
    safeSelect('partner_contacts', 'target_type,status,priority'),
    safeSelect('channel_publication_queue', 'channel,publish_status,publish_priority'),
    safeSelect('social_channel_metrics', 'channel,impressions,clicks,engagements,conversions,revenue_usd'),
    safeSelect('editorial_trust_profiles', 'profile_type,status'),
    safeSelect('growth_roadmap_items', 'template,status,funnel_stage,priority'),
    safeSelect('product_truth_cards', 'product_slug,card_type,status,priority'),
    safeSelect('audience_segments', 'slug,label'),
    safeSelect('brand_voice_profiles', 'slug,status'),
    safeSelect('automation_policies', 'policy_key,enabled,severity'),
    safeSelect('lead_magnet_offers', 'slug,status,target_segment'),
    safeSelect('creator_relationships', 'relationship_stage,primary_platform'),
    safeSelect('serp_snapshot_history', 'source'),
    safeSelect('brand_memory_entries', 'memory_type,priority'),
    safeSelect('narrative_control_centers', 'narrative_type,status'),
    safeSelect('share_of_voice_snapshots', 'channel,visibility_score,engagement_score,conversion_score,authority_score'),
    safeSelect('influence_graph_nodes', 'node_type,influence_score,relationship_score'),
    safeSelect('campaign_portfolios', 'status,expected_reach,actual_reach,actual_conversions'),
    safeSelect('executive_attribution_rollups', 'channel,content_influence_score,creator_influence_score,first_touch_revenue_usd,assisted_revenue_usd'),
    safeSelect('brand_moat_snapshots', 'moat_score'),
    safeSelect('brand_risk_alerts', 'risk_type,severity,status'),
    safeSelect('executive_cockpit_snapshots', 'brand_score,narrative_alignment_score,share_of_voice_score,influence_score,attribution_score,moat_score,risk_score'),
    safeSelect('news_source_feeds', 'beat,active'),
    safeSelect('news_source_events', 'status,event_type,beat'),
    safeSelect('topic_entities', 'entity_type,beat,authority_score'),
    safeSelect('storylines', 'status,beat,freshness_score,authority_score'),
    safeSelect('page_llm_scores', 'page_slug,total_score,readiness_status'),
    safeSelect('page_llm_observations', 'observation_type,severity,status'),
    safeSelect('page_entities', 'entity_type,is_primary'),
    safeSelect('llm_query_simulations', 'channel,confidence_score,result_status'),
    safeSelect('llm_referral_events', 'source,slug'),
    safeSelect('conversion_events', 'discovery_source'),
    safeSelect('crawler_activity_logs', 'bot_family,request_path'),
    safeSelect('llm_prompt_corpus', 'channel,intent,status,priority'),
    safeSelect('llm_recommendation_share_snapshots', 'channel,entity_key,recommendation_count,citation_count,avg_confidence'),
    safeSelect('commercial_page_audits', 'page_slug,readiness_status,completeness_score'),
    safeSelect('comparison_dataset_snapshots', 'dataset_key,row_count,snapshot_date'),
    safeSelect('tool_usage_events', 'tool_slug,event_type'),
  ]);

  const byTemplate = (counts ?? []).reduce((acc: Record<string, number>, row: any) => {
    acc[row.template] = (acc[row.template] ?? 0) + 1;
    return acc;
  }, {});

  const latestPipelineRun = pipelineRuns?.[0] ?? null;
  const { data: latestPipelineSteps } = latestPipelineRun
    ? await supabaseAdmin
        .from('pipeline_steps')
        .select('id,step_name,step_key,status,duration_ms,exit_code,error_message')
        .eq('run_id', latestPipelineRun.id)
        .order('step_index', { ascending: true })
    : { data: [] as any[] };

  const componentByCluster = countBy(componentLibraryRows.data, 'cluster');
  const originalityByStatus = countBy(originalityPageRows.data, 'originality_status');
  const originalityValues = originalityPageRows.data
    .map((row: any) => Number(row.originality_score))
    .filter((value: number) => Number.isFinite(value));
  const originalityAverage = originalityValues.length
    ? Number((originalityValues.reduce((sum: number, value: number) => sum + value, 0) / originalityValues.length).toFixed(1))
    : null;
  const componentTopWeights = topWeightedByCluster(componentLibraryRows.data);
  const keywordByStatus = countBy(keywordQueueRows.data, 'status');
  const keywordBySource = countBy(keywordQueueRows.data, 'source');
  const clusterMetricsSummary = numericSummary(clusterMetricsRows.data);
  const distributionByChannel = countBy(distributionAssetRows.data, 'channel');
  const distributionByStatus = countBy(distributionAssetRows.data, 'status');
  const distributionByType = countBy(distributionAssetRows.data, 'asset_type');
  const outreachByStatus = countBy(outreachQueueRows.data, 'status');
  const outreachByType = countBy(outreachQueueRows.data, 'target_type');
  const emailDigestByStatus = countBy(emailDigestRows.data, 'status');
  const distributionMetricSummary = numericSummary(distributionMetricRows.data);
  const partnerByType = countBy(partnerContactRows.data, 'target_type');
  const partnerByStatus = countBy(partnerContactRows.data, 'status');
  const publicationByChannel = countBy(publicationQueueRows.data, 'channel');
  const publicationByStatus = countBy(publicationQueueRows.data, 'publish_status');
  const publicationSummary = numericSummary(publicationQueueRows.data);
  const socialMetricByChannel = countBy(socialMetricRows.data, 'channel');
  const socialMetricSummary = numericSummary(socialMetricRows.data);
  const trustProfilesByType = countBy(trustProfileRows.data, 'profile_type');
  const roadmapByTemplate = countBy(roadmapRows.data, 'template');
  const roadmapByStatus = countBy(roadmapRows.data, 'status');
  const roadmapByFunnel = countBy(roadmapRows.data, 'funnel_stage');
  const productTruthByType = countBy(productTruthRows.data, 'card_type');
  const audienceSegmentCount = audienceSegmentRows.data.length;
  const brandVoiceCount = brandVoiceRows.data.length;
  const automationPolicyBySeverity = countBy(automationPolicyRows.data, 'severity');
  const leadMagnetByStatus = countBy(leadMagnetRows.data, 'status');
  const creatorByStage = countBy(creatorRelationshipRows.data, 'relationship_stage');
  const serpSnapshotsBySource = countBy(serpSnapshotRows.data, 'source');
  const brandMemoryByType = countBy(brandMemoryRows.data, 'memory_type');
  const narrativeByType = countBy(narrativeRows.data, 'narrative_type');
  const shareOfVoiceSummary = numericSummary(shareOfVoiceRows.data);
  const influenceByType = countBy(influenceNodeRows.data, 'node_type');
  const campaignByStatus = countBy(campaignRows.data, 'status');
  const campaignSummary = numericSummary(campaignRows.data);
  const executiveAttributionSummary = numericSummary(executiveAttributionRows.data);
  const moatSummary = numericSummary(moatRows.data);
  const riskByType = countBy(riskRows.data, 'risk_type');
  const riskBySeverity = countBy(riskRows.data, 'severity');
  const cockpitSummary = numericSummary(cockpitRows.data);
  const newsroomFeedsByBeat = countBy(newsroomFeedRows.data, 'beat');
  const newsroomEventsByStatus = countBy(newsroomEventRows.data, 'status');
  const newsroomEventsByType = countBy(newsroomEventRows.data, 'event_type');
  const newsroomEntitiesByType = countBy(newsroomEntityRows.data, 'entity_type');
  const newsroomStorylinesByStatus = countBy(newsroomStorylineRows.data, 'status');
  const llmScoresByStatus = countBy(llmScoreRows.data, 'readiness_status');
  const llmScoreSummary = numericSummary(llmScoreRows.data);
  const llmObservationsByType = countBy(llmObservationRows.data, 'observation_type');
  const llmObservationsByStatus = countBy(llmObservationRows.data, 'status');
  const llmEntitiesByType = countBy(llmEntityRows.data, 'entity_type');
  const llmQueryByChannel = countBy(llmQueryRows.data, 'channel');
  const llmQueryByStatus = countBy(llmQueryRows.data, 'result_status');
  const llmQuerySummary = numericSummary(llmQueryRows.data);
  const llmReferralBySource = countBy(llmReferralRows.data, 'source');
  const conversionByDiscoverySource = countBy(conversionEventRows.data, 'discovery_source');
  const crawlerByFamily = countBy(crawlerLogRows.data, 'bot_family');
  const crawlerByPath = countBy(crawlerLogRows.data, 'request_path');
  const promptByChannel = countBy(promptCorpusRows.data, 'channel');
  const promptByIntent = countBy(promptCorpusRows.data, 'intent');
  const promptByStatus = countBy(promptCorpusRows.data, 'status');
  const shareByChannel = countBy(shareSnapshotRows.data, 'channel');
  const shareSummary = numericSummary(shareSnapshotRows.data);
  const commercialByStatus = countBy(commercialAuditRows.data, 'readiness_status');
  const commercialSummary = numericSummary(commercialAuditRows.data);
  const toolUsageBySlug = countBy(toolUsageRows.data, 'tool_slug');
  const toolUsageByEvent = countBy(toolUsageRows.data, 'event_type');
  const researchSummary = numericSummary(researchDatasetRows.data);

  return {
    newTrends: newTrends ?? [],
    drafts: reviewQueue ?? [],
    published: published ?? [],
    byTemplate,
    lastDeploy: deploys?.[0] ?? null,
    lastSuccessfulBuild: successfulPipelineRuns?.[0] ?? null,
    latestPipelineRun,
    latestPipelineSteps: latestPipelineSteps ?? [],
    refreshQueue: refreshQueue ?? [],
    migrationReadiness,
    totals: {
      trends: trendCount ?? 0,
      drafts: reviewCount ?? 0,
      published: publishedCount ?? 0,
      refreshQueue: refreshQueueCount ?? 0,
    },
    componentLibrary: {
      byCluster: componentByCluster,
      topWeights: componentTopWeights,
      total: componentLibraryRows.data.length,
      error: componentLibraryRows.error,
    },
    originality: {
      byStatus: originalityByStatus,
      average: originalityAverage,
      total: originalityValues.length,
      error: originalityPageRows.error,
    },
    feedbackLoop: {
      fingerprints: performanceFingerprintRows.data,
      error: performanceFingerprintRows.error,
    },
    keywordQueue: {
      byStatus: keywordByStatus,
      bySource: keywordBySource,
      total: keywordQueueRows.data.length,
      error: keywordQueueRows.error,
    },
    clusterMetrics: {
      summary: clusterMetricsSummary,
      error: clusterMetricsRows.error,
    },
    distribution: {
      byChannel: distributionByChannel,
      byStatus: distributionByStatus,
      byType: distributionByType,
      total: distributionAssetRows.data.length,
      metrics: distributionMetricSummary,
      outreachByStatus,
      outreachByType,
      outreachTotal: outreachQueueRows.data.length,
      emailDigestByStatus,
      emailDigestTotal: emailDigestRows.data.length,
      error:
        distributionAssetRows.error ||
        outreachQueueRows.error ||
        emailDigestRows.error ||
        distributionMetricRows.error,
    },
    growthExecution: {
      partnerByType,
      partnerByStatus,
      partnerTotal: partnerContactRows.data.length,
      publicationByChannel,
      publicationByStatus,
      publicationSummary,
      publicationTotal: publicationQueueRows.data.length,
      socialMetricByChannel,
      socialMetricSummary,
      socialMetricTotal: socialMetricRows.data.length,
      trustProfilesByType,
      trustProfileTotal: trustProfileRows.data.length,
      roadmapByTemplate,
      roadmapByStatus,
      roadmapByFunnel,
      roadmapTotal: roadmapRows.data.length,
      productTruthByType,
      productTruthTotal: productTruthRows.data.length,
      audienceSegmentCount,
      brandVoiceCount,
      automationPolicyBySeverity,
      leadMagnetByStatus,
      creatorByStage,
      serpSnapshotsBySource,
      error:
        partnerContactRows.error ||
        publicationQueueRows.error ||
        socialMetricRows.error ||
        trustProfileRows.error ||
        roadmapRows.error ||
        productTruthRows.error ||
        audienceSegmentRows.error ||
        brandVoiceRows.error ||
        automationPolicyRows.error ||
        leadMagnetRows.error ||
        creatorRelationshipRows.error ||
        serpSnapshotRows.error,
    },
    brandOperatingSystem: {
      brandMemoryByType,
      brandMemoryTotal: brandMemoryRows.data.length,
      narrativeByType,
      narrativeTotal: narrativeRows.data.length,
      shareOfVoiceSummary,
      influenceByType,
      influenceTotal: influenceNodeRows.data.length,
      campaignByStatus,
      campaignSummary,
      campaignTotal: campaignRows.data.length,
      executiveAttributionSummary,
      moatSummary,
      riskByType,
      riskBySeverity,
      riskTotal: riskRows.data.length,
      cockpitSummary,
      error:
        brandMemoryRows.error ||
        narrativeRows.error ||
        shareOfVoiceRows.error ||
        influenceNodeRows.error ||
        campaignRows.error ||
        executiveAttributionRows.error ||
        moatRows.error ||
        riskRows.error ||
        cockpitRows.error,
    },
    newsroom: {
      feedsByBeat: newsroomFeedsByBeat,
      eventsByStatus: newsroomEventsByStatus,
      eventsByType: newsroomEventsByType,
      entitiesByType: newsroomEntitiesByType,
      storylinesByStatus: newsroomStorylinesByStatus,
      feedTotal: newsroomFeedRows.data.length,
      eventTotal: newsroomEventRows.data.length,
      entityTotal: newsroomEntityRows.data.length,
      storylineTotal: newsroomStorylineRows.data.length,
      error: newsroomFeedRows.error || newsroomEventRows.error || newsroomEntityRows.error || newsroomStorylineRows.error,
    },
    llmDiscovery: {
      scoresByStatus: llmScoresByStatus,
      scoreSummary: llmScoreSummary,
      scoreTotal: llmScoreRows.data.length,
      observationsByType: llmObservationsByType,
      observationsByStatus: llmObservationsByStatus,
      observationTotal: llmObservationRows.data.length,
      entitiesByType: llmEntitiesByType,
      entityTotal: llmEntityRows.data.length,
      queryByChannel: llmQueryByChannel,
      queryByStatus: llmQueryByStatus,
      querySummary: llmQuerySummary,
      queryTotal: llmQueryRows.data.length,
      referralBySource: llmReferralBySource,
      referralTotal: llmReferralRows.data.length,
      conversionByDiscoverySource,
      conversionTotal: conversionEventRows.data.length,
      error:
        llmScoreRows.error ||
        llmObservationRows.error ||
        llmEntityRows.error ||
        llmQueryRows.error ||
        llmReferralRows.error ||
        conversionEventRows.error,
    },
    aiReach: {
      crawlerByFamily,
      crawlerByPath,
      crawlerTotal: crawlerLogRows.data.length,
      promptByChannel,
      promptByIntent,
      promptByStatus,
      promptTotal: promptCorpusRows.data.length,
      shareByChannel,
      shareSummary,
      shareTotal: shareSnapshotRows.data.length,
      commercialByStatus,
      commercialSummary,
      commercialTotal: commercialAuditRows.data.length,
      researchSummary,
      researchTotal: researchDatasetRows.data.length,
      toolUsageBySlug,
      toolUsageByEvent,
      toolUsageTotal: toolUsageRows.data.length,
      error:
        crawlerLogRows.error ||
        promptCorpusRows.error ||
        shareSnapshotRows.error ||
        commercialAuditRows.error ||
        researchDatasetRows.error ||
        toolUsageRows.error,
    },
  };
}

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [data, params] = await Promise.all([getDashboardData(), searchParams]);
  const message = parseMessage(params);

  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: '20px 16px 56px' }}>
      <h1>RecoveryStack Admin</h1>
      <p>Manual gates enforced: generation writes to review state, publishing runs through guarded admin actions only.</p>

      {message.ok ? <p style={{ color: 'green' }}>{message.ok}</p> : null}
      {message.error ? (
        <div style={{ color: 'crimson' }}>
          <p>{message.error}</p>
          {message.details.length ? (
            <ul>
              {message.details.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <section style={{ marginTop: 20, border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
        <h2 style={{ marginTop: 0 }}>Migration readiness</h2>
        {data.migrationReadiness.ready ? (
          <p style={{ color: '#166534' }}>All required tables are present ({data.migrationReadiness.requiredTableCount} checked).</p>
        ) : (
          <>
            <p style={{ color: '#b91c1c' }}>
              Missing {data.migrationReadiness.missingTableCount} required table(s). Run the SQL snippets below in Supabase SQL Editor, then refresh this page.
            </p>
            <p style={{ marginTop: 0 }}>
              API status endpoint:{' '}
              <code style={{ background: '#f3f4f6', padding: '1px 4px' }}>/api/admin/migration-readiness</code>
            </p>
            <ul>
              {data.migrationReadiness.missingMigrations.map((migration: any) => (
                <li key={migration.migration} style={{ marginBottom: 14 }}>
                  <p style={{ margin: '0 0 6px' }}>
                    <strong>{migration.migration}</strong> ({migration.filePath})
                    <br />
                    Missing tables: {migration.missingTables.join(', ')}
                  </p>
                  <pre
                    style={{
                      background: '#111827',
                      color: '#f9fafb',
                      padding: 12,
                      borderRadius: 6,
                      overflowX: 'auto',
                      whiteSpace: 'pre-wrap',
                      maxHeight: 280,
                    }}
                  >
                    {migration.sqlSnippet}
                  </pre>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section style={{ marginTop: 20 }}>
        <h2>Status counts</h2>
        <ul>
          <li>Trends pending approval: {data.totals.trends}</li>
          <li>Pages in review queue: {data.totals.drafts}</li>
          <li>Published pages: {data.totals.published}</li>
          <li>Refresh queue (queued): {data.totals.refreshQueue}</li>
        </ul>
      </section>

      <section style={{ marginTop: 24, border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
        <h2 style={{ marginTop: 0 }}>Component & keyword cluster controls</h2>
        <p style={{ marginTop: 0, color: '#4b5563' }}>Operational controls for component library reseeding and keyword queue filling.</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <form method="post" action="/api/admin/cluster-systems">
            <input type="hidden" name="action" value="reseed_component_library" />
            <button type="submit">Reseed component_library</button>
          </form>
          <form method="post" action="/api/admin/cluster-systems">
            <input type="hidden" name="action" value="enqueue_top_trends" />
            <input type="hidden" name="limit" value="25" />
            <button type="submit">Enqueue top trends → keyword_queue</button>
          </form>
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>New system visibility</h2>

        <h3 style={{ marginBottom: 6 }}>component_library counts by cluster</h3>
        {data.componentLibrary.error ? (
          <p style={{ color: '#92400e' }}>{data.componentLibrary.error}</p>
        ) : (
          <>
            <p style={{ color: '#4b5563' }}>Total rows: {data.componentLibrary.total}</p>
            <ul>
              {Object.entries(data.componentLibrary.byCluster)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([cluster, count]) => (
                  <li key={cluster}>
                    {cluster}: {count}
                  </li>
                ))}
            </ul>
            <p style={{ color: '#4b5563', marginBottom: 6 }}>Highest-weight components per cluster</p>
            <ul>
              {Object.entries(data.componentLibrary.topWeights).map(([cluster, items]: [string, any]) => (
                <li key={`weights-${cluster}`}>
                  {cluster}: {items.map((item: { name: string; weight: number }) => `${item.name} (${item.weight})`).join(', ')}
                </li>
              ))}
            </ul>
          </>
        )}

        <h3 style={{ marginBottom: 6 }}>adaptive feedback loop</h3>
        {data.feedbackLoop.error ? (
          <p style={{ color: '#92400e' }}>{data.feedbackLoop.error}</p>
        ) : data.feedbackLoop.fingerprints.length ? (
          <ul>
            {data.feedbackLoop.fingerprints.map((row: any) => (
              <li key={row.template}>
                {row.template}: top performers {row.top_performer_count ?? 0}, avg words {row.avg_word_count ?? 'n/a'}, avg FAQs {row.avg_faq_count ?? 'n/a'}, best CTR range {row.best_ctr_word_range ?? 'n/a'}, computed {formatDateTime(row.computed_at)}
              </li>
            ))}
          </ul>
        ) : (
          <p>No adaptive feedback fingerprints written yet.</p>
        )}

        <h3 style={{ marginBottom: 6 }}>keyword_queue counts</h3>
        {data.keywordQueue.error ? (
          <p style={{ color: '#92400e' }}>{data.keywordQueue.error}</p>
        ) : (
          <>
            <p style={{ color: '#4b5563' }}>Total rows: {data.keywordQueue.total}</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <strong>By status</strong>
                <ul>
                  {Object.entries(data.keywordQueue.byStatus)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([status, count]) => (
                      <li key={status}>
                        {status}: {count}
                      </li>
                    ))}
                </ul>
              </div>
              <div>
                <strong>By source</strong>
                <ul>
                  {Object.entries(data.keywordQueue.bySource)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([source, count]) => (
                      <li key={source}>
                        {source}: {count}
                      </li>
                    ))}
                </ul>
              </div>
            </div>
          </>
        )}

        <h3 style={{ marginBottom: 6 }}>distribution engine</h3>
        {data.distribution.error ? (
          <p style={{ color: '#92400e' }}>{data.distribution.error}</p>
        ) : (
          <>
            <p style={{ color: '#4b5563' }}>
              Assets: {data.distribution.total} | Outreach items: {data.distribution.outreachTotal} | Email digests: {data.distribution.emailDigestTotal}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <strong>Assets by channel</strong>
                <ul>
                  {Object.entries(data.distribution.byChannel).map(([channel, count]) => (
                    <li key={`dist-channel-${channel}`}>{channel}: {count}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Assets by status</strong>
                <ul>
                  {Object.entries(data.distribution.byStatus).map(([status, count]) => (
                    <li key={`dist-status-${status}`}>{status}: {count}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Assets by type</strong>
                <ul>
                  {Object.entries(data.distribution.byType).map(([type, count]) => (
                    <li key={`dist-type-${type}`}>{type}: {count}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Outreach queue</strong>
                <ul>
                  {Object.entries(data.distribution.outreachByStatus).map(([status, count]) => (
                    <li key={`outreach-status-${status}`}>{status}: {count}</li>
                  ))}
                  {Object.entries(data.distribution.outreachByType).map(([type, count]) => (
                    <li key={`outreach-type-${type}`}>{type}: {count} target(s)</li>
                  ))}
                </ul>
              </div>
            </div>
            <p style={{ color: '#4b5563', marginBottom: 6 }}>Email digest issue status</p>
            <ul>
              {Object.entries(data.distribution.emailDigestByStatus).map(([status, count]) => (
                <li key={`digest-${status}`}>{status}: {count}</li>
              ))}
            </ul>
            <p style={{ color: '#4b5563', marginBottom: 6 }}>Distribution metric summary</p>
            <pre style={{ background: '#f8fafc', padding: 12, borderRadius: 6, overflowX: 'auto' }}>
              {JSON.stringify(data.distribution.metrics, null, 2)}
            </pre>
          </>
        )}

        <h3 style={{ marginBottom: 6 }}>growth execution engine</h3>
        {data.growthExecution.error ? (
          <p style={{ color: '#92400e' }}>{data.growthExecution.error}</p>
        ) : (
          <>
            <p style={{ color: '#4b5563' }}>
              Partners: {data.growthExecution.partnerTotal} | Publication queue: {data.growthExecution.publicationTotal} | Social metric rows: {data.growthExecution.socialMetricTotal}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <strong>Partner contacts</strong>
                <ul>
                  {Object.entries(data.growthExecution.partnerByType).map(([label, count]) => (
                    <li key={`partner-type-${label}`}>{label}: {count}</li>
                  ))}
                  {Object.entries(data.growthExecution.partnerByStatus).map(([label, count]) => (
                    <li key={`partner-status-${label}`}>{label}: {count} active state(s)</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Publication queue</strong>
                <ul>
                  {Object.entries(data.growthExecution.publicationByChannel).map(([label, count]) => (
                    <li key={`pub-channel-${label}`}>{label}: {count}</li>
                  ))}
                  {Object.entries(data.growthExecution.publicationByStatus).map(([label, count]) => (
                    <li key={`pub-status-${label}`}>{label}: {count}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Editorial trust</strong>
                <ul>
                  {Object.entries(data.growthExecution.trustProfilesByType).map(([label, count]) => (
                    <li key={`trust-${label}`}>{label}: {count}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Roadmap / product truth</strong>
                <ul>
                  {Object.entries(data.growthExecution.roadmapByStatus).map(([label, count]) => (
                    <li key={`roadmap-status-${label}`}>{label}: {count}</li>
                  ))}
                  {Object.entries(data.growthExecution.roadmapByFunnel).map(([label, count]) => (
                    <li key={`roadmap-funnel-${label}`}>{label}: {count}</li>
                  ))}
                  {Object.entries(data.growthExecution.productTruthByType).map(([label, count]) => (
                    <li key={`truth-${label}`}>{label}: {count}</li>
                  ))}
                  <li>audience segments: {data.growthExecution.audienceSegmentCount}</li>
                  <li>brand voice profiles: {data.growthExecution.brandVoiceCount}</li>
                </ul>
              </div>
            </div>
            <p style={{ color: '#4b5563', marginBottom: 6 }}>Social metric summary</p>
            <pre style={{ background: '#f8fafc', padding: 12, borderRadius: 6, overflowX: 'auto' }}>
              {JSON.stringify(data.growthExecution.socialMetricSummary, null, 2)}
            </pre>
            <p style={{ color: '#4b5563', marginBottom: 6 }}>Moat systems snapshot</p>
            <pre style={{ background: '#f8fafc', padding: 12, borderRadius: 6, overflowX: 'auto' }}>
              {JSON.stringify({
                automationPolicyBySeverity: data.growthExecution.automationPolicyBySeverity,
                leadMagnetByStatus: data.growthExecution.leadMagnetByStatus,
                creatorByStage: data.growthExecution.creatorByStage,
                serpSnapshotsBySource: data.growthExecution.serpSnapshotsBySource,
              }, null, 2)}
            </pre>
          </>
        )}

        <h3 style={{ marginBottom: 6 }}>cluster_metrics summary</h3>
        {data.clusterMetrics.error ? (
          <p style={{ color: '#92400e' }}>{data.clusterMetrics.error}</p>
        ) : (
          <>
            <p style={{ color: '#4b5563' }}>Rows sampled: {data.clusterMetrics.summary.rowCount}</p>
            {Object.keys(data.clusterMetrics.summary.numericFields).length ? (
              <ul>
                {Object.entries(data.clusterMetrics.summary.numericFields)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([field, stats]) => (
                    <li key={field}>
                      {field}: min {stats.min} · avg {stats.avg} · max {stats.max}
                    </li>
                  ))}
              </ul>
            ) : (
              <p>No numeric fields found in sampled cluster_metrics rows.</p>
            )}
          </>
        )}

        <h3 style={{ marginBottom: 6 }}>newsroom system visibility</h3>
        {data.newsroom.error ? (
          <p style={{ color: '#92400e' }}>{data.newsroom.error}</p>
        ) : (
          <>
            <p style={{ color: '#4b5563' }}>
              Feeds: {data.newsroom.feedTotal} · Source events: {data.newsroom.eventTotal} · Entities: {data.newsroom.entityTotal} · Storylines: {data.newsroom.storylineTotal}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <strong>Feeds by beat</strong>
                <ul>
                  {Object.entries(data.newsroom.feedsByBeat).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => (
                    <li key={label}>{label}: {count}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Events by status</strong>
                <ul>
                  {Object.entries(data.newsroom.eventsByStatus).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => (
                    <li key={label}>{label}: {count}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Events by type</strong>
                <ul>
                  {Object.entries(data.newsroom.eventsByType).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => (
                    <li key={label}>{label}: {count}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Entities / storylines</strong>
                <ul>
                  {Object.entries(data.newsroom.entitiesByType).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => (
                    <li key={`entity-${label}`}>entity {label}: {count}</li>
                  ))}
                  {Object.entries(data.newsroom.storylinesByStatus).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => (
                    <li key={`story-${label}`}>storyline {label}: {count}</li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        )}
      </section>

      <section id="deploy" style={{ marginTop: 24, border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
        <h2 style={{ marginTop: 0 }}>Deploy status</h2>
        <p style={{ marginBottom: 8 }}>Telemetry from Vercel deploy hook + pipeline build history.</p>

        <div style={{ marginBottom: 10 }}>
          <strong>Latest deploy hook event:</strong>{' '}
          {data.lastDeploy ? (
            <>
              <span style={{ color: getStatusColor(data.lastDeploy.status), fontWeight: 600 }}>{data.lastDeploy.status}</span>
              {' · '}
              <span>{formatDateTime(data.lastDeploy.created_at)}</span>
              {data.lastDeploy.detail ? <div style={{ color: '#4b5563', marginTop: 4 }}>{data.lastDeploy.detail}</div> : null}
            </>
          ) : (
            <span>No deploy hook events yet.</span>
          )}
        </div>

        <div>
          <strong>Last successful build:</strong>{' '}
          {data.lastSuccessfulBuild ? (
            <>
              <span>{formatDateTime(data.lastSuccessfulBuild.finished_at)}</span>
              <span style={{ color: '#4b5563' }}> · {data.lastSuccessfulBuild.pipeline_name}</span>
            </>
          ) : (
            <span>No successful pipeline run found yet.</span>
          )}
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Pipeline</h2>
        <form method="post" action="/api/admin/pipeline">
          <input type="hidden" name="action" value="run_pipeline" />
          <button type="submit">Run Pipeline</button>
        </form>

        <div style={{ marginTop: 12 }}>
          <h3>Last pipeline run</h3>
          {data.latestPipelineRun ? (
            <>
              <p>
                <strong>{data.latestPipelineRun.pipeline_name}</strong> · status:{' '}
                <strong style={{ color: getStatusColor(data.latestPipelineRun.status) }}>{data.latestPipelineRun.status}</strong>
              </p>
              <p>
                started: {formatDateTime(data.latestPipelineRun.started_at)} · finished: {formatDateTime(data.latestPipelineRun.finished_at)} · duration(ms):{' '}
                {data.latestPipelineRun.duration_ms ?? 'n/a'}
              </p>
              {data.latestPipelineRun.error_message ? (
                <p style={{ color: 'crimson' }}>error: {data.latestPipelineRun.error_message}</p>
              ) : null}
              {data.latestPipelineSteps.length ? (
                <ul>
                  {data.latestPipelineSteps.map((step: any) => (
                    <li key={step.id}>
                      {step.step_name} — <span style={{ color: getStatusColor(step.status) }}>{step.status}</span>
                      {typeof step.duration_ms === 'number' ? ` (${step.duration_ms}ms)` : ''}
                      {typeof step.exit_code === 'number' ? ` [exit ${step.exit_code}]` : ''}
                      {step.error_message ? ` — ${step.error_message}` : ''}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p>No pipeline telemetry yet.</p>
          )}
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Basic analytics</h2>
        {Object.keys(data.byTemplate).length ? (
          <ul>
            {Object.entries(data.byTemplate)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([template, count]) => (
                <li key={template}>
                  {template}: {String(count)}
                </li>
              ))}
          </ul>
        ) : (
          <p>No template stats yet.</p>
        )}
      </section>

      <section style={{ marginTop: 24, border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
        <h2 style={{ marginTop: 0 }}>LLM Discovery</h2>
        {data.llmDiscovery.error ? (
          <p style={{ color: '#b91c1c' }}>LLM discovery data unavailable: {data.llmDiscovery.error}</p>
        ) : (
          <>
            <p style={{ color: '#4b5563', marginTop: 0 }}>
              scored pages: {data.llmDiscovery.scoreTotal}
              {typeof data.llmDiscovery.scoreSummary.numericFields.total_score?.avg === 'number'
                ? ` · avg score ${data.llmDiscovery.scoreSummary.numericFields.total_score.avg}`
                : ''}
              {' '}· observations: {data.llmDiscovery.observationTotal}
              {' '}· simulations: {data.llmDiscovery.queryTotal}
              {' '}· referrals: {data.llmDiscovery.referralTotal}
              {' '}· attributed conversions: {data.llmDiscovery.conversionTotal}
            </p>
            <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <div>
                <strong>Readiness status</strong>
                <ul>
                  {Object.entries(data.llmDiscovery.scoresByStatus).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => (
                    <li key={`llm-score-${label}`}>{label}: {count}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Open issues</strong>
                <ul>
                  {Object.entries(data.llmDiscovery.observationsByType).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => (
                    <li key={`llm-obs-${label}`}>{label}: {count}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Simulation outcomes</strong>
                <ul>
                  {Object.entries(data.llmDiscovery.queryByStatus).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => (
                    <li key={`llm-query-${label}`}>{label}: {count}</li>
                  ))}
                  {Object.entries(data.llmDiscovery.queryByChannel).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => (
                    <li key={`llm-channel-${label}`}>channel {label}: {count}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Discovery sources</strong>
                <ul>
                  {Object.entries(data.llmDiscovery.referralBySource).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => (
                    <li key={`llm-ref-${label}`}>landing {label}: {count}</li>
                  ))}
                  {Object.entries(data.llmDiscovery.conversionByDiscoverySource).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => (
                    <li key={`llm-conv-${label}`}>conversion {label}: {count}</li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        )}
      </section>

      <section style={{ marginTop: 24, border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
        <h2 style={{ marginTop: 0 }}>AI Reach</h2>
        {data.aiReach.error ? (
          <p style={{ color: '#b91c1c' }}>AI reach data unavailable: {data.aiReach.error}</p>
        ) : (
          <>
            <p style={{ color: '#4b5563', marginTop: 0 }}>
              crawler logs: {data.aiReach.crawlerTotal}
              {' '}· prompts: {data.aiReach.promptTotal}
              {' '}· share rows: {data.aiReach.shareTotal}
              {' '}· commercial audits: {data.aiReach.commercialTotal}
              {' '}· datasets: {data.aiReach.researchTotal}
              {' '}· tool events: {data.aiReach.toolUsageTotal}
            </p>
            <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <div>
                <strong>Crawler families</strong>
                <ul>
                  {Object.entries(data.aiReach.crawlerByFamily).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => (
                    <li key={`crawler-${label}`}>{label}: {count}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Prompt corpus</strong>
                <ul>
                  {Object.entries(data.aiReach.promptByChannel).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => (
                    <li key={`prompt-channel-${label}`}>channel {label}: {count}</li>
                  ))}
                  {Object.entries(data.aiReach.promptByIntent).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => (
                    <li key={`prompt-intent-${label}`}>intent {label}: {count}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Share / commercial</strong>
                <ul>
                  {Object.entries(data.aiReach.shareByChannel).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => (
                    <li key={`share-${label}`}>share {label}: {count}</li>
                  ))}
                  {Object.entries(data.aiReach.commercialByStatus).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => (
                    <li key={`commercial-${label}`}>commercial {label}: {count}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Research / tools</strong>
                <ul>
                  {Object.entries(data.aiReach.toolUsageBySlug).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => (
                    <li key={`tool-${label}`}>{label}: {count}</li>
                  ))}
                  <li>dataset rows sampled: {data.aiReach.researchSummary.rowCount}</li>
                </ul>
              </div>
            </div>
            <p style={{ color: '#4b5563', marginBottom: 6 }}>Top crawler paths</p>
            <ul>
              {Object.entries(data.aiReach.crawlerByPath)
                .sort(([, a], [, b]) => Number(b) - Number(a))
                .slice(0, 6)
                .map(([label, count]) => (
                  <li key={`crawler-path-${label}`}>{label}: {count}</li>
                ))}
            </ul>
          </>
        )}
      </section>

      <section style={{ marginTop: 24, border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
        <h2 style={{ marginTop: 0 }}>Brand OS</h2>
        {data.brandOperatingSystem.error ? (
          <p style={{ color: '#b91c1c' }}>Brand OS data unavailable: {data.brandOperatingSystem.error}</p>
        ) : (
          <>
            <p style={{ color: '#4b5563', marginTop: 0 }}>
              Memory entries: {data.brandOperatingSystem.brandMemoryTotal} Â· narratives: {data.brandOperatingSystem.narrativeTotal} Â·
              influence nodes: {data.brandOperatingSystem.influenceTotal} Â· campaigns: {data.brandOperatingSystem.campaignTotal} Â·
              open risks: {data.brandOperatingSystem.riskTotal}
            </p>
            <ul>
              {Object.entries(data.brandOperatingSystem.brandMemoryByType).map(([label, count]) => (
                <li key={`memory-${label}`}>memory {label}: {count}</li>
              ))}
              {Object.entries(data.brandOperatingSystem.narrativeByType).map(([label, count]) => (
                <li key={`narrative-${label}`}>narrative {label}: {count}</li>
              ))}
              {Object.entries(data.brandOperatingSystem.influenceByType).map(([label, count]) => (
                <li key={`influence-${label}`}>influence {label}: {count}</li>
              ))}
              {Object.entries(data.brandOperatingSystem.campaignByStatus).map(([label, count]) => (
                <li key={`campaign-${label}`}>campaign {label}: {count}</li>
              ))}
              {Object.entries(data.brandOperatingSystem.riskBySeverity).map(([label, count]) => (
                <li key={`risk-sev-${label}`}>risk severity {label}: {count}</li>
              ))}
            </ul>
            <p style={{ color: '#4b5563' }}>
              Share of voice rows: {data.brandOperatingSystem.shareOfVoiceSummary.rowCount} Â·
              executive attribution rows: {data.brandOperatingSystem.executiveAttributionSummary.rowCount} Â·
              cockpit snapshots: {data.brandOperatingSystem.cockpitSummary.rowCount}
            </p>
          </>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Trend queue (status=new)</h2>
        <p style={{ color: '#4b5563' }}>
          Originality coverage: {data.originality.total} page(s)
          {typeof data.originality.average === 'number' ? ` Â· avg score ${data.originality.average}` : ''}
          {Object.keys(data.originality.byStatus).length
            ? ` Â· ${Object.entries(data.originality.byStatus).map(([key, value]) => `${key}:${value}`).join(' | ')}`
            : ''}
        </p>
        <ul>
          {data.newTrends.map((trend: any) => (
            <li key={trend.id}>
              <strong>{trend.term}</strong> ({trend.source ?? 'unknown'})
              <form method="post" action={`/api/admin/trends/${trend.id}`} style={{ display: 'inline-block', marginLeft: 8 }}>
                <input type="hidden" name="action" value="approve" />
                <button type="submit">Approve</button>
              </form>
              <form method="post" action={`/api/admin/trends/${trend.id}`} style={{ display: 'inline-block', marginLeft: 8 }}>
                <input type="hidden" name="action" value="reject" />
                <button type="submit">Reject</button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Refresh queue (status=queued)</h2>
        <ul>
          {data.refreshQueue.map((item: any) => (
            <li key={item.id}>
              <strong>{item.slug}</strong> — {item.reason}
              {typeof item.stale_days === 'number' ? ` (${item.stale_days}d stale)` : ''}
              {item.low_traffic ? ' · low traffic' : ''}
              <form method="post" action={`/api/admin/refresh-queue/${item.id}`} style={{ display: 'inline-block', marginLeft: 8 }}>
                <input type="hidden" name="action" value="approve" />
                <button type="submit">Approve refresh</button>
              </form>
              <form method="post" action={`/api/admin/refresh-queue/${item.id}`} style={{ display: 'inline-block', marginLeft: 8 }}>
                <input type="hidden" name="action" value="reject" />
                <button type="submit">Reject</button>
              </form>
              <form method="post" action={`/api/admin/refresh-queue/${item.id}`} style={{ display: 'inline-block', marginLeft: 8 }}>
                <input type="hidden" name="action" value="defer" />
                <button type="submit">Defer</button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Review queue</h2>
        <ul>
          {data.drafts.map((d: any) => (
            <li key={d.id}>
              <strong>{d.title}</strong> <span style={{ color: '#4b5563' }}>({d.status})</span>
              {typeof d.originality_score === 'number' ? (
                <span style={{ color: '#4b5563', marginLeft: 8 }}>
                  originality {d.originality_score} ({d.originality_status ?? 'n/a'})
                </span>
              ) : null}
              <form method="post" action={`/api/admin/drafts/${d.id}`} style={{ display: 'inline-block', marginLeft: 8 }}>
                <input type="hidden" name="action" value="publish" />
                <button type="submit">Publish</button>
              </form>
              <form method="post" action={`/api/admin/pages/${d.id}/regenerate`} style={{ display: 'inline-block', marginLeft: 8 }}>
                <input type="hidden" name="action" value="regenerate" />
                <button type="submit">Regenerate</button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Published (latest)</h2>
        <ul>
          {data.published.slice(0, 30).map((p: any) => (
            <li key={p.id}>
              <Link href={`/${p.template}/${p.slug}` as any}>{p.title}</Link>
              {typeof p.llm_readiness_score === 'number' ? (
                <span style={{ color: '#4b5563', marginLeft: 8 }}>
                  llm {p.llm_readiness_score} ({p.llm_readiness_status ?? 'n/a'})
                </span>
              ) : null}
              {typeof p.commercial_readiness_score === 'number' ? (
                <span style={{ color: '#4b5563', marginLeft: 8 }}>
                  commercial {p.commercial_readiness_score} ({p.commercial_readiness_status ?? 'n/a'})
                </span>
              ) : null}
              {typeof p.originality_score === 'number' ? (
                <span style={{ color: '#4b5563', marginLeft: 8 }}>
                  originality {p.originality_score} ({p.originality_status ?? 'n/a'})
                </span>
              ) : null}
              <form method="post" action={`/api/admin/pages/${p.id}/regenerate`} style={{ display: 'inline-block', marginLeft: 8 }}>
                <input type="hidden" name="action" value="regenerate" />
                <button type="submit">Regenerate</button>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
