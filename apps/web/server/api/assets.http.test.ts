import {beforeEach, expect, it, vi} from 'vitest';
import {TRPCError} from '@trpc/server';
import {appRouter} from './root';
import {handleTRPCRequest} from './http';
import {begin, upload, asset, datasetId, uploadId, origin, env, headers, serviceFixture} from '../fixtures/assets';
import type {AssetService} from 'runtime/host';
const host = vi.hoisted(() => ({withLocalAssets: vi.fn()}));
vi.mock('runtime/host', () => host);
let service: AssetService;
beforeEach(() => {service = serviceFixture(); host.withLocalAssets.mockReset().mockImplementation(async (_dir, _env, _token, work) => work(service));});
function caller() {return appRouter.createCaller({env, withAssets: async work => work(service)});}
async function http(name: string, input: unknown, write = true, extra: Record<string, string> = {}) {
  const query = write ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  return handleTRPCRequest(new Request(`${origin}/api/trpc/assets.${name}${query}`, {method: write ? 'POST' : 'GET', headers: {...headers, 'content-type': 'application/json', ...extra}, ...(write ? {body: JSON.stringify(input)} : {})}), env);
}
it('registers exactly the three asset operations and preserves historical command DTOs', async () => {
  vi.mocked(service.begin).mockResolvedValue({data: upload, replayed: true});
  expect(Object.keys(appRouter._def.procedures).filter(name => name.startsWith('assets.')).sort()).toEqual(['assets.beginUpload', 'assets.completeUpload', 'assets.getUpload']);
  const c = caller(); expect(await c.assets.beginUpload(begin)).toEqual({data: upload, replayed: true});
  expect(await c.assets.getUpload({datasetId, uploadId})).toEqual(upload);
  expect(await c.assets.completeUpload({datasetId, uploadId, commandId: begin.commandId})).toEqual({data: asset, replayed: false});
  expect(service.begin).toHaveBeenCalledWith(begin);
});
it.each(['beginUpload', 'getUpload', 'completeUpload'])('%s rejects unknown input fields before service work', async method => {
  const input = method === 'beginUpload' ? begin : method === 'getUpload' ? {datasetId, uploadId} : {datasetId, uploadId, commandId: begin.commandId};
  const response = await http(method, {...input, ownerId: 'private'}, method !== 'getUpload');
  expect(response.status).toBe(400); expect(service.begin).not.toHaveBeenCalled(); expect(service.getUpload).not.toHaveBeenCalled(); expect(service.complete).not.toHaveBeenCalled();
});
it.each(['extra', 'replayed', 'data', 'null'])('strictly rejects malformed command output: %s', async kind => {
  const response = kind === 'extra' ? {data: upload, replayed: false, storageKey: '/private'} : kind === 'replayed' ? {data: upload, replayed: 'yes'} : kind === 'data' ? {data: {...upload, token: 'secret'}, replayed: false} : null;
  vi.mocked(service.begin).mockResolvedValue(response as never);
  const result = await http('beginUpload', begin); expect(result.status).toBe(500); expect(await result.text()).not.toMatch(/private|secret|stack|cause/);
});
it.each([
  ['LOCAL_SESSION_INVALID', 401], ['LOCAL_ORIGIN_DENIED', 403], ['INVALID_ASSET_COMMAND', 400],
  ['IMAGE_BODY_HASH_MISMATCH', 400], ['IMAGE_BODY_SIZE_MISMATCH', 400], ['ASSET_UPLOAD_NOT_FOUND', 404],
  ['ASSET_STATE_INVALID', 409], ['ASSET_LEASE_LOST', 409], ['IDEMPOTENCY_CONFLICT', 409], ['DATASET_CHANGED', 412],
  ['IMAGE_BODY_TOO_LARGE', 413], ['UNSUPPORTED_IMAGE_FORMAT', 415], ['IMAGE_BODY_BUSY', 503],
  ['IMAGE_DECODER_BUSY', 503], ['IMAGE_PROCESSING_TIMEOUT', 503], ['ASSET_UNAVAILABLE', 503],
  ['PRIVATE_ASSET_IO /private/secret', 500], ['UNKNOWN_PRIVATE', 500],
] as const)('maps service failure %s through next() result to HTTP %s', async (message, status) => {
  vi.mocked(service.begin).mockRejectedValue(Error(message)); const result = await http('beginUpload', begin);
  expect(result.status).toBe(status); const text = await result.text(); expect(text).not.toMatch(/stack|cause|\/private|UNKNOWN_PRIVATE/);
  expect(result.headers.get('cache-control')).toBe('no-store'); expect(result.headers.get('x-content-type-options')).toBe('nosniff');
});
it('does not trust externally thrown TRPCError code/message/cause', async () => {
  vi.mocked(service.begin).mockRejectedValue(new TRPCError({code: 'BAD_REQUEST', message: 'private diagnostic', cause: Error('LOCAL_SESSION_INVALID')}));
  const result = await http('beginUpload', begin); expect(result.status).toBe(500); expect(await result.text()).not.toMatch(/private|LOCAL_SESSION_INVALID|stack|cause/);
});
it.each(['marker', 'origin', 'host', 'config'])('early %s failure includes security headers and never enters host', async kind => {
  const h: Record<string, string> = {...headers, 'content-type': 'application/json'};
  if (kind === 'marker') delete h['x-everwoven-request']; if (kind === 'origin') delete h.origin; if (kind === 'host') h.host = 'evil.example';
  const result = await handleTRPCRequest(new Request(`${origin}/api/trpc/assets.beginUpload`, {method: 'POST', headers: h, body: JSON.stringify(begin)}), kind === 'config' ? {...env, APP_ORIGIN: '/invalid'} : env);
  expect(result.status).toBe(kind === 'config' ? 500 : 403); expect(host.withLocalAssets).not.toHaveBeenCalled();
  expect(result.headers.get('cache-control')).toBe('no-store'); expect(result.headers.get('x-content-type-options')).toBe('nosniff');
});
it('malformed JSON is a fixed 400 without reflecting parser text or calling a service', async () => {
  const result = await handleTRPCRequest(new Request(`${origin}/api/trpc/assets.beginUpload`, {method: 'POST', headers: {...headers, 'content-type': 'application/json'}, body: '{"private-secret":'}), env);
  expect(result.status).toBe(400); expect(await result.text()).not.toMatch(/private-secret|SyntaxError|stack|cause/); expect(service.begin).not.toHaveBeenCalled();
});
it('query input validation retains its fixed query identifier', async () => {
  const result = await http('getUpload', {datasetId, uploadId, extra: 'bad'}, false);
  expect(result.status).toBe(400); expect((await result.json()).error.message).toBe('INVALID_ASSET_QUERY');
});
it('rejects output envelope fields inherited from a prototype with unrelated own keys', async () => {
  vi.mocked(service.begin).mockResolvedValue(Object.assign(Object.create({data: upload, replayed: false}), {one: 1, two: 2}));
  expect((await http('beginUpload', begin)).status).toBe(500);
});
