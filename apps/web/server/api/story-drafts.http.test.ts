import {beforeEach, expect, expectTypeOf, it, vi} from 'vitest';
import {TRPCError} from '@trpc/server';
import type {inferRouterInputs} from '@trpc/server';
import {handleTRPCRequest} from './http';
import {appRouter} from './root';
import type {StoryService} from '../local-runtime';
import {STORY_MUTATION_MAX_BYTES, type DraftCreate, type DraftDTO, type DraftGet, type DraftListInput, type DraftUpdate, type DraftLifecycle} from 'runtime/contracts/story-draft';
import {parseCreate} from 'runtime/contracts/story-draft-validation';
import {STORY_HTTP_STATUS, STORY_QUERY_MAX_BYTES} from '../../contracts/story-http';
const host = vi.hoisted(() => ({withLocalStories: vi.fn()}));
vi.mock('runtime/host', () => host);
const id = '01994b80-0000-7000-8000-000000000001', other = '01994b80-0000-7000-8000-000000000002';
const protocol = {protocolVersion: 1 as const, datasetId: id};
const origin = 'http://127.0.0.1:3100';
const env = {APP_ORIGIN: origin, APP_ENV: 'dev', EVERWOVEN_LOCAL_LAUNCH: 'loopback-v1', RUNTIME_DATA_DIR: '/tmp/story-port-fixture-not-opened'};
const headers = {origin, 'content-type': 'application/json', 'x-everwoven-request': '1', cookie: `everwoven_local=${'a'.repeat(43)}`};
const create: DraftCreate = {...protocol, commandId: id, title: '世界', settings: {world: '', opening: '', genre: '', playerRole: '', worldRules: [], tone: ''}, mainCharacter: null, assetSlots: {cover: null, opening: null, character: null}};
const dto: DraftDTO = {...protocol, id, title: create.title, settings: create.settings, mainCharacter: null, assetSlots: create.assetSlots, assets: [], schemaVersion: 1, revision: 1, createdAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:00.000Z', deletedAt: null, archivedAt: null};
const lifecycle = {...protocol, commandId: id, id, expectedRevision: 1};
const inputs = {create, get: {...protocol, id, includeDeleted: true}, list: {...protocol, q: '世界', limit: 20}, update: {...lifecycle, patch: {title: '世界'}}, delete: lifecycle, restore: lifecycle};
let service: StoryService;
beforeEach(() => {
  service = {create: vi.fn(async () => ({data: dto, replayed: false})), get: vi.fn(async () => dto), list: vi.fn(async () => ({...protocol, items: [], nextCursor: null, totalMatching: 0})), update: vi.fn(async () => ({data: {...dto, revision: 2}, replayed: false})), delete: vi.fn(async () => ({data: {...dto, revision: 2, deletedAt: dto.updatedAt}, replayed: false})), restore: vi.fn(async () => ({data: {...dto, revision: 2}, replayed: false}))};
  host.withLocalStories.mockReset().mockImplementation(async (_dir, _env, _token, work) => work(service, {ownerId: other, datasetId: id}));
});
function http(method: keyof typeof inputs, input: unknown = inputs[method], body?: string) {
  const query = method === 'get' || method === 'list';
  return handleTRPCRequest(new Request(`${origin}/api/trpc/storyDrafts.${method}${query ? `?input=${encodeURIComponent(JSON.stringify(input))}` : ''}`, {method: query ? 'GET' : 'POST', headers, ...(!query ? {body: body ?? JSON.stringify(input)} : {})}), env);
}
it('exports only the six new story operations', () => {
  expect(Object.keys(appRouter._def.procedures).filter(x => x.startsWith('storyDrafts.')).sort()).toEqual(['storyDrafts.create', 'storyDrafts.delete', 'storyDrafts.get', 'storyDrafts.list', 'storyDrafts.restore', 'storyDrafts.update']);
});
it('exposes exactly the new request DTOs, including optional query fields, to typed tRPC callers', () => {
  expectTypeOf<inferRouterInputs<typeof appRouter>['storyDrafts']>().toEqualTypeOf<{
    create: DraftCreate; get: DraftGet; list: DraftListInput; update: DraftUpdate; delete: DraftLifecycle; restore: DraftLifecycle;
  }>();
});
it.each(Object.keys(inputs) as (keyof typeof inputs)[])('%s accepts the new object and rejects missing protocol before service', async method => {
  expect((await http(method)).status).toBe(200);
  expect(vi.mocked(service[method]).mock.calls[0][1]).toMatchObject(inputs[method]);
  const {protocolVersion: _version, ...old} = inputs[method];
  const response = await http(method, old);
  expect(response.status).toBe(412); expect((await response.json()).error.message).toBe('CLIENT_RELOAD_REQUIRED');
  expect(service[method]).toHaveBeenCalledTimes(1);
});
it.each(Object.keys(inputs) as (keyof typeof inputs)[])('%s checks dataset identity before invoking the service', async method => {
  const response = await http(method, {...inputs[method], datasetId: other});
  expect(response.status).toBe(412); expect((await response.json()).error.message).toBe('DATASET_CHANGED');
  expect(service[method]).not.toHaveBeenCalled();
});
it.each(Object.keys(inputs) as (keyof typeof inputs)[])('%s rejects private and unknown request fields', async method => {
  const response = await http(method, {...inputs[method], ownerId: other});
  expect(response.status).toBe(400); expect(service[method]).not.toHaveBeenCalled();
});
it('requires a live session and preserves the fixed session identifier', async () => {
  const response = await handleTRPCRequest(new Request(`${origin}/api/trpc/storyDrafts.list?input=${encodeURIComponent(JSON.stringify(protocol))}`), env);
  expect(response.status).toBe(401); expect((await response.json()).error.message).toBe('LOCAL_SESSION_INVALID');
  expect(host.withLocalStories).not.toHaveBeenCalled();
});
it.each(Object.entries(STORY_HTTP_STATUS))('maps exactly %s through next() error data to HTTP %i', async (identifier, status) => {
  vi.mocked(service.create).mockRejectedValue(new Error(identifier));
  const response = await http('create'); expect(response.status).toBe(status);
  expect((await response.json()).error.message).toBe(identifier);
});
it.each([
  new Error('INVALID_STORY_PRIVATE /private/story.db'), new Error('Prisma constraint secret'),
  new TRPCError({code: 'BAD_REQUEST', message: 'leak /private/path'}),
  new TRPCError({code: 'CONFLICT', message: 'REVISION_CONFLICT', cause: Error('LOCAL_SESSION_INVALID')}),
])('sanitizes arbitrary errors, TRPCError instances and causes', async error => {
  vi.mocked(service.create).mockRejectedValue(error);
  const response = await http('create'); expect(response.status).toBe(500);
  expect(await response.json()).toEqual({error: {message: 'STORY_INTERNAL_ERROR', code: -32603, data: {code: 'INTERNAL_SERVER_ERROR', httpStatus: 500}}});
});
it.each(['extra', 'dataset', 'protocol', 'nested', 'summary'])('strictly validates service output: %s', async kind => {
  if (kind === 'summary') vi.mocked(service.list).mockResolvedValue({...protocol, items: [dto], nextCursor: null, totalMatching: 1} as never);
  else vi.mocked(service.create).mockResolvedValue({data: kind === 'extra' ? {...dto, storageKey: 'secret'} : kind === 'dataset' ? {...dto, datasetId: other} : kind === 'protocol' ? {...dto, protocolVersion: 2} : {...dto, settings: {...dto.settings, ownerId: other}}, replayed: false} as never);
  const response = await http(kind === 'summary' ? 'list' : 'create'); expect(response.status).toBe(500);
  expect(await response.text()).not.toMatch(/secret|ownerId|stack|cause|Prisma/);
});
function maximum(character: string): DraftCreate {
  const text = (n: number) => character.repeat(n);
  const settings = {personality: text(8000), appearance: text(4000), speakingStyle: text(2000), boundaries: text(4000)};
  return {...create, title: text(120), settings: {world: text(12000), opening: text(12000), genre: text(80), playerRole: text(4000), worldRules: Array.from({length: 30}, () => text(1000)), tone: text(500)}, mainCharacter: {kind: 'inline', name: text(120), settings, portraitAssetId: null, overrides: {portrait: {mode: 'inherit'}, relationship: text(4000), name: text(120), settings}}};
}
it.each(['unicode', 'controls', 'surrogate-escapes'])('accepts maximum legal %s JSON under the isolated 2 MiB budget', async encoding => {
  const input = maximum(encoding === 'controls' ? '\u0001' : '😀'); expect(parseCreate(input)).toEqual(input);
  let body = JSON.stringify(input);
  if (encoding === 'surrogate-escapes') body = body.replace(/😀/g, '\\ud83d\\ude00');
  const size = new TextEncoder().encode(body).byteLength;
  expect(size).toBeGreaterThan(262144); expect(size).toBeLessThan(STORY_MUTATION_MAX_BYTES);
  expect((await http('create', input, body)).status).toBe(200);
  expect(vi.mocked(service.create).mock.calls[0][1]).toEqual(input);
});
it('rejects oversize streams without relying on Content-Length and cancels the source', async () => {
  const cancel = vi.fn(); const stream = new ReadableStream({pull(controller) {controller.enqueue(new Uint8Array(65536).fill(32));}, cancel});
  const response = await handleTRPCRequest(new Request(`${origin}/api/trpc/storyDrafts.create`, {method: 'POST', headers, body: stream, duplex: 'half'} as RequestInit), env);
  expect(response.status).toBe(413); expect((await response.json()).error.message).toBe('STORY_REQUEST_TOO_LARGE');
  expect(cancel).toHaveBeenCalled(); expect(host.withLocalStories).not.toHaveBeenCalled();
});
it.each([
  'storyDrafts.create?batch=1', 'storyDrafts.create,storyDrafts.update?batch=1',
  'characters.create,storyDrafts.create?batch=1', 'storyDrafts.create,assets.beginUpload',
  'storyDrafts.create%2CstoryDrafts.update?batch=1',
])('rejects story batch %s before any host work', async path => {
  const response = await handleTRPCRequest(new Request(`${origin}/api/trpc/${path}`, {method: 'POST', headers, body: JSON.stringify({0: create, 1: create})}), env);
  expect(response.status).toBe(400); expect((await response.json()).error.message).toBe('INVALID_STORY_COMMAND');
  expect(host.withLocalStories).not.toHaveBeenCalled();
});
it('bounds story query URLs independently and rejects malformed JSON without diagnostics', async () => {
  const response = await handleTRPCRequest(new Request(`${origin}/api/trpc/storyDrafts.list?input=${'x'.repeat(STORY_QUERY_MAX_BYTES)}`, {headers}), env);
  expect(response.status).toBe(400); expect((await response.json()).error.message).toBe('INVALID_STORY_QUERY');
  const malformed = await http('create', create, '{"secret-path":'); expect(malformed.status).toBe(400);
  expect(await malformed.text()).not.toMatch(/secret-path|SyntaxError|stack|cause/);
  expect(host.withLocalStories).not.toHaveBeenCalled();
});
it.each(['characters.create', 'assets.beginUpload', 'video.configuration', 'storyDrafts.notAnOperation'])('keeps the 256 KiB budget for %s', async path => {
  const response = await handleTRPCRequest(new Request(`${origin}/api/trpc/${path}`, {method: 'POST', headers, body: ' '.repeat(262145)}), env);
  expect([400, 413]).toContain(response.status); expect(host.withLocalStories).not.toHaveBeenCalled();
});
it('accepts exactly 2 MiB but rejects one extra streamed byte even with a small declared length', async () => {
  const body = JSON.stringify(create);
  const padded = body + ' '.repeat(STORY_MUTATION_MAX_BYTES - new TextEncoder().encode(body).byteLength);
  expect((await http('create', create, padded)).status).toBe(200);
  const response = await handleTRPCRequest(new Request(`${origin}/api/trpc/storyDrafts.create`, {method: 'POST', headers: {...headers, 'content-length': '1'}, body: padded + ' '}), env);
  expect(response.status).toBe(413); expect(service.create).toHaveBeenCalledTimes(1);
});
it('rejects invalid raw UTF-8 rather than replacing user text before parsing', async () => {
  const body = new TextEncoder().encode(JSON.stringify({...create, title: 'ABC'}));
  // Replace an ASCII byte in the title with an invalid continuation byte.
  const index = new TextDecoder().decode(body).indexOf('"title":"') + 9;
  body[index] = 0x80;
  const response = await handleTRPCRequest(new Request(`${origin}/api/trpc/storyDrafts.create`, {method: 'POST', headers, body}), env);
  expect(response.status).toBe(400); expect(host.withLocalStories).not.toHaveBeenCalled();
});
it('rejects mixed query batches while leaving non-story metadata batches intact', async () => {
  const query = '?batch=1&input=' + encodeURIComponent(JSON.stringify({0: protocol}));
  const response = await handleTRPCRequest(new Request(`${origin}/api/trpc/storyDrafts.list,video.configuration${query}`, {headers}), env);
  expect(response.status).toBe(400); expect((await response.json()).error.message).toBe('INVALID_STORY_QUERY');
  expect(host.withLocalStories).not.toHaveBeenCalled();
  const other = await handleTRPCRequest(new Request(`${origin}/api/trpc/video.configuration?batch=1`), env);
  expect(other.status).toBe(200); expect(Array.isArray(await other.json())).toBe(true);
});
