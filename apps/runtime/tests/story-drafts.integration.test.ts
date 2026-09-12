import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import {mkdtemp, copyFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {v7} from 'uuid';
import {openRuntimeDatabase} from '../src/infrastructure/db/client.js';
import type {PrismaClient} from '../src/generated/prisma/client.js';
import {createDraft, getDraft, listDrafts, updateDraft, deleteDraft, restoreDraft} from '../src/application/story-drafts.js';
import type {StorySettings} from '../src/contracts/story-draft.js';
import {PrismaStoryDraftStore} from '../src/infrastructure/db/prisma-story-draft-store.js';
import {createStoryDraftService} from '../src/composition/story-draft-service.js';
import type {StoryDraftInsert, StoryReceiptInsert} from '../src/ports/story-draft-store.js';

const datasetId = '01994b80-0000-7000-8000-000000000099';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let baseDir: string, base: string, dir: string, path: string, db: PrismaClient;
let connections: PrismaClient[] = [];
let owner: {ownerId: string; datasetId: string};
const settings: StorySettings = {world: '', opening: '', genre: '', playerRole: '', worldRules: [], tone: ''};
const command = (title = '新的世界') => ({datasetId, commandId: v7(), title, settings: structuredClone(settings)});
async function connect() {const client = await openRuntimeDatabase(path); connections.push(client); return client;}
beforeAll(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'weiwan-m0b-base-')); base = join(baseDir, 'base.db');
  await writeFile(base, '', {flag: 'wx', mode: 0o600});
  execFileSync(process.execPath, [join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {cwd: root, env: {...process.env, RUNTIME_DATABASE_URL: `file:${base}`}, stdio: 'pipe'});
}, 30_000);
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'weiwan-m0b-test-')); path = join(dir, 'runtime.db'); await copyFile(base, path);
  db = await connect(); owner = {datasetId, ownerId: v7()}; const now = new Date();
  // Host/test initialization is not an exposed business operation.
  await db.localProfile.create({data: {id: owner.ownerId, displayName: '测试身份', createdAt: now, updatedAt: now}});
});

afterEach(async () => {await Promise.all(connections.map(client => client.$disconnect())); connections = []; await rm(dir, {recursive: true, force: true});});
afterAll(async () => {if (baseDir) await rm(baseDir, {recursive: true, force: true});});

const uuid7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
describe('internal story root CRUD on a real SQLite file', () => {
  it('saves incomplete settings, generates server IDs and survives disconnect/reopen', async () => {
    const result = await createDraft(new PrismaStoryDraftStore(db), owner, command());
    expect(result.replayed).toBe(false); expect(result.data.id).toMatch(uuid7); expect(result.data.revision).toBe(1);
    expect(result.data.createdAt).toBe(result.data.updatedAt); expect(result.data.deletedAt).toBeNull();
    expect(result.data.settings).toEqual(settings); expect(result.data).not.toHaveProperty('ownerId');
    await db.$disconnect(); const reopened = await connect();
    expect(await getDraft(new PrismaStoryDraftStore(reopened), owner, result.data.id)).toEqual(result.data);
  });
  it('updates only provided fields, preserves createdAt, and advances CAS revision', async () => {
    const {data: created} = await createDraft(new PrismaStoryDraftStore(db), owner, command());
    const {data: changed} = await updateDraft(new PrismaStoryDraftStore(db), owner, {datasetId, commandId: v7(), id: created.id, expectedRevision: 1, patch: {title: '打磨后的世界'}});
    expect(changed.title).toBe('打磨后的世界'); expect(changed.settings).toEqual(settings); expect(changed.createdAt).toBe(created.createdAt); expect(changed.revision).toBe(2);
    const replacement = {world: '一座安静的海边小镇', opening: '收到一封来信', genre: '日常',
      playerRole: '旅人', worldRules: ['不替玩家决定感情'], tone: '温柔'};
    const {data: next} = await updateDraft(new PrismaStoryDraftStore(db), owner, {datasetId, commandId: v7(), id: created.id, expectedRevision: 2, patch: {settings: replacement}});
    expect(next.settings).toEqual(replacement); expect(next.title).toBe(changed.title); expect(next.revision).toBe(3);
  });
  it('soft-deletes, hides default reads, and restores with a new revision', async () => {
    const {data} = await createDraft(new PrismaStoryDraftStore(db), owner, command());
    const deleted = await deleteDraft(new PrismaStoryDraftStore(db), owner, {datasetId, commandId: v7(), id: data.id, expectedRevision: 1});
    expect(deleted.data.deletedAt).toBe(deleted.data.updatedAt); expect(deleted.data.revision).toBe(2);
    await expect(getDraft(new PrismaStoryDraftStore(db), owner, data.id)).rejects.toThrow('STORY_NOT_FOUND');
    expect((await listDrafts(new PrismaStoryDraftStore(db), owner)).items).toEqual([]);
    expect((await listDrafts(new PrismaStoryDraftStore(db), owner, {deleted: 'only'})).items).toEqual([deleted.data]);
    expect(await getDraft(new PrismaStoryDraftStore(db), owner, data.id, true)).toEqual(deleted.data);
    const restored = await restoreDraft(new PrismaStoryDraftStore(db), owner, {datasetId, commandId: v7(), id: data.id, expectedRevision: 2});
    expect(restored.data.revision).toBe(3); expect(restored.data.deletedAt).toBeNull(); expect(restored.data.createdAt).toBe(data.createdAt);
  });
  it('replays create/update/delete receipts across reopen, not a new business operation', async () => {
    const input = command(); const created = await createDraft(new PrismaStoryDraftStore(db), owner, input);
    const update = {datasetId, commandId: v7(), id: created.data.id, expectedRevision: 1, patch: {title: '已修改'}};
    const changed = await updateDraft(new PrismaStoryDraftStore(db), owner, update);
    expect(await createDraft(new PrismaStoryDraftStore(db), owner, input)).toEqual({...created, replayed: true});
    const deletion = {datasetId, commandId: v7(), id: created.data.id, expectedRevision: 2};
    const deleted = await deleteDraft(new PrismaStoryDraftStore(db), owner, deletion); await db.$disconnect(); const reopened = await connect();
    expect(await deleteDraft(new PrismaStoryDraftStore(reopened), owner, deletion)).toEqual({...deleted, replayed: true});
    expect(await updateDraft(new PrismaStoryDraftStore(reopened), owner, update)).toEqual({...changed, replayed: true});
    expect(await reopened.storyDraft.count()).toBe(1); expect(await reopened.commandReceipt.count()).toBe(3);
    expect((await getDraft(new PrismaStoryDraftStore(reopened), owner, created.data.id, true)).revision).toBe(3);
  });
  it('canonicalizes settings key order but rejects changed payloads and command types', async () => {
    const input = command(); const created = await createDraft(new PrismaStoryDraftStore(db), owner, input);
    expect((await createDraft(new PrismaStoryDraftStore(db), owner, {...input, settings: {tone: '', worldRules: [], playerRole: '', genre: '', opening: '', world: ''}})).replayed).toBe(true);
    await expect(createDraft(new PrismaStoryDraftStore(db), owner, {...input, title: '不同内容'})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    await expect(deleteDraft(new PrismaStoryDraftStore(db), owner, {datasetId, commandId: input.commandId, id: created.data.id, expectedRevision: 1})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });
  it('isolates reads, lists and all write actions by active owner', async () => {
    const {data} = await createDraft(new PrismaStoryDraftStore(db), owner, command()); const other = {datasetId, ownerId: v7()}; const now = new Date();
    await db.localProfile.create({data: {id: other.ownerId, displayName: '另一身份', createdAt: now, updatedAt: now}});
    expect((await listDrafts(new PrismaStoryDraftStore(db), other)).items).toEqual([]);
    await expect(getDraft(new PrismaStoryDraftStore(db), other, data.id, true)).rejects.toThrow('STORY_NOT_FOUND');
    await expect(updateDraft(new PrismaStoryDraftStore(db), other, {datasetId, commandId: v7(), id: data.id, expectedRevision: 1, patch: {title: '越权'}})).rejects.toThrow('STORY_NOT_FOUND');
    await expect(deleteDraft(new PrismaStoryDraftStore(db), other, {datasetId, commandId: v7(), id: data.id, expectedRevision: 1})).rejects.toThrow('STORY_NOT_FOUND');
    await expect(restoreDraft(new PrismaStoryDraftStore(db), other, {datasetId, commandId: v7(), id: data.id, expectedRevision: 1})).rejects.toThrow('STORY_NOT_FOUND');
    await db.localProfile.update({where: {id: owner.ownerId}, data: {deletedAt: now}});
    await expect(getDraft(new PrismaStoryDraftStore(db), owner, data.id)).rejects.toThrow('OWNER_UNAVAILABLE');
    await expect(listDrafts(new PrismaStoryDraftStore(db), owner)).rejects.toThrow('OWNER_UNAVAILABLE');
    await expect(createDraft(new PrismaStoryDraftStore(db), owner, command())).rejects.toThrow('OWNER_UNAVAILABLE');
  });
  it('rejects stale update/delete/restore without changing data or receipts', async () => {
    const {data} = await createDraft(new PrismaStoryDraftStore(db), owner, command()); const second = await connect();
    await updateDraft(new PrismaStoryDraftStore(db), owner, {datasetId, commandId: v7(), id: data.id, expectedRevision: 1, patch: {title: '先保存'}});
    await expect(updateDraft(new PrismaStoryDraftStore(second), owner, {datasetId, commandId: v7(), id: data.id, expectedRevision: 1, patch: {title: '旧窗口'}})).rejects.toThrow('REVISION_CONFLICT');
    await expect(deleteDraft(new PrismaStoryDraftStore(second), owner, {datasetId, commandId: v7(), id: data.id, expectedRevision: 1})).rejects.toThrow('REVISION_CONFLICT');
    await deleteDraft(new PrismaStoryDraftStore(db), owner, {datasetId, commandId: v7(), id: data.id, expectedRevision: 2});
    await expect(restoreDraft(new PrismaStoryDraftStore(second), owner, {datasetId, commandId: v7(), id: data.id, expectedRevision: 2})).rejects.toThrow('REVISION_CONFLICT');
    expect(await db.commandReceipt.count()).toBe(3);
  });
  it('allows same-name stories and keyset pagination without duplicates on stable data', async () => {
    for (let i = 0; i < 5; i++) await createDraft(new PrismaStoryDraftStore(db), owner, command('同名'));
    const first = await listDrafts(new PrismaStoryDraftStore(db), owner, {limit: 2});
    const second = await listDrafts(new PrismaStoryDraftStore(db), owner, {limit: 2, cursor: first.nextCursor!});
    const third = await listDrafts(new PrismaStoryDraftStore(db), owner, {limit: 2, cursor: second.nextCursor!});
    expect(first.items).toHaveLength(2); expect(second.items).toHaveLength(2); expect(third.items).toHaveLength(1); expect(third.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items, ...third.items].map(item => item.id)).size).toBe(5);
    await expect(listDrafts(new PrismaStoryDraftStore(db), owner, {cursor: first.nextCursor!, deleted: 'only'})).rejects.toThrow('INVALID_CURSOR');
  });
  it('does not cascade deletion into frozen versions', async () => {
    const {data} = await createDraft(new PrismaStoryDraftStore(db), owner, command()); const now = new Date(), versionId = v7();
    await db.storyVersion.create({data: {id: versionId, ownerId: owner.ownerId, storyDraftId: data.id, title: data.title, settings: {...settings}, versionNo: 1, sourceRevision: 1, createdAt: now, sealedAt: now, contentHash: '0'.repeat(64)}});
    await deleteDraft(new PrismaStoryDraftStore(db), owner, {datasetId, commandId: v7(), id: data.id, expectedRevision: 1});
    expect(await db.storyVersion.count({where: {id: versionId}})).toBe(1);
    expect(await db.storyDraft.count({where: {id: data.id}})).toBe(1);
    expect(await db.$queryRawUnsafe('PRAGMA foreign_key_list("story_drafts")')).toEqual([]);
  });
  it.each([
    {title: '  '}, {title: 'x'.repeat(121)}, {id: v7()}, {ownerId: v7()},
    {commandId: 'not-an-id'}, {settings: {...settings, hidden: true}},
    {settings: {...settings, worldRules: Array(31).fill('rule')}},
    {settings: {...settings, world: 'x'.repeat(12001)}},
  ])('rejects invalid create data with no persisted side effects (%#)', async patch => {
    await expect(createDraft(new PrismaStoryDraftStore(db), owner, {...command(), ...patch} as never)).rejects.toThrow('INVALID_STORY_COMMAND');
    expect(await db.storyDraft.count()).toBe(0); expect(await db.commandReceipt.count()).toBe(0);
    expect((await db.localProfile.findUniqueOrThrow({where: {id: owner.ownerId}})).writeEpoch).toBe(0);
  });
  it('rejects empty/unknown updates, invalid limits and forged cursor scope', async () => {
    const {data} = await createDraft(new PrismaStoryDraftStore(db), owner, command());
    for (const patch of [{}, {title: null}, {ownerId: v7()}, {settings: {world: 'partial'}}]) {
      await expect(updateDraft(new PrismaStoryDraftStore(db), owner, {datasetId, commandId: v7(), id: data.id, expectedRevision: 1, patch} as never)).rejects.toThrow('INVALID_STORY_COMMAND');
    }
    for (const input of [{limit: 0}, {limit: 101}, {limit: 1.5}, {cursor: 'invalid'}]) await expect(listDrafts(new PrismaStoryDraftStore(db), owner, input)).rejects.toThrow();
    expect((await getDraft(new PrismaStoryDraftStore(db), owner, data.id)).revision).toBe(1);
  });
  it('uses the injected Clock/IdFactory and never moves updatedAt backwards', async () => {
    const createdAt = new Date('2026-09-10T12:00:00.123Z');
    const services = {clock: {now: () => createdAt}, ids: {next: () => v7()}};
    const {data} = await createDraft(new PrismaStoryDraftStore(db), owner, command(), services);
    expect(data.createdAt).toBe(createdAt.toISOString());
    const backwards = {...services, clock: {now: () => new Date('2020-01-01T00:00:00.000Z')}};
    const updated = await updateDraft(new PrismaStoryDraftStore(db), owner, {datasetId, commandId: v7(), id: data.id, expectedRevision: 1, patch: {title: '时钟倒退时也保留顺序'}}, backwards);
    expect(updated.data.updatedAt).toBe(data.updatedAt); expect(updated.data.revision).toBe(2);
  });
  it('rolls back the created root and Gate if receipt ID generation fails after business write', async () => {
    let calls = 0;
    const input = command();
    const services = {clock: {now: () => new Date()}, ids: {next: () => {if (++calls === 2) throw new Error('injected receipt failure');return v7();}}};
    await expect(createDraft(new PrismaStoryDraftStore(db), owner, input, services)).rejects.toThrow('injected receipt failure');
    expect(await db.storyDraft.count()).toBe(0); expect(await db.commandReceipt.count()).toBe(0);
    expect((await db.localProfile.findUniqueOrThrow({where: {id: owner.ownerId}})).writeEpoch).toBe(0);
    await db.$disconnect(); const reopened = await connect();
    expect((await createDraft(new PrismaStoryDraftStore(reopened), owner, input)).replayed).toBe(false);
    expect(await reopened.storyDraft.count()).toBe(1);
  });
  it('rolls back an update if receipt insertion fails instead of leaving half a command', async () => {
    const {data} = await createDraft(new PrismaStoryDraftStore(db), owner, command()); const receipt = await db.commandReceipt.findFirstOrThrow();
    const before = await db.localProfile.findUniqueOrThrow({where: {id: owner.ownerId}});
    const services = {clock: {now: () => new Date()}, ids: {next: () => receipt.id}};
    await expect(updateDraft(new PrismaStoryDraftStore(db), owner, {datasetId, commandId: v7(), id: data.id, expectedRevision: 1, patch: {title: '不应留下'}}, services)).rejects.toMatchObject({code: 'P2002'});
    expect(await getDraft(new PrismaStoryDraftStore(db), owner, data.id)).toEqual(data); expect(await db.commandReceipt.count()).toBe(1);
    expect((await db.localProfile.findUniqueOrThrow({where: {id: owner.ownerId}})).writeEpoch).toBe(before.writeEpoch);
  });
  it.each(['invalid-clock', 'invalid-id'])('rejects broken runtime services atomically: %s', async failure => {
    const services = {clock: {now: () => failure === 'invalid-clock' ? new Date(NaN) : new Date()}, ids: {next: () => 'bad-id'}};
    await expect(createDraft(new PrismaStoryDraftStore(db), owner, command(), services)).rejects.toThrow(failure === 'invalid-clock' ? 'CLOCK_INVALID' : 'ID_FACTORY_INVALID');
    expect(await db.storyDraft.count()).toBe(0); expect(await db.commandReceipt.count()).toBe(0);
  });
  it('rejects corrupt or future receipts without retrying the business operation', async () => {
    const input = command(); const {data} = await createDraft(new PrismaStoryDraftStore(db), owner, input);
    await db.commandReceipt.updateMany({where: {ownerId: owner.ownerId}, data: {schemaVersion: 2}});
    await expect(createDraft(new PrismaStoryDraftStore(db), owner, input)).rejects.toThrow('COMMAND_RECEIPT_INVALID');
    await db.commandReceipt.updateMany({where: {ownerId: owner.ownerId}, data: {schemaVersion: 1, response: {id: data.id}}});
    await expect(createDraft(new PrismaStoryDraftStore(db), owner, input)).rejects.toThrow('COMMAND_RECEIPT_INVALID');
    expect(await db.storyDraft.count()).toBe(1); expect((await getDraft(new PrismaStoryDraftStore(db), owner, data.id)).revision).toBe(1);
  });
  it('refuses unknown stored schema and does not silently downgrade its content', async () => {
    const {data} = await createDraft(new PrismaStoryDraftStore(db), owner, command());
    await db.storyDraft.update({where: {id: data.id}, data: {schemaVersion: 2}});
    await expect(getDraft(new PrismaStoryDraftStore(db), owner, data.id)).rejects.toThrow('STORED_STORY_INVALID');
    await expect(updateDraft(new PrismaStoryDraftStore(db), owner, {datasetId, commandId: v7(), id: data.id, expectedRevision: 1, patch: {title: '不要覆盖未来数据'}})).rejects.toThrow('STORED_STORY_INVALID');
    expect(await db.commandReceipt.count()).toBe(1);
  });
  it('replays restore even after a later deletion without undoing the latest state', async () => {
    const {data} = await createDraft(new PrismaStoryDraftStore(db), owner, command());
    await deleteDraft(new PrismaStoryDraftStore(db), owner, {datasetId, commandId: v7(), id: data.id, expectedRevision: 1});
    const restoration = {datasetId, commandId: v7(), id: data.id, expectedRevision: 2};
    const restored = await restoreDraft(new PrismaStoryDraftStore(db), owner, restoration);
    await deleteDraft(new PrismaStoryDraftStore(db), owner, {datasetId, commandId: v7(), id: data.id, expectedRevision: 3});
    expect(await restoreDraft(new PrismaStoryDraftStore(db), owner, restoration)).toEqual({...restored, replayed: true});
    expect((await getDraft(new PrismaStoryDraftStore(db), owner, data.id, true)).revision).toBe(4);
    expect((await getDraft(new PrismaStoryDraftStore(db), owner, data.id, true)).deletedAt).not.toBeNull();
  });
  it('rejects a cursor from another owner even when both identities are active', async () => {
    await createDraft(new PrismaStoryDraftStore(db), owner, command()); await createDraft(new PrismaStoryDraftStore(db), owner, command());
    const {nextCursor} = await listDrafts(new PrismaStoryDraftStore(db), owner, {limit: 1}); const now = new Date(), another = {datasetId, ownerId: v7()};
    await db.localProfile.create({data: {id: another.ownerId, displayName: '独立身份', createdAt: now, updatedAt: now}});
    await expect(listDrafts(new PrismaStoryDraftStore(db), another, {cursor: nextCursor!})).rejects.toThrow('INVALID_CURSOR');
  });
  it('allows only one concurrent stale-revision command across independent connections', async () => {
    const {data} = await createDraft(new PrismaStoryDraftStore(db), owner, command()); const other = await connect();
    const a = {datasetId, commandId: v7(), id: data.id, expectedRevision: 1, patch: {title: 'A'}};
    const b = {datasetId, commandId: v7(), id: data.id, expectedRevision: 1, patch: {title: 'B'}};
    const results = await Promise.allSettled([updateDraft(new PrismaStoryDraftStore(db), owner, a), updateDraft(new PrismaStoryDraftStore(other), owner, b)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await getDraft(new PrismaStoryDraftStore(db), owner, data.id)).revision).toBe(2); expect(await db.commandReceipt.count()).toBe(2);
    const losing = results[0]!.status === 'rejected' ? a : b;
    await expect(updateDraft(new PrismaStoryDraftStore(db), owner, losing)).rejects.toThrow('REVISION_CONFLICT');
  });

});

// Contract tests share the migrated, per-test SQLite fixture above; no mock owns atomicity.
const draftRecord = (title = '端口草稿'): StoryDraftInsert => {
  const now = new Date();
  return {id: v7(), title, settings: structuredClone(settings), schemaVersion: 1, revision: 1,
    createdAt: now, updatedAt: now, deletedAt: null, archivedAt: null};
};
const receiptRecord = (draft: StoryDraftInsert): StoryReceiptInsert => ({
  id: v7(), commandId: v7(), commandType: 'authoring.story.create.v1', payloadHash: '0'.repeat(64), schemaVersion: 1,
  response: {...draft, createdAt: draft.createdAt.toISOString(), updatedAt: draft.updatedAt.toISOString(), deletedAt: null, archivedAt: null},
  createdAt: draft.updatedAt,
});

describe('owner-scoped story store contract on the shared real SQLite fixture', () => {
  it('scopes every read/write lookup, list and receipt to the captured owner, including insert ownership', async () => {
    const store = new PrismaStoryDraftStore(db), own = draftRecord(), foreign = draftRecord('另一身份');
    const another = v7(), now = new Date(), ownReceipt = receiptRecord(own), foreignReceipt = receiptRecord(foreign);
    await db.localProfile.create({data: {id: another, displayName: '另一身份', createdAt: now, updatedAt: now}});
    // The same command ID belongs to independent owner namespaces.
    foreignReceipt.commandId = ownReceipt.commandId;
    await store.write(another, async scope => {
      await scope.insertDraft(foreign); await scope.insertReceipt(foreignReceipt);
    });
    await store.write(owner.ownerId, async scope => {
      expect(await scope.findReceipt(ownReceipt.commandId)).toBeNull();
      // Extra JS properties must not override captured ownership or escape via patch spreading.
      await scope.insertDraft({...own, ownerId: another} as StoryDraftInsert);
      await scope.insertReceipt({...ownReceipt, ownerId: another} as StoryReceiptInsert);
      expect(await scope.findDraft(foreign.id, true)).toBeNull();
      expect(await scope.listDrafts({deleted: 'exclude', take: 10})).toEqual([own]);
      expect(await scope.findReceipt(ownReceipt.commandId)).toEqual({commandType: ownReceipt.commandType,
        payloadHash: ownReceipt.payloadHash, schemaVersion: 1, response: ownReceipt.response});
      expect(await scope.compareAndSwapDraft({id: foreign.id, expectedRevision: 1, deleted: 'exclude',
        patch: {title: '越权'}, updatedAt: now})).toBe(0);
      expect(await scope.compareAndSwapDraft({id: own.id, expectedRevision: 1, deleted: 'exclude',
        patch: {title: '自己的更新', ownerId: another, revision: 99} as {title: string}, updatedAt: now})).toBe(1);
      expect((await scope.findDraft(own.id))?.revision).toBe(2);
    });
    await store.read(owner.ownerId, async scope => {
      expect(await scope.findDraft(foreign.id, true)).toBeNull();
      expect((await scope.listDrafts({deleted: 'exclude', take: 10})).map(row => row.id)).toEqual([own.id]);
      expect(scope).not.toHaveProperty('insertDraft'); expect(scope).not.toHaveProperty('insertReceipt');
    });
    expect((await db.storyDraft.findUniqueOrThrow({where: {id: own.id}})).ownerId).toBe(owner.ownerId);
    expect((await db.commandReceipt.findUniqueOrThrow({where: {id: ownReceipt.id}})).ownerId).toBe(owner.ownerId);
    expect((await db.storyDraft.findUniqueOrThrow({where: {id: foreign.id}})).title).toBe(foreign.title);
    await store.write(another, async scope => {
      expect(await scope.findReceipt(ownReceipt.commandId)).toMatchObject({response: foreignReceipt.response});
    });
  });

  it('returns exact CAS counts for stale revisions, missing IDs and active/deleted state guards', async () => {
    const store = new PrismaStoryDraftStore(db), draft = draftRecord(), now = new Date();
    await store.write(owner.ownerId, async scope => {
      await scope.insertDraft(draft);
      const update = {id: draft.id, expectedRevision: 1, deleted: 'exclude' as const, patch: {title: '新标题'}, updatedAt: now};
      expect(await scope.compareAndSwapDraft({...update, id: v7()})).toBe(0);
      expect(await scope.compareAndSwapDraft({...update, expectedRevision: 2})).toBe(0);
      expect(await scope.compareAndSwapDraft({...update, deleted: 'only', patch: {deletedAt: null}})).toBe(0);
      expect(await scope.compareAndSwapDraft(update)).toBe(1);
      expect(await scope.compareAndSwapDraft(update)).toBe(0);
      expect(await scope.compareAndSwapDraft({...update, expectedRevision: 2, patch: {deletedAt: now}})).toBe(1);
      expect(await scope.findDraft(draft.id)).toBeNull();
      expect((await scope.findDraft(draft.id, true))?.revision).toBe(3);
      expect(await scope.compareAndSwapDraft({...update, expectedRevision: 3})).toBe(0);
      expect(await scope.compareAndSwapDraft({...update, expectedRevision: 3, deleted: 'only', patch: {deletedAt: null}})).toBe(1);
    });
    expect((await store.read(owner.ownerId, scope => scope.findDraft(draft.id)))?.revision).toBe(4);
    expect(await db.commandReceipt.count()).toBe(0);
  });

  it('rolls back inserted draft, receipt and Gate when a real receipt uniqueness constraint fails', async () => {
    const store = new PrismaStoryDraftStore(db), draft = draftRecord(), receipt = receiptRecord(draft);
    await expect(store.write(owner.ownerId, async scope => {
      await scope.insertDraft(draft); await scope.insertReceipt(receipt);
      expect(await scope.findDraft(draft.id)).toEqual(draft);
      expect(await scope.findReceipt(receipt.commandId)).not.toBeNull();
      await scope.insertReceipt({...receipt, id: v7()});
    })).rejects.toMatchObject({code: 'P2002'});
    expect(await db.storyDraft.count()).toBe(0); expect(await db.commandReceipt.count()).toBe(0);
    expect((await db.localProfile.findUniqueOrThrow({where: {id: owner.ownerId}})).writeEpoch).toBe(0);
  });

  it('rolls back a successful CAS and new receipt together if the write callback throws', async () => {
    const store = new PrismaStoryDraftStore(db), draft = draftRecord(), receipt = receiptRecord(draft);
    await store.write(owner.ownerId, scope => scope.insertDraft(draft));
    const before = await db.localProfile.findUniqueOrThrow({where: {id: owner.ownerId}});
    await expect(store.write(owner.ownerId, async scope => {
      expect(await scope.compareAndSwapDraft({id: draft.id, expectedRevision: 1, deleted: 'exclude',
        patch: {title: '应回滚'}, updatedAt: new Date()})).toBe(1);
      await scope.insertReceipt(receipt);
      throw new Error('after receipt');
    })).rejects.toThrow('after receipt');
    expect(await store.read(owner.ownerId, scope => scope.findDraft(draft.id))).toEqual(draft);
    expect(await db.commandReceipt.count()).toBe(0);
    expect((await db.localProfile.findUniqueOrThrow({where: {id: owner.ownerId}})).writeEpoch).toBe(before.writeEpoch);
  });

  it.each(['read', 'write'] as const)('rejects missing and deleted owners before entering the %s callback', async mode => {
    const store = new PrismaStoryDraftStore(db); let entered = false;
    const work = async () => {entered = true;};
    await expect(store[mode](v7(), work)).rejects.toThrow('OWNER_UNAVAILABLE');
    await db.localProfile.update({where: {id: owner.ownerId}, data: {deletedAt: new Date()}});
    await expect(store[mode](owner.ownerId, work)).rejects.toThrow('OWNER_UNAVAILABLE');
    expect(entered).toBe(false);
    expect((await db.localProfile.findUniqueOrThrow({where: {id: owner.ownerId}})).writeEpoch).toBe(0);
    expect(await db.storyDraft.count()).toBe(0); expect(await db.commandReceipt.count()).toBe(0);
  });

  it('validates the active owner and reads drafts in the same SQLite snapshot across two connections', async () => {
    const store = new PrismaStoryDraftStore(db), draft = draftRecord();
    await store.write(owner.ownerId, scope => scope.insertDraft(draft));
    const second = await connect();
    await store.read(owner.ownerId, async scope => {
      // The owner validation SELECT must already establish this transaction's snapshot.
      await second.$transaction(async tx => {
        await tx.localProfile.update({where: {id: owner.ownerId}, data: {deletedAt: new Date()}});
        await tx.storyDraft.update({where: {id: draft.id}, data: {title: '在另一连接已提交', revision: 2}});
      });
      expect(await scope.findDraft(draft.id)).toEqual(draft);
      expect(await scope.listDrafts({deleted: 'exclude', take: 10})).toEqual([draft]);
    });
    expect((await second.storyDraft.findUniqueOrThrow({where: {id: draft.id}})).revision).toBe(2);
    await expect(store.read(owner.ownerId, scope => scope.findDraft(draft.id))).rejects.toThrow('OWNER_UNAVAILABLE');
    expect((await second.localProfile.findUniqueOrThrow({where: {id: owner.ownerId}})).writeEpoch).toBe(1);
  });

  it('keeps tied-timestamp cursor ordering, deleted filtering and exact take semantics inside the adapter', async () => {
    const store = new PrismaStoryDraftStore(db), time = new Date('2026-09-12T00:00:00.000Z');
    const drafts = Array.from({length: 3}, () => ({...draftRecord(), createdAt: time, updatedAt: time})).sort((a, b) => b.id.localeCompare(a.id));
    const deleted = {...draftRecord(), createdAt: time, updatedAt: time, deletedAt: time};
    await store.write(owner.ownerId, async scope => {
      for (const draft of [...drafts, deleted]) await scope.insertDraft(draft);
    });
    await store.read(owner.ownerId, async scope => {
      expect(await scope.listDrafts({deleted: 'exclude', take: 2})).toEqual(drafts.slice(0, 2));
      expect(await scope.listDrafts({deleted: 'exclude', take: 2, before: {updatedAt: time, id: drafts[1]!.id}})).toEqual(drafts.slice(2));
      expect(await scope.listDrafts({deleted: 'only', take: 2})).toEqual([deleted]);
    });
  });

  it('returns untrusted stored JSON unchanged for application validation rather than asserting a DTO', async () => {
    const store = new PrismaStoryDraftStore(db), draft = draftRecord(), receipt = receiptRecord(draft);
    await store.write(owner.ownerId, async scope => {await scope.insertDraft(draft); await scope.insertReceipt(receipt);});
    await db.storyDraft.update({where: {id: draft.id}, data: {settings: {future: true}}});
    await db.commandReceipt.update({where: {id: receipt.id}, data: {response: ['broken']}});
    expect((await store.read(owner.ownerId, scope => scope.findDraft(draft.id)))?.settings).toEqual({future: true});
    expect(await store.write(owner.ownerId, scope => scope.findReceipt(receipt.commandId))).toMatchObject({response: ['broken']});
    await expect(createStoryDraftService(db).get(owner, draft.id)).rejects.toThrow('STORED_STORY_INVALID');
  });

  it('composes all six operations with the real adapter and injected runtime services', async () => {
    const time = new Date('2026-09-12T01:02:03.000Z');
    const service = createStoryDraftService(db, {clock: {now: () => time}, ids: {next: () => v7()}});
    const input = command(), created = await service.create(owner, input);
    expect(created.data.createdAt).toBe(time.toISOString());
    expect(await service.get(owner, created.data.id)).toEqual(created.data);
    expect((await service.list(owner)).items).toEqual([created.data]);
    const changed = await service.update(owner, {datasetId, commandId: v7(), id: created.data.id, expectedRevision: 1, patch: {title: '组合更新'}});
    expect(changed.data.revision).toBe(2);
    const deleted = await service.delete(owner, {datasetId, commandId: v7(), id: created.data.id, expectedRevision: 2});
    expect((await service.list(owner, {deleted: 'only'})).items).toEqual([deleted.data]);
    expect(await service.get(owner, created.data.id, true)).toEqual(deleted.data);
    const restored = await service.restore(owner, {datasetId, commandId: v7(), id: created.data.id, expectedRevision: 3});
    expect(restored.data.revision).toBe(4); expect(restored.data.deletedAt).toBeNull();
    expect(await service.create(owner, input)).toEqual({...created, replayed: true});
    expect(await db.commandReceipt.count()).toBe(4);
  });
});
