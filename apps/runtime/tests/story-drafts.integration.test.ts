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
import type {DraftSettings} from '../src/contracts/story-draft.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let baseDir: string, base: string, dir: string, path: string, db: PrismaClient;
let connections: PrismaClient[] = [];
let owner: {ownerId: string};
const settings: DraftSettings = {premise: '', playerRole: '', worldRules: [], tone: ''};
const command = (title = '新的世界') => ({commandId: v7(), title, settings: structuredClone(settings)});
async function connect() {const client = await openRuntimeDatabase(path); connections.push(client); return client;}
beforeAll(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'weiwan-m0b-base-')); base = join(baseDir, 'base.db');
  await writeFile(base, '', {flag: 'wx', mode: 0o600});
  execFileSync(process.execPath, [join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {cwd: root, env: {...process.env, RUNTIME_DATABASE_URL: `file:${base}`}, stdio: 'pipe'});
}, 30_000);
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'weiwan-m0b-test-')); path = join(dir, 'runtime.db'); await copyFile(base, path);
  db = await connect(); owner = {ownerId: v7()}; const now = new Date();
  // Host/test initialization is not an exposed business operation.
  await db.localProfile.create({data: {id: owner.ownerId, displayName: '测试身份', createdAt: now, updatedAt: now}});
});
afterEach(async () => {await Promise.all(connections.map(client => client.$disconnect())); connections = []; await rm(dir, {recursive: true, force: true});});
afterAll(async () => {if (baseDir) await rm(baseDir, {recursive: true, force: true});});

const uuid7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
describe('internal story root CRUD on a real SQLite file', () => {
  it('saves incomplete settings, generates server IDs and survives disconnect/reopen', async () => {
    const result = await createDraft(db, owner, command());
    expect(result.replayed).toBe(false); expect(result.data.id).toMatch(uuid7); expect(result.data.revision).toBe(1);
    expect(result.data.createdAt).toBe(result.data.updatedAt); expect(result.data.deletedAt).toBeNull();
    expect(result.data.settings).toEqual(settings); expect(result.data).not.toHaveProperty('ownerId');
    await db.$disconnect(); const reopened = await connect();
    expect(await getDraft(reopened, owner, result.data.id)).toEqual(result.data);
  });
  it('updates only provided fields, preserves createdAt, and advances CAS revision', async () => {
    const {data: created} = await createDraft(db, owner, command());
    const {data: changed} = await updateDraft(db, owner, {commandId: v7(), id: created.id, expectedRevision: 1, patch: {title: '打磨后的世界'}});
    expect(changed.title).toBe('打磨后的世界'); expect(changed.settings).toEqual(settings); expect(changed.createdAt).toBe(created.createdAt); expect(changed.revision).toBe(2);
    const replacement = {...settings, premise: '一座安静的海边小镇', worldRules: ['不替玩家决定感情']};
    const {data: next} = await updateDraft(db, owner, {commandId: v7(), id: created.id, expectedRevision: 2, patch: {settings: replacement}});
    expect(next.settings).toEqual(replacement); expect(next.title).toBe(changed.title); expect(next.revision).toBe(3);
  });
  it('soft-deletes, hides default reads, and restores with a new revision', async () => {
    const {data} = await createDraft(db, owner, command());
    const deleted = await deleteDraft(db, owner, {commandId: v7(), id: data.id, expectedRevision: 1});
    expect(deleted.data.deletedAt).toBe(deleted.data.updatedAt); expect(deleted.data.revision).toBe(2);
    await expect(getDraft(db, owner, data.id)).rejects.toThrow('STORY_NOT_FOUND');
    expect((await listDrafts(db, owner)).items).toEqual([]);
    expect((await listDrafts(db, owner, {deleted: 'only'})).items).toEqual([deleted.data]);
    expect(await getDraft(db, owner, data.id, true)).toEqual(deleted.data);
    const restored = await restoreDraft(db, owner, {commandId: v7(), id: data.id, expectedRevision: 2});
    expect(restored.data.revision).toBe(3); expect(restored.data.deletedAt).toBeNull(); expect(restored.data.createdAt).toBe(data.createdAt);
  });
  it('replays create/update/delete receipts across reopen, not a new business operation', async () => {
    const input = command(); const created = await createDraft(db, owner, input);
    const update = {commandId: v7(), id: created.data.id, expectedRevision: 1, patch: {title: '已修改'}};
    const changed = await updateDraft(db, owner, update);
    expect(await createDraft(db, owner, input)).toEqual({...created, replayed: true});
    const deletion = {commandId: v7(), id: created.data.id, expectedRevision: 2};
    const deleted = await deleteDraft(db, owner, deletion); await db.$disconnect(); const reopened = await connect();
    expect(await deleteDraft(reopened, owner, deletion)).toEqual({...deleted, replayed: true});
    expect(await updateDraft(reopened, owner, update)).toEqual({...changed, replayed: true});
    expect(await reopened.storyDraft.count()).toBe(1); expect(await reopened.commandReceipt.count()).toBe(3);
    expect((await getDraft(reopened, owner, created.data.id, true)).revision).toBe(3);
  });
  it('canonicalizes settings key order but rejects changed payloads and command types', async () => {
    const input = command(); const created = await createDraft(db, owner, input);
    expect((await createDraft(db, owner, {...input, settings: {tone: '', worldRules: [], playerRole: '', premise: ''}})).replayed).toBe(true);
    await expect(createDraft(db, owner, {...input, title: '不同内容'})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    await expect(deleteDraft(db, owner, {commandId: input.commandId, id: created.data.id, expectedRevision: 1})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });
  it('isolates reads, lists and all write actions by active owner', async () => {
    const {data} = await createDraft(db, owner, command()); const other = {ownerId: v7()}; const now = new Date();
    await db.localProfile.create({data: {id: other.ownerId, displayName: '另一身份', createdAt: now, updatedAt: now}});
    expect((await listDrafts(db, other)).items).toEqual([]);
    await expect(getDraft(db, other, data.id, true)).rejects.toThrow('STORY_NOT_FOUND');
    await expect(updateDraft(db, other, {commandId: v7(), id: data.id, expectedRevision: 1, patch: {title: '越权'}})).rejects.toThrow('STORY_NOT_FOUND');
    await expect(deleteDraft(db, other, {commandId: v7(), id: data.id, expectedRevision: 1})).rejects.toThrow('STORY_NOT_FOUND');
    await expect(restoreDraft(db, other, {commandId: v7(), id: data.id, expectedRevision: 1})).rejects.toThrow('STORY_NOT_FOUND');
    await db.localProfile.update({where: {id: owner.ownerId}, data: {deletedAt: now}});
    await expect(getDraft(db, owner, data.id)).rejects.toThrow('OWNER_UNAVAILABLE');
    await expect(listDrafts(db, owner)).rejects.toThrow('OWNER_UNAVAILABLE');
    await expect(createDraft(db, owner, command())).rejects.toThrow('OWNER_UNAVAILABLE');
  });
  it('rejects stale update/delete/restore without changing data or receipts', async () => {
    const {data} = await createDraft(db, owner, command()); const second = await connect();
    await updateDraft(db, owner, {commandId: v7(), id: data.id, expectedRevision: 1, patch: {title: '先保存'}});
    await expect(updateDraft(second, owner, {commandId: v7(), id: data.id, expectedRevision: 1, patch: {title: '旧窗口'}})).rejects.toThrow('REVISION_CONFLICT');
    await expect(deleteDraft(second, owner, {commandId: v7(), id: data.id, expectedRevision: 1})).rejects.toThrow('REVISION_CONFLICT');
    await deleteDraft(db, owner, {commandId: v7(), id: data.id, expectedRevision: 2});
    await expect(restoreDraft(second, owner, {commandId: v7(), id: data.id, expectedRevision: 2})).rejects.toThrow('REVISION_CONFLICT');
    expect(await db.commandReceipt.count()).toBe(3);
  });
  it('allows same-name stories and keyset pagination without duplicates on stable data', async () => {
    for (let i = 0; i < 5; i++) await createDraft(db, owner, command('同名'));
    const first = await listDrafts(db, owner, {limit: 2});
    const second = await listDrafts(db, owner, {limit: 2, cursor: first.nextCursor!});
    const third = await listDrafts(db, owner, {limit: 2, cursor: second.nextCursor!});
    expect(first.items).toHaveLength(2); expect(second.items).toHaveLength(2); expect(third.items).toHaveLength(1); expect(third.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items, ...third.items].map(item => item.id)).size).toBe(5);
    await expect(listDrafts(db, owner, {cursor: first.nextCursor!, deleted: 'only'})).rejects.toThrow('INVALID_CURSOR');
  });
  it('does not cascade deletion into frozen versions', async () => {
    const {data} = await createDraft(db, owner, command()); const now = new Date(), versionId = v7();
    await db.storyVersion.create({data: {id: versionId, ownerId: owner.ownerId, storyDraftId: data.id, title: data.title, settings: {...settings}, versionNo: 1, sourceRevision: 1, createdAt: now, sealedAt: now, contentHash: '0'.repeat(64)}});
    await deleteDraft(db, owner, {commandId: v7(), id: data.id, expectedRevision: 1});
    expect(await db.storyVersion.count({where: {id: versionId}})).toBe(1);
    expect(await db.storyDraft.count({where: {id: data.id}})).toBe(1);
    expect(await db.$queryRawUnsafe('PRAGMA foreign_key_list("story_drafts")')).toEqual([]);
  });
  it.each([
    {title: '  '}, {title: 'x'.repeat(121)}, {id: v7()}, {ownerId: v7()},
    {commandId: 'not-an-id'}, {settings: {...settings, hidden: true}},
    {settings: {...settings, worldRules: Array(31).fill('rule')}},
    {settings: {...settings, premise: 'x'.repeat(12001)}},
  ])('rejects invalid create data with no persisted side effects (%#)', async patch => {
    await expect(createDraft(db, owner, {...command(), ...patch} as never)).rejects.toThrow('INVALID_STORY_COMMAND');
    expect(await db.storyDraft.count()).toBe(0); expect(await db.commandReceipt.count()).toBe(0);
    expect((await db.localProfile.findUniqueOrThrow({where: {id: owner.ownerId}})).writeEpoch).toBe(0);
  });
  it('rejects empty/unknown updates, invalid limits and forged cursor scope', async () => {
    const {data} = await createDraft(db, owner, command());
    for (const patch of [{}, {title: null}, {ownerId: v7()}, {settings: {premise: 'partial'}}]) {
      await expect(updateDraft(db, owner, {commandId: v7(), id: data.id, expectedRevision: 1, patch} as never)).rejects.toThrow('INVALID_STORY_COMMAND');
    }
    for (const input of [{limit: 0}, {limit: 101}, {limit: 1.5}, {cursor: 'invalid'}]) await expect(listDrafts(db, owner, input)).rejects.toThrow();
    expect((await getDraft(db, owner, data.id)).revision).toBe(1);
  });
  it('uses the injected Clock/IdFactory and never moves updatedAt backwards', async () => {
    const createdAt = new Date('2026-09-10T12:00:00.123Z');
    const services = {clock: {now: () => createdAt}, ids: {next: () => v7()}};
    const {data} = await createDraft(db, owner, command(), services);
    expect(data.createdAt).toBe(createdAt.toISOString());
    const backwards = {...services, clock: {now: () => new Date('2020-01-01T00:00:00.000Z')}};
    const updated = await updateDraft(db, owner, {commandId: v7(), id: data.id, expectedRevision: 1, patch: {title: '时钟倒退时也保留顺序'}}, backwards);
    expect(updated.data.updatedAt).toBe(data.updatedAt); expect(updated.data.revision).toBe(2);
  });
  it('rolls back the created root and Gate if receipt ID generation fails after business write', async () => {
    let calls = 0;
    const input = command();
    const services = {clock: {now: () => new Date()}, ids: {next: () => {if (++calls === 2) throw new Error('injected receipt failure');return v7();}}};
    await expect(createDraft(db, owner, input, services)).rejects.toThrow('injected receipt failure');
    expect(await db.storyDraft.count()).toBe(0); expect(await db.commandReceipt.count()).toBe(0);
    expect((await db.localProfile.findUniqueOrThrow({where: {id: owner.ownerId}})).writeEpoch).toBe(0);
    await db.$disconnect(); const reopened = await connect();
    expect((await createDraft(reopened, owner, input)).replayed).toBe(false);
    expect(await reopened.storyDraft.count()).toBe(1);
  });
  it('rolls back an update if receipt insertion fails instead of leaving half a command', async () => {
    const {data} = await createDraft(db, owner, command()); const receipt = await db.commandReceipt.findFirstOrThrow();
    const before = await db.localProfile.findUniqueOrThrow({where: {id: owner.ownerId}});
    const services = {clock: {now: () => new Date()}, ids: {next: () => receipt.id}};
    await expect(updateDraft(db, owner, {commandId: v7(), id: data.id, expectedRevision: 1, patch: {title: '不应留下'}}, services)).rejects.toMatchObject({code: 'P2002'});
    expect(await getDraft(db, owner, data.id)).toEqual(data); expect(await db.commandReceipt.count()).toBe(1);
    expect((await db.localProfile.findUniqueOrThrow({where: {id: owner.ownerId}})).writeEpoch).toBe(before.writeEpoch);
  });
  it.each(['invalid-clock', 'invalid-id'])('rejects broken runtime services atomically: %s', async failure => {
    const services = {clock: {now: () => failure === 'invalid-clock' ? new Date(NaN) : new Date()}, ids: {next: () => 'bad-id'}};
    await expect(createDraft(db, owner, command(), services)).rejects.toThrow(failure === 'invalid-clock' ? 'CLOCK_INVALID' : 'ID_FACTORY_INVALID');
    expect(await db.storyDraft.count()).toBe(0); expect(await db.commandReceipt.count()).toBe(0);
  });
  it('rejects corrupt or future receipts without retrying the business operation', async () => {
    const input = command(); const {data} = await createDraft(db, owner, input);
    await db.commandReceipt.updateMany({where: {ownerId: owner.ownerId}, data: {schemaVersion: 2}});
    await expect(createDraft(db, owner, input)).rejects.toThrow('COMMAND_RECEIPT_INVALID');
    await db.commandReceipt.updateMany({where: {ownerId: owner.ownerId}, data: {schemaVersion: 1, response: {id: data.id}}});
    await expect(createDraft(db, owner, input)).rejects.toThrow('COMMAND_RECEIPT_INVALID');
    expect(await db.storyDraft.count()).toBe(1); expect((await getDraft(db, owner, data.id)).revision).toBe(1);
  });
  it('refuses unknown stored schema and does not silently downgrade its content', async () => {
    const {data} = await createDraft(db, owner, command());
    await db.storyDraft.update({where: {id: data.id}, data: {schemaVersion: 2}});
    await expect(getDraft(db, owner, data.id)).rejects.toThrow('STORED_STORY_INVALID');
    await expect(updateDraft(db, owner, {commandId: v7(), id: data.id, expectedRevision: 1, patch: {title: '不要覆盖未来数据'}})).rejects.toThrow('STORED_STORY_INVALID');
    expect(await db.commandReceipt.count()).toBe(1);
  });
  it('replays restore even after a later deletion without undoing the latest state', async () => {
    const {data} = await createDraft(db, owner, command());
    await deleteDraft(db, owner, {commandId: v7(), id: data.id, expectedRevision: 1});
    const restoration = {commandId: v7(), id: data.id, expectedRevision: 2};
    const restored = await restoreDraft(db, owner, restoration);
    await deleteDraft(db, owner, {commandId: v7(), id: data.id, expectedRevision: 3});
    expect(await restoreDraft(db, owner, restoration)).toEqual({...restored, replayed: true});
    expect((await getDraft(db, owner, data.id, true)).revision).toBe(4);
    expect((await getDraft(db, owner, data.id, true)).deletedAt).not.toBeNull();
  });
  it('rejects a cursor from another owner even when both identities are active', async () => {
    await createDraft(db, owner, command()); await createDraft(db, owner, command());
    const {nextCursor} = await listDrafts(db, owner, {limit: 1}); const now = new Date(), another = {ownerId: v7()};
    await db.localProfile.create({data: {id: another.ownerId, displayName: '独立身份', createdAt: now, updatedAt: now}});
    await expect(listDrafts(db, another, {cursor: nextCursor!})).rejects.toThrow('INVALID_CURSOR');
  });
  it('allows only one concurrent stale-revision command across independent connections', async () => {
    const {data} = await createDraft(db, owner, command()); const other = await connect();
    const a = {commandId: v7(), id: data.id, expectedRevision: 1, patch: {title: 'A'}};
    const b = {commandId: v7(), id: data.id, expectedRevision: 1, patch: {title: 'B'}};
    const results = await Promise.allSettled([updateDraft(db, owner, a), updateDraft(other, owner, b)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await getDraft(db, owner, data.id)).revision).toBe(2); expect(await db.commandReceipt.count()).toBe(2);
    const losing = results[0]!.status === 'rejected' ? a : b;
    await expect(updateDraft(db, owner, losing)).rejects.toThrow('REVISION_CONFLICT');
  });

});
