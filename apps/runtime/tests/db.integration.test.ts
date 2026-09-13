import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, copyFile, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { v7 } from 'uuid';
import { openRuntimeDatabase } from '../src/infrastructure/db/client.js';
import { withOwnerWrite } from '../src/infrastructure/db/write-gate.js';
import { renameStory } from '../src/infrastructure/db/story-repository.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let base: string;
let baseDir: string;
let dir: string;
let dbPath: string;
let clients: PrismaClient[] = [];

beforeAll(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'weiwan-m0-base-'));
  base = join(baseDir, 'base.db');
  await writeFile(base, '', {flag: 'wx', mode: 0o600});
  execFileSync(process.execPath, [join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: root, env: { ...process.env, RUNTIME_DATABASE_URL: `file:${base}` }, stdio: 'pipe',
  });
}, 30_000);
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'weiwan-m0-test-'));
  dbPath = join(dir, 'runtime.db');
  await copyFile(base, dbPath);
});
afterEach(async () => {
  await Promise.all(clients.map(client => client.$disconnect()));
  clients = [];
  await rm(dir, { recursive: true, force: true });
});
// Base is independent of each connection's WAL; cleanup only our temporary directory.
afterAll(async () => { if (baseDir) await rm(baseDir, { recursive: true, force: true }); });

async function connect(path = dbPath) {
  const client = await openRuntimeDatabase(path);
  clients.push(client);
  return client;
}

describe('M0 real Prisma / file-backed SQLite', () => {
  it('opens an existing migrated database with WAL and enforced FK pragma (schema still has zero FK)', async () => {
    const db = await connect();
    expect(await db.$queryRawUnsafe('PRAGMA journal_mode')).toEqual([{ journal_mode: 'wal' }]);
    expect(await db.$queryRawUnsafe('PRAGMA foreign_keys')).toEqual([{ foreign_keys: 1n }]);
    const tables = await db.$queryRawUnsafe<Array<{name: string}>>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\'");
    expect(tables).toHaveLength(17);
    for (const {name} of tables) {
      expect(await db.$queryRawUnsafe(`PRAGMA foreign_key_list("${name}")`)).toEqual([]);
    }
    expect(await db.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='trigger'")).toEqual([]);
  });

  it('round-trips JSON, UTC milliseconds and lossless BigInt after disconnect/reopen without cross-file leakage', async () => {
    const db = await connect();
    const ownerId = v7();
    const now = new Date('2026-09-10T12:34:56.789Z');
    await db.localProfile.create({data: {id: ownerId, displayName: '本地测试', createdAt: now, updatedAt: now}});
    const story = await db.storyDraft.create({data: {id: v7(), ownerId, title: '同名世界', settings: {world: '海边', opening: '', genre: '', playerRole: '', worldRules: ['尊重拒绝'], tone: ''}, createdAt: now, updatedAt: now}});
    const version = await db.storyVersion.create({data: {id: v7(), ownerId, storyDraftId: story.id, versionNo: 1, sourceRevision: 1, title: story.title, settings: {}, createdAt: now, sealedAt: now, contentHash: '0'.repeat(64)}});
    const binding = await db.providerBindingVersion.create({data: {id: v7(), ownerId, bindingKey: 'fixture', versionNo: 1, providerId: 'fixture', modelId: 'fixture', adapterVersion: '1', capabilityVersion: '1', mode: 'job', credentialRef: 'not-a-secret', parameters: {}, capabilities: {}, createdAt: now}});
    const exp = await db.experience.create({data: {id: v7(), ownerId, storyVersionId: version.id, providerBindingVersionId: binding.id, budgetLimitMicros: 9007199254740993n, budgetCurrency: 'CNY', createdAt: now, updatedAt: now}});
    await db.$disconnect();
    const reopened = await connect();
    expect((await reopened.storyDraft.findUniqueOrThrow({where: {id: story.id}})).settings).toEqual(story.settings);
    expect((await reopened.storyDraft.findUniqueOrThrow({where: {id: story.id}})).createdAt.toISOString()).toBe(now.toISOString());
    expect((await reopened.experience.findUniqueOrThrow({where: {id: exp.id}})).budgetLimitMicros).toBe(9007199254740993n);
    const otherPath = join(dir, 'other.db'); await copyFile(base, otherPath);
    const other = await connect(otherPath);
    expect(await other.storyDraft.count()).toBe(0);
  });

  it('refuses missing or relative database paths rather than silently creating user storage', async () => {
    await expect(openRuntimeDatabase(join(dir, 'missing.db'))).rejects.toThrow();
    await expect(openRuntimeDatabase('relative.db')).rejects.toThrow();
  });
});


async function seedStory(db: PrismaClient) {
  const ownerId = v7(); const now = new Date('2026-09-10T00:00:00.000Z');
  await db.localProfile.create({data: {id: ownerId, displayName: '测试', createdAt: now, updatedAt: now}});
  const story = await db.storyDraft.create({data: {id: v7(), ownerId, title: '初始标题', settings: {}, createdAt: now, updatedAt: now}});
  return {ownerId, story, now};
}

describe('WriteGate and minimal internal title-update repository', () => {
  it.each(['after_business', 'after_receipt'])('rolls back business, receipt and Gate epoch on failure %s', async point => {
    const db = await connect(); const {ownerId, story} = await seedStory(db);
    await expect(withOwnerWrite(db, ownerId, async tx => {
      await tx.storyDraft.update({where: {id: story.id}, data: {title: '不应保存'}});
      if (point === 'after_business') throw new Error('injected failure');
      await tx.commandReceipt.create({data: {id: v7(), ownerId, commandId: v7(), commandType: 'fixture', payloadHash: '0'.repeat(64), response: {}, createdAt: new Date()}});
      throw new Error('injected failure');
    })).rejects.toThrow('injected failure');
    await db.$disconnect(); const reopened = await connect();
    expect((await reopened.storyDraft.findUniqueOrThrow({where: {id: story.id}})).title).toBe(story.title);
    expect(await reopened.commandReceipt.count()).toBe(0);
    expect((await reopened.localProfile.findUniqueOrThrow({where: {id: ownerId}})).writeEpoch).toBe(0);
  });

  it('blocks missing/deleted owners before any business callback', async () => {
    const db = await connect(); const {ownerId} = await seedStory(db); let entered = false;
    await expect(withOwnerWrite(db, v7(), async () => {entered = true;})).rejects.toThrow('OWNER_UNAVAILABLE');
    await db.localProfile.update({where: {id: ownerId}, data: {deletedAt: new Date()}});
    await expect(withOwnerWrite(db, ownerId, async () => {entered = true;})).rejects.toThrow('OWNER_UNAVAILABLE');
    expect(entered).toBe(false);
  });

  it('commits once, replays the historical receipt after reopen, and rejects same-key different input', async () => {
    const db = await connect(); const {ownerId, story, now} = await seedStory(db);
    const input = {ownerId, storyId: story.id, expectedRevision: 1, commandId: v7(), title: '新标题'};
    const first = await renameStory(db, input);
    expect(first.revision).toBe(2);
    const stored = await db.storyDraft.findUniqueOrThrow({where: {id: story.id}});
    expect(stored.createdAt).toEqual(now); expect(stored.updatedAt.getTime()).toBeGreaterThan(now.getTime());
    await db.$disconnect(); const reopened = await connect();
    expect(await renameStory(reopened, input)).toEqual(first);
    await expect(renameStory(reopened, {...input, title: '偷换内容'})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    expect(await reopened.commandReceipt.count()).toBe(1);
    const receipt = await reopened.commandReceipt.findFirstOrThrow();
    expect(receipt.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect((await reopened.localProfile.findUniqueOrThrow({where: {id: ownerId}})).updatedAt).toEqual(now);
  });

  it('allows only one stale-revision writer across independent connections and rejects cross-owner/deleted writes', async () => {
    const db = await connect(); const other = await connect(); const {ownerId, story} = await seedStory(db);
    const first = await renameStory(db, {ownerId, storyId: story.id, commandId: v7(), expectedRevision: 1, title: '先到'});
    await expect(renameStory(other, {ownerId, storyId: story.id, commandId: v7(), expectedRevision: 1, title: '迟到'})).rejects.toThrow('REVISION_CONFLICT');
    const another = await seedStory(other);
    await expect(renameStory(other, {ownerId: another.ownerId, storyId: story.id, commandId: v7(), expectedRevision: 2, title: '越权'})).rejects.toThrow('STORY_NOT_FOUND');
    const stored = await other.storyDraft.findUniqueOrThrow({where: {id: story.id}});
    expect(stored.title).toBe(first.title); expect(stored.updatedAt.toISOString()).toBe(first.updatedAt);
    await other.storyDraft.update({where: {id: story.id}, data: {deletedAt: new Date()}});
    await expect(renameStory(db, {ownerId, storyId: story.id, commandId: v7(), expectedRevision: 2, title: '复活'})).rejects.toThrow('STORY_NOT_FOUND');
  });

  it('prevents a second connection from reading inside its write use-case while another owns the Gate', async () => {
    const a = await connect(); const b = await connect(); const {ownerId, story} = await seedStory(a);
    const started = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>();
    let enteredB = false;
    const held = withOwnerWrite(a, ownerId, async tx => {
      await tx.storyDraft.update({where: {id: story.id}, data: {title: '已拿到写锁'}});
      started.resolve(); await release.promise;
    });
    // Propagate unexpected early failure rather than hanging the test.
    await Promise.race([started.promise, held]);
    try {
      await expect(withOwnerWrite(b, ownerId, async tx => {enteredB = true; return tx.storyDraft.count();})).rejects.toThrow();
      expect(enteredB).toBe(false);
    } finally { release.resolve(); await held; }
    expect(await withOwnerWrite(b, ownerId, async tx => (await tx.storyDraft.findUniqueOrThrow({where: {id: story.id}})).title)).toBe('已拿到写锁');
  });
});


describe('database guardrails and standalone diagnostic entry', () => {
  it('matches all 14 reviewed unique indexes by name and columns, with 17 primary keys', async () => {
    const db = await connect();
    const migration = await readFile(join(root, 'prisma/migrations/202609120001_authoring_baseline/migration.sql'), 'utf8');
    const review = await readFile(join(root, '../../docs/architecture/data/authoring.generated.sql'), 'utf8');
    expect(migration.trim()).toBe(review.trim());
    const profileSQL = await readFile(join(root, 'prisma/migrations/202609130001_execution_profiles/migration.sql'), 'utf8');
    expect(profileSQL).toBe(await readFile(join(root, '../../docs/architecture/data/execution-profiles.generated.sql'), 'utf8'));
    const sql = migration + '\n' + profileSQL;
    const expected = [...sql.matchAll(/CREATE UNIQUE INDEX "([^"]+)" ON "([^"]+)"\(([^)]+)\)/g)]
      .map(m => ({name: m[1]!, table: m[2]!, columns: m[3]!.replaceAll('"', '').split(',').map(v => v.trim())}));
    expect(expected).toHaveLength(14);
    const actual = await db.$queryRawUnsafe<Array<{name: string}>>("SELECT name FROM sqlite_master WHERE type='index' AND sql LIKE 'CREATE UNIQUE INDEX%'");
    expect(actual.map(v => v.name).sort()).toEqual(expected.map(v => v.name).sort());
    for (const index of expected) {
      const columns = await db.$queryRawUnsafe<Array<{name: string}>>(`PRAGMA index_info("${index.name}")`);
      expect(columns.map(v => v.name)).toEqual(index.columns);
    }
    const tables = [...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map(m => m[1]!);
    for (const name of tables) {
      const columns = await db.$queryRawUnsafe<Array<{name: string; pk: bigint}>>(`PRAGMA table_info("${name}")`);
      expect(columns.filter(v => v.pk !== 0n).map(v => v.name)).toEqual(['id']);
    }
  });

  it('permits repeated titles and content hashes but rejects duplicate storage keys', async () => {
    const db = await connect(); const {ownerId, story, now} = await seedStory(db);
    await db.storyDraft.create({data: {id: v7(), ownerId, title: story.title, settings: {}, createdAt: now, updatedAt: now}});
    const asset = {originalName: 'fixture.png', width: 256, height: 256, ownerId, storageKey: 'one', sha256: '0'.repeat(64), mimeType: 'image/png', byteSize: 1n, rightsDeclaration: 'fixture', createdAt: now, updatedAt: now};
    await db.asset.create({data: {...asset, id: v7()}});
    await db.asset.create({data: {...asset, id: v7(), storageKey: 'two'}});
    await expect(db.asset.create({data: {...asset, id: v7()}})).rejects.toMatchObject({code: 'P2002'});
    expect(await db.storyDraft.count()).toBe(2); expect(await db.asset.count()).toBe(2);
  });

  it('rejects an unexpected FK or trigger schema instead of using foreign_keys=OFF to disguise it', async () => {
    const db = await connect();
    await db.$executeRawUnsafe('ALTER TABLE story_drafts ADD COLUMN illegal_owner TEXT REFERENCES local_profiles(id)');
    // Keep 17 business tables so the precise DDL check can reject this schema.
    const status = await openRuntimeDatabase(dbPath).then(async client => { await client.$disconnect(); return 'opened'; }, error => error.message);
    expect(status).toBe('DATABASE_SCHEMA_NOT_APPROVED');
    await db.$executeRawUnsafe('ALTER TABLE story_drafts DROP COLUMN illegal_owner');
    await db.$executeRawUnsafe('CREATE TRIGGER illegal_trigger AFTER UPDATE ON story_drafts BEGIN SELECT 1; END');
    const triggerStatus = await openRuntimeDatabase(dbPath).then(async client => { await client.$disconnect(); return 'opened'; }, error => error.message);
    expect(triggerStatus).toBe('DATABASE_SCHEMA_NOT_APPROVED');
  });

  it('rejects incomplete migrations on reopen', async () => {
    const db = await connect();
    await db.$executeRawUnsafe('UPDATE _prisma_migrations SET finished_at = NULL');
    await expect(openRuntimeDatabase(dbPath)).rejects.toThrow('DATABASE_MIGRATION_NOT_APPROVED');
  });

  it('checks a prepared database through a separate process without opening HTTP or emitting private paths', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/main.ts', '--check', dbPath], {cwd: root, encoding: 'utf8'});
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.status).toBe('database-check-passed');
    expect(output.sqliteVersion).toMatch(/^3\.\d+\.\d+$/);
    expect(output.httpListening).toBe(false);
    expect(result.stdout).not.toContain(dbPath);
  });
});

// A matching table count is not a matching schema. These cases preserve the count.
describe('approved baseline structural identity', () => {
  it.each([
    ['renamed table', 'ALTER TABLE story_drafts RENAME TO wrong_story_table'],
    ['extra column', 'ALTER TABLE story_drafts ADD COLUMN unapproved TEXT'],
    ['missing column', 'ALTER TABLE story_drafts DROP COLUMN settings'],
    ['missing index', 'DROP INDEX ix_story_drafts_owner_list'],
    ['extra index', 'CREATE INDEX unapproved_index ON story_drafts(title)'],
    ['trigger named like the migration table', 'CREATE TRIGGER _prisma_migrations AFTER INSERT ON story_drafts BEGIN DELETE FROM story_drafts WHERE id = NEW.id; END'],
    ['migration-table trigger', 'CREATE TRIGGER wrong_migration_trigger AFTER UPDATE ON _prisma_migrations BEGIN SELECT 1; END'],
    ['near-internal-name view', 'CREATE VIEW sqlitex_unapproved AS SELECT id FROM story_drafts'],
    ['changed index order', 'DROP INDEX ix_story_drafts_owner_list'],
  ])('rejects %s even with the approved table count', async (kind, sql) => {
    const db = await connect();
    await db.$executeRawUnsafe(sql);
    if (kind === 'changed index order') await db.$executeRawUnsafe('CREATE INDEX ix_story_drafts_owner_list ON story_drafts(id, owner_id)');
    const outcome = await openRuntimeDatabase(dbPath).then(async client => {await client.$disconnect(); return 'opened';}, (error: Error) => error.message);
    expect(outcome).toBe('DATABASE_SCHEMA_NOT_APPROVED');
  });
  it('rejects a changed migration checksum', async () => {
    const db = await connect();
    await db.$executeRawUnsafe("UPDATE _prisma_migrations SET checksum = 'unapproved'");
    const outcome = await openRuntimeDatabase(dbPath).then(async client => {await client.$disconnect(); return 'opened';}, (error: Error) => error.message);
    expect(outcome).toBe('DATABASE_MIGRATION_NOT_APPROVED');
  });
});


describe('clean authoring baseline fields', () => {
  it('keeps the reviewed SQL and runtime fingerprints reproducible', () => {
    const result = spawnSync(process.execPath, [join(root, 'scripts/sync-schema-baseline.mjs'), '--check'], {cwd: root, encoding: 'utf8'});
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('artifacts verified');
  });
  it('persists scoped characters, complete asset metadata and upload intents after reopening', async () => {
    const db = await connect(); const {ownerId, story, now} = await seedStory(db);
    const library = await db.characterTemplate.create({data: {id: v7(), ownerId, name: '可重复姓名', settings: {}, createdAt: now, updatedAt: now}});
    expect(library.scope).toBe('library'); expect(library.sourceStoryDraftId).toBeNull();
    const inline = await db.characterTemplate.create({data: {id: v7(), ownerId, name: library.name, scope: 'story', sourceStoryDraftId: story.id, settings: {}, createdAt: now, updatedAt: now}});
    const asset = await db.asset.create({data: {id: v7(), ownerId, storageKey: 'reviewed-file.webp', originalName: '用户图片.png', width: 1024, height: 768, mimeType: 'image/webp', byteSize: 1234n, sha256: 'a'.repeat(64), rightsDeclaration: 'user-confirmed', status: 'ready', createdAt: now, updatedAt: now}});
    const upload = await db.assetUpload.create({data: {id: v7(), ownerId, assetId: v7(), inputSha256: 'b'.repeat(64), inputByteSize: 2468n, originalName: '待上传.jpg', rightsDeclaration: 'user-confirmed', status: 'reserved', createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + 86400000)}});
    await db.$disconnect(); const reopened = await connect();
    expect(await reopened.characterTemplate.findUnique({where: {id: inline.id}})).toMatchObject({scope: 'story', sourceStoryDraftId: story.id});
    expect(await reopened.asset.findUnique({where: {id: asset.id}})).toMatchObject({width: 1024, height: 768, originalName: '用户图片.png', byteSize: 1234n});
    expect(await reopened.assetUpload.findUnique({where: {id: upload.id}})).toMatchObject({assetId: upload.assetId, inputByteSize: 2468n, status: 'reserved', processingToken: null, leaseExpiresAt: null, revision: 1});
  });
});

// Every predecessor remains mandatory; this is not a legacy schema acceptance mode.
describe('approved complete migration chain', () => {
  it.each(['202609120001_authoring_baseline', '202609130001_execution_profiles'])('rejects altered or missing predecessor %s', async name => {
    const db = await connect();
    await db.$executeRawUnsafe('UPDATE _prisma_migrations SET checksum = ? WHERE migration_name = ?', 'wrong', name);
    await expect(openRuntimeDatabase(dbPath)).rejects.toThrow('DATABASE_MIGRATION_NOT_APPROVED');
    await db.$executeRawUnsafe('DELETE FROM _prisma_migrations WHERE migration_name = ?', name);
    await expect(openRuntimeDatabase(dbPath)).rejects.toThrow('DATABASE_MIGRATION_NOT_APPROVED');
  });
});


describe('non-destructive explicit profile migration', () => {
  it('upgrades the exact previous schema without changing existing business rows or baseline history', async () => {
    const db = await connect(); const {ownerId, story} = await seedStory(db);
    const before = await db.localProfile.findUniqueOrThrow({where: {id: ownerId}});
    const history = await db.$queryRawUnsafe<Array<{checksum:string}>>("SELECT checksum FROM _prisma_migrations WHERE migration_name = '202609120001_authoring_baseline'");
    // Return only this disposable database to the previously approved exact schema.
    await db.$executeRawUnsafe('DROP TABLE execution_profile_versions');
    await db.$executeRawUnsafe("DELETE FROM _prisma_migrations WHERE migration_name = '202609130001_execution_profiles'");
    await db.$disconnect();
    await expect(openRuntimeDatabase(dbPath)).rejects.toThrow('DATABASE_MIGRATION_NOT_APPROVED');
    execFileSync(process.execPath, [join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
      cwd: root, env: {...process.env, RUNTIME_DATABASE_URL: `file:${dbPath}`}, stdio: 'pipe',
    });
    const reopened = await connect();
    expect(await reopened.localProfile.findUniqueOrThrow({where:{id:ownerId}})).toEqual(before);
    expect(await reopened.storyDraft.findUniqueOrThrow({where:{id:story.id}})).toEqual(story);
    expect(await reopened.executionProfileVersion.count()).toBe(0);
    expect(await reopened.$queryRawUnsafe("SELECT checksum FROM _prisma_migrations WHERE migration_name = '202609120001_authoring_baseline'")).toEqual(history);
  });
});
