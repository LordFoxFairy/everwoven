import {beforeEach, expect, it, vi} from 'vitest';
import {TRPCError} from '@trpc/server';
import {handleTRPCRequest} from './http';
import type {ExperienceOpeningDTO} from 'runtime/contracts/experience-opening';
const host = vi.hoisted(() => ({withLocalExperienceOpenings: vi.fn()}));
vi.mock('runtime/host', () => host);
const id = '01994b80-0000-7000-8000-000000000001', other = '01994b80-0000-7000-8000-000000000002';
const protocol = {protocolVersion: 1 as const, datasetId: id}, owner = {ownerId: other, datasetId: id};
const origin = 'http://127.0.0.1:3100', env = {APP_ORIGIN: origin, APP_ENV: 'dev', EVERWOVEN_LOCAL_LAUNCH: 'loopback-v1', RUNTIME_DATA_DIR: '/tmp/opening-http-not-opened'};
const headers = {origin, 'content-type': 'application/json', 'x-everwoven-request': '1', cookie: `everwoven_local=${'a'.repeat(43)}`};
const command = {...protocol, commandId: id, storyDraftId: id, expectedStoryRevision: 1, bindingKey: 'video', expectedBindingVersion: 1, budget: {limitMicros: '0', currency: 'USD' as const}};
const dto: ExperienceOpeningDTO = {...protocol, id, revision: 1, status: 'preparing', schedulingPaused: true, createdAt: '2026-09-13T00:00:00.000Z',
  story: {...protocol, id, storyDraftId: id, sourceRevision: 1, versionNo: 1, title: 'story', settings: {world: '', opening: '', genre: '', playerRole: '', worldRules: [], tone: ''},
    mainCharacter: null, assetSlots: {cover: null, opening: null, character: null}, schemaVersion: 1, createdAt: '2026-09-13T00:00:00.000Z', sealedAt: '2026-09-13T00:00:00.000Z', contentHash: 'a'.repeat(64)},
  binding: {id, bindingKey: 'video', versionNo: 1, providerId: 'minimax', modelId: 'MiniMax-H3-Max', mode: 'job', connectionId: 'personal', region: 'cn', adapterVersion: 'v1', capabilityVersion: 'v1', snapshotHash: 'b'.repeat(64)}, budget: command.budget,
  setup: {id, kind: 'setup', experienceId: id, experienceRevision: 1, options: []}, responseDraft: {id, experienceId: id, interactionEventId: id, text: '', revision: 1}, media: null, canRespond: false, canDispatch: false};
const service = {create: vi.fn(), getPreparing: vi.fn(), bindings: vi.fn()};
const inputs = {create: command, getPreparing: {...protocol, id}, bindings: protocol};
beforeEach(() => {
  vi.resetAllMocks(); service.create.mockResolvedValue({data: dto, replayed: false}); service.getPreparing.mockResolvedValue(dto);
  service.bindings.mockReturnValue({...protocol, status: 'empty', items: []});
  host.withLocalExperienceOpenings.mockImplementation((_d, _e, _t, work) => work(service, owner));
});
function request(method: keyof typeof inputs, input: unknown = inputs[method], overrides?: HeadersInit) {
  const h = new Headers(headers); if (overrides) new Headers(overrides).forEach((v, k) => h.set(k, v));
  return new Request(`${origin}/api/trpc/openings.${method}${method === 'create' ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`}`, {
    method: method === 'create' ? 'POST' : 'GET', headers: h, ...(method === 'create' ? {body: JSON.stringify(input)} : {}),
  });
}
it.each(Object.keys(inputs) as Array<keyof typeof inputs>)('%s uses the existing authenticated host', async method => {
  const response = await handleTRPCRequest(request(method), env);
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(host.withLocalExperienceOpenings).toHaveBeenCalledTimes(1); expect(service[method]).toHaveBeenCalledTimes(1);
});
it.each(Object.keys(inputs) as Array<keyof typeof inputs>)('%s validates protocol, dataset and rejects client owner', async method => {
  expect((await handleTRPCRequest(request(method, {...inputs[method], protocolVersion: 2}), env)).status).toBe(412);
  expect((await handleTRPCRequest(request(method, {...inputs[method], datasetId: other}), env)).status).toBe(412);
  expect((await handleTRPCRequest(request(method, {...inputs[method], ownerId: other}), env)).status).toBe(400);
  expect(service[method]).not.toHaveBeenCalled();
});
it('requires session for directory metadata and exact origin/marker for creates', async () => {
  expect((await handleTRPCRequest(request('bindings', protocol, {cookie: ''}), env)).status).toBe(401);
  const denied: HeadersInit[] = [{origin: 'https://untrusted.invalid'}, {'x-everwoven-request': ''}, {host: 'untrusted.invalid'}, {'sec-fetch-site': 'cross-site'}];
  for (const headers of denied)
    expect((await handleTRPCRequest(request('create', command, headers), env)).status).toBe(403);
  expect(host.withLocalExperienceOpenings).not.toHaveBeenCalled();
});
it.each(['openings.create?batch=1', 'openings.create,storyDrafts.create', 'storyDrafts.create,openings.create'])('rejects batch %s before host work', async path => {
  const response = await handleTRPCRequest(new Request(`${origin}/api/trpc/${path}`, {method: 'POST', headers, body: JSON.stringify(command)}), env);
  expect(response.status).toBe(400); expect(host.withLocalExperienceOpenings).not.toHaveBeenCalled();
});
it('bounds streamed body and query, and rejects malformed JSON without reaching host', async () => {
  const response = await handleTRPCRequest(new Request(`${origin}/api/trpc/openings.create`, {method: 'POST', headers, body: JSON.stringify({...command, x: '界'.repeat(17000)})}), env);
  expect(response.status).toBe(413);
  expect((await handleTRPCRequest(request('bindings', {...protocol, x: 'x'.repeat(9000)}), env)).status).toBe(400);
  expect((await handleTRPCRequest(new Request(`${origin}/api/trpc/openings.create`, {method: 'POST', headers, body: '{bad'}), env)).status).toBe(400);
  expect(host.withLocalExperienceOpenings).not.toHaveBeenCalled();
});
it.each([['REVISION_CONFLICT', 409], ['DATASET_CHANGED', 412], ['PROVIDER_NOT_INITIALIZED', 503], ['PROVIDER_CONFIGURATION_UNAVAILABLE', 503], ['EXPERIENCE_NOT_FOUND', 404]])('preserves fixed %s error', async (code, status) => {
  service.create.mockRejectedValue(Error(String(code))); const response = await handleTRPCRequest(request('create'), env);
  expect(response.status).toBe(status); expect((await response.json()).error.message).toBe(code);
});
it.each([Error('/private/key.db'), new TRPCError({code: 'BAD_REQUEST', message: 'secret'}), Error('PROVIDER_CONFIGURATION_UNAVAILABLE secret')])('sanitizes arbitrary errors', async error => {
  service.create.mockRejectedValue(error); const response = await handleTRPCRequest(request('create'), env);
  expect(response.status).toBe(500); expect((await response.json()).error.message).toBe('EXPERIENCE_INTERNAL_ERROR');
});
it('validates the output rather than leaking fields from a service', async () => {
  service.create.mockResolvedValue({data: {...dto, binding: {...dto.binding, credentialRef: 'secret'}}, replayed: false});
  let response = await handleTRPCRequest(request('create'), env); expect(response.status).toBe(500); expect(await response.text()).not.toContain('secret');
  service.getPreparing.mockResolvedValue({...dto, datasetId: other, story: {...dto.story, datasetId: other}});
  response = await handleTRPCRequest(request('getPreparing'), env); expect(response.status).toBe(500);
});
it.each(Object.keys(inputs) as Array<keyof typeof inputs>)('%s maps malformed dataset ID to a command/query error', async method => {
  const response = await handleTRPCRequest(request(method, {...inputs[method], datasetId: 'bad-id'}), env);
  expect(response.status).toBe(400); expect(service[method]).not.toHaveBeenCalled();
});
it('rejects a well-shaped response for another source/request', async () => {
  service.create.mockResolvedValue({data: {...dto, story: {...dto.story, storyDraftId: other}}, replayed: false});
  expect((await handleTRPCRequest(request('create'), env)).status).toBe(500);
  service.getPreparing.mockResolvedValue({...dto, id: other, setup: {...dto.setup, experienceId: other}, responseDraft: {...dto.responseDraft, experienceId: other}});
  expect((await handleTRPCRequest(request('getPreparing'), env)).status).toBe(500);
});
