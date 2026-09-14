import {handleGenerationHTTP} from './generation-http';
import {localAssetAccess} from '../local-assets';
import {handleOpeningHTTP} from './openings-http';
import {localCharacterAccess} from '../local-characters';
import { localStoryAccess } from '../local-runtime';
import { boundedJSONRequest } from '../local-boundary';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from './root';
import {TRPC_ERROR_CODES_BY_KEY} from '@trpc/server/rpc';
import {STORY_MUTATION_MAX_BYTES} from 'runtime/contracts/story-draft';
import {STORY_QUERY_MAX_BYTES, storyErrorHTTPStatus, storyErrorTRPCCode, type StoryErrorCode} from '../../contracts/story-http';

function storyFailure(identifier: StoryErrorCode): Response {
  const status = storyErrorHTTPStatus(identifier)!;
  const code = storyErrorTRPCCode(status);
  return Response.json({error: {message: identifier, code: TRPC_ERROR_CODES_BY_KEY[code], data: {code, httpStatus: status}}}, {
    status, headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'},
  });
}

export async function handleTRPCRequest(
  request: Request,
  env: Record<string, string | undefined>,
): Promise<Response> {
  const url = new URL(request.url);
  let paths: string[];
  try {paths = decodeURIComponent(url.pathname.slice('/api/trpc/'.length)).split(',');}
  catch {return storyFailure('INVALID_STORY_QUERY');}
  if (paths.some(path => path.startsWith('generation.'))) return handleGenerationHTTP(request, env, paths);
  if (paths.some(path => path.startsWith('openings.'))) return handleOpeningHTTP(request, env, paths);
  const story = paths.some(path => path.startsWith('storyDrafts.'));
  const storyMutation = story && paths.length === 1 && ['create', 'update', 'delete', 'restore'].some(method => paths[0] === `storyDrafts.${method}`);
  const invalid = request.method === 'GET' ? 'INVALID_STORY_QUERY' : 'INVALID_STORY_COMMAND';
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
    if (story) return storyFailure('STORY_INTERNAL_ERROR');
    return Response.json(
      { error: '部署来源配置无效' },
      { status: 500, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
    );
  }
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  // Next may use an internal URL behind a reverse proxy. The public Host must still match exactly.
  if (
    (host !== null ? host !== expected.host : url.origin !== expected.origin) ||
    (origin !== null && origin !== expected.origin) ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  ) {
    if (story) return storyFailure('LOCAL_ORIGIN_DENIED');
    return Response.json(
      { error: '来源不受信任' },
      { status: 403, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
    );
  }
  if (story) {
    // Even a one-operation batch is not this protocol. Never increase a mixed budget.
    if (paths.length !== 1 || url.searchParams.has('batch')) return storyFailure(invalid);
    if (request.method === 'GET') {
      if (new TextEncoder().encode(request.url).byteLength > STORY_QUERY_MAX_BYTES) return storyFailure('INVALID_STORY_QUERY');
      try {if (url.searchParams.has('input')) JSON.parse(url.searchParams.get('input')!);}
      catch {return storyFailure('INVALID_STORY_QUERY');}
    }
  }
  if (request.method === 'POST') {
    if (origin !== expected.origin) {
      if (story) return storyFailure('LOCAL_ORIGIN_DENIED');
      return Response.json(
        { error: '来源不受信任' },
        { status: 403, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
      );
    }
    if ((story || url.pathname.includes('characters.') || url.pathname.includes('assets.')) && request.headers.get('x-everwoven-request') !== '1') {
      if (story) return storyFailure('LOCAL_ORIGIN_DENIED');
      return Response.json(
        { error: '请求标记缺失' },
        { status: 403, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
      );
    }
    try {
      request = await boundedJSONRequest(request, storyMutation ? STORY_MUTATION_MAX_BYTES : undefined);
      if (story) JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(await request.clone().arrayBuffer()));
    } catch (error) {
      if (story) return storyFailure(error instanceof Error && error.message === 'BODY_TOO_LARGE' ? 'STORY_REQUEST_TOO_LARGE' : 'INVALID_STORY_COMMAND');
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
    createContext: () => ({ env, withAssets: localAssetAccess(request, env), withStories: localStoryAccess(request, env), withCharacters: localCharacterAccess(request, env) }),
  });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  // The shared formatter intentionally hides internal messages for other domains.
  // Give story failures their fixed wire identifiers, without path/stack/cause fields.
  if (story && response.status >= 400) {
    let identifier: StoryErrorCode = 'STORY_INTERNAL_ERROR';
    try {
      const body = await response.json();
      if (typeof body?.error?.message === 'string' && storyErrorHTTPStatus(body.error.message) !== undefined)
        identifier = body.error.message as StoryErrorCode;
    } catch { /* Use the fixed internal error. */ }
    return storyFailure(identifier);
  }
  return response;
}
