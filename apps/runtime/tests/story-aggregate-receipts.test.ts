import {beforeAll, afterAll, beforeEach, afterEach, expect, it} from 'vitest';
import {v7} from 'uuid';
import {prepare, dispose, fixture, overrides, slots, type Fixture} from './fixtures/story-aggregate/setup.js';
import {createDraft, updateDraft, deleteDraft, restoreDraft} from '../src/application/story-drafts.js';
import {PrismaStoryDraftStore} from '../src/infrastructure/db/prisma-story-draft-store.js';
import type {StoryDraftStore} from '../src/ports/story-draft-store.js';
import type {Prisma} from '../src/generated/prisma/client.js';
let f: Fixture;
beforeAll(prepare, 30000);
afterAll(dispose);
beforeEach(async () => {
  f = await fixture();
});
afterEach(async () => {
  await f.close();
});
const json = (v: unknown) => v as Prisma.InputJsonValue;
it('binds same-content create receipts independently of the returned DTO identity', async () => {
  const aInput = f.create('same'),
    bInput = f.create('same');
  const a = await f.service.create(f.owner, aInput),
    b = await f.service.create(f.owner, bInput);
  await f.db.commandReceipt.update({
    where: {ownerId_commandId: {ownerId: f.owner.ownerId, commandId: aInput.commandId}},
    data: {response: json(b.data)},
  });
  await expect(f.service.create(f.owner, aInput)).rejects.toThrow('COMMAND_RECEIPT_INVALID');
  expect(await f.db.storyDraft.count()).toBe(2);
  expect(await f.db.commandReceipt.count()).toBe(2);
  expect(a.data.id).not.toBe(b.data.id);
});
it.each(['revision', 'deleted', 'updated', 'title', 'dataset', 'slots', 'effective', 'binding', 'schema', 'extra'])(
  'rejects structurally/semantically corrupt create receipt %s without rerunning the command',
  async (fault) => {
    const image = await f.asset(),
      t = await f.template(image.id),
      input = {
        ...f.create(),
        mainCharacter: {kind: 'library' as const, templateId: t.id, expectedTemplateRevision: 1, overrides},
        assetSlots: {...slots, cover: image.id},
      };
    const first = await f.service.create(f.owner, input),
      data = structuredClone(first.data);
    if (fault === 'revision') data.revision = 2;
    if (fault === 'deleted') data.deletedAt = data.updatedAt;
    if (fault === 'updated') data.updatedAt = '2099-01-01T00:00:00.000Z';
    if (fault === 'title') data.title = 'different';
    if (fault === 'dataset') data.datasetId = v7();
    if (fault === 'slots') data.assetSlots.opening = image.id;
    if (fault === 'effective') data.mainCharacter!.effective.name = 'fake';
    if (fault === 'binding') data.mainCharacter!.version.characterTemplateId = v7();
    if (fault === 'schema') Object.assign(data, {schemaVersion: 2});
    if (fault === 'extra') Object.assign(data, {ownerId: f.owner.ownerId});
    await f.db.commandReceipt.update({where: {id: first.data.id}, data: {response: json(data)}});
    await expect(f.service.create(f.owner, input)).rejects.toThrow('COMMAND_RECEIPT_INVALID');
    expect(await f.db.storyDraft.count()).toBe(1);
    expect(await f.db.characterVersion.count()).toBe(1);
    expect(await f.db.commandReceipt.count()).toBe(1);
  },
);
it('all four original receipts remain full immutable snapshots without reading current aggregate, template or asset', async () => {
  const image = await f.asset(),
    t = await f.template(image.id),
    input = {
      ...f.create(),
      mainCharacter: {kind: 'library' as const, templateId: t.id, expectedTemplateRevision: 1, overrides},
      assetSlots: {...slots, cover: image.id},
    };
  const a = await f.service.create(f.owner, input),
    u = {
      ...f.change(a.data.id, 1),
      patch: {
        mainCharacter: {
          kind: 'bound' as const,
          characterVersionId: a.data.mainCharacter!.version.id,
          overrides: {...overrides, name: 'B'},
        },
      },
    },
    b = await f.service.update(f.owner, u),
    d = f.change(a.data.id, 2),
    c = await f.service.delete(f.owner, d),
    r = f.change(a.data.id, 3),
    e = await f.service.restore(f.owner, r);
  await f.db.asset.update({where: {id: image.id}, data: {status: 'unavailable', deletedAt: f.now, revision: 2}});
  await f.db.characterTemplate.delete({where: {id: t.id}});
  await f.db.characterVersion.deleteMany();
  await f.db.storyDraft.deleteMany();
  const base = new PrismaStoryDraftStore(f.db);
  const store: StoryDraftStore = {
    read: async () => {
      throw Error('UNEXPECTED_CURRENT_READ');
    },
    write: (ownerId, work) =>
      base.write(ownerId, (scope) =>
        work(
          new Proxy(scope, {
            get(target, key) {
              if (key === 'findReceipt') return target.findReceipt;
              return async () => {
                throw Error('UNEXPECTED_CURRENT_READ_OR_WRITE');
              };
            },
          }),
        ),
      ),
  };
  expect(await createDraft(store, f.owner, input)).toEqual({...a, replayed: true});
  expect(await updateDraft(store, f.owner, u)).toEqual({...b, replayed: true});
  expect(await deleteDraft(store, f.owner, d)).toEqual({...c, replayed: true});
  expect(await restoreDraft(store, f.owner, r)).toEqual({...e, replayed: true});
  expect(await f.db.commandReceipt.count()).toBe(4);
});
it.each(['id', 'revision', 'title', 'slots', 'bound', 'overrides', 'deleted'])(
  'update receipt validates explicit command semantics: %s',
  async (fault) => {
    const t = await f.template(),
      first = await f.service.create(f.owner, {
        ...f.create(),
        mainCharacter: {kind: 'library', templateId: t.id, expectedTemplateRevision: 1, overrides},
      });
    const input = {
      ...f.change(first.data.id, 1),
      patch: {
        title: 'B',
        assetSlots: slots,
        mainCharacter: {
          kind: 'bound' as const,
          characterVersionId: first.data.mainCharacter!.version.id,
          overrides: {...overrides, name: ''},
        },
      },
    };
    const a = await f.service.update(f.owner, input),
      data = structuredClone(a.data);
    if (fault === 'id') data.id = v7();
    if (fault === 'revision') data.revision = 3;
    if (fault === 'title') data.title = 'C';
    if (fault === 'slots') {
      const id = v7();
      data.assetSlots.cover = id;
      data.assets = [{state: 'missing', id, datasetId: f.owner.datasetId}];
    }
    if (fault === 'bound') data.mainCharacter!.version.id = v7();
    if (fault === 'overrides') {
      data.mainCharacter!.overrides.name = 'C';
      data.mainCharacter!.effective.name = 'C';
    }
    if (fault === 'deleted') data.deletedAt = data.updatedAt;
    await f.db.commandReceipt.update({
      where: {ownerId_commandId: {ownerId: f.owner.ownerId, commandId: input.commandId}},
      data: {response: json(data)},
    });
    await expect(f.service.update(f.owner, input)).rejects.toThrow('COMMAND_RECEIPT_INVALID');
    expect((await f.db.storyDraft.findFirstOrThrow()).revision).toBe(2);
    expect(await f.db.commandReceipt.count()).toBe(2);
  },
);

it.each(['missing', 'unavailable', 'deleted'] as const)(
  'create rejects a legal DTO receipt with an impossible original asset state: %s',
  async (state) => {
    const image = await f.asset(),
      input = {...f.create(), assetSlots: {...slots, cover: image.id}};
    const first = await f.service.create(f.owner, input);
    const receipt = await f.db.commandReceipt.findUniqueOrThrow({where: {id: first.data.id}});
    const data = structuredClone(first.data),
      view = data.assets[0]!;
    if (view.state !== 'present') throw Error('FIXTURE_EXPECTED_READY_ASSET');
    if (state === 'missing') data.assets[0] = {state: 'missing', id: image.id, datasetId: f.owner.datasetId};
    else if (state === 'unavailable') view.data.status = 'unavailable';
    else view.data.deletedAt = view.data.updatedAt;
    const {parseDraftDTO} = await import('../src/contracts/story-draft-output.js');
    // These remain legal general/historical DTOs. Only CREATE rules reject them.
    expect(parseDraftDTO(data)).toEqual(data);
    await f.db.commandReceipt.update({where: {id: receipt.id}, data: {response: json(data)}});
    expect((await f.db.commandReceipt.findUniqueOrThrow({where: {id: receipt.id}})).payloadHash).toBe(
      receipt.payloadHash,
    );
    expect(await f.db.asset.findUniqueOrThrow({where: {id: image.id}})).toEqual(image);
    await expect(f.service.create(f.owner, input)).rejects.toThrow('COMMAND_RECEIPT_INVALID');
    const {assertStoryResponse} = await import('../src/application/story-draft-receipts.js');
    expect(() => assertStoryResponse('create', input, data)).toThrow();
    expect(await f.db.storyDraft.count()).toBe(1);
    expect(await f.db.commandReceipt.count()).toBe(1);
  },
);
it('a genuinely later unavailable Asset does not invalidate its original ready create receipt', async () => {
  const image = await f.asset(),
    input = {...f.create(), assetSlots: {...slots, cover: image.id}};
  const first = await f.service.create(f.owner, input);
  expect(first.data.assets[0]).toMatchObject({state: 'present', data: {status: 'ready', deletedAt: null}});
  await f.db.asset.update({where: {id: image.id}, data: {status: 'unavailable', revision: 2}});
  expect((await f.service.get(f.owner, f.get(first.data.id))).assets[0]).toMatchObject({
    state: 'present',
    data: {status: 'unavailable'},
  });
  expect(await f.service.create(f.owner, input)).toEqual({...first, replayed: true});
});
it.each(['missing', 'unavailable', 'deleted'] as const)(
  'update/delete/restore can issue and replay historical retained asset state: %s',
  async (state) => {
    const image = await f.asset(),
      first = await f.service.create(f.owner, {...f.create(), assetSlots: {...slots, cover: image.id}});
    if (state === 'missing') await f.db.asset.delete({where: {id: image.id}});
    else
      await f.db.asset.update({
        where: {id: image.id},
        data: state === 'unavailable' ? {status: 'unavailable', revision: 2} : {deletedAt: f.now, revision: 2},
      });
    const update = {...f.change(first.data.id, 1), patch: {title: 'retained'}};
    const changed = await f.service.update(f.owner, update);
    const deletion = f.change(first.data.id, 2),
      deleted = await f.service.delete(f.owner, deletion);
    const restoration = f.change(first.data.id, 3),
      restored = await f.service.restore(f.owner, restoration);
    expect(changed.data.assets[0]).toMatchObject(
      state === 'missing'
        ? {state: 'missing', id: image.id}
        : {
            state: 'present',
            data: state === 'unavailable' ? {status: 'unavailable'} : {deletedAt: f.now.toISOString()},
          },
    );
    expect(deleted.data.assets).toEqual(changed.data.assets);
    expect(restored.data.assets).toEqual(changed.data.assets);
    expect(await f.service.update(f.owner, update)).toEqual({...changed, replayed: true});
    expect(await f.service.delete(f.owner, deletion)).toEqual({...deleted, replayed: true});
    expect(await f.service.restore(f.owner, restoration)).toEqual({...restored, replayed: true});
  },
);
