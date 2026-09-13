import {afterEach, expect, it, vi} from 'vitest';
import {createStoryDraftClient} from './story-client';
import {StoryClientError} from './story-ports';
import {STORY_HTTP_STATUS, storyErrorTRPCCode} from '../../contracts/story-http';
import {TRPC_ERROR_CODES_BY_KEY} from '@trpc/server/rpc';
import type {DraftCreate, DraftDTO} from '../../../runtime/src/contracts/story-draft';
const id = '01994b80-0000-7000-8000-000000000001', other = '01994b80-0000-7000-8000-000000000002';
const protocol = {protocolVersion: 1 as const, datasetId: id};
const create: DraftCreate = {...protocol, commandId: id, title: '原剧本', settings: {world: '海岛', opening: '', genre: '', playerRole: '', worldRules: [], tone: ''}, mainCharacter: null, assetSlots: {cover: null, opening: null, character: null}};
const dto: DraftDTO = {...protocol, id, title: create.title, settings: create.settings, mainCharacter: null, assetSlots: create.assetSlots, assets: [], schemaVersion: 1, revision: 1, createdAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:00.000Z', deletedAt: null, archivedAt: null};
const lifecycle = {...protocol, id, commandId: id, expectedRevision: 1};
const ok = (data: unknown) => Response.json({result: {data}});
const summary = {...protocol, id, title: dto.title, genre: '', mainCharacterName: null, coverAssetId: null, revision: 1, createdAt: dto.createdAt, updatedAt: dto.updatedAt, deletedAt: null, archivedAt: null};
afterEach(() => vi.unstubAllGlobals());
it('uses six explicit object operations over independent nonbatch HTTP without session or shared batch changes', async () => {
  const fetch = vi.fn(async (url: string, options: RequestInit) => {
    const path = new URL(url, 'http://127.0.0.1:3100').pathname;
    return ok(path.endsWith('.list') ? {...protocol, items: [summary], totalMatching: 1, nextCursor: null}
      : path.endsWith('.get') ? dto : {data: {...dto, revision: path.endsWith('.create') ? 1 : 2, deletedAt: path.endsWith('.delete') ? dto.updatedAt : null}, replayed: false});
  });
  vi.stubGlobal('fetch', fetch);
  const c = createStoryDraftClient();
  const results = await Promise.all([c.create(create), c.get({...protocol, id}), c.list(protocol), c.update({...lifecycle, patch: {title: '原剧本'}}), c.delete(lifecycle), c.restore(lifecycle)]);
  expect(fetch).toHaveBeenCalledTimes(6); expect(Object.keys(c).sort()).toEqual(['create', 'delete', 'get', 'list', 'restore', 'update']);
  expect(results[2]).toEqual({...protocol, items: [summary], totalMatching: 1, nextCursor: null});
  for (const [url, options] of fetch.mock.calls) {
    const parsed = new URL(url, 'http://127.0.0.1:3100'); expect(parsed.searchParams.has('batch')).toBe(false); expect(parsed.pathname).not.toContain(',');
    expect(options).toMatchObject({credentials: 'same-origin', cache: 'no-store', redirect: 'error'});
    expect(new Headers(options.headers).get('x-everwoven-request')).toBe('1');
    const input = JSON.parse(options.body as string || parsed.searchParams.get('input')!);
    expect(input).toMatchObject(protocol);
  }
});
it.each(['create', 'get', 'list', 'update', 'delete', 'restore'] as const)('%s rejects the old contract locally rather than sending a compatibility payload', async method => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(createStoryDraftClient()[method]({datasetId: id} as never)).rejects.toMatchObject({code: 'CLIENT_RELOAD_REQUIRED', outcome: 'rejected', status: 412});
  expect(fetch).not.toHaveBeenCalled();
});
it.each(Object.entries(STORY_HTTP_STATUS))('maps only the fixed server error %s at status %i', async (identifier, status) => {
  const code = storyErrorTRPCCode(status);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({error: {message: identifier, code: TRPC_ERROR_CODES_BY_KEY[code], data: {code, httpStatus: status}}}, {status})));
  await expect(createStoryDraftClient().create(create)).rejects.toMatchObject({name: 'StoryClientError', message: identifier, code: identifier, status, outcome: status < 500 ? 'rejected' : 'unknown'});
});
it('reports an aborted response as unknown without retrying or leaking transport diagnostics', async () => {
  const fetch = vi.fn(async () => {throw new Error('private token/path ECONNRESET');}); vi.stubGlobal('fetch', fetch);
  await expect(createStoryDraftClient().create(create)).rejects.toMatchObject({code: 'STORY_NETWORK_ERROR', message: 'STORY_NETWORK_ERROR', outcome: 'unknown'});
  expect(fetch).toHaveBeenCalledTimes(1);
});
it.each([
  {data: {...dto, protocolVersion: 2}, replayed: false},
  {data: {...dto, datasetId: other}, replayed: false},
  {data: dto, replayed: 'true'}, {data: {...dto, privateKey: 'secret'}, replayed: false},
  {data: {...dto, settings: {...dto.settings, secret: 'path'}}, replayed: false},
])('rejects malformed aggregate responses, never treating them as confirmations', async response => {
  vi.stubGlobal('fetch', vi.fn(async () => ok(response)));
  await expect(createStoryDraftClient().create(create)).rejects.toMatchObject({code: 'STORY_RESPONSE_INVALID', outcome: 'unknown'});
});
it('strictly checks summary responses and identity binding for detail and commands', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(ok({...protocol, items: [dto], nextCursor: null, totalMatching: 1}))
    .mockResolvedValueOnce(ok({...dto, id: other})).mockResolvedValueOnce(ok({data: {...dto, revision: 7}, replayed: true}));
  vi.stubGlobal('fetch', fetch); const c = createStoryDraftClient();
  await expect(c.list(protocol)).rejects.toBeInstanceOf(StoryClientError);
  await expect(c.get({...protocol, id})).rejects.toMatchObject({code: 'STORY_RESPONSE_INVALID'});
  await expect(c.update({...lifecycle, patch: {title: '原剧本'}})).rejects.toMatchObject({code: 'STORY_RESPONSE_INVALID'});
});
it.each([
  [403, {error: 'proxy permission denied'}],
  [412, {error: {message: 'DATASET_CHANGED', data: {code: 'PRECONDITION_FAILED', httpStatus: 400}}}],
  [500, {error: {message: 'INVALID_STORY_COMMAND /private/db', data: {code: 'BAD_REQUEST', httpStatus: 500}}}],
])('does not trust generic HTTP %i, prefix errors or mismatched metadata', async (status, body) => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(body, {status})));
  await expect(createStoryDraftClient().create(create)).rejects.toMatchObject({code: 'STORY_RESPONSE_INVALID', outcome: 'unknown', message: 'STORY_RESPONSE_INVALID'});
});
it('keeps invalid JSON responses unknown and preserves the original command bytes for manual retries', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response('{', {status: 200, headers: {'content-type': 'application/json'}}))
    .mockResolvedValueOnce(ok({data: dto, replayed: true}));
  vi.stubGlobal('fetch', fetch); const c = createStoryDraftClient();
  await expect(c.create(create)).rejects.toMatchObject({code: 'STORY_RESPONSE_INVALID', outcome: 'unknown'});
  expect(await c.create(create)).toEqual({data: dto, replayed: true});
  expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
});
