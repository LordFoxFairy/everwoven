import {beforeAll, afterAll, beforeEach, afterEach, expect, it, vi} from 'vitest';
import {v7} from 'uuid';
import {Prisma} from '../src/generated/prisma/client.js';
import {
  prepare,
  dispose,
  fixture,
  overrides,
  slots,
  characterSettings,
  type Fixture,
} from './fixtures/story-aggregate/setup.js';
import {PrismaStoryDraftStore, storyListSQL} from '../src/infrastructure/db/prisma-story-draft-store.js';
import type {StoryDraftStore, StoryDraftWriteScope} from '../src/ports/story-draft-store.js';
import {
  createDraft,
  updateDraft,
  getDraft,
  listDrafts,
  deleteDraft,
  restoreDraft,
} from '../src/application/story-drafts.js';
let f: Fixture;
beforeAll(prepare, 30000);
afterAll(dispose);
beforeEach(async () => {
  f = await fixture();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await f.close();
});
const inline = {kind: 'inline' as const, name: 'inline', settings: characterSettings, portraitAssetId: null, overrides};
const library = (id: string, revision = 1) => ({
  kind: 'library' as const,
  templateId: id,
  expectedTemplateRevision: revision,
  overrides,
});
function intercept(replace: (scope: StoryDraftWriteScope) => StoryDraftWriteScope): StoryDraftStore {
  const base = new PrismaStoryDraftStore(f.db);
  return {read: base.read.bind(base), write: (ownerId, work) => base.write(ownerId, (scope) => work(replace(scope)))};
}
it.each(['insertDraft', 'insertTemplate', 'insertVersion', 'writeCast', 'writeSlots', 'insertReceipt'] as const)(
  'rolls back the whole aggregate and WriteGate after %s fails',
  async (method) => {
    const store = intercept(
      (scope) =>
        new Proxy(scope, {
          get(target, key) {
            if (key !== method) return Reflect.get(target, key);
            return async (...args: never[]) => {
              await (target[method] as (...a: never[]) => Promise<unknown>)(...args);
              throw Error('FIXTURE_AFTER_WRITE');
            };
          },
        }),
    );
    await expect(createDraft(store, f.owner, {...f.create(), mainCharacter: inline})).rejects.toThrow(
      'FIXTURE_AFTER_WRITE',
    );
    expect(
      await Promise.all([
        f.db.storyDraft.count(),
        f.db.characterTemplate.count(),
        f.db.characterVersion.count(),
        f.db.storyDraftCast.count(),
        f.db.storyDraftAsset.count(),
        f.db.commandReceipt.count(),
      ]),
    ).toEqual([0, 0, 0, 0, 0, 0]);
    expect((await f.db.localProfile.findUniqueOrThrow({where: {id: f.owner.ownerId}})).writeEpoch).toBe(0);
  },
);
it('stale root rejects before reading/updating its inline template and preserves all identities', async () => {
  const a = (await f.service.create(f.owner, {...f.create(), mainCharacter: inline})).data;
  const findTemplate = vi.fn();
  const store = intercept((scope) => ({...scope, findTemplate}));
  await expect(
    updateDraft(store, f.owner, {...f.change(a.id, 2), patch: {mainCharacter: {...inline, name: 'B'}}}),
  ).rejects.toThrow('REVISION_CONFLICT');
  expect(findTemplate).not.toHaveBeenCalled();
  expect(await f.db.characterVersion.count()).toBe(1);
  expect(await f.service.get(f.owner, f.get(a.id))).toEqual(a);
});
it('failed root CAS rolls back a prepared inline revision and its new immutable version', async () => {
  const a = (await f.service.create(f.owner, {...f.create(), mainCharacter: inline})).data;
  const store = intercept((scope) => ({...scope, compareAndSwapDraft: async () => 0}));
  await expect(
    updateDraft(store, f.owner, {...f.change(a.id, 1), patch: {mainCharacter: {...inline, name: 'B'}}}),
  ).rejects.toThrow('REVISION_CONFLICT');
  expect(await f.db.characterVersion.count()).toBe(1);
  expect((await f.db.characterTemplate.findFirstOrThrow()).revision).toBe(1);
  expect(await f.service.get(f.owner, f.get(a.id))).toEqual(a);
});
it.each(['create', 'update', 'delete', 'restore', 'get', 'list'] as const)(
  '%s protocol and dataset checks precede every store call',
  async (action) => {
    const read = vi.fn(),
      write = vi.fn(),
      store: StoryDraftStore = {read, write};
    const input =
      action === 'create'
        ? f.create()
        : action === 'list'
          ? {...f.protocol}
          : action === 'get'
            ? f.get(v7())
            : {...f.change(v7(), 1), ...(action === 'update' ? {patch: {title: 'B'}} : {})};
    const invoke = (owner: typeof f.owner, raw: unknown) =>
      ({
        create: createDraft,
        update: updateDraft,
        delete: deleteDraft,
        restore: restoreDraft,
        get: getDraft,
        list: listDrafts,
      })[action](store, owner, raw as never);
    await expect(invoke({...f.owner, datasetId: v7()}, input)).rejects.toThrow('DATASET_CHANGED');
    await expect(invoke(f.owner, {...input, protocolVersion: 2})).rejects.toThrow('CLIENT_RELOAD_REQUIRED');
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  },
);
it.each([
  'cast-owner',
  'version-owner',
  'version-missing',
  'version-schema',
  'cast-schema',
  'cast-name-null',
  'cover-owner',
])('list and detail refuse a corrupt visible relation: %s', async (fault) => {
  const image = await f.asset(),
    t = await f.template();
  const a = (
    await f.service.create(f.owner, {
      ...f.create(),
      mainCharacter: library(t.id),
      assetSlots: {...slots, cover: image.id},
    })
  ).data;
  const cast = await f.db.storyDraftCast.findFirstOrThrow();
  if (fault === 'cast-owner') await f.db.storyDraftCast.update({where: {id: cast.id}, data: {ownerId: v7()}});
  if (fault === 'version-owner')
    await f.db.characterVersion.update({where: {id: cast.characterVersionId}, data: {ownerId: v7()}});
  if (fault === 'version-missing') await f.db.characterVersion.delete({where: {id: cast.characterVersionId}});
  if (fault === 'version-schema')
    await f.db.characterVersion.update({where: {id: cast.characterVersionId}, data: {schemaVersion: 2}});
  if (fault === 'cast-schema') await f.db.storyDraftCast.update({where: {id: cast.id}, data: {schemaVersion: 2}});
  if (fault === 'cast-name-null')
    await f.db.storyDraftCast.update({where: {id: cast.id}, data: {overrides: {...overrides, name: null}}});
  if (fault === 'cover-owner') await f.db.storyDraftAsset.updateMany({data: {ownerId: v7()}});
  await expect(f.service.get(f.owner, f.get(a.id))).rejects.toThrow('STORED_STORY_INVALID');
  await expect(f.service.list(f.owner, f.protocol)).rejects.toThrow('STORED_STORY_INVALID');
});
it('bound cannot use another root version, even for the same owner', async () => {
  const a = (await f.service.create(f.owner, {...f.create(), mainCharacter: inline})).data;
  const b = (await f.service.create(f.owner, {...f.create(), mainCharacter: inline})).data;
  await expect(
    f.service.update(f.owner, {
      ...f.change(a.id, 1),
      patch: {mainCharacter: {kind: 'bound', characterVersionId: b.mainCharacter!.version.id, overrides}},
    }),
  ).rejects.toThrow('INVALID_STORY_COMMAND');
  expect(await f.db.commandReceipt.count()).toBe(2);
});
it('inline refuses a shadow internal template for another root', async () => {
  const a = (await f.service.create(f.owner, {...f.create(), mainCharacter: inline})).data;
  await f.db.characterTemplate.update({
    where: {id: a.mainCharacter!.version.characterTemplateId},
    data: {sourceStoryDraftId: v7()},
  });
  await expect(f.service.update(f.owner, {...f.change(a.id, 1), patch: {mainCharacter: inline}})).rejects.toThrow(
    'STORED_STORY_INVALID',
  );
  expect(await f.db.characterVersion.count()).toBe(1);
});
it.each(['root', 'template', 'versionNo'])('revision bound %s cannot wrap or leave partial rows', async (kind) => {
  const a = (await f.service.create(f.owner, {...f.create(), mainCharacter: inline})).data,
    version = a.mainCharacter!.version;
  if (kind === 'root') await f.db.storyDraft.update({where: {id: a.id}, data: {revision: 2147483647}});
  if (kind === 'template') {
    await f.db.characterTemplate.update({where: {id: version.characterTemplateId}, data: {revision: 2147483647}});
    await f.db.characterVersion.update({where: {id: version.id}, data: {sourceRevision: 2147483647}});
  }
  if (kind === 'versionNo')
    await f.db.characterVersion.update({where: {id: version.id}, data: {versionNo: 2147483647}});
  await expect(
    f.service.update(f.owner, {
      ...f.change(a.id, kind === 'root' ? 2147483647 : 1),
      patch: {mainCharacter: {...inline, name: 'B'}},
    }),
  ).rejects.toThrow('REVISION_EXHAUSTED');
  expect(await f.db.characterVersion.count()).toBe(1);
  expect(await f.db.commandReceipt.count()).toBe(1);
});
it('EXPLAINs the actual lightweight owner/filter/keyset SQL without changing the baseline indexes', async () => {
  const sql = storyListSQL(f.owner.ownerId, {
    deleted: 'exclude',
    q: '%',
    genre: 'genre',
    take: 2,
    before: {updatedAt: f.now, id: v7()},
  });
  const rows = await f.db.$queryRaw<{detail: string}[]>(Prisma.sql`EXPLAIN QUERY PLAN ${sql}`);
  expect(rows.some((row) => row.detail.includes('SEARCH s USING INDEX'))).toBe(true);
  expect(sql.sql).not.toMatch(/SELECT\s+\*/i);
  // Evidence, not a claim that literal contains or the optional genre filter has an index.
  process.stdout.write(`STORY_LIST_EXPLAIN ${JSON.stringify(rows.map((row) => row.detail))}\n`);
});

function heldGate() {
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const store = intercept((scope) => ({
    ...scope,
    findReceipt: async (id) => {
      entered.resolve();
      await release.promise;
      return scope.findReceipt(id);
    },
  }));
  return {store, entered: entered.promise, release: () => release.resolve()};
}
it.each([true, false])(
  'a competing create has zero writes; explicit original retry freezes once (same command=%s)',
  async (sameCommand) => {
    const {openRuntimeDatabase} = await import('../src/infrastructure/db/client.js');
    const files = await f.db.$queryRaw<Array<{name: string; file: string}>>`PRAGMA database_list`,
      db = await openRuntimeDatabase(files.find((row) => row.name === 'main')!.file);
    try {
      const t = await f.template(),
        a = {...f.create(), mainCharacter: library(t.id)},
        b = sameCommand ? a : {...a, commandId: v7()},
        gate = heldGate();
      const first = createDraft(gate.store, f.owner, a);
      await gate.entered;
      const competitor = new PrismaStoryDraftStore(db),
        entered = vi.fn();
      const blocked: StoryDraftStore = {
        read: competitor.read.bind(competitor),
        write: (ownerId, work) =>
          competitor.write(ownerId, (scope) => {
            entered();
            return work(scope);
          }),
      };
      try {
        await expect(createDraft(blocked, f.owner, b)).rejects.toMatchObject({code: 'P1008'});
        expect(entered).not.toHaveBeenCalled();
        expect(await db.storyDraft.count()).toBe(0);
        expect(await db.characterVersion.count()).toBe(0);
        expect(await db.commandReceipt.count()).toBe(0);
      } finally {
        gate.release();
      }
      const firstResult = await first,
        retried = await createDraft(competitor, f.owner, b);
      expect(await f.db.characterVersion.count()).toBe(1);
      expect(await f.db.storyDraft.count()).toBe(sameCommand ? 1 : 2);
      expect(await f.db.commandReceipt.count()).toBe(sameCommand ? 1 : 2);
      expect(retried.replayed).toBe(sameCommand);
      if (sameCommand) expect(retried.data).toEqual(firstResult.data);
    } finally {
      await db.$disconnect();
    }
  },
);
it('competing inline update fails at Gate; original retry sees stale CAS and creates no extra version', async () => {
  const {openRuntimeDatabase} = await import('../src/infrastructure/db/client.js');
  const files = await f.db.$queryRaw<Array<{name: string; file: string}>>`PRAGMA database_list`,
    db = await openRuntimeDatabase(files.find((row) => row.name === 'main')!.file);
  try {
    const a = (await f.service.create(f.owner, {...f.create(), mainCharacter: inline})).data,
      gate = heldGate();
    const first = updateDraft(gate.store, f.owner, {
      ...f.change(a.id, 1),
      patch: {mainCharacter: {...inline, name: 'A'}},
    });
    await gate.entered;
    const command = {...f.change(a.id, 1), patch: {mainCharacter: {...inline, name: 'B'}}},
      store = new PrismaStoryDraftStore(db);
    try {
      await expect(updateDraft(store, f.owner, command)).rejects.toMatchObject({code: 'P1008'});
    } finally {
      gate.release();
    }
    await first;
    await expect(updateDraft(store, f.owner, command)).rejects.toThrow('REVISION_CONFLICT');
    expect(await f.db.characterTemplate.count()).toBe(1);
    expect((await f.db.characterTemplate.findFirstOrThrow()).revision).toBe(2);
    expect(await f.db.characterVersion.count()).toBe(2);
    expect(await f.db.storyDraftCast.count()).toBe(1);
    expect(await f.db.commandReceipt.count()).toBe(2);
  } finally {
    await db.$disconnect();
  }
});
it('detail reads root, frozen cast and asset metadata in one snapshot during a concurrent aggregate change', async () => {
  const {openRuntimeDatabase} = await import('../src/infrastructure/db/client.js');
  const files = await f.db.$queryRaw<Array<{name: string; file: string}>>`PRAGMA database_list`,
    db = await openRuntimeDatabase(files.find((row) => row.name === 'main')!.file);
  try {
    const image = await f.asset(),
      a = (
        await f.service.create(f.owner, {...f.create(), mainCharacter: inline, assetSlots: {...slots, cover: image.id}})
      ).data;
    const base = new PrismaStoryDraftStore(f.db);
    const store: StoryDraftStore = {
      write: base.write.bind(base),
      read: (ownerId, work) =>
        base.read(ownerId, (scope) =>
          work({
            ...scope,
            findCast: async (id) => {
              await updateDraft(new PrismaStoryDraftStore(db), f.owner, {
                ...f.change(a.id, 1),
                patch: {title: 'concurrent', mainCharacter: {...inline, name: 'B'}},
              });
              await db.asset.update({where: {id: image.id}, data: {status: 'unavailable', revision: 2}});
              return scope.findCast(id);
            },
          }),
        ),
    };
    expect(await getDraft(store, f.owner, f.get(a.id))).toEqual(a);
    const latest = await f.service.get(f.owner, f.get(a.id));
    expect(latest.title).toBe('concurrent');
    expect(latest.mainCharacter!.version.name).toBe('B');
    expect(latest.assets[0]).toMatchObject({state: 'present', data: {status: 'unavailable'}});
  } finally {
    await db.$disconnect();
  }
});
