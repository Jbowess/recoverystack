import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { supabaseAdmin } from '@/lib/supabase-admin';

type RequiredTable = {
  table: string;
  migration: string;
};

type TableCheckResult = RequiredTable & {
  exists: boolean;
  error?: string;
};

export type MissingMigration = {
  migration: string;
  filePath: string;
  missingTables: string[];
  sqlSnippet: string;
};

export type MigrationReadinessReport = {
  ready: boolean;
  checkedAt: string;
  requiredTableCount: number;
  missingTableCount: number;
  requiredTables: TableCheckResult[];
  missingMigrations: MissingMigration[];
};

const REQUIRED_TABLES: RequiredTable[] = [
  { table: 'seo_pages', migration: '0002_recoverystack_core.sql' },
  { table: 'seo_trends', migration: '0002_recoverystack_core.sql' },
  { table: 'seo_products', migration: '0002_recoverystack_core.sql' },
  { table: 'seo_internal_links', migration: '0001_init.sql' },
  { table: 'seo_trend_queue', migration: '0001_init.sql' },
  { table: 'seo_content_gaps', migration: '0001_init.sql' },
  { table: 'seo_deploy_events', migration: '0003_ops_tables.sql' },
  { table: 'seo_conversion_events', migration: '0003_ops_tables.sql' },
  { table: 'seo_compatibility_checker_submissions', migration: '0004_compatibility_checker_submissions.sql' },
  { table: 'seo_content_refresh_queue', migration: '0005_content_refresh_queue.sql' },
  { table: 'seo_pipeline_runs', migration: '0006_pipeline_run_telemetry.sql' },
  { table: 'seo_pipeline_steps', migration: '0006_pipeline_run_telemetry.sql' },
  { table: 'seo_keyword_queue', migration: '0008_keyword_cluster_system.sql' },
  { table: 'seo_briefs', migration: '0022_briefs.sql' },
  { table: 'seo_product_specs', migration: '0031_information_gathering_tables.sql' },
  { table: 'seo_page_conversion_aggregates', migration: '0032_tier1_tier2_tier3_tables.sql' },
  { table: 'seo_distribution_assets', migration: '0037_distribution_engine.sql' },
  { table: 'seo_outreach_queue', migration: '0037_distribution_engine.sql' },
  { table: 'seo_email_digest_issues', migration: '0037_distribution_engine.sql' },
  { table: 'seo_distribution_asset_metrics', migration: '0037_distribution_engine.sql' },
  { table: 'seo_partner_contacts', migration: '0039_growth_execution_engine.sql' },
  { table: 'seo_channel_publication_queue', migration: '0039_growth_execution_engine.sql' },
  { table: 'seo_social_channel_metrics', migration: '0039_growth_execution_engine.sql' },
  { table: 'seo_editorial_trust_profiles', migration: '0039_growth_execution_engine.sql' },
  { table: 'seo_growth_roadmap_items', migration: '0039_growth_execution_engine.sql' },
  { table: 'seo_product_truth_cards', migration: '0039_growth_execution_engine.sql' },
  { table: 'seo_serp_snapshot_history', migration: '0040_growth_moat_systems.sql' },
  { table: 'seo_competitor_page_snapshots', migration: '0040_growth_moat_systems.sql' },
  { table: 'seo_community_topic_mentions', migration: '0040_growth_moat_systems.sql' },
  { table: 'seo_creator_relationships', migration: '0040_growth_moat_systems.sql' },
  { table: 'seo_outreach_reply_log', migration: '0040_growth_moat_systems.sql' },
  { table: 'seo_conversion_experiments', migration: '0040_growth_moat_systems.sql' },
  { table: 'seo_audience_segments', migration: '0040_growth_moat_systems.sql' },
  { table: 'seo_brand_voice_profiles', migration: '0040_growth_moat_systems.sql' },
  { table: 'seo_automation_policies', migration: '0040_growth_moat_systems.sql' },
  { table: 'seo_pipeline_retry_jobs', migration: '0040_growth_moat_systems.sql' },
  { table: 'seo_lead_magnet_offers', migration: '0040_growth_moat_systems.sql' },
  { table: 'seo_tool_usage_events', migration: '0040_growth_moat_systems.sql' },
  { table: 'seo_news_source_feeds', migration: '0027_newsroom_foundations.sql' },
  { table: 'seo_news_source_events', migration: '0027_newsroom_foundations.sql' },
  { table: 'seo_topic_entities', migration: '0027_newsroom_foundations.sql' },
  { table: 'seo_topic_entity_aliases', migration: '0027_newsroom_foundations.sql' },
  { table: 'seo_news_event_entities', migration: '0027_newsroom_foundations.sql' },
  { table: 'seo_storylines', migration: '0027_newsroom_foundations.sql' },
  { table: 'seo_storyline_events', migration: '0027_newsroom_foundations.sql' },
  { table: 'seo_page_storylines', migration: '0027_newsroom_foundations.sql' },
  { table: 'seo_entity_coverage_daily', migration: '0027_newsroom_foundations.sql' },
  { table: 'seo_page_update_log', migration: '0027_newsroom_foundations.sql' },
  { table: 'seo_source_watchlists', migration: '0032_editorial_intelligence_ops.sql' },
  { table: 'seo_source_watchlist_hits', migration: '0032_editorial_intelligence_ops.sql' },
  { table: 'seo_page_claims', migration: '0032_editorial_intelligence_ops.sql' },
  { table: 'seo_claim_evidence_links', migration: '0032_editorial_intelligence_ops.sql' },
  { table: 'seo_story_followup_jobs', migration: '0032_editorial_intelligence_ops.sql' },
  { table: 'seo_comparison_dataset_snapshots', migration: '0032_editorial_intelligence_ops.sql' },
  { table: 'seo_source_quality_scores', migration: '0032_editorial_intelligence_ops.sql' },
  { table: 'seo_serp_winner_patterns', migration: '0032_editorial_intelligence_ops.sql' },
  { table: 'seo_persona_distribution_queue', migration: '0032_editorial_intelligence_ops.sql' },
  { table: 'seo_editorial_review_queue', migration: '0032_editorial_intelligence_ops.sql' },
  { table: 'seo_page_entities', migration: '0046_llm_discovery_layer.sql' },
  { table: 'seo_page_llm_scores', migration: '0046_llm_discovery_layer.sql' },
  { table: 'seo_page_llm_observations', migration: '0046_llm_discovery_layer.sql' },
  { table: 'seo_llm_query_simulations', migration: '0046_llm_discovery_layer.sql' },
  { table: 'seo_llm_referral_events', migration: '0046_llm_discovery_layer.sql' },
  { table: 'seo_crawler_activity_logs', migration: '0047_ai_discovery_expansion.sql' },
  { table: 'seo_llm_prompt_corpus', migration: '0047_ai_discovery_expansion.sql' },
  { table: 'seo_llm_recommendation_share_snapshots', migration: '0047_ai_discovery_expansion.sql' },
  { table: 'seo_commercial_page_audits', migration: '0047_ai_discovery_expansion.sql' },
];

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');

async function getMigrationSqlSnippet(migration: string): Promise<string> {
  const filePath = path.join(MIGRATIONS_DIR, migration);
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return `-- Unable to read ${migration} from ${filePath}. Check that the migration file exists in this deploy.`;
  }
}

async function checkTableExists(table: string): Promise<TableCheckResult> {
  const spec = REQUIRED_TABLES.find((item) => item.table === table)!;
  const { error } = await supabaseAdmin.from(table).select('id', { head: true, count: 'exact' }).limit(1);

  if (!error) {
    return { ...spec, exists: true };
  }

  const normalizedMessage = `${error.code ?? ''} ${error.message ?? ''}`.toLowerCase();
  const missingTable = error.code === '42P01' || normalizedMessage.includes('does not exist');

  if (missingTable) {
    return { ...spec, exists: false };
  }

  return {
    ...spec,
    exists: false,
    error: `${error.code ?? 'unknown'}: ${error.message ?? 'Failed to query table'}`,
  };
}

export async function getMigrationReadinessReport(): Promise<MigrationReadinessReport> {
  const requiredTables = await Promise.all(REQUIRED_TABLES.map((spec) => checkTableExists(spec.table)));
  const missingTables = requiredTables.filter((item) => !item.exists);

  const migrations = new Map<string, string[]>();
  for (const table of missingTables) {
    const existing = migrations.get(table.migration) ?? [];
    existing.push(table.table);
    migrations.set(table.migration, existing);
  }

  const missingMigrations = await Promise.all(
    [...migrations.entries()].map(async ([migration, tables]) => ({
      migration,
      filePath: path.join('supabase', 'migrations', migration),
      missingTables: tables,
      sqlSnippet: await getMigrationSqlSnippet(migration),
    })),
  );

  return {
    ready: missingTables.length === 0,
    checkedAt: new Date().toISOString(),
    requiredTableCount: requiredTables.length,
    missingTableCount: missingTables.length,
    requiredTables,
    missingMigrations,
  };
}
