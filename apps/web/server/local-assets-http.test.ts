import {beforeEach, expect, it, vi} from 'vitest';
import type {AssetService} from 'runtime/host';
import {asset, published, assetId, uploadId, datasetId, env, origin, headers, serviceFixture} from './fixtures/assets';
const host = vi.hoisted(() => ({withLocalAssets: vi.fn()}));
vi.mock('runtime/host', () => host);
let service: AssetService;
let handlers: typeof import('./local-assets-http');
beforeEach(async () => {
  service = serviceFixture(); host.withLocalAssets.mockReset().mockImplementation(async (_d, _e, _t, work) => work(service));
  handlers = await import('./local-assets-http');
});
function put(extra: Record<string, string> = {}) {
  const request = new Request(`${origin}/api/local-assets/uploads/${uploadId}`, {method: 'PUT', headers: {...headers, 'x-everwoven-dataset-id': datasetId, 'content-type': 'application/octet-stream', ...extra}});
  const body = vi.fn(() => null); Object.defineProperty(request, 'body', {get: body});
  return {request, body};
}
function get(query = `datasetId=${datasetId}`, extra: Record<string, string> = {}) {
  return new Request(`${origin}/api/local-assets/${assetId}?${query}`, {headers: {cookie: headers.cookie, ...extra}});
}
function security(response: Response) {expect(response.headers.get('cache-control')).toBe('no-store'); expect(response.headers.get('x-content-type-options')).toBe('nosniff');}
it('passes a lazy raw body and original signal to process, returning published rather than ready', async () => {
  const {request, body} = put();
  vi.mocked(service.process).mockImplementation(async (input, source) => {
    expect(input).toEqual({datasetId, uploadId}); expect(body).not.toHaveBeenCalled(); expect(source.signal).toBe(request.signal); expect(source.openBody()).toBeNull(); return published;
  });
  const result = await handlers.handleAssetUpload(request, uploadId, env);
  expect(result.status).toBe(200); expect(await result.json()).toEqual(published); expect(body).toHaveBeenCalledTimes(1); security(result);
});
it.each(['session', 'origin', 'host', 'cross-site', 'marker', 'config', 'id', 'dataset', 'length', 'multipart'])('%s failure never accesses body', async kind => {
  const extra: Record<string, string> = {};
  if (kind === 'session') extra.cookie = ''; if (kind === 'origin') extra.origin = 'https://evil.example';
  if (kind === 'host') {extra.host = 'evil.example'; extra['x-forwarded-host'] = new URL(origin).host;}
  if (kind === 'cross-site') extra['sec-fetch-site'] = 'cross-site'; if (kind === 'marker') extra['x-everwoven-request'] = '';
  if (kind === 'dataset') extra['x-everwoven-dataset-id'] = 'bad'; if (kind === 'length') extra['content-length'] = String(10 * 1024 * 1024 + 1);
  if (kind === 'multipart') extra['content-type'] = 'multipart/form-data; boundary=private';
  const {request, body} = put(extra);
  const result = await handlers.handleAssetUpload(request, kind === 'id' ? '../bad' : uploadId, kind === 'config' ? {} : env);
  expect(result.status).toBe(({session: 401, origin: 403, host: 403, 'cross-site': 403, marker: 403, config: 401, id: 400, dataset: 400, length: 413, multipart: 415} as Record<string, number>)[kind]);
  expect(body).not.toHaveBeenCalled(); expect(service.process).not.toHaveBeenCalled(); security(result);
});
it.each([['LOCAL_SESSION_INVALID', 401], ['DATASET_CHANGED', 412], ['ASSET_UPLOAD_NOT_FOUND', 404], ['ASSET_STATE_INVALID', 409], ['ASSET_UPLOAD_BUSY', 409], ['IMAGE_BODY_BUSY', 503]] as const)('pre-body service failure %s remains lazy', async (message, status) => {
  const {request, body} = put(); vi.mocked(service.process).mockRejectedValue(Error(message));
  const result = await handlers.handleAssetUpload(request, uploadId, env); expect(result.status).toBe(status); expect(body).not.toHaveBeenCalled(); security(result);
});
it('does not trust a small declared length, delegating actual size/hash verification', async () => {
  const {request} = put({'content-length': '1'}); vi.mocked(service.process).mockRejectedValue(Error('IMAGE_BODY_SIZE_MISMATCH'));
  const response = await handlers.handleAssetUpload(request, uploadId, env); expect(response.status).toBe(400); expect(service.process).toHaveBeenCalledTimes(1);
});
it('serves verified bytes without Origin, ignores Range and never redirects', async () => {
  const response = await handlers.handleAssetBytes(get(undefined, {range: 'bytes=0-1'}), assetId, env);
  expect(response.status).toBe(200); expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from('RIFF'));
  expect(response.headers.get('content-type')).toBe('image/webp'); expect(response.headers.get('location')).toBeNull(); expect(response.headers.get('content-range')).toBeNull();
  expect(service.getBytes).toHaveBeenCalledWith({datasetId, assetId}); security(response);
});
it.each(['foreign', 'host', 'cross-site', 'duplicate', 'extra', 'missing', 'invalid', 'id'])('GET rejects %s without retrieving bytes', async kind => {
  const query = kind === 'duplicate' ? `datasetId=${datasetId}&datasetId=${datasetId}` : kind === 'extra' ? `datasetId=${datasetId}&filename=secret.webp` : kind === 'missing' ? '' : kind === 'invalid' ? 'datasetId=bad' : `datasetId=${datasetId}`;
  const extra: Record<string, string> = kind === 'foreign' ? {origin: 'https://evil.example'} : kind === 'host' ? {host: 'evil.example'} : kind === 'cross-site' ? {'sec-fetch-site': 'cross-site'} : {};
  const result = await handlers.handleAssetBytes(get(query, extra), kind === 'id' ? '../bad' : assetId, env);
  expect(result.status).toBe(['foreign', 'host', 'cross-site'].includes(kind) ? 403 : 400); expect(service.getBytes).not.toHaveBeenCalled(); security(result);
});
it.each([['LOCAL_SESSION_INVALID', 401], ['ASSET_NOT_FOUND', 404], ['ASSET_UNAVAILABLE', 503], ['PRIVATE_ASSET_IO /private/secret', 500]] as const)('GET %s returns no image bytes or diagnostics', async (message, status) => {
  vi.mocked(service.getBytes).mockRejectedValue(Error(message)); const response = await handlers.handleAssetBytes(get(), assetId, env);
  expect(response.status).toBe(status); expect(await response.text()).not.toMatch(/RIFF|private|secret|stack|cause/); security(response);
});
it('strictly rejects leaked/private or wrong-state DTOs in binary responses', async () => {
  vi.mocked(service.process).mockResolvedValue({...published, storageKey: '/private'} as never);
  expect((await handlers.handleAssetUpload(put().request, uploadId, env)).status).toBe(500);
  vi.mocked(service.process).mockResolvedValue({...published, status: 'processing'});
  expect((await handlers.handleAssetUpload(put().request, uploadId, env)).status).toBe(500);
  vi.mocked(service.getBytes).mockResolvedValue({data: {...asset, token: 'private'} as never, bytes: Buffer.from('RIFF')});
  const result = await handlers.handleAssetBytes(get(), assetId, env); expect(result.status).toBe(500); expect(await result.text()).not.toContain('private');
});
it.each(['POST', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'])('unsupported %s returns 405+Allow and security headers', async method => {
  const request = new Request(`${origin}/api/local-assets/${assetId}`, {method});
  const read = await handlers.handleAssetBytes(request, assetId, env), write = await handlers.handleAssetUpload(request, uploadId, env);
  expect(read.status).toBe(405); expect(read.headers.get('allow')).toBe('GET'); security(read);
  expect(write.status).toBe(405); expect(write.headers.get('allow')).toBe('PUT'); security(write);
  expect(host.withLocalAssets).not.toHaveBeenCalled();
});
it('foreign browser origin is denied before credential admission, including without a cookie', async () => {
  const {request, body} = put({origin: 'https://evil.example', cookie: ''});
  const response = await handlers.handleAssetUpload(request, uploadId, env); expect(response.status).toBe(403);
  expect(body).not.toHaveBeenCalled(); expect(host.withLocalAssets).not.toHaveBeenCalled(); security(response);
});
