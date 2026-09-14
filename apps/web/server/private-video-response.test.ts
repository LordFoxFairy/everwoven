import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {mkdtemp, open, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {v7} from 'uuid';
import {privateVideoResponse} from './private-video-response';
import type {PrivateVideoReader} from 'runtime/host';
let directory: string;
const bytes = Buffer.alloc(200000, 42), digest = createHash('sha256').update(bytes).digest('hex');
beforeEach(async () => {directory = await mkdtemp(join(tmpdir(), 'video-response-'));});
afterEach(async () => {vi.useRealTimers();await rm(directory, {recursive: true, force: true});});
async function reader(): Promise<PrivateVideoReader & {close: ReturnType<typeof vi.fn<() => Promise<void>>>}> {
  const path = join(directory, v7());await writeFile(path, bytes);const file = await open(path, 'r');
  return {file, close: vi.fn(() => file.close()), metadata: {id: v7(), sha256: digest, byteSize: String(bytes.length),
    width: 320, height: 180, duration: 1, durationMs: 1000, mimeType: 'video/mp4', codec: 'h264'}};
}
it.each([
  [undefined, 200, 0, bytes.length - 1], ['bytes=0-99', 206, 0, 99], ['bytes=10-', 206, 10, bytes.length - 1],
  ['bytes=-24', 206, bytes.length - 24, bytes.length - 1], ['bytes=100-999999', 206, 100, bytes.length - 1],
] as const)('streams %s from the held descriptor, bounds bytes and closes on end', async (range, status, start, end) => {
  const r = await reader(), response = await privateVideoResponse(new Request('http://127.0.0.1/media', {headers: range ? {range} : {}}), r);
  expect(response.status).toBe(status);expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes.subarray(start, end + 1));
  expect(response.headers.get('content-length')).toBe(String(end - start + 1));expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('etag')).toBe(`"${digest}"`);expect(r.close).toHaveBeenCalledOnce();
  if (range) expect(response.headers.get('content-range')).toBe(`bytes ${start}-${end}/${bytes.length}`);
});
it.each(['bytes=0-1,2-3', 'bytes=2-1', 'bytes=-0', 'bytes=200000-', 'bytes=-', 'words=0-1', 'bytes=9007199254740992-', 'bytes=0-NaN'])('rejects unsatisfiable/invalid range %s without leaving a descriptor', async range => {
  const r = await reader(), response = await privateVideoResponse(new Request('http://127.0.0.1/media', {headers: {range}}), r);
  expect(response.status).toBe(416);expect(response.headers.get('content-range')).toBe(`bytes */${bytes.length}`);expect(r.close).toHaveBeenCalledOnce();
});
it('HEAD returns complete representation headers and closes without transferring bytes', async () => {
  const r = await reader(), response = await privateVideoResponse(new Request('http://127.0.0.1/media', {method: 'HEAD', headers: {range: 'bytes=0-10'}}), r);
  expect(response.status).toBe(200);expect(response.body).toBeNull();expect(response.headers.get('content-length')).toBe(String(bytes.length));expect(r.close).toHaveBeenCalledOnce();
});
it('honors a matching If-Range and sends the full representation on mismatch', async () => {
  for (const etag of [`"${digest}"`, '"changed"']) {
    const r = await reader(), response = await privateVideoResponse(new Request('http://127.0.0.1/media', {headers: {range: 'bytes=2-8', 'if-range': etag}}), r);
    expect(response.status).toBe(etag === `"${digest}"` ? 206 : 200);await response.arrayBuffer();expect(r.close).toHaveBeenCalledOnce();
  }
});
it('closes on consumer cancel', async () => {
  const r = await reader(), response = await privateVideoResponse(new Request('http://127.0.0.1/media'), r);
  const body = response.body!.getReader();await body.read();await body.cancel();expect(r.close).toHaveBeenCalledOnce();
});
it('closes on request abort and rejects later reads without internal details', async () => {
  const r = await reader(), abort = new AbortController(), response = await privateVideoResponse(new Request('http://127.0.0.1/media', {signal: abort.signal}), r);
  const body = response.body!.getReader();await body.read();abort.abort();await expect(body.read()).rejects.toThrow('VIDEO_READ_CANCELLED');
  expect(r.close).toHaveBeenCalledOnce();
});
it('closes stalled unconsumed responses after the bounded stream lifetime', async () => {
  const r = await reader();vi.useFakeTimers();const response = await privateVideoResponse(new Request('http://127.0.0.1/media'), r);
  await vi.advanceTimersByTimeAsync(120000);await expect(response.arrayBuffer()).rejects.toThrow('VIDEO_READ_CANCELLED');expect(r.close).toHaveBeenCalledOnce();
});
it('closes and sanitizes an underlying file read error', async () => {
  const r = await reader();vi.spyOn(r.file, 'read').mockRejectedValueOnce(Error('/private/path/key'));
  const response = await privateVideoResponse(new Request('http://127.0.0.1/media'), r);
  await expect(response.arrayBuffer()).rejects.toThrow(/^VIDEO_READ_FAILED$/);expect(r.close).toHaveBeenCalledOnce();
});
