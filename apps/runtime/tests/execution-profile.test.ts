import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import {v7} from 'uuid';
import {prepare, dispose, fixture} from './fixtures/story-aggregate/setup.js';
import {binding} from './fixtures/provider-binding.js';
import * as contract from '../src/contracts/execution-profile.js';
import {parseBindingSpec, parseExecutionBinding} from '../src/contracts/provider-binding-validation.js';
import * as application from '../src/application/execution-profiles.js';
import {PrismaExecutionProfileStore} from '../src/infrastructure/db/prisma-execution-profile-store.js';
import {openRuntimeDatabase} from '../src/infrastructure/db/client.js';

function spec(ownerId = v7()) {
  const text = (key: string, image = false) => ({...binding(ownerId), bindingKey: key, modelId: 'fixture-text', mode: 'text',
    parameters: {...binding(ownerId).parameters, catalogId: 'fixture-text', operationKind: 'structured-generation', protocolVersion: 'text-v1',
      generation: {inputModalities: image ? ['text', 'image'] : ['text'], maxInputTokens: 4096, maxOutputTokens: 1024, temperature: 0.5}}});
  const artifact = {version: '1', sha256: 'a'.repeat(64)};
  return {schemaVersion: 1, ownerId, profileKey: 'bounded-director', versionNo: 1, currency: 'USD', graph: {...artifact},
    planner: {binding: text('planner'), prompt: {...artifact}, outputSchema: {...artifact}, maxCalls: 2, maxCostMicros: '9007199254740993'},
    video: {binding: binding(ownerId), maxCalls: 1, maxCostMicros: '1000000'},
    validator: {binding: text('validator', true), prompt: {...artifact}, outputSchema: {...artifact}, maxCalls: 1, maxCostMicros: '1000'}};
}
describe('bounded immutable execution profile', () => {
  it('detaches the complete text/video identity and preserves exact cost strings', () => {
    const raw = spec(), parsed = contract.parseExecutionProfile(raw);
    expect(parsed).toEqual(raw); expect(parsed).not.toBe(raw);
    expect(parsed.planner.binding.mode).toBe('text');
    raw.planner.binding.parameters.generation.maxInputTokens = 1;
    expect(parsed.planner.binding.parameters.generation.maxInputTokens).toBe(4096);
  });
  it('keeps video-only parser rejecting text and rejects video operations in text bindings', () => {
    expect(() => parseBindingSpec(spec().planner.binding)).toThrow('INVALID_PROVIDER_BINDING');
    expect(parseExecutionBinding(spec().planner.binding).mode).toBe('text');
  });
  it.each([
    (s: ReturnType<typeof spec>) => {s.planner.binding.mode = 'job';},
    (s: ReturnType<typeof spec>) => {s.validator.binding.parameters.generation.inputModalities = ['text'];},
    (s: ReturnType<typeof spec>) => {s.video.maxCalls = 2;},
    (s: ReturnType<typeof spec>) => {s.video.binding.parameters.operationKind = 'structured-generation';},
    (s: ReturnType<typeof spec>) => {s.planner.maxCalls = 0;},
    (s: ReturnType<typeof spec>) => {s.planner.maxCostMicros = '0';},
    (s: ReturnType<typeof spec>) => {s.planner.maxCostMicros = '9223372036854775807';},
    (s: ReturnType<typeof spec>) => {s.planner.binding.ownerId = v7();},
    (s: ReturnType<typeof spec>) => {s.planner.binding.parameters.generation.maxOutputTokens = 0;},
    (s: ReturnType<typeof spec>) => {s.planner.binding.parameters.operationKind = 'text-to-video';},
    (s: ReturnType<typeof spec>) => {s.graph.sha256 = 'short';},
    (s: ReturnType<typeof spec>) => {Object.assign(s.video, {apiKey: 'do-not-echo'});},
  ])('rejects invalid identity/modalities/bounds without echoing data %#', mutate => {
    const raw = spec(); mutate(raw);
    expect(() => contract.parseExecutionProfile(raw)).toThrow(/^INVALID_EXECUTION_PROFILE$/);
  });
});

beforeAll(prepare, 30000); afterAll(dispose);
describe('profile real SQLite', () => {
  it.each(['depth', 'size'])('persists a valid boundary snapshot without shrinking its %s inside the hash envelope', async boundary => {
    const f = await fixture();
    try {
      const raw = spec(f.owner.ownerId);
      if (boundary === 'depth') {
        let nested: unknown = 'leaf'; for (let i = 0; i < 7; i++) nested = {x:nested};
        Object.assign(raw.video.binding.capabilities, {evidence:nested});
      } else {
        const padding: Record<string,string> = {};
        for (let i = 0; i < 7; i++) padding[`p${i}`] = 'x'.repeat(8000);
        padding.p7 = ''; Object.assign(raw.video.binding.capabilities, padding);
        Object.assign(raw.video.binding.capabilities, {p7:'x'.repeat(65500 - JSON.stringify(raw).length)});
        expect(JSON.stringify(raw).length).toBe(65500);
      }
      expect(contract.parseExecutionProfile(raw)).toEqual(raw);
      const store = new PrismaExecutionProfileStore(f.db);
      const first = await store.write(f.owner.ownerId, scope => application.pinExecutionProfile(scope,f.owner,raw));
      expect(await store.write(f.owner.ownerId, scope => application.pinExecutionProfile(scope,f.owner,raw))).toEqual(first);
      const path = (await f.db.$queryRawUnsafe<Array<{file:string;name:string}>>('PRAGMA database_list')).find(r => r.name === 'main')!.file;
      await f.db.$disconnect(); const reopened = await openRuntimeDatabase(path);
      try {expect(await new PrismaExecutionProfileStore(reopened).read(f.owner.ownerId,
        scope => application.readExecutionProfile(scope,f.owner,first.id))).toEqual(first);} finally {await reopened.$disconnect();}
    } finally {await f.close();}
  });
  it('shares a multimodal text binding across roles without duplicating or treating its unknown capability as dispatch', async () => {
    const f = await fixture(); const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('NETWORK_FORBIDDEN'));
    try {
      const store = new PrismaExecutionProfileStore(f.db), raw = spec(f.owner.ownerId);
      raw.planner.binding = structuredClone(raw.validator.binding);
      const first = await store.write(f.owner.ownerId, scope => application.pinExecutionProfile(scope, f.owner, raw));
      expect(first.plannerBindingVersionId).toBe(first.validatorBindingVersionId);
      expect(await f.db.providerBindingVersion.count()).toBe(2);
      expect(first.snapshot.validator.binding.capabilities.evidence).toBe('unknown');
      expect(fetch).not.toHaveBeenCalled();
      await f.db.providerBindingVersion.update({where:{id:first.videoBindingVersionId},data:{modelId:'changed'}});
      await expect(store.read(f.owner.ownerId, scope => application.readExecutionProfile(scope, f.owner, first.id))).rejects.toThrow('STORED_EXECUTION_PROFILE_INVALID');
    } finally {fetch.mockRestore(); await f.close();}
  });
  it('does not overwrite a version through the low-level store and rejects absent or cross-owner parents', async () => {
    const f = await fixture();
    try {
      const store = new PrismaExecutionProfileStore(f.db);
      const first = await store.write(f.owner.ownerId, scope => application.pinExecutionProfile(scope, f.owner, spec(f.owner.ownerId)));
      await expect(store.write(f.owner.ownerId, scope => scope.insertProfile({...first,id:v7()}))).rejects.toThrow();
      await expect(store.write(f.owner.ownerId, scope => scope.insertProfile({...first,id:v7(),versionNo:2,videoBindingVersionId:v7()}))).rejects.toThrow('EXECUTION_PROFILE_PARENT_INVALID');
      expect(await store.read(f.owner.ownerId, scope => application.readExecutionProfile(scope, f.owner, first.id))).toEqual(first);
      const callback = vi.fn();
      await f.db.localProfile.update({where:{id:f.owner.ownerId},data:{deletedAt:f.now}});
      await expect(store.write(f.owner.ownerId, callback)).rejects.toThrow('OWNER_UNAVAILABLE');
      await expect(store.read(f.owner.ownerId, callback)).rejects.toThrow('OWNER_UNAVAILABLE');
      expect(callback).not.toHaveBeenCalled();
    } finally {await f.close();}
  });
  it('pins once, detects version drift, allows distinct keys, and reads after real reopen', async () => {
    const f = await fixture();
    try {
      const store = new PrismaExecutionProfileStore(f.db), raw = spec(f.owner.ownerId);
      const pin = (input = raw) => store.write(f.owner.ownerId, scope => application.pinExecutionProfile(scope, f.owner, input));
      const first = await pin(); expect(await pin()).toEqual(first);
      expect(await f.db.executionProfileVersion.count()).toBe(1);
      expect(await f.db.providerBindingVersion.count()).toBe(3);
      await expect(pin({...raw, graph: {...raw.graph, version: '2'}})).rejects.toThrow('EXECUTION_PROFILE_CONFLICT');
      expect((await pin({...raw, profileKey: 'another'})).id).not.toBe(first.id);
      const path = (await f.db.$queryRawUnsafe<Array<{file:string;name:string}>>('PRAGMA database_list')).find(r => r.name === 'main')!.file;
      await f.db.$disconnect(); const reopened = await openRuntimeDatabase(path);
      try {expect(await new PrismaExecutionProfileStore(reopened).read(f.owner.ownerId,
        scope => application.readExecutionProfile(scope, f.owner, first.id))).toEqual(first);} finally {await reopened.$disconnect();}
    } finally {await f.close();}
  });
  it('rolls back all three new bindings if profile insertion fails and rejects cross owner', async () => {
    const f = await fixture();
    try {
      const store = new PrismaExecutionProfileStore(f.db), raw = spec(f.owner.ownerId);
      await expect(store.write(f.owner.ownerId, scope => application.pinExecutionProfile({...scope,
        insertProfile: async row => {await scope.insertProfile(row); throw Error('INJECTED');}}, f.owner, raw))).rejects.toThrow('INJECTED');
      expect(await f.db.providerBindingVersion.count()).toBe(0);
      expect(await f.db.executionProfileVersion.count()).toBe(0);
      await expect(store.write(f.owner.ownerId, scope => application.pinExecutionProfile(scope, f.owner, spec()))).rejects.toThrow('EXECUTION_PROFILE_OWNER_MISMATCH');
      expect(await f.db.providerBindingVersion.count()).toBe(0);
      const first = await store.write(f.owner.ownerId, scope => application.pinExecutionProfile(scope, f.owner, raw));
      const other = v7(); await f.db.localProfile.create({data:{id:other,displayName:'other',createdAt:f.now,updatedAt:f.now}});
      await expect(store.read(other, scope => application.readExecutionProfile(scope, {...f.owner,ownerId:other}, first.id))).rejects.toThrow('EXECUTION_PROFILE_NOT_FOUND');
    } finally {await f.close();}
  });
  it('rejects binding drift, corrupt persisted hash/reference and wrong dataset', async () => {
    const f = await fixture();
    try {
      const store = new PrismaExecutionProfileStore(f.db), raw = spec(f.owner.ownerId);
      const first = await store.write(f.owner.ownerId, scope => application.pinExecutionProfile(scope, f.owner, raw));
      const read = (owner = f.owner) => store.read(f.owner.ownerId, scope => application.readExecutionProfile(scope, owner, first.id));
      await expect(read({...f.owner,datasetId:v7()})).rejects.toThrow('STORED_EXECUTION_PROFILE_INVALID');
      raw.planner.binding.parameters.generation.temperature = 0.8;
      await expect(store.write(f.owner.ownerId, scope => application.pinExecutionProfile(scope,f.owner,{...raw,versionNo:2}))).rejects.toThrow('PROVIDER_BINDING_CONFLICT');
      expect(await f.db.executionProfileVersion.count()).toBe(1);
      await f.db.executionProfileVersion.update({where:{id:first.id},data:{contentHash:'f'.repeat(64)}});
      await expect(read()).rejects.toThrow('STORED_EXECUTION_PROFILE_INVALID');
      await f.db.executionProfileVersion.update({where:{id:first.id},data:{contentHash:first.contentHash,plannerBindingVersionId:first.videoBindingVersionId}});
      await expect(read()).rejects.toThrow('STORED_EXECUTION_PROFILE_INVALID');
    } finally {await f.close();}
  });
});
