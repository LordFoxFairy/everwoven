import { stat, realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../../generated/prisma/client.js';
import {approvedMigration, approvedSchemaObjects} from './schema-baseline.js';

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
    const migrations = await client.$queryRawUnsafe<Array<{migration_name: string; checksum: string; finished_at: unknown; rolled_back_at: unknown}>>(
      'SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations',
    );
    const migration = migrations[0];
    if (migrations.length !== 1 || !migration || migration.migration_name !== approvedMigration.name ||
        migration.checksum !== approvedMigration.checksum || migration.finished_at === null || migration.rolled_back_at !== null) {
      throw new Error('DATABASE_MIGRATION_NOT_APPROVED');
    }
    // Match the actual persisted DDL, not only table count or migration bookkeeping.
    // Exclude only SQLite internals and the migration table itself, not arbitrary
    // indexes/triggers attached to that table. GLOB keeps underscore literal.
    // Extra views/triggers/tables/indexes, altered columns/defaults/PKs and changed
    // index order/uniqueness all differ from this single approved baseline.
    const objects = await client.$queryRawUnsafe<Array<{type: string; name: string; tableName: string; sql: string | null}>>(
      "SELECT type, name, tbl_name AS tableName, sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' AND NOT (type = 'table' AND name = '_prisma_migrations') ORDER BY type, name",
    );
    if (objects.length !== approvedSchemaObjects.length || objects.some((object, index) => {
      const expected = approvedSchemaObjects[index];
      return !expected || object.type !== expected.type || object.name !== expected.name ||
        object.tableName !== expected.tableName || object.sql !== expected.sql;
    })) throw new Error('DATABASE_SCHEMA_NOT_APPROVED');
    for (const object of objects.filter(object => object.type === 'table')) {
      const escapedName = object.name.replaceAll('"', '""');
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
