import {beforeAll, afterAll, expect, it} from 'vitest';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {v7} from 'uuid';
import {prepare, dispose, fixture} from '../../runtime/tests/fixtures/host-assets/setup';
import {validatedHost} from '../../runtime/src/host/storage';
import {createPrivateVideoStore} from '../../runtime/src/infrastructure/media/private-video-store';
import {createVideoProbe} from '../../runtime/src/infrastructure/media/video-probe';
import {revokeSession, withLocalStories} from 'runtime/host';
import {createVideoBindingRegistry} from '../../runtime/src/application/video-binding-registry';
import {createExperienceOpeningService} from '../../runtime/src/composition/experience-opening-service';
import {handleGenerationMedia} from './local-generation-media-http';
import {generationMediaURL} from '../lib/experience/media-url';
let rendered: string, bytes: Buffer;
const origin = 'http://127.0.0.1:3100';
beforeAll(async () => {
  await prepare();rendered = await mkdtemp(join(tmpdir(), 'media-http-render-'));const path = join(rendered, 'fixture.mp4');
  await promisify(execFile)('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path]);
  bytes = await readFile(path);
}, 30000);
afterAll(async () => {await dispose();await rm(rendered, {recursive: true, force: true});});

it('serves actual private MP4 through real sessions/SQLite, ranges and reconnect; rejects uncommitted/cross-scope access', async () => {
  const f = await fixture();
  try {
    const owner = {ownerId: f.manifest.ownerId, datasetId: f.manifest.datasetId}, protocol = {protocolVersion: 1 as const, datasetId: owner.datasetId};
    const env = {APP_ENV: 'dev', APP_ORIGIN: origin, RUNTIME_DATA_DIR: f.directory, EVERWOVEN_LOCAL_LAUNCH: 'loopback-v1'};
    const story = await withLocalStories(f.directory, 'dev', f.token, (s, o) => s.create(o, {...protocol, commandId: v7(), title: '媒体读取测试',
      settings: {world: '', opening: '窗边', genre: '', tone: '', playerRole: '', worldRules: []}, mainCharacter: null, assetSlots: {cover: null, opening: null, character: null}}));
    const registry = createVideoBindingRegistry({schemaVersion: 1, connections: [{id: 'fixture', providerId: 'minimax', region: 'cn', accountScopeId: 'test', credentialRef: 'env:TEST_ONLY'}],
      bindings: [{bindingKey: 'video', versionNo: 1, connectionId: 'fixture', catalogId: 'minimax-h3-max', operationKind: 'text-to-video', generation: {duration: 5, resolution: '768P', ratio: '16:9'}}]});
    const root = await f.database(async db => (await createExperienceOpeningService(db, registry).create(owner, {...protocol, commandId: v7(), storyDraftId: story.data.id,
      expectedStoryRevision: 1, bindingKey: 'video', expectedBindingVersion: 1, budget: {currency: 'USD', limitMicros: '0'}})).data);
    const turnId = v7(), quoteId = v7(), interactionEventId = v7(), now = new Date();
    const store = await createPrivateVideoStore(await validatedHost(f.directory, 'dev'), owner, {revalidate: async () => {},
      probe: createVideoProbe(() => ({width: 320, height: 180})), source: {open: async () => ({length: bytes.length, close() {}, body: (async function* () {yield bytes;})()})}});
    const media = await store.materialize(turnId, {url: 'https://fixture.example/video', duration: 1, resolution: 'fixture-only', ratio: '16:9'});
    const query = {datasetId: owner.datasetId, experienceId: root.id, turnId, mediaId: media.id};
    let token = f.token;
    const request = (patch: Partial<typeof query> = {}, headers: Record<string, string> = {}, method = 'GET') => new Request(origin + generationMediaURL({...query, ...patch}), {method, headers: {cookie: `everwoven_local=${token}`, ...headers}});
    const get = (req = request(), id = turnId) => handleGenerationMedia(req, id, env);
    // Media fixture is generated locally. Seeded ready rows test the read boundary, not paid generation success.
    expect((await get()).status).toBe(404);
    await f.database(async db => {
      const budgetScopeId = v7();
      await db.budgetScope.create({data: {id: budgetScopeId, ownerId: owner.ownerId, limitMicros: 0n, currency: 'USD', createdAt: now}});
      await db.experience.update({where: {id: root.id}, data: {budgetScopeId, status: 'playing'}});
      await db.generationQuote.create({data: {id: quoteId, ownerId: owner.ownerId, datasetId: owner.datasetId, storeEpoch: v7(), experienceId: root.id,
        experienceRevision: 1, interactionEventId, profileId: v7(), maxCostMicros: 0n, currency: 'USD', snapshot: {fixture: true}, contentHash: 'a'.repeat(64),
        acceptedTurnId: turnId, createdAt: now, expiresAt: new Date(now.getTime() + 60000)}});
      await db.generationTurn.create({data: {id: turnId, ownerId: owner.ownerId, experienceId: root.id, budgetScopeId, quoteId,
        interactionEventId, status: 'checking', media, createdAt: now, updatedAt: now}});
    });
    expect((await get()).status).toBe(404);
    await f.database(db => db.generationTurn.update({where: {id: turnId}, data: {status: 'ready'}}));
    const first = await get();expect(first.status).toBe(200);expect(Buffer.from(await first.arrayBuffer())).toEqual(bytes);
    const partial = await get(request({}, {range: 'bytes=2-21'}));expect(partial.status).toBe(206);expect(Buffer.from(await partial.arrayBuffer())).toEqual(bytes.subarray(2, 22));
    const head = await get(request({}, {}, 'HEAD'));expect(head.status).toBe(200);expect(head.body).toBeNull();expect(head.headers.get('content-length')).toBe(String(bytes.length));
    expect((await get(request({datasetId: v7()}))).status).toBe(412);
    expect((await get(request({mediaId: v7()}))).status).toBe(404);
    expect((await get(request({experienceId: v7()}))).status).toBe(404);
    expect((await get(request({}, {origin: 'https://evil.example'}))).status).toBe(403);
    expect((await get(request({}, {'sec-fetch-site': 'cross-site'}))).status).toBe(403);
    expect((await get(request({}, {cookie: ''}))).status).toBe(401);
    const duplicate = new Request(request().url + `&mediaId=${media.id}`, {headers: {cookie: `everwoven_local=${token}`}});
    expect((await get(duplicate)).status).toBe(400);
    const post = await get(request({}, {}, 'POST'));expect(post.status).toBe(405);expect(post.headers.get('allow')).toBe('GET, HEAD');
    await revokeSession(f.directory, 'dev', token);expect((await get()).status).toBe(401);
    token = (await f.reconnect()).token;
    const resumed = await get();expect(resumed.status).toBe(200);expect(createHash('sha256').update(Buffer.from(await resumed.arrayBuffer())).digest('hex')).toBe(media.sha256);
    // Every HTTP call opened and disconnected the database; no supplier registry/key was installed.
    await writeFile(join(f.directory, 'assets', owner.datasetId, `${media.id}.mp4`), 'corrupt');
    const corrupt = await get();expect(corrupt.status).toBe(503);expect(await corrupt.json()).toEqual({error: 'VIDEO_UNAVAILABLE'});
  } finally {await f.close();}
}, 30000);
