// Explicit test-only persisted media fixture. Never registered in production or used with a user dataset.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {validatedHost} from '../../../apps/runtime/dist/host/storage.js';
import {openRuntimeDatabase} from '../../../apps/runtime/dist/infrastructure/db/client.js';
import {createStoryDraftService} from '../../../apps/runtime/dist/composition/story-draft-service.js';
import {createExperienceOpeningService} from '../../../apps/runtime/dist/composition/experience-opening-service.js';
import {createVideoBindingRegistry} from '../../../apps/runtime/dist/application/video-binding-registry.js';
import {createPrivateVideoStore} from '../../../apps/runtime/dist/infrastructure/media/private-video-store.js';
import {createVideoProbe} from '../../../apps/runtime/dist/infrastructure/media/video-probe.js';
const require = createRequire(new URL('../../../apps/runtime/package.json', import.meta.url)), {v7} = require('uuid');
export async function seedMedia(directory) {
  if (!directory.includes('everwoven-character-browser-')) throw Error('Fixture requires its disposable smoke host');
  const host = await validatedHost(directory, 'dev'), owner = {ownerId: host.manifest.ownerId, datasetId: host.manifest.datasetId};
  const protocol = {protocolVersion: 1, datasetId: owner.datasetId};
  const path = join(host.target.parent, 'rendered-fixture.mp4');
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path], {timeout: 15000, stdio: 'pipe'});
  const bytes = await readFile(path), turnId = v7(), quoteId = v7(), interactionEventId = v7(), scopeId = v7();
  const files = await createPrivateVideoStore(host, owner, {revalidate: async () => {}, probe: createVideoProbe(() => ({width: 320, height: 180})),
    source: {open: async () => ({length: bytes.length, close() {}, body: (async function* () {yield bytes;})()})}});
  const media = await files.materialize(turnId, {url: 'https://fixture.example/video', duration: 1, resolution: 'fixture-only', ratio: '16:9'});
  const db = await openRuntimeDatabase(join(directory, 'runtime.db'));
  try {
    const story = (await createStoryDraftService(db).create(owner, {...protocol, commandId: v7(), title: '浏览器私有视频测试',
      settings: {world: '', opening: '窗边', genre: '', tone: '', playerRole: '', worldRules: []}, mainCharacter: null, assetSlots: {cover: null, opening: null, character: null}})).data;
    const registry = createVideoBindingRegistry({schemaVersion: 1, connections: [{id: 'fixture', providerId: 'minimax', region: 'cn', accountScopeId: 'test', credentialRef: 'env:TEST_ONLY'}],
      bindings: [{bindingKey: 'video', versionNo: 1, connectionId: 'fixture', catalogId: 'minimax-h3-max', operationKind: 'text-to-video', generation: {duration: 5, resolution: '768P', ratio: '16:9'}}]});
    const root = (await createExperienceOpeningService(db, registry).create(owner, {...protocol, commandId: v7(), storyDraftId: story.id,
      expectedStoryRevision: 1, bindingKey: 'video', expectedBindingVersion: 1, budget: {currency: 'USD', limitMicros: '0'}})).data;
    const now = new Date();
    await db.$transaction(async tx => {
      await tx.budgetScope.create({data: {id: scopeId, ownerId: owner.ownerId, currency: 'USD', limitMicros: 0n, createdAt: now}});
      await tx.experience.update({where: {id: root.id}, data: {budgetScopeId: scopeId, status: 'playing', revision: 2}});
      await tx.generationQuote.create({data: {id: quoteId, ownerId: owner.ownerId, datasetId: owner.datasetId, storeEpoch: v7(), experienceId: root.id,
        experienceRevision: 1, interactionEventId, profileId: v7(), maxCostMicros: 0n, currency: 'USD', snapshot: {fixture: true}, contentHash: 'a'.repeat(64),
        acceptedTurnId: turnId, createdAt: now, expiresAt: new Date(now.getTime() + 60000)}});
      await tx.generationTurn.create({data: {id: turnId, ownerId: owner.ownerId, experienceId: root.id, budgetScopeId: scopeId, quoteId, interactionEventId,
        status: 'ready', media, result: {summary: '本地渲染的蓝色画面', choices: [{id: 'ask', title: '询问', text: '接下来呢？'}, {id: 'wait', title: '等待', text: '我等待片刻。'}]}, createdAt: now, updatedAt: now}});
    });
    return {query: {datasetId: owner.datasetId, experienceId: root.id, turnId, mediaId: media.id}, hash: media.sha256, size: bytes.length};
  } finally {await db.$disconnect();}
}
