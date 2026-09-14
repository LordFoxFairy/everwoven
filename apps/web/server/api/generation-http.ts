import {fetchRequestHandler} from '@trpc/server/adapters/fetch';
import {TRPC_ERROR_CODES_BY_KEY} from '@trpc/server/rpc';
import {appRouter} from './root';
import {boundedJSONRequest, guardLocalRequest, localRuntimeConfig} from '../local-boundary';
import {localPlaybackAccess, localGenerationAccess} from '../local-generation';
import {generationHTTPStatus, generationTRPCCode, GENERATION_QUERY_MAX_BYTES, GENERATION_COMMAND_MAX_BYTES, type GenerationErrorCode} from '../../contracts/generation-http';

function failure(identifier: GenerationErrorCode) {
  const status = generationHTTPStatus(identifier)!, code = generationTRPCCode(status);
  return Response.json({error: {message: identifier, code: TRPC_ERROR_CODES_BY_KEY[code], data: {code, httpStatus: status}}}, {
    status, headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'},
  });
}
/** A domain-scoped HTTP gate, reusing the existing listener/router/auth boundary, not another endpoint server. */
export async function handleGenerationHTTP(request: Request, env: Record<string, string | undefined>, paths: string[]): Promise<Response> {
  const query = request.method === 'GET', invalid = query ? 'INVALID_GENERATION_QUERY' : 'INVALID_GENERATION_COMMAND';
  const config = localRuntimeConfig(env);
  if (!config) return failure('LOCAL_SESSION_INVALID');
  try {guardLocalRequest(request, config);} catch {return failure('LOCAL_ORIGIN_DENIED');}
  const url = new URL(request.url);
  if (paths.length !== 1 || url.searchParams.has('batch') || !['GET', 'POST'].includes(request.method)) return failure(invalid);
  if (query) {
    if (new TextEncoder().encode(request.url).byteLength > GENERATION_QUERY_MAX_BYTES) return failure(invalid);
    try {if (url.searchParams.has('input')) JSON.parse(url.searchParams.get('input')!);} catch {return failure(invalid);}
  } else {
    try {
      request = await boundedJSONRequest(request, GENERATION_COMMAND_MAX_BYTES);
      JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(await request.clone().arrayBuffer()));
    } catch (error) {return failure(error instanceof Error && error.message === 'BODY_TOO_LARGE' ? 'GENERATION_REQUEST_TOO_LARGE' : invalid);}
  }
  const response = await fetchRequestHandler({endpoint: '/api/trpc', req: request, router: appRouter,
    createContext: () => ({env, withPlayback: localPlaybackAccess(request, env), withGeneration: localGenerationAccess(request, env)}),
  });
  if (response.status >= 400) {
    let identifier: GenerationErrorCode = 'GENERATION_INTERNAL_ERROR';
    try {
      const body = await response.json();
      if (typeof body?.error?.message === 'string' && generationHTTPStatus(body.error.message) !== undefined) identifier = body.error.message;
    } catch {/* Fixed error, no provider config/path/stack. */}
    return failure(identifier);
  }
  response.headers.set('Cache-Control', 'no-store'); response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}
