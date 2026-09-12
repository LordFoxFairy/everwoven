import { localStoryAccess } from '../local-runtime';
import { boundedJSONRequest } from '../local-boundary';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from './root';

export async function handleTRPCRequest(
  request: Request,
  env: Record<string, string | undefined>,
): Promise<Response> {
  // One explicit deployment origin; never infer trust from forwarded headers.
  let expected: URL;
  try {
    expected = new URL(env.APP_ORIGIN || 'http://127.0.0.1:3100');
    if (
      !['http:', 'https:'].includes(expected.protocol) ||
      expected.username ||
      expected.password ||
      expected.pathname !== '/' ||
      expected.search ||
      expected.hash
    )
      throw new Error('invalid origin');
  } catch {
    return Response.json(
      { error: '部署来源配置无效' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  // Next may use an internal URL behind a reverse proxy. The public Host must still match exactly.
  if (
    (host !== null ? host !== expected.host : url.origin !== expected.origin) ||
    (origin !== null && origin !== expected.origin) ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  ) {
    return Response.json(
      { error: '来源不受信任' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (request.method === 'POST') {
    if (origin !== expected.origin)
      return Response.json(
        { error: '来源不受信任' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      );
    if (url.pathname.includes('storyDrafts.') && request.headers.get('x-everwoven-request') !== '1')
      return Response.json(
        { error: '请求标记缺失' },
        { status: 403, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
      );
    try {
      request = await boundedJSONRequest(request);
    } catch {
      return Response.json(
        { error: '请求体格式或大小无效' },
        { status: 400, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
      );
    }
  }
  const response = await fetchRequestHandler({
    endpoint: '/api/trpc',
    req: request,
    router: appRouter,
    createContext: () => ({ env, withStories: localStoryAccess(request, env) }),
  });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}
