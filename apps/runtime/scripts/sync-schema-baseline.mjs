import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

// Development-only, in-memory fingerprint generation. Never opens a host database.
const mode = process.argv[2];
if (!['--check', '--write'].includes(mode) || process.argv.length !== 3) {
  throw new Error('Usage: node scripts/sync-schema-baseline.mjs --check|--write');
}
const names = ['202609120001_authoring_baseline', '202609130001_execution_profiles', '202609140001_generation_acceptance', '202609140002_text_observations'];
const migrations = await Promise.all(names.map(async name => ({name, sql: await readFile(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8')})));
const manifestURL = new URL('../src/infrastructure/db/schema-baseline.ts', import.meta.url);
const reviewURL = new URL('../../../docs/architecture/data/authoring.generated.sql', import.meta.url);
const sql = migrations.map(m => m.sql).join('\n');
const db = new DatabaseSync(':memory:');
let objects;
try {
  db.exec(sql);
  objects = db.prepare("SELECT type,name,tbl_name AS tableName,sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all();
  const tables = objects.filter(row => row.type === 'table');
  if (tables.length !== 23 || objects.filter(row => row.type === 'index' && row.sql.startsWith('CREATE UNIQUE INDEX')).length !== 16 ||
      objects.some(row => !['table', 'index'].includes(row.type))) throw new Error('BASELINE_REVIEW_REQUIRED');
  for (const table of tables) {
    if (db.prepare(`PRAGMA foreign_key_list("${table.name.replaceAll('"', '""')}")`).all().length) throw new Error('BASELINE_FOREIGN_KEY_FORBIDDEN');
  }
} finally {db.close();}
const source = `// Generated from reviewed migration-chain SQL, never from a user database.
// Exact sqlite_master DDL fingerprints cover names, columns, defaults, constraints,
// index column order/uniqueness/expressions and table options. No legacy allowlist.
export const approvedMigrations = ${JSON.stringify(migrations.map(({name, sql}) => ({name, checksum: createHash('sha256').update(sql).digest('hex')})), null, 2)} as const;
export const approvedSchemaObjects = [
${objects.map(row => `  ${JSON.stringify(row)}`).join(',\n')}
] as const;
`;
for (const [url, expected] of [[manifestURL, source], [reviewURL, migrations[0].sql], [new URL('../../../docs/architecture/data/execution-profiles.generated.sql', import.meta.url), migrations[1].sql], [new URL('../../../docs/architecture/data/generation-acceptance.generated.sql', import.meta.url), migrations[2].sql], [new URL('../../../docs/architecture/data/text-observations.generated.sql', import.meta.url), migrations[3].sql]]) {
  if (mode === '--write') await writeFile(url, expected);
  else if (await readFile(url, 'utf8') !== expected) throw new Error(`BASELINE_ARTIFACT_OUT_OF_SYNC: ${fileURLToPath(url)}`);
}
process.stdout.write(`Baseline ${mode === '--write' ? 'artifacts written' : 'artifacts verified'}; no user database opened.\n`);
