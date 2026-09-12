import type {UploadIntentDTO} from 'runtime/contracts/asset';
import {beforeAll, afterAll, expect, it, vi} from 'vitest';
import {chmod, mkdtemp, realpath, rm, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {v7} from 'uuid';
import {initializeLocalHost, issueConnectionCode} from 'runtime/host';
import {handleLocalSession} from './local-session';
import {handleTRPCRequest} from './api/http';
import {handleAssetUpload, handleAssetBytes} from './local-assets-http';
import {ASSET_DATASET_HEADER} from '../contracts/asset-http';
import {generatedPNG} from './fixtures/asset-png';
let parent: string;
const origin = 'http://127.0.0.1:3195', bytes = generatedPNG();
type Connection = {env: Record<string, string>; datasetId: string; cookie: string};
async function connect(env: Record<string, string>): Promise<string> {
  const code = await issueConnectionCode(env.RUNTIME_DATA_DIR!, 'dev');
  const response = await handleLocalSession(new Request(`${origin}/api/local-session`, {method: 'POST', headers: {origin, 'x-everwoven-request': '1', 'content-type': 'application/json'}, body: JSON.stringify({code})}), env);
  expect(response.status).toBe(200); return response.headers.get('set-cookie')!.split(';')[0]!;
}
async function fixture(): Promise<Connection> {
  const env = {APP_ORIGIN: origin, APP_ENV: 'dev', EVERWOVEN_LOCAL_LAUNCH: 'loopback-v1', RUNTIME_DATA_DIR: join(parent, v7())};
  const manifest = await initializeLocalHost(env.RUNTIME_DATA_DIR, 'dev'); return {env, datasetId: manifest.datasetId, cookie: await connect(env)};
}
function begin(c: Connection) {return {datasetId: c.datasetId, commandId: v7(), inputSha256: createHash('sha256').update(bytes).digest('hex'), inputByteSize: String(bytes.length), originalName: 'generated.png', rightsDeclaration: 'generated fixture'};}
async function rpc(c: Connection, method: string, input: unknown, write = true) {
  const query = write ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  const response = await handleTRPCRequest(new Request(`${origin}/api/trpc/${method}${query}`, {method: write ? 'POST' : 'GET', headers: {origin, 'x-everwoven-request': '1', cookie: c.cookie, 'content-type': 'application/json'}, ...(write ? {body: JSON.stringify(input)} : {})}), c.env);
  return {response, body: await response.json()};
}
function put(c: Connection, uploadId: string, payload = bytes, extra: Record<string, string> = {}) {
  return new Request(`${origin}/api/local-assets/uploads/${uploadId}`, {method: 'PUT', headers: {origin, 'x-everwoven-request': '1', cookie: c.cookie, [ASSET_DATASET_HEADER]: c.datasetId, 'content-type': 'image/png', ...extra}, body: new Uint8Array(payload)});
}
function get(c: Connection, assetId: string) {return new Request(`${origin}/api/local-assets/${assetId}?datasetId=${c.datasetId}`, {headers: {cookie: c.cookie}});}
async function noAssetDirectory(c: Connection) {await expect(access(join(c.env.RUNTIME_DATA_DIR!, 'assets'))).rejects.toMatchObject({code: 'ENOENT'});}
beforeAll(async () => {parent = await realpath(await mkdtemp(join(tmpdir(), 'asset-http-'))); await chmod(parent, 0o700);});
afterAll(async () => {if (parent) await rm(parent, {recursive: true, force: true});});

it('real session→begin→PNG PUT→complete→WebP GET→new Node/reconnect→character portrait', async () => {
  const c = await fixture(), input = begin(c), first = await rpc(c, 'assets.beginUpload', input);
  expect(first.response.status).toBe(200); const initial = first.body.result.data;
  const upload = initial.data;
  expect((await rpc(c, 'assets.beginUpload', input)).body.result.data).toEqual({...initial, replayed: true});
  await noAssetDirectory(c);
  const processed = await handleAssetUpload(put(c, upload.id), upload.id, c.env); expect(processed.status).toBe(200);
  const published = await processed.json(); expect(published.status).toBe('published'); expect(published.outputWidth).toBe(320); expect(published.outputHeight).toBe(256);
  expect((await rpc(c, 'assets.getUpload', {datasetId: c.datasetId, uploadId: upload.id}, false)).body.result.data).toEqual(published);
  const command = {datasetId: c.datasetId, uploadId: upload.id, commandId: v7()}, completed = await rpc(c, 'assets.completeUpload', command);
  expect(completed.response.status).toBe(200); const result = completed.body.result.data;
  expect((await rpc(c, 'assets.completeUpload', command)).body.result.data).toEqual({...result, replayed: true});
  const read = await handleAssetBytes(get(c, upload.assetId), upload.assetId, c.env); expect(read.status).toBe(200);
  const actual = Buffer.from(await read.arrayBuffer()); expect(actual.toString('ascii', 0, 4)).toBe('RIFF'); expect(actual.toString('ascii', 8, 12)).toBe('WEBP');
  expect(createHash('sha256').update(actual).digest('hex')).toBe(result.data.sha256); expect(String(actual.length)).toBe(result.data.byteSize);
  expect(read.headers.get('cache-control')).toBe('no-store'); expect(read.headers.get('x-content-type-options')).toBe('nosniff');
  expect(JSON.stringify(result)).not.toMatch(/storageKey|ownerId|token|lease|\/Users|\.webp/);
  const revoked = await handleLocalSession(new Request(`${origin}/api/local-session`, {method: 'DELETE', headers: {origin, 'x-everwoven-request': '1', cookie: c.cookie}}), c.env);
  expect(revoked.status).toBe(200); expect((await handleAssetBytes(get(c, upload.assetId), upload.assetId, c.env)).status).toBe(401);
  c.cookie = await connect(c.env);
  const cli = fileURLToPath(new URL('../../runtime/node_modules/tsx/dist/cli.mjs', import.meta.url));
  const child = await promisify(execFile)(process.execPath, [cli, fileURLToPath(new URL('./fixtures/assets-restart.mts', import.meta.url))], {env: {...process.env, ASSET_FIXTURE_ENV: JSON.stringify(c.env), ASSET_FIXTURE_COOKIE: c.cookie, ASSET_FIXTURE_ID: upload.assetId, ASSET_FIXTURE_DATASET: c.datasetId}, timeout: 15000});
  expect(JSON.parse(child.stdout)).toEqual({pid: expect.any(Number), session: {authenticated: true, datasetId: c.datasetId}, status: 200, hash: result.data.sha256, size: actual.length, mime: 'image/webp'});
  expect(JSON.parse(child.stdout).pid).not.toBe(process.pid);
  const character = await rpc(c, 'characters.create', {datasetId: c.datasetId, commandId: v7(), name: '真实头像', settings: {personality: '', appearance: '', speakingStyle: '', boundaries: ''}, portraitAssetId: upload.assetId});
  expect(character.response.status).toBe(200); expect(character.body.result.data.data.portraitAssetId).toBe(upload.assetId);
}, 30000);

it('real auth/dataset/owner/state/Origin failures never access lazy body or create asset directories', async () => {
  const c = await fixture(), other = await fixture(), initial = await rpc(c, 'assets.beginUpload', begin(c)), upload = initial.body.result.data.data;
  const checks: Array<[Connection, string, Record<string, string>, number]> = [
    [{...c, cookie: `everwoven_local=${'a'.repeat(43)}`}, upload.id, {}, 401],
    [c, upload.id, {origin: 'https://evil.example'}, 403],
    [c, upload.id, {[ASSET_DATASET_HEADER]: v7()}, 412],
    [other, upload.id, {}, 404],
  ];
  for (const [connection, id, extra, status] of checks) {
    const request = put(connection, id, bytes, extra), body = vi.fn(() => null); Object.defineProperty(request, 'body', {get: body});
    const response = await handleAssetUpload(request, id, connection.env); expect(response.status).toBe(status); expect(body).not.toHaveBeenCalled();
  }
  const premature = await rpc(c, 'assets.completeUpload', {datasetId: c.datasetId, uploadId: upload.id, commandId: v7()}); expect(premature.response.status).toBe(409);
  await noAssetDirectory(c); await noAssetDirectory(other);
  expect((await handleAssetBytes(get(other, upload.assetId), upload.assetId, other.env)).status).toBe(404);
}, 30000);

it('real receiver rejects bad actual bytes/hash and multipart; a failed cancellation does not mask the body error', async () => {
  const c = await fixture(), input = begin(c), first = await rpc(c, 'assets.beginUpload', input), upload = first.body.result.data.data;
  const wrong = Buffer.from(bytes); wrong[wrong.length - 1] = wrong[wrong.length - 1]! ^ 1;
  const hash = await handleAssetUpload(put(c, upload.id, wrong), upload.id, c.env); expect(hash.status).toBe(400); expect(await hash.json()).toEqual({error: 'IMAGE_BODY_HASH_MISMATCH'});
  const size = await handleAssetUpload(put(c, upload.id, bytes.subarray(1), {'content-length': '1'}), upload.id, c.env); expect(size.status).toBe(400); expect(await size.json()).toEqual({error: 'IMAGE_BODY_SIZE_MISMATCH'});
  const multi = await handleAssetUpload(put(c, upload.id, bytes, {'content-type': 'multipart/form-data'}), upload.id, c.env); expect(multi.status).toBe(415);
  const req = put(c, upload.id), cancel = vi.fn(async () => {throw Error('/private cancellation failure');});
  const stream = new ReadableStream<Uint8Array>({pull(controller) {controller.enqueue(new Uint8Array(bytes.length + 1));}, cancel}, {highWaterMark: 0});
  Object.defineProperty(req, 'body', {get: () => stream});
  const overflow = await handleAssetUpload(req, upload.id, c.env); expect(overflow.status).toBe(413); expect(await overflow.json()).toEqual({error: 'IMAGE_BODY_TOO_LARGE'}); expect(cancel).toHaveBeenCalledTimes(1);
  await noAssetDirectory(c);
}, 30000);
it('real active lease and receiver capacity reject before a second/third request body is opened', async () => {
  const c = await fixture();
  const uploads: UploadIntentDTO[] = [];
  for (let i = 0; i < 3; i++) uploads.push((await rpc(c, 'assets.beginUpload', begin(c))).body.result.data.data);
  const controls: ReadableStreamDefaultController<Uint8Array>[] = [];
  const requests = [0, 1].map(i => {
    const request = put(c, uploads[i].id);
    let opened!: () => void; const entered = new Promise<void>(resolve => {opened = resolve;});
    const stream = new ReadableStream<Uint8Array>({start(controller) {controls.push(controller);}}, {highWaterMark: 0});
    const body = vi.fn(() => {opened(); return stream;}); Object.defineProperty(request, 'body', {get: body});
    return {request, entered, body};
  });
  const pending = requests.map((item, i) => handleAssetUpload(item.request, uploads[i].id, c.env));
  try {
    await Promise.all(requests.map(item => item.entered));
    await noAssetDirectory(c);
    for (const [index, status, code] of [[0, 409, 'ASSET_UPLOAD_BUSY'], [2, 503, 'IMAGE_BODY_BUSY']] as const) {
      const request = put(c, uploads[index].id), body = vi.fn(() => null); Object.defineProperty(request, 'body', {get: body});
      const result = await handleAssetUpload(request, uploads[index].id, c.env);
      expect(result.status).toBe(status); expect(await result.json()).toEqual({error: code}); expect(body).not.toHaveBeenCalled();
    }
    expect((await rpc(c, 'assets.getUpload', {datasetId: c.datasetId, uploadId: uploads[2].id}, false)).body.result.data.status).toBe('reserved');
    await noAssetDirectory(c);
  } finally {
    for (const controller of controls) {controller.enqueue(bytes); controller.close();}
    const responses = await Promise.all(pending); expect(responses.map(r => r.status)).toEqual([200, 200]);
  }
}, 30000);
