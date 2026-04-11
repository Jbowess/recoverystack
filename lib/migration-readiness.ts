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
