import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import {copyFile, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {v7} from 'uuid';
import {openRuntimeDatabase} from '../src/infrastructure/db/client.js';
import type {PrismaClient} from '../src/generated/prisma/client.js';
const settings = {personality: '', appearance: '', speakingStyle: '', boundaries: ''};
let baseDir: string, base: string, directory: string, path: string, db: PrismaClient;
let owner: {ownerId: string; datasetId: string};
let connections: PrismaClient[] = [];
async function connect() {const client = await openRuntimeDatabase(path); connections.push(client); return client;}
async function service(client = db) {
  const module = await import('../src/composition/character-service.js').catch(() => null);
  expect(module, 'independent character service must exist').not.toBeNull(); return module!.createCharacterService(client);
}
const command = (name = '同名角色', portraitAssetId: string | null = null) => ({datasetId: owner.datasetId, commandId: v7(), name, settings, portraitAssetId});
const life = (id: string, expectedRevision: number) => ({datasetId: owner.datasetId, commandId: v7(), id, expectedRevision});
async function profile() {const now = new Date(), id = v7(); await db.localProfile.create({data: {id, displayName: '其他', createdAt: now, updatedAt: now}}); return id;}
async function asset(overrides: {ownerId?: string; status?: string; deletedAt?: Date | null} = {}) {
  const now = new Date(); return db.asset.create({data: {id: v7(), ownerId: owner.ownerId, storageKey: `private/${v7()}`, sha256: '0'.repeat(64), mimeType: 'image/png', byteSize: 100n,
    originalName: 'avatar.png', width: 20, height: 20, rightsDeclaration: 'own', status: 'ready', deletedAt: null, createdAt: now, updatedAt: now, ...overrides}});
}
async function state() {return {templates: await db.characterTemplate.count(), receipts: await db.commandReceipt.count(),
  epoch: (await db.localProfile.findUniqueOrThrow({where: {id: owner.ownerId}})).writeEpoch};}
beforeAll(async () => {
  const root = resolve(import.meta.dirname, '..'); baseDir = await mkdtemp(join(tmpdir(), 'characters-base-')); base = join(baseDir, 'base.db');
  await writeFile(base, '', {flag: 'wx', mode: 0o600});
  execFileSync(process.execPath, [join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {cwd: root,
    env: {...process.env, RUNTIME_DATABASE_URL: `file:${base}`}, stdio: 'pipe'});
}, 30_000);
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'characters-test-')); path = join(directory, 'runtime.db'); await copyFile(base, path); db = await connect();
  owner = {ownerId: v7(), datasetId: v7()}; const now = new Date();
  await db.localProfile.create({data: {id: owner.ownerId, displayName: '测试身份', createdAt: now, updatedAt: now}});
});
afterEach(async () => {await Promise.all(connections.map(c => c.$disconnect())); connections = []; await rm(directory, {recursive: true, force: true});});
afterAll(async () => {if (baseDir) await rm(baseDir, {recursive: true, force: true});});

describe('formal library CharacterTemplate service', () => {
  it('creates incomplete same-name drafts and reopens all fields without exposing database metadata', async () => {
    const s = await service(), portrait = await asset(), input = {...command(' 😀 ', portrait.id), settings: {personality: '性格', appearance: '外貌', speakingStyle: '语气', boundaries: '边界'}};
    const first = await s.create(owner, input); await s.create(owner, {...input, commandId: v7()});
    expect(first.replayed).toBe(false); expect(first.data).toMatchObject({name: ' 😀 ', settings: input.settings, portraitAssetId: portrait.id, revision: 1, schemaVersion: 1, deletedAt: null, archivedAt: null});
    expect(Object.keys(first.data).sort()).toEqual(['id', 'name', 'settings', 'portraitAssetId', 'revision', 'schemaVersion', 'createdAt', 'updatedAt', 'deletedAt', 'archivedAt'].sort());
    expect(first.data.id).not.toBe(input.commandId);
    await db.$disconnect(); const reopened = await service(await connect());
    expect(await reopened.get(owner, first.data.id)).toEqual(first.data);
    expect((await reopened.list(owner)).totalMatching).toBe(2);
    expect((await db.characterTemplate.findFirstOrThrow()).scope).toBe('library');
    expect((await db.characterTemplate.findFirstOrThrow()).sourceStoryDraftId).toBeNull();
  });
  it('performs CAS update/delete/restore and replays historical receipts without changing newer state', async () => {
    const s = await service(), input = command(), created = await s.create(owner, input), id = created.data.id;
    const update = {...life(id, 1), patch: {name: '更新', settings: {...settings, boundaries: '新边界'}}};
    const changed = await s.update(owner, update), deletion = life(id, 2);
    const deleted = await s.delete(owner, deletion); expect(deleted.data.deletedAt).toBe(deleted.data.updatedAt);
    await expect(s.get(owner, id)).rejects.toThrow('CHARACTER_NOT_FOUND'); expect(await s.get(owner, id, true)).toEqual(deleted.data);
    const restoration = life(id, 3), restored = await s.restore(owner, restoration);
    expect(restored.data.revision).toBe(4); expect(restored.data.deletedAt).toBeNull(); expect(restored.data.createdAt).toBe(created.data.createdAt);
    for (const [action, payload, result] of [['create', input, created], ['update', update, changed], ['delete', deletion, deleted], ['restore', restoration, restored]] as const) {
      expect(await s[action](owner, payload as never)).toEqual({...result, replayed: true});
      const receipt = await db.commandReceipt.findFirstOrThrow({where: {commandId: payload.commandId}});
      expect(receipt.commandType).toBe(`authoring.character.${action}.v1`);
    }
    expect((await s.get(owner, id)).revision).toBe(4); expect(await db.commandReceipt.count()).toBe(4);
    await expect(s.create(owner, {...input, name: '换内容'})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    await expect(s.delete(owner, {...life(id, 4), commandId: input.commandId})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });
  it.each(['foreign', 'story', 'missing'] as const)('hides %s templates from get/update/delete/restore and lists/count', async kind => {
    const s = await service(), {data} = await s.create(owner, command());
    if (kind === 'foreign') await db.characterTemplate.update({where: {id: data.id}, data: {ownerId: await profile()}});
    if (kind === 'story') await db.characterTemplate.update({where: {id: data.id}, data: {scope: 'story', sourceStoryDraftId: v7()}});
    const id = kind === 'missing' ? v7() : data.id, before = await state();
    await expect(s.get(owner, id, true)).rejects.toThrow('CHARACTER_NOT_FOUND');
    await expect(s.update(owner, {...life(id, 1), patch: {name: '越界'}})).rejects.toThrow('CHARACTER_NOT_FOUND');
    await expect(s.delete(owner, life(id, 1))).rejects.toThrow('CHARACTER_NOT_FOUND');
    await expect(s.restore(owner, life(id, 1))).rejects.toThrow('CHARACTER_NOT_FOUND');
    expect(await state()).toEqual(before);
    if (kind !== 'missing') expect(await s.list(owner)).toEqual({items: [], nextCursor: null, totalMatching: 0});
  });
  it.each(['missing', 'foreign', 'deleted', 'pending'] as const)('rejects %s portrait and rolls back Gate, template and receipt', async kind => {
    const s = await service(), ref = kind === 'missing' ? v7() : (await asset(kind === 'foreign' ? {ownerId: await profile()}
      : kind === 'deleted' ? {deletedAt: new Date()} : {status: 'pending'})).id;
    const before = await state(); await expect(s.create(owner, command('头像', ref))).rejects.toThrow('INVALID_CHARACTER_PORTRAIT'); expect(await state()).toEqual(before);
    const {data} = await s.create(owner, command()), after = await state();
    await expect(s.update(owner, {...life(data.id, 1), patch: {portraitAssetId: ref}})).rejects.toThrow('INVALID_CHARACTER_PORTRAIT');
    expect(await state()).toEqual(after); expect(await s.get(owner, data.id)).toEqual(data);
  });
  it('validates effective portrait after revision check, revalidates restore, and allows explicit unlink', async () => {
    const s = await service(), ref = await asset(), input = command('头像', ref.id), {data} = await s.create(owner, input);
    await db.asset.update({where: {id: ref.id}, data: {deletedAt: new Date()}});
    const before = await state();
    await expect(s.update(owner, {...life(data.id, 2), patch: {name: 'CAS先失败'}})).rejects.toThrow('REVISION_CONFLICT');
    await expect(s.update(owner, {...life(data.id, 1), patch: {name: '仍有失效引用'}})).rejects.toThrow('INVALID_CHARACTER_PORTRAIT');
    expect(await state()).toEqual(before);
    expect((await s.create(owner, input)).replayed).toBe(true); // historical receipt does not revalidate a now-deleted portrait
    await s.delete(owner, life(data.id, 1));
    await expect(s.restore(owner, life(data.id, 2))).rejects.toThrow('INVALID_CHARACTER_PORTRAIT');
    await db.asset.update({where: {id: ref.id}, data: {deletedAt: null}});
    await s.restore(owner, life(data.id, 2));
    const unlinked = await s.update(owner, {...life(data.id, 3), patch: {portraitAssetId: null}}); expect(unlinked.data.portraitAssetId).toBeNull();
  });
  it('does not mutate historical CharacterVersion during edits, soft delete or restore', async () => {
    const s = await service(), ref = await asset(), {data} = await s.create(owner, command('历史', ref.id));
    const version = await db.characterVersion.create({data: {id: v7(), ownerId: owner.ownerId, characterTemplateId: data.id, versionNo: 1, sourceRevision: 1,
      name: data.name, settings: data.settings, portraitAssetId: data.portraitAssetId, createdAt: new Date(data.createdAt)}});
    await s.update(owner, {...life(data.id, 1), patch: {name: '新名字', portraitAssetId: null}});
    await s.delete(owner, life(data.id, 2)); await s.restore(owner, life(data.id, 3));
    await db.asset.update({where: {id: ref.id}, data: {deletedAt: new Date()}});
    expect(await db.characterVersion.findUniqueOrThrow({where: {id: version.id}})).toEqual(version);
  });
  it('uses same-filter q counts across keyset pages with literal percent/underscore and isolates owner/scope/deleted', async () => {
    const s = await service();
    for (const name of ['角色%_甲', '角色%_乙', '角色%_丙', '角色xx', 'other']) await s.create(owner, command(name));
    const internal = await s.create(owner, command('角色%_内部'));
    await db.characterTemplate.update({where: {id: internal.data.id}, data: {scope: 'story', sourceStoryDraftId: v7()}});
    const foreign = await s.create(owner, command('角色%_别人的'));
    await db.characterTemplate.update({where: {id: foreign.data.id}, data: {ownerId: await profile()}});
    const removed = await s.create(owner, command('角色%_已删除')); await s.delete(owner, life(removed.data.id, 1));
    const a = await s.list(owner, {q: '%_', limit: 2}); expect(a.items).toHaveLength(2); expect(a.totalMatching).toBe(3); expect(a.nextCursor).not.toBeNull();
    const b = await s.list(owner, {q: '%_', limit: 2, cursor: a.nextCursor!}); expect(b.items).toHaveLength(1); expect(b.totalMatching).toBe(3); expect(b.nextCursor).toBeNull();
    expect(new Set([...a.items, ...b.items].map(x => x.id)).size).toBe(3);
    expect((await s.list(owner, {q: '%_', deleted: 'only'})).items.map(x => x.id)).toEqual([removed.data.id]);
    expect((await s.list(owner, {q: "' OR 1=1 --"})).totalMatching).toBe(0);
    for (const patch of [{q: 'other'}, {deleted: 'only' as const}]) await expect(s.list(owner, {q: '%_', cursor: a.nextCursor!, ...patch})).rejects.toThrow('INVALID_CURSOR');
    await expect(s.list({...owner, datasetId: v7()}, {q: '%_', cursor: a.nextCursor!})).rejects.toThrow('INVALID_CURSOR');
  });
  it.each(['update', 'delete', 'restore'] as const)('rejects %s overflow and rolls back all writes', async action => {
    const s = await service(), {data} = await s.create(owner, command());
    await db.characterTemplate.update({where: {id: data.id}, data: {revision: 2147483647, ...(action === 'restore' ? {deletedAt: new Date()} : {})}});
    const before = await state(), payload = life(data.id, 2147483647);
    await expect(action === 'update' ? s.update(owner, {...payload, patch: {name: 'overflow'}}) : s[action](owner, payload)).rejects.toThrow('REVISION_EXHAUSTED');
    expect(await state()).toEqual(before);
  });
  it('only permits one concurrent CAS writer across two connections', async () => {
    const a = await service(), b = await service(await connect()), {data} = await a.create(owner, command());
    const commands = [{...life(data.id, 1), patch: {name: 'A'}}, {...life(data.id, 1), patch: {name: 'B'}}];
    const results = await Promise.allSettled([a.update(owner, commands[0]!), b.update(owner, commands[1]!)]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    // SQLite may reject the competing transaction at lock acquisition. An explicit
    // later attempt with that exact command must reach CAS and reject the stale revision.
    const loser = results.findIndex(x => x.status === 'rejected');
    await expect(a.update(owner, commands[loser]!)).rejects.toThrow('REVISION_CONFLICT');
    expect((await a.get(owner, data.id)).revision).toBe(2); expect(await db.commandReceipt.count()).toBe(2);
  });
  it('rejects corrupt stored JSON and receipt JSON without leaking content', async () => {
    const s = await service(), input = command(), {data} = await s.create(owner, input);
    await db.characterTemplate.update({where: {id: data.id}, data: {settings: {secret: '/private/path'}}});
    await expect(s.get(owner, data.id)).rejects.toThrow('STORED_CHARACTER_INVALID');
    await expect(s.update(owner, {...life(data.id, 1), patch: {name: 'no overwrite'}})).rejects.toThrow('STORED_CHARACTER_INVALID');
    await db.commandReceipt.updateMany({data: {response: {secret: '/private/path'}}});
    await expect(s.create(owner, input)).rejects.toThrow('COMMAND_RECEIPT_INVALID');
  });
  it('rejects inactive owner reads and writes before exposing cached receipts', async () => {
    const s = await service(), input = command(), {data} = await s.create(owner, input);
    await db.localProfile.update({where: {id: owner.ownerId}, data: {deletedAt: new Date()}});
    const before = await state();
    await expect(s.create(owner, input)).rejects.toThrow('OWNER_UNAVAILABLE');
    await expect(s.get(owner, data.id, true)).rejects.toThrow('OWNER_UNAVAILABLE');
    await expect(s.list(owner)).rejects.toThrow('OWNER_UNAVAILABLE'); expect(await state()).toEqual(before);
  });
  it('rolls back CAS and Gate if receipt insertion fails after a character update', async () => {
    const s = await service(), {data} = await s.create(owner, command()), existing = await db.commandReceipt.findFirstOrThrow();
    const {createCharacterService} = await import('../src/composition/character-service.js');
    const broken = createCharacterService(db, {clock: {now: () => new Date()}, ids: {next: () => existing.id}}), before = await state();
    await expect(broken.update(owner, {...life(data.id, 1), patch: {name: '应回滚'}})).rejects.toMatchObject({code: 'P2002'});
    expect(await state()).toEqual(before); expect(await s.get(owner, data.id)).toEqual(data);
  });
  it('paginates stable timestamp ties by descending UUID with an unchanged total count', async () => {
    const s = await service(); for (let i = 0; i < 5; i++) await s.create(owner, command('tie'));
    await db.characterTemplate.updateMany({data: {updatedAt: new Date('2026-09-12T00:00:00.000Z')}});
    const ids: string[] = []; let cursor: string | undefined;
    do {
      const page = await s.list(owner, {limit: 2, q: 'tie', ...(cursor ? {cursor} : {})});
      ids.push(...page.items.map(item => item.id)); expect(page.totalMatching).toBe(5); cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids).toHaveLength(5); expect(new Set(ids).size).toBe(5); expect(ids).toEqual([...ids].sort().reverse());
  });
  it('canonicalizes reordered settings on command hashing and historical receipt reads', async () => {
    const s = await service(), input = command(), first = await s.create(owner, input);
    const reordered = {boundaries: '', appearance: '', personality: '', speakingStyle: ''};
    await db.commandReceipt.updateMany({data: {response: {...first.data, settings: reordered}}});
    const replay = await s.create(owner, {...input, settings: reordered});
    expect(replay).toEqual({...first, replayed: true}); expect(Object.keys(replay.data.settings)).toEqual(Object.keys(settings));
    expect(await db.characterTemplate.count()).toBe(1);
  });

});
