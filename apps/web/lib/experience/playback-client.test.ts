import {afterEach, expect, it, vi} from 'vitest';
import {createPlaybackClient} from './playback-client';
import {GENERATION_RESPONSE_MAX_BYTES, GENERATION_HTTP_STATUS, generationTRPCCode} from '../../contracts/generation-http';
const id = '01994b80-0000-7000-8000-000000000001', other = '01994b80-0000-7000-8000-000000000002';
const protocol = {protocolVersion: 1 as const, datasetId: id}, query = {...protocol, experienceId: id};
const command = {...query, commandId: other, expectedExperienceRevision: 1, turnId: id, mediaId: other};
const data = {...query, title: '雨后', revision: 2, status: 'awaiting', turn: {id, status: 'viewed', media: {id: other, duration: 5}, errorCode: null},
  interaction: {id, summary: '雨停了。', choices: [{id: 'ask', title: '问问他', text: '出去走走吗？'}, {id: 'look', title: '看窗外', text: '我看向窗外。'}]}};
const ok = (data: unknown) => Response.json({result: {data}});
afterEach(() => vi.unstubAllGlobals());
it('uses original nonbatch tRPC with local session cookies and request marker', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(ok(data)).mockResolvedValueOnce(ok({data, replayed: false})); vi.stubGlobal('fetch', fetch);
  const client = createPlaybackClient();
  expect(await client.get(query)).toEqual(data); expect(await client.completePlayback(command)).toEqual({data, replayed: false});
  expect(fetch).toHaveBeenCalledTimes(2);
  for (const [url, init] of fetch.mock.calls) {
    expect(url).toContain('/api/trpc/generation.'); expect(url).not.toContain('batch=');
    expect(init).toMatchObject({credentials: 'same-origin', cache: 'no-store', redirect: 'error'});
    expect(new Headers(init.headers).get('x-everwoven-request')).toBe('1');
  }
});
it('does not automatically resend unknown playback acknowledgement', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(Error('private failure')).mockResolvedValueOnce(ok({data, replayed: true})); vi.stubGlobal('fetch', fetch);
  const client = createPlaybackClient();
  await expect(client.completePlayback(command)).rejects.toMatchObject({code: 'PLAYBACK_NETWORK_ERROR', outcome: 'unknown'});
  expect(fetch).toHaveBeenCalledTimes(1);
  expect((await client.completePlayback(command)).replayed).toBe(true);
  expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
});
it.each(Object.entries(GENERATION_HTTP_STATUS))('validates %s error status and outcome', async (message, status) => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({error: {message, data: {httpStatus: status, code: generationTRPCCode(status)}}}, {status})));
  await expect(createPlaybackClient().completePlayback(command)).rejects.toMatchObject({code: message, status, outcome: status < 500 ? 'rejected' : 'unknown'});
});
it('rejects malformed requests without network', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(createPlaybackClient().get({...query, datasetId: 'bad'})).rejects.toMatchObject({code: 'INVALID_GENERATION_QUERY', outcome: 'rejected'});
  await expect(createPlaybackClient().completePlayback({...command, mediaId: 'bad'})).rejects.toMatchObject({outcome: 'rejected'});
  expect(fetch).not.toHaveBeenCalled();
});
it('keeps miscorrelated and malformed successes unknown', async () => {
  for (const bad of [{...data, datasetId: other}, {...data, experienceId: other}, {...data, revision: 3}, {...data, turn: {...data.turn, id: other}}, {...data, extra: 'secret'}]) {
    vi.stubGlobal('fetch', vi.fn(async () => ok({data: bad, replayed: false})));
    await expect(createPlaybackClient().completePlayback(command)).rejects.toMatchObject({code: 'PLAYBACK_RESPONSE_INVALID', outcome: 'unknown'});
  }
});
it('cancels an oversized stream and retains unknown outcome', async () => {
  const cancel = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(GENERATION_RESPONSE_MAX_BYTES + 1));}, cancel}))));
  await expect(createPlaybackClient().get(query)).rejects.toMatchObject({code: 'PLAYBACK_RESPONSE_INVALID', outcome: 'unknown'});
  expect(cancel).toHaveBeenCalledTimes(1);
});
