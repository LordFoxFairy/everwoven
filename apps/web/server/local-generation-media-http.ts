import {parseGetGenerationMedia} from 'runtime/contracts/generation-media';
import {guardLocalRequest, localRuntimeConfig, sessionToken} from './local-boundary';
import {privateVideoResponse, videoError} from './private-video-response';

const errors: Record<string, number> = {LOCAL_SESSION_INVALID: 401, LOCAL_ORIGIN_DENIED: 403, OWNER_UNAVAILABLE: 403,
  INVALID_GENERATION_MEDIA_QUERY: 400, DATASET_CHANGED: 412, GENERATION_MEDIA_NOT_FOUND: 404};
export async function handleGenerationMedia(request: Request, turnId: string, env: Record<string, string | undefined>): Promise<Response> {
  if (!['GET', 'HEAD'].includes(request.method)) return videoError(405, 'METHOD_NOT_ALLOWED', request.method, {Allow: 'GET, HEAD'});
  try {
    const config = localRuntimeConfig(env);if (!config) throw Error('LOCAL_SESSION_INVALID');
    guardLocalRequest(request, config);const token = sessionToken(request);if (!token) throw Error('LOCAL_SESSION_INVALID');
    const params = [...new URL(request.url).searchParams];
    if (params.length !== 3 || new Set(params.map(([key]) => key)).size !== 3 || params.some(([key]) => !['datasetId', 'experienceId', 'mediaId'].includes(key))) throw Error('INVALID_GENERATION_MEDIA_QUERY');
    const query = parseGetGenerationMedia({...Object.fromEntries(params), turnId});
    const host = await import('runtime/host');
    const reader = await host.openLocalGenerationMedia(config.directory, config.environment, token, query);
    return await privateVideoResponse(request, reader);
  } catch (error) {
    const message = error instanceof Error ? error.message : '', status = errors[message];
    return videoError(status ?? 503, status ? message : 'VIDEO_UNAVAILABLE', request.method);
  }
}
