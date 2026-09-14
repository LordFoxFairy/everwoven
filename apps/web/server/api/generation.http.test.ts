import {beforeEach, expect, it, vi} from 'vitest';
import {TRPCError} from '@trpc/server';
import {handleTRPCRequest} from './http';
import type {PlayDTO} from 'runtime/contracts/generation';
const host = vi.hoisted(() => ({withLocalGenerationPlayback: vi.fn()}));
vi.mock('runtime/host', () => host);
const id = '01994b80-0000-7000-8000-000000000001', other = '01994b80-0000-7000-8000-000000000002';
const protocol = {protocolVersion: 1 as const, datasetId: id}, owner = {ownerId: other, datasetId: id};
const origin = 'http://127.0.0.1:3100', env = {APP_ORIGIN: origin, APP_ENV: 'dev', EVERWOVEN_LOCAL_LAUNCH: 'loopback-v1', RUNTIME_DATA_DIR: '/tmp/generation-http-not-opened'};
const headers = {origin, 'content-type': 'application/json', 'x-everwoven-request': '1', cookie: `everwoven_local=${'a'.repeat(43)}`};
const command = {...protocol, experienceId: id, commandId: other, expectedExperienceRevision: 1, turnId: id, mediaId: other};
const dto: PlayDTO = {...protocol, experienceId: id, revision: 2, title: '雨后', status: 'awaiting',
  turn: {id, status: 'viewed', media: {id: other, duration: 5}, errorCode: null},
  interaction: {id, summary: '雨停了，两人望向窗外。', choices: [{id: 'ask', title: '问问他', text: '要出去走走吗？'}, {id: 'look', title: '看看窗外', text: '我看向窗外。'}]}};
const service = {get: vi.fn(), completePlayback: vi.fn()};
const inputs = {get: {...protocol, experienceId: id}, completePlayback: command};
beforeEach(() => {
  vi.resetAllMocks(); service.get.mockResolvedValue(dto); service.completePlayback.mockResolvedValue({data: dto, replayed: false});
  host.withLocalGenerationPlayback.mockImplementation((_d, _e, _t, work) => work(service, owner));
});
function request(method: keyof typeof inputs, input: unknown = inputs[method], overrides?: HeadersInit) {
  const h = new Headers(headers); if (overrides) new Headers(overrides).forEach((v, k) => h.set(k, v));
  return new Request(`${origin}/api/trpc/generation.${method}${method === 'get' ? `?input=${encodeURIComponent(JSON.stringify(input))}` : ''}`, {
    method: method === 'get' ? 'GET' : 'POST', headers: h, ...(method === 'get' ? {} : {body: JSON.stringify(input)}),
  });
}
it.each(['get', 'completePlayback'] as const)('%s uses the authenticated host and a non-cacheable response', async method => {
  const response = await handleTRPCRequest(request(method), env);
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(host.withLocalGenerationPlayback).toHaveBeenCalledTimes(1); expect(service[method]).toHaveBeenCalledWith(inputs[method]);
});
it.each(['get', 'completePlayback'] as const)('%s rejects wrong protocol, dataset, IDs and injected owner before application work', async method => {
  for (const [patch, status] of [[{protocolVersion: 2}, 412], [{datasetId: other}, 412], [{datasetId: 'bad'}, 400], [{ownerId: other}, 400], [{experienceId: 'bad'}, 400]] as const)
    expect((await handleTRPCRequest(request(method, {...inputs[method], ...patch}), env)).status).toBe(status);
  expect(service[method]).not.toHaveBeenCalled();
});
it('requires the session, origin, mutation marker and local launch', async () => {
  expect((await handleTRPCRequest(request('get', inputs.get, {cookie: ''}), env)).status).toBe(401);
  expect((await handleTRPCRequest(request('get'), {...env, EVERWOVEN_LOCAL_LAUNCH: undefined})).status).toBe(401);
  const denied: HeadersInit[] = [{origin: 'https://untrusted.invalid'}, {'x-everwoven-request': ''}, {host: 'untrusted.invalid'}, {'sec-fetch-site': 'cross-site'}];
  for (const override of denied)
    expect((await handleTRPCRequest(request('completePlayback', command, override), env)).status).toBe(403);
  expect(host.withLocalGenerationPlayback).not.toHaveBeenCalled();
});
it.each(['generation.completePlayback?batch=1', 'generation.completePlayback,openings.create', 'storyDrafts.create,generation.completePlayback'])('blocks mixed/batched %s', async path => {
  const response = await handleTRPCRequest(new Request(`${origin}/api/trpc/${path}`, {method: 'POST', headers, body: JSON.stringify(command)}), env);
  expect(response.status).toBe(400); expect(host.withLocalGenerationPlayback).not.toHaveBeenCalled();
});
it('bounds request bodies/queries and rejects malformed JSON', async () => {
  expect((await handleTRPCRequest(request('completePlayback', {...command, extra: '界'.repeat(17000)}), env)).status).toBe(413);
  expect((await handleTRPCRequest(request('get', {...inputs.get, extra: 'x'.repeat(9000)}), env)).status).toBe(400);
  expect((await handleTRPCRequest(new Request(`${origin}/api/trpc/generation.completePlayback`, {method: 'POST', headers, body: '{bad'}), env)).status).toBe(400);
  expect(host.withLocalGenerationPlayback).not.toHaveBeenCalled();
});
it.each([['REVISION_CONFLICT', 409], ['GENERATION_NOT_PLAYABLE', 409], ['DATASET_CHANGED', 412], ['STORE_AUTHORITY_UNAVAILABLE', 503]])('preserves fixed %s errors', async (code, status) => {
  service.completePlayback.mockRejectedValue(Error(String(code)));
  const response = await handleTRPCRequest(request('completePlayback'), env);
  expect(response.status).toBe(status); expect((await response.json()).error.message).toBe(code);
});
it.each([Error('private/path/token'), new TRPCError({code: 'BAD_REQUEST', message: 'secret'})])('sanitizes unissued service errors', async error => {
  service.get.mockRejectedValue(error);
  const response = await handleTRPCRequest(request('get'), env);
  expect(response.status).toBe(500); expect((await response.json()).error.message).toBe('GENERATION_INTERNAL_ERROR');
});
it('validates output shape, dataset, experience and exact playback receipt correlation', async () => {
  for (const patch of [{datasetId: other}, {experienceId: other}, {extra: 'secret'}, {status: 'playing'}]) {
    service.get.mockResolvedValue({...dto, ...patch});
    const response = await handleTRPCRequest(request('get'), env);
    expect(response.status).toBe(500); expect(await response.text()).not.toContain('secret');
  }
  for (const patch of [{revision: 3}, {turn: {...dto.turn!, id: other}}, {turn: {...dto.turn!, media: {id, duration: 5}}}]) {
    service.completePlayback.mockResolvedValue({data: {...dto, ...patch}, replayed: true});
    expect((await handleTRPCRequest(request('completePlayback'), env)).status).toBe(500);
  }
});
