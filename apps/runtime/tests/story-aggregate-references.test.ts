import {beforeAll, afterAll, beforeEach, afterEach, expect, it} from 'vitest';
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
let f: Fixture;
beforeAll(prepare, 30000);
afterAll(dispose);
beforeEach(async () => {
  f = await fixture();
});
afterEach(async () => {
  await f.close();
});
const inline = {kind: 'inline' as const, name: 'inline', settings: characterSettings, portraitAssetId: null, overrides};
it('new inline base is explicitly null even if its proposed image is ready', async () => {
  const image = await f.asset();
  await expect(
    f.service.create(f.owner, {...f.create(), mainCharacter: {...inline, portraitAssetId: image.id}}),
  ).rejects.toThrow('INVALID_STORY_COMMAND');
  expect(await f.db.storyDraft.count()).toBe(0);
  expect(await f.db.characterTemplate.count()).toBe(0);
});
it.each(['unavailable', 'deleted', 'missing'])(
  'same current inline text edits retain its existing base portrait: %s',
  async (kind) => {
    const image = await f.asset();
    let a = (await f.service.create(f.owner, {...f.create(), mainCharacter: inline})).data;
    a = (
      await f.service.update(f.owner, {
        ...f.change(a.id, 1),
        patch: {mainCharacter: {...inline, portraitAssetId: image.id}},
      })
    ).data;
    if (kind === 'missing') await f.db.asset.delete({where: {id: image.id}});
    else
      await f.db.asset.update({
        where: {id: image.id},
        data: kind === 'deleted' ? {deletedAt: f.now} : {status: 'unavailable'},
      });
    const b = (
      await f.service.update(f.owner, {
        ...f.change(a.id, 2),
        patch: {mainCharacter: {...inline, name: 'B', portraitAssetId: image.id}},
      })
    ).data;
    expect(b.mainCharacter!.version.characterTemplateId).toBe(a.mainCharacter!.version.characterTemplateId);
    expect(b.mainCharacter!.effective.portraitAssetId).toBe(image.id);
    expect(b.revision).toBe(3);
    expect(b.assets[0]).toMatchObject(
      kind === 'missing' ? {state: 'missing', id: image.id} : {state: 'present', data: {id: image.id}},
    );
  },
);
it('same unavailable character override stays for the current binding, but not for a different binding', async () => {
  const image = await f.asset(),
    role = {...inline, overrides: {portrait: {mode: 'asset' as const, assetId: image.id}, relationship: ''}};
  const a = (
    await f.service.create(f.owner, {...f.create(), mainCharacter: role, assetSlots: {...slots, character: image.id}})
  ).data;
  await f.db.asset.update({where: {id: image.id}, data: {status: 'unavailable'}});
  const b = (await f.service.update(f.owner, {...f.change(a.id, 1), patch: {mainCharacter: {...role, name: 'B'}}}))
    .data;
  expect(b.assetSlots.character).toBe(image.id);
  const other = await f.template();
  await expect(
    f.service.update(f.owner, {
      ...f.change(a.id, 2),
      patch: {
        mainCharacter: {kind: 'library', templateId: other.id, expectedTemplateRevision: 1, overrides: role.overrides},
      },
    }),
  ).rejects.toThrow('STORY_ASSET_NOT_READY');
});
it('hidden library base portrait is still a new reference even when override is none', async () => {
  const image = await f.asset(),
    t = await f.template(image.id);
  await f.db.asset.update({where: {id: image.id}, data: {status: 'unavailable'}});
  await expect(
    f.service.create(f.owner, {
      ...f.create(),
      mainCharacter: {
        kind: 'library',
        templateId: t.id,
        expectedTemplateRevision: 1,
        overrides: {portrait: {mode: 'none'}, relationship: ''},
      },
    }),
  ).rejects.toThrow('STORY_ASSET_NOT_READY');
  expect(await f.db.characterVersion.count()).toBe(0);
  expect(await f.db.storyDraft.count()).toBe(0);
});
it.each(['owner', 'schema', 'settings', 'portrait', 'source'])(
  'library version reuse validates immutable content and owner: %s',
  async (kind) => {
    const t = await f.template();
    const a = (
      await f.service.create(f.owner, {
        ...f.create(),
        mainCharacter: {kind: 'library', templateId: t.id, expectedTemplateRevision: 1, overrides},
      })
    ).data;
    const data =
      kind === 'owner'
        ? {ownerId: v7()}
        : kind === 'schema'
          ? {schemaVersion: 2}
          : kind === 'settings'
            ? {settings: {...characterSettings, appearance: 'corrupt'}}
            : kind === 'portrait'
              ? {portraitAssetId: v7()}
              : {sourceRevision: 2};
    await f.db.characterVersion.update({where: {id: a.mainCharacter!.version.id}, data});
    if (kind === 'source')
      await f.db.characterTemplate.update({where: {id: t.id}, data: {revision: 2, name: 'new actual revision'}});
    await expect(
      f.service.create(f.owner, {
        ...f.create(),
        mainCharacter: {
          kind: 'library',
          templateId: t.id,
          expectedTemplateRevision: kind === 'source' ? 2 : 1,
          overrides,
        },
      }),
    ).rejects.toThrow('STORED_STORY_INVALID');
    expect(await f.db.storyDraft.count()).toBe(1);
  },
);
