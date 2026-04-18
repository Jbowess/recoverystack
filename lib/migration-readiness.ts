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
  { table: 'pages', migration: '0002_recoverystack_core.sql' },
  { table: 'trends', migration: '0002_recoverystack_core.sql' },
  { table: 'products', migration: '0002_recoverystack_core.sql' },
  { table: 'internal_links', migration: '0001_init.sql' },
  { table: 'trend_queue', migration: '0001_init.sql' },
  { table: 'content_gaps', migration: '0001_init.sql' },
  { table: 'deploy_events', migration: '0003_ops_tables.sql' },
  { table: 'conversion_events', migration: '0003_ops_tables.sql' },
  { table: 'compatibility_checker_submissions', migration: '0004_compatibility_checker_submissions.sql' },
  { table: 'content_refresh_queue', migration: '0005_content_refresh_queue.sql' },
  { table: 'pipeline_runs', migration: '0006_pipeline_run_telemetry.sql' },
  { table: 'pipeline_steps', migration: '0006_pipeline_run_telemetry.sql' },
  { table: 'keyword_queue', migration: '0008_keyword_cluster_system.sql' },
  { table: 'briefs', migration: '0022_briefs.sql' },
  { table: 'product_specs', migration: '0030_information_gathering_tables.sql' },
  { table: 'page_conversion_aggregates', migration: '0032_tier1_tier2_tier3_tables.sql' },
  { table: 'distribution_assets', migration: '0034_distribution_engine.sql' },
  { table: 'outreach_queue', migration: '0034_distribution_engine.sql' },
  { table: 'email_digest_issues', migration: '0034_distribution_engine.sql' },
  { table: 'distribution_asset_metrics', migration: '0034_distribution_engine.sql' },
  { table: 'partner_contacts', migration: '0035_growth_execution_engine.sql' },
  { table: 'channel_publication_queue', migration: '0035_growth_execution_engine.sql' },
  { table: 'social_channel_metrics', migration: '0035_growth_execution_engine.sql' },
  { table: 'editorial_trust_profiles', migration: '0035_growth_execution_engine.sql' },
  { table: 'growth_roadmap_items', migration: '0035_growth_execution_engine.sql' },
  { table: 'product_truth_cards', migration: '0035_growth_execution_engine.sql' },
  { table: 'serp_snapshot_history', migration: '0036_growth_moat_systems.sql' },
  { table: 'competitor_page_snapshots', migration: '0036_growth_moat_systems.sql' },
  { table: 'community_topic_mentions', migration: '0036_growth_moat_systems.sql' },
  { table: 'creator_relationships', migration: '0036_growth_moat_systems.sql' },
  { table: 'outreach_reply_log', migration: '0036_growth_moat_systems.sql' },
  { table: 'conversion_experiments', migration: '0036_growth_moat_systems.sql' },
  { table: 'audience_segments', migration: '0036_growth_moat_systems.sql' },
  { table: 'brand_voice_profiles', migration: '0036_growth_moat_systems.sql' },
  { table: 'automation_policies', migration: '0036_growth_moat_systems.sql' },
  { table: 'pipeline_retry_jobs', migration: '0036_growth_moat_systems.sql' },
  { table: 'lead_magnet_offers', migration: '0036_growth_moat_systems.sql' },
  { table: 'tool_usage_events', migration: '0036_growth_moat_systems.sql' },
  { table: 'news_source_feeds', migration: '0027_newsroom_foundations.sql' },
  { table: 'news_source_events', migration: '0027_newsroom_foundations.sql' },
  { table: 'topic_entities', migration: '0027_newsroom_foundations.sql' },
  { table: 'topic_entity_aliases', migration: '0027_newsroom_foundations.sql' },
  { table: 'news_event_entities', migration: '0027_newsroom_foundations.sql' },
  { table: 'storylines', migration: '0027_newsroom_foundations.sql' },
  { table: 'storyline_events', migration: '0027_newsroom_foundations.sql' },
  { table: 'page_storylines', migration: '0027_newsroom_foundations.sql' },
  { table: 'entity_coverage_daily', migration: '0027_newsroom_foundations.sql' },
  { table: 'page_update_log', migration: '0027_newsroom_foundations.sql' },
  { table: 'source_watchlists', migration: '0031_editorial_intelligence_ops.sql' },
  { table: 'source_watchlist_hits', migration: '0031_editorial_intelligence_ops.sql' },
  { table: 'page_claims', migration: '0031_editorial_intelligence_ops.sql' },
  { table: 'claim_evidence_links', migration: '0031_editorial_intelligence_ops.sql' },
  { table: 'story_followup_jobs', migration: '0031_editorial_intelligence_ops.sql' },
  { table: 'comparison_dataset_snapshots', migration: '0031_editorial_intelligence_ops.sql' },
  { table: 'source_quality_scores', migration: '0031_editorial_intelligence_ops.sql' },
  { table: 'serp_winner_patterns', migration: '0031_editorial_intelligence_ops.sql' },
  { table: 'persona_distribution_queue', migration: '0031_editorial_intelligence_ops.sql' },
  { table: 'editorial_review_queue', migration: '0031_editorial_intelligence_ops.sql' },
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
