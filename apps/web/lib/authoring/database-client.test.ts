import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createAppClient} from '../../trpc/client';
import {createDatabaseDraftsClient} from './database-client';
import type {DatabaseDraftsClient} from './ports';
import type {DraftCreate, DraftDTO, DraftUpdate} from '../../../runtime/src/contracts/story-draft';

vi.mock('../../trpc/client', () => ({createAppClient: vi.fn()}));

const datasetId = '01994b80-0000-7000-8000-000000000099';
const safeError = '本机连接失败，请重试';
const code = 'local-connection-code';
const methods = ['GET', 'POST', 'DELETE'] as const;
type Method = typeof methods[number];
const fetchMock = vi.fn<typeof fetch>();
const storyDrafts = {
  create: {mutate: vi.fn()}, get: {query: vi.fn()}, list: {query: vi.fn()},
  update: {mutate: vi.fn()}, delete: {mutate: vi.fn()}, restore: {mutate: vi.fn()},
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  // Only the transport surface used by this adapter is needed; no real tRPC or network.
  vi.mocked(createAppClient).mockReturnValue({storyDrafts} as unknown as ReturnType<typeof createAppClient>);
});
afterEach(() => {vi.unstubAllGlobals();});

function sessionCall(method: Method) {
  const client = createDatabaseDraftsClient();
  return method === 'GET' ? client.session() : method === 'POST' ? client.connect(code) : client.logout();
}

describe('session HTTP boundary', () => {
  it.each(methods)('%s preserves request credentials, cache and boundary headers', async method => {
    fetchMock.mockResolvedValueOnce(Response.json({authenticated: method !== 'DELETE', datasetId}));
    await sessionCall(method);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/local-session', {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: {'content-type': 'application/json', 'x-everwoven-request': '1'},
      ...(method === 'POST' ? {body: JSON.stringify({code})} : {}),
    });
    expect(createAppClient).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])('GET accepts authenticated=%s and discards extra fields', async authenticated => {
    fetchMock.mockResolvedValueOnce(Response.json({authenticated, datasetId, expiresAt: 123, extra: 'ignored'}));
    await expect(sessionCall('GET')).resolves.toEqual(authenticated ? {authenticated: true, datasetId} : {authenticated: false});
  });

  it.each(['POST', 'DELETE'] as const)('%s accepts its expected boolean and resolves void', async method => {
    fetchMock.mockResolvedValueOnce(Response.json({authenticated: method === 'POST', datasetId, expiresAt: 123}));
    await expect(sessionCall(method)).resolves.toBeUndefined();
  });

  it.each(['POST', 'DELETE'] as const)('%s rejects a successful HTTP response with the opposite state', async method => {
    fetchMock.mockResolvedValueOnce(Response.json({authenticated: method !== 'POST'}));
    await expect(sessionCall(method)).rejects.toEqual(new Error(safeError));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe.each(['GET', 'POST'] as const)('%s dataset identity', method => {
    it.each([undefined, null, '', 'bad', 1, [], {}, '01994b80-0000-4000-8000-000000000099'])('rejects authenticated true with invalid dataset %j', async datasetId => {
      fetchMock.mockResolvedValueOnce(Response.json({authenticated: true, datasetId}));
      await expect(sessionCall(method)).rejects.toEqual(new Error(safeError));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe.each(methods)('%s rejects invalid bodies without echoing response content', method => {
    it.each([
      {name: 'null', body: null},
      {name: 'array', body: [{authenticated: true}]},
      {name: 'empty array', body: []},
      {name: 'string', body: 'private response body'},
      {name: 'number', body: 1},
      {name: 'boolean', body: true},
      {name: 'missing authenticated', body: {}},
      {name: 'null authenticated', body: {authenticated: null}},
      {name: 'string authenticated', body: {authenticated: 'true'}},
      {name: 'number authenticated', body: {authenticated: 0}},
      {name: 'object authenticated', body: {authenticated: {value: true}}},
      {name: 'array authenticated', body: {authenticated: []}},
      {name: 'error envelope', body: {error: '/private/path TOKEN arbitrary server error'}},
    ])('$name', async ({body}) => {
      fetchMock.mockResolvedValueOnce(Response.json(body));
      await expect(sessionCall(method)).rejects.toEqual(new Error(safeError));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each(['{"authenticated": true, "secret": "TOKEN"', '<html>private proxy error</html>', ''])('rejects malformed/empty JSON: %j', async body => {
      fetchMock.mockResolvedValueOnce(new Response(body, {status: 200}));
      await expect(sessionCall(method)).rejects.toEqual(new Error(safeError));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each([
      {status: 400, body: JSON.stringify({error: 'arbitrary server error TOKEN'})},
      {status: 401, body: JSON.stringify({authenticated: method !== 'DELETE', datasetId})},
      {status: 403, body: 'null'},
      {status: 404, body: '[]'},
      {status: 503, body: '<html>private proxy response</html>'},
    ])('rejects HTTP $status with a fixed safe error', async ({status, body}) => {
      fetchMock.mockResolvedValueOnce(new Response(body, {status}));
      await expect(sessionCall(method)).rejects.toEqual(new Error(safeError));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('sanitizes network failures without retrying', async () => {
      fetchMock.mockRejectedValueOnce(new Error('network failure at /private/path?token=TOKEN'));
      await expect(sessionCall(method)).rejects.toEqual(new Error(safeError));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});

const draft: DraftDTO = {
  id: '01994b80-0000-7000-8000-000000000001', title: '世界设定',
  settings: {world: '海岛', opening: '一封来信', genre: '日常', playerRole: '旅人', worldRules: ['第一行\n第二行'], tone: '平静'},
  schemaVersion: 1, revision: 2, createdAt: '2026-09-12T00:00:00.000Z',
  updatedAt: '2026-09-12T01:00:00.000Z', deletedAt: null, archivedAt: null,
};
const create: DraftCreate = {
  datasetId, commandId: '01994b80-0000-7000-8000-000000000002', title: draft.title, settings: draft.settings,
};
const update: DraftUpdate = {
  datasetId, commandId: create.commandId, id: draft.id, expectedRevision: draft.revision,
  patch: {title: '更新世界', settings: draft.settings},
};
const lifecycle = {datasetId, commandId: create.commandId, id: draft.id, expectedRevision: draft.revision};
const list = {limit: 7, deleted: 'only' as const, cursor: 'page-cursor'};
const receipt = {data: draft, replayed: true};
const page = {items: [draft], nextCursor: 'next-page'};
const operations = [
  {name: 'create', target: storyDrafts.create.mutate, input: create, result: receipt,
    call: (client: DatabaseDraftsClient) => client.create(create)},
  {name: 'get including deleted', target: storyDrafts.get.query, input: {id: draft.id, includeDeleted: true}, result: draft,
    call: (client: DatabaseDraftsClient) => client.get(draft.id)},
  {name: 'list', target: storyDrafts.list.query, input: list, result: page,
    call: (client: DatabaseDraftsClient) => client.list(list)},
  {name: 'list without input', target: storyDrafts.list.query, input: undefined, result: page,
    call: (client: DatabaseDraftsClient) => client.list()},
  {name: 'update', target: storyDrafts.update.mutate, input: update, result: receipt,
    call: (client: DatabaseDraftsClient) => client.update(update)},
  {name: 'delete', target: storyDrafts.delete.mutate, input: lifecycle, result: receipt,
    call: (client: DatabaseDraftsClient) => client.delete(lifecycle)},
  {name: 'restore', target: storyDrafts.restore.mutate, input: lifecycle, result: receipt,
    call: (client: DatabaseDraftsClient) => client.restore(lifecycle)},
];

describe('story CRUD delegation', () => {
  it.each(operations)('$name delegates arguments and returns the original result', async ({target, input, result, call}) => {
    target.mockResolvedValueOnce(result);
    await expect(call(createDatabaseDraftsClient())).resolves.toBe(result);
    expect(target).toHaveBeenCalledExactlyOnceWith(input);
    expect(Object.values(storyDrafts).flatMap(procedure => Object.values(procedure))
      .reduce((total, mock) => total + mock.mock.calls.length, 0)).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe.each(operations)('$name preserves errors and never retries', ({target, input, call}) => {
    it.each([
      Object.assign(new Error('REVISION_CONFLICT'), {data: {code: 'CONFLICT', httpStatus: 409}}),
      Object.assign(new Error('会话失效'), {data: {code: 'UNAUTHORIZED', httpStatus: 401}}),
      new Error('response lost'),
    ])('$message', async error => {
      target.mockRejectedValueOnce(error);
      await expect(call(createDatabaseDraftsClient())).rejects.toBe(error);
      expect(target).toHaveBeenCalledExactlyOnceWith(input);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
