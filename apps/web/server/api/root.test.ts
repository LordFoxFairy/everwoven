import {describe, expect, it} from 'vitest';
import {appRouter} from './root';
import {handleTRPCRequest} from './http';

describe('T3 provider configuration boundary', () => {
  it('returns only public configuration, never credentials or local paths', async () => {
    const caller = appRouter.createCaller({env: {
      VIDEO_PROVIDER: 'minimax', VIDEO_MODEL: 'minimax-h3-max',
      MINIMAX_API_KEY: 'private-test-key', RUNTIME_DATABASE_URL: 'file:/private/test.db',
    }});
    expect(await caller.video.configuration()).toEqual({
      available: false, selection: {providerId: 'minimax', modelId: 'minimax-h3-max'}, reason: 'not-live',
    });
  });

  it('serves the actual tRPC HTTP contract without caching', async () => {
    const response = await handleTRPCRequest(new Request('http://127.0.0.1:3100/api/trpc/video.configuration'), {});
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({result: {data: {available: false, selection: null, reason: 'unselected'}}});
  });

  it('accepts Next internal localhost normalization only with the exact public Host', async () => {
    const request = new Request('http://localhost:3100/api/trpc/video.configuration', {
      headers: {host: '127.0.0.1:3100', origin: 'http://127.0.0.1:3100'},
    });
    expect((await handleTRPCRequest(request, {})).status).toBe(200);
    expect((await handleTRPCRequest(new Request('http://localhost:3100/api/trpc/video.configuration'), {})).status).toBe(403);
  });

  it.each([
    ['http://evil.example/api/trpc/video.configuration', {}],
    ['http://127.0.0.1:3100/api/trpc/video.configuration', {origin: 'https://evil.example'}],
    ['http://127.0.0.1:3100/api/trpc/video.configuration', {host: 'evil.example'}],
    ['http://127.0.0.1:3100/api/trpc/video.configuration', {'sec-fetch-site': 'cross-site'}],
  ] as const)('rejects a foreign host or browser origin: %s %j', async (url, headers) => {
    const response = await handleTRPCRequest(new Request(url, {headers}), {});
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('does not expose a write or billing operation', async () => {
    const response = await handleTRPCRequest(new Request('http://127.0.0.1:3100/api/trpc/experience.start', {
      method: 'POST', headers: {'content-type': 'application/json', origin: 'http://127.0.0.1:3100'}, body: '{}',
    }), {});
    expect(response.status).toBe(404);
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain('stack');
    expect(body).not.toContain('/Users/');
  });
});

describe('explicit self-hosted Web origin', () => {
  it('accepts the configured HTTPS public host behind an internal Next listener', async () => {
    const req=new Request('http://localhost:3000/api/trpc/video.configuration',{headers:{host:'weiwan.example',origin:'https://weiwan.example'}});
    expect((await handleTRPCRequest(req,{APP_ORIGIN:'https://weiwan.example'})).status).toBe(200);
  });
  it('does not trust forwarded headers or another origin', async () => {
    const req=new Request('http://localhost:3000/api/trpc/video.configuration',{headers:{host:'evil.example','x-forwarded-host':'weiwan.example',origin:'https://weiwan.example'}});
    expect((await handleTRPCRequest(req,{APP_ORIGIN:'https://weiwan.example'})).status).toBe(403);
  });
  it.each(['*','https://weiwan.example/path','file:/private','https://user:secret@weiwan.example'])('fails closed for invalid deployment origin %s',async APP_ORIGIN => {
    const response=await handleTRPCRequest(new Request('http://127.0.0.1:3100/api/trpc/video.configuration'),{APP_ORIGIN});
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(APP_ORIGIN);
  });
});
