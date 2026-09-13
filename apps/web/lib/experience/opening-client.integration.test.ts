import {afterAll, afterEach, beforeAll, expect, it, vi} from 'vitest';
import {v7} from 'uuid';
import {prepare, dispose, fixture} from '../../../runtime/tests/fixtures/story-aggregate/setup';
import {binding} from '../../../runtime/tests/fixtures/provider-binding';
import {createExperienceOpeningService} from '../../../runtime/src/composition/experience-opening-service';
import {createOpeningClient} from './opening-client';
import type {DraftCreate} from 'runtime/contracts/story-draft';
beforeAll(prepare); afterAll(dispose); afterEach(() => vi.unstubAllGlobals());
it.each(['界', '🌌'])('reads actual maximal-field SQLite opening/create replay/get with %s including escaped astral JSON', async character => {
  const f = await fixture();
  try {
    const text = (n: number) => character.repeat(n), settings = {personality: text(8000), appearance: text(4000), speakingStyle: text(2000), boundaries: text(4000)};
    const input: DraftCreate = f.create(); input.title = text(120);
    input.settings = {world: text(12000), opening: text(12000), genre: text(80), playerRole: text(4000), worldRules: Array.from({length: 30}, () => text(1000)), tone: text(500)};
    input.mainCharacter = {kind: 'inline', name: text(120), settings, portraitAssetId: null,
      overrides: {name: text(120), settings: {...settings}, relationship: text(4000), portrait: {mode: 'inherit'}}};
    const source = (await f.service.create(f.owner, input)).data;
    const service = createExperienceOpeningService(f.db, {resolve: () => binding(f.owner.ownerId)});
    const command = {...f.protocol, commandId: v7(), storyDraftId: source.id, expectedStoryRevision: source.revision, bindingKey: 'video-primary', expectedBindingVersion: 1, budget: {limitMicros: '0', currency: 'USD' as const}};
    const created = await service.create(f.owner, command), replayed = await service.create(f.owner, command), read = await service.getPreparing(f.owner, {...f.protocol, id: created.data.id});
    const responses = [created, replayed, read].map(data => {
      const wire = JSON.stringify({result: {data}}).replaceAll('🌌', '\\ud83c\\udf0c');
      expect(new TextEncoder().encode(wire).byteLength).toBeGreaterThan(262144);
      expect(new TextEncoder().encode(wire).byteLength).toBeLessThan(2 * 1024 * 1024);
      return new Response(wire, {headers: {'content-type': 'application/json'}});
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(responses[0]).mockResolvedValueOnce(responses[1]).mockResolvedValueOnce(responses[2]));
    const client = createOpeningClient();
    expect(await client.create(command)).toEqual(created); expect(await client.create(command)).toEqual(replayed);
    expect(await client.getPreparing({...f.protocol, id: created.data.id})).toEqual(read);
  } finally {await f.close();}
});
