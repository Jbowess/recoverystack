import { readdirSync } from 'node:fs';
import path from 'node:path';

const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');
const files = readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort((a, b) => a.localeCompare(b));

const versionToFiles = new Map<string, string[]>();
let previousVersion = -1;

for (const file of files) {
  const match = file.match(/^(\d+)_/);
  if (!match) {
    throw new Error(`Invalid migration filename: ${file}`);
  }

  const version = match[1];
  const numericVersion = Number.parseInt(version, 10);

  if (!Number.isFinite(numericVersion)) {
    throw new Error(`Invalid numeric migration prefix: ${file}`);
  }

  const siblings = versionToFiles.get(version) ?? [];
  siblings.push(file);
  versionToFiles.set(version, siblings);

  if (numericVersion <= previousVersion) {
    throw new Error(
      `Migration order is not strictly increasing around ${file}. ` +
        `Previous version: ${previousVersion}, current version: ${numericVersion}.`,
    );
  }

  previousVersion = numericVersion;
}

const duplicates = [...versionToFiles.entries()].filter(([, siblingFiles]) => siblingFiles.length > 1);
if (duplicates.length > 0) {
  const detail = duplicates
    .map(([version, siblingFiles]) => `${version}: ${siblingFiles.join(', ')}`)
    .join('\n');
  throw new Error(`Duplicate migration prefixes detected:\n${detail}`);
}

console.log(`Migration history is valid. Checked ${files.length} migration files.`);
