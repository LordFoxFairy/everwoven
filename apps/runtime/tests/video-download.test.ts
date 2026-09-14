import {beforeEach, expect, it, vi} from 'vitest';
import {PassThrough} from 'node:stream';
import {EventEmitter, getEventListeners} from 'node:events';
const network = vi.hoisted(() => ({lookup: vi.fn(), get: vi.fn()}));
vi.mock('node:dns/promises', () => ({lookup: network.lookup}));
vi.mock('node:https', () => ({get: network.get}));
import {createVideoDownloadSource, isPublicVideoIPv4} from '../src/infrastructure/media/video-download.js';

beforeEach(() => {vi.resetAllMocks();network.lookup.mockResolvedValue([{address: '93.184.216.34', family: 4}]);});
function respond(status = 200, headers: Record<string, string> = {'content-type': 'video/mp4', 'content-length': '3'}) {
  const response = Object.assign(new PassThrough(), {statusCode: status, headers});
  network.get.mockImplementation((_url, _options, callback) => {queueMicrotask(() => {callback(response);if (!response.destroyed) response.end('abc');});return new EventEmitter();});
  return response;
}
it.each(['127.0.0.1', '10.0.0.1', '0.0.0.0', '100.64.0.1', '169.254.169.254', '172.31.255.255', '192.168.1.1', '192.0.2.1',
  '192.88.99.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::1', '::ffff:127.0.0.1', 'invalid'])('excludes nonpublic address %s', address => {
  expect(isPublicVideoIPv4(address)).toBe(false);
});
it.each(['http://cdn.example/a', 'https://cdn.example:444/a', 'https://user:secret@cdn.example/a', 'https://cdn.example/a#fragment',
  'https://evil.example/a', 'https://cdn.example.evil/a', ' https://cdn.example/a', 'https://127.0.0.1/a'])('rejects unapproved URL %s before DNS', async url => {
  await expect(createVideoDownloadSource(['cdn.example']).open(url, new AbortController().signal)).rejects.toThrow('VIDEO_DOWNLOAD_SOURCE_DENIED');
  expect(network.lookup).not.toHaveBeenCalled();expect(network.get).not.toHaveBeenCalled();
});
it('requires a nonempty explicit host policy', () => {expect(() => createVideoDownloadSource([])).toThrow('VIDEO_DOWNLOAD_POLICY_UNAVAILABLE');});
it('pins the approved public DNS result to an isolated TLS connection and exposes a closable stream', async () => {
  const response = respond(), signal = new AbortController().signal;
  const value = await createVideoDownloadSource(['cdn.example']).open('https://cdn.example/a?signature=fixture', signal);
  const options = network.get.mock.calls[0]![1], cb = vi.fn();options.lookup('cdn.example', {}, cb);
  expect(cb).toHaveBeenCalledWith(null, '93.184.216.34', 4);
  expect(options).toMatchObject({agent: false, family: 4, signal, headers: {Accept: 'video/mp4, application/octet-stream', 'Accept-Encoding': 'identity'}});
  expect(options.headers).not.toHaveProperty('Authorization');expect(value.length).toBe(3);
  const chunks = [];for await (const chunk of value.body) chunks.push(chunk);expect(Buffer.concat(chunks).toString()).toBe('abc');
  value.close();expect(response.destroyed).toBe(true);
});
it.each([[], [{address: '127.0.0.1', family: 4}], [{address: '93.184.216.34', family: 4}, {address: '10.0.0.1', family: 4}]].map(rows => ({rows})))('denies empty/private/mixed DNS answers $rows', async ({rows}) => {
  network.lookup.mockResolvedValue(rows);await expect(createVideoDownloadSource(['cdn.example']).open('https://cdn.example/a', new AbortController().signal)).rejects.toThrow('VIDEO_DOWNLOAD_SOURCE_DENIED');
  expect(network.get).not.toHaveBeenCalled();
});
it('aborts a stalled DNS lookup promptly and never makes a request on its late completion', async () => {
  let resolve!: (rows: unknown) => void;network.lookup.mockReturnValue(new Promise(r => {resolve = r;}));
  const controller = new AbortController(), pending = createVideoDownloadSource(['cdn.example']).open('https://cdn.example/a', controller.signal);
  controller.abort();await expect(pending).rejects.toThrow('VIDEO_DOWNLOAD_UNAVAILABLE');
  expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  resolve([{address: '93.184.216.34', family: 4}]);await Promise.resolve();await Promise.resolve();
  expect(network.get).not.toHaveBeenCalled();
});
it.each([
  [302, {'content-type': 'video/mp4', location: 'https://evil.example/a'}],
  [200, {'content-type': 'text/html'}], [200, {'content-type': 'video/mp4', 'content-encoding': 'gzip'}],
  [200, {'content-type': 'video/mp4', 'content-length': '134217729'}], [200, {'content-type': 'video/mp4', 'content-length': '0'}],
  [206, {'content-type': 'video/mp4'}],
] as const)('rejects response %s %j and closes it without following redirects', async (status, headers) => {
  const response = respond(status, headers);await expect(createVideoDownloadSource(['cdn.example']).open('https://cdn.example/a', new AbortController().signal)).rejects.toThrow('VIDEO_DOWNLOAD_INVALID');
  expect(response.destroyed).toBe(true);expect(network.get).toHaveBeenCalledOnce();
});
it('sanitizes connection errors without leaking signed query strings', async () => {
  network.get.mockImplementation(() => {const request = new EventEmitter();queueMicrotask(() => request.emit('error', Error('https://cdn.example/?signature=secret')));return request;});
  await expect(createVideoDownloadSource(['cdn.example']).open('https://cdn.example/a', new AbortController().signal)).rejects.toThrow(/^VIDEO_DOWNLOAD_UNAVAILABLE$/);
});
