import {afterEach, expect, it, vi} from 'vitest';
import {v7} from 'uuid';
import {createOpeningClient} from './opening-client';
import {OPENING_HTTP_STATUS, openingTRPCCode} from '../../contracts/experience-http';
import {TRPC_ERROR_CODES_BY_KEY} from '@trpc/server/rpc';
import {command, directory, opening, protocol} from './opening-test-fixtures';
const ok = (data: unknown) => Response.json({result: {data}});
afterEach(() => vi.unstubAllGlobals());
it('uses exactly three nonbatch original tRPC operations with strict detached outputs', async () => {
  const dto = opening(), fetch = vi.fn().mockResolvedValueOnce(ok(directory)).mockResolvedValueOnce(ok({data: dto, replayed: false})).mockResolvedValueOnce(ok(dto));
  vi.stubGlobal('fetch', fetch); const c = createOpeningClient();
  expect(await c.bindings(protocol)).toEqual(directory);
  expect((await c.create(command)).data).toEqual(dto);
  expect(await c.getPreparing({...protocol, id: dto.id})).toEqual(dto);
  expect(fetch).toHaveBeenCalledTimes(3);
  for (const [url, init] of fetch.mock.calls) {
    expect(new URL(url, 'http://localhost').pathname).toMatch(/^\/api\/trpc\/openings\.(bindings|create|getPreparing)$/);
    expect(url).not.toContain('batch='); expect(init).toMatchObject({credentials: 'same-origin', cache: 'no-store', redirect: 'error'});
    expect(new Headers(init.headers).get('x-everwoven-request')).toBe('1');
  }
});
it.each(Object.entries(OPENING_HTTP_STATUS))('trusts only exact error envelope %s %i', async (message, status) => {
  const code = openingTRPCCode(status); vi.stubGlobal('fetch', vi.fn(async () => Response.json({error: {message, code: TRPC_ERROR_CODES_BY_KEY[code], data: {code, httpStatus: status}}}, {status})));
  await expect(createOpeningClient().create(command)).rejects.toMatchObject({code: message, status, outcome: status < 500 ? 'rejected' : 'unknown'});
});
it('rejects malformed commands and private directory queries before network', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const c = createOpeningClient();
  await expect(c.create({...command, budget: {currency: 'CNY', limitMicros: '1.2'}})).rejects.toMatchObject({outcome: 'rejected'});
  await expect(c.bindings({...protocol, ownerId: v7()} as never)).rejects.toMatchObject({outcome: 'rejected'});
  expect(fetch).not.toHaveBeenCalled();
});
it('lost response is sanitized unknown, no retry; explicit retry preserves bytes', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(Error('private API key/path')).mockResolvedValueOnce(ok({data: opening(), replayed: true})); vi.stubGlobal('fetch', fetch); const c = createOpeningClient();
  await expect(c.create(command)).rejects.toMatchObject({code: 'OPENING_NETWORK_ERROR', message: 'OPENING_NETWORK_ERROR', outcome: 'unknown'});
  expect(fetch).toHaveBeenCalledTimes(1); expect((await c.create(command)).replayed).toBe(true);
  expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
});
it.each(['dataset', 'source', 'revision', 'binding', 'budget', 'secret', 'invalid-json', 'generic-403', 'mismatched-error', 'oversize'])('keeps %s response unknown', async kind => {
  const dto = opening(); if (kind === 'dataset') dto.datasetId = v7();
  if (kind === 'source') dto.story.storyDraftId = v7(); if (kind === 'revision') dto.story.sourceRevision++;
  if (kind === 'binding') dto.binding.bindingKey = 'other'; if (kind === 'budget') dto.budget.limitMicros = '1';
  if (kind === 'secret') Object.assign(dto.binding, {credentialRef: 'secret'});
  let response = ok({data: dto, replayed: false});
  if (kind === 'invalid-json') response = new Response('{');
  if (kind === 'generic-403') response = new Response('proxy failed', {status: 403});
  if (kind === 'mismatched-error') response = Response.json({error: {message: 'DATASET_CHANGED', data: {code: 'BAD_REQUEST', httpStatus: 400}}}, {status: 412});
  if (kind === 'oversize') response = new Response(' '.repeat(2 * 1024 * 1024 + 1));
  vi.stubGlobal('fetch', vi.fn(async () => response));
  await expect(createOpeningClient().create(command)).rejects.toMatchObject({code: 'OPENING_RESPONSE_INVALID', outcome: 'unknown'});
});
it('rejects another experience get and another dataset directory', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok(opening())).mockResolvedValueOnce(ok({...directory, datasetId: v7()}))); const c = createOpeningClient();
  await expect(c.getPreparing({...protocol, id: v7()})).rejects.toMatchObject({code: 'OPENING_RESPONSE_INVALID'});
  await expect(c.bindings(protocol)).rejects.toMatchObject({code: 'OPENING_RESPONSE_INVALID'});
});
it('cancels an oversized non-ending response stream at the 2MiB success boundary', async () => {
  const cancel = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));}, cancel}))));
  await expect(createOpeningClient().create(command)).rejects.toMatchObject({code: 'OPENING_RESPONSE_INVALID', outcome: 'unknown'});
  expect(cancel).toHaveBeenCalledTimes(1);
});
