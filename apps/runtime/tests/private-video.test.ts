import {afterAll, afterEach, beforeAll, beforeEach, expect, it, vi} from 'vitest';
import {chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, link, writeFile, open} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {v7} from 'uuid';
import type {ValidatedHost} from '../src/host/storage.js';
import type {GeneratedVideo} from '../src/ports/video-jobs.js';
import type {VideoDownloadSource} from '../src/ports/private-video.js';
import {createPrivateVideoStore} from '../src/infrastructure/media/private-video-store.js';
import {createVideoProbe} from '../src/infrastructure/media/video-probe.js';
import {samplePrivateVideo} from '../src/infrastructure/media/video-frame-sampler.js';
import sharp from 'sharp';

// Locally rendered, zero supplier calls. ffmpeg/ffprobe are required, never silently skipped.
let fixtures: string, bytes: Buffer, unsupported: Buffer, longAudio: Buffer, base: string, host: ValidatedHost;
const video: GeneratedVideo = {url: 'https://cdn.example/fixture.mp4', ratio: '16:9', resolution: 'test', duration: 1};
const dimensions = (expected: GeneratedVideo) => {
  if (expected.resolution !== 'test') throw Error('VIDEO_DIMENSIONS_UNAVAILABLE');
  return {width: 320, height: 180};
};
const probe = createVideoProbe(dimensions);
const owner = () => ({ownerId: host.manifest.ownerId, datasetId: host.manifest.datasetId});
const dataset = () => join(host.target.directory, 'assets', owner().datasetId);
const filePath = (id: string) => join(dataset(), `${id}.mp4`);
beforeAll(async () => {
  fixtures = await mkdtemp(join(await realpath(tmpdir()), 'video-fixtures-'));
  for (const codec of ['libx264', 'mpeg4']) {
    const path = join(fixtures, `${codec}.mp4`);
    await promisify(execFile)('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '1', '-c:v', codec, '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-movflags', '+faststart', path]);
  }
  bytes = await readFile(join(fixtures, 'libx264.mp4'));unsupported = await readFile(join(fixtures, 'mpeg4.mp4'));
  const path = join(fixtures, 'long-audio.mp4');
  await promisify(execFile)('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24:d=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path]);
  longAudio = await readFile(path);
}, 30000);
afterAll(async () => {await rm(fixtures, {recursive: true, force: true});});
beforeEach(async () => {
  base = await mkdtemp(join(await realpath(tmpdir()), 'private-video-'));await chmod(base, 0o700);
  const directory = join(base, 'host');await mkdir(directory, {mode: 0o700});
  host = {target: {directory, parent: base, parentIdentity: await lstat(base)}, identity: await lstat(directory),
    manifest: {version: 1, ownerId: v7(), datasetId: v7(), environment: 'dev', createdAt: '2026-09-14T00:00:00.000Z'}};
});
afterEach(async () => {vi.restoreAllMocks();await rm(base, {recursive: true, force: true});});
function source(content = bytes, length: number | null = content.length) {
  const close = vi.fn(), open = vi.fn(async () => ({length, close, body: (async function* () {
    for (let offset = 0; offset < content.length; offset += 97) yield content.subarray(offset, offset + 97);
  })()}));
  return {open, close};
}
const create = (input: VideoDownloadSource = source(), revalidate = async () => {}) =>
  createPrivateVideoStore(host, owner(), {source: input, probe, revalidate});

it('persists, fully decodes, reopens and recovers the same video after store restart without another download', async () => {
  const input = source(), store = await create(input), turnId = v7();
  const media = await store.materialize(turnId, video);
  expect(media).toMatchObject({duration: 1, durationMs: 1000, width: 320, height: 180, mimeType: 'video/mp4', codec: 'h264',
    byteSize: String(bytes.length), sha256: createHash('sha256').update(bytes).digest('hex')});
  expect((await lstat(filePath(media.id))).mode & 0o777).toBe(0o600);
  expect((await lstat(dataset())).mode & 0o777).toBe(0o700);
  const reader = await store.open(media);expect(await reader.file.readFile()).toEqual(bytes);await reader.close();await reader.close();
  const restarted = await create(input);expect(await restarted.materialize(turnId, video)).toEqual(media);
  expect(input.open).toHaveBeenCalledTimes(1);expect(input.close).toHaveBeenCalledTimes(1);
});
it('keeps each turn/source result immutable even when workers finish concurrently', async () => {
  const input = source(), store = await create(input), turnId = v7();
  const [a, b] = await Promise.all([store.materialize(turnId, video), store.materialize(turnId, video)]);
  expect(a.id).not.toBe(b.id);
  for (const media of [a, b]) {const r = await store.open(media);expect(await r.file.readFile()).toEqual(bytes);await r.close();}
  expect([a.id, b.id]).toContain((await (await create(input)).materialize(turnId, video)).id);
  expect(input.open).toHaveBeenCalledTimes(2);
});
it('does not reuse one turn or source manifest for a different turn or generated result', async () => {
  const input = source(), store = await create(input), turnId = v7();
  const a = await store.materialize(turnId, video), b = await store.materialize(v7(), video);
  const c = await store.materialize(turnId, {...video, url: 'https://cdn.example/second.mp4'});
  expect(new Set([a.id, b.id, c.id]).size).toBe(3);expect(input.open).toHaveBeenCalledTimes(3);
});
it.each(['truncated', 'html', 'codec', 'duration', 'ratio'])('rejects %s content and publishes no recovery hint', async kind => {
  const content = kind === 'truncated' ? bytes.subarray(0, bytes.length - 1000) : kind === 'html' ? Buffer.from('<html>error</html>') : kind === 'codec' ? unsupported : bytes;
  const input = source(content), store = await create(input);
  await expect(store.materialize(v7(), {...video, ...(kind === 'duration' ? {duration: 6} : kind === 'ratio' ? {ratio: '9:16'} : {})})).rejects.toThrow();
  expect((await readdir(dataset())).filter(name => name.endsWith('.json'))).toEqual([]);expect(input.close).toHaveBeenCalledOnce();
});
it.each([0, -1, 128 * 1024 * 1024 + 1, 1.5, Number.NaN])('rejects invalid declared download length %s and releases the connection', async length => {
  const input = source(bytes, length), store = await create(input);
  await expect(store.materialize(v7(), video)).rejects.toThrow('VIDEO_DOWNLOAD_INVALID');
  expect(input.close).toHaveBeenCalledOnce();expect(await readdir(dataset())).toEqual([]);
});
it('rejects incomplete transfer, while supporting a bounded chunked response', async () => {
  const short = source(bytes, bytes.length + 1), store = await create(short);
  await expect(store.materialize(v7(), video)).rejects.toThrow('VIDEO_DOWNLOAD_INCOMPLETE');expect(short.close).toHaveBeenCalledOnce();
  expect((await (await create(source(bytes, null))).materialize(v7(), video)).byteSize).toBe(String(bytes.length));
});
it('closes a received response if owner revalidation fails before file creation', async () => {
  let revoked = false;const input = source();
  const wrapped: VideoDownloadSource = {open: async () => {const response = await input.open();revoked = true;return response;}};
  const store = await create(wrapped, async () => {if (revoked) throw Error('UNAUTHORIZED');});
  await expect(store.materialize(v7(), video)).rejects.toThrow('UNAUTHORIZED');expect(input.close).toHaveBeenCalledOnce();
  expect(await readdir(dataset())).toEqual([]);
});
it('does not download on pre-abort and closes a stream aborted during transfer', async () => {
  const input = source(), controller = new AbortController(), store = await create(input);controller.abort();
  await expect(store.materialize(v7(), video, controller.signal)).rejects.toThrow();expect(input.open).not.toHaveBeenCalled();
  const middle = new AbortController(), close = vi.fn();
  const second = await create({open: async () => ({length: null, close, body: (async function* () {yield bytes.subarray(0, 100);middle.abort();yield bytes.subarray(100);})()})});
  await expect(second.materialize(v7(), video, middle.signal)).rejects.toThrow();expect(close).toHaveBeenCalledOnce();
  expect((await readdir(dataset())).filter(name => name.endsWith('.json'))).toEqual([]);
});
it.each(['hash', 'symlink', 'hardlink', 'mode'])('rejects changed or unsafe %s video on read and recovery', async kind => {
  const input = source(), store = await create(input), turnId = v7(), media = await store.materialize(turnId, video), path = filePath(media.id);
  if (kind === 'hash') {const changed = Buffer.from(bytes);changed[changed.length - 1] = changed[changed.length - 1]! ^ 1;await writeFile(path, changed);}
  if (kind === 'mode') await chmod(path, 0o644);
  if (kind === 'hardlink') await link(path, join(base, 'alias.mp4'));
  if (kind === 'symlink') {await rename(path, join(base, 'original.mp4'));await symlink(join(base, 'original.mp4'), path);}
  await expect(store.open(media)).rejects.toThrow();await expect(store.materialize(turnId, video)).rejects.toThrow();
  expect(input.open).toHaveBeenCalledTimes(1);
});
it('fails closed on malformed recovery hints and never repairs them by downloading', async () => {
  const input = source(), store = await create(input), turn = v7();await store.materialize(turn, video);
  const name = (await readdir(dataset())).find(n => n.endsWith('.json'))!;await writeFile(join(dataset(), name), '{}');
  await expect(store.materialize(turn, video)).rejects.toThrow();expect(input.open).toHaveBeenCalledOnce();
});
it('rejects a foreign owner before filesystem initialization', async () => {
  await expect(createPrivateVideoStore(host, {...owner(), datasetId: v7()}, {source: source(), probe, revalidate: async () => {}})).rejects.toThrow('PRIVATE_VIDEO_OWNER_MISMATCH');
  expect(await readdir(host.target.directory)).toEqual([]);
});
it('reads the held descriptor after path replacement without serving the replacement', async () => {
  const store = await create(), media = await store.materialize(v7(), video), reader = await store.open(media);
  await rename(filePath(media.id), join(base, 'held.mp4'));await writeFile(filePath(media.id), 'replacement', {mode: 0o600});
  expect(await reader.file.readFile()).toEqual(bytes);await reader.close();await expect(store.open(media)).rejects.toThrow();
});
it('reports missing ffprobe as unavailable and respects an aborted probe', async () => {
  const f = await open(join(fixtures, 'libx264.mp4'), 'r');
  try {
    await expect(createVideoProbe(dimensions, join(base, 'absent'))(f, video, new AbortController().signal)).rejects.toThrow('VIDEO_PROBE_UNAVAILABLE');
    const controller = new AbortController();controller.abort();await expect(probe(f, video, controller.signal)).rejects.toThrow();
  } finally {await f.close();}
});
it('rejects a long audio track masking insufficient video duration', async () => {
  const store = await create(source(longAudio));
  await expect(store.materialize(v7(), {...video, duration: 5})).rejects.toThrow('VIDEO_CONTENT_INVALID');
});
it('requires installed exact pixel dimensions and rejects output below the sealed resolution', async () => {
  await expect((await create()).materialize(v7(), {...video, resolution: 'unknown'})).rejects.toThrow('VIDEO_DIMENSIONS_UNAVAILABLE');
  const store = await createPrivateVideoStore(host, owner(), {source: source(), revalidate: async () => {},
    probe: createVideoProbe(() => ({width: 1366, height: 768}))});
  await expect(store.materialize(v7(), {...video, resolution: '768P'})).rejects.toThrow('VIDEO_CONTENT_INVALID');
});
it('samples chronological JPEG evidence from the verified FD, bounds image dimensions and closes the reader', async () => {
  const store = await create(), media = await store.materialize(v7(), video), reader = await store.open(media);
  const close = vi.spyOn(reader, 'close'), samples = await samplePrivateVideo(reader, 3);
  expect(samples).toMatchObject({mediaId: media.id, mediaSha256: media.sha256});expect(samples.frames.map(frame => frame.atMs)).toEqual([0, 333, 666]);
  for (const frame of samples.frames) {
    const metadata = await sharp(frame.jpeg).metadata();expect(metadata.format).toBe('jpeg');expect(metadata.width).toBeLessThanOrEqual(640);expect(metadata.height).toBeLessThanOrEqual(640);
    await expect(sharp(frame.jpeg).raw().toBuffer()).resolves.toBeInstanceOf(Buffer);expect(frame.jpeg.length).toBeLessThanOrEqual(262144);
  }
  expect(close).toHaveBeenCalledOnce();await expect(reader.file.stat()).rejects.toThrow();
});
it('closes a sample reader on invalid count, missing extractor and pre-abort', async () => {
  const store = await create(), media = await store.materialize(v7(), video);
  for (const kind of ['count', 'extractor', 'abort']) {
    const reader = await store.open(media), close = vi.spyOn(reader, 'close'), controller = new AbortController();if (kind === 'abort') controller.abort();
    await expect(samplePrivateVideo(reader, kind === 'count' ? 17 : 1, controller.signal, kind === 'extractor' ? join(base, 'absent') : 'ffmpeg')).rejects.toThrow();
    expect(close).toHaveBeenCalledOnce();
  }
});
