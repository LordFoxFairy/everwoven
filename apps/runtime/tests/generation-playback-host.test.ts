import {afterEach, expect, it} from 'vitest';
import {mkdtemp, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {v7} from 'uuid';
import {initializeLocalHost, issueConnectionCode, exchangeConnectionCode, revokeSession, withLocalStories, withLocalGenerationPlayback} from '../src/host/index.js';
import {openRuntimeDatabase} from '../src/infrastructure/db/client.js';
import {createExperienceOpeningService} from '../src/composition/experience-opening-service.js';
import {createVideoBindingRegistry} from '../src/application/video-binding-registry.js';
const directories: string[] = [];
afterEach(async () => {for (const directory of directories.splice(0)) await rm(directory, {recursive: true, force: true});});
it('uses the real host session, store epoch and SQLite facts without loading suppliers', async () => {
  const parent = await mkdtemp(join(await realpath(tmpdir()), 'playback-host-')); directories.push(parent);
  const directory = join(parent, 'host'), manifest = await initializeLocalHost(directory, 'dev');
  const {token} = await exchangeConnectionCode(directory, 'dev', await issueConnectionCode(directory, 'dev'));
  const protocol = {protocolVersion: 1 as const, datasetId: manifest.datasetId}, owner = {ownerId: manifest.ownerId, datasetId: manifest.datasetId};
  const story = await withLocalStories(directory, 'dev', token, (s, o) => s.create(o, {...protocol, commandId: v7(), title: '雨后的窗边',
    settings: {world: '', opening: '两人在窗边相遇', genre: '', tone: '', playerRole: '', worldRules: []}, mainCharacter: null, assetSlots: {cover: null, opening: null, character: null}}));
  const db = await openRuntimeDatabase(join(directory, 'runtime.db'));
  let experienceId: string;
  try {
    const registry = createVideoBindingRegistry({schemaVersion: 1,
      connections: [{id: 'fixture', providerId: 'minimax', region: 'cn', accountScopeId: 'test', credentialRef: 'env:TEST_ONLY'}],
      bindings: [{bindingKey: 'video', versionNo: 1, connectionId: 'fixture', catalogId: 'minimax-h3-max', operationKind: 'text-to-video', generation: {duration: 5, resolution: '768P', ratio: '16:9'}}]});
    experienceId = (await createExperienceOpeningService(db, registry).create(owner, {...protocol, commandId: v7(), storyDraftId: story.data.id,
      expectedStoryRevision: story.data.revision, bindingKey: 'video', expectedBindingVersion: 1, budget: {limitMicros: '0', currency: 'USD'}})).data.id;
  } finally {await db.$disconnect();}
  const get = () => withLocalGenerationPlayback(directory, 'dev', token, (s, actualOwner) => {
    expect(actualOwner).toEqual(owner); return s.get({...protocol, experienceId});
  });
  const first = await get(); expect(first).toMatchObject({experienceId, title: story.data.title, status: 'preparing', turn: null, interaction: null});
  // Every host request opens/disconnects SQLite; current supplier startup was never initialized.
  expect(await get()).toEqual(first);
  await expect(withLocalGenerationPlayback(directory, 'dev', token, s => s.get({...protocol, datasetId: v7(), experienceId}))).rejects.toThrow('DATASET_CHANGED');
  await expect(withLocalGenerationPlayback(directory, 'dev', token, s => s.completePlayback({...protocol, experienceId, commandId: v7(),
    expectedExperienceRevision: 1, turnId: v7(), mediaId: v7()}))).rejects.toThrow('GENERATION_NOT_PLAYABLE');
  expect(await get()).toEqual(first);
  await revokeSession(directory, 'dev', token);
  await expect(get()).rejects.toThrow('LOCAL_SESSION_INVALID');
}, 30000);
