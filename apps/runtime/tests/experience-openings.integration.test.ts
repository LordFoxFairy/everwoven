import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import {v7} from 'uuid';
import {prepare, dispose, fixture} from './fixtures/story-aggregate/setup.js';
import {binding} from './fixtures/provider-binding.js';
import {PrismaExperienceOpeningStore} from '../src/infrastructure/db/prisma-experience-opening-store.js';
import {createExperience, getPreparingExperience} from '../src/application/experience-openings.js';
import {openRuntimeDatabase} from '../src/infrastructure/db/client.js';
import type {ExperienceOpeningStore} from '../src/ports/experience-opening-store.js';
import {createExperienceOpeningService} from '../src/composition/experience-opening-service.js';

beforeAll(prepare); afterAll(dispose);
async function setup() {
  const f = await fixture(), store = new PrismaExperienceOpeningStore(f.db);
  const source = (await f.service.create(f.owner, f.create())).data;
  const spec = binding(f.owner.ownerId), resolve = vi.fn(() => structuredClone(spec)), resolver = {resolve};
  const input = {...f.protocol, commandId: v7(), storyDraftId: source.id, expectedStoryRevision: 1,
    bindingKey: spec.bindingKey, expectedBindingVersion: 1, budget: {limitMicros: '9223372036854775807', currency: 'CNY' as const}};
  return {...f, store, source, spec, resolver, input,
    run: (value = input, target: ExperienceOpeningStore = store) => createExperience(target, f.owner, value, resolver)};
}
describe('durable zero-call experience opening', () => {
  it('atomically freezes and binds exact budget, setup and blank draft without network', async () => {
    const f = await setup(), fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('NETWORK_FORBIDDEN'));
    try {
      const result = await f.run(), d = result.data;
      expect(result.replayed).toBe(false);
      expect(d).toMatchObject({status: 'preparing', schedulingPaused: true, budget: f.input.budget,
        media: null, canRespond: false, canDispatch: false,
        setup: {kind: 'setup', options: []}, responseDraft: {text: '', revision: 1}});
      expect(d.id).not.toBe(f.input.commandId);
      expect(d.responseDraft.interactionEventId).toBe(d.setup.id);
      expect(d.story.storyDraftId).toBe(f.source.id);
      expect(d.binding.modelId).toBe('MiniMax-H3-Max');
      expect(JSON.stringify(d)).not.toMatch(/credentialRef|providerAccountScopeId|local-account-1|local:minimax-cn/);
      const row = await f.db.experience.findUniqueOrThrow({where: {id: d.id}});
      expect(row).toMatchObject({budgetLimitMicros: 9223372036854775807n, dispatchEpoch: 0, revision: 1, rowRevision: 1});
      expect(await f.db.commandReceipt.findUnique({where: {id: d.id}})).toMatchObject({commandId: f.input.commandId});
      expect(await getPreparingExperience(f.store, f.owner, {...f.protocol, id: d.id})).toEqual(d);
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); await f.close(); }
  });
  it('replays before source and resolver changes; distinct commands create independent experiences', async () => {
    const f = await setup();
    try {
      const first = await f.run(), next = await f.run({...f.input, commandId: v7()});
      expect(first.data.id).not.toBe(next.data.id);
      expect(first.data.story.id).toBe(next.data.story.id);
      expect(first.data.binding.id).toBe(next.data.binding.id);
      await f.service.update(f.owner, {...f.change(f.source.id, 1), patch: {title: 'changed'}});
      f.resolver.resolve.mockImplementation(() => { throw Error('NO_CURRENT_REGISTRY'); });
      const spy = vi.spyOn(f.db.storyDraft, 'findFirst').mockRejectedValue(Error('NO_CURRENT_DRAFT'));
      expect(await f.run()).toEqual({...first, replayed: true});
      expect(spy).not.toHaveBeenCalled();
      expect(await getPreparingExperience(f.store, f.owner, {...f.protocol, id: first.data.id})).toEqual(first.data);
      spy.mockRestore();
      expect(await f.db.experience.count()).toBe(2);
    } finally { await f.close(); }
  });
  it('opening survives an actual database disconnect/reopen', async () => {
    const f = await setup();
    try {
      const first = await f.run();
      const paths = await f.db.$queryRawUnsafe<Array<{file: string; name: string}>>('PRAGMA database_list');
      await f.db.$disconnect();
      const db = await openRuntimeDatabase(paths.find(p => p.name === 'main')!.file);
      try {
        const store = new PrismaExperienceOpeningStore(db);
        expect(await getPreparingExperience(store, f.owner, {...f.protocol, id: first.data.id})).toEqual(first.data);
        expect(await createExperience(store, f.owner, f.input, {resolve: () => { throw Error('NO_REGISTRY'); }}))
          .toEqual({...first, replayed: true});
      } finally { await db.$disconnect(); }
    } finally { await f.close(); }
  });
  it('deduplicates simultaneous identical commands but rejects changed payload and cross-command collisions', async () => {
    const f = await setup();
    try {
      const [a, b] = await Promise.all([f.run(), f.run()]);
      expect(a.data).toEqual(b.data);
      expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
      await expect(f.run({...f.input, budget: {limitMicros: '1', currency: 'CNY'}})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
      const commandId = v7(); await f.service.create(f.owner, {...f.create(), commandId});
      await expect(f.run({...f.input, commandId})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
      expect(await f.db.experience.count()).toBe(1);
    } finally { await f.close(); }
  });
  it.each(['insertBinding', 'insertExperience', 'insertSetup', 'insertResponseDraft', 'insertOpeningReceipt'] as const)(
    'rolls the full new aggregate back when %s fails after its write', async method => {
      const f = await setup();
      const broken: ExperienceOpeningStore = {
        read: f.store.read.bind(f.store),
        write: (ownerId, work) => f.store.write(ownerId, scope => work({...scope, [method]: async (...args: unknown[]) => {
          await (scope[method] as (...a: unknown[]) => Promise<unknown>)(...args); throw Error('INJECTED');
        }})),
      };
      try {
        await expect(f.run(f.input, broken)).rejects.toThrow('INJECTED');
        for (const n of [await f.db.storyVersion.count(), await f.db.providerBindingVersion.count(), await f.db.experience.count(), await f.db.interactionEvent.count(), await f.db.responseDraft.count()]) expect(n).toBe(0);
        expect(await f.db.commandReceipt.count({where: {commandId: f.input.commandId}})).toBe(0);
        expect((await f.run()).replayed).toBe(false);
      } finally { await f.close(); }
    },
  );
  it.each(['ownerId', 'bindingKey', 'versionNo'] as const)('rejects resolver returning wrong %s', async key => {
    const f = await setup();
    try {
      f.resolver.resolve.mockReturnValue({...f.spec, [key]: key === 'versionNo' ? 2 : v7()});
      await expect(f.run()).rejects.toThrow('PROVIDER_BINDING_MISMATCH');
      expect(await f.db.storyVersion.count()).toBe(0);
    } finally { await f.close(); }
  });
  it('does not rewrite a pinned binding when same registry version drifts', async () => {
    const f = await setup();
    try {
      const a = await f.run();
      f.spec.parameters.providerAccountScopeId = 'other-account';
      await expect(f.run({...f.input, commandId: v7()})).rejects.toThrow('PROVIDER_BINDING_CONFLICT');
      expect(await f.run()).toEqual({...a, replayed: true});
      expect(await f.db.experience.count()).toBe(1);
    } finally { await f.close(); }
  });
  it.each(['response-swap', 'budget', 'story', 'binding', 'setup-owner', 'draft-node', 'receipt-time'] as const)(
    'rejects stored identity tampering: %s', async kind => {
      const f = await setup();
      try {
        const a = await f.run(), b = await f.run({...f.input, commandId: v7()});
        if (kind === 'response-swap') await f.db.commandReceipt.update({where: {id: a.data.id}, data: {response: b.data}});
        if (kind === 'budget') await f.db.experience.update({where: {id: a.data.id}, data: {budgetLimitMicros: 1n}});
        if (kind === 'story') await f.db.experience.update({where: {id: a.data.id}, data: {storyVersionId: v7()}});
        if (kind === 'binding') await f.db.providerBindingVersion.update({where: {id: a.data.binding.id}, data: {modelId: 'MiniMax-H3'}});
        if (kind === 'setup-owner') await f.db.interactionEvent.update({where: {id: a.data.setup.id}, data: {ownerId: v7()}});
        if (kind === 'draft-node') await f.db.responseDraft.update({where: {id: a.data.responseDraft.id}, data: {interactionEventId: v7()}});
        if (kind === 'receipt-time') await f.db.commandReceipt.update({where: {id: a.data.id}, data: {createdAt: new Date('2000-01-01')}});
        await expect(f.run()).rejects.toThrow('COMMAND_RECEIPT_INVALID');
        expect(await f.db.experience.count()).toBe(2);
      } finally { await f.close(); }
    },
  );
  it('separates historical acknowledgement from current preparing GET', async () => {
    const f = await setup();
    try {
      const a = await f.run();
      await f.db.experience.update({where: {id: a.data.id}, data: {status: 'playing', revision: 2, rowRevision: 2}});
      await f.db.responseDraft.update({where: {id: a.data.responseDraft.id}, data: {text: 'later', revision: 2}});
      expect(await f.run()).toEqual({...a, replayed: true});
      await expect(getPreparingExperience(f.store, f.owner, {...f.protocol, id: a.data.id})).rejects.toThrow('PREPARATION_NO_LONGER_CURRENT');
    } finally { await f.close(); }
  });
  it('enforces dataset, owner and source revision without partial records', async () => {
    const f = await setup();
    try {
      await expect(f.run({...f.input, datasetId: v7()})).rejects.toThrow('DATASET_CHANGED');
      await expect(f.run({...f.input, expectedStoryRevision: 2})).rejects.toThrow('REVISION_CONFLICT');
      const a = await f.run();
      const other = {ownerId: v7(), datasetId: f.owner.datasetId};
      await f.db.localProfile.create({data: {id: other.ownerId, displayName: 'other', createdAt: f.now, updatedAt: f.now}});
      await expect(getPreparingExperience(f.store, other, {...f.protocol, id: a.data.id})).rejects.toThrow('EXPERIENCE_NOT_FOUND');
      await expect(createExperience(f.store, other, {...f.input, commandId: v7()}, f.resolver)).rejects.toThrow();
      expect(await f.db.experience.count()).toBe(1);
    } finally { await f.close(); }
  });
  it('explicit composition preserves zero budget and performs no implicit registration', async () => {
    const f = await setup();
    try {
      const service = createExperienceOpeningService(f.db, f.resolver);
      const a = await service.create(f.owner, {...f.input, budget: {limitMicros: '0', currency: 'USD'}});
      expect(a.data.budget).toEqual({limitMicros: '0', currency: 'USD'});
      expect(a.data.canDispatch).toBe(false);
      expect(await service.getPreparing(f.owner, {...f.protocol, id: a.data.id})).toEqual(a.data);
      expect(f.resolver.resolve).toHaveBeenCalledTimes(1);
    } finally { await f.close(); }
  });
  it('a failed second opening preserves previously sealed versions and the existing experience', async () => {
    const f = await setup();
    try {
      const a = await f.run();
      const broken: ExperienceOpeningStore = {read: f.store.read.bind(f.store),
        write: (ownerId, work) => f.store.write(ownerId, scope => work({...scope,
          insertResponseDraft: async input => { await scope.insertResponseDraft(input); throw Error('FAIL'); },
        })),
      };
      await expect(f.run({...f.input, commandId: v7()}, broken)).rejects.toThrow('FAIL');
      expect(await f.db.storyVersion.count()).toBe(1);
      expect(await f.db.providerBindingVersion.count()).toBe(1);
      expect(await f.db.experience.count()).toBe(1);
      expect(await getPreparingExperience(f.store, f.owner, {...f.protocol, id: a.data.id})).toEqual(a.data);
    } finally { await f.close(); }
  });
  it('soft deleted history can replay creation without resurrecting it', async () => {
    const f = await setup();
    try {
      const a = await f.run();
      await f.db.experience.update({where: {id: a.data.id}, data: {deletedAt: new Date(), rowRevision: 2}});
      await expect(getPreparingExperience(f.store, f.owner, {...f.protocol, id: a.data.id})).rejects.toThrow('EXPERIENCE_NOT_FOUND');
      expect(await f.run()).toEqual({...a, replayed: true});
      expect((await f.db.experience.findUniqueOrThrow({where: {id: a.data.id}})).deletedAt).not.toBeNull();
    } finally { await f.close(); }
  });
  it('rejects a mismatched port owner before resolver or writes', async () => {
    const f = await setup();
    try {
      const store: ExperienceOpeningStore = {read: f.store.read.bind(f.store),
        write: (ownerId, work) => f.store.write(ownerId, scope => work({...scope, ownerId: v7()}))};
      await expect(f.run(f.input, store)).rejects.toThrow('OWNER_UNAVAILABLE');
      expect(f.resolver.resolve).not.toHaveBeenCalled();
      expect(await f.db.storyVersion.count()).toBe(0);
    } finally { await f.close(); }
  });
  it('rejects disabled owner and rolls invalid clock/id services back', async () => {
    const f = await setup();
    try {
      for (const services of [
        {ids: {next: () => 'not-id'}, clock: {now: () => new Date()}},
        {ids: {next: () => v7()}, clock: {now: () => new Date(NaN)}},
      ]) await expect(createExperience(f.store, f.owner, f.input, f.resolver, services)).rejects.toThrow();
      expect(await f.db.storyVersion.count()).toBe(0);
      await f.db.localProfile.update({where: {id: f.owner.ownerId}, data: {deletedAt: new Date()}});
      await expect(f.run()).rejects.toThrow('OWNER_UNAVAILABLE');
      expect(await f.db.experience.count()).toBe(0);
    } finally { await f.close(); }
  });
  it('rejects cross-owner child writes without poisoning the original history', async () => {
    const f = await setup();
    try {
      const a = await f.run(), otherId = v7();
      await f.db.localProfile.create({data: {id: otherId, displayName: 'other', createdAt: f.now, updatedAt: f.now}});
      const root = await f.db.experience.findUniqueOrThrow({where: {id: a.data.id}});
      await expect(f.store.write(otherId, scope => scope.insertResponseDraft({
        id: v7(), ownerId: otherId, experienceId: a.data.id, interactionEventId: a.data.setup.id,
        text: '', revision: 1, createdAt: root.createdAt, updatedAt: root.createdAt,
      }))).rejects.toThrow('EXPERIENCE_PARENT_INVALID');
      await expect(f.store.write(otherId, scope => scope.insertSetup({
        id: v7(), ownerId: otherId, experienceId: a.data.id, kind: 'setup', experienceRevision: 1,
        options: [], schemaVersion: 1, createdAt: root.createdAt,
      }))).rejects.toThrow('EXPERIENCE_PARENT_INVALID');
      expect(await f.run()).toEqual({...a, replayed: true});
      expect(await getPreparingExperience(f.store, f.owner, {...f.protocol, id: a.data.id})).toEqual(a.data);
    } finally { await f.close(); }
  });
  it.each(['missing-experience', 'missing-setup', 'wrong-experience'] as const)(
    'rejects %s relationships even before an opening is sealed', async kind => {
      const f = await setup();
      try {
        const a = await f.run(), stored = await f.db.experience.findUniqueOrThrow({where: {id: a.data.id}});
        await expect(f.store.write(f.owner.ownerId, async scope => {
          const id = v7(), setupId = v7();
          await scope.insertExperience({...stored, id});
          if (kind === 'missing-experience') await scope.insertSetup({
            id: setupId, ownerId: f.owner.ownerId, experienceId: v7(), kind: 'setup', experienceRevision: 1,
            options: [], schemaVersion: 1, createdAt: stored.createdAt,
          });
          else await scope.insertResponseDraft({
            id: v7(), ownerId: f.owner.ownerId, experienceId: id,
            interactionEventId: kind === 'missing-setup' ? v7() : a.data.setup.id,
            text: '', revision: 1, createdAt: stored.createdAt, updatedAt: stored.createdAt,
          });
        })).rejects.toThrow('EXPERIENCE_PARENT_INVALID');
        expect(await f.db.experience.count()).toBe(1);
        expect(await f.run()).toEqual({...a, replayed: true});
      } finally { await f.close(); }
    },
  );
});
