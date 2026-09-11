import { openRuntimeDatabase } from './infrastructure/db/client.js';

// Diagnostic only. No server, profile creation, migration, worker or network dispatch.
const [command, path, ...extra] = process.argv.slice(2);
if (command !== '--check' || !path || extra.length > 0) {
  process.stderr.write('Usage: runtime --check /absolute/path/to/existing.db\n');
  process.exitCode = 2;
} else {
  try {
    const db = await openRuntimeDatabase(path);
    try {
      const [row] = await db.$queryRawUnsafe<Array<{ version: string }>>('SELECT sqlite_version() AS version');
      process.stdout.write(JSON.stringify({ status: 'database-check-passed', sqliteVersion: row?.version, journalMode: 'wal', httpListening: false }) + '\n');
    } finally { await db.$disconnect(); }
  } catch {
    // Do not expose a local file path or raw SQL/driver error through diagnostics.
    process.stderr.write('Database check failed. Verify the explicit file path, approved engine and completed migration; no migration was run.\n');
    process.exitCode = 1;
  }
}
