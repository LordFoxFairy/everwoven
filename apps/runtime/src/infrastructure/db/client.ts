import { stat, realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../../generated/prisma/client.js';

/** Internal connection factory. No HTTP access, automatic migration or profile bootstrap. */
export async function openRuntimeDatabase(path: string): Promise<PrismaClient> {
  if (!isAbsolute(path)) throw new Error('DATABASE_PATH_MUST_BE_ABSOLUTE');
  if (!(await stat(path)).isFile()) throw new Error('DATABASE_PATH_MUST_BE_FILE');
  const canonicalPath = await realpath(path);
  const adapter = new PrismaBetterSqlite3({ url: `file:${canonicalPath}`, fileMustExist: true, timeout: 100 });
  const client = new PrismaClient({ adapter });
  try {
    await client.$connect();
    const [row] = await client.$queryRawUnsafe<Array<{ version: string }>>('SELECT sqlite_version() AS version');
    const version = row?.version.split('.').map(Number);
    // Conservative approved WAL baseline; older backports require separate validation.
    if (!version || version.length !== 3 || version.some(n => !Number.isInteger(n)) ||
        version[0]! < 3 || (version[0] === 3 && (version[1]! < 53 || (version[1] === 53 && version[2]! < 1)))) {
      throw new Error('DATABASE_ENGINE_NOT_APPROVED');
    }
    const migrations = await client.$queryRawUnsafe<Array<{ migration_name: string; finished_at: unknown; rolled_back_at: unknown }>>(
      'SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations',
    );
    const active = migrations.filter(row => row.rolled_back_at === null);
    if (active.length !== 1 || active[0]?.migration_name !== '202609100001_m0_foundation' || active[0].finished_at === null) {
      throw new Error('DATABASE_MIGRATION_NOT_APPROVED');
    }
    const tables = await client.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations'",
    );
    const triggers = await client.$queryRawUnsafe<Array<{ name: string }>>("SELECT name FROM sqlite_master WHERE type='trigger'");
    if (tables.length !== 15 || triggers.length !== 0) throw new Error('DATABASE_SCHEMA_NOT_APPROVED');
    for (const { name } of tables) {
      const escapedName = name.replaceAll('"', '""');
      const keys = await client.$queryRawUnsafe(`PRAGMA foreign_key_list("${escapedName}")`);
      if (!Array.isArray(keys) || keys.length !== 0) throw new Error('DATABASE_SCHEMA_NOT_APPROVED');
    }
    const [journal] = await client.$queryRawUnsafe<Array<{ journal_mode: string }>>('PRAGMA journal_mode=WAL');
    if (journal?.journal_mode !== 'wal') throw new Error('DATABASE_WAL_REQUIRED');
    await client.$queryRawUnsafe('PRAGMA synchronous=FULL');
    await client.$queryRawUnsafe('PRAGMA foreign_keys=ON');
    const [fk] = await client.$queryRawUnsafe<Array<{ foreign_keys: bigint }>>('PRAGMA foreign_keys');
    if (fk?.foreign_keys !== 1n) throw new Error('DATABASE_CONNECTION_CONFIGURATION_FAILED');
    return client;
  } catch (error) {
    await client.$disconnect();
    throw error;
  }
}
