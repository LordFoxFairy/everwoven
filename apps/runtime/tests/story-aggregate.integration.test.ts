import {beforeAll, afterAll, beforeEach, afterEach, expect, it, vi} from 'vitest';
import {v7} from 'uuid';
import {
  prepare,
  dispose,
  fixture,
  overrides,
  slots,
  characterSettings,
  type Fixture,
} from './fixtures/story-aggregate/setup.js';
import {parseDraftDTO} from '../src/contracts/story-draft-output.js';
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
const library = (id: string, revision = 1) => ({
  kind: 'library' as const,
  templateId: id,
  expectedTemplateRevision: revision,
  overrides,
});
it('creates/gets an explicit empty aggregate and emits an identity-bound full historical receipt', async () => {
  const command = f.create();
  const a = await f.service.create(f.owner, command);
  expect(parseDraftDTO(a.data)).toEqual(a.data);
  expect(await f.service.get(f.owner, f.get(a.data.id))).toEqual(a.data);
  const receipt = await f.db.commandReceipt.findFirstOrThrow();
  expect(receipt.id).toBe(a.data.id);
  expect(receipt.response).toEqual(a.data);
  expect(await f.service.create(f.owner, command)).toEqual({...a, replayed: true});
});
it('freezes library version, bound updates never consult current template and cannot inject another version', async () => {
  const t = await f.template();
  const a = (await f.service.create(f.owner, {...f.create(), mainCharacter: library(t.id)})).data;
  expect(a.mainCharacter!.version.sourceRevision).toBe(1);
  await f.db.characterTemplate.update({where: {id: t.id}, data: {name: 'latest', revision: 2, deletedAt: f.now}});
  const b = await f.service.update(f.owner, {
    ...f.change(a.id, 1),
    patch: {
      mainCharacter: {
        kind: 'bound',
        characterVersionId: a.mainCharacter!.version.id,
        overrides: {...overrides, name: '', settings: {personality: ''}},
      },
    },
  });
  expect(b.data.mainCharacter!.version.name).toBe('name');
  expect(b.data.mainCharacter!.effective.name).toBe('');
  expect(b.data.mainCharacter!.effective.settings.personality).toBe('');
  await expect(
    f.service.update(f.owner, {
      ...f.change(a.id, 2),
      patch: {mainCharacter: {kind: 'bound', characterVersionId: v7(), overrides}},
    }),
  ).rejects.toThrow('INVALID_STORY_COMMAND');
  expect(await f.db.characterVersion.count()).toBe(1);
});
it('library expected revision and scope are strict; equal names remain legal', async () => {
  const t = await f.template();
  await expect(f.service.create(f.owner, {...f.create(), mainCharacter: library(t.id, 2)})).rejects.toThrow(
    'TEMPLATE_REVISION_CONFLICT',
  );
  await f.db.characterTemplate.update({where: {id: t.id}, data: {scope: 'story', sourceStoryDraftId: v7()}});
  await expect(f.service.create(f.owner, {...f.create(), mainCharacter: library(t.id)})).rejects.toThrow(
    'CHARACTER_NOT_FOUND',
  );
  expect(await f.db.storyDraft.count()).toBe(0);
});
it('reuses one immutable version per source revision, and rejects corrupted version content', async () => {
  const t = await f.template();
  await f.service.create(f.owner, {...f.create(), mainCharacter: library(t.id)});
  await f.service.create(f.owner, {...f.create(), mainCharacter: library(t.id)});
  expect(await f.db.characterVersion.count()).toBe(1);
  await f.db.characterVersion.updateMany({data: {name: 'corrupt'}});
  await expect(f.service.create(f.owner, {...f.create(), mainCharacter: library(t.id)})).rejects.toThrow(
    'STORED_STORY_INVALID',
  );
  expect(await f.db.storyDraft.count()).toBe(2);
});
it('inline edits only the current internal template, never revives a detached one', async () => {
  const inline = {
    kind: 'inline' as const,
    name: 'inline',
    settings: characterSettings,
    portraitAssetId: null,
    overrides,
  };
  let a = (await f.service.create(f.owner, {...f.create(), mainCharacter: inline})).data;
  const templateId = a.mainCharacter!.version.characterTemplateId;
  a = (
    await f.service.update(f.owner, {
      ...f.change(a.id, a.revision),
      patch: {mainCharacter: {...inline, name: 'edited'}},
    })
  ).data;
  expect(a.mainCharacter!.version.characterTemplateId).toBe(templateId);
  expect(a.mainCharacter!.version.sourceRevision).toBe(2);
  expect(await f.db.characterVersion.count()).toBe(2);
  a = (await f.service.update(f.owner, {...f.change(a.id, a.revision), patch: {mainCharacter: null}})).data;
  a = (await f.service.update(f.owner, {...f.change(a.id, a.revision), patch: {mainCharacter: inline}})).data;
  expect(a.mainCharacter!.version.characterTemplateId).not.toBe(templateId);
  expect(await f.db.characterTemplate.count()).toBe(2);
});
it('validates portrait modes against merged slots and clears only character on explicit main removal', async () => {
  const image = await f.asset(),
    t = await f.template();
  const main = {...library(t.id), overrides: {portrait: {mode: 'asset' as const, assetId: image.id}, relationship: ''}};
  let a = (
    await f.service.create(f.owner, {
      ...f.create(),
      mainCharacter: main,
      assetSlots: {cover: image.id, opening: null, character: image.id},
    })
  ).data;
  await expect(
    f.service.update(f.owner, {
      ...f.change(a.id, 1),
      patch: {mainCharacter: {kind: 'bound', characterVersionId: a.mainCharacter!.version.id, overrides}},
    }),
  ).rejects.toThrow('INVALID_STORY_COMMAND');
  await expect(
    f.service.update(f.owner, {
      ...f.change(a.id, 1),
      patch: {mainCharacter: null, assetSlots: {...slots, character: image.id}},
    }),
  ).rejects.toThrow('INVALID_STORY_COMMAND');
  a = (await f.service.update(f.owner, {...f.change(a.id, 1), patch: {mainCharacter: null}})).data;
  expect(a.assetSlots).toEqual({cover: image.id, opening: null, character: null});
});
it('preserves same-slot historical unavailable assets but rejects relocation/new character binding', async () => {
  const image = await f.asset(),
    t = await f.template(image.id);
  const a = (
    await f.service.create(f.owner, {
      ...f.create(),
      mainCharacter: library(t.id),
      assetSlots: {...slots, cover: image.id},
    })
  ).data;
  await f.db.asset.update({where: {id: image.id}, data: {status: 'unavailable', revision: 2}});
  const b = (await f.service.update(f.owner, {...f.change(a.id, 1), patch: {title: 'text survives'}})).data;
  expect(b.assets[0]).toMatchObject({state: 'present', data: {status: 'unavailable'}});
  await expect(
    f.service.update(f.owner, {...f.change(a.id, 2), patch: {assetSlots: {...slots, opening: image.id}}}),
  ).rejects.toThrow('STORY_ASSET_NOT_READY');
  const other = await f.template(image.id);
  await expect(
    f.service.update(f.owner, {...f.change(a.id, 2), patch: {mainCharacter: library(other.id)}}),
  ).rejects.toThrow('STORY_ASSET_NOT_READY');
});
it('missing asset rows are explicit views on retained references and historical receipts stay unchanged', async () => {
  const image = await f.asset(),
    command = {...f.create(), assetSlots: {...slots, cover: image.id}};
  const first = await f.service.create(f.owner, command);
  await f.db.asset.delete({where: {id: image.id}});
  expect((await f.service.get(f.owner, f.get(first.data.id))).assets).toEqual([
    {state: 'missing', id: image.id, datasetId: f.owner.datasetId},
  ]);
  expect(await f.service.create(f.owner, command)).toEqual({...first, replayed: true});
});
it('root delete/restore preserves frozen rows and only increments root once', async () => {
  const t = await f.template();
  const a = (await f.service.create(f.owner, {...f.create(), mainCharacter: library(t.id)})).data;
  const cast = await f.db.storyDraftCast.findFirstOrThrow();
  const d = (await f.service.delete(f.owner, f.change(a.id, 1))).data;
  expect(d.revision).toBe(2);
  const r = (await f.service.restore(f.owner, f.change(a.id, 2))).data;
  expect(r.revision).toBe(3);
  expect(await f.db.storyDraftCast.findFirstOrThrow()).toEqual(cast);
  expect(await f.db.characterVersion.count()).toBe(1);
  expect(await f.db.storyVersion.count()).toBe(0);
});
it('new references require same-owner ready assets, with zero aggregate side effects on refusal', async () => {
  const image = await f.asset();
  await f.db.asset.update({where: {id: image.id}, data: {ownerId: v7()}});
  await expect(f.service.create(f.owner, {...f.create(), assetSlots: {...slots, cover: image.id}})).rejects.toThrow(
    'ASSET_NOT_FOUND',
  );
  expect(await f.db.storyDraft.count()).toBe(0);
  expect(await f.db.commandReceipt.count()).toBe(0);
});
it('list q is literal, genre exact, total excludes cursor and scopeHash does not expose owner', async () => {
  for (const title of ['one%', 'two%', 'three']) await f.service.create(f.owner, f.create(title));
  const page = await f.service.list(f.owner, {...f.protocol, q: '%', genre: 'genre', limit: 1});
  expect(page.totalMatching).toBe(2);
  expect(page.items).toHaveLength(1);
  expect(page.items[0]).not.toHaveProperty('settings');
  const cursor = JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString());
  expect(cursor).not.toHaveProperty('ownerId');
  expect(JSON.stringify(cursor)).not.toContain(f.owner.ownerId);
  const next = await f.service.list(f.owner, {
    ...f.protocol,
    q: '%',
    genre: 'genre',
    limit: 1,
    cursor: page.nextCursor!,
  });
  expect(next.totalMatching).toBe(2);
  expect(next.items[0]!.id).not.toBe(page.items[0]!.id);
  await expect(f.service.list(f.owner, {...f.protocol, q: 'different', cursor: page.nextCursor!})).rejects.toThrow(
    'INVALID_CURSOR',
  );
});
