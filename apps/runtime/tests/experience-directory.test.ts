import {beforeAll, afterAll, expect, it} from 'vitest';
import {v7} from 'uuid';
import {prepare, dispose, fixture} from './fixtures/story-aggregate/setup.js';
import {binding} from './fixtures/provider-binding.js';
import {createExperienceOpeningService} from '../src/composition/experience-opening-service.js';
import {parseExperienceList, parseExperiencePage} from '../src/contracts/experience-directory.js';
beforeAll(prepare); afterAll(dispose);
async function setup() {
  const f = await fixture(), service = createExperienceOpeningService(f.db, {resolve: () => binding(f.owner.ownerId)});
  async function create(title = '封存世界') {
    const story = (await f.service.create(f.owner, f.create(title))).data;
    const result = await service.create(f.owner, {...f.protocol, commandId: v7(), storyDraftId: story.id, expectedStoryRevision: story.revision,
      bindingKey: 'video-primary', expectedBindingVersion: 1, budget: {limitMicros: '1234567', currency: 'USD'}});
    return {story, data: result.data};
  }
  return {...f, service, create};
}
it('strictly bounds list input, canonicalizes default, rejects extra authority/invalid cursor', () => {
  const p = {protocolVersion: 1, datasetId: v7()}; expect(parseExperienceList(p)).toEqual({...p, limit: 20});
  for (const patch of [{limit: null}, {limit: 0}, {limit: 51}, {limit: 1.5}, {ownerId: v7()}, {cursor: 'x'.repeat(2049)}, {cursor: ''}])
    expect(() => parseExperienceList({...p, ...patch})).toThrow();
});
it('lists original sealed facts after source changes/deletion and no current registry', async () => {
  const f = await setup();
  try {
    const {data, story} = await f.create('最初的名字');
    await f.db.storyDraft.update({where: {id: story.id}, data: {title: '改掉了', deletedAt: new Date()}});
    const unconfigured = createExperienceOpeningService(f.db, {resolve: () => {throw Error('must not resolve');}});
    const page = await unconfigured.list(f.owner, f.protocol);
    expect(page.items).toHaveLength(1); expect(page.items[0]).toMatchObject({id: data.id, title: '最初的名字', sourceRevision: 1, storyVersionId: data.story.id, modelId: data.binding.modelId, region: data.binding.region, budget: data.budget, status: 'preparing', schedulingPaused: true});
    expect(page.nextCursor).toBeNull(); expect(parseExperiencePage(page)).toEqual(page);
    expect(JSON.stringify(page)).not.toMatch(/credentialRef|accountScope|contentHash|responseDraft|settings/);
    expect(await f.db.experience.count()).toBe(1); expect(await f.db.commandReceipt.count()).toBe(2);
  } finally {await f.close();}
});
it('paginates equal timestamps exactly, excludes deleted/archived, cursor survives anchor removal', async () => {
  const f = await setup();
  try {
    const items = await Promise.all([f.create('一'), f.create('二'), f.create('三'), f.create('四')]);
    const time = new Date('2030-09-13T00:00:00.000Z'); await f.db.experience.updateMany({data: {updatedAt: time}});
    const ids = items.map(x => x.data.id).sort().reverse();
    const first = await f.service.list(f.owner, {...f.protocol, limit: 2}); expect(first.items.map(x => x.id)).toEqual(ids.slice(0, 2));
    await f.db.experience.update({where: {id: ids[1]}, data: {deletedAt: time}});
    const second = await f.service.list(f.owner, {...f.protocol, limit: 2, cursor: first.nextCursor!});
    expect(second.items.map(x => x.id)).toEqual(ids.slice(2)); expect(second.nextCursor).toBeNull();
    await f.db.experience.update({where: {id: ids[0]}, data: {archivedAt: time}});
    expect((await f.service.list(f.owner, f.protocol)).items.map(x => x.id)).toEqual(ids.slice(2));
  } finally {await f.close();}
});
it('returns current root status rather than historical CREATE, and scopes cursor/queries to owner and dataset', async () => {
  const f = await setup();
  try {
    const {data} = await f.create(); await f.create();
    await f.db.experience.update({where: {id: data.id}, data: {status: 'playing', schedulingPaused: false, revision: 2}});
    const all = await f.service.list(f.owner, f.protocol); expect(all.items.find(x => x.id === data.id)).toMatchObject({status: 'playing', schedulingPaused: false});
    const first = await f.service.list(f.owner, {...f.protocol, limit: 1});
    await expect(f.service.list(f.owner, {...f.protocol, datasetId: v7()})).rejects.toThrow('DATASET_CHANGED');
    const other = {ownerId: v7(), datasetId: f.owner.datasetId}; await f.db.localProfile.create({data: {id: other.ownerId, displayName: 'other', createdAt: f.now, updatedAt: f.now}});
    expect((await f.service.list(other, f.protocol)).items).toEqual([]);
    await expect(f.service.list(other, {...f.protocol, cursor: first.nextCursor!})).rejects.toThrow('INVALID_EXPERIENCE_CURSOR');
    await expect(f.service.list({...f.owner, datasetId: v7()}, {...f.protocol, cursor: first.nextCursor!})).rejects.toThrow();
  } finally {await f.close();}
});
it.each(['story', 'binding', 'unsealed'])('rejects broken %s relationships instead of silently hiding rows', async kind => {
  const f = await setup();
  try {
    const {data} = await f.create();
    if (kind === 'story') await f.db.storyVersion.update({where: {id: data.story.id}, data: {ownerId: v7()}});
    if (kind === 'binding') await f.db.providerBindingVersion.update({where: {id: data.binding.id}, data: {ownerId: v7()}});
    if (kind === 'unsealed') await f.db.storyVersion.update({where: {id: data.story.id}, data: {sealedAt: null}});
    await expect(f.service.list(f.owner, f.protocol)).rejects.toThrow('STORED_EXPERIENCE_INVALID');
  } finally {await f.close();}
});
it('reads the hard maximum plus continuation using existing owner index, with no schema or business writes', async () => {
  const f = await setup();
  try {
    const {data} = await f.create();
    for (let i = 0; i < 50; i++) await f.service.create(f.owner, {...f.protocol, commandId: v7(), storyDraftId: data.story.storyDraftId, expectedStoryRevision: 1,
      bindingKey: 'video-primary', expectedBindingVersion: 1, budget: {limitMicros: '0', currency: 'USD'}});
    const page = await f.service.list(f.owner, {...f.protocol, limit: 50}); expect(page.items).toHaveLength(50); expect(page.nextCursor).not.toBeNull();
    const last = await f.service.list(f.owner, {...f.protocol, limit: 50, cursor: page.nextCursor!}); expect(last.items).toHaveLength(1); expect(last.nextCursor).toBeNull();
    expect(new Set([...page.items, ...last.items].map(x => x.id)).size).toBe(51);
    const plan = await f.db.$queryRawUnsafe<Array<{detail: string}>>('EXPLAIN QUERY PLAN SELECT id FROM experiences WHERE owner_id=? AND deleted_at IS NULL AND archived_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT 51', f.owner.ownerId);
    expect(plan.some(x => x.detail.includes('ix_experiences_owner_list'))).toBe(true); expect(plan.some(x => x.detail.includes('TEMP B-TREE'))).toBe(false);
    expect(await f.db.experience.count()).toBe(51); expect(await f.db.storyVersion.count()).toBe(1); expect(await f.db.commandReceipt.count()).toBe(52);
  } finally {await f.close();}
}, 20000);
it('rejects malformed public summaries, duplicate/order violations and malformed scoped cursor', async () => {
  const f = await setup();
  try {
    await f.create(); await f.create(); const page = await f.service.list(f.owner, f.protocol);
    for (const invalid of [{...page, ownerId: f.owner.ownerId}, {...page, items: [page.items[0], page.items[0]]}, {...page, items: [...page.items].reverse()},
      {...page, items: [{...page.items[0], credentialRef: 'secret'}]}, {...page, items: [], nextCursor: 'abc'}]) expect(() => parseExperiencePage(invalid)).toThrow();
    await expect(f.service.list(f.owner, {...f.protocol, cursor: 'abc'})).rejects.toThrow('INVALID_EXPERIENCE_CURSOR');
  } finally {await f.close();}
});
