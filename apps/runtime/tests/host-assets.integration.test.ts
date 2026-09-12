import {afterAll, afterEach, beforeAll, beforeEach, expect, it, vi} from 'vitest';
import {access, copyFile, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {v7} from 'uuid';
import * as host from '../src/host/index.js';
import * as databases from '../src/infrastructure/db/client.js';
import * as normalizers from '../src/infrastructure/media/sharp-image-normalizer.js';
import type {PrivateAssetMetadata} from '../src/ports/private-asset-store.js';
import * as fileStores from '../src/infrastructure/media/private-asset-store.js';
import {prepare, dispose, fixture, type Fixture} from './fixtures/host-assets/setup.js';
let f: Fixture;
beforeAll(prepare, 30000); afterAll(dispose);
beforeEach(async () => {f = await fixture();});
afterEach(async () => {vi.restoreAllMocks(); await f?.close();});
function subject() {expect(host, 'Host must expose the bound asset service').toHaveProperty('withLocalAssets'); return host.withLocalAssets;}
const missingAssets = async () => expect(access(f.assetsPath)).rejects.toMatchObject({code: 'ENOENT'});
function body() {return {openBody: vi.fn(() => new ReadableStream<Uint8Array>({start(c) {c.enqueue(f.bytes); c.close();}}))};}
async function published() {
  return subject()(f.directory, 'dev', f.token, async service => {
    const upload = (await service.begin(f.input())).data;
    await service.process(f.query(upload.id), body()); return upload;
  });
}
async function ready() {
  const upload = await published();
  return subject()(f.directory, 'dev', f.token, service => service.complete(f.complete(upload.id)));
}
function afterNormalize(work: () => Promise<void>) {
  const normalizer = normalizers.createImageNormalizer();
  vi.spyOn(normalizers, 'createImageNormalizer').mockImplementation(() => ({normalize: async (...args) => {
    const result = await normalizer.normalize(...args); await work(); return result;
  }}));
}
function afterVerification(method: 'verifyCandidate' | 'ensureDurableCandidate', work: () => Promise<void>) {
  const create = fileStores.createPrivateAssetStore;
  vi.spyOn(fileStores, 'createPrivateAssetStore').mockImplementation(async (...args) => {
    const files = await create(...args), verify = files[method].bind(files);
    // Real same-handle verification completes before the controlled boundary mutation.
    const wrapped = async (assetId: string, expected: PrivateAssetMetadata) => {const result = await verify(assetId, expected); await work(); return result;};
    return {...files, [method]: wrapped};
  });
}
it('real issue/exchange/auth + begin/get are lazy and create no asset directory', async () => {
  const run = subject();
  expect(await host.authenticateSession(f.directory, 'dev', f.token)).toEqual({ownerId: f.manifest.ownerId, datasetId: f.manifest.datasetId});
  await run(f.directory, 'dev', f.token, async service => {
    const input = f.input(), first = await service.begin(input);
    expect((await service.getUpload(f.query(first.data.id))).status).toBe('reserved');
    expect(await service.begin(input)).toEqual({...first, replayed: true});
  });
  await missingAssets();
});
it('real bytes reach WebP ready, reconnect replays and a separate Node process reads them', async () => {
  const run = subject(), upload = await published(), command = f.complete(upload.id);
  const result = await run(f.directory, 'dev', f.token, service => service.complete(command));
  const bytes = await readFile(f.candidate(upload.assetId));
  expect(bytes.subarray(8, 12).toString()).toBe('WEBP');
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(result.data.sha256);
  const session = await f.reconnect();
  expect(await run(f.directory, 'dev', session.token, service => service.complete(command))).toEqual({...result, replayed: true});
  const child = spawn(process.execPath, ['--import', createRequire(import.meta.url).resolve('tsx'), fileURLToPath(new URL('./fixtures/host-assets/read-child.mjs', import.meta.url))], {stdio: ['pipe', 'pipe', 'pipe']});
  let output = ''; child.stdout.on('data', chunk => {output += chunk;}); child.stderr.resume();
  const ended = new Promise<number | null>((resolve, reject) => {child.on('error', reject); child.on('exit', resolve);});
  child.stdin.end(JSON.stringify({directory: f.directory, token: session.token, datasetId: f.manifest.datasetId, assetId: upload.assetId}));
  expect(await ended).toBe(0);
  expect(JSON.parse(output)).toEqual({ok: true, sha256: result.data.sha256, byteSize: bytes.length, mimeType: 'image/webp'});
});
it.each(['missing', 'revoked'])('rejects %s session before DB open or user callback', async mode => {
  const run = subject(); if (mode === 'revoked') await host.revokeSession(f.directory, 'dev', f.token);
  const open = vi.spyOn(databases, 'openRuntimeDatabase'), work = vi.fn();
  await expect(run(f.directory, 'dev', mode === 'missing' ? '' : f.token, work)).rejects.toThrow('LOCAL_SESSION_INVALID');
  expect(open).not.toHaveBeenCalled(); expect(work).not.toHaveBeenCalled(); await missingAssets();
});
it.each(['dataset', 'foreign', 'state', 'owner'])('%s denial performs zero body reads and creates no assets directory', async kind => {
  const run = subject();
  const upload = await run(f.directory, 'dev', f.token, async service => (await service.begin(f.input())).data);
  if (kind === 'foreign') await f.database(db => db.assetUpload.update({where: {id: upload.id}, data: {ownerId: v7()}}));
  if (kind === 'state') await f.database(db => db.assetUpload.update({where: {id: upload.id}, data: {status: 'failed'}}));
  if (kind === 'owner') await f.database(db => db.localProfile.update({where: {id: f.manifest.ownerId}, data: {deletedAt: new Date()}}));
  const source = body(), query = {...f.query(upload.id), ...(kind === 'dataset' ? {datasetId: v7()} : {})};
  const expected = {dataset: 'DATASET_CHANGED', foreign: 'ASSET_UPLOAD_NOT_FOUND', state: 'ASSET_STATE_INVALID', owner: 'OWNER_UNAVAILABLE'}[kind];
  await expect(run(f.directory, 'dev', f.token, service => service.process(query, source))).rejects.toThrow(expected);
  expect(source.openBody).not.toHaveBeenCalled(); await missingAssets();
});
it('a session revoked after real decode is rejected before output persistence or asset directory creation', async () => {
  const run = subject(), upload = await run(f.directory, 'dev', f.token, async s => (await s.begin(f.input())).data);
  afterNormalize(() => host.revokeSession(f.directory, 'dev', f.token));
  await expect(run(f.directory, 'dev', f.token, s => s.process(f.query(upload.id), body()))).rejects.toThrow('LOCAL_SESSION_INVALID');
  await missingAssets();
  await f.database(async db => {expect(await db.asset.count()).toBe(0); expect((await db.assetUpload.findUniqueOrThrow({where: {id: upload.id}})).outputSha256).toBeNull();});
});
it('a session revoked after durable verification creates no ready Asset or complete receipt', async () => {
  const run = subject(), upload = await published();
  afterVerification('ensureDurableCandidate', () => host.revokeSession(f.directory, 'dev', f.token));
  await expect(run(f.directory, 'dev', f.token, s => s.complete(f.complete(upload.id)))).rejects.toThrow('LOCAL_SESSION_INVALID');
  await f.database(async db => {expect(await db.asset.count()).toBe(0); expect(await db.commandReceipt.count()).toBe(1);});
});
it('a session revoked after read verification returns no GET result', async () => {
  const run = subject(), asset = await ready();
  afterVerification('verifyCandidate', () => host.revokeSession(f.directory, 'dev', f.token));
  const delivered = vi.fn();
  await expect(run(f.directory, 'dev', f.token, s => s.getBytes({datasetId: f.manifest.datasetId, assetId: asset.data.id})).then(delivered)).rejects.toThrow('LOCAL_SESSION_INVALID');
  expect(delivered).not.toHaveBeenCalled();
});
it.each(['datasetId', 'ownerId', 'createdAt'])('pinned manifest %s mutation is rejected, rather than adopting fresh valid identity', async field => {
  const run = subject(), upload = await run(f.directory, 'dev', f.token, async s => (await s.begin(f.input())).data);
  afterNormalize(async () => {await writeFile(join(f.directory, 'manifest.json'), JSON.stringify({...f.manifest, [field]: field === 'createdAt' ? new Date(Date.now() + 1000).toISOString() : v7()}));});
  await expect(run(f.directory, 'dev', f.token, s => s.process(f.query(upload.id), body()))).rejects.toThrow(field === 'datasetId' ? 'DATASET_CHANGED' : 'LOCAL_ASSETS_FAILED');
  await missingAssets();
  await f.database(async db => {expect(await db.asset.count()).toBe(0); expect((await db.assetUpload.findUniqueOrThrow({where: {id: upload.id}})).outputSha256).toBeNull();});
});
it('replacement runtime.db inode with the same owner/manifest is rejected before accessing it', async () => {
  const run = subject(), replacement = join(f.parent, 'replacement.db');
  await copyFile(join(f.directory, 'runtime.db'), replacement);
  afterNormalize(async () => {await rename(replacement, join(f.directory, 'runtime.db'));});
  const upload = await run(f.directory, 'dev', f.token, async s => (await s.begin(f.input())).data);
  await expect(run(f.directory, 'dev', f.token, s => s.process(f.query(upload.id), body()))).rejects.toThrow('LOCAL_ASSETS_FAILED');
  await missingAssets();
  // The replacement is the empty business baseline, never opened for an upload write.
  await f.database(async db => {expect(await db.assetUpload.count()).toBe(0); expect(await db.asset.count()).toBe(0);});
});
it.each(['host', 'parent'])('runtime %s directory replacement cannot redirect old binding', async kind => {
  const run = subject(), old = kind === 'host' ? f.directory : f.parent, moved = `${old}-moved`;
  const upload = await run(f.directory, 'dev', f.token, async s => (await s.begin(f.input())).data);
  afterNormalize(async () => {await rename(old, moved); const {cp} = await import('node:fs/promises'); await cp(moved, old, {recursive: true});});
  try {await expect(run(f.directory, 'dev', f.token, s => s.process(f.query(upload.id), body()))).rejects.toThrow('LOCAL_ASSETS_FAILED'); await missingAssets();}
  finally {await rm(moved, {recursive: true, force: true});}
});
it('openFiles itself reauthenticates after output transaction, before making directories', async () => {
  const run = subject(), upload = await run(f.directory, 'dev', f.token, async s => (await s.begin(f.input())).data);
  const open = databases.openRuntimeDatabase;
  vi.spyOn(databases, 'openRuntimeDatabase').mockImplementation(async path => {
    const db = await open(path), transaction = db.$transaction.bind(db);
    // Real transaction commits output; revoke before control returns to application openFiles.
    db.$transaction = (async (...args: Parameters<typeof transaction>) => {
      const result = await transaction(...args);
      const value = result as {outputSha256?: unknown};
      if (value?.outputSha256) await host.revokeSession(f.directory, 'dev', f.token);
      return result;
    }) as typeof db.$transaction;
    return db;
  });
  await expect(run(f.directory, 'dev', f.token, s => s.process(f.query(upload.id), body()))).rejects.toThrow('LOCAL_SESSION_INVALID');
  await missingAssets();
});
it('ready missing file becomes unavailable through Host, and new character portrait binding is rejected', async () => {
  const run = subject(), asset = await ready(); await rm(f.candidate(asset.data.id));
  await expect(run(f.directory, 'dev', f.token, s => s.getBytes({datasetId: f.manifest.datasetId, assetId: asset.data.id}))).rejects.toThrow('PRIVATE_ASSET_NOT_FOUND');
  await f.database(async db => {expect((await db.asset.findUniqueOrThrow({where: {id: asset.data.id}})).status).toBe('unavailable');});
  await expect(host.withLocalCharacters(f.directory, 'dev', f.token, (s, o) => s.create(o, {datasetId: o.datasetId, commandId: v7(), name: 'fixture', settings: {personality: '', appearance: '', speakingStyle: '', boundaries: ''}, portraitAssetId: asset.data.id}))).rejects.toThrow('INVALID_CHARACTER_PORTRAIT');
});
it.each(['PRIVATE_ASSET_IO /private/path', 'driver secret', 'ASSET_PRIVATE_DETAIL'])('unknown errors are fixed and drop causes: %s', async message => {
  const run = subject(); const error = await run(f.directory, 'dev', f.token, async () => {throw Error(message, {cause: Error('private')});}).catch(e => e);
  expect(error.message).toBe('LOCAL_ASSETS_FAILED'); expect(error.cause).toBeUndefined();
});
it('shared boundary disconnects on success and failure and preserves story/character call signatures', async () => {
  const run = subject(), open = databases.openRuntimeDatabase, closed: Array<ReturnType<typeof vi.fn>> = [];
  vi.spyOn(databases, 'openRuntimeDatabase').mockImplementation(async path => {const db = await open(path); closed.push(vi.spyOn(db, '$disconnect')); return db;});
  await run(f.directory, 'dev', f.token, s => s.begin(f.input()));
  await expect(run(f.directory, 'dev', f.token, async () => {throw Error('unknown');})).rejects.toThrow('LOCAL_ASSETS_FAILED');
  for (const entry of [host.withLocalStories, host.withLocalCharacters]) await entry(f.directory, 'dev', f.token, async (_s: unknown, owner: {ownerId: string; datasetId: string}) => {expect(owner).toEqual({ownerId: f.manifest.ownerId, datasetId: f.manifest.datasetId});});
  expect(closed).toHaveLength(4); for (const close of closed) expect(close).toHaveBeenCalledOnce();
});
it('database-open diagnostics are sanitized and no callback is invoked', async () => {
  const run = subject(), work = vi.fn();
  vi.spyOn(databases, 'openRuntimeDatabase').mockRejectedValue(Error('driver/path diagnostic', {cause: Error('private cause')}));
  const error = await run(f.directory, 'dev', f.token, work).catch(e => e);
  expect(error).toMatchObject({message: 'LOCAL_ASSETS_FAILED'}); expect(error).not.toHaveProperty('cause'); expect(work).not.toHaveBeenCalled(); await missingAssets();
});
it.each(['DATASET_CHANGED', 'LOCAL_SESSION_INVALID', 'IMAGE_BODY_TIMEOUT', 'IMAGE_DECODER_BUSY', 'PRIVATE_ASSET_CONTENT_INVALID', 'ASSET_UPLOAD_BUSY'])('preserves exact public identifier %s, stripping causes', async message => {
  const run = subject(); const error = await run(f.directory, 'dev', f.token, async () => {throw Error(message, {cause: Error('private cause')});}).catch(e => e);
  expect(error.message).toBe(message); expect(error.cause).toBeUndefined();
});
it('hash mismatch and aborted reception never initialize asset directories', async () => {
  const run = subject();
  await run(f.directory, 'dev', f.token, async s => {
    const upload = (await s.begin({...f.input(), inputSha256: 'f'.repeat(64)})).data;
    await expect(s.process(f.query(upload.id), body())).rejects.toThrow('IMAGE_BODY_HASH_MISMATCH');
    const controller = new AbortController(); controller.abort(); const source = body();
    await expect(s.process(f.query(upload.id), {...source, signal: controller.signal})).rejects.toThrow('IMAGE_BODY_ABORTED');
    expect(source.openBody).not.toHaveBeenCalled();
  });
  await missingAssets();
});
it('cleanup stays explicit: expired row survives reconnect until the internal operation is called', async () => {
  const run = subject(), upload = await run(f.directory, 'dev', f.token, async s => (await s.begin(f.input())).data);
  await f.database(db => db.assetUpload.update({where: {id: upload.id}, data: {expiresAt: new Date(Date.now() - 1000)}}));
  const {token} = await f.reconnect();
  expect((await run(f.directory, 'dev', token, s => s.getUpload(f.query(upload.id)))).status).toBe('reserved');
  await missingAssets();
  expect(await run(f.directory, 'dev', token, s => s.cleanup(f.query(upload.id)))).toEqual({kind: 'absent'});
  expect((await run(f.directory, 'dev', token, s => s.getUpload(f.query(upload.id)))).status).toBe('deleting');
});
it('second authentication uses the original real token, even if it is revoked while the DB opens', async () => {
  const run = subject(), open = databases.openRuntimeDatabase, work = vi.fn(); let close: ReturnType<typeof vi.fn> | undefined;
  vi.spyOn(databases, 'openRuntimeDatabase').mockImplementation(async path => {
    const db = await open(path); close = vi.spyOn(db, '$disconnect');
    await host.revokeSession(f.directory, 'dev', f.token); return db;
  });
  await expect(run(f.directory, 'dev', f.token, work)).rejects.toThrow('LOCAL_SESSION_INVALID');
  expect(work).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce(); await missingAssets();
});
it('lifetime binding detects DB replacement across the connection await and closes the original connection', async () => {
  const run = subject(), open = databases.openRuntimeDatabase, work = vi.fn(), replacement = join(f.parent, 'before-open.db');
  await copyFile(join(f.directory, 'runtime.db'), replacement); let close: ReturnType<typeof vi.fn> | undefined;
  vi.spyOn(databases, 'openRuntimeDatabase').mockImplementation(async path => {
    const db = await open(path); close = vi.spyOn(db, '$disconnect');
    await rename(replacement, join(f.directory, 'runtime.db')); return db;
  });
  await expect(run(f.directory, 'dev', f.token, work)).rejects.toThrow('LOCAL_ASSETS_FAILED');
  expect(work).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce(); await missingAssets();
});
