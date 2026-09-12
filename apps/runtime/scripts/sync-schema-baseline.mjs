import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

// Development-only, in-memory fingerprint generation. Never opens a host database.
const mode = process.argv[2];
if (!['--check', '--write'].includes(mode) || process.argv.length !== 3) {
  throw new Error('Usage: node scripts/sync-schema-baseline.mjs --check|--write');
}
const name = '202609120001_authoring_baseline';
const sqlURL = new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url);
const manifestURL = new URL('../src/infrastructure/db/schema-baseline.ts', import.meta.url);
const reviewURL = new URL('../../../docs/architecture/data/authoring.generated.sql', import.meta.url);
const sql = await readFile(sqlURL, 'utf8');
const db = new DatabaseSync(':memory:');
let objects;
try {
  db.exec(sql);
  objects = db.prepare("SELECT type,name,tbl_name AS tableName,sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all();
  const tables = objects.filter(row => row.type === 'table');
  if (tables.length !== 16 || objects.filter(row => row.type === 'index' && row.sql.startsWith('CREATE UNIQUE INDEX')).length !== 13 ||
      objects.some(row => !['table', 'index'].includes(row.type))) throw new Error('BASELINE_REVIEW_REQUIRED');
  for (const table of tables) {
    if (db.prepare(`PRAGMA foreign_key_list("${table.name.replaceAll('"', '""')}")`).all().length) throw new Error('BASELINE_FOREIGN_KEY_FORBIDDEN');
  }
} finally {db.close();}
const source = `// Generated from reviewed clean baseline SQL, never from a user database.
// Exact sqlite_master DDL fingerprints cover names, columns, defaults, constraints,
// index column order/uniqueness/expressions and table options. No legacy allowlist.
export const approvedMigration = {
  name: '${name}',
  checksum: '${createHash('sha256').update(sql).digest('hex')}',
} as const;
export const approvedSchemaObjects = [
${objects.map(row => `  ${JSON.stringify(row)}`).join(',\n')}
] as const;
`;
for (const [url, expected] of [[manifestURL, source], [reviewURL, sql]]) {
  if (mode === '--write') await writeFile(url, expected);
  else if (await readFile(url, 'utf8') !== expected) throw new Error(`BASELINE_ARTIFACT_OUT_OF_SYNC: ${fileURLToPath(url)}`);
}
process.stdout.write(`Baseline ${mode === '--write' ? 'artifacts written' : 'artifacts verified'}; no user database opened.\n`);
